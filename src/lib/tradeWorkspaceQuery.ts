import type { LiveStage } from '@/lib/liveStages'
import type { ListFilter, ListFilterType } from '@/lib/tradeFilters'
import { isKnownTradeViewParam } from '@/lib/tradeViewParams'

export type TradeWorkspacePage = 'log' | 'stats' | 'review'
export type TradeWorkspaceKind = 'all' | 'live' | 'paper'
export type TradeWorkspaceView = 'all' | 'active' | 'starred' | 'missed' | 'incomplete'

export type TradeWorkspaceQuery = {
  stage: 'current' | 'all' | 'all-history' | string
  kind: TradeWorkspaceKind
  view: TradeWorkspaceView
}

const VIEWS = new Set<TradeWorkspaceView>(['all', 'active', 'starred', 'missed', 'incomplete'])
const KINDS = new Set<TradeWorkspaceKind>(['all', 'live', 'paper'])
const LEGACY_PAGE: Record<string, TradeWorkspacePage | undefined> = {
  stats: 'stats',
  reviews: 'review',
}

export function tradeWorkspacePageFromSearch(search: string | URLSearchParams): TradeWorkspacePage | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  return LEGACY_PAGE[params.get('section') ?? ''] ?? null
}

export function parseTradeWorkspaceQuery(
  search: string | URLSearchParams,
  stages: readonly LiveStage[],
  currentLiveStageId: string,
): TradeWorkspaceQuery {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const requestedStage = params.get('liveStage')
  const archivedIds = new Set(stages.filter((stage) => stage.status === 'archived').map((stage) => stage.id))
  const stage = requestedStage === 'all-history'
    ? 'all'
    : requestedStage === 'all' || (requestedStage && archivedIds.has(requestedStage))
      ? requestedStage
      : 'current'
  const requestedKind = params.get('kind')
  const kind = KINDS.has(requestedKind as TradeWorkspaceKind)
    ? requestedKind as TradeWorkspaceKind
    : 'live'
  const requestedView = params.get('view')
  const view = VIEWS.has(requestedView as TradeWorkspaceView)
    ? requestedView as TradeWorkspaceView
    : 'all'
  return { stage, kind, view }
}

/** 将旧入口与无效参数收敛为统一工作台查询；返回值可安全写回 URL。 */
export function normalizeTradeWorkspaceSearch(
  search: string | URLSearchParams,
  stages: readonly LiveStage[],
  currentLiveStageId: string,
): URLSearchParams {
  const next = new URLSearchParams(typeof search === 'string' ? search : search.toString())
  if (next.get('scope') === 'history' && !next.get('liveStage')) next.set('liveStage', 'all')
  if (next.get('source') === 'paper') next.set('kind', 'paper')
  if (next.get('tradeKind') === 'live' || next.get('tradeKind') === 'paper') {
    next.set('kind', next.get('tradeKind')!)
  }
  const legacyFilter = next.get('filter')
  if (VIEWS.has(legacyFilter as TradeWorkspaceView)) next.set('view', legacyFilter!)
  const hadExplicitKind = next.has('kind')

  next.delete('section')
  next.delete('scope')
  next.delete('source')
  next.delete('filter')
  next.delete('tradeKind')
  next.delete('liveCycle')
  next.delete('statsCycle')

  const parsed = parseTradeWorkspaceQuery(next, stages, currentLiveStageId)
  if (parsed.stage === 'current') next.delete('liveStage')
  else next.set('liveStage', parsed.stage)
  if (parsed.kind === 'live' && !hadExplicitKind) next.delete('kind')
  else next.set('kind', parsed.kind)
  if (parsed.view === 'all') next.delete('view')
  else next.set('view', parsed.view)

  for (const key of [...next.keys()]) {
    if (!isKnownTradeViewParam(key)) next.delete(key)
  }
  return next
}

export function resolveTradeWorkspaceListFilter(query: TradeWorkspaceQuery): ListFilter {
  const type: ListFilterType = query.view === 'all' ? 'all' : query.view
  if (query.kind === 'all') return { type }
  return { type, tradeKind: query.kind === 'paper' ? 'paper' : 'live' }
}

export function writeTradeWorkspaceContext(
  search: string | URLSearchParams,
  patch: Partial<Pick<TradeWorkspaceQuery, 'stage' | 'kind'>>,
): URLSearchParams {
  const next = new URLSearchParams(typeof search === 'string' ? search : search.toString())
  if (patch.stage !== undefined) {
    if (patch.stage === 'current') next.delete('liveStage')
    else next.set('liveStage', patch.stage)
  }
  if (patch.kind !== undefined) {
    if (patch.kind === 'live') next.delete('kind')
    else next.set('kind', patch.kind)
  }
  return next
}

export function sharedTradeWorkspaceSearch(search: string | URLSearchParams): string {
  const source = typeof search === 'string' ? new URLSearchParams(search) : search
  const next = new URLSearchParams()
  for (const key of ['liveStage', 'kind']) {
    const value = source.get(key)
    if (value) next.set(key, key === 'liveStage' && value === 'all-history' ? 'all' : value)
  }
  const text = next.toString()
  return text ? `?${text}` : ''
}

/** 这些页面共用同一组“阶段 / 记录类型”上下文。 */
export function isSharedTradeWorkspacePath(pathname: string): boolean {
  return pathname === '/list'
    || pathname === '/board'
    || pathname === '/active'
    || pathname === '/favorites'
    || pathname === '/missed'
    || pathname === '/sim'
    || pathname === '/dashboard'
    || pathname === '/weekly-review'
    || pathname.startsWith('/period/')
    || pathname.startsWith('/strategy/')
}

/** 当前页有公共语义时以当前页为准，否则恢复最近一次交易工作区记忆。 */
export function resolveSharedTradeWorkspaceSearch(
  pathname: string,
  search: string | URLSearchParams,
  rememberedSearch: string | URLSearchParams = '',
): string {
  return sharedTradeWorkspaceSearch(
    isSharedTradeWorkspacePath(pathname) ? search : rememberedSearch,
  )
}

/** 把公共上下文写回列表记忆，同时保留列表自己的快捷视图与临时筛选。 */
export function mergeSharedTradeWorkspaceSearch(
  rememberedSearch: string | URLSearchParams,
  contextSearch: string | URLSearchParams,
): string {
  const next = new URLSearchParams(
    typeof rememberedSearch === 'string' ? rememberedSearch : rememberedSearch.toString(),
  )
  const context = new URLSearchParams(sharedTradeWorkspaceSearch(contextSearch))
  for (const key of ['liveStage', 'kind']) {
    next.delete(key)
    const value = context.get(key)
    if (value) next.set(key, value)
  }
  const text = next.toString()
  return text ? `?${text}` : ''
}

/** 返回交易日志首页时只保留阶段；模拟/实盘类型与其他筛选都属于临时视图。 */
export function tradeHomeSearch(search: string | URLSearchParams): string {
  const source = typeof search === 'string' ? new URLSearchParams(search) : search
  const stage = source.get('liveStage')
  if (!stage) return ''
  const next = new URLSearchParams({
    liveStage: stage === 'all-history' ? 'all' : stage,
  })
  return `?${next.toString()}`
}

/**
 * 应用冷启动回到交易日志首页，但恢复用户上次选择的阶段范围。
 * 视图、策略和盘型等临时条件不跨启动恢复，避免重新打开软件时落入旧筛选。
 */
export function tradeHomeHref(search: string | URLSearchParams): string {
  return `/list${tradeHomeSearch(search)}`
}
