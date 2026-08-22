import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { MonthlyRiskLimit, RiskPolicyDraft, RiskPolicyVersion } from '@/data/riskManagement'
import { weekStartFor } from '@/data/weeklyReviews'
import type { Trade } from '@/data/trades'
import { parseLocalDate } from '@/lib/periods'
import { toLocalDateKey } from '@/lib/tradeWorkflow'
import { useStore } from '@/store/useStore'
import { TodayWorkspace } from '@/views/TodayWorkspace'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __todayWorkspacePrimaryActionTest?: Promise<void>
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

function CurrentPath() {
  const location = useLocation()
  return <output data-current-path>{location.pathname}</output>
}

function closedTrade(id: string, ref: string, patch: Partial<Trade>): Trade {
  const today = toLocalDateKey()
  return {
    id,
    ref,
    symbol: 'EURUSD',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'uncategorized',
    tradeKind: 'live',
    liveStageId: useStore.getState().currentLiveStageId,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 1.1,
    exit: null,
    stopLoss: 1.09,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: today,
    closedAt: today,
    closedTradingDayKey: today,
    note: '',
    ...patch,
  }
}

const today = toLocalDateKey()
const weekStart = weekStartFor(parseLocalDate(today))
const confirmedAt = `${today}T00:00:00.000Z`
const riskDraft: RiskPolicyDraft = {
  capitalBase: 100_000,
  riskPercent: 1,
  riskAmount: 1_000,
  dailyLossLimitR: 2,
  weeklyLossLimitR: 5,
  monthlyLossLimitRDefault: 10,
  disciplineText: '触线后停止开仓。',
}
const riskPolicy: RiskPolicyVersion = {
  id: 'today-primary-risk-policy',
  liveStageId: useStore.getState().currentLiveStageId,
  sourceWeekStart: weekStart,
  effectiveTradingDay: today,
  capitalBase: 100_000,
  riskPercent: 1,
  riskAmount: 1_000,
  dailyLossLimitR: 2,
  weeklyLossLimitR: 5,
  monthlyLossLimitRDefault: 10,
  disciplineText: riskDraft.disciplineText,
  confirmedAt,
}
const monthlyLimit: MonthlyRiskLimit = {
  id: `monthly-risk-limit:${today.slice(0, 7)}`,
  liveStageId: useStore.getState().currentLiveStageId,
  monthKey: today.slice(0, 7),
  limitR: 10,
  sourcePolicyVersionId: riskPolicy.id,
  lockedAt: confirmedAt,
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  const resultPending = closedTrade('result-pending', 'TRD-RESULT', {})
  const reviewPending = closedTrade('review-pending', 'TRD-REVIEW', {
    status: 'win',
    exit: 1.12,
    pnl: 100,
    rMultiple: 1,
    resultSource: 'imported',
  })

  try {
    useStore.setState((state) => ({
      liveStages: state.liveStages.map((stage) => stage.id === state.currentLiveStageId
        ? { ...stage, startsOn: today }
        : stage),
      trades: [reviewPending, resultPending],
      riskPolicyVersions: [riskPolicy],
      monthlyRiskLimits: [monthlyLimit],
      weeklyRiskPreparations: [{
        id: `weekly-risk-preparation:${weekStart}`,
        liveStageId: state.currentLiveStageId,
        weekStart,
        draft: riskDraft,
        reviewedAt: confirmedAt,
        confirmedPolicyVersionId: riskPolicy.id,
        createdAt: confirmedAt,
        updatedAt: confirmedAt,
      }],
      display: { ...state.display, tradingDayStartHour: 0 },
    }))

    root.render(
      <MemoryRouter initialEntries={['/today']}>
        <CurrentPath />
        <Routes>
          <Route path="/today" element={<TodayWorkspace />} />
          <Route path="/trade/:ref" element={<div data-detail-placeholder />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => Boolean(document.querySelector('[data-today-primary-action]')),
      '今日工作台没有渲染唯一主动作',
    )
    const action = document.querySelector<HTMLButtonElement>('[data-today-primary-action]')
    assert(action, '缺少今日工作台主动作')
    assert(action.textContent?.trim() === '补齐交易结果', '待补结果必须成为最高优先级动作')
    const riskStatus = document.querySelector<HTMLElement>('[data-risk-status]')
    const riskPeriods = riskStatus?.querySelector<HTMLElement>('.risk-status-periods')
    assert(riskStatus && riskPeriods, '今日工作台缺少风险摘要')
    assert(riskStatus.classList.contains('is-workbench'), '今日工作台必须使用专用风险摘要密度')
    assert(getComputedStyle(riskPeriods).display === 'none', '未超限时风险详情必须收敛为单行摘要')
    await waitFor(
      () => Boolean(riskStatus.querySelector('.risk-status-period.is-partial')),
      '普通部分覆盖风险状态没有渲染',
    )
    const partialRiskAction = [...document.querySelectorAll<HTMLElement>('[data-today-risk-action]')]
      .find((item) => getComputedStyle(item).display !== 'none')
    assert(partialRiskAction?.textContent?.trim() === '处理风险状态', '普通部分覆盖必须让风险恢复动作成为主动作')
    assert(getComputedStyle(action).display === 'none', '普通部分覆盖时交易队列动作必须停止争夺主视觉')

    useStore.setState({ riskPolicyVersions: [], monthlyRiskLimits: [] })
    await waitFor(
      () => [...document.querySelectorAll<HTMLElement>('[data-today-risk-action]')]
        .some((item) => getComputedStyle(item).display !== 'none'),
      '风险未配置时没有接管主动作',
    )
    const riskAction = [...document.querySelectorAll<HTMLElement>('[data-today-risk-action]')]
      .find((item) => getComputedStyle(item).display !== 'none')
    assert(riskAction?.textContent?.trim() === '处理风险状态', '风险恢复动作必须使用明确文案')
    assert(getComputedStyle(action).display === 'none', '风险异常时交易队列动作必须停止争夺主视觉')
    assert(getComputedStyle(riskPeriods).display === 'none', '非超限风险仍应保持单行摘要')

    const triggeredLoss = closedTrade('triggered-loss', 'TRD-LOSS', {
      status: 'loss',
      exit: 1.08,
      pnl: -2_000,
      rMultiple: -2,
      resultSource: 'imported',
      reviewStatus: 'reviewed',
      reviewedAt: confirmedAt,
    })
    useStore.setState({
      trades: [triggeredLoss],
      riskPolicyVersions: [riskPolicy],
      monthlyRiskLimits: [monthlyLimit],
    })
    await waitFor(
      () => Boolean(riskStatus.querySelector('.risk-status-period.is-triggered')),
      '超限风险状态没有渲染',
    )
    assert(getComputedStyle(riskPeriods).display === 'grid', '风险超限时必须展开三个周期详情')

    const activeTrade = closedTrade('active-trade', 'TRD-ACTIVE', {
      status: 'open',
      exit: null,
      pnl: null,
      rMultiple: null,
      resultSource: undefined,
      closedAt: null,
      closedTradingDayKey: undefined,
    })
    useStore.setState({
      trades: [activeTrade],
      riskPolicyVersions: [riskPolicy],
      monthlyRiskLimits: [monthlyLimit],
    })
    await waitFor(
      () => {
        const currentAction = document.querySelector<HTMLButtonElement>('[data-today-primary-action]')
        return currentAction?.textContent?.trim() === '继续当前交易' &&
          getComputedStyle(currentAction).display !== 'none'
      },
      '风险恢复后交易主动作没有恢复',
    )
    const restoredAction = document.querySelector<HTMLButtonElement>('[data-today-primary-action]')
    assert(restoredAction && getComputedStyle(restoredAction).display !== 'none', '恢复后的交易主动作不可见')
    restoredAction.click()
    await waitFor(
      () => document.querySelector('[data-current-path]')?.textContent === '/trade/TRD-ACTIVE',
      '主动作没有直接打开第一笔待补结果交易',
    )
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__todayWorkspacePrimaryActionTest = run()
