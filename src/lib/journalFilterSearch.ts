import { resolveJournalView } from '@/lib/journalQuickViews'
import type { SavedTradeView } from '@/lib/savedTradeViews'
import type { SidebarWorkspaceItem } from '@/lib/sidebarWorkspace'

/** 清除日志的附加条件时保留阶段、记录类型和当前视图本身的条件。 */
export function getJournalFilterResetSearch(
  pathname: string,
  search: string | URLSearchParams,
  sidebarItems?: readonly SidebarWorkspaceItem[],
  savedViews: readonly SavedTradeView[] = [],
  state?: unknown,
): URLSearchParams {
  const params = new URLSearchParams(search)
  const kind = params.get('kind') === 'paper' ? 'paper' : 'trade'
  const view = resolveJournalView(kind, pathname, params.toString(), sidebarItems, savedViews, state)
  const required = new URLSearchParams(view?.search)
  for (const key of [...params.keys()]) {
    if (key === 'liveStage' || key === 'kind') continue
    if (params.get(key) !== required.get(key)) params.delete(key)
  }
  return params
}
