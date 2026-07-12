import type { StorageAdapter } from '@/storage/adapter'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import { getJournalBridge } from '@/storage/runtime'

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

  async getAssetObjectUrl(id: string): Promise<string | null> {
    const cached = this.objectUrlCache.get(id)
    if (cached) return cached

    const record = await getJournalBridge()!.getAssetBytes(id)
    if (!record) return null

    const bytes = Uint8Array.from(record.bytes)
    const blob = new Blob([bytes], { type: record.mime })
    const url = URL.createObjectURL(blob)
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

  async importAssets(assets: ExportAssetRecord[]): Promise<void> {
    await getJournalBridge()!.importAssets(assets)
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
