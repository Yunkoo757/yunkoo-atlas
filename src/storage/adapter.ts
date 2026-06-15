import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'

export interface StorageAdapter {
  open(): Promise<void>
  getManifest(): Promise<LibraryManifest>

  loadSnapshot(): Promise<PersistedSnapshot | null>
  saveSnapshot(snapshot: PersistedSnapshot): Promise<void>

  saveAsset(blob: Blob, mime: string): Promise<string>
  getAssetObjectUrl(id: string): Promise<string | null>
  getAssetForExport(id: string): Promise<ExportAssetRecord | null>
  importAssets(assets: ExportAssetRecord[]): Promise<void>
}
