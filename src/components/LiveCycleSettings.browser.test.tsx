import { createRoot } from 'react-dom/client'
import type { RiskPolicyVersion } from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import { LiveCycleSettings } from '@/components/LiveCycleSettings'
import { useToast } from '@/lib/toast'
import { disablePersistWrites, enablePersistWrites } from '@/storage/persist'
import { getStorage } from '@/storage/provider'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __liveCycleSettingsBrowserTest?: Promise<void>
    __atlasBrowserAllowedErrors?: string[]
  }
}

window.__atlasBrowserAllowedErrors = ['Persist failed Error: test persistence failure']

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
  id: 'live-before-cycle', ref: 'TRD-OLD-LIVE-REFERENCE-WITH-A-LONG-IDENTIFIER-20260726', symbol: 'BTCUSDT-PERPETUAL-LONG-SYMBOL', side: 'long', status: 'loss',
  conviction: 'medium', strategyId: 'strategy-1', tradeKind: 'live', tags: [], mistakeTags: [],
  reviewStatus: 'unreviewed', reviewCategory: 'normal', entry: 100, exit: 98, size: 1,
  pnl: -200, rMultiple: -1, resultSource: 'pnl', openedAt: '2026-07-26', closedAt: '2026-07-26', note: '',
}

const currentLiveTrade: Trade = {
  ...oldLiveTrade,
  id: 'live-current-cycle',
  ref: 'TRD-CURRENT-LIVE-REFERENCE-WITH-A-LONG-IDENTIFIER-20260727',
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
    const dateTrigger = document.querySelector<HTMLButtonElement>('[aria-label="实盘统计起点"]')
    assert(dateTrigger, '预览缺少统计起点选择器')
    dateTrigger.click()
    await waitFor(() => Boolean(document.querySelector('[role="gridcell"][aria-label="2026-07-20"]')), '统计起点日历未打开')
    document.querySelector<HTMLButtonElement>('[role="gridcell"][aria-label="2026-07-20"]')?.click()
    await waitFor(
      () => document.body.textContent?.includes('所选起点当日没有生效的风险规则') ?? false,
      '草稿起点与现有规则无覆盖关系时缺少非阻断警告',
    )
    const confirmWithCoverageWarning = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '确认建立新周期')
    assert(confirmWithCoverageWarning && !confirmWithCoverageWarning.disabled, '规则覆盖警告必须保持非阻断')
    dateTrigger.click()
    await waitFor(() => Boolean(document.querySelector('[role="gridcell"][aria-label="2026-07-27"]')), '统计起点日历未再次打开')
    document.querySelector<HTMLButtonElement>('[role="gridcell"][aria-label="2026-07-27"]')?.click()
    await waitFor(
      () => !(document.body.textContent?.includes('所选起点当日没有生效的风险规则') ?? false),
      '恢复有覆盖的起点后警告未消失',
    )
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
    assert(document.body.textContent?.includes('调整实盘统计起点'), '已有起点时必须显示调整动作')
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
    await waitFor(
      () => [...document.querySelectorAll<HTMLButtonElement>('button')]
        .some((button) => button.textContent?.trim() === '建立实盘统计起点' && !button.disabled),
      '清除完成后建立动作仍不可用',
    )

    const storage = getStorage()
    const originalSaveSnapshot = storage.saveSnapshot.bind(storage)
    let saveAttempts = 0
    enablePersistWrites()
    storage.saveSnapshot = async () => {
      saveAttempts += 1
      throw new Error('test persistence failure')
    }
    try {
      click('建立实盘统计起点')
      await waitFor(() => Boolean(document.querySelector('[data-live-cycle-dialog]')), '失败场景预览未打开')
      click('确认建立新周期')
      await waitFor(() => saveAttempts >= 2, '失败后必须尝试持久化回滚')
      assert(useStore.getState().liveStatsStartTradingDayKey === null, '保存失败必须恢复旧统计起点')
      assert(useToast.getState().message === '统计起点保存失败，原设置已保留', '保存失败必须明确提示且不得虚报成功')
      assert(!useToast.getState().message?.includes('当前实盘周期已从'), '保存失败不得出现成功提示')
    } finally {
      storage.saveSnapshot = originalSaveSnapshot
      disablePersistWrites()
      useToast.getState().dismiss()
    }
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
