import type { AssetStorageStats, StorageAdapter } from '@/storage/adapter'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import { getJournalBridge } from '@/storage/runtime'
import { migrateSnapshotToCurrent } from '@/storage/upgrade'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'

const MAX_OBJECT_URL_CACHE = 128

export class ElectronStorageAdapter implements StorageAdapter {
  private objectUrlCache = new Map<string, string>()

  async open(): Promise<void> {
    const bridge = getJournalBridge()
    if (!bridge) throw new Error('Electron bridge unavailable')
    await bridge.storageOpen()
  }

  async getManifest(): Promise<LibraryManifest> {
    return getJournalBridge()!.getManifest()
  }

  async loadRawSnapshot(): Promise<unknown | null> {
    const loaded = await getJournalBridge()!.loadRawSnapshot()
    return loaded?.snapshot ?? null
  }

  async loadSnapshot(): Promise<PersistedSnapshot | null> {
    const loaded = await getJournalBridge()!.loadRawSnapshot()
    if (!loaded) return null
    const migrated = migrateSnapshotToCurrent(loaded.snapshot, {
      source: 'library',
      manifestSchemaVersion: loaded.manifestSchemaVersion,
    })
    assertValidPersistedSnapshot(migrated.snapshot, 'Stored library snapshot')
    return migrated.snapshot
  }

  async saveSnapshot(snapshot: PersistedSnapshot): Promise<void> {
    await getJournalBridge()!.saveSnapshot(snapshot)
  }

  async saveAsset(blob: Blob, mime: string): Promise<string> {
    const buffer = await blob.arrayBuffer()
    return getJournalBridge()!.saveAsset(buffer, mime)
  }

  async getAssetObjectUrl(id: string): Promise<string | null> {
    const cached = this.objectUrlCache.get(id)
    if (cached) {
      this.objectUrlCache.delete(id)
      this.objectUrlCache.set(id, cached)
      return cached
    }

    const record = await getJournalBridge()!.getAssetBytes(id)
    if (!record) return null

    const bytes = Uint8Array.from(record.bytes)
    const blob = new Blob([bytes], { type: record.mime })
    const url = URL.createObjectURL(blob)
    if (this.objectUrlCache.size >= MAX_OBJECT_URL_CACHE) {
      const oldest = this.objectUrlCache.entries().next().value as [string, string] | undefined
      if (oldest) {
        URL.revokeObjectURL(oldest[1])
        this.objectUrlCache.delete(oldest[0])
      }
    }
    this.objectUrlCache.set(id, url)
    return url
  }

  async getAssetForExport(id: string): Promise<ExportAssetRecord | null> {
    const record = await getJournalBridge()!.getAssetBytes(id)
    if (!record) return null
    let binary = ''
    const bytes = record.bytes
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return { id: record.id, mime: record.mime, data: btoa(binary) }
  }

  async getAssetStats(ids: string[]): Promise<AssetStorageStats> {
    return getJournalBridge()!.getAssetStats(ids)
  }

  async importAssets(assets: ExportAssetRecord[]): Promise<void> {
    for (const asset of assets) {
      const cached = this.objectUrlCache.get(asset.id)
      if (cached) URL.revokeObjectURL(cached)
      this.objectUrlCache.delete(asset.id)
    }
    await getJournalBridge()!.importAssets(assets)
  }

  async commitImport(
    snapshot: PersistedSnapshot,
    assets: ExportAssetRecord[],
    options?: { pruneUnreferenced?: boolean },
  ): Promise<void> {
    await getJournalBridge()!.commitImport(snapshot, assets, options)
    this.clearObjectUrlCache()
  }

  /** 切换库目录后释放旧附件 Object URL，避免串库缓存。 */
  clearObjectUrlCache(): void {
    for (const url of this.objectUrlCache.values()) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
    }
    this.objectUrlCache.clear()
  }
}

let instance: ElectronStorageAdapter | null = null

export function getElectronAdapter(): ElectronStorageAdapter {
  if (!instance) instance = new ElectronStorageAdapter()
  return instance
}
