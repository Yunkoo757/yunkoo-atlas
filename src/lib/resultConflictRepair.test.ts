import assert from 'node:assert/strict'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import type { Trade } from '@/data/trades'
import { resultRepairCandidate, prepareResultConflictRepair } from './resultConflictRepair'
const trade: Trade = { id: 'paper', ref: 'TRD-1', tradeKind: 'paper', symbol: 'EURUSD', side: 'long', status: 'breakeven', conviction: 'medium', mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal', strategyId: 's', tags: [], note: '', entry: 1, exit: null, size: 0, pnl: 0, rMultiple: 2, resultSource: 'imported', openedAt: '2026-08-03', closedAt: '2026-08-04' }
export function testResultRepairPreservesActualRAndProtectsCash() {
  assert.deepEqual(resultRepairCandidate(trade), { ...trade, status: 'win', pnl: null, resultSource: 'r' })
  assert.equal(resultRepairCandidate({ ...trade, rMultiple: -2 })?.status, 'loss')
  assert.equal(resultRepairCandidate({ ...trade, status: 'loss', pnl: null, resultSource: 'r' })?.status, 'win')
  for (const t of [{ ...trade, pnl: -10 }, { ...trade, rMultiple: null }, { ...trade, deletedAt: '2026-09-06' }, { ...trade, status: 'open' as const }, { ...trade, tradeKind: 'case' as const }]) assert.equal(resultRepairCandidate(t), null)
}
export function testResultRepairScopeImmutabilityAndRepeatProtection() {
  const snapshot = createEmptyPersistedSnapshot()
  snapshot.strategies = [{ id: 's', name: '策略', color: '#888888', icon: 'target' }]
  snapshot.trades = [trade, { ...trade, id: 'other', ref: 'TRD-2' }]
  const original = structuredClone(snapshot)
  const next = prepareResultConflictRepair(snapshot, ['paper'])
  assert.deepEqual(snapshot, original)
  assert.deepEqual(next.trades[1], original.trades[1])
  assert.equal(next.trades[0].rMultiple, 2)
  assert.throws(() => prepareResultConflictRepair(next, ['paper']))
  assert.throws(() => prepareResultConflictRepair(snapshot, ['missing']))
}
