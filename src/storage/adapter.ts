import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import type {
  LocalSyncStatus,
  RemoteSyncApplyResult,
  RemoteSyncOperation,
  SyncConflict,
  SyncOutboxOperation,
} from '@/sync/types'

export interface AssetStorageStats {
  count: number
  totalBytes: number
  missingCount: number
}

export interface StorageAdapter {
  open(): Promise<void>
  getManifest(): Promise<LibraryManifest>

  loadSnapshot(): Promise<PersistedSnapshot | null>
  saveSnapshot(snapshot: PersistedSnapshot): Promise<void>
  getLocalSyncStatus(): Promise<LocalSyncStatus>
  listPendingSyncOperations(limit?: number): Promise<SyncOutboxOperation[]>
  acknowledgeSyncOperations(operationIds: string[], pullCursor?: string): Promise<void>
  applyRemoteSyncOperations(
    operations: RemoteSyncOperation[],
    pullCursor: string,
  ): Promise<RemoteSyncApplyResult>
  listSyncConflicts(limit?: number): Promise<SyncConflict[]>

  saveAsset(blob: Blob, mime: string): Promise<string>
  getAssetObjectUrl(id: string): Promise<string | null>
  getAssetForExport(id: string): Promise<ExportAssetRecord | null>
  getAssetStats(ids: string[]): Promise<AssetStorageStats>
  importAssets(assets: ExportAssetRecord[]): Promise<void>
  commitImport(
    snapshot: PersistedSnapshot,
    assets: ExportAssetRecord[],
    options?: { pruneUnreferenced?: boolean },
  ): Promise<void>
}
