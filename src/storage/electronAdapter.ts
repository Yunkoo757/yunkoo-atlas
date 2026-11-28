import { bytesToBase64 } from '@/lib/base64'
import { AssetObjectUrlCache } from './assetObjectUrls'
import type {
  AssetPurgePreview,
  AssetPurgeResult,
  AssetStorageStats,
  PhysicalAssetRecord,
  LibraryImportAsset,
  LibraryImportOptions,
  StorageAdapter,
} from '@/storage/adapter'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import { getJournalBridge } from '@/storage/runtime'

export class ElectronStorageAdapter implements StorageAdapter {
  private objectUrls = new AssetObjectUrlCache()

  async open(): Promise<void> {
    const bridge = getJournalBridge()
    if (!bridge) throw new Error('Electron bridge unavailable')
    await bridge.storageOpen()
  }

  async getSnapshotRevision(): Promise<number> {
    return getJournalBridge()!.getSnapshotRevision()
  }

  async getManifest(): Promise<LibraryManifest> {
    return getJournalBridge()!.getManifest()
  }

  async loadSnapshot(): Promise<PersistedSnapshot | null> {
    return getJournalBridge()!.loadSnapshot()
  }

  async saveSnapshot(snapshot: PersistedSnapshot): Promise<void> {
    await getJournalBridge()!.saveSnapshot(snapshot)
  }

  async saveAsset(blob: Blob, mime: string): Promise<string> {
    const buffer = await blob.arrayBuffer()
    return getJournalBridge()!.saveAsset(buffer, mime)
  }

  private async loadAssetBlob(id: string): Promise<Blob | null> {
    const record = await getJournalBridge()!.getAssetBytes(id)
    return record ? new Blob([Uint8Array.from(record.bytes)], { type: record.mime }) : null
  }

  getAssetObjectUrl(id: string): Promise<string | null> {
    return this.objectUrls.get(id, () => this.loadAssetBlob(id))
  }

  acquireAssetObjectUrl(id: string) {
    return this.objectUrls.acquire(id, () => this.loadAssetBlob(id))
  }

  private invalidateAssetObjectUrl(id: string): void {
    this.objectUrls.invalidate(id)
  }

  async getAssetForExport(id: string): Promise<ExportAssetRecord | null> {
    const record = await getJournalBridge()!.getAssetBytes(id)
    if (!record) return null
    return { id: record.id, mime: record.mime, data: bytesToBase64(record.bytes) }
  }

  async getAssetStats(ids: string[]): Promise<AssetStorageStats> {
    return getJournalBridge()!.getAssetStats(ids)
  }

  async listAssetRecords(): Promise<PhysicalAssetRecord[]> {
    return getJournalBridge()!.listAssetRecords()
  }

  async previewAssetPurge(): Promise<AssetPurgePreview> {
    return getJournalBridge()!.previewAssetPurge()
  }

  async prepareAssetPurgeRecovery(preview: AssetPurgePreview) {
    const result = await getJournalBridge()!.prepareAssetPurgeRecovery(preview)
    if (!result) throw new Error('恢复归档导出已取消')
    return result
  }

  async cancelAssetPurge(operationId: string): Promise<void> {
    await getJournalBridge()!.cancelAssetPurge(operationId)
  }

  async commitAssetPurge(preview: AssetPurgePreview, authorization?: string): Promise<AssetPurgeResult> {
    const result = await getJournalBridge()!.commitAssetPurge(preview, authorization)
    for (const id of result.deletedIds) this.invalidateAssetObjectUrl(id)
    return result
  }

  async importAssets(assets: ExportAssetRecord[]): Promise<void> {
    await getJournalBridge()!.importAssets(assets)
    for (const asset of assets) this.invalidateAssetObjectUrl(asset.id)
  }

  async commitImport(
    snapshot: PersistedSnapshot,
    assets: LibraryImportAsset[],
    options?: LibraryImportOptions,
  ): Promise<void> {
    await getJournalBridge()!.commitImport(snapshot, assets, options)
    this.clearObjectUrlCache()
  }

  /** 切换库目录后释放旧附件 Object URL，避免串库缓存。 */
  clearObjectUrlCache(): void {
    this.objectUrls.clear()
  }
}

let instance: ElectronStorageAdapter | null = null

export function getElectronAdapter(): ElectronStorageAdapter {
  if (!instance) instance = new ElectronStorageAdapter()
  return instance
}
