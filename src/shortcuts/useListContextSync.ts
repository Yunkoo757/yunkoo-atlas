import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { buildListNavigationContext } from '@/shortcuts/listNav'
import { listPathFromPathname } from '@/lib/routeContext'
import { rememberableWorkspaceKind } from '@/lib/workspaceViews'
import type { ListFilter } from '@/lib/tradeFilters'

/** 浏览交易/案例列表时记住路由，供侧栏入口还原 */
function useWorkspaceMemorySync() {
  const { pathname, search } = useLocation()

  useEffect(() => {
    const kind = rememberableWorkspaceKind(pathname)
    if (!kind) return
    const state = useStore.getState()
    const prev = state.display.workspaceMemory?.[kind]
    if (prev?.pathname === pathname && (prev.search ?? '') === search) return
    state.setDisplay({
      workspaceMemory: {
        ...state.display.workspaceMemory,
        [kind]: { pathname, search },
      },
    })
  }, [pathname, search])
}

export function useListContextSync(filter: ListFilter) {
  useWorkspaceMemorySync()

  const { pathname, search } = useLocation()
  const trades = useStore((s) => s.trades)
  const display = useStore((s) => s.display)
  const starredIds = useStore((s) => s.starredIds)
  const filterKey = JSON.stringify(filter)

  useEffect(() => {
    const listPath = listPathFromPathname(pathname)
    if (!listPath) return
    useShortcutStore
      .getState()
      .setListContext(
        buildListNavigationContext(
          trades,
          filter,
          display,
          starredIds,
          listPath,
          search,
        ),
      )
  }, [pathname, search, trades, display, starredIds, filterKey])
}
