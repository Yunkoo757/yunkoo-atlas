import { createRoot } from 'react-dom/client'
import type { RiskPolicyVersion } from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import { LiveCycleSettings } from '@/components/LiveCycleSettings'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __liveCycleSettingsBrowserTest?: Promise<void>
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

function click(label: string, scope: ParentNode = document): void {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.trim() === label)
  assert(button, `找不到按钮：${label}`)
  button.click()
}

const oldLiveTrade: Trade = {
  id: 'live-before-cycle', ref: 'TRD-OLD-LIVE', symbol: 'BTCUSDT', side: 'long', status: 'loss',
  conviction: 'medium', strategyId: 'strategy-1', tradeKind: 'live', tags: [], mistakeTags: [],
  reviewStatus: 'unreviewed', reviewCategory: 'normal', entry: 100, exit: 98, size: 1,
  pnl: -200, rMultiple: -1, resultSource: 'pnl', openedAt: '2026-07-26', closedAt: '2026-07-26', note: '',
}

const currentLiveTrade: Trade = {
  ...oldLiveTrade,
  id: 'live-current-cycle',
  ref: 'TRD-CURRENT-LIVE',
  openedAt: '2026-07-27',
  closedAt: '2026-07-27',
}

const policyEffectiveOn20260727: RiskPolicyVersion = {
  id: 'policy-20260727', sourceWeekStart: '2026-07-27', effectiveTradingDay: '2026-07-27',
  capitalBase: 100_000, riskPercent: 1, riskAmount: 1_000, dailyLossLimitR: 2,
  weeklyLossLimitR: 5, monthlyLossLimitRDefault: 10, disciplineText: '触线后暂停开仓。',
  confirmedAt: '2026-07-27T08:00:00.000Z',
}

async function run(): Promise<void> {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(element)
  try {
    useStore.setState((state) => ({
      trades: [oldLiveTrade, currentLiveTrade],
      riskPolicyVersions: [policyEffectiveOn20260727],
      liveStatsStartTradingDayKey: null,
      display: { ...state.display, tradingDayStartHour: 0 },
    }))
    root.render(<LiveCycleSettings variant="settings" currentTradingDayKey="2026-07-28" />)

    await waitFor(
      () => [...document.querySelectorAll<HTMLButtonElement>('button')]
        .some((button) => button.textContent?.trim() === '建立实盘统计起点'),
      '建立按钮未出现',
    )
    click('建立实盘统计起点')
    await waitFor(
      () => document.body.textContent?.includes('规则前实盘 1 笔') ?? false,
      '预览未显示规则前数量',
    )
    assert(document.body.textContent?.includes('当前周期 1 笔'), '预览必须显示当前周期数量')
    click('确认建立新周期')
    await waitFor(
      () => useStore.getState().liveStatsStartTradingDayKey === '2026-07-27',
      '起点未保存',
    )
    await waitFor(
      () => !document.querySelector('[data-live-cycle-dialog]'),
      '保存完成后预览未关闭',
    )
    assert(useStore.getState().trades.every((trade) => trade.tradeKind === 'live'), '设置不得改写交易类型')
    click('清除统计起点')
    await waitFor(
      () => [...document.querySelectorAll<HTMLButtonElement>('button')]
        .some((button) => button.textContent?.trim() === '确认清除'),
      '清除确认未出现',
    )
    click('确认清除')
    await waitFor(
      () => useStore.getState().liveStatsStartTradingDayKey === null,
      '清除必须恢复全历史口径',
    )
  } finally {
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      riskPolicyVersions: previous.riskPolicyVersions,
      liveStatsStartTradingDayKey: previous.liveStatsStartTradingDayKey,
      display: previous.display,
    })
  }
}

function renderVisualDialog(): Promise<void> {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  useStore.setState((state) => ({
    trades: [oldLiveTrade, currentLiveTrade],
    riskPolicyVersions: [policyEffectiveOn20260727],
    liveStatsStartTradingDayKey: null,
    display: { ...state.display, tradingDayStartHour: 0 },
  }))
  createRoot(element).render(<LiveCycleSettings variant="settings" currentTradingDayKey="2026-07-28" />)
  return Promise.resolve()
}

window.__liveCycleSettingsBrowserTest = new URLSearchParams(window.location.search).get('visual') === 'dialog'
  ? renderVisualDialog()
  : run()
