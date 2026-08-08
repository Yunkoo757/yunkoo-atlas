import type { Trade } from '@/data/trades'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import { buildLivePerformanceRestartPreview, useStore } from '@/store/useStore'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const first: LivePerformanceCycle = {
  id: 'cycle-store-first',
  name: '首个周期',
  startTradingDayKey: '2026-08-01',
  createdAt: '2026-08-01T00:00:00.000Z',
}

function closedLiveTrade(id: string, day: string, patch: Partial<Trade> = {}): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 10,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: day,
    closedAt: day,
    closedTradingDayKey: day,
    note: '',
    ...patch,
  }
}

export function testRestartPreviewCountsArchiveCurrentActivePendingAndCases(): void {
  const trades: Trade[] = [
    closedLiveTrade('archived-valid', '2026-08-02'),
    closedLiveTrade('current-on-start', '2026-08-05'),
    closedLiveTrade('pending-close-day', '2026-08-04', { closedTradingDayKey: 'invalid' }),
    { ...closedLiveTrade('active-open', '2026-08-04'), status: 'open' as const, exit: null, pnl: null, rMultiple: null, resultSource: undefined, closedAt: null },
    { ...closedLiveTrade('pending-planned', '2026-08-04'), status: 'planned' as const, exit: null, pnl: null, rMultiple: null, resultSource: undefined, closedAt: null },
    { ...closedLiveTrade('case-for-archive', '2026-08-02'), tradeKind: 'case', sourceTradeId: 'archived-valid' },
  ]

  const preview = buildLivePerformanceRestartPreview(trades, [first], '2026-08-05', 0)

  assert(preview.startTradingDayKey === '2026-08-05', '预览必须回显所选业务日起点')
  assert(preview.archivedClosedCount === 1, '起点前的有效已平仓实盘必须计入归档')
  assert(preview.currentClosedCount === 1, '起点当天已平仓的有效实盘必须保留在当前')
  assert(preview.activeCount === 1, '持仓中实盘必须继续留在当前')
  assert(preview.pendingCount === 1, '计划中实盘必须继续留在当前')
  assert(preview.associatedCaseCount === 1, '来源于将归档实盘的案例必须被计数')
}

export function testLivePerformanceCycleStoreActionsDoNotModifyTradesOrReviews(): void {
  const previous = useStore.getState()
  const beforeTrades = JSON.stringify(previous.trades)
  const beforeReviews = JSON.stringify(previous.weeklyReviews)
  try {
    useStore.setState({
      livePerformanceCycles: [],
      liveStatsStartTradingDayKey: '2026-07-01',
    })

    useStore.getState().createLivePerformanceCycle(first, '2026-08-05')
    assert(useStore.getState().livePerformanceCycles[0]?.id === first.id, '创建必须写入第一个周期')

    useStore.getState().renameLivePerformanceCycle(first.id, '新名称')
    assert(useStore.getState().livePerformanceCycles[0]?.name === '新名称', '重命名必须更新周期名称')

    useStore.getState().undoLatestLivePerformanceCycle()
    assert(useStore.getState().livePerformanceCycles.length === 0, '撤销必须移除最新周期')
    assert(JSON.stringify(useStore.getState().trades) === beforeTrades, '周期操作不得修改交易')
    assert(JSON.stringify(useStore.getState().weeklyReviews) === beforeReviews, '周期操作不得修改周复盘')
    assert(useStore.getState().liveStatsStartTradingDayKey === '2026-07-01', '周期操作不得修改风险起点')
  } finally {
    useStore.setState(previous)
  }
}

export function testReplaceLivePerformanceCyclesValidatesAndClonesInput(): void {
  const previous = useStore.getState()
  try {
    const cycles = [{ ...first }]
    useStore.getState().replaceLivePerformanceCycles(cycles)
    cycles[0]!.name = '外部变更'
    assert(useStore.getState().livePerformanceCycles[0]?.name === first.name, '替换必须克隆输入周期')
  } finally {
    useStore.setState(previous)
  }
}
