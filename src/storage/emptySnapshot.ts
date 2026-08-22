import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { createInitialLiveStage } from '@/lib/liveStages'
import { getTradingDayKey } from '@/lib/periods'
import type { PersistedSnapshot } from '@/storage/types'

export function createEmptyPersistedSnapshot(): PersistedSnapshot {
  const now = new Date()
  const createdAt = now.toISOString()
  const stage = createInitialLiveStage(
    getTradingDayKey(now, DEFAULT_DISPLAY.tradingDayStartHour),
    createdAt,
    'live-stage-initial',
  )
  return {
    trades: [],
    liveStages: [stage],
    currentLiveStageId: stage.id,
    scheduledStageRollover: null,
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [],
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
