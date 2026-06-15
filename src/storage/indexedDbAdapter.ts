import type { StorageAdapter } from '@/storage/adapter'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import { SCHEMA_VERSION } from '@/storage/types'

const DB_NAME = 'linear-journal-v3'
const DB_VERSION = 1

const STORE_SNAPSHOT = 'snapshot'
const STORE_ASSETS = 'assets'
const STORE_META = 'meta'

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
    return (await idbGet<PersistedSnapshot>(db, STORE_SNAPSHOT, 'main')) ?? null
  }

  async saveSnapshot(snapshot: PersistedSnapshot): Promise<void> {
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
    if (cached) return cached

    const db = this.requireDb()
    const record = await idbGet<AssetRecord>(db, STORE_ASSETS, id)
    if (!record?.blob) return null

    const url = URL.createObjectURL(record.blob)
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

  async importAssets(assets: ExportAssetRecord[]): Promise<void> {
    const db = this.requireDb()
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
}

let adapterInstance: IndexedDbStorageAdapter | null = null

export function getIndexedDbAdapter(): IndexedDbStorageAdapter {
  if (!adapterInstance) adapterInstance = new IndexedDbStorageAdapter()
  return adapterInstance
}
