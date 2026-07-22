import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import {
  savedViewSearch,
  normalizeSavedViewPath,
  type SavedTradeView,
} from '@/lib/savedTradeViews'
import { PRIMARY_NAV, SECONDARY_NAV, type PrimarySidebarNavId, type SidebarNavId } from '@/lib/sidebarNav'
import type { DisplayPrefs, ListFilter, ReviewCaseScope } from '@/lib/tradeFilters'
import { isValidPeriodSlug } from '@/lib/periods'
import { parseAnalysisScope } from '@/lib/analysisScope'
import { countWorkbenchVisibleTrades } from '@/lib/workbenchTrades'

/** 可跨工作区配置可见范围的侧栏能力 */
export type SidebarCapabilityId = 'missed' | 'active'
export type SidebarQuickWorkspace = 'trade' | 'paper' | 'case'

export type SidebarTarget =
  | { kind: 'system'; id: SidebarNavId; workspaces?: SidebarQuickWorkspace[] }
  | { kind: 'saved-view'; viewId: string }
  | { kind: 'strategy'; strategyId: string }
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
}

export const SIDEBAR_QUICK_WORKSPACE_LABELS: Record<SidebarQuickWorkspace, string> = {
  trade: '交易日志',
  paper: '模拟回测',
  case: '案例记录',
}

export const SIDEBAR_CAPABILITY_LABELS: Record<SidebarCapabilityId, string> = {
  missed: '错过的机会',
  active: '进行中',
}

export const SIDEBAR_CAPABILITY_WORKSPACES: Record<SidebarCapabilityId, readonly SidebarQuickWorkspace[]> = {
  missed: ['trade', 'paper', 'case'],
  active: ['trade', 'paper'],
}

const CAPABILITY_ROUTES: Record<
  `${SidebarQuickWorkspace}:${SidebarCapabilityId}`,
  { pathname: string; search: string; icon: ResolvedSidebarWorkspaceItem['icon'] } | null
> = {
  'trade:missed': { pathname: '/missed', search: '', icon: 'missed' },
  'trade:active': { pathname: '/active', search: '', icon: 'active' },
  'paper:missed': { pathname: '/sim', search: '?status=missed', icon: 'missed' },
  'paper:active': { pathname: '/sim', search: '?status=open', icon: 'active' },
  'case:missed': { pathname: '/review-cases', search: '?caseType=missed', icon: 'missed' },
  'case:active': null,
}

export type SidebarCountContext = {
  trades: Trade[]
  starredIds: string[]
  display: DisplayPrefs
}

export const MAX_PINNED_SIDEBAR_ITEMS = 8

const SYSTEM_IDS: readonly SidebarNavId[] = ['active', 'favorites', 'missed', 'paper']
const CASE_SCOPES: readonly Exclude<ReviewCaseScope, 'all'>[] = [
  'focus',
  'mistakes',
  'unreviewed',
  'reviewed',
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

/** 能力项的可见工作区；旧数据无字段时默认全开（可被用户收窄） */
export function systemCapabilityWorkspaces(
  target: Extract<SidebarTarget, { kind: 'system' }>,
): SidebarQuickWorkspace[] {
  if (!isSidebarCapabilityId(target.id)) return []
  const allowed = SIDEBAR_CAPABILITY_WORKSPACES[target.id]
  return normalizeWorkspaceList(target.workspaces, allowed, allowed)
}

/** 侧栏是否钉了该能力，且指定工作区在可见范围内 */
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

/** 按当前所在工作区解析能力入口；当前域未开启则回落到第一个可见域 */
export function resolveCapabilityNavRoute(
  capability: SidebarCapabilityId,
  workspaces: readonly SidebarQuickWorkspace[],
  currentPathname = '/list',
): { pathname: string; search: string; icon: ResolvedSidebarWorkspaceItem['icon'] } {
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
    return { kind: 'strategy', strategyId: target.strategyId }
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

  // 同一能力只保留一项，合并可见工作区（避免侧栏出现多个「错过的机会」）
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
}

export function resolveSidebarWorkspaceItem(
  item: SidebarWorkspaceItem,
  sources: { savedViews: SavedTradeView[]; strategies: Strategy[] },
  currentPathname = '/list',
): ResolvedSidebarWorkspaceItem {
  const target = item.target
  const key = sidebarTargetKey(target)
  if (target.kind === 'system') {
    const nav = SECONDARY_NAV.find((candidate) => candidate.id === target.id)!
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
    }
  }
  if (target.kind === 'strategy') {
    const strategy = sources.strategies.find((candidate) => candidate.id === target.strategyId)
    return {
      item,
      key,
      label: strategy?.name ?? '已删除的策略',
      pathname: `/strategy/${encodeURIComponent(target.strategyId)}`,
      search: '',
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

function isStrictSearchSubset(targetSearch: string, currentSearch: string): boolean {
  const target = new URLSearchParams(targetSearch)
  const current = new URLSearchParams(currentSearch)
  if (canonicalSearch(targetSearch) === canonicalSearch(currentSearch)) return false
  return [...target.entries()].every(([key, value]) => current.getAll(key).includes(value))
}

function primaryIdForPath(pathname: string): PrimarySidebarNavId | undefined {
  const path = normalizeTargetPath(pathname)
  if (path === '/today-record') return 'today'
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
  return PRIMARY_NAV.find((item) => normalizeTargetPath(item.to) === path)?.id
}

function routesMatch(
  leftPath: string,
  leftSearch: string,
  rightPath: string,
  rightSearch: string,
): boolean {
  return (
    normalizeTargetPath(leftPath) === normalizeTargetPath(rightPath) &&
    canonicalSearch(leftSearch) === canonicalSearch(rightSearch)
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
  const validItems = options.items.filter((item) => !item.invalid)

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
  if (exact) return { activeWorkspaceItemId: exact.item.id }

  const modified = validItems
    .filter((item) => {
      const target = item.item.target
      const candidates =
        target.kind === 'system' && isSidebarCapabilityId(target.id)
          ? capabilityNavRoutes(target.id, systemCapabilityWorkspaces(target))
          : [{ pathname: item.pathname, search: item.search }]
      return candidates.some(
        (route) =>
          normalizeTargetPath(route.pathname) === pathname &&
          isStrictSearchSubset(route.search, options.search),
      )
    })
    .sort(
      (left, right) =>
        new URLSearchParams(right.search).size - new URLSearchParams(left.search).size,
    )[0]
  if (modified) {
    return {
      activeWorkspaceItemId: modified.item.id,
      modifiedWorkspaceItemId: modified.item.id,
    }
  }
  return { activePrimaryId: primaryIdForPath(pathname) }
}

function listTargetForPath(pathname: string, search = ''): ListFilter | undefined {
  const path = normalizeTargetPath(pathname)
  if (path === '/list') return { type: 'all', tradeKind: 'live' }
  if (path === '/active') return { type: 'active', tradeKind: 'live' }
  if (path === '/favorites') return { type: 'starred', tradeKind: 'live' }
  if (path === '/missed') return { type: 'missed', tradeKind: 'live' }
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
    return {
      type: 'strategy',
      strategyId: decodeURIComponent(path.slice('/strategy/'.length)),
      ...(parsedScope.explicit
        ? { analysisScope: parsedScope.scope }
        : { tradeKind: 'live' as const }),
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
  return countSidebarRoute(target.pathname, target.search, context)
}

export function countSidebarRoute(
  pathname: string,
  search: string,
  context: SidebarCountContext,
): number | undefined {
  const filter = listTargetForPath(pathname, search)
  if (!filter) return undefined
  return countWorkbenchVisibleTrades({
    ...context,
    filter,
    search,
  })
}