import type { Trade } from '@/data/trades'
import { getTodayWorkflowBuckets } from '@/lib/tradeWorkflow'

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
    buckets.todayRecords.map((trade) => trade.id).join(',') === 'reviewed-today',
    'reviewed records remain visible in today history without duplicating action queues',
  )
  assert(buckets.actionCount === 3, 'action count should represent unfinished work')
}

export function testTodayWorkflowExcludesCasesPaperAndDeletedTrades(): void {
  const hidden = [
    { ...base, id: 'case', tradeKind: 'case' },
    { ...base, id: 'paper', tradeKind: 'paper' },
    { ...base, id: 'deleted', deletedAt: '2026-07-13T10:00:00.000Z' },
  ] as Trade[]
  const buckets = getTodayWorkflowBuckets(hidden, '2026-07-13')

  assert(buckets.actionCount === 0, 'non-live and deleted records must not become today actions')
  assert(buckets.todayRecords.length === 0, 'non-live and deleted records must remain hidden')
}

