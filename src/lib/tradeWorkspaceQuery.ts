import type { LiveStage } from '@/lib/liveStages'
import type { ListFilter, ListFilterType } from '@/lib/tradeFilters'
import { isKnownTradeViewParam } from '@/lib/tradeViewParams'

export type TradeWorkspacePage = 'log' | 'stats' | 'review'
export type TradeWorkspaceKind = 'all' | 'live' | 'paper'
export type TradeWorkspaceView = 'all' | 'active' | 'starred' | 'missed' | 'incomplete'

export type TradeWorkspaceQuery = {
  stage: 'current' | 'all-history' | string
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
  const stage = requestedStage === 'all-history' || (requestedStage && archivedIds.has(requestedStage))
    ? requestedStage
    : 'current'
  const requestedKind = params.get('kind')
  let kind = KINDS.has(requestedKind as TradeWorkspaceKind)
    ? requestedKind as TradeWorkspaceKind
    : 'live'
  if (stage !== 'current') kind = 'live'
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
  if (next.get('scope') === 'history' && !next.get('liveStage')) next.set('liveStage', 'all-history')
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
  if (query.kind === 'all' && query.stage === 'current') return { type }
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
    if (value) next.set(key, value)
  }
  const text = next.toString()
  return text ? `?${text}` : ''
}
