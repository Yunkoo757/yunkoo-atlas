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
      trades: [trade('target', 'planned'), trade('unknown-loss', 'loss', { unknown: true })],
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
      pendingTradeOpenRequest: null,
      undoStack: [],
      redoStack: [],
      display: { ...state.display, tradingDayStartHour: 0 },
    }))
    root.render(<Harness />)

    await waitFor(() => Boolean(document.querySelector('[data-risk-preparation]')), '未复核准备卡必须常驻')
    const preparation = document.querySelector<HTMLElement>('[data-risk-preparation]')
    const budget = document.querySelector<HTMLElement>('[data-risk-budget]')
    const stats = document.querySelector<HTMLElement>('.today-stats')
    assert(preparation && budget && stats, '今日工作台缺少准备卡、预算卡或今日战绩')
    assert(
      preparation.compareDocumentPosition(budget) & Node.DOCUMENT_POSITION_FOLLOWING,
      '准备卡必须位于预算卡之前',
    )
    assert(
      budget.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING,
      '预算卡必须位于今日战绩之前',
    )

    const meter = document.querySelector<HTMLElement>('[role="progressbar"]')
    assert(meter?.getAttribute('aria-label') === '今日止损预算', '进度必须有可访问名称')
    assert(meter.textContent?.includes('已用'), '进度必须同时提供文字数值')
    assert(!meter.textContent?.includes('剩余'), 'unknown 不得显示安全剩余额度')
    assert(budget.textContent?.includes('无法确认当前是否触线'), 'unknown 必须给出明确行动说明')
    if (new URLSearchParams(location.search).get('visual') === 'cards') {
      await new Promise<void>(() => {})
    }

    click('确认本周规则', preparation)
    await waitFor(
      () => document.querySelector('[data-risk-preparation]')?.getAttribute('data-reviewed') === 'true',
      '确认后准备卡没有折叠为摘要',
    )
    assert(!document.querySelector('[data-risk-preparation] input'), '确认后不应继续展开编辑字段')

    const temporaryOpener = document.getElementById('temporary-risk-opener') as HTMLButtonElement
    temporaryOpener.focus()
    temporaryOpener.click()
    await waitFor(() => Boolean(document.querySelector('[data-trade-open-risk-dialog]')), 'unknown 开仓没有打开全局确认框')
    if (new URLSearchParams(location.search).get('visual') === 'dialog') {
      await new Promise<void>(() => {})
    }
    assert(!document.getElementById('temporary-risk-opener'), '测试 opener 应已卸载')
    const reason = document.querySelector<HTMLTextAreaElement>('[aria-label="继续开仓原因"]')
    assert(reason, '确认框缺少原因输入')

    click('确认继续开仓')
    await waitFor(() => Boolean(document.querySelector('[role="alert"]')), '空原因没有显示校验错误')
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
    useStore.setState({
      confirmTradeOpen: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('模拟存储失败')
        useStore.setState((state) => ({
          trades: state.trades.map((item) => item.id === 'target' ? { ...item, status: 'open' as const } : item),
          pendingTradeOpenRequest: null,
        }))
        return { kind: 'committed' as const }
      },
    })
    await frame()
    click('确认继续开仓')
    await waitFor(() => document.body.textContent?.includes('模拟存储失败') ?? false, '提交失败没有显示原因')
    assert(retryReason.value === '复核后接受本次偏离', '提交失败后没有保留用户原因')
    click('重试确认')
    await waitFor(() => !document.querySelector('[data-trade-open-risk-dialog]'), '失败后无法重试成功')
    assert(attempts === 2, '重试没有复用同一提交动作')

    const durableTarget = trade('target-durable', 'planned')
    useStore.setState((state) => ({
      trades: [durableTarget, trade('durable-unknown-loss', 'loss', { unknown: true })],
      pendingTradeOpenRequest: null,
      riskOverrideEvents: [],
      undoStack: [],
      redoStack: [],
      display: { ...state.display, tradingDayStartHour: 0 },
    }))
    useStore.getState().requestTradeOpen(durableTarget.id)
    await waitFor(() => Boolean(document.querySelector('[data-trade-open-risk-dialog]')), 'durable 恢复场景没有打开确认框')
    let recovered = 0
    useStore.setState({
      confirmTradeOpen: async () => {
        throw new RiskGatePublishAfterCommitError(createEmptyPersistedSnapshot(), new Error('publish failed'))
      },
      rehydrateRiskGateFromStorage: async () => {
        recovered += 1
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
    await waitFor(() => !document.querySelector('[data-trade-open-risk-dialog]'), 'durable 成功后 publish 失败没有关闭或恢复')
    assert(recovered === 1, 'publish-after-commit 必须从 storage 重新 hydrate')
    assert(useStore.getState().trades[0]?.status === 'open', 'rehydrate 后必须采用 durable open 状态')
  } finally {
    root.unmount()
    useStore.setState(previous)
  }
}

window.__riskManagementBrowserTest = run()
