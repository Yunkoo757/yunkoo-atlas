import type { AssetStorageStats, StorageAdapter } from '@/storage/adapter'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import { SCHEMA_VERSION } from '@/storage/types'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import { collectAssetIdsFromSnapshot } from '@/storage/assets'

// This browser storage name is intentionally kept for backward compatibility.
// Export payload/schema versions are tracked separately by SCHEMA_VERSION.
const DB_NAME = 'linear-journal-v3'

const STORE_SNAPSHOT = 'snapshot'
const STORE_ASSETS = 'assets'
const STORE_META = 'meta'
const MAX_OBJECT_URL_CACHE = 128
const REQUIRED_STORES = [STORE_SNAPSHOT, STORE_ASSETS, STORE_META] as const

interface AssetRecord {
  id: string
  mime: string
  byteSize: number
  createdAt: string
  blob: Blob
}

function normalizeLegacyBrowserSnapshot(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const snapshot = value as Record<string, unknown>
  if (!Array.isArray(snapshot.trades)) return value
  return {
    ...snapshot,
    trades: snapshot.trades.map((trade) => {
      if (typeof trade !== 'object' || trade === null || Array.isArray(trade)) return trade
      const record = trade as Record<string, unknown>
      return {
        tags: [],
        note: '',
        exit: null,
        pnl: null,
        rMultiple: null,
        closedAt: null,
        ...record,
        entry: typeof record.entry === 'number' && Number.isFinite(record.entry) ? record.entry : 0,
        size: typeof record.size === 'number' && Number.isFinite(record.size) ? record.size : 0,
        tradeKind: record.tradeKind === 'practice' ? 'paper' : record.tradeKind,
      }
    }),
  }
}

function createMissingStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) {
    db.createObjectStore(STORE_SNAPSHOT)
  }
  if (!db.objectStoreNames.contains(STORE_ASSETS)) {
    db.createObjectStore(STORE_ASSETS, { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains(STORE_META)) {
    db.createObjectStore(STORE_META)
  }
}

function finishOpen(db: IDBDatabase, resolve: (db: IDBDatabase) => void): void {
  db.onversionchange = () => db.close()
  resolve(db)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onupgradeneeded = () => createMissingStores(req.result)
    req.onsuccess = () => {
      const db = req.result
      const hasEveryStore = REQUIRED_STORES.every((store) => db.objectStoreNames.contains(store))
      if (hasEveryStore) {
        finishOpen(db, resolve)
        return
      }

      const repairVersion = db.version + 1
      db.close()
      const repair = indexedDB.open(DB_NAME, repairVersion)
      repair.onerror = () => reject(repair.error ?? new Error('IndexedDB repair failed'))
      repair.onblocked = () => reject(new DOMException('IndexedDB repair blocked by another tab', 'InvalidStateError'))
      repair.onupgradeneeded = () => createMissingStores(repair.result)
      repair.onsuccess = () => finishOpen(repair.result, resolve)
    }
  })
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1] ?? ''
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export class IndexedDbStorageAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null
  private objectUrlCache = new Map<string, string>()

  clearObjectUrlCache(): void {
    for (const url of this.objectUrlCache.values()) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* 测试环境可能没有完整的 URL API。 */
      }
    }
    this.objectUrlCache.clear()
  }

  async open(): Promise<void> {
    this.db = await openDb()
    const manifest = await idbGet<LibraryManifest>(this.db, STORE_META, 'manifest')
    if (!manifest) {
      const created: LibraryManifest = {
        schemaVersion: SCHEMA_VERSION,
        libraryId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      }
      await idbPut(this.db, STORE_META, 'manifest', created)
    }
  }

  private requireDb(): IDBDatabase {
    if (!this.db) throw new Error('Storage not opened')
    return this.db
  }

  async getManifest(): Promise<LibraryManifest> {
    const db = this.requireDb()
    const manifest = await idbGet<LibraryManifest>(db, STORE_META, 'manifest')
    if (!manifest) throw new Error('Missing library manifest')
    return manifest
  }

  async loadSnapshot(): Promise<PersistedSnapshot | null> {
    const db = this.requireDb()
    const stored = (await idbGet<unknown>(db, STORE_SNAPSHOT, 'main')) ?? null
    if (!stored) return null
    const snapshot = normalizeLegacyBrowserSnapshot(stored)
    assertValidPersistedSnapshot(snapshot, 'Stored browser snapshot')
    return snapshot
  }

  async saveSnapshot(snapshot: PersistedSnapshot): Promise<void> {
    assertValidPersistedSnapshot(snapshot, 'Browser snapshot')
    const db = this.requireDb()
    await idbPut(db, STORE_SNAPSHOT, 'main', snapshot)
  }

  async saveAsset(blob: Blob, mime: string): Promise<string> {
    const db = this.requireDb()
    const id = crypto.randomUUID()
    const record: AssetRecord = {
      id,
      mime,
      byteSize: blob.size,
      createdAt: new Date().toISOString(),
      blob,
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readwrite')
      tx.objectStore(STORE_ASSETS).put(record)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return id
  }

  async getAssetObjectUrl(id: string): Promise<string | null> {
    const cached = this.objectUrlCache.get(id)
    if (cached) {
      this.objectUrlCache.delete(id)
      this.objectUrlCache.set(id, cached)
      return cached
    }

    const db = this.requireDb()
    const record = await idbGet<AssetRecord>(db, STORE_ASSETS, id)
    if (!record?.blob) return null

    const url = URL.createObjectURL(record.blob)
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
    const db = this.requireDb()
    const record = await idbGet<AssetRecord>(db, STORE_ASSETS, id)
    if (!record?.blob) return null
    const data = await blobToBase64(record.blob)
    return { id: record.id, mime: record.mime, data }
  }

  async getAssetStats(ids: string[]): Promise<AssetStorageStats> {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) return { count: 0, totalBytes: 0, missingCount: 0 }

    const db = this.requireDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readonly')
      const store = tx.objectStore(STORE_ASSETS)
      let count = 0
      let totalBytes = 0
      let missingCount = 0
      for (const id of uniqueIds) {
        const request = store.get(id)
        request.onsuccess = () => {
          const record = request.result as AssetRecord | undefined
          if (!record?.blob || record.blob.size !== record.byteSize) {
            missingCount += 1
            return
          }
          count += 1
          totalBytes += record.blob.size
        }
      }
      tx.oncomplete = () => resolve({ count, totalBytes, missingCount })
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB asset statistics failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB asset statistics aborted'))
    })
  }

  async importAssets(assets: ExportAssetRecord[]): Promise<void> {
    const db = this.requireDb()
    for (const asset of assets) {
      const cached = this.objectUrlCache.get(asset.id)
      if (cached) URL.revokeObjectURL(cached)
      this.objectUrlCache.delete(asset.id)
    }
    await Promise.all(
      assets.map(
        (a) =>
          new Promise<void>((resolve, reject) => {
            const record: AssetRecord = {
              id: a.id,
              mime: a.mime,
              byteSize: 0,
              createdAt: new Date().toISOString(),
              blob: base64ToBlob(a.data, a.mime),
            }
            record.byteSize = record.blob.size
            const tx = db.transaction(STORE_ASSETS, 'readwrite')
            tx.objectStore(STORE_ASSETS).put(record)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          }),
      ),
    )
  }

  async commitImport(
    snapshot: PersistedSnapshot,
    assets: ExportAssetRecord[],
    options?: { pruneUnreferenced?: boolean },
  ): Promise<void> {
    assertValidPersistedSnapshot(snapshot, 'Imported browser snapshot')
    const db = this.requireDb()
    const referencedAssetIds = new Set(collectAssetIdsFromSnapshot(snapshot))
    const records: AssetRecord[] = assets.filter(
      (asset) => !options?.pruneUnreferenced || referencedAssetIds.has(asset.id),
    ).map((asset) => {
      const blob = base64ToBlob(asset.data, asset.mime)
      return {
        id: asset.id,
        mime: asset.mime,
        byteSize: blob.size,
        createdAt: new Date().toISOString(),
        blob,
      }
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_SNAPSHOT, STORE_ASSETS], 'readwrite')
      tx.objectStore(STORE_SNAPSHOT).put(snapshot, 'main')
      const assetStore = tx.objectStore(STORE_ASSETS)
      records.forEach((record) => assetStore.put(record))
      if (options?.pruneUnreferenced) {
        assets.forEach((asset) => {
          if (!referencedAssetIds.has(asset.id)) assetStore.delete(asset.id)
        })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB import transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB import transaction aborted'))
    })
    for (const asset of assets) {
      const cached = this.objectUrlCache.get(asset.id)
      if (cached) URL.revokeObjectURL(cached)
      this.objectUrlCache.delete(asset.id)
    }
  }

  /**
   * 浏览器完整归档恢复：用单一事务精确替换快照与全部附件。
   * 调用方必须先完成 ZIP 解压、格式校验和所有 base64 准备；这里不做异步解压，
   * 避免 IndexedDB transaction 在等待期间提前 inactive。
   */
  async replaceArchive(
    snapshot: PersistedSnapshot,
    assets: ExportAssetRecord[],
  ): Promise<void> {
    assertValidPersistedSnapshot(snapshot, 'Restored browser snapshot')
    const db = this.requireDb()
    const now = new Date().toISOString()
    const records = assets.map((asset) => {
      const blob = base64ToBlob(asset.data, asset.mime)
      return {
        id: asset.id,
        mime: asset.mime,
        byteSize: blob.size,
        createdAt: now,
        blob,
      } satisfies AssetRecord
    })

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_SNAPSHOT, STORE_ASSETS], 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB archive replacement failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB archive replacement aborted'))
      try {
        tx.objectStore(STORE_SNAPSHOT).put(snapshot, 'main')
        const assetStore = tx.objectStore(STORE_ASSETS)
        assetStore.clear()
        for (const record of records) assetStore.put(record)
      } catch (error) {
        try {
          tx.abort()
        } catch {
          /* 事务若已由浏览器终止，保留最初的同步异常。 */
        }
        reject(error)
      }
    })

    this.clearObjectUrlCache()
  }
}

let adapterInstance: IndexedDbStorageAdapter | null = null

export function getIndexedDbAdapter(): IndexedDbStorageAdapter {
  if (!adapterInstance) adapterInstance = new IndexedDbStorageAdapter()
  return adapterInstance
}
