import type { MissReason, Trade, TradeSide } from '@/data/trades'
import {
  CALENDAR_PERIODS,
  getPeriodBounds,
  isDateInRange,
  type BusinessDateAnchor,
  type CalendarPeriod,
} from '@/lib/periods'

export const MISSED_OPPORTUNITY_SOURCES = ['trade', 'paper', 'case'] as const
export type MissedOpportunitySource = (typeof MISSED_OPPORTUNITY_SOURCES)[number]

export type MissedOpportunityItem = {
  key: string
  source: MissedOpportunitySource
  primary: Trade
  linkedCases: Trade[]
  occurredAt: string
  missingSourceId?: string
}

export type MissedOpportunitySummary = {
  items: MissedOpportunityItem[]
  rawCounts: Record<MissedOpportunitySource, number>
  rawTotal: number
  aggregateTotal: number
}

export type MissedOpportunityFilters = {
  period?: CalendarPeriod
  symbol?: string
  side?: TradeSide
  missReason?: MissReason
}

const TRADE_SIDES: readonly TradeSide[] = ['long', 'short']
const MISS_REASONS: readonly MissReason[] = ['hesitation', 'missed_setup', 'no_alert', 'rule_break', 'other']

/** deletedAt 只要存在（包括旧数据中的空字符串）即视为软删除。 */
export function isMissedOpportunityDeleted(trade: Trade): boolean {
  return trade.deletedAt !== undefined
}

export function missedOpportunitySourceOf(trade: Trade): MissedOpportunitySource | null {
  if (isMissedOpportunityDeleted(trade)) return null
  if (trade.tradeKind === 'live' && trade.status === 'missed') return 'trade'
  if (trade.tradeKind === 'paper' && trade.status === 'missed') return 'paper'
  if (trade.tradeKind === 'case' && trade.caseType === 'missed') return 'case'
  return null
}

export function missedOpportunityOccurredAt(trade: Trade): string {
  return trade.tradeKind === 'case'
    ? trade.recordedAt ?? trade.openedAt
    : trade.closedAt ?? trade.openedAt
}

function createRootItem(trade: Trade): MissedOpportunityItem {
  const source = missedOpportunitySourceOf(trade)
  if (!source || source === 'case') throw new Error('missed opportunity root must be a live or paper trade')
  return {
    key: trade.id,
    source,
    primary: trade,
    linkedCases: [],
    occurredAt: missedOpportunityOccurredAt(trade),
  }
}

function createStandaloneCase(reviewCase: Trade, sourceIsDeleted: boolean): MissedOpportunityItem {
  return {
    key: reviewCase.id,
    source: 'case',
    primary: reviewCase,
    linkedCases: [],
    occurredAt: missedOpportunityOccurredAt(reviewCase),
    ...(sourceIsDeleted && reviewCase.sourceTradeId ? { missingSourceId: reviewCase.sourceTradeId } : {}),
  }
}

function compareItems(left: MissedOpportunityItem, right: MissedOpportunityItem): number {
  const byOccurredAt = right.occurredAt.localeCompare(left.occurredAt)
  return byOccurredAt || left.key.localeCompare(right.key, 'en')
}

function compareCases(left: Trade, right: Trade): number {
  const byOccurredAt = missedOpportunityOccurredAt(right).localeCompare(missedOpportunityOccurredAt(left))
  return byOccurredAt || left.id.localeCompare(right.id, 'en')
}

export function buildMissedOpportunitySummary(
  records: Trade[],
  sources: readonly MissedOpportunitySource[] = MISSED_OPPORTUNITY_SOURCES,
): MissedOpportunitySummary {
  const selectedSources = new Set(sources)
  const allById = new Map(records.map((trade) => [trade.id, trade]))
  const sourceRecords = records.filter((trade) => {
    const source = missedOpportunitySourceOf(trade)
    return source !== null && selectedSources.has(source)
  })
  const rawCounts: Record<MissedOpportunitySource, number> = { trade: 0, paper: 0, case: 0 }
  for (const trade of sourceRecords) {
    const source = missedOpportunitySourceOf(trade)
    if (source) rawCounts[source] += 1
  }

  const rootsById = new Map(
    sourceRecords
      .filter((trade) => trade.tradeKind !== 'case')
      .map((trade) => [trade.id, createRootItem(trade)]),
  )
  const items = [...rootsById.values()]

  for (const reviewCase of sourceRecords.filter((trade) => trade.tradeKind === 'case')) {
    const root = reviewCase.sourceTradeId ? rootsById.get(reviewCase.sourceTradeId) : undefined
    if (root) {
      root.linkedCases.push(reviewCase)
      continue
    }
    items.push(createStandaloneCase(
      reviewCase,
      isMissedOpportunityDeleted(allById.get(reviewCase.sourceTradeId ?? '') ?? reviewCase),
    ))
  }

  for (const item of items) item.linkedCases.sort(compareCases)
  items.sort(compareItems)
  const rawTotal = rawCounts.trade + rawCounts.paper + rawCounts.case
  return { items, rawCounts, rawTotal, aggregateTotal: items.length }
}

export function filterMissedOpportunityItems(
  items: readonly MissedOpportunityItem[],
  filters: MissedOpportunityFilters,
  anchor: BusinessDateAnchor,
): MissedOpportunityItem[] {
  const bounds = filters.period ? getPeriodBounds(filters.period, anchor) : undefined
  return items.filter((item) => {
    const { primary } = item
    if (filters.symbol && primary.symbol !== filters.symbol) return false
    if (filters.side && primary.side !== filters.side) return false
    if (filters.missReason && (primary.missReason ?? 'other') !== filters.missReason) return false
    return !bounds || isDateInRange(item.occurredAt, bounds)
  })
}

export function parseMissedOpportunityFilters(search: string | URLSearchParams): MissedOpportunityFilters {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search
  const period = params.get('period')
  const side = params.get('side')
  const missReason = params.get('missReason')
  const symbol = params.get('symbol')
  return {
    ...(period && (CALENDAR_PERIODS as readonly string[]).includes(period) ? { period: period as CalendarPeriod } : {}),
    ...(symbol ? { symbol } : {}),
    ...(side && TRADE_SIDES.includes(side as TradeSide) ? { side: side as TradeSide } : {}),
    ...(missReason && MISS_REASONS.includes(missReason as MissReason) ? { missReason: missReason as MissReason } : {}),
  }
}
