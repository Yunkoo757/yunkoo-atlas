import type { AssetStorageStats, StorageAdapter } from '@/storage/adapter'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import { SCHEMA_VERSION } from '@/storage/types'
import {
  assertValidPersistedSnapshot,
  assertValidSnapshotForSchema,
} from '@/storage/snapshotValidation'
import { collectAssetIdsFromNotes } from '@/storage/assets'
import { migrateSnapshotToCurrent } from '@/storage/upgrade'

// This browser storage name is intentionally kept for backward compatibility.
// Export payload/schema versions are tracked separately by SCHEMA_VERSION.
const DB_NAME = 'linear-journal-v3'
const DB_VERSION = 1

const STORE_SNAPSHOT = 'snapshot'
const STORE_ASSETS = 'assets'
const STORE_META = 'meta'
const MAX_OBJECT_URL_CACHE = 128
const UPGRADE_JOURNAL_KEY = 'upgrade-journal'
const UPGRADE_ROLLBACK_KEY = 'upgrade-rollback'

interface BrowserUpgradeJournal {
  targetVersion: number
  phase: 'pending-v7' | 'committed-v7'
  sourceChecksumSha256: string
}

interface AssetRecord {
  id: string
  mime: string
  byteSize: number
  createdAt: string
  blob: Blob
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
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

async function checksumJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function assertBrowserUpgradeJournal(value: unknown): asserts value is BrowserUpgradeJournal {
  if (
    typeof value !== 'object' || value === null ||
    !Number.isInteger((value as BrowserUpgradeJournal).targetVersion) ||
    (value as BrowserUpgradeJournal).targetVersion < 1 ||
    !['pending-v7', 'committed-v7'].includes((value as BrowserUpgradeJournal).phase) ||
    !/^[a-f0-9]{64}$/.test((value as BrowserUpgradeJournal).sourceChecksumSha256)
  ) throw new Error('IndexedDB upgrade journal is invalid')
}

async function recoverPendingBrowserUpgrade(db: IDBDatabase): Promise<void> {
  const journal = await idbGet<unknown>(db, STORE_META, UPGRADE_JOURNAL_KEY)
  if (journal === undefined) return
  assertBrowserUpgradeJournal(journal)
  if (journal.phase === 'committed-v7') return

  const rollback = await idbGet<unknown>(db, STORE_SNAPSHOT, UPGRADE_ROLLBACK_KEY)
  const manifest = await idbGet<LibraryManifest>(db, STORE_META, 'manifest')
  if (
    rollback === undefined ||
    !manifest ||
    await checksumJson(rollback) !== journal.sourceChecksumSha256
  ) throw new Error('IndexedDB pre-v7 rollback snapshot is missing or damaged')

  const active = await idbGet<unknown>(db, STORE_SNAPSHOT, 'main')
  try {
    assertValidSnapshotForSchema(active, journal.targetVersion, 'Pending browser upgrade snapshot')
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite')
      tx.objectStore(STORE_META).put({ ...manifest, schemaVersion: journal.targetVersion }, 'manifest')
      tx.objectStore(STORE_META).put({ ...journal, phase: 'committed-v7' }, UPGRADE_JOURNAL_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB pending upgrade commit failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB pending upgrade commit aborted'))
    })
  } catch {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_SNAPSHOT, STORE_META], 'readwrite')
      tx.objectStore(STORE_SNAPSHOT).put(rollback, 'main')
      tx.objectStore(STORE_META).put(manifest, 'manifest')
      tx.objectStore(STORE_META).delete(UPGRADE_JOURNAL_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB pending upgrade rollback failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB pending upgrade rollback aborted'))
    })
  }
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

  async open(): Promise<void> {
    this.db = await openDb()
    await recoverPendingBrowserUpgrade(this.db)
    const manifest = await idbGet<LibraryManifest>(this.db, STORE_META, 'manifest')
    if (!manifest) {
      const existingSnapshot = await idbGet<unknown>(this.db, STORE_SNAPSHOT, 'main')
      if (existingSnapshot !== undefined) return
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
    const raw = await this.loadRawSnapshot()
    if (raw === null) return null
    const db = this.requireDb()
    const manifest = await idbGet<LibraryManifest>(db, STORE_META, 'manifest')
    const migrated = migrateSnapshotToCurrent(raw, {
      source: 'library',
      manifestSchemaVersion: manifest?.schemaVersion,
    })
    assertValidPersistedSnapshot(migrated.snapshot, 'Stored browser snapshot')
    if (migrated.didChange && migrated.toVersion === 7) {
      const result = await this.commitUpgradeSnapshot(migrated.snapshot, migrated.toVersion)
      if (result !== 'committed') {
        throw new Error('浏览器资料库升级未完成，已恢复升级前数据，请重新打开后重试')
      }
    }
    return migrated.snapshot
  }

  async loadRawSnapshot(): Promise<unknown | null> {
    const db = this.requireDb()
    return (await idbGet<unknown>(db, STORE_SNAPSHOT, 'main')) ?? null
  }

  async saveSnapshot(snapshot: PersistedSnapshot): Promise<void> {
    assertValidSnapshotForSchema(snapshot, SCHEMA_VERSION, 'Browser snapshot')
    const db = this.requireDb()
    await idbPut(db, STORE_SNAPSHOT, 'main', snapshot)
  }

  async commitUpgradeSnapshot(
    migratedSnapshot: PersistedSnapshot,
    targetVersion: number,
    validateHydrated: (snapshot: unknown) => void = (snapshot) =>
      assertValidSnapshotForSchema(snapshot, targetVersion, 'Upgraded browser snapshot'),
  ): Promise<'committed' | 'restored'> {
    const db = this.requireDb()
    const currentSnapshot = await idbGet<unknown>(db, STORE_SNAPSHOT, 'main')
    const currentManifest = await idbGet<LibraryManifest>(db, STORE_META, 'manifest')
    if (currentSnapshot === undefined || !currentManifest) throw new Error('cannot upgrade an incomplete browser library')
    const journal: BrowserUpgradeJournal = {
      targetVersion,
      phase: 'pending-v7',
      sourceChecksumSha256: await checksumJson(currentSnapshot),
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_SNAPSHOT, STORE_META], 'readwrite')
      tx.objectStore(STORE_SNAPSHOT).put(structuredClone(currentSnapshot), UPGRADE_ROLLBACK_KEY)
      tx.objectStore(STORE_SNAPSHOT).put(structuredClone(migratedSnapshot), 'main')
      tx.objectStore(STORE_META).put(journal, UPGRADE_JOURNAL_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB upgrade transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB upgrade transaction aborted'))
    })
    try {
      validateHydrated(migratedSnapshot)
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readwrite')
        tx.objectStore(STORE_META).put({ ...currentManifest, schemaVersion: targetVersion }, 'manifest')
        tx.objectStore(STORE_META).put({ ...journal, phase: 'committed-v7' }, UPGRADE_JOURNAL_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB upgrade commit failed'))
      })
      return 'committed'
    } catch {
      const rollback = await idbGet<unknown>(db, STORE_SNAPSHOT, UPGRADE_ROLLBACK_KEY)
      if (rollback === undefined || await checksumJson(rollback) !== journal.sourceChecksumSha256) {
        throw new Error('IndexedDB pre-v7 rollback snapshot is missing or damaged')
      }
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_SNAPSHOT, STORE_META], 'readwrite')
        tx.objectStore(STORE_SNAPSHOT).put(rollback, 'main')
        tx.objectStore(STORE_META).put(currentManifest, 'manifest')
        tx.objectStore(STORE_META).delete(UPGRADE_JOURNAL_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB upgrade rollback failed'))
      })
      return 'restored'
    }
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
    const referencedAssetIds = new Set(collectAssetIdsFromNotes(snapshot.trades))
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
}

let adapterInstance: IndexedDbStorageAdapter | null = null

export function getIndexedDbAdapter(): IndexedDbStorageAdapter {
  if (!adapterInstance) adapterInstance = new IndexedDbStorageAdapter()
  return adapterInstance
}
