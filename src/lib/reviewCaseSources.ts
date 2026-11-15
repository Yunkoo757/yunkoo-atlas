import type { Trade } from '@/data/trades'

/** 同步来源的已保存正文；案例独立沉淀不回写，来源缺失时保留最后快照。 */
export function syncReviewCaseSourceNotes(trades: Trade[]): Trade[] {
  const sources = new Map<string, string>()
  for (const trade of trades) {
    if (trade.tradeKind !== 'case') sources.set(trade.id, trade.note)
  }
  let updated: Trade[] | undefined
  for (let index = 0; index < trades.length; index++) {
    const trade = trades[index]!
    if (trade.tradeKind !== 'case' || !trade.sourceTradeId) continue
    const sourceNoteHtml = sources.get(trade.sourceTradeId)
    if (sourceNoteHtml === undefined || sourceNoteHtml === trade.sourceNoteHtml) continue
    updated ??= trades.slice()
    updated[index] = { ...trade, sourceNoteHtml }
  }
  return updated ?? trades
}
