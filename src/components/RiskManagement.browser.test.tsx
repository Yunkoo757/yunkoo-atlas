import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { MonthlyRiskLimit, RiskPolicyDraft, RiskPolicyVersion } from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import { TradeOpenRiskDialog } from '@/components/TradeOpenRiskDialog'
import { getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { weekStartFor } from '@/data/weeklyReviews'
import { useStore } from '@/store/useStore'
import { TodayWorkspace } from '@/views/TodayWorkspace'
import { RiskGatePublishAfterCommitError } from '@/lib/riskGatedTradeOpenCommit'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __riskManagementBrowserTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

function click(label: string, scope: ParentNode = document): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.trim() === label)
  assert(button, `找不到按钮：${label}`)
  button.click()
  return button
}

function setText(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  assert(setter, '浏览器缺少 value setter')
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

const day = getTradingDayKey(new Date(), 0)
const weekStart = weekStartFor(parseLocalDate(day))
const monthKey = day.slice(0, 7)
const confirmedAt = new Date().toISOString()

const draft: RiskPolicyDraft = {
  capitalBase: 100_000,
  riskPercent: 1,
  riskAmount: 1_000,
  dailyLossLimitR: 2,
  weeklyLossLimitR: 5,
  monthlyLossLimitRDefault: 10,
  disciplineText: '触线后停止开仓，先复核执行偏差。',
}

const policy: RiskPolicyVersion = {
  id: 'policy-browser',
  sourceWeekStart: weekStart,
  effectiveTradingDay: day,
  capitalBase: 100_000,
  riskPercent: 1,
  riskAmount: 1_000,
  dailyLossLimitR: 2,
  weeklyLossLimitR: 5,
  monthlyLossLimitRDefault: 10,
  disciplineText: draft.disciplineText,
  confirmedAt,
}

const monthlyLimit: MonthlyRiskLimit = {
  id: `monthly-risk-limit:${monthKey}`,
  monthKey,
  limitR: 10,
  sourcePolicyVersionId: policy.id,
  lockedAt: confirmedAt,
}

function trade(id: string, status: 'planned' | 'loss', options: { unknown?: boolean } = {}): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status,
    conviction: 'medium',
    strategyId: 'strategy-1',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: status === 'loss' ? 98 : null,
    size: 1,
    pnl: status === 'loss' && !options.unknown ? -2_000 : null,
    rMultiple: null,
    resultSource: status === 'loss' && !options.unknown ? 'pnl' : undefined,
    openedAt: `${day}T01:00:00.000Z`,
    closedAt: status === 'loss' && !options.unknown ? `${day}T02:00:00.000Z` : null,
    closedTradingDayKey: status === 'loss' && !options.unknown ? day : undefined,
    note: '',
    activities: [{
      id: `activity-${id}-${status}`,
      kind: 'status',
      status,
      timestamp: `${day}T01:00:00.000Z`,
    }],
  }
}

function Harness() {
  const [showTemporaryOpener, setShowTemporaryOpener] = useState(true)
  return (
    <MemoryRouter initialEntries={['/today-record']}>
      {showTemporaryOpener ? (
        <button
          id="temporary-risk-opener"
          type="button"
          onClick={(event) => {
            useStore.getState().requestTradeOpen('target', event.currentTarget)
            setShowTemporaryOpener(false)
          }}
        >
          临时开仓入口
        </button>
      ) : null}
      <TodayWorkspace />
      <TradeOpenRiskDialog />
    </MemoryRouter>
  )
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  try {
    useStore.setState((state) => ({
      trades: [trade('target', 'planned')],
      weeklyRiskPreparations: [{
        id: `weekly-risk-preparation:${weekStart}`,
        weekStart,
        draft,
        reviewedAt: null,
        confirmedPolicyVersionId: null,
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
      }],
      riskPolicyVersions: [policy],
      monthlyRiskLimits: [monthlyLimit],
      riskOverrideEvents: [],
      liveStatsStartTradingDayKey: null,
      pendingTradeOpenRequest: null,
      undoStack: [],
      redoStack: [],
      display: { ...state.display, tradingDayStartHour: 0 },
    }))
    root.render(<Harness />)

    await waitFor(
      () => Boolean(document.querySelector('[data-risk-status]') && document.querySelector('[data-today-action-queue]')),
      '今日工作台没有完成渲染',
    )
    const status = document.querySelector<HTMLElement>('[data-risk-status]')
    const actionQueue = document.querySelector<HTMLElement>('[data-today-action-queue]')
    assert(actionQueue && status, '今日工作台缺少风险状态或行动队列')
    assert(!document.querySelector('[data-risk-preparation]'), '工作台不得渲染风险配置表单')
    assert(!document.body.textContent?.includes('修改规则'), '工作台不得提供规则编辑动作')
    assert(!document.body.textContent?.includes('确认本周规则'), '工作台不得提供每周确认动作')
    assert(document.querySelector('.today-focus .empty-btn'), '工作台主动作不得因未复核而消失')
    assert(status.textContent?.includes('本周风险规则尚未确认'), '风险轨道必须说明未复核状态')
    assert(
      status.querySelector<HTMLAnchorElement>('a[href="/settings/risk"]')?.textContent?.trim() === '前往风险管理',
      '未复核状态必须提供唯一设置恢复动作',
    )
    const initialPeriods = [...status.querySelectorAll<HTMLElement>('[data-risk-period]')]
    const initialPeriod = (label: string) => initialPeriods.find((period) =>
      period.querySelector('.risk-status-period-head span')?.textContent?.trim() === label)
    const initialDay = initialPeriod('今日')
    const initialWeek = initialPeriod('本周')
    const initialMonth = initialPeriod('本月')
    assert(initialDay?.dataset.riskState === 'normal', '未复核不得伪造今日真实风险结果')
    assert(initialMonth?.dataset.riskState === 'normal', '未复核不得伪造本月真实风险结果')
    assert(initialWeek?.dataset.riskState === 'unreviewed', '未复核时仅本周必须显示待复核状态')
    assert(initialWeek.textContent?.includes('待复核'), '未复核本周必须使用待复核标签')
    assert(initialWeek.textContent?.includes('本周规则未确认'), '未复核本周必须说明规则未确认')
    assert(!document.querySelector('.today-stats'), '没有平仓结果时不得渲染今日战绩')
    assert(status.querySelectorAll('[data-risk-period]').length === 3, '风险状态必须始终展示日周月')
    assert(!status.querySelector('details'), '风险状态不得折叠')
    assert(!status.textContent?.includes('1R ='), '工作台不得展示 1R 配置说明')
    assert(!status.textContent?.includes('计入'), '工作台不得展示风险统计审计明细')

    useStore.setState({
      weeklyRiskPreparations: [{
        ...useStore.getState().weeklyRiskPreparations[0]!,
        reviewedAt: confirmedAt,
        confirmedPolicyVersionId: policy.id,
      }],
    })
    await waitFor(() => !(status.textContent?.includes('本周风险规则尚未确认') ?? true), '已复核状态没有生效')

    const cases = [
      {
        name: '正常',
        trades: [trade('target', 'planned')],
        policies: [policy],
        limits: [monthlyLimit],
        expected: ['正常', '日、周、月均在风险限额内。'],
      },
      {
        name: '临界',
        trades: [{ ...trade('near', 'loss'), pnl: -1_800 }],
        policies: [policy],
        limits: [monthlyLimit],
        expected: ['接近限额', '今日接近限额'],
      },
      {
        name: '超限',
        trades: [trade('triggered', 'loss')],
        policies: [policy],
        limits: [monthlyLimit],
        expected: ['已超限', '今日已超限'],
      },
      {
        name: '未知',
        trades: [trade('unknown-loss', 'loss', { unknown: true })],
        policies: [policy],
        limits: [monthlyLimit],
        expected: ['无法判断', '今日无法判断'],
      },
      {
        name: '未配置',
        trades: [],
        policies: [],
        limits: [],
        expected: ['未配置', '今日未配置'],
      },
    ] as const

    for (const fixture of cases) {
      useStore.setState({
        trades: fixture.trades.slice(),
        riskPolicyVersions: fixture.policies.slice(),
        monthlyRiskLimits: fixture.limits.slice(),
      })
      await waitFor(
        () => fixture.expected.every((copy) => status.textContent?.includes(copy)),
        `${fixture.name} 风险状态没有更新`,
      )
    }

    useStore.setState({
      weeklyRiskPreparations: [{
        ...useStore.getState().weeklyRiskPreparations[0]!,
        reviewedAt: confirmedAt,
        confirmedPolicyVersionId: null,
      }],
    })
    await waitFor(
      () => status.textContent?.includes('本周风险规则尚未确认') ?? false,
      '半完整持久化准备状态必须保持未复核',
    )
    useStore.setState({
      trades: [trade('target', 'planned')],
      riskPolicyVersions: [policy],
      monthlyRiskLimits: [monthlyLimit],
      weeklyRiskPreparations: [{
        ...useStore.getState().weeklyRiskPreparations[0]!,
        reviewedAt: confirmedAt,
        confirmedPolicyVersionId: policy.id,
      }],
    })
    await waitFor(
      () => !(status.textContent?.includes('本周风险规则尚未确认') ?? true),
      '恢复已复核准备状态失败',
    )
    const reviewedActionQueue = document.querySelector<HTMLElement>('[data-today-action-queue]')
    assert(reviewedActionQueue, '已复核时行动队列不存在')
    const completedTrade: Trade = {
      ...trade('completed-today', 'loss'),
      reviewStatus: 'reviewed',
      reviewedAt: `${day}T03:00:00.000Z`,
    }
    useStore.setState({ trades: [trade('target', 'planned'), completedTrade] })
    await waitFor(() => Boolean(document.querySelector('.today-completed')), '今日已完成区块没有渲染')
    const completedSection = document.querySelector<HTMLElement>('.today-completed')
    assert(completedSection, '今日已完成区块没有渲染')
    assert(completedSection.textContent?.includes('今日已完成'), '已完成交易必须进入今日已完成区块')
    assert(parseFloat(getComputedStyle(completedSection).marginTop) > 0, '今日已完成区块必须与前一区块保持明确间距')
    useStore.setState({ trades: [trade('target', 'planned'), trade('unknown-loss', 'loss', { unknown: true })] })
    await waitFor(() => !document.querySelector('.today-completed'), '恢复行动队列 fixture 失败')
    const queueTabs = reviewedActionQueue.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    assert(queueTabs.length === 4, '行动队列必须有全部、进行中、待结果、待复盘四个 tab')
    assert([...queueTabs].filter((tab) => tab.getAttribute('aria-selected') === 'true').length === 1, '行动队列必须只有一个已选 tab')
    const reviewPendingTab = [...queueTabs].find((tab) => tab.textContent?.includes('待复盘'))
    assert(reviewPendingTab, '行动队列缺少待复盘 tab')
    reviewPendingTab.click()
    await frame()
    const queuePanel = reviewedActionQueue.querySelector<HTMLElement>('[role="tabpanel"]')
    assert(queuePanel?.textContent?.includes('当前筛选下没有待处理事项'), '零计数筛选必须在 tabpanel 内显示紧凑空态')

    const allTab = queueTabs[0]!
    const activeTab = queueTabs[1]!
    allTab.focus()
    allTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await frame()
    assert(document.activeElement === activeTab, 'ArrowRight 必须将焦点移动到下一个 tab')
    assert(activeTab.getAttribute('aria-selected') === 'true', 'ArrowRight 必须选中下一个 tab')
    assert(
      Boolean(activeTab.id)
        && activeTab.getAttribute('aria-controls') === queuePanel?.id
        && queuePanel?.getAttribute('aria-labelledby') === activeTab.id,
      'tab 与 tabpanel 必须通过 aria-controls 和 aria-labelledby 关联',
    )

    const temporaryOpener = document.getElementById('temporary-risk-opener') as HTMLButtonElement
    temporaryOpener.focus()
    temporaryOpener.click()
    await waitFor(() => Boolean(document.querySelector('[data-trade-open-risk-dialog]')), 'unknown 开仓没有打开全局确认框')
    const gatePolicy = document.querySelector<HTMLElement>('.trade-open-risk-policy')
    assert(gatePolicy, 'Gate 缺少有效规则摘要')
    assert(gatePolicy.textContent?.includes('1R 金额'), '货币字段必须明确标为 1R 金额')
    assert(!gatePolicy.textContent?.includes('每 R 风险'), '货币字段不得继续使用量纲含混的标签')
    useStore.setState((state) => ({ display: { ...state.display, privacyMode: true } }))
    await waitFor(() => gatePolicy.textContent?.includes('****') ?? false, '隐私模式没有隐藏 Gate 1R 金额')
    assert(!gatePolicy.textContent?.includes('$1,250'), '隐私模式不得泄露 Gate 1R 金额')
    useStore.setState((state) => ({ display: { ...state.display, privacyMode: false } }))
    if (new URLSearchParams(location.search).get('visual') === 'dialog') {
      await new Promise<void>(() => {})
    }
    assert(!document.getElementById('temporary-risk-opener'), '测试 opener 应已卸载')
    const reason = document.querySelector<HTMLTextAreaElement>('[aria-label="继续开仓原因"]')
    assert(reason, '确认框缺少原因输入')

    click('确认继续开仓')
    await waitFor(() => Boolean(document.querySelector('[role="alert"]')), '空原因没有显示校验错误')
    const validationAlert = document.querySelector<HTMLElement>('[role="alert"]')
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    assert(validationAlert?.id && dialog?.getAttribute('aria-describedby')?.includes(validationAlert.id), '错误必须通过 aria-describedby 关联到 dialog')
    assert(useStore.getState().trades[0]?.status === 'planned', '校验失败不得开仓')
    setText(reason, 'x'.repeat(501))
    click('确认继续开仓')
    await waitFor(() => document.body.textContent?.includes('最多 500 字') ?? false, '501 字原因没有被拒绝')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitFor(() => !document.querySelector('[data-trade-open-risk-dialog]'), 'Esc 没有关闭确认框')
    assert(useStore.getState().trades[0]?.status === 'planned', 'Esc 不得开仓')
    await waitFor(
      () => document.activeElement?.closest('[data-trade-id="target"]') !== null || document.activeElement?.closest('.ui-main-frame') !== null,
      'opener 卸载后焦点没有回到稳定 fallback',
    )

    useStore.getState().requestTradeOpen('target')
    await waitFor(() => Boolean(document.querySelector('[data-trade-open-risk-dialog]')), '重试场景没有打开确认框')
    const retryReason = document.querySelector<HTMLTextAreaElement>('[aria-label="继续开仓原因"]')
    assert(retryReason, '重试场景缺少原因输入')
    setText(retryReason, '复核后接受本次偏离')
    await frame()
    let attempts = 0
    let releaseFirstAttempt: (() => void) | undefined
    useStore.setState({
      confirmTradeOpen: async () => {
        attempts += 1
        if (attempts === 1) {
          await new Promise<void>((resolve) => { releaseFirstAttempt = resolve })
          useStore.setState((state) => ({
            pendingTradeOpenRequest: state.pendingTradeOpenRequest
              ? { ...state.pendingTradeOpenRequest, fingerprint: `${state.pendingTradeOpenRequest.fingerprint}:changed` }
              : null,
          }))
          return { kind: 'needs-reconfirmation' as const }
        }
        if (attempts === 2) throw new Error('模拟存储失败')
        useStore.setState((state) => ({
          trades: state.trades.map((item) => item.id === 'target' ? { ...item, status: 'open' as const } : item),
          pendingTradeOpenRequest: null,
        }))
        return { kind: 'committed' as const }
      },
    })
    await frame()
    click('确认继续开仓')
    await waitFor(() => document.querySelector('[role="dialog"]')?.getAttribute('aria-busy') === 'true', '提交没有进入 busy 状态')
    click('正在写入…')
    await frame()
    assert(attempts === 1, '提交期间必须阻止重复确认')
    assert(document.querySelector('[role="dialog"]')?.getAttribute('aria-busy') === 'true', '提交期间 dialog 必须 aria-busy=true')
    releaseFirstAttempt?.()
    await waitFor(() => document.body.textContent?.includes('风险数据已变化') ?? false, 'fingerprint 变化没有要求再次确认')
    assert(retryReason.value === '复核后接受本次偏离', '再次确认必须保留原原因')
    click('重试确认')
    await waitFor(() => document.body.textContent?.includes('模拟存储失败') ?? false, '提交失败没有显示原因')
    assert(retryReason.value === '复核后接受本次偏离', '提交失败后没有保留用户原因')
    click('重试确认')
    await waitFor(() => !document.querySelector('[data-trade-open-risk-dialog]'), '失败后无法重试成功')
    assert(Number(attempts) === 3, '重试没有复用同一提交动作')

    const durableTarget = trade('target-durable', 'planned')
    useStore.setState((state) => ({
      trades: [durableTarget, trade('durable-triggered-loss', 'loss')],
      pendingTradeOpenRequest: null,
      riskOverrideEvents: [],
      undoStack: [],
      redoStack: [],
      display: { ...state.display, tradingDayStartHour: 0 },
    }))
    useStore.getState().requestTradeOpen(durableTarget.id)
    await waitFor(() => Boolean(document.querySelector('[data-trade-open-risk-dialog]')), 'durable 恢复场景没有打开确认框')
    assert(document.body.textContent?.includes('止损预算已触线'), 'triggered 分支没有真实展示触线文案')
    let recovered = 0
    useStore.setState({
      confirmTradeOpen: async () => {
        throw new RiskGatePublishAfterCommitError(createEmptyPersistedSnapshot(), new Error('publish failed'))
      },
      rehydrateRiskGateFromStorage: async () => {
        recovered += 1
        if (recovered === 1) throw new Error('模拟 reload 失败')
        useStore.setState((state) => ({
          trades: state.trades.map((item) => item.id === durableTarget.id
            ? { ...item, status: 'open' as const }
            : item),
          pendingTradeOpenRequest: null,
        }))
      },
    })
    await frame()
    const durableReason = document.querySelector<HTMLTextAreaElement>('[aria-label="继续开仓原因"]')
    assert(durableReason, 'durable 恢复场景缺少原因输入')
    setText(durableReason, '持久化成功后恢复工作台')
    await frame()
    click('确认继续开仓')
    await waitFor(() => document.body.textContent?.includes('工作台恢复失败') ?? false, 'reload 失败没有进入 reload-required')
    assert(durableReason.value === '持久化成功后恢复工作台', 'reload-required 必须保留原因')
    await waitFor(
      () => document.activeElement?.textContent?.trim() === '重新载入已提交快照',
      'reload-required 必须显式聚焦唯一恢复动作',
    )
    assert(![...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '取消开仓'), 'reload-required 不得保留取消动作')
    assert(![...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '重试确认'), 'reload-required 不得再次提交确认')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.querySelector<HTMLElement>('.modal-shell-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await frame()
    assert(document.querySelector('[data-trade-open-risk-dialog]'), 'reload-required 不得由 Esc 或 overlay 关闭')
    click('重新载入已提交快照')
    await waitFor(() => !document.querySelector('[data-trade-open-risk-dialog]'), '重试 storage reload 成功后没有关闭')
    assert(recovered === 2, 'reload-required 唯一主动作必须重试 storage reload')
    assert(useStore.getState().trades[0]?.status === 'open', 'rehydrate 后必须采用 durable open 状态')
  } finally {
    root.unmount()
    useStore.setState(previous)
  }
}

window.__riskManagementBrowserTest = run()
