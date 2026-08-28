import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import {
  savedViewSearch,
  normalizeSavedViewPath,
  type SavedTradeView,
} from '@/lib/savedTradeViews'
import {
  PRIMARY_NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
  type PrimarySidebarNavId,
  type SidebarNavId,
} from '@/lib/sidebarNavContract'
import type { DisplayPrefs, ListFilter, ReviewCaseScope } from '@/lib/tradeFilters'
import { isValidPeriodSlug, type BusinessDateAnchor } from '@/lib/periods'
import { parseAnalysisScope } from '@/lib/analysisScope'
import { buildMissedOpportunitySummary } from '@/lib/missedOpportunities'
import { MISSED_OPPORTUNITY_SOURCES, type MissedOpportunitySource } from '@/lib/missedOpportunities'
import { countWorkbenchVisibleTrades } from '@/lib/workbenchTrades'
import { filterStageOwnedRecords, type StageScope } from '@/lib/stageArchive'

/** 可跨工作区配置可见范围的侧栏能力 */
export type SidebarCapabilityId = 'missed' | 'active'
export type SidebarQuickWorkspace = 'trade' | 'paper' | 'case'

export type SidebarTarget =
  | { kind: 'system'; id: SidebarNavId; workspaces?: SidebarQuickWorkspace[] }
  | { kind: 'saved-view'; viewId: string }
  | { kind: 'strategy'; strategyId: string; workspaces?: SidebarQuickWorkspace[] }
  | { kind: 'case-view'; scope: Exclude<ReviewCaseScope, 'all'> }

export type SidebarWorkspaceItem = {
  id: string
  target: SidebarTarget
  placement: 'pinned' | 'overflow'
  order: number
}

export type ResolvedSidebarWorkspaceItem = {
  item: SidebarWorkspaceItem
  key: string
  label: string
  pathname: string
  search: string
  icon: 'active' | 'favorites' | 'missed' | 'paper' | 'saved-view' | 'strategy' | 'case-view'
  invalid: boolean
  inactive?: boolean
}

export const SIDEBAR_QUICK_WORKSPACE_LABELS: Record<SidebarQuickWorkspace, string> = {
  trade: '交易日志',
  paper: '模拟盘',
  case: '案例库',
}

export const STRATEGY_SOURCE_WORKSPACES: readonly SidebarQuickWorkspace[] = ['trade', 'paper', 'case']

export const STRATEGY_SOURCE_LABELS: Record<SidebarQuickWorkspace, string> = {
  trade: '当前实盘',
  paper: '模拟盘',
  case: '案例',
}

export const SIDEBAR_CAPABILITY_LABELS: Record<SidebarCapabilityId, string> = {
  missed: '错过的机会',
  active: '进行中',
}

export const SIDEBAR_CAPABILITY_WORKSPACES: Record<SidebarCapabilityId, readonly SidebarQuickWorkspace[]> = {
  missed: ['trade', 'paper'],
  active: ['trade', 'paper'],
}

const CAPABILITY_ROUTES: Record<
  `${SidebarQuickWorkspace}:${SidebarCapabilityId}`,
  { pathname: string; search: string; icon: ResolvedSidebarWorkspaceItem['icon'] } | null
> = {
  'trade:missed': { pathname: '/missed', search: '', icon: 'missed' },
  'trade:active': { pathname: '/active', search: '', icon: 'active' },
  'paper:missed': { pathname: '/sim', search: '?filter=missed', icon: 'missed' },
  'paper:active': { pathname: '/sim', search: '?filter=active', icon: 'active' },
  'case:missed': { pathname: '/review-cases', search: '?caseType=missed', icon: 'missed' },
  'case:active': null,
}

const MISSED_AGGREGATE_ROUTE = { pathname: '/missed', search: '', icon: 'missed' } as const

export type SidebarCountContext = {
  trades: Trade[]
  starredIds: string[]
  display: DisplayPrefs
  businessDateAnchor?: BusinessDateAnchor
  currentLiveStageId?: string
}

export const MAX_PINNED_SIDEBAR_ITEMS = 8

const SYSTEM_IDS: readonly SidebarNavId[] = ['active', 'favorites', 'missed', 'paper']
const CASE_SCOPES: readonly Exclude<ReviewCaseScope, 'all'>[] = [
  'focus',
  'mistakes',
  'unreviewed',
  'reviewed',
  'exemplar',
  'missed',
]

export function isSidebarCapabilityId(id: string): id is SidebarCapabilityId {
  return id === 'missed' || id === 'active'
}

export function sidebarTargetKey(target: SidebarTarget): string {
  switch (target.kind) {
    case 'system':
      return `system:${target.id}`
    case 'saved-view':
      return `saved-view:${target.viewId}`
    case 'strategy':
      return `strategy:${target.strategyId}`
    case 'case-view':
      return `case-view:${target.scope}`
  }
}

function normalizeWorkspaceList(
  value: unknown,
  allowed: readonly SidebarQuickWorkspace[],
  fallback: readonly SidebarQuickWorkspace[],
): SidebarQuickWorkspace[] {
  const allowedSet = new Set(allowed)
  const parsed = Array.isArray(value)
    ? value.filter((item): item is SidebarQuickWorkspace =>
      typeof item === 'string' && allowedSet.has(item as SidebarQuickWorkspace),
    )
    : []
  const unique = [...new Set(parsed)]
  return unique.length > 0 ? unique : [...fallback]
}

/** 能力项的工作区范围；旧数据无字段时默认包含全部可用来源。 */
export function systemCapabilityWorkspaces(
  target: Extract<SidebarTarget, { kind: 'system' }>,
): SidebarQuickWorkspace[] {
  if (!isSidebarCapabilityId(target.id)) return []
  const allowed = SIDEBAR_CAPABILITY_WORKSPACES[target.id]
  return normalizeWorkspaceList(target.workspaces, allowed, allowed)
}

export function normalizeStrategySources(value: unknown): SidebarQuickWorkspace[] {
  return normalizeWorkspaceList(value, STRATEGY_SOURCE_WORKSPACES, ['trade'])
}

export function strategySources(
  target: Extract<SidebarTarget, { kind: 'strategy' }>,
): SidebarQuickWorkspace[] {
  return normalizeStrategySources(target.workspaces)
}

export function parseStrategySourcesSearch(search: string | URLSearchParams): SidebarQuickWorkspace[] {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search
  const raw = params.get('sources')
  if (!raw) return ['trade']
  return normalizeStrategySources(raw.split(','))
}

export function writeStrategySourcesSearch(sources: readonly SidebarQuickWorkspace[]): string {
  const selected = new Set(normalizeStrategySources(sources))
  const normalized = STRATEGY_SOURCE_WORKSPACES.filter((source) => selected.has(source))
  if (normalized.length === 1 && normalized[0] === 'trade') return ''
  return `?sources=${normalized.join(',')}`
}

export function hasCombinedStrategySources(sources: readonly SidebarQuickWorkspace[]): boolean {
  return sources.some((source) => source !== 'trade') || sources.length !== 1
}

export function setStrategySourceEnabled(
  items: SidebarWorkspaceItem[],
  strategyId: string,
  workspace: SidebarQuickWorkspace,
  enabled: boolean,
): SidebarWorkspaceItem[] {
  const key = `strategy:${strategyId}`
  const existing = items.find((item) => item.id === key || sidebarTargetKey(item.target) === key)
  if (!existing || existing.target.kind !== 'strategy') return items
  const current = strategySources(existing.target)
  const nextWorkspaces = enabled
    ? normalizeStrategySources([...current, workspace])
    : current.filter((item) => item !== workspace)
  if (nextWorkspaces.length === 0) return items
  return normalizeSidebarWorkspaceItems(
    items.map((item) => (
      item.id === existing.id
        ? { ...item, target: { ...existing.target, workspaces: nextWorkspaces } }
        : item
    )),
  )
}

/** 侧栏是否钉了该能力，且指定工作区在配置范围内 */
export function isCapabilityEnabledForWorkspace(
  items: readonly SidebarWorkspaceItem[],
  capability: SidebarCapabilityId,
  workspace: SidebarQuickWorkspace,
): boolean {
  const item = items.find(
    (candidate) => candidate.target.kind === 'system' && candidate.target.id === capability,
  )
  if (!item || item.target.kind !== 'system') return false
  return systemCapabilityWorkspaces(item.target).includes(workspace)
}

export function setCapabilityWorkspaceEnabled(
  items: SidebarWorkspaceItem[],
  capability: SidebarCapabilityId,
  workspace: SidebarQuickWorkspace,
  enabled: boolean,
): SidebarWorkspaceItem[] {
  if (!resolveCapabilityRoute(capability, workspace)) return items
  const key = `system:${capability}`
  const existing = items.find((item) => item.id === key || sidebarTargetKey(item.target) === key)
  const current = existing && existing.target.kind === 'system'
    ? systemCapabilityWorkspaces(existing.target)
    : []
  let nextWorkspaces = enabled
    ? [...new Set([...current, workspace])]
    : current.filter((item) => item !== workspace)
  nextWorkspaces = nextWorkspaces.filter((item) => Boolean(resolveCapabilityRoute(capability, item)))

  if (nextWorkspaces.length === 0) {
    if (capability === 'missed') return items
    return existing ? items.filter((item) => item.id !== existing.id) : items
  }

  const target: SidebarTarget = {
    kind: 'system',
    id: capability,
    workspaces: nextWorkspaces,
  }

  if (!existing) {
    const pinnedCount = items.filter((item) => item.placement === 'pinned').length
    return normalizeSidebarWorkspaceItems([
      ...items,
      {
        id: key,
        target,
        placement: pinnedCount >= MAX_PINNED_SIDEBAR_ITEMS ? 'overflow' : 'pinned',
        order: items.length,
      },
    ])
  }

  return normalizeSidebarWorkspaceItems(
    items.map((item) => (item.id === existing.id ? { ...item, target } : item)),
  )
}

export function resolveCapabilityRoute(
  capability: SidebarCapabilityId,
  workspace: SidebarQuickWorkspace,
): { pathname: string; search: string; icon: ResolvedSidebarWorkspaceItem['icon'] } | null {
  return CAPABILITY_ROUTES[`${workspace}:${capability}`]
}

export function workspaceKindFromPath(pathname: string): SidebarQuickWorkspace {
  const path = normalizeTargetPath(pathname)
  if (path === '/sim' || path.startsWith('/sim/')) return 'paper'
  if (path.startsWith('/review-cases')) return 'case'
  return 'trade'
}

/** 错过的机会固定进入聚合页；进行中保留当前工作区优先与回退逻辑。 */
export function resolveCapabilityNavRoute(
  capability: SidebarCapabilityId,
  workspaces: readonly SidebarQuickWorkspace[],
  currentPathname = '/list',
): { pathname: string; search: string; icon: ResolvedSidebarWorkspaceItem['icon'] } {
  if (capability === 'missed') return MISSED_AGGREGATE_ROUTE
  const enabled = workspaces
    .map((workspace) => ({ workspace, route: resolveCapabilityRoute(capability, workspace) }))
    .filter((entry): entry is { workspace: SidebarQuickWorkspace; route: NonNullable<typeof entry.route> } =>
      Boolean(entry.route),
    )
  const current = workspaceKindFromPath(currentPathname)
  const preferred = enabled.find((entry) => entry.workspace === current) ?? enabled[0]
  return preferred?.route ?? { pathname: '/list', search: '', icon: 'missed' }
}

export function capabilityNavRoutes(
  capability: SidebarCapabilityId,
  workspaces: readonly SidebarQuickWorkspace[],
): Array<{ pathname: string; search: string }> {
  if (capability === 'missed') {
    return [{ pathname: MISSED_AGGREGATE_ROUTE.pathname, search: MISSED_AGGREGATE_ROUTE.search }]
  }
  return workspaces.flatMap((workspace) => {
    const route = resolveCapabilityRoute(capability, workspace)
    return route ? [{ pathname: route.pathname, search: route.search }] : []
  })
}

function normalizeTarget(value: unknown): SidebarTarget | null {
  if (!value || typeof value !== 'object') return null
  const target = value as Record<string, unknown>

  if (target.kind === 'system' && SYSTEM_IDS.includes(target.id as SidebarNavId)) {
    const id = target.id as SidebarNavId
    if (isSidebarCapabilityId(id)) {
      return {
        kind: 'system',
        id,
        workspaces: systemCapabilityWorkspaces({ kind: 'system', id, workspaces: target.workspaces as SidebarQuickWorkspace[] }),
      }
    }
    return { kind: 'system', id }
  }
  // 兼容上一版误拆成多钉的 quick-view：归一进单一 system 能力项
  if (
    target.kind === 'quick-view' &&
    (target.workspace === 'trade' || target.workspace === 'paper' || target.workspace === 'case') &&
    isSidebarCapabilityId(String(target.view)) &&
    CAPABILITY_ROUTES[`${target.workspace}:${target.view as SidebarCapabilityId}`]
  ) {
    return {
      kind: 'system',
      id: target.view as SidebarCapabilityId,
      workspaces: [target.workspace],
    }
  }
  if (target.kind === 'saved-view' && typeof target.viewId === 'string' && target.viewId.trim()) {
    return { kind: 'saved-view', viewId: target.viewId }
  }
  if (target.kind === 'strategy' && typeof target.strategyId === 'string' && target.strategyId.trim()) {
    return {
      kind: 'strategy',
      strategyId: target.strategyId,
      workspaces: normalizeStrategySources((target as { workspaces?: unknown }).workspaces),
    }
  }
  if (
    target.kind === 'case-view' &&
    CASE_SCOPES.includes(target.scope as Exclude<ReviewCaseScope, 'all'>)
  ) {
    return { kind: 'case-view', scope: target.scope as Exclude<ReviewCaseScope, 'all'> }
  }
  return null
}

function mergeCapabilityWorkspaces(
  left: SidebarQuickWorkspace[] | undefined,
  right: SidebarQuickWorkspace[] | undefined,
  allowed: readonly SidebarQuickWorkspace[],
): SidebarQuickWorkspace[] {
  return normalizeWorkspaceList([...(left ?? []), ...(right ?? [])], allowed, ['trade'])
}

export function normalizeSidebarWorkspaceItems(value: unknown): SidebarWorkspaceItem[] {
  if (!Array.isArray(value)) return []

  const normalized = value.flatMap((candidate, inputIndex) => {
    if (!candidate || typeof candidate !== 'object') return []
    const item = candidate as Record<string, unknown>
    const target = normalizeTarget(item.target)
    if (
      !target ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      (item.placement !== 'pinned' && item.placement !== 'overflow') ||
      typeof item.order !== 'number' ||
      !Number.isFinite(item.order)
    ) {
      return []
    }
    return [
      {
        item: {
          id: item.id,
          target,
          placement: item.placement,
          order: item.order,
        } satisfies SidebarWorkspaceItem,
        inputIndex,
      },
    ]
  })

  normalized.sort((a, b) => a.item.order - b.item.order || a.inputIndex - b.inputIndex)

  // 同一能力只保留一项，合并配置范围（避免侧栏出现多个「错过的机会」）
  const mergedByKey = new Map<string, { item: SidebarWorkspaceItem; inputIndex: number }>()
  for (const entry of normalized) {
    const key = sidebarTargetKey(entry.item.target)
    const existing = mergedByKey.get(key)
    if (!existing) {
      mergedByKey.set(key, entry)
      continue
    }
    const left = existing.item.target
    const right = entry.item.target
    if (left.kind === 'system' && right.kind === 'system' && isSidebarCapabilityId(left.id)) {
      existing.item = {
        ...existing.item,
        placement: existing.item.placement === 'pinned' || entry.item.placement === 'pinned'
          ? 'pinned'
          : 'overflow',
        target: {
          kind: 'system',
          id: left.id,
          workspaces: mergeCapabilityWorkspaces(
            left.workspaces,
            right.workspaces,
            SIDEBAR_CAPABILITY_WORKSPACES[left.id],
          ),
        },
      }
    }
  }

  const merged = [...mergedByKey.values()].sort(
    (a, b) => a.item.order - b.item.order || a.inputIndex - b.inputIndex,
  )

  let pinnedCount = 0
  return merged.map(({ item }, order) => {
    const key = sidebarTargetKey(item.target)
    let placement = item.placement
    if (placement === 'pinned') {
      if (pinnedCount >= MAX_PINNED_SIDEBAR_ITEMS) placement = 'overflow'
      else pinnedCount += 1
    }
    return { ...item, id: key, placement, order }
  })
}

/** 同 placement 组内重排；跨组或找不到则原样返回 */
export function reorderSidebarWorkspaceItem(
  items: SidebarWorkspaceItem[],
  sourceId: string,
  targetId: string,
): SidebarWorkspaceItem[] {
  if (sourceId === targetId) return items
  const source = items.find((item) => item.id === sourceId)
  const target = items.find((item) => item.id === targetId)
  if (!source || !target || source.placement !== target.placement) return items

  const group = items.filter((item) => item.placement === source.placement)
  const fromIndex = group.findIndex((item) => item.id === sourceId)
  const toIndex = group.findIndex((item) => item.id === targetId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items

  const nextGroup = [...group]
  const [moved] = nextGroup.splice(fromIndex, 1)
  nextGroup.splice(toIndex, 0, moved)

  let groupCursor = 0
  const merged = items.map((item) => {
    if (item.placement !== source.placement) return item
    return nextGroup[groupCursor++]!
  })
  return normalizeSidebarWorkspaceItems(merged.map((item, order) => ({ ...item, order })))
}

export function migrateSidebarPins(pins: readonly SidebarNavId[]): SidebarWorkspaceItem[] {
  return normalizeSidebarWorkspaceItems(
    pins.map((id, order) => ({
      id: `system:${id}`,
      target: isSidebarCapabilityId(id)
        ? {
            kind: 'system' as const,
            id,
            workspaces: [...SIDEBAR_CAPABILITY_WORKSPACES[id]],
          }
        : { kind: 'system' as const, id },
      placement: 'pinned' as const,
      order,
    })),
  )
}

const CASE_VIEW_LABELS: Record<Exclude<ReviewCaseScope, 'all'>, string> = {
  focus: '重点',
  mistakes: '错题',
  unreviewed: '待复看',
  reviewed: '已掌握',
  exemplar: '交易案例',
  missed: '错过的案例',
}

export function resolveSidebarWorkspaceItem(
  item: SidebarWorkspaceItem,
  sources: {
    savedViews: SavedTradeView[]
    strategies: Strategy[]
  },
  currentPathname = '/list',
): ResolvedSidebarWorkspaceItem {
  const target = item.target
  const key = sidebarTargetKey(target)
  if (target.kind === 'system') {
    const nav = SECONDARY_NAV_ITEMS.find((candidate) => candidate.id === target.id)!
    if (isSidebarCapabilityId(target.id)) {
      const route = resolveCapabilityNavRoute(
        target.id,
        systemCapabilityWorkspaces(target),
        currentPathname,
      )
      return {
        item,
        key,
        label: nav.label,
        pathname: route.pathname,
        search: route.search,
        icon: route.icon,
        invalid: false,
      }
    }
    return {
      item,
      key,
      label: nav.label,
      pathname: nav.to,
      search: '',
      icon: target.id,
      invalid: false,
    }
  }
  if (target.kind === 'saved-view') {
    const view = sources.savedViews.find((candidate) => candidate.id === target.viewId)
    return {
      item,
      key,
      label: view?.name ?? '已删除的保存视图',
      pathname: view?.pathname ?? '/list',
      search: view ? savedViewSearch(view) : '',
      icon: 'saved-view',
      invalid: !view,
      inactive: false,
    }
  }
  if (target.kind === 'strategy') {
    const strategy = sources.strategies.find((candidate) => candidate.id === target.strategyId)
    return {
      item,
      key,
      label: strategy?.name ?? '已删除的策略',
      pathname: `/strategy/${encodeURIComponent(target.strategyId)}`,
      search: writeStrategySourcesSearch(strategySources(target)),
      icon: 'strategy',
      invalid: !strategy,
    }
  }
  return {
    item,
    key,
    label: CASE_VIEW_LABELS[target.scope],
    pathname: `/review-cases/${target.scope}`,
    search: '',
    icon: 'case-view',
    invalid: false,
  }
}

/**
 * 删除已经找不到来源的保存视图/策略引用，并重新计算顺序与常驻容量。
 * 系统项和案例视图始终可解析，不会在这里被误删。
 */
export function sanitizeSidebarWorkspaceItems(
  items: SidebarWorkspaceItem[],
  sources: {
    savedViews: SavedTradeView[]
    strategies: Strategy[]
  },
): SidebarWorkspaceItem[] {
  return normalizeSidebarWorkspaceItems(
    items.filter((item) => !resolveSidebarWorkspaceItem(item, sources).invalid),
  )
}

function normalizeTargetPath(pathname: string): string {
  const normalized = normalizeSavedViewPath(pathname)
  if (normalized === '/paper' || normalized === '/practice') return '/sim'
  return normalized
}

function canonicalSearch(search: string): string {
  return [...new URLSearchParams(search).entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
    )
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
}

/** 将兼容入口与工作台最终地址收敛为同一导航身份。 */
function canonicalSelectionLocation(pathname: string, search: string): {
  pathname: string
  search: string
} {
  let path = normalizeTargetPath(pathname)
  const params = new URLSearchParams(search)

  const legacyFilter = params.get('filter')
  if (legacyFilter) params.set('view', legacyFilter)
  if (params.get('source') === 'paper') params.set('kind', 'paper')
  params.delete('filter')
  params.delete('source')

  if (path === '/active') {
    path = '/list'
    params.set('view', 'active')
  } else if (path === '/favorites') {
    path = '/list'
    params.set('view', 'starred')
  } else if (path === '/missed') {
    path = '/list'
    params.set('view', 'missed')
  } else if (path === '/today-record') {
    path = '/list'
    params.set('view', 'incomplete')
  } else if (path === '/sim') {
    path = '/list'
    params.set('kind', 'paper')
  }

  return { pathname: path, search: canonicalSearch(params.toString()) }
}

function isStrictSearchSubset(targetSearch: string, currentSearch: string): boolean {
  const target = new URLSearchParams(targetSearch)
  const current = new URLSearchParams(currentSearch)
  if (canonicalSearch(targetSearch) === canonicalSearch(currentSearch)) return false
  return [...target.entries()].every(([key, value]) => current.getAll(key).includes(value))
}

function primaryIdForLocation(pathname: string, search: string): PrimarySidebarNavId | undefined {
  const location = canonicalSelectionLocation(pathname, search)
  const path = location.pathname
  if (path === '/list' && new URLSearchParams(location.search).get('view') === 'incomplete') return 'today'
  if (path === '/notes' || path.startsWith('/notes/')) return 'quickNotes'
  if (path.startsWith('/review-cases')) return 'reviewCases'
  if (path === '/weekly-review') return 'weeklyReview'
  if (path === '/dashboard') return 'dashboard'
  if (
    path === '/list' ||
    path === '/active' ||
    path === '/favorites' ||
    path === '/missed' ||
    path === '/sim' ||
    path.startsWith('/period/') ||
    path.startsWith('/strategy/')
  ) {
    return 'trades'
  }
  return PRIMARY_NAV_ITEMS.find((item) => normalizeTargetPath(item.to) === path)?.id
}

function routesMatch(
  leftPath: string,
  leftSearch: string,
  rightPath: string,
  rightSearch: string,
): boolean {
  const left = canonicalSelectionLocation(leftPath, leftSearch)
  const right = canonicalSelectionLocation(rightPath, rightSearch)
  return (
    left.pathname === right.pathname &&
    left.search === right.search
  )
}

export function resolveSidebarSelection(options: {
  pathname: string
  search: string
  items: ResolvedSidebarWorkspaceItem[]
}): {
  activeWorkspaceItemId?: string
  activePrimaryId?: PrimarySidebarNavId
  modifiedWorkspaceItemId?: string
} {
  const pathname = normalizeTargetPath(options.pathname)
  const currentLocation = canonicalSelectionLocation(pathname, options.search)
  const validItems = options.items.filter((item) => !item.invalid && !item.inactive)

  const exact = validItems
    .filter((item) => {
      const target = item.item.target
      if (target.kind === 'system' && isSidebarCapabilityId(target.id)) {
        return capabilityNavRoutes(target.id, systemCapabilityWorkspaces(target)).some((route) =>
          routesMatch(route.pathname, route.search, pathname, options.search),
        )
      }
      return routesMatch(item.pathname, item.search, pathname, options.search)
    })
    .sort((left, right) => Number(right.item.target.kind === 'saved-view') - Number(left.item.target.kind === 'saved-view'))[0]
  const activePrimaryId = primaryIdForLocation(pathname, options.search)
  if (exact) return { activeWorkspaceItemId: exact.item.id, activePrimaryId }

  const modified = validItems
    .filter((item) => {
      const target = item.item.target
      const candidates =
        target.kind === 'system' && isSidebarCapabilityId(target.id)
          ? capabilityNavRoutes(target.id, systemCapabilityWorkspaces(target))
          : [{ pathname: item.pathname, search: item.search }]
      return candidates.some(
        (route) => {
          const candidate = canonicalSelectionLocation(route.pathname, route.search)
          return candidate.pathname === currentLocation.pathname
            && isStrictSearchSubset(candidate.search, currentLocation.search)
        },
      )
    })
    .sort(
      (left, right) =>
        new URLSearchParams(right.search).size - new URLSearchParams(left.search).size,
    )[0]
  if (modified) {
    return {
      activeWorkspaceItemId: modified.item.id,
      activePrimaryId,
      modifiedWorkspaceItemId: modified.item.id,
    }
  }
  return { activePrimaryId }
}

function listTargetForPath(pathname: string, search = ''): ListFilter | undefined {
  const path = normalizeTargetPath(pathname)
  if (path === '/list') return { type: 'all', tradeKind: 'live' }
  if (path === '/active') return { type: 'active', tradeKind: 'live' }
  if (path === '/favorites') return { type: 'starred', strategySources: ['trade', 'paper'] }
  if (path === '/sim') return { type: 'all', tradeKind: 'paper' }
  if (path === '/today-record') return { type: 'period', period: 'today', tradeKind: 'live' }
  if (path === '/review-cases') {
    return { type: 'all', tradeKind: 'case', reviewCaseScope: 'all' }
  }
  if (path.startsWith('/review-cases/')) {
    const scope = path.slice('/review-cases/'.length)
    if (CASE_SCOPES.includes(scope as Exclude<ReviewCaseScope, 'all'>)) {
      return {
        type: 'all',
        tradeKind: 'case',
        reviewCaseScope: scope as Exclude<ReviewCaseScope, 'all'>,
      }
    }
  }
  if (path.startsWith('/strategy/')) {
    const parsedScope = parseAnalysisScope(search)
    const sources = parseStrategySourcesSearch(search)
    return {
      type: 'strategy',
      strategyId: decodeURIComponent(path.slice('/strategy/'.length)),
      ...(parsedScope.explicit
        ? { analysisScope: parsedScope.scope }
        : hasCombinedStrategySources(sources)
          ? { strategySources: sources }
          : { tradeKind: 'live' as const, strategySources: sources }),
    }
  }
  if (path.startsWith('/period/')) {
    const period = path.slice('/period/'.length)
    if (isValidPeriodSlug(period)) return { type: 'period', period, tradeKind: 'live' }
  }
  return undefined
}

export function countSidebarTarget(
  target: ResolvedSidebarWorkspaceItem,
  context: SidebarCountContext,
): number | undefined {
  if (target.invalid) return undefined
  if (target.item.target.kind === 'system' && target.item.target.id === 'missed') {
    const accountRecords = context.currentLiveStageId
      ? filterStageOwnedRecords(context.trades, { kind: 'current', stageId: context.currentLiveStageId })
          .filter((trade) => trade.tradeKind !== 'case')
      : context.trades.filter((trade) => trade.tradeKind !== 'case')
    const records = [...accountRecords, ...context.trades.filter((trade) => trade.tradeKind === 'case')]
    const configured = systemCapabilityWorkspaces(target.item.target)
    const sources = MISSED_OPPORTUNITY_SOURCES.filter(
      (source): source is MissedOpportunitySource => configured.includes(source),
    )
    return buildMissedOpportunitySummary(
      records,
      sources,
    ).aggregateTotal
  }
  return countSidebarRoute(target.pathname, target.search, context)
}

export function countSidebarRoute(
  pathname: string,
  search: string,
  context: SidebarCountContext,
): number | undefined {
  if (normalizeTargetPath(pathname) === '/favorites') {
    const starred = new Set(context.starredIds)
    return context.trades.filter((trade) => (
      !trade.deletedAt &&
      starred.has(trade.id) &&
      (
        trade.tradeKind === 'paper' ||
        (trade.tradeKind === 'live' && (!context.currentLiveStageId || trade.liveStageId === context.currentLiveStageId))
      )
    )).length
  }
  const filter = listTargetForPath(pathname, search)
  if (!filter) return undefined
  const combinedStrategy = filter.type === 'strategy' && hasCombinedStrategySources(filter.strategySources ?? ['trade'])
  const nextFilter = combinedStrategy && context.currentLiveStageId
    ? { ...filter, liveStageId: context.currentLiveStageId }
    : filter
  const stageScope: StageScope | undefined = combinedStrategy
    ? undefined
    : context.currentLiveStageId && filter.tradeKind !== 'paper' && filter.tradeKind !== 'case'
      ? { kind: 'current', stageId: context.currentLiveStageId }
      : undefined
  return countWorkbenchVisibleTrades({
    ...context,
    filter: nextFilter,
    search,
    stageScope,
  })
}
