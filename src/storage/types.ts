import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { DisplayPrefs } from '@/lib/tradeFilters'
import type { ShortcutBinding } from '@/shortcuts/types'

export const SCHEMA_VERSION = 4 // 4: +shortcuts bindings, +tradeKind activity
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

export interface PersistedSnapshot {
  trades: Trade[]
  strategies: Strategy[]
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: DisplayPrefs
  shortcuts?: Record<string, ShortcutBinding | null>
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
