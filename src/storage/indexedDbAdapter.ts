import {
  StorageRevisionConflictError,
  type AssetStorageStats,
  type AssetPurgePreview,
  type AssetPurgeResult,
  type PhysicalAssetRecord,
  type RevisionedLibraryMutation,
  type RevisionedStorageAdapter,
  type SnapshotEnvelope,
} from '@/storage/adapter'
import type { ExportAssetRecord, LibraryManifest, PersistedSnapshot } from '@/storage/types'
import { SCHEMA_VERSION } from '@/storage/types'
import { assertCompatibleManifest } from '@/storage/manifestCompatibility'
import {
  assertValidPersistedSnapshot,
  isValidPersistedTrade,
} from '@/storage/snapshotValidation'
import { collectAssetIdsFromHtml, collectAssetIdsFromSnapshot } from '@/storage/assets'
import { isSafeAssetId } from '@/storage/assetId'
import { buildAssetInventory } from '@/storage/assetInventory'
import { OperationalError } from '@/lib/operationalError'
import { decodeCanonicalSnapshot } from '@/storage/snapshotCodec'
import {
  assertWebWriteAllowed,
  notifyWebRevisionCommitted,
  reportWebRevisionConflict,
} from '@/storage/webWriteGuard'
import {
  queueIndexedDbSnapshotAssetWrites,
  type IndexedDbAssetRecord,
} from '@/storage/indexedDbSnapshotAssetWrites'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import { beginWebOperation } from '@/storage/webOperationLogger'

// This browser storage name is intentionally kept for backward compatibility.
// Export payload/schema versions are tracked separately by SCHEMA_VERSION.
const DB_NAME = 'linear-journal-v3'

const STORE_SNAPSHOT = 'snapshot'
const STORE_ASSETS = 'assets'
const STORE_META = 'meta'
const SNAPSHOT_REVISION_KEY = 'snapshotRevision'
const MAX_OBJECT_URL_CACHE = 128
const SNAPSHOT_VALIDATION_BATCH_SIZE = 1_000
const REQUIRED_STORES = [STORE_SNAPSHOT, STORE_ASSETS, STORE_META] as const

type AssetRecord = IndexedDbAssetRecord

interface PreparedIndexedDbMutation {
  referencedIds: Set<string>
  putIds: Set<string>
  records: AssetRecord[]
}

function yieldMainThread(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function assertValidPersistedSnapshotCooperatively(
  snapshot: PersistedSnapshot,
  label: string,
): Promise<void> {
  const trades = (snapshot as unknown as { trades?: unknown }).trades
  if (!Array.isArray(trades)) throw new Error(`${label} is missing trades or strategies`)

  const tradeIds = new Set<string>()
  for (let index = 0; index < trades.length; index += 1) {
    if (index % SNAPSHOT_VALIDATION_BATCH_SIZE === 0) await yieldMainThread()
    const trade = trades[index]
    if (!isValidPersistedTrade(trade)) throw new Error(`${label} contains an invalid trade`)
    if (tradeIds.has(trade.id)) throw new Error(`${label} contains duplicate trade ids`)
    tradeIds.add(trade.id)
  }

  assertValidPersistedSnapshot({ ...snapshot, trades: [] }, label)
}

async function collectAssetIdsFromSnapshotCooperatively(
  snapshot: PersistedSnapshot,
): Promise<Set<string>> {
  const assetIds = new Set<string>()
  const collectEntries = async (
    length: number,
    getHtml: (index: number) => string,
  ): Promise<void> => {
    for (let start = 0; start < length; start += SNAPSHOT_VALIDATION_BATCH_SIZE) {
      await yieldMainThread()
      const end = Math.min(start + SNAPSHOT_VALIDATION_BATCH_SIZE, length)
      const htmlEntries: string[] = []
      for (let index = start; index < end; index += 1) htmlEntries.push(getHtml(index))
      for (const id of collectAssetIdsFromHtml(htmlEntries)) assetIds.add(id)
    }
  }

  await collectEntries(snapshot.trades.length, (index) => snapshot.trades[index].note)
  await collectEntries(
    snapshot.weeklyReviews?.length ?? 0,
    (index) => snapshot.weeklyReviews?.[index].contentHtml ?? '',
  )
  await collectEntries(
    snapshot.quickNotes?.length ?? 0,
    (index) => snapshot.quickNotes?.[index].contentHtml ?? '',
  )
  return assetIds
}

async function prepareIndexedDbMutation(
  input: RevisionedLibraryMutation,
): Promise<PreparedIndexedDbMutation> {
  await yieldMainThread()
  await assertValidPersistedSnapshotCooperatively(input.snapshot, 'Revisioned browser snapshot')
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error('expectedRevision must be a non-negative safe integer')
  }

  await yieldMainThread()
  const referencedIds = await collectAssetIdsFromSnapshotCooperatively(input.snapshot)
  const allowedUnreferencedIds = new Set(input.allowedUnreferencedAssetPuts ?? [])
  const puts = input.assetPuts ?? []
  const deletes = input.assetDeletes ?? []
  const putIds = new Set<string>()
  const deleteIds = new Set<string>()
  const records = puts.map((put) => {
    if (!put.id || !put.mime || !(put.blob instanceof Blob)) {
      throw new Error('Invalid prepared asset put')
    }
    if (putIds.has(put.id)) throw new Error(`Duplicate asset put: ${put.id}`)
    if (!referencedIds.has(put.id) && !allowedUnreferencedIds.has(put.id)) {
      throw new Error(`Unreferenced asset put: ${put.id}`)
    }
    putIds.add(put.id)
    return {
      id: put.id,
      mime: put.mime,
      byteSize: put.blob.size,
      createdAt: new Date().toISOString(),
      blob: put.blob,
    } satisfies AssetRecord
  })
  for (const id of deletes) {
    if (!id || deleteIds.has(id)) throw new Error(`Invalid duplicate asset delete: ${id}`)
    if (putIds.has(id)) throw new Error(`Asset cannot be put and deleted: ${id}`)
    if (referencedIds.has(id)) throw new Error(`Referenced asset cannot be deleted: ${id}`)
    deleteIds.add(id)
  }
  if (input.assetMode === 'replace') {
    for (const id of referencedIds) {
      if (!putIds.has(id)) throw new Error(`Replacement snapshot is missing asset: ${id}`)
    }
  }
  await yieldMainThread()
  return { referencedIds, putIds, records }
}

export { StorageRevisionConflictError } from '@/storage/adapter'

function normalizeSnapshotRevision(value: unknown): number {
  if (value === undefined) return 0
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  throw new Error('Invalid snapshot revision metadata')
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

function openDb(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(databaseName)
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
      const repair = indexedDB.open(databaseName, repairVersion)
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

export class IndexedDbStorageAdapter implements RevisionedStorageAdapter {
  private db: IDBDatabase | null = null
  private objectUrlCache = new Map<string, string>()
  private preparedAssets = new Map<string, AssetRecord>()
  private mutationTail: Promise<void> = Promise.resolve()
  private currentRevision: number | null = null
  private assetPurgePreviews = new Map<string, {
    revision: number
    snapshot: PersistedSnapshot
    candidateIds: string[]
    totalBytes: number
  }>()
  private purgingAssetIds = new Set<string>()
  private readonly assetPurgeCommitEnabled: boolean
  private assetPurgeAuthorizations = new Map<string, { token: string; createdAt: number }>()

  constructor(
    private readonly databaseName = DB_NAME,
    options: { assetPurgeCommitEnabled?: boolean } = {},
  ) {
    this.assetPurgeCommitEnabled = options.assetPurgeCommitEnabled
      ?? import.meta.env.VITE_ENABLE_ASSET_PURGE_COMMIT === 'true'
  }

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
    this.db = await openDb(this.databaseName)
    const manifest = await idbGet<LibraryManifest>(this.db, STORE_META, 'manifest')
    if (!manifest) {
      await initializeMissingManifest(this.db)
      return
    }
    assertCompatibleManifest(manifest)
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

  close(): void {
    this.clearObjectUrlCache()
    this.preparedAssets.clear()
    this.currentRevision = null
    this.assetPurgePreviews.clear()
    this.assetPurgeAuthorizations.clear()
    this.purgingAssetIds.clear()
    this.db?.close()
    this.db = null
  }

  /** Release 0 兼容读取：旧库尚无 revision 时稳定视为 0；WEB1 再引入递增/CAS。 */
  async getSnapshotRevision(): Promise<number> {
    const value = await idbGet<unknown>(this.requireDb(), STORE_META, SNAPSHOT_REVISION_KEY)
    return normalizeSnapshotRevision(value)
  }

  async loadSnapshotEnvelope(): Promise<SnapshotEnvelope> {
    const db = this.requireDb()
    const readStored = () => new Promise<{
      revision: number
      snapshot: PersistedSnapshot | null
      manifest: LibraryManifest
    }>((resolve, reject) => {
      const tx = db.transaction([STORE_SNAPSHOT, STORE_META], 'readonly')
      const snapshotRequest = tx.objectStore(STORE_SNAPSHOT).get('main')
      const revisionRequest = tx.objectStore(STORE_META).get(SNAPSHOT_REVISION_KEY)
      const manifestRequest = tx.objectStore(STORE_META).get('manifest')
      let failure: unknown = null
      tx.oncomplete = () => {
        try {
          const manifest = manifestRequest.result as LibraryManifest
          assertCompatibleManifest(manifest)
          const snapshot = snapshotRequest.result === undefined
            ? null
            : decodeCanonicalSnapshot(snapshotRequest.result, {
                version: manifest.schemaVersion,
                label: 'Stored browser snapshot',
              })
          resolve({
            revision: normalizeSnapshotRevision(revisionRequest.result),
            snapshot,
            manifest,
          })
        } catch (error) {
          failure = error
          reject(error)
        }
      }
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB snapshot envelope read failed'))
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('IndexedDB snapshot envelope read aborted'))
    })

    let stored = await readStored()
    if (stored.manifest.schemaVersion < SCHEMA_VERSION) {
      const migrationSnapshot = stored.snapshot ?? createEmptyPersistedSnapshot()
      try {
        const migration = await this.enqueueLibraryMutation(() => ({
          expectedRevision: stored.revision,
          snapshot: migrationSnapshot,
          reason: 'migration',
        }), false, false)
        stored = {
          ...stored,
          revision: migration.revision,
          snapshot: migrationSnapshot,
          manifest: { ...stored.manifest, schemaVersion: SCHEMA_VERSION },
        }
      } catch (error) {
        if (!(error instanceof StorageRevisionConflictError)) throw error
        const latest = await readStored()
        if (latest.manifest.schemaVersion < SCHEMA_VERSION) throw error
        stored = latest
      }
    }
    const envelope = { revision: stored.revision, snapshot: stored.snapshot }
    this.currentRevision = Math.max(this.currentRevision ?? 0, envelope.revision)
    return envelope
  }

  commitLibraryMutation(input: RevisionedLibraryMutation): Promise<{ revision: number }> {
    return this.enqueueLibraryMutation(() => input)
  }

  private enqueueLibraryMutation(
    createInput: () => RevisionedLibraryMutation | Promise<RevisionedLibraryMutation>,
    enforceWriteGuard = true,
    reportConflicts = true,
  ): Promise<{ revision: number }> {
    const operation = this.mutationTail.then(async () => {
      if (enforceWriteGuard) assertWebWriteAllowed()
      try {
        const input = await createInput()
        const preflightRevision = await this.getSnapshotRevision()
        if (preflightRevision !== input.expectedRevision) {
          throw new StorageRevisionConflictError(input.expectedRevision, preflightRevision)
        }
        return await this.runLibraryMutation(input)
      } catch (error) {
        if (reportConflicts && error instanceof StorageRevisionConflictError) reportWebRevisionConflict(error)
        throw error
      }
    })
    this.mutationTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private commitAtCurrentRevision(
    createInput: (expectedRevision: number) => Omit<RevisionedLibraryMutation, 'expectedRevision'>,
  ): Promise<{ revision: number }> {
    return this.enqueueLibraryMutation(async () => {
      if (this.currentRevision === null) await this.loadSnapshotEnvelope()
      return {
        ...createInput(this.currentRevision ?? 0),
        expectedRevision: this.currentRevision ?? 0,
      }
    })
  }

  private async runLibraryMutation(input: RevisionedLibraryMutation): Promise<{ revision: number }> {
    const prepared = await prepareIndexedDbMutation(input)
    const db = this.requireDb()
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_SNAPSHOT, STORE_ASSETS, STORE_META], 'readwrite')
      const snapshotStore = tx.objectStore(STORE_SNAPSHOT)
      const assetStore = tx.objectStore(STORE_ASSETS)
      const metaStore = tx.objectStore(STORE_META)
      const manifestRequest = metaStore.get('manifest')
      const revisionRequest = metaStore.get(SNAPSHOT_REVISION_KEY)
      let failure: unknown = null
      let nextRevision = input.expectedRevision
      let stopped = false

      const abort = (error: unknown) => {
        if (stopped) return
        stopped = true
        failure = error
        try {
          tx.abort()
        } catch {
          reject(error)
        }
      }

      const applyMutation = (assetPuts: readonly AssetRecord[]) => {
        if (stopped) return
        try {
          queueIndexedDbSnapshotAssetWrites(snapshotStore, assetStore, {
            snapshot: input.snapshot,
            assetMode: input.assetMode ?? 'merge',
            assetPuts,
            assetDeletes: input.assetDeletes,
          })
          const manifest = manifestRequest.result as LibraryManifest
          assertCompatibleManifest(manifest)
          if (manifest.schemaVersion < SCHEMA_VERSION) {
            metaStore.put({ ...manifest, schemaVersion: SCHEMA_VERSION }, 'manifest')
          }
          metaStore.put(nextRevision, SNAPSHOT_REVISION_KEY)
        } catch (error) {
          abort(error)
        }
      }

      revisionRequest.onsuccess = () => {
        let actualRevision: number
        try {
          actualRevision = normalizeSnapshotRevision(revisionRequest.result)
        } catch (error) {
          abort(error)
          return
        }
        if (actualRevision !== input.expectedRevision) {
          abort(new StorageRevisionConflictError(input.expectedRevision, actualRevision))
          return
        }

        try {
          nextRevision = actualRevision + 1
          if (input.assetMode === 'replace') {
            applyMutation(prepared.records)
            return
          }

          const existingIds = [...prepared.referencedIds].filter((id) => !prepared.putIds.has(id))
          if (existingIds.length === 0) {
            applyMutation(prepared.records)
            return
          }
          let remaining = existingIds.length
          for (const id of existingIds) {
            const request = assetStore.get(id)
            request.onsuccess = () => {
              const record = request.result as AssetRecord | undefined
              if (!record?.blob || record.blob.size !== record.byteSize) {
                abort(new OperationalError(
                  'asset-reference-missing',
                  `Snapshot references missing asset: ${id}`,
                ))
                return
              }
              remaining -= 1
              if (remaining === 0) applyMutation(prepared.records)
            }
            request.onerror = () => abort(request.error ?? new Error(`Asset lookup failed: ${id}`))
          }
        } catch (error) {
          abort(error)
        }
      }
      revisionRequest.onerror = () => abort(
        revisionRequest.error ?? new Error('IndexedDB revision read failed'),
      )
      tx.oncomplete = () => {
        stopped = true
        this.currentRevision = nextRevision
        for (const put of input.assetPuts ?? []) {
          if (this.preparedAssets.get(put.id)?.blob === put.blob) this.preparedAssets.delete(put.id)
        }
        for (const id of input.assetDeletes ?? []) {
          const cached = this.objectUrlCache.get(id)
          if (cached) URL.revokeObjectURL(cached)
          this.objectUrlCache.delete(id)
        }
        if (input.assetMode === 'replace') this.clearObjectUrlCache()
        notifyWebRevisionCommitted(nextRevision)
        resolve({ revision: nextRevision })
      }
      tx.onerror = () => reject(failure ?? tx.error ?? new Error('IndexedDB mutation failed'))
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('IndexedDB mutation aborted'))
    })
  }

  async loadSnapshot(): Promise<PersistedSnapshot | null> {
    return (await this.loadSnapshotEnvelope()).snapshot
  }

  async saveSnapshot(snapshot: PersistedSnapshot): Promise<void> {
    const referencedIds = await collectAssetIdsFromSnapshotCooperatively(snapshot)
    await this.commitAtCurrentRevision(() => ({
      snapshot,
      assetPuts: [...this.preparedAssets.values()].filter((asset) => referencedIds.has(asset.id)),
      reason: 'autosave',
    }))
  }

  async saveAsset(blob: Blob, mime: string): Promise<string> {
    assertWebWriteAllowed()
    const id = crypto.randomUUID()
    const record: AssetRecord = {
      id,
      mime,
      byteSize: blob.size,
      createdAt: new Date().toISOString(),
      blob,
    }
    this.preparedAssets.set(id, record)
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
    const record = this.preparedAssets.get(id) ?? await idbGet<AssetRecord>(db, STORE_ASSETS, id)
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
    const record = this.preparedAssets.get(id) ?? await idbGet<AssetRecord>(db, STORE_ASSETS, id)
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
        const prepared = this.preparedAssets.get(id)
        if (prepared) {
          count += 1
          totalBytes += prepared.blob.size
          continue
        }
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

  async listAssetRecords(): Promise<PhysicalAssetRecord[]> {
    const committed = await idbGetAll<AssetRecord>(this.requireDb(), STORE_ASSETS)
    return [
      ...committed.map((record): PhysicalAssetRecord => ({
        id: record.id,
        mime: record.mime,
        declaredBytes: record.byteSize,
        actualBytes: record.blob instanceof Blob ? record.blob.size : undefined,
        state: !isSafeAssetId(record.id)
          ? 'foreign'
          : !(record.blob instanceof Blob)
            ? 'missing'
            : record.blob.size === record.byteSize
              ? 'healthy'
              : 'size-mismatch',
        source: 'committed',
      })),
      ...[...this.preparedAssets.values()].map((record): PhysicalAssetRecord => ({
        id: record.id,
        mime: record.mime,
        declaredBytes: record.byteSize,
        actualBytes: record.blob.size,
        state: 'temp',
        source: 'prepared',
      })),
    ]
  }

  async previewAssetPurge(): Promise<AssetPurgePreview> {
    const envelope = await this.loadSnapshotEnvelope()
    if (!envelope.snapshot) throw new Error('当前资料库尚无可校验的持久化快照')
    const inventory = buildAssetInventory(envelope.snapshot, await this.listAssetRecords())
    const candidateIds = inventory.orphan.map((record) => record.id).sort()
    const operationId = crypto.randomUUID()
    const totalBytes = inventory.orphan.reduce(
      (sum, record) => sum + (record.actualBytes ?? 0),
      0,
    )
    this.assetPurgePreviews.set(operationId, {
      revision: envelope.revision,
      snapshot: envelope.snapshot,
      candidateIds,
      totalBytes,
    })
    return {
      operationId,
      revision: envelope.revision,
      candidateIds: [...candidateIds],
      totalBytes,
    }
  }

  async prepareAssetPurgeRecovery(preview: AssetPurgePreview) {
    const operation = beginWebOperation('archive', {
      operationId: preview.operationId,
      actionId: preview.operationId,
      stage: 'export-recovery',
      revisionBefore: preview.revision,
    })
    try {
      const prepared = this.assetPurgePreviews.get(preview.operationId)
      if (
        !prepared ||
        prepared.revision !== preview.revision ||
        prepared.candidateIds.join('\0') !== preview.candidateIds.join('\0') ||
        prepared.totalBytes !== preview.totalBytes
      ) {
        throw new OperationalError('asset-gc-stale-revision', '附件清理预览无效或已使用，请重新扫描')
      }
      const assets: ExportAssetRecord[] = []
      const recoveryIds = [...new Set([
        ...collectAssetIdsFromSnapshot(prepared.snapshot),
        ...prepared.candidateIds,
      ])]
      for (const id of recoveryIds) {
        const asset = await this.getAssetForExport(id)
        if (!asset) {
          throw new OperationalError('asset-reference-missing', `恢复归档缺少被引用附件：${id}`)
        }
        assets.push(asset)
      }
      const authorization = crypto.randomUUID()
      this.assetPurgeAuthorizations.set(preview.operationId, { token: authorization, createdAt: Date.now() })
      operation.success({ stage: 'verified', revisionAfter: preview.revision })
      return {
        authorization,
        webArchive: {
          snapshot: prepared.snapshot,
          assets,
          recoveryOrphanAssetIds: [...prepared.candidateIds],
        },
      }
    } catch (error) {
      operation.failure(error, { stage: 'export-recovery' })
      throw error
    }
  }

  async commitAssetPurge(preview: AssetPurgePreview, authorization: string): Promise<AssetPurgeResult> {
    const operation = beginWebOperation('gc', {
      operationId: preview.operationId,
      actionId: preview.operationId,
      stage: 'authorize',
      revisionBefore: preview.revision,
    })
    try {
      if (!this.assetPurgeCommitEnabled) {
        throw new Error('当前发布阶段仅开放附件清理 dry-run，永久删除已在存储边界关闭')
      }
      const expectedAuthorization = this.assetPurgeAuthorizations.get(preview.operationId)
      this.assetPurgeAuthorizations.delete(preview.operationId)
      if (
        !authorization ||
        authorization !== expectedAuthorization?.token ||
        Date.now() - (expectedAuthorization?.createdAt ?? 0) > 15 * 60_000
      ) {
        throw new Error('附件清理缺少与本次预览绑定的恢复归档授权')
      }
      const prepared = this.assetPurgePreviews.get(preview.operationId)
      this.assetPurgePreviews.delete(preview.operationId)
      if (
        !prepared ||
        prepared.revision !== preview.revision ||
        prepared.candidateIds.join('\0') !== preview.candidateIds.join('\0') ||
        prepared.totalBytes !== preview.totalBytes
      ) {
        throw new OperationalError('asset-gc-stale-revision', '附件清理预览无效或已使用，请重新扫描')
      }
      if (prepared.candidateIds.some((id) => this.preparedAssets.has(id))) {
        throw new OperationalError('asset-gc-stale-revision', '清理候选在预览后出现新的待提交附件，请重新扫描')
      }
      if (prepared.candidateIds.some((id) => this.purgingAssetIds.has(id))) {
        throw new Error('相同附件已有清理操作正在进行')
      }
      for (const id of prepared.candidateIds) this.purgingAssetIds.add(id)
      try {
        const result = await this.commitLibraryMutation({
          expectedRevision: prepared.revision,
          snapshot: prepared.snapshot,
          assetDeletes: prepared.candidateIds,
          reason: 'purge',
        })
        operation.success({ stage: 'committed', revisionAfter: result.revision })
        return { revision: result.revision, deletedIds: [...prepared.candidateIds] }
      } finally {
        for (const id of prepared.candidateIds) this.purgingAssetIds.delete(id)
      }
    } catch (error) {
      operation.failure(error, { stage: 'commit' })
      throw error
    }
  }

  async cancelAssetPurge(operationId: string): Promise<void> {
    this.assetPurgeAuthorizations.delete(operationId)
    this.assetPurgePreviews.delete(operationId)
  }

  async importAssets(assets: ExportAssetRecord[]): Promise<void> {
    assertWebWriteAllowed()
    if (assets.some((asset) => this.purgingAssetIds.has(asset.id))) {
      throw new Error('附件正在执行安全清理，请在清理完成后重试导入')
    }
    const records = assets.map((asset) => {
      const blob = base64ToBlob(asset.data, asset.mime)
      return {
        id: asset.id,
        mime: asset.mime,
        byteSize: blob.size,
        createdAt: new Date().toISOString(),
        blob,
      } satisfies AssetRecord
    })
    for (const record of records) {
      const cached = this.objectUrlCache.get(record.id)
      if (cached) URL.revokeObjectURL(cached)
      this.objectUrlCache.delete(record.id)
      this.preparedAssets.set(record.id, record)
    }
  }

  async commitImport(
    snapshot: PersistedSnapshot,
    assets: ExportAssetRecord[],
    options?: { pruneUnreferenced?: boolean },
  ): Promise<void> {
    const operation = beginWebOperation('import', {
      stage: 'validate',
      revisionBefore: this.currentRevision ?? 0,
    })
    try {
      assertValidPersistedSnapshot(snapshot, 'Imported browser snapshot')
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
      const result = await this.commitAtCurrentRevision(() => ({
        snapshot,
        assetPuts: records,
        assetDeletes: options?.pruneUnreferenced
          ? assets.filter((asset) => !referencedAssetIds.has(asset.id)).map((asset) => asset.id)
          : undefined,
        reason: 'import',
      }))
      operation.success({ stage: 'committed', revisionAfter: result.revision })
    } catch (error) {
      operation.failure(error, { stage: 'commit' })
      throw error
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
    recoveryOrphanAssetIds: readonly string[] = [],
  ): Promise<void> {
    const operation = beginWebOperation('archive', {
      stage: 'validate-restore',
      revisionBefore: this.currentRevision ?? 0,
    })
    try {
      assertValidPersistedSnapshot(snapshot, 'Restored browser snapshot')
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

      const result = await this.commitAtCurrentRevision(() => ({
        snapshot,
        assetPuts: records,
        assetMode: 'replace',
        allowedUnreferencedAssetPuts: recoveryOrphanAssetIds,
        reason: 'restore',
      }))
      operation.success({ stage: 'committed', revisionAfter: result.revision })
    } catch (error) {
      operation.failure(error, { stage: 'commit' })
      throw error
    }
  }
}

function idbGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

function initializeMissingManifest(db: IDBDatabase): Promise<LibraryManifest> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SNAPSHOT, STORE_META], 'readwrite')
    const snapshotRequest = tx.objectStore(STORE_SNAPSHOT).get('main')
    let created: LibraryManifest | null = null
    snapshotRequest.onsuccess = () => {
      created = {
        schemaVersion: snapshotRequest.result === undefined ? SCHEMA_VERSION : 1,
        libraryId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      }
      tx.objectStore(STORE_META).put(created, 'manifest')
    }
    tx.oncomplete = () => resolve(created!)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB manifest initialization failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB manifest initialization aborted'))
  })
}

let adapterInstance: IndexedDbStorageAdapter | null = null

export function getIndexedDbAdapter(): IndexedDbStorageAdapter {
  if (!adapterInstance) adapterInstance = new IndexedDbStorageAdapter()
  return adapterInstance
}
