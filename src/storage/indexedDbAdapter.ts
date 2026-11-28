import { AssetPurgePreviews } from './assetPurgePreviews'
import { rendererAllowsAssetPurge } from '@/config/assetPurge'
import { base64ToBytes } from '@/lib/base64'
import { stripRetiredSnapshotDomains } from './retiredSnapshotDomains'
import { AssetObjectUrlCache } from './assetObjectUrls'
import {
  StorageRevisionConflictError,
  type AssetStorageStats,
  type AssetPurgePreview,
  type AssetPurgeResult,
  type PhysicalAssetRecord,
  type LibraryImportAsset,
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
import { collectAssetIdsFromSnapshot, htmlAssetIds, snapshotRichTextRecords } from '@/storage/snapshotRichText'
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
import { migrateLegacyBrowserIdentity } from '@/storage/legacyIdentity'
import { openJournalDatabase, STORE_ASSETS, STORE_META, STORE_SNAPSHOT } from './indexedDbSchema'
import { BROWSER_DATABASE_NAME } from '@/storage/storageIdentity'

const SNAPSHOT_REVISION_KEY = 'snapshotRevision'
const SNAPSHOT_VALIDATION_BATCH_SIZE = 1_000

type AssetRecord = IndexedDbAssetRecord

interface PreparedIndexedDbMutation {
  referencedIds: Set<string>
  putIds: Set<string>
  records: AssetRecord[]
  storedSnapshot: Blob
}

function yieldMainThread(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> }
  }).scheduler
  if (scheduler?.yield) return scheduler.yield()
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

  // Keep the complete graph for cross-entity ownership validation. Individual
  // trades were already checked cooperatively above; the synchronous pass is
  // intentionally repeated so references can resolve against their targets.
  assertValidPersistedSnapshot(snapshot, label)
}

async function collectAssetIdsFromSnapshotCooperatively(
  snapshot: PersistedSnapshot,
): Promise<Set<string>> {
  const assetIds = new Set<string>()
  let recordIndex = 0
  for (const { html } of snapshotRichTextRecords(snapshot)) {
    if (recordIndex % SNAPSHOT_VALIDATION_BATCH_SIZE === 0) await yieldMainThread()
    for (const id of htmlAssetIds(html)) assetIds.add(id)
    recordIndex += 1
  }
  return assetIds
}

async function serializeSnapshotToBlobCooperatively(
  snapshot: PersistedSnapshot,
): Promise<Blob> {
  const { trades, ...snapshotWithoutTrades } = stripRetiredSnapshotDomains(snapshot)
  const parts: Blob[] = [new Blob(['{"trades":['])]
  for (let start = 0; start < trades.length; start += SNAPSHOT_VALIDATION_BATCH_SIZE) {
    await yieldMainThread()
    const end = Math.min(start + SNAPSHOT_VALIDATION_BATCH_SIZE, trades.length)
    const batch: string[] = []
    for (let index = start; index < end; index += 1) batch.push(JSON.stringify(trades[index]))
    parts.push(new Blob([start > 0 ? ',' : '', batch.join(',')]))
  }
  const remainder = JSON.stringify(snapshotWithoutTrades)
  parts.push(new Blob([remainder === '{}' ? ']}' : `],${remainder.slice(1)}`]))
  return new Blob(parts, { type: 'application/json' })
}

async function decodeStoredSnapshot(
  storedSnapshot: unknown,
  manifest: LibraryManifest,
): Promise<PersistedSnapshot> {
  const rawSnapshot = storedSnapshot instanceof Blob
    ? JSON.parse(await storedSnapshot.text()) as unknown
    : storedSnapshot
  return decodeCanonicalSnapshot(rawSnapshot, {
    version: manifest.schemaVersion,
    label: 'Stored browser snapshot',
  })
}

async function prepareIndexedDbMutation(
  input: RevisionedLibraryMutation,
): Promise<PreparedIndexedDbMutation> {
  input = { ...input, snapshot: stripRetiredSnapshotDomains(input.snapshot) }
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
  const storedSnapshot = await serializeSnapshotToBlobCooperatively(input.snapshot)
  return { referencedIds, putIds, records, storedSnapshot }
}

export { StorageRevisionConflictError } from '@/storage/adapter'

function normalizeSnapshotRevision(value: unknown): number {
  if (value === undefined) return 0
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  throw new Error('Invalid snapshot revision metadata')
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
  const bytes = base64ToBytes(base64)
  return new Blob([bytes], { type: mime })
}

export class IndexedDbStorageAdapter implements RevisionedStorageAdapter {
  private db: IDBDatabase | null = null
  private lifetime = new AbortController()
  private objectUrls = new AssetObjectUrlCache()
  private preparedAssets = new Map<string, AssetRecord>()
  private mutationTail: Promise<void> = Promise.resolve()
  private referencedAssetIdsAtRevision: { revision: number; ids: Set<string> } | null = null
  private readonly assetPurgePreviews = new AssetPurgePreviews<PersistedSnapshot>()
  private purgingAssetIds = new Set<string>()
  private readonly assetPurgeCommitEnabled: boolean

  constructor(
    private readonly databaseName = BROWSER_DATABASE_NAME,
    options: { assetPurgeCommitEnabled?: boolean } = {},
  ) {
    this.assetPurgeCommitEnabled = options.assetPurgeCommitEnabled
      ?? rendererAllowsAssetPurge()
  }

  clearObjectUrlCache(): void {
    this.objectUrls.clear()
  }

  async open(): Promise<void> {
    const { signal } = this.lifetime
    if (this.databaseName === BROWSER_DATABASE_NAME) {
      await migrateLegacyBrowserIdentity(indexedDB, signal)
      signal.throwIfAborted()
    }
    const db = await openJournalDatabase(indexedDB, this.databaseName, () =>
      new DOMException('IndexedDB repair blocked by another tab', 'InvalidStateError'))
    db.onclose = () => {
      if (this.db === db) this.close()
    }
    db.onversionchange = () => {
      db.close()
      if (!signal.aborted) this.close()
    }
    try {
      signal.throwIfAborted()
      assertCompatibleManifest(await readOrInitializeManifest(db))
      signal.throwIfAborted()
    } catch (error) {
      db.close()
      throw error
    }
    if (this.db) db.close()
    else this.db = db
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
    this.lifetime.abort()
    this.lifetime = new AbortController()
    this.mutationTail = Promise.resolve()
    this.clearObjectUrlCache()
    this.preparedAssets.clear()
    this.referencedAssetIdsAtRevision = null
    this.assetPurgePreviews.clear()
    this.purgingAssetIds.clear()
    this.db?.close()
    this.db = null
  }

  /** Release 0 兼容读取：旧库尚无 revision 时稳定视为 0；WEB1 再引入递增/CAS。 */
  async getSnapshotRevision(): Promise<number> {
    const value = await idbGet<unknown>(this.requireDb(), STORE_META, SNAPSHOT_REVISION_KEY)
    return normalizeSnapshotRevision(value)
  }

  private async readStoredSnapshot(db: IDBDatabase) {
    const tx = db.transaction([STORE_SNAPSHOT, STORE_META], 'readonly')
    const snapshotRequest = tx.objectStore(STORE_SNAPSHOT).get('main')
    const meta = tx.objectStore(STORE_META)
    const revisionRequest = meta.get(SNAPSHOT_REVISION_KEY)
    const manifestRequest = meta.get('manifest')
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB snapshot envelope read failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB snapshot envelope read aborted'))
    })

    const manifest = manifestRequest.result as LibraryManifest
    assertCompatibleManifest(manifest)
    const revision = normalizeSnapshotRevision(revisionRequest.result)
    const snapshot = snapshotRequest.result === undefined
      ? null
      : await decodeStoredSnapshot(snapshotRequest.result, manifest)
    const ids = snapshot ? await collectAssetIdsFromSnapshotCooperatively(snapshot) : new Set<string>()
    if (db === this.db && revision >= (this.referencedAssetIdsAtRevision?.revision ?? 0)) {
      this.referencedAssetIdsAtRevision = { revision, ids }
    }
    return { revision, snapshot, manifest, ids }
  }

  async loadSnapshotEnvelope(): Promise<SnapshotEnvelope> {
    const { signal } = this.lifetime
    const db = this.requireDb()
    let stored = await this.readStoredSnapshot(db)
    signal.throwIfAborted()
    if (stored.manifest.schemaVersion < SCHEMA_VERSION) {
      const snapshot = stored.snapshot ?? createEmptyPersistedSnapshot()
      try {
        const { revision } = await this.enqueueLibraryMutation({
          expectedRevision: stored.revision, snapshot, reason: 'migration',
        }, signal, true)
        signal.throwIfAborted()
        return { revision, snapshot }
      } catch (error) {
        if (!(error instanceof StorageRevisionConflictError)) throw error
        stored = await this.readStoredSnapshot(db)
        signal.throwIfAborted()
        if (stored.manifest.schemaVersion < SCHEMA_VERSION) throw error
      }
    }
    return { revision: stored.revision, snapshot: stored.snapshot }
  }

  commitLibraryMutation(input: RevisionedLibraryMutation): Promise<{ revision: number }> {
    return this.enqueueLibraryMutation(input)
  }

  private enqueueLibraryMutation(
    input: RevisionedLibraryMutation | Omit<RevisionedLibraryMutation, 'expectedRevision'>,
    signal = this.lifetime.signal,
    migratingOnRead = false,
  ): Promise<{ revision: number }> {
    const operation = this.mutationTail.then(async () => {
      signal.throwIfAborted()
      if (!migratingOnRead) assertWebWriteAllowed()
      try {
        let references = this.referencedAssetIdsAtRevision
        const actualRevision = await this.getSnapshotRevision()
        signal.throwIfAborted()
        const expectedRevision = 'expectedRevision' in input
          ? input.expectedRevision
          : references?.revision ?? actualRevision
        if (actualRevision !== expectedRevision) {
          throw new StorageRevisionConflictError(expectedRevision, actualRevision)
        }
        if (references?.revision !== expectedRevision) {
          const stored = await this.readStoredSnapshot(this.requireDb())
          if (stored.revision !== expectedRevision) {
            throw new StorageRevisionConflictError(expectedRevision, stored.revision)
          }
          references = stored
        }
        return await this.runLibraryMutation({ ...input, expectedRevision }, references.ids, signal)
      } catch (error) {
        signal.throwIfAborted()
        if (!migratingOnRead && error instanceof StorageRevisionConflictError) reportWebRevisionConflict(error)
        throw error
      }
    })
    this.mutationTail = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async runLibraryMutation(
    input: RevisionedLibraryMutation,
    previouslyReferencedIds: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<{ revision: number }> {
    const prepared = await prepareIndexedDbMutation(input)
    signal.throwIfAborted()
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
            snapshot: prepared.storedSnapshot,
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
                if (previouslyReferencedIds.has(id)) {
                  remaining -= 1
                  if (remaining === 0) applyMutation(prepared.records)
                  return
                }
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
        if (signal.aborted) {
          // 已启动的原库事务可以正常提交，回执只属于原调用方。
          resolve({ revision: nextRevision })
          return
        }
        this.referencedAssetIdsAtRevision = {
          revision: nextRevision,
          ids: new Set(prepared.referencedIds),
        }
        for (const put of input.assetPuts ?? []) {
          if (this.preparedAssets.get(put.id)?.blob === put.blob) this.preparedAssets.delete(put.id)
        }
        for (const id of input.assetDeletes ?? []) {
          this.objectUrls.invalidate(id)
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
    const { signal } = this.lifetime
    snapshot = stripRetiredSnapshotDomains(snapshot)
    let assetPuts: AssetRecord[] = []
    if (this.preparedAssets.size > 0) {
      const referencedIds = await collectAssetIdsFromSnapshotCooperatively(snapshot)
      assetPuts = [...this.preparedAssets.values()].filter((asset) => referencedIds.has(asset.id))
    }
    await this.enqueueLibraryMutation({
      snapshot,
      assetPuts,
      reason: 'autosave',
    }, signal)
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

  private async loadAssetBlob(id: string): Promise<Blob | null> {
    const db = this.requireDb()
    const record = this.preparedAssets.get(id) ?? await idbGet<AssetRecord>(db, STORE_ASSETS, id)
    return record?.blob ?? null
  }

  getAssetObjectUrl(id: string): Promise<string | null> {
    return this.objectUrls.get(id, () => this.loadAssetBlob(id))
  }

  acquireAssetObjectUrl(id: string) {
    return this.objectUrls.acquire(id, () => this.loadAssetBlob(id))
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
    const { signal } = this.lifetime
    const envelope = await this.loadSnapshotEnvelope()
    if (!envelope.snapshot) throw new Error('当前资料库尚无可校验的持久化快照')
    const records = await this.listAssetRecords()
    signal.throwIfAborted()
    const inventory = buildAssetInventory(envelope.snapshot, records)
    return this.assetPurgePreviews.create(envelope.revision, inventory.orphan, envelope.snapshot)
  }

  async prepareAssetPurgeRecovery(preview: AssetPurgePreview) {
    const operation = beginWebOperation('archive', {
      operationId: preview.operationId,
      actionId: preview.operationId,
      stage: 'export-recovery',
      revisionBefore: preview.revision,
    })
    try {
      const prepared = this.assetPurgePreviews.read(preview)
      const assets: ExportAssetRecord[] = []
      const recoveryIds = [...new Set([
        ...collectAssetIdsFromSnapshot(prepared.context),
        ...prepared.candidateIds,
      ])]
      for (const id of recoveryIds) {
        const asset = await this.getAssetForExport(id)
        if (!asset) {
          throw new OperationalError('asset-reference-missing', `恢复归档缺少被引用附件：${id}`)
        }
        assets.push(asset)
      }
      const authorization = this.assetPurgePreviews.authorize(preview, await this.getSnapshotRevision())
      operation.success({ stage: 'verified', revisionAfter: preview.revision })
      return {
        authorization,
        webArchive: {
          snapshot: prepared.context,
          assets,
          recoveryOrphanAssetIds: [...prepared.candidateIds],
        },
      }
    } catch (error) {
      operation.failure(error, { stage: 'export-recovery' })
      throw error
    }
  }

  async commitAssetPurge(preview: AssetPurgePreview, authorization?: string): Promise<AssetPurgeResult> {
    const { signal } = this.lifetime
    const operation = beginWebOperation('gc', {
      operationId: preview.operationId,
      actionId: preview.operationId,
      stage: 'authorize',
      revisionBefore: preview.revision,
    })
    try {
      if (!this.assetPurgeCommitEnabled) {
        throw new Error('附件永久清理已在存储边界关闭')
      }
      const prepared = this.assetPurgePreviews.take(preview, authorization)
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
          snapshot: prepared.context,
          assetDeletes: prepared.candidateIds,
          reason: 'purge',
        })
        operation.success({ stage: 'committed', revisionAfter: result.revision })
        return { revision: result.revision, deletedIds: [...prepared.candidateIds] }
      } finally {
        if (!signal.aborted) {
          for (const id of prepared.candidateIds) this.purgingAssetIds.delete(id)
        }
      }
    } catch (error) {
      operation.failure(error, { stage: 'commit' })
      throw error
    }
  }

  async cancelAssetPurge(operationId: string): Promise<void> {
    this.assetPurgePreviews.cancel(operationId)
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
      this.objectUrls.invalidate(record.id)
      this.preparedAssets.set(record.id, record)
    }
  }

  async commitImport(
    snapshot: PersistedSnapshot,
    assets: LibraryImportAsset[],
    options?: { pruneUnreferenced?: boolean },
  ): Promise<void> {
    const { signal } = this.lifetime
    snapshot = stripRetiredSnapshotDomains(snapshot)
    const revisionBefore = await this.getSnapshotRevision()
    const operation = beginWebOperation('import', {
      stage: 'validate',
      revisionBefore,
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
      const result = await this.enqueueLibraryMutation({
        snapshot,
        assetPuts: records,
        assetDeletes: options?.pruneUnreferenced
          ? assets.filter((asset) => !referencedAssetIds.has(asset.id)).map((asset) => asset.id)
          : undefined,
        reason: 'import',
      }, signal)
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
    const { signal } = this.lifetime
    snapshot = stripRetiredSnapshotDomains(snapshot)
    const revisionBefore = await this.getSnapshotRevision()
    const operation = beginWebOperation('archive', {
      stage: 'validate-restore',
      revisionBefore,
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

      const result = await this.enqueueLibraryMutation({
        snapshot,
        assetPuts: records,
        assetMode: 'replace',
        allowedUnreferencedAssetPuts: recoveryOrphanAssetIds,
        reason: 'restore',
      }, signal)
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

async function readOrInitializeManifest(db: IDBDatabase): Promise<LibraryManifest> {
  const existing = await idbGet<LibraryManifest>(db, STORE_META, 'manifest')
  if (existing !== undefined) return existing

  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_SNAPSHOT, STORE_META], 'readwrite')
    const meta = tx.objectStore(STORE_META)
    const current = meta.get('manifest')
    let manifest: LibraryManifest
    current.onsuccess = () => {
      if (current.result !== undefined) {
        manifest = current.result
        return
      }
      const snapshot = tx.objectStore(STORE_SNAPSHOT).get('main')
      snapshot.onsuccess = () => {
        manifest = {
          schemaVersion: snapshot.result === undefined ? SCHEMA_VERSION : 1,
          libraryId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        }
        meta.put(manifest, 'manifest')
      }
    }
    tx.oncomplete = () => resolve(manifest)
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB manifest initialization failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB manifest initialization aborted'))
  })
}

let adapterInstance: IndexedDbStorageAdapter | null = null

export function getIndexedDbAdapter(): IndexedDbStorageAdapter {
  if (!adapterInstance) adapterInstance = new IndexedDbStorageAdapter()
  return adapterInstance
}
