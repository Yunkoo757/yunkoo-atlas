import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { buildListNavigationContext } from '@/shortcuts/listNav'
import { listPathFromPathname } from '@/lib/routeContext'
import type { ListFilter } from '@/lib/tradeFilters'

export function useListContextSync(filter: ListFilter) {
  const { pathname } = useLocation()
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
        ),
      )
  }, [pathname, trades, display, starredIds, filterKey])
}
