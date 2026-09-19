import type { Trade } from '@/data/trades'
import { resolveTradeTruth } from '@/lib/tradeTruth'

export function collectWorkbenchResultRepairIds(trades: readonly Trade[]): string[] {
  const ids: string[] = []
  for (const trade of trades) {
    if (trade.deletedAt || trade.tradeKind === 'case') continue
    const truth = resolveTradeTruth(trade)
    if (truth.hasConflict || (truth.executionState === 'closed' && !truth.isResultComplete)) {
      ids.push(trade.id)
    }
  }
  return ids
}
