import { normalizeSavedViewPath } from '@/lib/savedTradeViews'

export type WorkspaceKind = 'trade' | 'case'

export type WorkspaceViewTarget = {
  id: string
  label: string
  pathname: string
  search?: string
}

const PRIMARY_VIEWS: Record<WorkspaceKind, readonly WorkspaceViewTarget[]> = {
  trade: [
    { id: 'all', label: '全部', pathname: '/list' },
    { id: 'week', label: '本周', pathname: '/period/this-week' },
    { id: 'month', label: '本月', pathname: '/period/this-month' },
    { id: 'loss', label: '亏损', pathname: '/list', search: '?status=loss' },
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
  return [...required.entries()].every(([key, value]) => current.get(key) === value)
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

export function isSavedViewInWorkspace(
  view: { pathname: string },
  kind: WorkspaceKind,
): boolean {
  const pathname = normalizeSavedViewPath(view.pathname)
  if (kind === 'case') return pathname.startsWith('/review-cases')
  return (
    pathname === '/list' ||
    pathname === '/today-record' ||
    pathname.startsWith('/period/') ||
    pathname.startsWith('/strategy/') ||
    pathname === '/active' ||
    pathname === '/favorites' ||
    pathname === '/missed'
  )
}
