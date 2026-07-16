import { listPathFromLegacyTablePath } from '@/lib/routeContext'
import { CALENDAR_PERIODS, PERIOD_LABELS } from '@/lib/periods'

export type SavedTradeView = {
  id: string
  name: string
  pathname: string
  search: Record<string, string>
  pinned: boolean
  order: number
  createdAt: string
  updatedAt: string
}

const STATUS_LABELS: Record<string, string> = {
  planned: '计划中',
  open: '进行中',
  missed: '错过机会',
  win: '盈利',
  loss: '亏损',
  breakeven: '保本',
}

const SESSION_LABELS: Record<string, string> = {
  london: '伦敦盘',
  'new-york': '纽约盘',
  asia: '亚盘',
  outside: '盘外时段',
  other: '其他时段',
}

const CATEGORY_LABELS: Record<string, string> = {
  normal: '普通',
  mistake: '错题集',
  focus: '重点案例',
  ambiguous: '模棱两可',
  recheck: '待复看',
  mastered: '已掌握',
}

const CASE_TYPE_LABELS: Record<string, string> = {
  exemplar: '优秀范例',
  mistake: '错误案例',
  ambiguous: '模糊决策',
  missed: '错过机会',
}

const MASTERY_LABELS: Record<string, string> = {
  new: '新案例',
  recheck: '待复看',
  mastered: '已掌握',
}

const TRADE_KIND_LABELS: Record<string, string> = {
  live: '实盘',
  paper: '模拟',
}

const ENUM_FACET_VALUES: Record<string, readonly string[]> = {
  tradeKind: Object.keys(TRADE_KIND_LABELS),
  side: ['long', 'short'],
  status: Object.keys(STATUS_LABELS),
  reviewCategory: Object.keys(CATEGORY_LABELS),
  caseType: Object.keys(CASE_TYPE_LABELS),
  masteryState: Object.keys(MASTERY_LABELS),
  session: Object.keys(SESSION_LABELS),
  period: CALENDAR_PERIODS,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 清理已知单选 facet，保留 symbol/tag/source 等自由文本或未来参数。 */
export function canonicalizeTradeViewSearch(
  search: string | URLSearchParams | Record<string, string>,
): URLSearchParams {
  const params = new URLSearchParams(
    search instanceof URLSearchParams ? search.toString() : search,
  )
  for (const [key, allowed] of Object.entries(ENUM_FACET_VALUES)) {
    const raw = params.get(key)
    const value = raw?.trim()
    if (!value || !allowed.includes(value)) {
      params.delete(key)
      continue
    }
    if (raw !== value || params.getAll(key).length > 1) params.set(key, value)
  }
  return params
}

export function normalizeSavedViewPath(pathname: string): string {
  const clean = pathname.trim().split(/[?#]/, 1)[0] || '/list'
  const legacyListPath = listPathFromLegacyTablePath(clean)
  if (legacyListPath) return legacyListPath
  if (clean === '/board') return '/list'
  const withoutMode = clean.replace(/\/board\/?$/, '')
  const withLeadingSlash = withoutMode.startsWith('/') ? withoutMode : `/${withoutMode}`
  const normalized = withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, '')
    : withLeadingSlash
  if (normalized === '/paper' || normalized === '/practice') return '/sim'
  return normalized
}

function normalizeSearch(search: unknown): Record<string, string> {
  if (!isRecord(search)) return {}
  const normalized = Object.fromEntries(
    Object.entries(search)
      .filter((entry): entry is [string, string] => {
        const [key, value] = entry
        return Boolean(key.trim()) && typeof value === 'string' && Boolean(value.trim())
      })
      .map(([key, value]) => [key.trim(), value.trim()])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  return searchParamsToRecord(new URLSearchParams(normalized))
}

export function searchParamsToRecord(searchParams: URLSearchParams): Record<string, string> {
  return Object.fromEntries(
    [...canonicalizeTradeViewSearch(searchParams).entries()]
      .filter(([key, value]) => Boolean(key.trim()) && Boolean(value.trim()))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function savedViewSearch(view: SavedTradeView): string {
  const search = canonicalizeTradeViewSearch(view.search).toString()
  return search ? `?${search}` : ''
}

export function normalizeSavedTradeViews(value: unknown): SavedTradeView[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .filter(isRecord)
    .map((item): SavedTradeView | null => {
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      if (!id || !name || seen.has(id)) return null
      seen.add(id)
      const now = new Date().toISOString()
      return {
        id,
        name: name.slice(0, 24),
        pathname: normalizeSavedViewPath(
          typeof item.pathname === 'string' ? item.pathname : '/list',
        ),
        search: normalizeSearch(item.search),
        pinned: item.pinned === true,
        order: typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : 0,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : now,
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : now,
      }
    })
    .filter((item): item is SavedTradeView => item !== null)
    .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt))
}

export function mergeSavedTradeViews(
  current: SavedTradeView[],
  imported: SavedTradeView[],
): SavedTradeView[] {
  const merged = new Map(normalizeSavedTradeViews(current).map((view) => [view.id, view]))
  for (const view of normalizeSavedTradeViews(imported)) {
    const existing = merged.get(view.id)
    if (!existing || view.updatedAt > existing.updatedAt) merged.set(view.id, view)
  }
  return normalizeSavedTradeViews([...merged.values()])
}

export function savedViewMatchesLocation(
  view: SavedTradeView,
  pathname: string,
  search: string | URLSearchParams,
): boolean {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  return (
    normalizeSavedViewPath(view.pathname) === normalizeSavedViewPath(pathname) &&
    new URLSearchParams(normalizeSearch(view.search)).toString() ===
      new URLSearchParams(searchParamsToRecord(params)).toString()
  )
}

function routeLabel(pathname: string): string | null {
  const path = normalizeSavedViewPath(pathname)
  if (path === '/today-record') return '今日'
  if (path === '/period/this-week') return '本周'
  if (path === '/period/last-week') return '上周'
  if (path === '/period/this-month') return '本月'
  if (path === '/period/last-month') return '上月'
  if (path === '/active') return '进行中'
  if (path === '/favorites') return '星标交易'
  if (path === '/missed') return '错过机会'
  if (path === '/sim') return '模拟'
  if (path.startsWith('/review-cases/mistakes')) return '错题集'
  if (path.startsWith('/review-cases/focus')) return '重点案例'
  if (path.startsWith('/review-cases')) return '案例记录'
  return null
}

export function suggestSavedViewName(
  pathname: string,
  params: URLSearchParams,
  strategyName?: string,
): string {
  const canonical = canonicalizeTradeViewSearch(params)
  const labels = [routeLabel(pathname)]
  const period = canonical.get('period')
  const strategyId = canonical.get('strategyId')
  const status = canonical.get('status')
  const session = canonical.get('session')
  const category = canonical.get('reviewCategory')
  const caseType = canonical.get('caseType')
  const masteryState = canonical.get('masteryState')
  const tradeKind = canonical.get('tradeKind')
  if (period) {
    labels.push(PERIOD_LABELS[period as keyof typeof PERIOD_LABELS] ?? period)
  }
  if (strategyId) labels.push(strategyName?.trim() || strategyId)
  if (status) labels.push(STATUS_LABELS[status] ?? status)
  if (category) labels.push(CATEGORY_LABELS[category] ?? category)
  if (caseType) labels.push(CASE_TYPE_LABELS[caseType] ?? caseType)
  if (masteryState) labels.push(MASTERY_LABELS[masteryState] ?? masteryState)
  if (tradeKind) labels.push(TRADE_KIND_LABELS[tradeKind] ?? tradeKind)
  if (session) labels.push(SESSION_LABELS[session] ?? session)
  for (const key of ['symbol', 'side', 'tag', 'mistakeTag']) {
    const value = canonical.get(key)
    if (value) labels.push(key === 'side' ? (value === 'long' ? '做多' : '做空') : value)
  }
  return labels.filter((label): label is string => Boolean(label)).join(' · ') || '我的视图'
}
