import { createDefaultUserProfile } from '@/config/defaultProfile'
import { normalizeQuickNotes } from '@/data/quickNotes'
import { normalizeReviewTemplates } from '@/data/reviewTemplates'
import { normalizeWeeklyReviews } from '@/data/weeklyReviews'
import { getCurrentLiveStage } from '@/lib/liveStages'
import { normalizeReviewPoolLayout } from '@/lib/reviewPools'
import { normalizeSavedTradeViews } from '@/lib/savedTradeViews'
import { normalizeSymbolCatalog, normalizeSymbolIcons } from '@/lib/symbolIconCodec'
import { normalizeDisplay } from '@/lib/tradeFilters'
import { bindingsForPersist } from '@/shortcuts/bindingRules'
import { PERSISTED_STATE_REFERENCE_KEYS, type ActivePersistedSnapshotKey } from '@/storage/persistedKeys'
import type { CanonicalSnapshot } from '@/storage/snapshotCodec'
import type { PersistedSnapshot } from '@/storage/types'

type BusinessField = Exclude<ActivePersistedSnapshotKey, 'shortcuts'>
type BusinessSnapshot = Pick<CanonicalSnapshot, BusinessField>
type RiskField = 'weeklyRiskPreparations' | 'riskPolicyVersions' | 'monthlyRiskLimits' | 'riskOverrideEvents'

/** 历史 JSON 与内存样本可省略后来引入的风险集合。 */
export type PortableSnapshotState = Pick<PersistedSnapshot, Exclude<ActivePersistedSnapshotKey, RiskField>>
  & Partial<Pick<PersistedSnapshot, RiskField>>

function businessFields<T extends PortableSnapshotState>(state: T): Pick<T, BusinessField> {
  // 注册表在类型检查中穷举 BusinessField；仅拣选这些键，避免复制 Store 动作或 UI 状态。
  const fields = {} as Pick<T, BusinessField>
  PERSISTED_STATE_REFERENCE_KEYS.forEach(<K extends BusinessField>(key: K) => {
    fields[key] = state[key]
  })
  return fields
}

/** 自动保存与耐久命令保留业务引用，用于识别真实编辑和并发更新。 */
export function pickPersisted(state: BusinessSnapshot, shortcutBindings: CanonicalSnapshot['shortcuts'] = {}): CanonicalSnapshot {
  getCurrentLiveStage(state.liveStages, state.currentLiveStageId)
  return { ...businessFields(state), shortcuts: bindingsForPersist(shortcutBindings) }
}

export function buildPortableSnapshotFromState(
  state: PortableSnapshotState,
  shortcutBindings: CanonicalSnapshot['shortcuts'],
): CanonicalSnapshot {
  const fields = businessFields(state)
  return {
    ...fields,
    liveStages: fields.liveStages.map((stage) => ({ ...stage })),
    scheduledStageRollover: fields.scheduledStageRollover ? { ...fields.scheduledStageRollover } : null,
    weeklyRiskPreparations: fields.weeklyRiskPreparations ?? [],
    riskPolicyVersions: fields.riskPolicyVersions ?? [],
    monthlyRiskLimits: fields.monthlyRiskLimits ?? [],
    riskOverrideEvents: fields.riskOverrideEvents ?? [],
    weeklyReviews: normalizeWeeklyReviews(fields.weeklyReviews),
    quickNotes: normalizeQuickNotes(fields.quickNotes),
    display: normalizeDisplay(fields.display),
    tagPresets: fields.tagPresets ?? [],
    mistakeTagPresets: fields.mistakeTagPresets ?? [],
    profile: fields.profile ?? createDefaultUserProfile(),
    savedTradeViews: normalizeSavedTradeViews(fields.savedTradeViews),
    symbolIcons: normalizeSymbolIcons(fields.symbolIcons),
    symbolCatalog: normalizeSymbolCatalog(fields.symbolCatalog),
    reviewTemplates: normalizeReviewTemplates(fields.reviewTemplates),
    backtestProjects: fields.backtestProjects ?? [],
    reviewPoolPresets: fields.reviewPoolPresets ?? [],
    reviewPoolLayout: normalizeReviewPoolLayout(
      fields.reviewPoolLayout,
      (fields.reviewPoolPresets ?? []).map((preset) => preset.id),
    ),
    shortcuts: bindingsForPersist(shortcutBindings),
  }
}
