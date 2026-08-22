import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import type { ShortcutBinding } from '@/shortcuts/types'
import type { SavedTradeView } from '@/lib/savedTradeViews'
import type { WeeklyReview } from '@/data/weeklyReviews'
import type { ReviewTemplate } from '@/data/reviewTemplates'
import type { QuickNote } from '@/data/quickNotes'
import type { LiveStage, ScheduledStageRollover } from '@/lib/liveStages'
import type {
  MonthlyRiskLimit,
  RiskOverrideEvent,
  RiskPolicyVersion,
  WeeklyRiskPreparation,
} from '@/data/riskManagement'

/**
 * 可验证的导入来源事实。该字段只接受导入时实际观测到的值，不能为旧记录追溯猜测。
 */
export interface NotionTradeImportProvenance {
  source: 'notion'
  importedAt: string
  openedAtSource: 'notion-date'
  closedAtSource: 'missing-in-source' | 'notion-close-date'
}

export type PersistedTrade = Trade & {
  importProvenance?: NotionTradeImportProvenance
}

export const SCHEMA_VERSION = 12

export interface LibraryManifest {
  schemaVersion: number
  libraryId: string
  createdAt: string
  migratedFromLocalStorage?: boolean
  migratedFromIndexedDB?: boolean
  platform?: 'electron' | 'web'
}

export interface StoredAsset {
  id: string
  mime: string
  byteSize: number
  createdAt: string
}

export interface LegacyCashCurrencyAssumption {
  currency: 'USD'
  confirmedAt: string
}

export interface UserProfile {
  avatarId: string | null
  displayName: string
  customAvatarDataUrl?: string | null
  legacyCashCurrencyAssumption: LegacyCashCurrencyAssumption | null
}

export interface PersistedSnapshot {
  trades: PersistedTrade[]
  /** v12：实盘阶段是交易、复盘与风险数据归属的唯一持久化真相。 */
  liveStages: LiveStage[]
  currentLiveStageId: string
  scheduledStageRollover: ScheduledStageRollover | null
  weeklyRiskPreparations: WeeklyRiskPreparation[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  riskOverrideEvents: RiskOverrideEvent[]
  /** v7：独立于交易记录的周复盘。旧资料库省略时按空数组加载。 */
  weeklyReviews?: WeeklyReview[]
  /** v8：独立于交易体系的随记。不会参与交易统计或随机复盘。 */
  quickNotes?: QuickNote[]
  strategies: Strategy[]
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: DisplayPrefs
  shortcuts?: Record<string, ShortcutBinding | null>
  tagPresets?: string[]
  mistakeTagPresets?: string[]
  profile?: UserProfile
  /** @deprecated 判例库已移除；旧快照可能仍含此字段，加载时忽略 */
  cases?: unknown[]
  /** @deprecated 判例库已移除；旧快照可能仍含此字段，加载时忽略 */
  disputeTypes?: unknown[]
  savedTradeViews?: SavedTradeView[]
  /** 品种图标覆盖：预设或自定义上传 */
  symbolIcons?: import('@/lib/symbolIcons').SymbolIconsMap
  /** 品种目录：设置与新建交易共用 */
  symbolCatalog?: string[]
  /** 交易详情中的复盘起稿模板。旧资料库省略时加载默认模板。 */
  reviewTemplates?: ReviewTemplate[]
}

export interface ExportAssetRecord {
  id: string
  mime: string
  data: string
}

export interface ExportPayloadV3 extends PersistedSnapshot {
  version: 3
  assets: ExportAssetRecord[]
}
