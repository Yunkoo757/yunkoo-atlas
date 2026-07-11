import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { buildListNavigationContext } from '@/shortcuts/listNav'
import { listPathFromPathname } from '@/lib/routeContext'
import {
  rememberableWorkspaceKind,
  resolveWorkspaceNavTarget,
  type WorkspaceKind,
  type WorkspaceRouteMemory,
} from '@/lib/workspaceViews'
import type { ListFilter } from '@/lib/tradeFilters'

/** 浏览交易/案例列表时记住路由，供侧栏入口还原 */
function useWorkspaceMemorySync() {
  const { pathname, search } = useLocation()
  const strategies = useStore((state) => state.strategies)

  useEffect(() => {
    const kind = rememberableWorkspaceKind(pathname)
    const state = useStore.getState()
    const nextMemory = { ...state.display.workspaceMemory }
    let changed = false

    for (const workspaceKind of ['today', 'trade', 'case'] satisfies WorkspaceKind[]) {
      const remembered = nextMemory[workspaceKind]
      if (!remembered || isResolvedMemory(remembered, workspaceKind, strategies)) continue
      delete nextMemory[workspaceKind]
      changed = true
    }

    if (kind) {
      const current = { pathname, search }
      if (isResolvedMemory(current, kind, strategies)) {
        const prev = nextMemory[kind]
        if (prev?.pathname !== pathname || (prev.search ?? '') !== search) {
          nextMemory[kind] = current
          changed = true
        }
      }
    }

    if (!changed) return
    state.setDisplay({
      workspaceMemory: nextMemory,
    })
  }, [pathname, search, strategies])
}

function isResolvedMemory(
  memory: WorkspaceRouteMemory,
  kind: WorkspaceKind,
  strategies: ReturnType<typeof useStore.getState>['strategies'],
): boolean {
  const resolved = resolveWorkspaceNavTarget(kind, memory, strategies)
  return resolved.pathname === memory.pathname && resolved.search === (memory.search ?? '')
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
