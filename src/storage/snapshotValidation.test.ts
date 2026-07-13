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
