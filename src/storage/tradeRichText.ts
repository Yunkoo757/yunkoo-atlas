export type TradeRichTextCarrier = {
  note: string
  sourceNoteHtml?: string
}

export function tradeRichTextEntries(trade: TradeRichTextCarrier): string[] {
  return trade.sourceNoteHtml === undefined
    ? [trade.note]
    : [trade.note, trade.sourceNoteHtml]
}

export function mapTradeRichText<T extends TradeRichTextCarrier>(
  trade: T,
  transform: (html: string) => string,
): T {
  return {
    ...trade,
    note: transform(trade.note),
    ...(trade.sourceNoteHtml === undefined
      ? {}
      : { sourceNoteHtml: transform(trade.sourceNoteHtml) }),
  } as T
}
