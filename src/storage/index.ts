export type { StorageAdapter } from '@/storage/adapter'
export { getStorage, bootstrapStorage, isStorageHydrated } from '@/storage/bootstrap'
export { isElectron, getJournalBridge } from '@/storage/runtime'
export { getElectronAdapter } from '@/storage/electronAdapter'
export {
  assetUrl,
  parseAssetId,
  resolveNoteForDisplay,
  normalizeNoteForStorage,
  externalizeNoteImages,
  collectAssetIdsFromNotes,
  collectAssetIdsFromHtml,
  collectAssetIdsFromSnapshot,
  ASSET_URL_PREFIX,
} from '@/storage/assets'
export type {
  PersistedSnapshot,
  ExportPayloadV3,
  LibraryManifest,
  ExportAssetRecord,
} from '@/storage/types'
export { SCHEMA_VERSION } from '@/storage/types'
