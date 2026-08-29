import type { Trade } from '@/data/trades'

export const MISSED_OPPORTUNITY_SOURCES = ['trade', 'paper'] as const
export type MissedOpportunitySource = (typeof MISSED_OPPORTUNITY_SOURCES)[number]

export type MissedOpportunityItem = {
  key: string
  source: MissedOpportunitySource
  primary: Trade
  linkedCases: Trade[]
  occurredAt: string
}

export type MissedOpportunitySummary = {
  items: MissedOpportunityItem[]
  rawCounts: Record<MissedOpportunitySource, number>
  rawTotal: number
  aggregateTotal: number
}

/** deletedAt 只要存在（包括旧数据中的空字符串）即视为软删除。 */
export function isMissedOpportunityDeleted(trade: Trade): boolean {
  return trade.deletedAt !== undefined
}

export function missedOpportunitySourceOf(trade: Trade): MissedOpportunitySource | null {
  if (isMissedOpportunityDeleted(trade)) return null
  if (trade.tradeKind === 'live' && trade.status === 'missed') return 'trade'
  if (trade.tradeKind === 'paper' && trade.status === 'missed') return 'paper'
  return null
}

function occurredAt(trade: Trade): string {
  return trade.tradeKind === 'case'
    ? trade.recordedAt ?? trade.openedAt
    : trade.closedAt ?? trade.openedAt
}

function createRootItem(trade: Trade): MissedOpportunityItem {
  const source = missedOpportunitySourceOf(trade)
  if (!source) throw new Error('missed opportunity root must be a live or paper trade')
  return {
    key: trade.id,
    source,
    primary: trade,
    linkedCases: [],
    occurredAt: occurredAt(trade),
  }
}

function compareItems(left: MissedOpportunityItem, right: MissedOpportunityItem): number {
  return right.occurredAt.localeCompare(left.occurredAt) || left.key.localeCompare(right.key, 'en')
}

function compareCases(left: Trade, right: Trade): number {
  return occurredAt(right).localeCompare(occurredAt(left)) || left.id.localeCompare(right.id, 'en')
}

export function buildMissedOpportunitySummary(
  records: Trade[],
  sources: readonly MissedOpportunitySource[] = MISSED_OPPORTUNITY_SOURCES,
): MissedOpportunitySummary {
  const selectedSources = new Set(sources)
  const sourceRecords = records.filter((trade) => {
    const source = missedOpportunitySourceOf(trade)
    return source !== null && selectedSources.has(source)
  })
  const rawCounts: Record<MissedOpportunitySource, number> = { trade: 0, paper: 0 }
  for (const trade of sourceRecords) {
    const source = missedOpportunitySourceOf(trade)
    if (source) rawCounts[source] += 1
  }

  const rootsById = new Map(sourceRecords.map((trade) => [trade.id, createRootItem(trade)]))
  const items = [...rootsById.values()]
  for (const reviewCase of records.filter((trade) => trade.tradeKind === 'case' && !isMissedOpportunityDeleted(trade))) {
    const root = reviewCase.sourceTradeId ? rootsById.get(reviewCase.sourceTradeId) : undefined
    if (root) root.linkedCases.push(reviewCase)
  }

  for (const item of items) item.linkedCases.sort(compareCases)
  items.sort(compareItems)
  const rawTotal = rawCounts.trade + rawCounts.paper
  return { items, rawCounts, rawTotal, aggregateTotal: items.length }
}
