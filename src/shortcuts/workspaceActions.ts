import type { Strategy } from '@/data/strategies'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import {
  isTradeWorkspaceEntryPath,
  rememberableWorkspaceKind,
  resolveWorkspaceNavTarget,
  workspaceRouteHref,
  type WorkspaceKind,
  type WorkspaceRouteMemory,
} from '@/lib/workspaceViews'
import { listPathFromPathname } from '@/lib/routeContext'
import { tradeHomeSearch } from '@/lib/tradeWorkspaceQuery'

/**
 * 交易日志快捷键始终回到模块首页，但保留阶段/记录类型这类长期工作范围。
 * 策略、快捷视图和筛选属于临时视图，不应被 A 键带回首页。
 */
export function resolveShortcutWorkspaceHref(
  kind: Extract<WorkspaceKind, 'trade' | 'case'>,
  display: DisplayPrefs,
  strategies: readonly Pick<Strategy, 'id'>[],
  recentRoute?: WorkspaceRouteMemory | null,
  currentRoute?: WorkspaceRouteMemory | null,
): string {
  if (kind === 'trade' && currentRoute?.pathname) {
    const currentListPath = listPathFromPathname(currentRoute.pathname)
    if (currentListPath && isTradeWorkspaceEntryPath(currentListPath)) {
      return `/list${tradeHomeSearch(currentRoute.search)}`
    }
  }
  const memory = recentRoute && rememberableWorkspaceKind(recentRoute.pathname) === kind
    ? recentRoute
    : display.workspaceMemory?.[kind]
  if (kind === 'trade') {
    return `/list${tradeHomeSearch(memory?.search ?? '')}`
  }
  return workspaceRouteHref(resolveWorkspaceNavTarget(kind, memory, strategies))
}
