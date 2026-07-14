import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'

const openTrade: Trade = {
  id: 'close-store-1',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'open',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: null,
  stopLoss: 95,
  size: 1,
  pnl: null,
  rMultiple: null,
  openedAt: '2026-07-01',
  closedAt: null,
  note: '',
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testCompletingTradeCloseIsOneAtomicUndoableMutation(): void {
  const previous = useStore.getState()
  try {
    useStore.setState({
      trades: [openTrade],
      undoStack: [],
      redoStack: [],
      closeTradeRequest: { tradeId: openTrade.id },
    })

    useStore.getState().completeTradeClose(openTrade.id, 'win', {
      exit: 110,
      pnl: 100,
      rMultiple: null,
      resultSource: 'pnl',
      closedAt: '2026-07-14',
      reviewStatus: 'unreviewed',
    })

    let state = useStore.getState()
    const closed = state.trades[0]!
    assert(closed.status === 'win' && closed.pnl === 100, 'close result and status should save together')
    assert(state.closeTradeRequest === null, 'the close request should finish in the same mutation')
    assert(state.undoStack.length === 1, 'closing should add exactly one undo step')

    state.undo()
    const restored = useStore.getState().trades[0]!
    assert(restored.status === 'open', 'one undo should restore the open status')
    assert(restored.exit === null && restored.pnl === null, 'one undo should remove every close result field')
  } finally {
    useStore.setState({
      trades: previous.trades,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
      closeTradeRequest: previous.closeTradeRequest,
    })
  }
}

export function testExistingPriceTradeUpsertRecalculatesExecutionOutcome(): void {
  const previous = useStore.getState()
  const closedPriceTrade: Trade = {
    ...openTrade,
    status: 'win',
    side: 'long',
    entry: 100,
    exit: 110,
    stopLoss: 95,
    initialStopLoss: 95,
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
    closedAt: '2026-07-14',
  }
  try {
    useStore.setState({ trades: [closedPriceTrade] })

    useStore.getState().upsertTrade({ ...closedPriceTrade, side: 'short' })

    const updated = useStore.getState().trades[0]!
    assert(updated.side === 'short', 'the edited execution side should be saved')
    assert(updated.rMultiple === -2, 'price-authority R must be recalculated from execution fields')
    assert(updated.status === 'loss', 'the closed outcome must follow the recalculated price direction')
    assert(updated.reviewStatus === 'unreviewed', 'an existing upsert result change must reopen review')
    assert(updated.reviewedAt === null, 'an existing upsert result change must clear review time')
  } finally {
    useStore.setState({ trades: previous.trades })
  }
}

export function testExistingManualResultUpsertDoesNotRewriteItsAuthority(): void {
  const previous = useStore.getState()
  const cashTrade: Trade = {
    ...openTrade,
    status: 'win',
    pnl: 500,
    rMultiple: null,
    resultSource: 'pnl',
    closedAt: '2026-07-14',
  }
  const rTrade: Trade = {
    ...cashTrade,
    id: 'manual-r-1',
    ref: 'TRD-2',
    status: 'loss',
    pnl: null,
    rMultiple: -1.5,
    resultSource: 'r',
  }
  try {
    useStore.setState({ trades: [cashTrade, rTrade] })

    useStore.getState().upsertTrade({ ...cashTrade, side: 'short', exit: 90 })
    useStore.getState().upsertTrade({ ...rTrade, side: 'short', exit: 90 })

    const [cashUpdated, rUpdated] = useStore.getState().trades
    assert(cashUpdated?.pnl === 500, 'execution edits must preserve authoritative cash PnL')
    assert(cashUpdated?.status === 'win', 'execution edits must preserve the manual cash outcome')
    assert(cashUpdated?.resultSource === 'pnl', 'cash must remain the result authority')
    assert(rUpdated?.rMultiple === -1.5, 'execution edits must preserve authoritative manual R')
    assert(rUpdated?.status === 'loss', 'execution edits must preserve the manual R outcome')
    assert(rUpdated?.resultSource === 'r', 'R must remain the result authority')
  } finally {
    useStore.setState({ trades: previous.trades })
  }
}

export function testExistingMissedTradeUpsertNeverBecomesAnExecutedOutcome(): void {
  const previous = useStore.getState()
  const missedTrade: Trade = {
    ...openTrade,
    status: 'missed',
    missReason: 'hesitation',
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
    closedAt: '2026-07-14',
  }
  try {
    useStore.setState({ trades: [missedTrade] })

    useStore.getState().upsertTrade({ ...missedTrade, side: 'short', exit: 90 })

    const updated = useStore.getState().trades[0]!
    assert(updated.status === 'missed', 'execution edits must not turn a missed setup into a trade')
    assert(updated.missReason === 'hesitation', 'the missed workflow reason must remain intact')
  } finally {
    useStore.setState({ trades: previous.trades })
  }
}

export function testResultSemanticEditReopensACompletedReview(): void {
  const previous = useStore.getState()
  const reviewedTrade: Trade = {
    ...openTrade,
    status: 'win',
    pnl: 500,
    rMultiple: null,
    resultSource: 'pnl',
    reviewStatus: 'reviewed',
    reviewedAt: '2026-07-14T08:00:00.000Z',
    closedAt: '2026-07-14',
  }
  try {
    useStore.setState({ trades: [reviewedTrade] })

    useStore.getState().updateTradeData(reviewedTrade.id, { pnl: -500 })

    const updated = useStore.getState().trades[0]!
    assert(updated.reviewStatus === 'unreviewed', 'changing a reviewed result must reopen review')
    assert(updated.reviewedAt === null, 'reopened review must clear the stale completion time')
  } finally {
    useStore.setState({ trades: previous.trades })
  }
}

export function testUnrelatedDetailEditKeepsACompletedReview(): void {
  const previous = useStore.getState()
  const reviewedAt = '2026-07-14T08:00:00.000Z'
  const reviewedTrade: Trade = {
    ...openTrade,
    status: 'win',
    pnl: 500,
    resultSource: 'pnl',
    reviewStatus: 'reviewed',
    reviewedAt,
    closedAt: '2026-07-14',
  }
  try {
    useStore.setState({ trades: [reviewedTrade] })

    useStore.getState().updateTradeData(reviewedTrade.id, { timeframe: '4H' })

    const updated = useStore.getState().trades[0]!
    assert(updated.reviewStatus === 'reviewed', 'an unrelated field must not reopen review')
    assert(updated.reviewedAt === reviewedAt, 'an unrelated field must preserve completion time')
  } finally {
    useStore.setState({ trades: previous.trades })
  }
}

export function testEqualResultValueDoesNotReopenACompletedReview(): void {
  const previous = useStore.getState()
  const reviewedAt = '2026-07-14T08:00:00.000Z'
  const reviewedTrade: Trade = {
    ...openTrade,
    status: 'win',
    pnl: 500,
    resultSource: 'pnl',
    reviewStatus: 'reviewed',
    reviewedAt,
    closedAt: '2026-07-14',
  }
  try {
    useStore.setState({ trades: [reviewedTrade] })

    useStore.getState().updateTradeData(reviewedTrade.id, { pnl: 500 })

    const updated = useStore.getState().trades[0]!
    assert(updated.reviewStatus === 'reviewed', 'saving the same result must not reopen review')
    assert(updated.reviewedAt === reviewedAt, 'saving the same result must preserve completion time')
  } finally {
    useStore.setState({ trades: previous.trades })
  }
}

export function testLegacyMetadataNormalizationDoesNotReopenReview(): void {
  const previous = useStore.getState()
  const reviewedAt = '2026-07-14T08:00:00.000Z'
  const legacyReviewedTrade: Trade = {
    ...openTrade,
    status: 'win',
    pnl: 500,
    rMultiple: 2,
    resultSource: undefined,
    initialStopLoss: undefined,
    reviewStatus: 'reviewed',
    reviewedAt,
    closedAt: '2026-07-14',
  }
  try {
    useStore.setState({ trades: [legacyReviewedTrade] })

    useStore.getState().upsertTrade({ ...legacyReviewedTrade, timeframe: '4H' })

    const updated = useStore.getState().trades[0]!
    assert(updated.resultSource === 'imported', 'legacy pair should receive normalized authority metadata')
    assert(updated.initialStopLoss === legacyReviewedTrade.stopLoss, 'legacy risk metadata should normalize')
    assert(updated.reviewStatus === 'reviewed', 'metadata-only normalization must not reopen review')
    assert(updated.reviewedAt === reviewedAt, 'metadata-only normalization must preserve completion time')
  } finally {
    useStore.setState({ trades: previous.trades })
  }
}

export function testSetSideRecalculatesResultAndReopensACompletedReview(): void {
  const previous = useStore.getState()
  const reviewedPriceTrade: Trade = {
    ...openTrade,
    status: 'win',
    side: 'long',
    entry: 100,
    exit: 110,
    stopLoss: 95,
    initialStopLoss: 95,
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
    reviewStatus: 'reviewed',
    reviewedAt: '2026-07-14T08:00:00.000Z',
    closedAt: '2026-07-14',
  }
  try {
    useStore.setState({ trades: [reviewedPriceTrade] })

    useStore.getState().setSide(reviewedPriceTrade.id, 'short')

    const updated = useStore.getState().trades[0]!
    assert(updated.side === 'short' && updated.rMultiple === -2, 'side must use result reconciliation')
    assert(updated.status === 'loss', 'price-authority outcome must follow the changed side')
    assert(updated.reviewStatus === 'unreviewed', 'changing the reviewed execution must reopen review')
    assert(updated.reviewedAt === null, 'reopened execution review must clear completion time')
  } finally {
    useStore.setState({ trades: previous.trades })
  }
}

export function testStatusChangeReopensACompletedReview(): void {
  const previous = useStore.getState()
  const reviewedTrade: Trade = {
    ...openTrade,
    status: 'win',
    pnl: 500,
    resultSource: 'pnl',
    reviewStatus: 'reviewed',
    reviewedAt: '2026-07-14T08:00:00.000Z',
    closedAt: '2026-07-14',
  }
  try {
    useStore.setState({ trades: [reviewedTrade] })

    useStore.getState().setStatus(reviewedTrade.id, 'open')

    const updated = useStore.getState().trades[0]!
    assert(updated.status === 'open', 'status change should still be applied')
    assert(updated.reviewStatus === 'unreviewed', 'changing execution status must reopen review')
    assert(updated.reviewedAt === null, 'reopened status review must clear completion time')
  } finally {
    useStore.setState({ trades: previous.trades })
  }
}

export function testCompleteTradeCloseReopensACompletedReviewWhenResultChanges(): void {
  const previous = useStore.getState()
  const reviewedTrade: Trade = {
    ...openTrade,
    status: 'win',
    pnl: 500,
    resultSource: 'pnl',
    reviewStatus: 'reviewed',
    reviewedAt: '2026-07-14T08:00:00.000Z',
    closedAt: '2026-07-14',
  }
  try {
    useStore.setState({ trades: [reviewedTrade], undoStack: [], redoStack: [] })

    useStore.getState().completeTradeClose(reviewedTrade.id, 'loss', {
      pnl: -300,
      rMultiple: null,
      resultSource: 'pnl',
      closedAt: '2026-07-14',
    })

    const updated = useStore.getState().trades[0]!
    assert(updated.status === 'loss' && updated.pnl === -300, '新的平仓结果必须完整保存')
    assert(updated.reviewStatus === 'unreviewed', '修改已复盘交易的平仓结果必须重新进入待复盘')
    assert(updated.reviewedAt === null, '重新复盘时必须清除旧完成时间')
  } finally {
    useStore.setState({
      trades: previous.trades,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
    })
  }
}
