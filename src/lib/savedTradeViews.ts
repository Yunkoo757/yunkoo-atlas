import { listPathFromLegacyTablePath } from '@/lib/routeContext'

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
}

const CATEGORY_LABELS: Record<string, string> = {
  mistake: '错题集',
  focus: '重点案例',
  ambiguous: '模棱两可',
  recheck: '待复看',
  mastered: '已掌握',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeSavedViewPath(pathname: string): string {
  const clean = pathname.trim().split(/[?#]/, 1)[0] || '/list'
  const legacyListPath = listPathFromLegacyTablePath(clean)
  if (legacyListPath) return legacyListPath
  if (clean === '/board') return '/list'
  const withoutMode = clean.replace(/\/board\/?$/, '')
  return withoutMode.startsWith('/') ? withoutMode : `/${withoutMode}`
}

function normalizeSearch(search: unknown): Record<string, string> {
  if (!isRecord(search)) return {}
  return Object.fromEntries(
    Object.entries(search)
      .filter((entry): entry is [string, string] => {
        const [key, value] = entry
        return Boolean(key.trim()) && typeof value === 'string' && Boolean(value.trim())
      })
      .map(([key, value]) => [key.trim(), value.trim()])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function searchParamsToRecord(searchParams: URLSearchParams): Record<string, string> {
  return Object.fromEntries(
    [...searchParams.entries()]
      .filter(([key, value]) => Boolean(key.trim()) && Boolean(value.trim()))
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function savedViewSearch(view: SavedTradeView): string {
  const search = new URLSearchParams(view.search).toString()
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

export function suggestSavedViewName(pathname: string, params: URLSearchParams): string {
  const labels = [routeLabel(pathname)]
  const status = params.get('status')
  const session = params.get('session')
  const category = params.get('reviewCategory')
  if (status) labels.push(STATUS_LABELS[status] ?? status)
  if (category) labels.push(CATEGORY_LABELS[category] ?? category)
  if (session) labels.push(SESSION_LABELS[session] ?? session)
  for (const key of ['symbol', 'side', 'tag', 'mistakeTag']) {
    const value = params.get(key)
    if (value) labels.push(key === 'side' ? (value === 'long' ? '做多' : '做空') : value)
  }
  return labels.filter((label): label is string => Boolean(label)).join(' · ') || '我的视图'
}
