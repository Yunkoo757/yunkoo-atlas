import type { Strategy } from '@/data/strategies'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import {
  resolveWorkspaceNavTarget,
  workspaceRouteHref,
  type WorkspaceKind,
} from '@/lib/workspaceViews'

/** 为快捷键提供结果稳定的工作区目标，并恢复该工作区上次使用的位置。 */
export function resolveShortcutWorkspaceHref(
  kind: Extract<WorkspaceKind, 'trade' | 'case'>,
  display: DisplayPrefs,
  strategies: readonly Pick<Strategy, 'id'>[],
): string {
  const memory = kind === 'trade'
    ? display.workspaceMemory?.trade
    : display.workspaceMemory?.case
  return workspaceRouteHref(resolveWorkspaceNavTarget(kind, memory, strategies))
}
