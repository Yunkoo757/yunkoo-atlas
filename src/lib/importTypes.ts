import type { QuickNote } from '@/data/quickNotes'
import type { ReviewTemplate } from '@/data/reviewTemplates'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { WeeklyReview } from '@/data/weeklyReviews'
import type { SavedTradeView } from '@/lib/savedTradeViews'
import type { SymbolIconsMap } from '@/lib/symbolIconCodec'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import type { ExportAssetRecord, PersistedSnapshot } from '@/storage/types'

export interface ExportPayload {
  version: number
  trades: (Trade & { strategy?: string })[]
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

export interface PersistedSlice {
  trades: Trade[]
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
