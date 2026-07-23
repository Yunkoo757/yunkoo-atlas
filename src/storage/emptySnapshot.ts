import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import type { PersistedSnapshot } from '@/storage/types'

export function createEmptyPersistedSnapshot(): PersistedSnapshot {
  return {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: {
      ...DEFAULT_DISPLAY,
      sidebarPrimaryOrder: [...(DEFAULT_DISPLAY.sidebarPrimaryOrder ?? [])],
      sidebarPins: [...DEFAULT_DISPLAY.sidebarPins],
      sidebarWorkspaceItems: [...DEFAULT_DISPLAY.sidebarWorkspaceItems],
    },
  }
}
