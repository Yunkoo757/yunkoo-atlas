import type { Trade } from '@/data/trades'

export function syncReviewCaseSourceNote(trade: Trade, source: Trade | undefined): Trade {
  if (trade.tradeKind !== 'case' || !trade.sourceTradeId || !source || source.tradeKind === 'case'
    || source.id !== trade.sourceTradeId || source.note === trade.sourceNoteHtml) return trade
  return { ...trade, sourceNoteHtml: source.note }
}

/** 同步来源的已保存正文；案例独立沉淀不回写，来源缺失时保留最后快照。 */
export function syncReviewCaseSourceNotes(trades: Trade[]): Trade[] {
  const sources = new Map<string, Trade>()
  for (const trade of trades) {
    if (trade.tradeKind !== 'case') sources.set(trade.id, trade)
  }
  let updated: Trade[] | undefined
  for (let index = 0; index < trades.length; index++) {
    const trade = trades[index]!
    const updatedTrade = syncReviewCaseSourceNote(trade, trade.sourceTradeId ? sources.get(trade.sourceTradeId) : undefined)
    if (updatedTrade === trade) continue
    updated ??= trades.slice()
    updated[index] = updatedTrade
  }
  return updated ?? trades
}
