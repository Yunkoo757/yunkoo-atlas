import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import {
  IndexedDbStorageAdapter,
  StorageRevisionConflictError,
} from '@/storage/indexedDbAdapter'
import type { RevisionedLibraryMutation } from '@/storage/adapter'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { SCHEMA_VERSION, type PersistedSnapshot } from '@/storage/types'
import {
  getWebWriteGuardState,
  initializeWebWriterOwnership,
  resetWebWriteGuardForTests,
} from '@/storage/webWriteGuard'

declare global {
  interface Window {
    __indexedDbRevisionTest?: Promise<void>
  }
}

const DB_NAME = 'linear-journal-v3'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function snapshot(displayName: string, assetId?: string): PersistedSnapshot {
  return {
    trades: [],
    quickNotes: assetId ? [{
      id: `note-${displayName}`,
      title: displayName,
      contentHtml: `<p>${displayName}</p><img src="journal-asset://${assetId}">`,
      pinned: false,
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    }] : [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY },
    profile: { avatarId: null, displayName },
  }
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('测试数据库仍被占用'))
  })
}

async function seedLegacySnapshotWithoutRevision(): Promise<void> {
  await deleteDatabase()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('snapshot').put(snapshot('legacy'), 'main')
      db.createObjectStore('assets', { keyPath: 'id' })
      db.createObjectStore('meta')
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

async function seedCurrentCorruptSnapshot(): Promise<void> {
  await deleteDatabase()
  const corrupt = createFullPersistedSnapshotFixture() as unknown as Record<string, unknown>
  const trades = corrupt.trades as Array<Record<string, unknown>>
  trades[0] = { ...trades[0], entry: null }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('snapshot').put(corrupt, 'main')
      db.createObjectStore('assets', { keyPath: 'id' })
      const meta = db.createObjectStore('meta')
      meta.put({
        schemaVersion: SCHEMA_VERSION,
        libraryId: 'current-corrupt-library',
        createdAt: '2026-07-23T00:00:00.000Z',
      }, 'manifest')
      meta.put(7, 'snapshotRevision')
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

async function mutateRawRevision(operation: 'delete' | 'corrupt' | 'one'): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('meta', 'readwrite')
      const store = tx.objectStore('meta')
      if (operation === 'delete') store.delete('snapshotRevision')
      else store.put(operation === 'one' ? 1 : 'corrupt-revision', 'snapshotRevision')
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

async function readRawValue(storeName: string, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(storeName, 'readonly')
      const get = tx.objectStore(storeName).get(key)
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => reject(get.error)
      tx.oncomplete = () => db.close()
    }
    request.onerror = () => reject(request.error)
  })
}

async function storageFingerprint(
  adapter: IndexedDbStorageAdapter,
  assetIds: readonly string[],
): Promise<string> {
  return JSON.stringify({
    envelope: await adapter.loadSnapshotEnvelope(),
    assets: await Promise.all(assetIds.map((id) => adapter.getAssetForExport(id))),
  })
}

async function expectInjectedAbortWithoutChanges(
  adapter: IndexedDbStorageAdapter,
  point: 'snapshot-put' | 'asset-put' | 'asset-clear' | 'asset-delete',
  mutation: RevisionedLibraryMutation,
  observedAssetIds: readonly string[],
): Promise<void> {
  const before = await storageFingerprint(adapter, observedAssetIds)
  const originalPut = IDBObjectStore.prototype.put
  const originalClear = IDBObjectStore.prototype.clear
  const originalDelete = IDBObjectStore.prototype.delete
  IDBObjectStore.prototype.put = function injectedPut(value: unknown, key?: IDBValidKey) {
    const failsSnapshot = point === 'snapshot-put' && this.name === 'snapshot' && key === 'main'
    const failsAsset = point === 'asset-put' && this.name === 'assets' &&
      typeof value === 'object' && value !== null && 'id' in value && value.id === 'fault-asset'
    if (failsSnapshot || failsAsset) throw new DOMException(`forced ${point}`, 'DataError')
    return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key)
  }
  IDBObjectStore.prototype.clear = function injectedClear() {
    if (point === 'asset-clear' && this.name === 'assets') {
      throw new DOMException('forced asset-clear', 'DataError')
    }
    return originalClear.call(this)
  }
  IDBObjectStore.prototype.delete = function injectedDelete(key: IDBValidKey | IDBKeyRange) {
    if (point === 'asset-delete' && this.name === 'assets') {
      throw new DOMException('forced asset-delete', 'DataError')
    }
    return originalDelete.call(this, key)
  }
  let rejected = false
  try {
    await adapter.commitLibraryMutation(mutation)
  } catch {
    rejected = true
  } finally {
    IDBObjectStore.prototype.put = originalPut
    IDBObjectStore.prototype.clear = originalClear
    IDBObjectStore.prototype.delete = originalDelete
  }
  assert(rejected, `${point} 故障必须拒绝整个 mutation`)
  assert(
    await storageFingerprint(adapter, observedAssetIds) === before,
    `${point} 故障后 snapshot、assets、revision 必须零变化`,
  )
}

async function expectConflict(
  operation: Promise<unknown>,
  expectedRevision: number,
  actualRevision: number,
): Promise<void> {
  let error: unknown
  try {
    await operation
  } catch (caught) {
    error = caught
  }
  assert(error instanceof StorageRevisionConflictError, '过期写入必须抛出 typed conflict')
  assert(error.expectedRevision === expectedRevision, '冲突必须携带调用方 expected revision')
  assert(error.actualRevision === actualRevision, '冲突必须携带当前 actual revision')
}

async function run(): Promise<void> {
  await seedCurrentCorruptSnapshot()
  const corrupt = new IndexedDbStorageAdapter()
  await corrupt.open()
  let currentCorruptionRejected = false
  try {
    await corrupt.loadSnapshotEnvelope()
  } catch {
    currentCorruptionRejected = true
  }
  corrupt.close()
  assert(currentCorruptionRejected, '当前 v8 中显式错误字段不得按历史 v1 缺省迁移')
  const corruptRaw = await readRawValue('snapshot', 'main') as { trades: Array<{ entry: unknown }> }
  assert(corruptRaw.trades[0].entry === null, '拒绝当前 v8 损坏时原始快照必须零变化')
  assert(await readRawValue('meta', 'snapshotRevision') === 7, '拒绝当前 v8 损坏时 revision 必须零变化')

  await seedLegacySnapshotWithoutRevision()
  const first = new IndexedDbStorageAdapter()
  await first.open()

  const legacyRawBefore = JSON.stringify(await readRawValue('snapshot', 'main'))
  const originalMigrationPut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function failMigrationSnapshotPut(value: unknown, key?: IDBValidKey) {
    if (this.name === 'snapshot' && key === 'main') {
      throw new DOMException('forced migration snapshot failure', 'DataError')
    }
    return key === undefined
      ? originalMigrationPut.call(this, value)
      : originalMigrationPut.call(this, value, key)
  }
  let migrationRejected = false
  try {
    await first.loadSnapshotEnvelope()
  } catch {
    migrationRejected = true
  } finally {
    IDBObjectStore.prototype.put = originalMigrationPut
  }
  assert(migrationRejected, 'legacy migration 故障必须拒绝整个 revisioned mutation')
  assert(JSON.stringify(await readRawValue('snapshot', 'main')) === legacyRawBefore, '迁移失败后 snapshot 必须零变化')
  assert((await first.getManifest()).schemaVersion === 1, '迁移失败后 manifest 必须回滚')
  assert(await readRawValue('meta', 'snapshotRevision') === undefined, '迁移失败后 revision 必须保持缺失')

  const second = new IndexedDbStorageAdapter()
  await second.open()
  resetWebWriteGuardForTests()
  await initializeWebWriterOwnership('migration-race', { lockManager: null, broadcastFactory: null })

  const [legacy, concurrentLegacy] = await Promise.all([
    first.loadSnapshotEnvelope(),
    second.loadSnapshotEnvelope(),
  ])
  assert(legacy.revision === 1, 'Release 1 legacy migration 必须在同一事务推进 0→1')
  assert(concurrentLegacy.revision === 1, '并发 legacy migration 的输家必须重读已提交的 revision 1')
  assert(getWebWriteGuardState().phase !== 'conflict', '内部可恢复 migration 冲突不得冻结 Web 写入 guard')
  resetWebWriteGuardForTests()
  assert(legacy.snapshot?.profile?.displayName === 'legacy', 'revision 初始化不得重置旧快照')
  assert((await first.getManifest()).schemaVersion === SCHEMA_VERSION, '旧库成功迁移后必须原子记录当前 schema')

  await mutateRawRevision('corrupt')
  let corruptLoadRejected = false
  try {
    await first.loadSnapshotEnvelope()
  } catch {
    corruptLoadRejected = true
  }
  assert(corruptLoadRejected, '已存在但非法的 revision 元数据必须 fail-closed')
  let corruptCommitRejected = false
  try {
    await first.commitLibraryMutation({
      expectedRevision: 1,
      snapshot: snapshot('must-not-overwrite-corrupt-revision'),
      reason: 'autosave',
    })
  } catch {
    corruptCommitRejected = true
  }
  assert(corruptCommitRejected, '非法 revision 元数据不得按 0 绕过 CAS')
  assert(await readRawValue('meta', 'snapshotRevision') === 'corrupt-revision', '拒绝后必须保留损坏元数据供诊断')
  const rawSnapshot = await readRawValue('snapshot', 'main') as PersistedSnapshot
  assert(rawSnapshot.profile?.displayName === 'legacy', '非法 revision 拒绝后不得覆盖旧快照')
  await mutateRawRevision('one')

  const firstCommit = await first.commitLibraryMutation({
    expectedRevision: 1,
    snapshot: snapshot('winner', 'winner-asset'),
    assetPuts: [{
      id: 'winner-asset',
      mime: 'image/png',
      blob: new Blob(['winner'], { type: 'image/png' }),
    }],
    reason: 'autosave',
  })
  assert(firstCommit.revision === 2, '迁移后的第一次 autosave 必须推进 1→2')

  await expectConflict(second.commitLibraryMutation({
    expectedRevision: 1,
    snapshot: snapshot('stale', 'stale-asset'),
    assetPuts: [{
      id: 'stale-asset',
      mime: 'image/png',
      blob: new Blob(['stale'], { type: 'image/png' }),
    }],
    reason: 'autosave',
  }), 1, 2)
  const afterConflict = await second.loadSnapshotEnvelope()
  assert(afterConflict.revision === 2, 'stale transaction 不得改变 revision')
  assert(afterConflict.snapshot?.profile?.displayName === 'winner', 'stale transaction 不得覆盖赢家快照')
  assert(await second.getAssetForExport('winner-asset'), 'stale transaction 不得删除赢家附件')
  assert((await second.getAssetForExport('stale-asset')) === null, 'stale transaction 不得写入候选附件')

  const originalPut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function failRevisionPut(value: unknown, key?: IDBValidKey) {
    if (key === 'snapshotRevision') {
      throw new DOMException('forced revision failure', 'DataError')
    }
    return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key)
  }
  let rejected = false
  try {
    await first.commitLibraryMutation({
      expectedRevision: 2,
      snapshot: snapshot('must-rollback', 'rollback-asset'),
      assetPuts: [{
        id: 'rollback-asset',
        mime: 'image/png',
        blob: new Blob(['rollback'], { type: 'image/png' }),
      }],
      reason: 'autosave',
    })
  } catch {
    rejected = true
  } finally {
    IDBObjectStore.prototype.put = originalPut
  }
  assert(rejected, 'revision 写入故障必须拒绝整个 mutation')
  const afterAbort = await first.loadSnapshotEnvelope()
  assert(afterAbort.revision === 2, 'revision 写入失败后 revision 必须回滚')
  assert(afterAbort.snapshot?.profile?.displayName === 'winner', 'revision 写入失败后 snapshot 必须回滚')
  assert((await first.getAssetForExport('rollback-asset')) === null, 'revision 写入失败后 asset put 必须回滚')

  const queuedWinner = first.commitLibraryMutation({
    expectedRevision: 2,
    snapshot: snapshot('queued-winner'),
    reason: 'autosave',
  })
  const queuedStale = first.commitLibraryMutation({
    expectedRevision: 2,
    snapshot: snapshot('queued-stale'),
    reason: 'autosave',
  })
  assert((await queuedWinner).revision === 3, '同标签页首个排队 mutation 应成功推进 revision')
  await expectConflict(queuedStale, 2, 3)
  const finalEnvelope = await first.loadSnapshotEnvelope()
  assert(finalEnvelope.revision === 3, '同标签页过期排队 mutation 不得推进 revision')
  assert(finalEnvelope.snapshot?.profile?.displayName === 'queued-winner', '同标签页提交必须串行且不得盲重试')

  const replacement = await first.commitLibraryMutation({
    expectedRevision: 3,
    snapshot: snapshot('replacement', 'replacement-asset'),
    assetPuts: [{
      id: 'replacement-asset',
      mime: 'image/png',
      blob: new Blob(['replacement'], { type: 'image/png' }),
    }],
    assetMode: 'replace',
    reason: 'restore',
  })
  assert(replacement.revision === 4, 'replace mutation 必须与 snapshot、assets 一起推进 revision')
  assert((await first.getAssetForExport('winner-asset')) === null, 'replace mutation 必须清除旧附件')
  assert(await first.getAssetForExport('replacement-asset'), 'replace mutation 必须写入候选附件')

  rejected = false
  try {
    await first.commitLibraryMutation({
      expectedRevision: 4,
      snapshot: snapshot('invalid-delete', 'replacement-asset'),
      assetDeletes: ['replacement-asset'],
      reason: 'purge',
    })
  } catch {
    rejected = true
  }
  assert(rejected, 'mutation 不得删除候选快照仍引用的附件')
  const afterInvalidDelete = await first.loadSnapshotEnvelope()
  assert(afterInvalidDelete.revision === 4, '引用关系校验失败不得推进 revision')
  assert(afterInvalidDelete.snapshot?.profile?.displayName === 'replacement', '引用关系校验失败不得改写 snapshot')
  assert(await first.getAssetForExport('replacement-asset'), '引用关系校验失败不得删除附件')

  const orphanAssetId = await first.saveAsset(
    new Blob(['orphan'], { type: 'image/png' }),
    'image/png',
  )
  const observedAssets = ['replacement-asset', 'fault-asset', orphanAssetId]
  await expectInjectedAbortWithoutChanges(first, 'snapshot-put', {
    expectedRevision: 4,
    snapshot: snapshot('snapshot-put-failure', 'replacement-asset'),
    reason: 'autosave',
  }, observedAssets)
  await expectInjectedAbortWithoutChanges(first, 'asset-put', {
    expectedRevision: 4,
    snapshot: snapshot('asset-put-failure', 'fault-asset'),
    assetPuts: [{
      id: 'fault-asset',
      mime: 'image/png',
      blob: new Blob(['fault'], { type: 'image/png' }),
    }],
    reason: 'attachment',
  }, observedAssets)
  await expectInjectedAbortWithoutChanges(first, 'asset-clear', {
    expectedRevision: 4,
    snapshot: snapshot('asset-clear-failure', 'fault-asset'),
    assetPuts: [{
      id: 'fault-asset',
      mime: 'image/png',
      blob: new Blob(['fault'], { type: 'image/png' }),
    }],
    assetMode: 'replace',
    reason: 'restore',
  }, observedAssets)
  await expectInjectedAbortWithoutChanges(first, 'asset-delete', {
    expectedRevision: 4,
    snapshot: snapshot('asset-delete-failure', 'replacement-asset'),
    assetDeletes: [orphanAssetId],
    reason: 'purge',
  }, observedAssets)
}

window.__indexedDbRevisionTest = run()
