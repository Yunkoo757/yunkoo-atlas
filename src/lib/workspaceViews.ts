import { canonicalizeTradeViewSearch, normalizeSavedViewPath } from '@/lib/savedTradeViews'
import type { Strategy } from '@/data/strategies'
import { isValidPeriodSlug } from '@/lib/periods'
import { listPathFromLegacyTablePath } from '@/lib/routeContext'

export type WorkspaceKind = 'today' | 'trade' | 'paper' | 'case'
export type RememberableWorkspaceKind = Exclude<WorkspaceKind, 'paper'>

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
  // 仅在仪表盘/策略分析页生效；切换到普通工作区后必须移除，避免无效 URL 条件。
  'kind',
  'range',
] as const

const PRIMARY_VIEWS: Record<WorkspaceKind, readonly WorkspaceViewTarget[]> = {
  today: [{ id: 'today', label: '今日', pathname: '/today-record' }],
  trade: [
    { id: 'all', label: '全部', pathname: '/list' },
    { id: 'week', label: '本周', pathname: '/period/this-week' },
    { id: 'month', label: '本月', pathname: '/period/this-month' },
    { id: 'loss', label: '亏损', pathname: '/list', search: '?status=loss' },
  ],
  paper: [
    { id: 'all', label: '全部', pathname: '/sim' },
    { id: 'planned', label: '待执行', pathname: '/sim', search: '?status=planned' },
    { id: 'open', label: '进行中', pathname: '/sim', search: '?status=open' },
    { id: 'loss', label: '亏损复盘', pathname: '/sim', search: '?status=loss' },
  ],
  case: [
    { id: 'all', label: '全部', pathname: '/review-cases' },
    { id: 'focus', label: '重点', pathname: '/review-cases/focus' },
    { id: 'mistakes', label: '错题', pathname: '/review-cases/mistakes' },
    { id: 'unreviewed', label: '待复看', pathname: '/review-cases/unreviewed' },
    { id: 'reviewed', label: '已掌握', pathname: '/review-cases/reviewed' },
  ],
}

export function getWorkspacePrimaryViews(kind: WorkspaceKind): readonly WorkspaceViewTarget[] {
  return PRIMARY_VIEWS[kind]
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
): WorkspaceViewTarget | undefined {
  return [...PRIMARY_VIEWS[kind]]
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
  if (target.id === 'all') return ''
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
