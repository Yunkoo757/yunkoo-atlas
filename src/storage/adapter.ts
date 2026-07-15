import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'

export interface AssetStorageStats {
  count: number
  totalBytes: number
  missingCount: number
}

export interface StorageAdapter {
  open(): Promise<void>
  getManifest(): Promise<LibraryManifest>

  loadRawSnapshot(): Promise<unknown | null>
  loadSnapshot(): Promise<PersistedSnapshot | null>
  saveSnapshot(snapshot: PersistedSnapshot): Promise<void>

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
