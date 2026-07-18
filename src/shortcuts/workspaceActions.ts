import type { Strategy } from '@/data/strategies'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import {
  resolveWorkspaceNavTarget,
  workspaceRouteHref,
  type WorkspaceKind,
} from '@/lib/workspaceViews'

/** 交易日志快捷键固定回到全部；案例记录仍恢复上次知识视图。 */
export function resolveShortcutWorkspaceHref(
  kind: Extract<WorkspaceKind, 'trade' | 'case'>,
  display: DisplayPrefs,
  strategies: readonly Pick<Strategy, 'id'>[],
): string {
  if (kind === 'trade') return '/list'
  const memory = display.workspaceMemory?.case
  return workspaceRouteHref(resolveWorkspaceNavTarget(kind, memory, strategies))
}
