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

  assert(metrics.closedCount === 2, 'today metrics count only live closed-on-today trades')
  assert(metrics.winRate === 100, 'evaluated win rate ignores open and non-today closes')
  assert(metrics.pnlCount === 1, 'unverified pnl must not inflate pnlCount')
  assert(metrics.totalPnl === 100, 'total pnl sums verified amounts only')
}


