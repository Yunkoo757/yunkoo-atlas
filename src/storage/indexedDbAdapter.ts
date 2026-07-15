import type { AssetStorageStats, StorageAdapter } from '@/storage/adapter'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import { SCHEMA_VERSION } from '@/storage/types'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import { encodeSnapshotForLegacyReaders } from '@/storage/snapshotCompatibility'
import { collectAssetIdsFromNotes } from '@/storage/assets'
import { collectSnapshotMutations, planLocalSyncBatch } from '@/sync/localJournal'
import { planRemoteSnapshotApply } from '@/sync/remoteApply'
import type {
  LocalSyncStatus,
  RemoteSyncApplyResult,
  RemoteSyncOperation,
  SyncConflict,
  SyncOutboxOperation,
} from '@/sync/types'

// This browser storage name is intentionally kept for backward compatibility.
// Export payload/schema versions are tracked separately by SCHEMA_VERSION.
const DB_NAME = 'linear-journal-v3'
const DB_VERSION = 3

const STORE_SNAPSHOT = 'snapshot'
const STORE_ASSETS = 'assets'
const STORE_META = 'meta'
const STORE_SYNC_STATE = 'sync_state'
const STORE_SYNC_OUTBOX = 'sync_outbox'
const STORE_ENTITY_VERSIONS = 'entity_versions'
const STORE_SYNC_CONFLICTS = 'sync_conflicts'
const MAX_OBJECT_URL_CACHE = 128
const SYNC_STATE_KEY = 'main'

interface AssetRecord {
  id: string
  mime: string
  byteSize: number
  createdAt: string
  blob: Blob
}

interface SyncStateRecord {
  deviceId: string
  epoch: number
  deviceSeq: number
  pullCursor: string | null
  lastSyncAt: string | null
}

interface StoredSyncOperation extends SyncOutboxOperation {
  entityKey: string
}

interface EntityVersionRecord {
  entityKey: string
  revision: number
  deleted: boolean
  updatedAt: string
}

type StoredSyncConflict = SyncConflict

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
      if (!db.objectStoreNames.contains(STORE_SYNC_STATE)) {
        db.createObjectStore(STORE_SYNC_STATE)
      }
      if (!db.objectStoreNames.contains(STORE_SYNC_OUTBOX)) {
        const store = db.createObjectStore(STORE_SYNC_OUTBOX, { keyPath: 'entityKey' })
        store.createIndex('deviceSeq', 'deviceSeq', { unique: true })
      }
      if (!db.objectStoreNames.contains(STORE_ENTITY_VERSIONS)) {
        db.createObjectStore(STORE_ENTITY_VERSIONS, { keyPath: 'entityKey' })
      }
      if (!db.objectStoreNames.contains(STORE_SYNC_CONFLICTS)) {
        db.createObjectStore(STORE_SYNC_CONFLICTS, { keyPath: 'conflictId' })
      }
    }
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function syncEntityKey(entityType: string, entityId: string): string {
  return `${entityType}\u0000${entityId}`
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
    const syncState = await idbGet<SyncStateRecord>(this.db, STORE_SYNC_STATE, SYNC_STATE_KEY)
    if (!syncState) {
      await idbPut(this.db, STORE_SYNC_STATE, SYNC_STATE_KEY, {
        deviceId: crypto.randomUUID(),
        epoch: 1,
        deviceSeq: 0,
        pullCursor: null,
        lastSyncAt: null,
      } satisfies SyncStateRecord)
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
    const snapshot = (await idbGet<unknown>(db, STORE_SNAPSHOT, 'main')) ?? null
    if (!snapshot) return null
    assertValidPersistedSnapshot(snapshot, 'Stored browser snapshot')
    return snapshot
  }

  async saveSnapshot(snapshot: PersistedSnapshot): Promise<void> {
    assertValidPersistedSnapshot(snapshot, 'Browser snapshot')
    const db = this.requireDb()
    const tx = db.transaction(
      [STORE_SNAPSHOT, STORE_SYNC_STATE, STORE_SYNC_OUTBOX, STORE_ENTITY_VERSIONS],
      'readwrite',
    )
    const done = transactionDone(tx)
    await this.stageSnapshotAndLocalMutations(tx, encodeSnapshotForLegacyReaders(snapshot))
    await done
  }

  private async stageSnapshotAndLocalMutations(
    tx: IDBTransaction,
    snapshot: PersistedSnapshot,
  ): Promise<void> {
    const snapshotStore = tx.objectStore(STORE_SNAPSHOT)
    const stateStore = tx.objectStore(STORE_SYNC_STATE)
    const outboxStore = tx.objectStore(STORE_SYNC_OUTBOX)
    const versionsStore = tx.objectStore(STORE_ENTITY_VERSIONS)
    const [previous, state, existingOperations, existingVersions] = await Promise.all([
      requestResult(snapshotStore.get('main') as IDBRequest<PersistedSnapshot | undefined>),
      requestResult(stateStore.get(SYNC_STATE_KEY) as IDBRequest<SyncStateRecord | undefined>),
      requestResult(outboxStore.getAll() as IDBRequest<StoredSyncOperation[]>),
      requestResult(versionsStore.getAll() as IDBRequest<EntityVersionRecord[]>),
    ])
    if (!state) throw new Error('Missing browser local sync state')
    if (previous) assertValidPersistedSnapshot(previous, 'Stored browser snapshot')

    const operationsByEntity = new Map(
      existingOperations.map((operation) => [operation.entityKey, operation]),
    )
    const versionsByEntity = new Map(
      existingVersions.map((version) => [version.entityKey, version]),
    )
    const mutations = previous ? collectSnapshotMutations(previous, snapshot) : []
    const batch = planLocalSyncBatch({
      mutations,
      deviceId: state.deviceId,
      deviceSeq: state.deviceSeq,
      createdAt: new Date().toISOString(),
      createOperationId: () => crypto.randomUUID(),
      getCurrentRevision: (entityType, entityId) => (
        versionsByEntity.get(syncEntityKey(entityType, entityId))?.revision ?? 0
      ),
      getPendingOperation: (entityType, entityId) => (
        operationsByEntity.get(syncEntityKey(entityType, entityId))
      ),
    })

    for (const operation of batch.operations) {
      const entityKey = syncEntityKey(operation.entityType, operation.entityId)
      outboxStore.put({
        entityKey,
        ...operation,
      } satisfies StoredSyncOperation)
    }
    for (const version of batch.versions) {
      versionsStore.put({
        entityKey: syncEntityKey(version.entityType, version.entityId),
        revision: version.revision,
        deleted: version.deleted,
        updatedAt: version.updatedAt,
      } satisfies EntityVersionRecord)
    }

    if (batch.deviceSeq !== state.deviceSeq) {
      stateStore.put({ ...state, deviceSeq: batch.deviceSeq }, SYNC_STATE_KEY)
    }
    snapshotStore.put(snapshot, 'main')
  }

  async getLocalSyncStatus(): Promise<LocalSyncStatus> {
    const db = this.requireDb()
    const [manifest, state, pendingCount, conflictCount] = await Promise.all([
      idbGet<LibraryManifest>(db, STORE_META, 'manifest'),
      idbGet<SyncStateRecord>(db, STORE_SYNC_STATE, SYNC_STATE_KEY),
      new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE_SYNC_OUTBOX, 'readonly')
        const request = tx.objectStore(STORE_SYNC_OUTBOX).count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
      new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE_SYNC_CONFLICTS, 'readonly')
        const request = tx.objectStore(STORE_SYNC_CONFLICTS).count()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
    ])
    if (!manifest) throw new Error('Missing library manifest')
    if (!state) throw new Error('Missing browser local sync state')
    return { libraryId: manifest.libraryId, ...state, pendingCount, conflictCount }
  }

  async listPendingSyncOperations(limit = 500): Promise<SyncOutboxOperation[]> {
    const db = this.requireDb()
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(Math.trunc(limit), 5000))
      : 500
    const records = await new Promise<StoredSyncOperation[]>((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_OUTBOX, 'readonly')
      const request = tx.objectStore(STORE_SYNC_OUTBOX).getAll()
      request.onsuccess = () => resolve(request.result as StoredSyncOperation[])
      request.onerror = () => reject(request.error)
    })
    return records
      .sort((a, b) => a.deviceSeq - b.deviceSeq)
      .slice(0, safeLimit)
      .map(({ entityKey: _entityKey, ...operation }) => operation)
  }

  async acknowledgeSyncOperations(operationIds: string[], pullCursor?: string): Promise<void> {
    const db = this.requireDb()
    const acknowledged = new Set(operationIds.filter(Boolean))
    const tx = db.transaction([STORE_SYNC_STATE, STORE_SYNC_OUTBOX], 'readwrite')
    const done = transactionDone(tx)
    const stateStore = tx.objectStore(STORE_SYNC_STATE)
    const outboxStore = tx.objectStore(STORE_SYNC_OUTBOX)
    const [state, operations] = await Promise.all([
      requestResult(stateStore.get(SYNC_STATE_KEY) as IDBRequest<SyncStateRecord | undefined>),
      requestResult(outboxStore.getAll() as IDBRequest<StoredSyncOperation[]>),
    ])
    if (!state) {
      try { tx.abort() } catch { /* transaction may already be closed */ }
      throw new Error('Missing browser local sync state')
    }
    for (const operation of operations) {
      if (acknowledged.has(operation.opId)) outboxStore.delete(operation.entityKey)
    }
    stateStore.put({
      ...state,
      pullCursor: pullCursor ?? state.pullCursor,
      lastSyncAt: new Date().toISOString(),
    } satisfies SyncStateRecord, SYNC_STATE_KEY)
    await done
  }

  async applyRemoteSyncOperations(
    operations: RemoteSyncOperation[],
    pullCursor: string,
  ): Promise<RemoteSyncApplyResult> {
    const db = this.requireDb()
    const tx = db.transaction(
      [
        STORE_SNAPSHOT,
        STORE_SYNC_STATE,
        STORE_SYNC_OUTBOX,
        STORE_ENTITY_VERSIONS,
        STORE_SYNC_CONFLICTS,
      ],
      'readwrite',
    )
    const done = transactionDone(tx)
    try {
      const snapshotStore = tx.objectStore(STORE_SNAPSHOT)
      const stateStore = tx.objectStore(STORE_SYNC_STATE)
      const outboxStore = tx.objectStore(STORE_SYNC_OUTBOX)
      const versionsStore = tx.objectStore(STORE_ENTITY_VERSIONS)
      const conflictsStore = tx.objectStore(STORE_SYNC_CONFLICTS)
      const [snapshot, state, pendingOperations, versions] = await Promise.all([
        requestResult(snapshotStore.get('main') as IDBRequest<PersistedSnapshot | undefined>),
        requestResult(stateStore.get(SYNC_STATE_KEY) as IDBRequest<SyncStateRecord | undefined>),
        requestResult(outboxStore.getAll() as IDBRequest<StoredSyncOperation[]>),
        requestResult(versionsStore.getAll() as IDBRequest<EntityVersionRecord[]>),
      ])
      if (!snapshot) throw new Error('本地资料库尚未建立快照，无法应用远端同步')
      if (!state) throw new Error('Missing browser local sync state')
      assertValidPersistedSnapshot(snapshot, 'Stored browser snapshot')
      const pendingKeys = new Set(pendingOperations.map((operation) => operation.entityKey))
      const versionsByEntity = new Map(versions.map((version) => [version.entityKey, version]))
      const plan = planRemoteSnapshotApply({
        snapshot,
        operations,
        localDeviceId: state.deviceId,
        getCurrentRevision: (entityType, entityId) => (
          versionsByEntity.get(syncEntityKey(entityType, entityId))?.revision ?? 0
        ),
        hasPendingOperation: (entityType, entityId) => (
          pendingKeys.has(syncEntityKey(entityType, entityId))
        ),
      })
      assertValidPersistedSnapshot(plan.snapshot, 'Remote synced browser snapshot')
      if (plan.appliedCount > 0) snapshotStore.put(plan.snapshot, 'main')
      for (const version of plan.versions) {
        versionsStore.put({
          entityKey: syncEntityKey(version.entityType, version.entityId),
          revision: version.revision,
          deleted: version.deleted,
          updatedAt: version.updatedAt,
        } satisfies EntityVersionRecord)
      }
      const createdAt = new Date().toISOString()
      for (const conflict of plan.conflicts) {
        conflictsStore.put({
          conflictId: conflict.remoteOperation.opId,
          entityType: conflict.remoteOperation.entityType,
          entityId: conflict.remoteOperation.entityId,
          localRevision: conflict.localRevision,
          remoteOperation: conflict.remoteOperation,
          createdAt,
          state: 'unresolved',
        } satisfies StoredSyncConflict)
      }
      stateStore.put({ ...state, pullCursor, lastSyncAt: createdAt }, SYNC_STATE_KEY)
      await done
      return {
        appliedCount: plan.appliedCount,
        conflictCount: plan.conflicts.length,
        appliedOperations: plan.appliedOperations,
      }
    } catch (error) {
      try { tx.abort() } catch { /* transaction may already be closed */ }
      throw error
    }
  }

  async listSyncConflicts(limit = 100): Promise<SyncConflict[]> {
    const db = this.requireDb()
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(Math.trunc(limit), 1000))
      : 100
    const records = await new Promise<StoredSyncConflict[]>((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_CONFLICTS, 'readonly')
      const request = tx.objectStore(STORE_SYNC_CONFLICTS).getAll()
      request.onsuccess = () => resolve(request.result as StoredSyncConflict[])
      request.onerror = () => reject(request.error)
    })
    return records
      .filter((conflict) => conflict.state === 'unresolved')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, safeLimit)
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
    const tx = db.transaction(
      [
        STORE_SNAPSHOT,
        STORE_ASSETS,
        STORE_SYNC_STATE,
        STORE_SYNC_OUTBOX,
        STORE_ENTITY_VERSIONS,
      ],
      'readwrite',
    )
    const done = transactionDone(tx)
    try {
      await this.stageSnapshotAndLocalMutations(tx, encodeSnapshotForLegacyReaders(snapshot))
      const assetStore = tx.objectStore(STORE_ASSETS)
      records.forEach((record) => assetStore.put(record))
      if (options?.pruneUnreferenced) {
        assets.forEach((asset) => {
          if (!referencedAssetIds.has(asset.id)) assetStore.delete(asset.id)
        })
      }
      await done
    } catch (error) {
      try { tx.abort() } catch { /* transaction may already be closed */ }
      throw error
    }
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
