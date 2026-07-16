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

export type SidebarTarget =
  | { kind: 'system'; id: SidebarNavId }
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

function normalizeTarget(value: unknown): SidebarTarget | null {
  if (!value || typeof value !== 'object') return null
  const target = value as Record<string, unknown>

  if (target.kind === 'system' && SYSTEM_IDS.includes(target.id as SidebarNavId)) {
    return { kind: 'system', id: target.id as SidebarNavId }
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

  const seenTargets = new Set<string>()
  const seenIds = new Set<string>()
  let pinnedCount = 0
  return normalized.flatMap(({ item }) => {
    const key = sidebarTargetKey(item.target)
    if (seenTargets.has(key) || seenIds.has(item.id)) return []
    seenTargets.add(key)
    seenIds.add(item.id)
    let placement = item.placement
    if (placement === 'pinned') {
      if (pinnedCount >= MAX_PINNED_SIDEBAR_ITEMS) placement = 'overflow'
      pinnedCount += 1
    }
    return [{ ...item, placement, order: seenIds.size - 1 }]
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
      target: { kind: 'system' as const, id },
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
): ResolvedSidebarWorkspaceItem {
  const target = item.target
  const key = sidebarTargetKey(target)
  if (target.kind === 'system') {
    const nav = SECONDARY_NAV.find((candidate) => candidate.id === target.id)!
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
  if (path.startsWith('/review-cases')) return 'reviewCases'
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
    .filter(
      (item) =>
        normalizeTargetPath(item.pathname) === pathname &&
        canonicalSearch(item.search) === canonicalSearch(options.search),
    )
    .sort((left, right) => Number(right.item.target.kind === 'saved-view') - Number(left.item.target.kind === 'saved-view'))[0]
  if (exact) return { activeWorkspaceItemId: exact.item.id }

  const modified = validItems
    .filter(
      (item) =>
        normalizeTargetPath(item.pathname) === pathname &&
        isStrictSearchSubset(item.search, options.search),
    )
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
  if (path === '/favorites') return { type: 'starred' }
  if (path === '/missed') return { type: 'missed' }
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
      analysisScope: parsedScope.explicit ? parsedScope.scope : undefined,
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
