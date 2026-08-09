import type { Trade } from '@/data/trades'
import { buildTodayClosedMetrics, getTodayWorkflowBuckets } from '@/lib/tradeWorkflow'
import { useStore } from '@/store/useStore'

const base: Trade = {
  id: 'workflow-1',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'open',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: null,
  stopLoss: 95,
  size: 1,
  pnl: null,
  rMultiple: null,
  openedAt: '2026-07-13',
  closedAt: null,
  note: '',
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testTodayWorkflowSeparatesActionQueuesWithoutDuplicates(): void {
  const active = { ...base, id: 'active' }
  const resultPending = {
    ...base,
    id: 'result-pending',
    status: 'win',
    exit: 110,
    closedAt: '2026-07-13',
  } as Trade
  const reviewPending = {
    ...resultPending,
    id: 'review-pending',
    pnl: 10,
    rMultiple: 2,
  }
  const reviewedToday = {
    ...reviewPending,
    id: 'reviewed-today',
    reviewStatus: 'reviewed',
  } as Trade

  const buckets = getTodayWorkflowBuckets(
    [active, resultPending, reviewPending, reviewedToday],
    '2026-07-13',
  )

  assert(buckets.active.map((trade) => trade.id).join(',') === 'active', 'active queue is distinct')
  assert(
    buckets.resultPending.map((trade) => trade.id).join(',') === 'result-pending',
    'missing result queue is distinct',
  )
  assert(
    buckets.reviewPending.map((trade) => trade.id).join(',') === 'review-pending',
    'verified unreviewed queue is distinct',
  )
  assert(
    buckets.completedToday.map((trade) => trade.id).join(',') === 'reviewed-today',
    'reviewed records remain visible in today history without duplicating action queues',
  )
  assert(buckets.actionCount === 3, 'action count should represent unfinished work')
}

export function testTodayWorkflowKeepsHistoricalWorkVisibleButLabelsItsScope(): void {
  const historicalReview = {
    ...base,
    id: 'historical-review',
    status: 'win',
    exit: 110,
    pnl: 10,
    openedAt: '2026-07-11',
    closedAt: '2026-07-12',
  } as Trade
  const reviewedYesterday = {
    ...historicalReview,
    id: 'reviewed-yesterday',
    reviewStatus: 'reviewed',
  } as Trade
  const reviewedToday = {
    ...reviewedYesterday,
    id: 'reviewed-today',
    reviewedAt: '2026-07-13T09:30:00.000Z',
  } as Trade

  const buckets = getTodayWorkflowBuckets(
    [historicalReview, reviewedYesterday, reviewedToday],
    '2026-07-13',
  )

  assert(
    buckets.reviewPending.map((trade) => trade.id).join(',') === 'historical-review',
    'historical unfinished work should remain actionable',
  )
  assert(buckets.historicalActionCount === 1, 'historical work should be counted separately')
  assert(
    buckets.completedToday.map((trade) => trade.id).join(',') === 'reviewed-today',
    'completed history should contain only records completed today',
  )
}

export function testHistoricalTradeCompletedReviewTodayAppearsInCompletedQueue(): void {
  const historicalReviewedToday = {
    ...base,
    id: 'historical-reviewed-today',
    status: 'win',
    exit: 110,
    pnl: 10,
    closedAt: '2026-07-12',
    reviewStatus: 'reviewed',
    reviewedAt: '2026-07-13T08:00:00.000Z',
  } as Trade

  const buckets = getTodayWorkflowBuckets([historicalReviewedToday], '2026-07-13')

  assert(
    buckets.completedToday.map((trade) => trade.id).join(',') === 'historical-reviewed-today',
    'finishing a historical review today should remain visible in today completion history',
  )
}

export function testFocusReviewIsCompletedInsteadOfReturningToPendingQueue(): void {
  const focused = {
    ...base,
    id: 'focused-review',
    status: 'win',
    exit: 110,
    pnl: 10,
    closedAt: '2026-07-12',
    reviewStatus: 'focus',
    reviewedAt: '2026-07-13T08:00:00.000Z',
  } as Trade

  const buckets = getTodayWorkflowBuckets([focused], '2026-07-13')

  assert(buckets.reviewPending.length === 0, '重点关注表示已完成复盘，不得再次进入待复盘队列')
  assert(buckets.completedToday[0]?.id === focused.id, '当天标记重点关注的记录应进入今日完成历史')
}

export function testReviewCompletionRecordsAndClearsItsOwnTimestamp(): void {
  const original = useStore.getState()
  const trade = {
    ...base,
    id: 'review-timestamp',
    status: 'win',
    exit: 110,
    pnl: 10,
    closedAt: '2026-07-12',
  } as Trade
  useStore.setState({ trades: [trade], undoStack: [], redoStack: [] })

  try {
    useStore.getState().updateTradeData(trade.id, { reviewStatus: 'reviewed' })
    const reviewed = useStore.getState().trades[0]!
    assert(Boolean(reviewed.reviewedAt), 'completing a review should record its completion time')

    useStore.getState().updateTradeData(trade.id, { reviewStatus: 'unreviewed' })
    assert(
      useStore.getState().trades[0]?.reviewedAt === null,
      'reopening a review should clear the old completion time',
    )
  } finally {
    useStore.setState({
      trades: original.trades,
      undoStack: original.undoStack,
      redoStack: original.redoStack,
    })
  }
}

export function testFocusReviewUsesTheSameCompletionTimestampAndReopenRules(): void {
  const original = useStore.getState()
  const trade = {
    ...base,
    id: 'focus-review-timestamp',
    status: 'win',
    exit: 110,
    pnl: 10,
    closedAt: '2026-07-12',
  } as Trade
  useStore.setState({ trades: [trade], undoStack: [], redoStack: [] })

  try {
    useStore.getState().updateTradeData(trade.id, { reviewStatus: 'focus' })
    const focused = useStore.getState().trades[0]!
    assert(Boolean(focused.reviewedAt), '重点关注也是一次已完成复盘，必须记录完成时间')

    useStore.getState().updateTradeData(trade.id, { pnl: 20 })
    const reopened = useStore.getState().trades[0]!
    assert(reopened.reviewStatus === 'unreviewed', '修改重点关注交易的结果后必须重新进入待复盘')
    assert(reopened.reviewedAt === null, '重新进入待复盘时必须清除旧完成时间')
  } finally {
    useStore.setState({
      trades: original.trades,
      undoStack: original.undoStack,
      redoStack: original.redoStack,
    })
  }
}

export function testTodayWorkflowDefersFuturePlans(): void {
  const futurePlan = { ...base, id: 'future-plan', status: 'planned', openedAt: '2026-07-14' } as Trade
  const currentOpen = { ...base, id: 'current-open', status: 'open', openedAt: '2026-07-14' } as Trade

  const buckets = getTodayWorkflowBuckets([futurePlan, currentOpen], '2026-07-13')

  assert(buckets.active.map((trade) => trade.id).join(',') === 'current-open', 'future plans wait until due')
  assert(buckets.actionCount === 1, 'deferred plans must not inflate today action count')
}

export function testTodayWorkflowExcludesCasesPaperAndDeletedTrades(): void {
  const hidden = [
    { ...base, id: 'case', tradeKind: 'case' },
    { ...base, id: 'paper', tradeKind: 'paper' },
    { ...base, id: 'deleted', deletedAt: '2026-07-13T10:00:00.000Z' },
  ] as Trade[]
  const buckets = getTodayWorkflowBuckets(hidden, '2026-07-13')

  assert(buckets.actionCount === 0, 'non-live and deleted records must not become today actions')
  assert(buckets.completedToday.length === 0, 'non-live and deleted records must remain hidden')
}

export function testTodayClosedMetricsUsesCloseDateLiveOnly(): void {
  const today = '2026-07-21'
  const winToday = {
    ...base,
    id: 'win-today',
    status: 'win',
    openedAt: '2026-07-20',
    closedAt: today,
    exit: 110,
    pnl: 100,
    cashCurrency: 'USD',
    rMultiple: 2,
  } as Trade
  const openToday = { ...base, id: 'open-today', status: 'open', openedAt: today } as Trade
  const closedYesterday = {
    ...winToday,
    id: 'closed-yesterday',
    closedAt: '2026-07-20',
  } as Trade
  const paperWin = { ...winToday, id: 'paper-win', tradeKind: 'paper' } as Trade
  const missingPnl = {
    ...winToday,
    id: 'missing-pnl',
    pnl: null,
    rMultiple: null,
  } as Trade

  const metrics = buildTodayClosedMetrics(
    [winToday, openToday, closedYesterday, paperWin, missingPnl],
    today,
  )

  assert(metrics.closedCount === 1, 'today metrics count only complete live closed-on-today results')
  assert(metrics.winRate === 100, 'evaluated win rate ignores open and non-today closes')
  assert(metrics.pnlCount === 1, 'unverified pnl must not inflate pnlCount')
  assert(metrics.totalPnl === 100, 'total pnl sums verified amounts only')
}

export function testTodayClosedMetricsPrefersFrozenTradingDayAndHonorsDayBoundary(): void {
  const beforeBoundary = new Date(2026, 6, 21, 4, 0, 0).toISOString()
  const frozenDay = {
    ...base,
    id: 'frozen-day',
    status: 'win',
    exit: 110,
    pnl: 100,
    rMultiple: 2,
    closedAt: new Date(2026, 6, 21, 9, 0, 0).toISOString(),
    closedTradingDayKey: '2026-07-20',
  } as Trade
  const earlyClose = {
    ...frozenDay,
    id: 'early-close',
    closedAt: beforeBoundary,
    closedTradingDayKey: undefined,
  } as Trade

  const metrics = buildTodayClosedMetrics([frozenDay, earlyClose], '2026-07-20', 6)

  assert(metrics.closedCount === 2,
    'Today 战绩应优先使用冻结交易日，并把起始小时前的平仓归入前一交易日')
}

export function testTodayClosedMetricsUsesUsdOnlyWithExplicitLegacyAssumption(): void {
  const today = '2026-07-21'
  const usd = { ...base, id: 'usd', status: 'win', closedAt: today, exit: 2, pnl: 100, rMultiple: 1, cashCurrency: 'USD' } as Trade
  const cny = { ...usd, id: 'cny', pnl: 700, cashCurrency: 'CNY' }
  const legacy = { ...usd, id: 'legacy', pnl: 50 }
  delete legacy.cashCurrency
  const unknown = { ...usd, id: 'unknown', pnl: 80, cashCurrency: null }
  const conflict = { ...usd, id: 'conflict', status: 'win', pnl: -10, rMultiple: -1, resultSource: 'imported', cashCurrency: 'USD' } as Trade

  const withoutAssumption = buildTodayClosedMetrics([usd, cny, legacy, unknown, conflict], today)
  assert(withoutAssumption.pnlCount === 1 && withoutAssumption.totalPnl === 100, '今日 USD 总计必须排除 CNY 与未知币种')
  const withAssumption = buildTodayClosedMetrics(
    [usd, cny, legacy, unknown, conflict],
    today,
    0,
    { currency: 'USD', confirmedAt: '2026-08-09T04:00:00.000Z' },
  )
  assert(withAssumption.pnlCount === 2 && withAssumption.totalPnl === 150, '今日总计的 legacy 假设只能作用于缺字段旧记录')
}

export function testTodayClosedMetricsRejectsUnreliableFutureAndConflictingFacts(): void {
  const today = '2026-08-09'
  const valid = {
    ...base,
    id: 'today-valid',
    status: 'win',
    openedAt: today,
    closedAt: '2026-08-09T06:00:00+08:00',
    exit: 110,
    pnl: 100,
    cashCurrency: 'USD',
    rMultiple: 2,
    resultSource: 'imported',
  } as Trade
  const beforeBoundary = { ...valid, id: 'before-boundary', closedAt: '2026-08-09T05:59:00+08:00' }
  const missing = { ...valid, id: 'missing', closedAt: null }
  const invalid = { ...valid, id: 'invalid', closedAt: '2026-02-30T12:00:00+08:00' }
  const future = { ...valid, id: 'future', closedTradingDayKey: '2026-08-10' }
  const conflict = { ...valid, id: 'conflict', pnl: -50, rMultiple: 1 }

  const metrics = buildTodayClosedMetrics(
    [valid, beforeBoundary, missing, invalid, future, conflict],
    today,
    6,
  )

  assert(metrics.closedCount === 1, '今日战绩只能消费选择器的完整可靠结果 ID')
  assert(metrics.winRate === 100, '结果冲突不得污染今日胜率')
  assert(metrics.pnlCount === 1 && metrics.totalPnl === 100, '今日 USD 总计只能消费 pnlIds')
  assert(metrics.rCount === 1 && metrics.averageR === 2, '今日 R 汇总只能消费 rIds')
}

export function testTodayCompletedReviewHonorsTradingDayBoundary(): void {
  const reviewedBeforeBoundary = {
    ...base,
    id: 'reviewed-before-boundary',
    status: 'win',
    exit: 110,
    pnl: 10,
    closedAt: '2026-07-20',
    reviewStatus: 'reviewed',
    reviewedAt: new Date(2026, 6, 21, 4, 0, 0).toISOString(),
  } as Trade

  const previousDay = getTodayWorkflowBuckets([reviewedBeforeBoundary], '2026-07-20', 6)
  const calendarDay = getTodayWorkflowBuckets([reviewedBeforeBoundary], '2026-07-21', 6)

  assert(previousDay.completedToday[0]?.id === reviewedBeforeBoundary.id,
    '起始小时前完成的复盘应归入前一交易日')
  assert(calendarDay.completedToday.length === 0,
    '起始小时前完成的复盘不得出现在新交易日完成历史中')
}


