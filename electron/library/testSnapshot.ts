import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import type { PersistedSnapshot } from '../../src/storage/types'

export function currentTestSnapshot(
  overrides: Partial<PersistedSnapshot> = {},
): PersistedSnapshot {
  return {
    schemaVersion: 7,
    reportingTimeZone: null,
    trades: [],
    strategies: [],
    strategyVersions: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY },
    ...overrides,
  }
}
