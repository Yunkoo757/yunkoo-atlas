export type TradeRichTextCarrier = {
  note: string
  sourceNoteHtml?: string
}

type MappedSourceNote<T extends TradeRichTextCarrier> =
  'sourceNoteHtml' extends keyof T
    ? Record<never, never> extends Pick<T, 'sourceNoteHtml' & keyof T>
      ? { sourceNoteHtml?: string }
      : undefined extends T['sourceNoteHtml' & keyof T]
        ? { sourceNoteHtml: string | undefined }
        : { sourceNoteHtml: string }
    : Record<never, never>

export type MappedTradeRichText<T extends TradeRichTextCarrier> =
  T extends unknown
    ? Omit<T, 'note' | 'sourceNoteHtml'> &
      { note: string } &
      MappedSourceNote<T>
    : never

export function tradeRichTextEntries(trade: TradeRichTextCarrier): string[] {
  return trade.sourceNoteHtml === undefined
    ? [trade.note]
    : [trade.note, trade.sourceNoteHtml]
}

export function mapTradeRichText<T extends TradeRichTextCarrier>(
  trade: T,
  transform: (html: string) => string,
): MappedTradeRichText<T>
export function mapTradeRichText(
  trade: TradeRichTextCarrier,
  transform: (html: string) => string,
): TradeRichTextCarrier {
  return {
    ...trade,
    note: transform(trade.note),
    ...(trade.sourceNoteHtml === undefined
      ? {}
      : { sourceNoteHtml: transform(trade.sourceNoteHtml) }),
  }
}
