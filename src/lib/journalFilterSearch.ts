import { resolveJournalView } from '@/lib/journalQuickViews'
import { normalizeSavedViewPath, type SavedTradeView } from '@/lib/savedTradeViews'
import type { SidebarWorkspaceItem } from '@/lib/sidebarWorkspace'

/** 清除附加条件时保留当前日志或案例视图本身的条件。 */
export function getJournalFilterResetSearch(
  pathname: string,
  search: string | URLSearchParams,
  sidebarItems?: readonly SidebarWorkspaceItem[],
  savedViews: readonly SavedTradeView[] = [],
  state?: unknown,
): URLSearchParams {
  const params = new URLSearchParams(search)
  const kind = normalizeSavedViewPath(pathname).startsWith('/review-cases')
    ? 'case' : params.get('kind') === 'paper' ? 'paper' : 'trade'
  const view = resolveJournalView(kind, pathname, params.toString(), sidebarItems, savedViews, state)
  const required = new URLSearchParams(view?.search)
  for (const key of [...params.keys()]) {
    if (kind !== 'case' && (key === 'liveStage' || key === 'kind')) continue
    if (params.get(key) !== required.get(key)) params.delete(key)
  }
  return params
}
