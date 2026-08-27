import type { Strategy } from '@/data/strategies'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import {
  resolveWorkspaceNavTarget,
  workspaceRouteHref,
  type WorkspaceKind,
  type WorkspaceRouteMemory,
} from '@/lib/workspaceViews'

/** 工作区快捷键与侧栏入口保持一致，恢复最近一次有效的路径和筛选。 */
export function resolveShortcutWorkspaceHref(
  kind: Extract<WorkspaceKind, 'trade' | 'case'>,
  display: DisplayPrefs,
  strategies: readonly Pick<Strategy, 'id'>[],
  recentRoute?: WorkspaceRouteMemory | null,
): string {
  const memory = recentRoute ?? display.workspaceMemory?.[kind]
  return workspaceRouteHref(resolveWorkspaceNavTarget(kind, memory, strategies))
}
