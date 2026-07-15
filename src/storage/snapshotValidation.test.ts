import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const valid = {
  trades: [{
    id: 'trade-1', ref: 'TRD-1', symbol: 'BTCUSDT', side: 'long', status: 'open',
    conviction: 'medium', strategyId: 'strategy-1', tags: [], mistakeTags: [],
    tradeKind: 'live', entry: 100, exit: null, size: 1, pnl: null, rMultiple: null,
    openedAt: '2026-07-14', closedAt: null, note: '',
  }],
  strategies: [{ id: 'strategy-1', name: '趋势', icon: 'trending-up', color: '#5e6ad2' }],
  starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
}

export function testSnapshotValidationAcceptsOpenTradesAndLegacyOptionalFields(): void {
  assertValidPersistedSnapshot(valid)
  const legacy = { ...valid, trades: valid.trades.map(({ tradeKind: _tradeKind, mistakeTags: _mistakes, ...trade }) => trade) }
  assertValidPersistedSnapshot(legacy)
}

export function testSnapshotValidationRejectsMalformedTradeAndSettingsData(): void {
  let rejectedTrade = false
  try {
    assertValidPersistedSnapshot({ ...valid, trades: [{ ...valid.trades[0], entry: '100' }] })
  } catch {
    rejectedTrade = true
  }
  assert(rejectedTrade, '字符串价格不得进入资料库快照')

  let rejectedSettings = false
  try {
    assertValidPersistedSnapshot({ ...valid, starredIds: ['trade-1', 2] })
  } catch {
    rejectedSettings = true
  }
  assert(rejectedSettings, '损坏的设置数组不得进入资料库快照')
}

export function testSnapshotValidationStillRejectsNonFiniteTradeNumbers(): void {
  let rejected = false
  try {
    assertValidPersistedSnapshot({
      ...valid,
      trades: [{ ...valid.trades[0], pnl: Number.NaN }],
    })
  } catch {
    rejected = true
  }
  assert(rejected, '非有限数值不得进入资料库快照')
}

export function testSnapshotValidationStillRejectsIllegalTradeEnums(): void {
  let rejected = false
  try {
    assertValidPersistedSnapshot({
      ...valid,
      trades: [{ ...valid.trades[0], status: 'settled' }],
    })
  } catch {
    rejected = true
  }
  assert(rejected, '非法交易状态不得进入资料库快照')
}

export function testSnapshotValidationStillRejectsBrokenRequiredReferenceFields(): void {
  let rejected = false
  try {
    assertValidPersistedSnapshot({
      ...valid,
      trades: [{ ...valid.trades[0], strategyId: null }],
    })
  } catch {
    rejected = true
  }
  assert(rejected, '损坏的必要策略引用字段不得进入资料库快照')
}

export function testSnapshotValidationRejectsStructurallyInvalidResultMetadata(): void {
  assertValidPersistedSnapshot({
    ...valid,
    trades: [{
      ...valid.trades[0],
      status: 'win',
      resultSource: 'price',
      exit: 110,
      initialStopLoss: 95,
      rMultiple: 2,
    }],
  })

  for (const tradePatch of [
    { resultSource: 'guessed' },
    { initialStopLoss: '95' },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({
        ...valid,
        trades: [{ ...valid.trades[0], ...tradePatch }],
      })
    } catch {
      rejected = true
    }
    assert(rejected, 'invalid result metadata must not enter a snapshot')
  }
}

export function testSnapshotValidationLeavesResultAuthorityConflictsToBusinessDiagnosis(): void {
  const assertTradeAccepted = (tradePatch: Record<string, unknown>) => {
    assertValidPersistedSnapshot({
      ...valid,
      trades: [{ ...valid.trades[0], status: 'win', ...tradePatch }],
    })
  }

  assertTradeAccepted({ pnl: 10, rMultiple: null, resultSource: 'pnl' })
  assertTradeAccepted({ pnl: null, rMultiple: 2, resultSource: 'r' })
  assertTradeAccepted({
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
    exit: 110,
    initialStopLoss: 95,
  })
  assertTradeAccepted({ pnl: 10, rMultiple: 2, resultSource: 'imported' })
  assertTradeAccepted({ pnl: 10, rMultiple: 2, resultSource: undefined })

  assertTradeAccepted({ pnl: null, rMultiple: 2, resultSource: 'pnl' })
  assertTradeAccepted({ pnl: 10, rMultiple: 2, resultSource: 'pnl' })
  assertTradeAccepted({ pnl: 10, rMultiple: null, resultSource: 'r' })
  assertTradeAccepted({ pnl: 10, rMultiple: 2, resultSource: 'price' })
  assertTradeAccepted({ pnl: null, rMultiple: 2, resultSource: 'price', exit: null })
  assertTradeAccepted({
    pnl: null,
    rMultiple: 3,
    resultSource: 'price',
    exit: 110,
    initialStopLoss: 95,
  })
  assertTradeAccepted({ pnl: 10, rMultiple: null, resultSource: 'imported' })
}
