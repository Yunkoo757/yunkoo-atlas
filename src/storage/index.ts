export type {
  AssetPurgePreview,
  AssetPurgeRecovery,
  AssetPurgeResult,
  PreparedAssetPut,
  RevisionedLibraryMutation,
  RevisionedStorageAdapter,
  SnapshotEnvelope,
  StorageAdapter,
} from '@/storage/adapter'
export { StorageRevisionConflictError } from '@/storage/adapter'
export { bootstrapStorage, isStorageHydrated } from '@/storage/bootstrap'
export { getStorage } from '@/storage/provider'
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
