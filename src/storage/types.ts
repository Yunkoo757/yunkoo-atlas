import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import type { ShortcutBinding } from '@/shortcuts/types'
import type { SavedTradeView } from '@/lib/savedTradeViews'
import type { WeeklyReview } from '@/data/weeklyReviews'

export const SCHEMA_VERSION = 7
export const LEGACY_LOCAL_STORAGE_KEY = 'linear-journal'

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

export interface UserProfile {
  avatarId: string | null
  displayName: string
  customAvatarDataUrl?: string | null
}

export interface PersistedSnapshot {
  trades: Trade[]
  /** v7：独立于交易记录的周复盘。旧资料库省略时按空数组加载。 */
  weeklyReviews?: WeeklyReview[]
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
