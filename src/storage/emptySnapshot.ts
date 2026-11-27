import { DEFAULT_SYMBOL_CATALOG } from '@/lib/symbolIconCodec'
import { createDefaultMistakeTagPresets, createDefaultStrategies, createDefaultTagPresets, createDefaultUserProfile } from '@/config/defaultProfile'
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
    backtestProjects: [],
    trades: [],
    liveStages: [stage],
    currentLiveStageId: stage.id,
    scheduledStageRollover: null,
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [],
    strategies: [],
    symbolCatalog: [...DEFAULT_SYMBOL_CATALOG],
    starredIds: [],
    subscribedIds: [],
    reviewPoolPresets: [],
    reviewPoolLayout: undefined,
    pinnedStrategyIds: [],
    display: {
      ...DEFAULT_DISPLAY,
      sidebarPrimaryOrder: [...(DEFAULT_DISPLAY.sidebarPrimaryOrder ?? [])],
      sidebarPins: [...DEFAULT_DISPLAY.sidebarPins],
      sidebarWorkspaceItems: [...DEFAULT_DISPLAY.sidebarWorkspaceItems],
    },
  }
}

/** 用户新建资料库时应用预设。恢复没有快照的历史空备份仍使用该库的空数据语义。 */
export function createNewLibrarySnapshot() {
  return {
    ...createEmptyPersistedSnapshot(),
    strategies: createDefaultStrategies(),
    tagPresets: createDefaultTagPresets(),
    mistakeTagPresets: createDefaultMistakeTagPresets(),
    profile: createDefaultUserProfile(),
  }
}
