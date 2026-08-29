import { canonicalizeTradeViewSearch, normalizeSavedViewPath } from '@/lib/savedTradeViews'
import type { Strategy } from '@/data/strategies'
import { isValidPeriodSlug } from '@/lib/periods'
import { listPathFromLegacyTablePath } from '@/lib/routeContext'
import {
  isCapabilityEnabledForWorkspace,
  type SidebarCapabilityId,
  type SidebarQuickWorkspace,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'

export type WorkspaceKind = 'today' | 'trade' | 'paper' | 'case' | 'historical-trade' | 'historical-case'
export type RememberableWorkspaceKind = 'today' | 'trade' | 'case'

export type WorkspaceRouteMemory = {
  pathname: string
  search: string
}

export type WorkspaceViewTarget = {
  id: string
  label: string
  pathname: string
  search?: string
}

/** 定义快捷视图身份的 query（临时 facet 如 symbol/tag 不在此列） */
export const WORKSPACE_VIEW_QUERY_KEYS = [
  'status',
  'session',
  'period',
  'reviewCategory',
  'caseType',
  'masteryState',
  // range 仅在仪表盘/策略分析页生效；kind 已提升为跨页公共上下文。
  'range',
  'view',
  'caseScope',
] as const

const PRIMARY_VIEWS: Record<WorkspaceKind, readonly WorkspaceViewTarget[]> = {
  today: [{ id: 'today', label: '今日', pathname: '/today-record' }],
  trade: [
    { id: 'all', label: '全部', pathname: '/list' },
    { id: 'week', label: '本周', pathname: '/list', search: '?period=this-week' },
    { id: 'month', label: '本月', pathname: '/list', search: '?period=this-month' },
    { id: 'loss', label: '亏损', pathname: '/list', search: '?status=loss' },
    { id: 'starred', label: '星标交易', pathname: '/list', search: '?view=starred' },
    { id: 'missed', label: '错过机会', pathname: '/list', search: '?view=missed' },
  ],
  paper: [
    { id: 'all', label: '全部', pathname: '/sim' },
    { id: 'planned', label: '待执行', pathname: '/sim', search: '?status=planned' },
    { id: 'open', label: '进行中', pathname: '/sim', search: '?status=open' },
    { id: 'missed', label: '错过机会', pathname: '/sim', search: '?status=missed' },
    { id: 'loss', label: '亏损复盘', pathname: '/sim', search: '?status=loss' },
  ],
  case: [
    { id: 'all', label: '全部', pathname: '/review-cases' },
    { id: 'exemplar', label: '交易案例', pathname: '/review-cases/exemplar' },
    { id: 'focus', label: '重点案例', pathname: '/review-cases/focus' },
    { id: 'mistakes', label: '错题', pathname: '/review-cases/mistakes' },
    { id: 'unreviewed', label: '待复看', pathname: '/review-cases/unreviewed' },
    { id: 'reviewed', label: '已掌握', pathname: '/review-cases/reviewed' },
  ],
  'historical-trade': [
    { id: 'all', label: '全部', pathname: '/live-history' },
    { id: 'week', label: '本周', pathname: '/live-history', search: '?period=this-week' },
    { id: 'month', label: '本月', pathname: '/live-history', search: '?period=this-month' },
    { id: 'loss', label: '亏损', pathname: '/live-history', search: '?status=loss' },
    { id: 'historical-cases', label: '关联案例', pathname: '/live-history', search: '?view=cases' },
  ],
  'historical-case': [
    { id: 'historical-trades', label: '实盘记录', pathname: '/live-history' },
    { id: 'cases-all', label: '全部', pathname: '/live-history', search: '?view=cases' },
    { id: 'focus', label: '重点', pathname: '/live-history', search: '?view=cases&caseScope=focus' },
    { id: 'mistakes', label: '错题', pathname: '/live-history', search: '?view=cases&caseScope=mistakes' },
    { id: 'unreviewed', label: '待复看', pathname: '/live-history', search: '?view=cases&caseScope=unreviewed' },
    { id: 'reviewed', label: '已掌握', pathname: '/live-history', search: '?view=cases&caseScope=reviewed' },
  ],
}

function quickWorkspaceForKind(kind: WorkspaceKind): SidebarQuickWorkspace | null {
  if (kind === 'trade' || kind === 'historical-trade') return 'trade'
  if (kind === 'paper') return 'paper'
  if (kind === 'case' || kind === 'historical-case') return 'case'
  return null
}

/** 快捷视图 id 与侧栏跨工作区能力的对应关系 */
export function capabilityForWorkspaceViewId(viewId: string): SidebarCapabilityId | null {
  if (viewId === 'missed' || viewId.endsWith('-missed')) return 'missed'
  if (viewId === 'active' || viewId === 'open') return 'active'
  return null
}

/** 按侧栏能力范围过滤快捷视图；错过的机会始终保留来源工作区本地入口。 */
export function filterViewsBySidebarCapabilities(
  kind: WorkspaceKind,
  views: readonly WorkspaceViewTarget[],
  sidebarItems?: readonly SidebarWorkspaceItem[],
): WorkspaceViewTarget[] {
  if (!sidebarItems) return [...views]
  const workspace = quickWorkspaceForKind(kind)
  if (!workspace) return [...views]
  return views.filter((view) => {
    const capability = capabilityForWorkspaceViewId(view.id)
    if (!capability || capability === 'missed') return true
    return isCapabilityEnabledForWorkspace(sidebarItems, capability, workspace)
  })
}

export function getWorkspacePrimaryViews(
  kind: WorkspaceKind,
  sidebarItems?: readonly SidebarWorkspaceItem[],
): readonly WorkspaceViewTarget[] {
  return filterViewsBySidebarCapabilities(kind, PRIMARY_VIEWS[kind], sidebarItems)
}

export function matchesWorkspaceView(
  target: WorkspaceViewTarget,
  pathname: string,
  search: string,
): boolean {
  if (normalizeSavedViewPath(pathname) !== target.pathname) return false
  const current = new URLSearchParams(search)
  const required = new URLSearchParams(target.search ?? '')
  if (![...required.entries()].every(([key, value]) => current.get(key) === value)) return false
  if (target.id === 'all') {
    current.delete('liveStage')
    current.delete('kind')
    // 策略是页面上下文，不是快捷视图身份；仅带策略时仍属于“全部”。
    current.delete('strategyId')
    return ![...current.values()].some((value) => value.trim())
  }
  // 「全部」等无 search 的基视图：有 status/session 等视图身份参数时不得误选中
  if (required.size === 0) {
    return !WORKSPACE_VIEW_QUERY_KEYS.some((key) => Boolean(current.get(key)?.trim()))
  }
  return true
}

export function getActiveWorkspaceView(
  kind: WorkspaceKind,
  pathname: string,
  search: string,
  sidebarItems?: readonly SidebarWorkspaceItem[],
): WorkspaceViewTarget | undefined {
  return [...getWorkspacePrimaryViews(kind, sidebarItems)]
    .filter((target) => matchesWorkspaceView(target, pathname, search))
    .sort((left, right) => {
      const leftSpecificity = new URLSearchParams(left.search ?? '').size
      const rightSpecificity = new URLSearchParams(right.search ?? '').size
      return rightSpecificity - leftSpecificity
    })[0]
}

/** 「全部」清除所有筛选；其他快捷视图替换身份参数并保留临时筛选。 */
export function searchForWorkspaceViewTarget(
  currentSearch: string | URLSearchParams,
  target: Pick<WorkspaceViewTarget, 'id' | 'search'>,
): string {
  if (target.id === 'all') {
    const source = typeof currentSearch === 'string'
      ? new URLSearchParams(currentSearch)
      : currentSearch
    const next = new URLSearchParams()
    for (const key of ['liveStage', 'kind', 'strategyId']) {
      const value = source.get(key)
      if (value) next.set(key, value)
    }
    const text = next.toString()
    return text ? `?${text}` : ''
  }
  const next = canonicalizeTradeViewSearch(
    typeof currentSearch === 'string' ? currentSearch : currentSearch.toString(),
  )
  for (const key of WORKSPACE_VIEW_QUERY_KEYS) next.delete(key)
  for (const [key, value] of new URLSearchParams(target.search ?? '')) next.set(key, value)
  const text = next.toString()
  return text ? `?${text}` : ''
}

export function isSavedViewInWorkspace(
  view: { pathname: string },
  kind: WorkspaceKind,
): boolean {
  const pathname = normalizeSavedViewPath(view.pathname)
  if (kind === 'historical-trade' || kind === 'historical-case') return pathname === '/live-history'
  if (kind === 'today') return pathname === '/today-record'
  if (kind === 'case') return pathname.startsWith('/review-cases')
  if (kind === 'paper') return pathname === '/sim'
  return (
    pathname === '/list' ||
    pathname.startsWith('/period/') ||
    pathname.startsWith('/strategy/') ||
    pathname === '/active' ||
    pathname === '/favorites' ||
    pathname === '/missed'
  )
}

export function isTodayWorkspaceEntryPath(pathname: string): boolean {
  return normalizeSavedViewPath(pathname) === '/today-record'
}

/** 侧栏「交易日志」可记忆的列表路径（不含今日记录 / 模拟 / 详情） */
export function isTradeWorkspaceEntryPath(pathname: string): boolean {
  const p = normalizeSavedViewPath(pathname)
  if (p === '/list' || p === '/active' || p === '/favorites' || p === '/missed') return true
  const period = p.match(/^\/period\/([^/]+)$/)?.[1]
  if (period) return isValidPeriodSlug(period)
  return /^\/strategy\/[^/]+$/.test(p)
}

export function isCaseWorkspaceEntryPath(pathname: string): boolean {
  const p = normalizeSavedViewPath(pathname)
  return PRIMARY_VIEWS.case.some((view) => view.pathname === p)
}

export function isPaperWorkspaceEntryPath(pathname: string): boolean {
  return normalizeSavedViewPath(pathname) === '/sim'
}

export function rememberableWorkspaceKind(pathname: string): RememberableWorkspaceKind | null {
  if (isTodayWorkspaceEntryPath(pathname)) return 'today'
  if (isCaseWorkspaceEntryPath(pathname)) return 'case'
  if (isTradeWorkspaceEntryPath(pathname)) return 'trade'
  return null
}

export function resolveWorkspaceNavTarget(
  kind: WorkspaceKind,
  memory: WorkspaceRouteMemory | null | undefined,
  strategies?: readonly Pick<Strategy, 'id'>[],
): WorkspaceRouteMemory {
  const fallback: WorkspaceRouteMemory =
    kind === 'today'
      ? { pathname: '/today-record', search: '' }
      : kind === 'case'
        ? { pathname: '/review-cases', search: '' }
        : kind === 'paper'
          ? { pathname: '/sim', search: '' }
          : { pathname: '/list', search: '' }
  if (!memory?.pathname) return fallback
  const pathname = listPathFromLegacyTablePath(memory.pathname) ?? memory.pathname
  if (kind === 'today' && !isTodayWorkspaceEntryPath(pathname)) return fallback
  if (kind === 'trade' && !isTradeWorkspaceEntryPath(pathname)) return fallback
  if (kind === 'case' && !isCaseWorkspaceEntryPath(pathname)) return fallback
  if (kind === 'paper' && !isPaperWorkspaceEntryPath(pathname)) return fallback
  if (kind === 'trade' && strategies) {
    const strategyMatch = normalizeSavedViewPath(pathname).match(/^\/strategy\/([^/]+)$/)
    if (strategyMatch) {
      let strategyId: string
      try {
        strategyId = decodeURIComponent(strategyMatch[1])
      } catch {
        return fallback
      }
      if (!strategies.some((strategy) => strategy.id === strategyId)) return fallback
    }
  }
  return {
    pathname,
    search: memory.search ?? '',
  }
}

export function workspaceRouteHref(route: WorkspaceRouteMemory): string {
  return `${route.pathname}${route.search ?? ''}`
}
