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
import {
  listPathFromPathname,
  pathWithWorkbenchMode,
  workbenchModeFromPathname,
} from '@/lib/routeContext'
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
  const currentKind = currentRoute?.pathname
    ? rememberableWorkspaceKind(currentRoute.pathname)
    : null
  const recentKind = recentRoute?.pathname
    ? rememberableWorkspaceKind(recentRoute.pathname)
    : null
  const memory = currentKind === kind
    ? currentRoute
    : recentKind === kind
      ? recentRoute
      : display.workspaceMemory?.[kind]
  // listContext 只保存列表根路径，会有意剥离 /board；视图形态必须优先读工作区记忆。
  const modeSource = currentKind === kind
    ? currentRoute
    : display.workspaceMemory?.[kind] ?? memory
  const mode = workbenchModeFromPathname(modeSource?.pathname ?? '')
  if (kind === 'trade') {
    return `${pathWithWorkbenchMode('/list', mode)}${tradeHomeSearch(memory?.search ?? '')}`
  }
  const target = resolveWorkspaceNavTarget(kind, memory, strategies)
  const listPath = listPathFromPathname(target.pathname) ?? '/review-cases'
  return workspaceRouteHref({
    pathname: pathWithWorkbenchMode(listPath, mode),
    search: target.search,
  })
}
