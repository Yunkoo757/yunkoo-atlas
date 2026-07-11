import type { ReviewCategory, Trade, TradeSide, TradeStatus } from '@/data/trades'
import { tradeInPeriod, type CalendarPeriod } from '@/lib/periods'

export type TradeMonthGroup = {
  key: string
  label: string
  items: Trade[]
}

export type TradeFacetFilters = {
  symbol?: string
  side?: TradeSide
  status?: TradeStatus
  tag?: string
  mistakeTag?: string
  reviewCategory?: ReviewCategory
  session?: TradeSessionKind
  period?: CalendarPeriod
  strategyId?: string
}

export type TradeSessionKind = 'london' | 'asia' | 'new-york' | 'outside' | 'other'

export type TradeSessionMeta = {
  raw: string
  label: string
  kind: TradeSessionKind
}

/** 新建 / 详情可点选的交易时段预设（写入 Trade.session） */
export const SESSION_PRESETS = [
  { value: 'London Open', label: '伦敦开盘', kind: 'london' },
  { value: 'London Close', label: '伦敦收盘', kind: 'london' },
  { value: 'Asia', label: '亚盘', kind: 'asia' },
  { value: 'New York Open', label: '纽约开盘', kind: 'new-york' },
  { value: 'New York Close', label: '纽约收盘', kind: 'new-york' },
  { value: 'New York', label: '纽约盘', kind: 'new-york' },
  { value: 'Out of Session', label: '盘外时段', kind: 'outside' },
] as const

export type SessionPresetValue = (typeof SESSION_PRESETS)[number]['value']

function sessionMetaFromValue(value: string): TradeSessionMeta | null {
  const raw = value.trim()
  if (!raw) return null
  const normalized = raw.toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ')

  if (/out of session|outside session|盘外|非交易时段/.test(normalized)) {
    return { raw, label: '盘外时段', kind: 'outside' }
  }
  if (/london|伦敦/.test(normalized)) {
    const label = /close|收盘/.test(normalized)
      ? '伦敦收盘'
      : /open|开盘/.test(normalized)
        ? '伦敦开盘'
        : '伦敦盘'
    return { raw, label, kind: 'london' }
  }
  if (/new york|newyork|ny session|ny open|纽约|美盘/.test(normalized)) {
    const label = /close|收盘/.test(normalized)
      ? '纽约收盘'
      : /open|开盘/.test(normalized)
        ? '纽约开盘'
        : '纽约盘'
    return { raw, label, kind: 'new-york' }
  }
  if (/asia|asian|tokyo|亚盘|亚洲|东京/.test(normalized)) {
    return { raw, label: '亚盘', kind: 'asia' }
  }
  return null
}

export function getTradeSessionMeta(trade: Trade): TradeSessionMeta | null {
  if (trade.session?.trim()) {
    return sessionMetaFromValue(trade.session) ?? {
      raw: trade.session.trim(),
      label: trade.session.trim(),
      kind: 'other',
    }
  }
  for (const tag of trade.tags) {
    const meta = sessionMetaFromValue(tag)
    if (meta) return meta
  }
  return null
}

/** 规范化时段字符串；空值表示未设置 */
export function normalizeSession(value: string | null | undefined): string | undefined {
  const raw = value?.trim()
  if (!raw) return undefined
  const exact = SESSION_PRESETS.find(
    (preset) => preset.value.toLowerCase() === raw.toLowerCase() || preset.label === raw,
  )
  if (exact) return exact.value
  const meta = sessionMetaFromValue(raw)
  if (!meta) return raw
  const byLabel = SESSION_PRESETS.find((preset) => preset.label === meta.label)
  return byLabel?.value ?? raw
}

/** 下拉当前值：优先 session 字段，兼容旧数据里写在标签中的时段 */
export function getSessionSelectValue(trade: Pick<Trade, 'session' | 'tags'>): string {
  const meta = getTradeSessionMeta(trade as Trade)
  if (!meta) return ''
  const preset = SESSION_PRESETS.find(
    (item) => item.label === meta.label || item.value.toLowerCase() === meta.raw.toLowerCase(),
  )
  return preset?.value ?? meta.raw
}

/** 把标签里的时段提升为独立 session 字段，避免新案例只能靠标签 */
export function promoteTradeSession(trade: Trade): Trade {
  const normalized = normalizeSession(trade.session)
  if (normalized) {
    return normalized === trade.session ? trade : { ...trade, session: normalized }
  }
  const fromTags = getSessionSelectValue(trade)
  if (!fromTags) return trade
  return { ...trade, session: fromTags }
}

function tradeTime(trade: Trade) {
  const value = new Date(trade.openedAt).getTime()
  return Number.isFinite(value) ? value : 0
}

export function sortTradesByOpenedAtDesc(trades: Trade[]): Trade[] {
  return [...trades].sort((left, right) => {
    const leftTime = tradeTime(left)
    const rightTime = tradeTime(right)
    const leftValid = leftTime > 0
    const rightValid = rightTime > 0
    if (leftValid !== rightValid) return leftValid ? -1 : 1
    return rightTime - leftTime
  })
}

export function getReviewCaseActivityTime(trade: Trade): number {
  const candidates = [
    trade.recordedAt,
    ...(trade.activities ?? []).map((activity) => activity.timestamp),
    ...(trade.comments ?? []).map((comment) => comment.createdAt),
  ]
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter(Number.isFinite)
  if (candidates.length > 0) return Math.max(...candidates)
  return tradeTime(trade)
}

export function sortReviewCasesByRecentActivity(trades: Trade[]): Trade[] {
  return [...trades].sort(
    (left, right) => getReviewCaseActivityTime(right) - getReviewCaseActivityTime(left),
  )
}

export function groupTradesByMonth(trades: Trade[]): TradeMonthGroup[] {
  const groups = new Map<string, Trade[]>()

  for (const trade of trades) {
    const date = new Date(trade.openedAt)
    const valid = Number.isFinite(date.getTime())
    const year = valid ? date.getFullYear() : 0
    const month = valid ? date.getMonth() + 1 : 0
    const key = valid ? `${year}-${String(month).padStart(2, '0')}` : 'unknown'
    const items = groups.get(key) ?? []
    items.push(trade)
    groups.set(key, items)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === 'unknown') return 1
      if (right === 'unknown') return -1
      return right.localeCompare(left)
    })
    .map(([key, items]) => {
      const [year, month] = key.split('-').map(Number)
      return {
        key,
        label: key === 'unknown' ? '日期未知' : `${year}年${month}月`,
        items: sortTradesByOpenedAtDesc(items),
      }
    })
}

export function getVisibleTradeTags(trade: Trade, limit = 2) {
  const safeLimit = Math.max(0, limit)
  const tags = trade.tags.filter((tag) => !sessionMetaFromValue(tag))
  return {
    visible: tags.slice(0, safeLimit),
    hidden: tags.slice(safeLimit),
    hiddenCount: Math.max(0, tags.length - safeLimit),
  }
}

export function filterTradesByFacets(trades: Trade[], facets: TradeFacetFilters): Trade[] {
  return trades.filter((trade) => {
    if (facets.symbol && trade.symbol !== facets.symbol) return false
    if (facets.side && trade.side !== facets.side) return false
    if (facets.status && trade.status !== facets.status) return false
    if (facets.tag && !trade.tags.includes(facets.tag)) return false
    if (facets.mistakeTag && !trade.mistakeTags.includes(facets.mistakeTag)) return false
    if (facets.reviewCategory && trade.reviewCategory !== facets.reviewCategory) return false
    if (facets.session && getTradeSessionMeta(trade)?.kind !== facets.session) return false
    if (facets.period && !tradeInPeriod(trade, facets.period)) return false
    if (facets.strategyId && trade.strategyId !== facets.strategyId) return false
    return true
  })
}

export function intersectSelectedTradeIds(selectedIds: Set<string>, visibleTrades: Trade[]) {
  const visibleIds = new Set(visibleTrades.map((trade) => trade.id))
  return new Set([...selectedIds].filter((id) => visibleIds.has(id)))
}

export function routeWithSearch(pathname: string, search: string) {
  const normalizedSearch = search
    ? search.startsWith('?')
      ? search
      : `?${search}`
    : ''
  return { pathname, search: normalizedSearch }
}
