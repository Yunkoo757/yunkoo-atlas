import { tradeRichTextEntries, type TradeRichTextCarrier } from './tradeRichText'

type HtmlRecord = { contentHtml: string }
type RichTextSnapshot<Trade = TradeRichTextCarrier, Review = HtmlRecord, Note = HtmlRecord> = {
  trades: readonly Trade[]
  weeklyReviews?: readonly Review[]
  quickNotes?: readonly Note[]
}

/** 按持久化顺序遍历正文。保留每个来源对象，供盘点归属、错误定位和按记录分批读取。 */
export function* snapshotRichTextRecords<Trade extends TradeRichTextCarrier, Review extends HtmlRecord, Note extends HtmlRecord>(
  snapshot: RichTextSnapshot<Trade, Review, Note>,
) {
  for (const record of snapshot.trades) {
    yield { domain: 'trade' as const, record, html: tradeRichTextEntries(record) }
  }
  for (const record of snapshot.weeklyReviews ?? []) {
    yield { domain: 'weeklyReview' as const, record, html: [record.contentHtml] }
  }
  for (const record of snapshot.quickNotes ?? []) {
    yield { domain: 'quickNote' as const, record, html: [record.contentHtml] }
  }
}

export const ASSET_URL_PREFIX = 'journal-asset://'
const referencePattern = /journal-asset:\/\/([^"'\s>]+)/g

export function* htmlAssetIds(entries: Iterable<string>): Generator<string> {
  for (const html of entries) {
    if (!html.includes(ASSET_URL_PREFIX)) continue
    for (const match of html.matchAll(referencePattern)) yield match[1]
  }
}

export function remapHtmlAssetIds(html: string, resolve: (id: string) => string): string {
  return html.replace(referencePattern, (_url, id: string) => ASSET_URL_PREFIX + resolve(id))
}

export function collectAssetIdsFromHtml(entries: readonly string[]): string[] {
  return [...new Set(htmlAssetIds(entries))]
}

export function collectAssetIdsFromSnapshot(snapshot: RichTextSnapshot): string[] {
  const ids = new Set<string>()
  for (const { html } of snapshotRichTextRecords(snapshot)) {
    for (const id of htmlAssetIds(html)) ids.add(id)
  }
  return [...ids]
}
