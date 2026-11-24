import type { Trade } from '@/data/trades'
import type { PersistedSnapshot } from '@/storage/types'
import { resolveTradeTruth, isTradeResultAuthorityConsistent } from '@/lib/tradeTruth'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'

export function resultRepairCandidate(trade: Trade): Trade | null {
  if (trade.deletedAt || trade.tradeKind === 'case') return null
  const truth = resolveTradeTruth(trade)
  if (truth.executionState !== 'closed' || !truth.hasConflict) return null
  const r = trade.rMultiple
  if (typeof r !== 'number' || !Number.isFinite(r)) return null
  // Never discard a nonzero cash result to resolve a disagreement.
  if (trade.pnl != null && trade.pnl !== 0) return null
  const next: Trade = { ...trade, status: r > 0 ? 'win' : r < 0 ? 'loss' : 'breakeven', pnl: null, resultSource: trade.resultSource === 'price' ? 'price' : 'r' }
  return isTradeResultAuthorityConsistent(next) && resolveTradeTruth(next).isResultComplete ? next : null
}

export type ResultRepairGroup = 'metrics' | 'status' | 'pending' | 'byR'

export interface ResultRepairRow {
  trade: Trade
  proposedStatus?: Trade['status']
}

/** 只展示当前范围内仍待处理的记录。批量预览和执行使用同一资格判定。 */
export function groupResultRepairs(trades: readonly Trade[], ids: readonly string[]) {
  const scope = new Set(ids)
  const groups: Record<ResultRepairGroup, ResultRepairRow[]> = { metrics: [], status: [], pending: [], byR: [] }
  for (const trade of trades) {
    if (!scope.has(trade.id) || trade.deletedAt || trade.tradeKind === 'case') continue
    const truth = resolveTradeTruth(trade)
    if (truth.conflictReason) {
      const candidate = resultRepairCandidate(trade)
      if (candidate) groups.byR.push({ trade, proposedStatus: candidate.status })
      else groups[truth.conflictReason].push({ trade })
    } else if (truth.executionState === 'closed' && !truth.isResultComplete) {
      groups.pending.push({ trade })
    }
  }
  return groups
}

export function prepareResultConflictRepair(before: PersistedSnapshot, ids: readonly string[]): PersistedSnapshot {
  assertValidPersistedSnapshot(before)
  const selected = new Set(ids)
  if (!selected.size || selected.size !== ids.length) throw new Error('请选择需要修正的记录。')
  const next = structuredClone(before)
  next.trades = next.trades.map(trade => {
    if (!selected.has(trade.id)) return trade
    const candidate = resultRepairCandidate(trade)
    if (!candidate) throw new Error('记录已变化或不适合按 R 修正，请重新预览。')
    selected.delete(trade.id)
    return candidate
  })
  if (selected.size) throw new Error('记录不存在，请重新预览。')
  assertValidPersistedSnapshot(next)
  return next
}
