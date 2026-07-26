import type { QuickNote } from '@/data/quickNotes'
import type { ReviewTemplate } from '@/data/reviewTemplates'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { WeeklyReview } from '@/data/weeklyReviews'
import type {
  MonthlyRiskLimit,
  RiskOverrideEvent,
  RiskPolicyVersion,
  WeeklyRiskPreparation,
} from '@/data/riskManagement'
import type { SavedTradeView } from '@/lib/savedTradeViews'
import type { SymbolIconsMap } from '@/lib/symbolIconCodec'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import type { ExportAssetRecord, PersistedSnapshot } from '@/storage/types'

export interface ExportPayload {
  version: number
  trades: (Trade & { strategy?: string })[]
  weeklyRiskPreparations: WeeklyRiskPreparation[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  riskOverrideEvents: RiskOverrideEvent[]
  weeklyReviews?: WeeklyReview[]
  quickNotes?: QuickNote[]
  strategies: Strategy[]
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: DisplayPrefs
  shortcuts?: PersistedSnapshot['shortcuts']
  tagPresets?: string[]
  mistakeTagPresets?: string[]
  profile?: PersistedSnapshot['profile']
  savedTradeViews?: SavedTradeView[]
  symbolIcons?: SymbolIconsMap
  symbolCatalog?: string[]
  reviewTemplates?: ReviewTemplate[]
  assets?: ExportAssetRecord[]
}

/** 随机重编号附件前保留的、已经通过结构校验的交易身份来源。 */
export interface ImportIdentityPayload {
  trades: ExportPayload['trades']
}

export interface PersistedSlice {
  trades: Trade[]
  weeklyRiskPreparations?: WeeklyRiskPreparation[]
  riskPolicyVersions?: RiskPolicyVersion[]
  monthlyRiskLimits?: MonthlyRiskLimit[]
  riskOverrideEvents?: RiskOverrideEvent[]
  weeklyReviews?: WeeklyReview[]
  quickNotes?: QuickNote[]
  strategies: Strategy[]
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: DisplayPrefs
  tagPresets?: string[]
  mistakeTagPresets?: string[]
  savedTradeViews?: SavedTradeView[]
  symbolIcons?: SymbolIconsMap
  symbolCatalog?: string[]
  reviewTemplates?: ReviewTemplate[]
}
