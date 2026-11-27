import type { Trade } from '@/data/trades'
import { findNextPendingReviewId, isPendingReviewTrade, isTradeIncomplete } from '@/lib/tradeWorkflow'
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

export function testPendingReviewNavigationUsesRecordStatusAndCurrentListOrder() {
  const missed: Trade = { ...base, id: 'missed', status: 'missed', note: '<p>已写复盘笔记</p>' }
  const paper: Trade = { ...missed, id: 'paper', tradeKind: 'paper' }
  const finished: Trade = { ...missed, id: 'done', reviewStatus: 'focus' }
  const deleted: Trade = { ...missed, id: 'deleted', deletedAt: '2026-07-13' }
  const caseTrade: Trade = { ...missed, id: 'case', tradeKind: 'case' }
  const records = [missed, finished, paper, base, deleted, caseTrade]
  const ids = [missed.id, 'absent', deleted.id, caseTrade.id, finished.id, base.id, paper.id]
  assert(!isTradeIncomplete(missed) && isPendingReviewTrade(missed), '已有正文但尚未确认复盘的交易应可完成复盘')
  assert(!isPendingReviewTrade(base) && !isPendingReviewTrade(finished), '持仓中或已关注的记录不能进入待复盘')
  assert(findNextPendingReviewId(missed.id, ids, records) === paper.id, '跳过缺失、删除、案例、已复盘及未终结记录')
  assert(findNextPendingReviewId(paper.id, ids, records) === missed.id, '到列表末尾后按原顺序回到较早记录')
  assert(findNextPendingReviewId('outside', ids, records) === null, '不在当前序列中的记录没有下一条')
  assert(findNextPendingReviewId(missed.id, [missed.id], records) === null, '只剩当前记录时不能导航回自身')
}
