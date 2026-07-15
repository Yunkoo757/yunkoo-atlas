import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import { encodeSnapshotForLegacyReaders } from '@/storage/snapshotCompatibility'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import type { PersistedSnapshot } from '@/storage/types'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const valid: PersistedSnapshot = {
  trades: [{
    id: 'trade-1', ref: 'TRD-1', symbol: 'BTCUSDT', side: 'long', status: 'open',
    conviction: 'medium', strategyId: 'strategy-1', tags: [], mistakeTags: [],
    reviewStatus: 'unreviewed', reviewCategory: 'normal',
    tradeKind: 'live', entry: 100, exit: null, size: 1, pnl: null, rMultiple: null,
    openedAt: '2026-07-14', closedAt: null, note: '',
  }],
  strategies: [{ id: 'strategy-1', name: '趋势', icon: 'trending-up', color: '#5e6ad2' }],
  starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
  display: DEFAULT_DISPLAY,
}

export function testSnapshotValidationAcceptsOpenTradesAndLegacyOptionalFields(): void {
  assertValidPersistedSnapshot(valid)
  const legacy = { ...valid, trades: valid.trades.map(({ tradeKind: _tradeKind, mistakeTags: _mistakes, ...trade }) => trade) }
  assertValidPersistedSnapshot(legacy)
}

export function testSnapshotValidationAcceptsUnknownEntryAndSizeAsNull(): void {
  assertValidPersistedSnapshot({
    ...valid,
    trades: [{ ...valid.trades[0], entry: null, size: null }],
  })
}

export function testUnknownExecutionValuesRemainReadableByThePreviousClientOnDisk(): void {
  const runtimeSnapshot = {
    ...valid,
    trades: [{ ...valid.trades[0], entry: null, size: null }],
  }
  const encoded = encodeSnapshotForLegacyReaders(runtimeSnapshot)

  assert(encoded.trades[0]?.entry === 0, 'unknown entry should use the previous on-disk sentinel')
  assert(encoded.trades[0]?.size === 0, 'unknown size should use the previous on-disk sentinel')
  assert(runtimeSnapshot.trades[0]?.entry === null, 'encoding must not mutate the live runtime trade')
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

export function testSnapshotValidationChecksResultAuthorityAndInitialRisk(): void {
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

export function testSnapshotValidationEnforcesDeclaredResultAuthorityMetrics(): void {
  const assertTradeAccepted = (tradePatch: Record<string, unknown>) => {
    assertValidPersistedSnapshot({
      ...valid,
      trades: [{ ...valid.trades[0], status: 'win', ...tradePatch }],
    })
  }
  const assertTradeRejected = (tradePatch: Record<string, unknown>) => {
    let rejected = false
    try {
      assertTradeAccepted(tradePatch)
    } catch {
      rejected = true
    }
    assert(rejected, 'declared authority must match its authoritative metric combination')
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

  assertTradeRejected({ pnl: null, rMultiple: 2, resultSource: 'pnl' })
  assertTradeRejected({ pnl: 10, rMultiple: 2, resultSource: 'pnl' })
  assertTradeRejected({ pnl: 10, rMultiple: null, resultSource: 'r' })
  assertTradeRejected({ pnl: 10, rMultiple: 2, resultSource: 'price' })
  assertTradeRejected({ pnl: null, rMultiple: 2, resultSource: 'price', exit: null })
  assertTradeRejected({
    pnl: null,
    rMultiple: 3,
    resultSource: 'price',
    exit: 110,
    initialStopLoss: 95,
  })
  assertTradeRejected({ pnl: 10, rMultiple: null, resultSource: 'imported' })
}
