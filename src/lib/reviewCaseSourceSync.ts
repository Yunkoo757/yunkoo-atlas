import type { Trade } from '@/data/trades'

/** 纯计算来源快照级联，调用方负责把来源最新正文先写入同一 trades candidate。 */
export function cascadeReviewCaseSourceSnapshot(trades: Trade[], sourceId: string): Trade[] {
  const source = trades.find((trade) => trade.id === sourceId)
  if (!source || source.tradeKind === 'case') return trades

  let changed = false
  const next = trades.map((trade) => {
    if (
      trade.tradeKind !== 'case' ||
      trade.sourceTradeId !== sourceId ||
      trade.sourceNoteHtml === source.note
    ) return trade

    changed = true
    return { ...trade, sourceNoteHtml: source.note }
  })
  return changed ? next : trades
}
