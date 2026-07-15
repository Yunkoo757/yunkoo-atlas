import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import type { PersistedSnapshot } from '@/storage/types'

const DB_NAME = 'linear-journal-v3'
const DB_VERSION = 1

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('无法清理测试资料库'))
    request.onblocked = () => reject(new Error('测试资料库仍被占用'))
  })
}

function seedDatabase(snapshot: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('无法打开测试资料库'))
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('snapshot')
      db.createObjectStore('assets', { keyPath: 'id' })
      db.createObjectStore('meta')
    }
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('snapshot', 'readwrite')
      transaction.objectStore('snapshot').put(snapshot, 'main')
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('无法写入测试快照'))
    }
  })
}

function putLibraryState(snapshot: unknown, manifest: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error('无法打开测试资料库'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(['snapshot', 'meta'], 'readwrite')
      transaction.objectStore('snapshot').put(snapshot, 'main')
      transaction.objectStore('meta').put(manifest, 'manifest')
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('无法写入测试资料库'))
    }
  })
}

async function run(): Promise<void> {
  await deleteDatabase()
  const raw = { legacyMarker: 'keep-me-raw' }
  await seedDatabase(raw)

  const adapter = new IndexedDbStorageAdapter()
  await adapter.open()
  const loaded = await adapter.loadRawSnapshot()

  assert(
    JSON.stringify(loaded) === JSON.stringify(raw),
    'loadRawSnapshot 必须原样返回未经迁移或校验的浏览器快照',
  )

  let manifestError: unknown
  try {
    await adapter.getManifest()
  } catch (error) {
    manifestError = error
  }
  assert(
    manifestError instanceof Error && manifestError.message.includes('Missing library manifest'),
    '已有原始快照但缺少 manifest 时，open 不得伪造当前 schemaVersion',
  )

  const currentDialectSnapshot: PersistedSnapshot = {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: {
      hideClosed: false,
      showEmptyGroups: true,
      groupByStrategy: false,
      groupByDate: true,
      sortBy: 'date',
      sidebarPins: [],
      sidebarWorkspaceItems: [],
    },
  }
  await putLibraryState(currentDialectSnapshot, {
    schemaVersion: 5,
    libraryId: 'legacy-v5-library',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  const migrated = await adapter.loadSnapshot()
  assert(
    migrated !== null && migrated.trades.length === 0 && migrated.display.sortBy === currentDialectSnapshot.display.sortBy,
    'manifest v5 配合当前 v6 方言的快照必须可以加载',
  )

  await putLibraryState(currentDialectSnapshot, {
    schemaVersion: 7,
    libraryId: 'future-v7-library',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  let futureVersionError: unknown
  try {
    await adapter.loadSnapshot()
  } catch (error) {
    futureVersionError = error
  }
  assert(
    futureVersionError instanceof Error && futureVersionError.message.includes('更新版本'),
    '未来 schemaVersion 的浏览器资料库必须被明确拒绝',
  )

  await putLibraryState({ ...currentDialectSnapshot, trades: [{}] }, {
    schemaVersion: 6,
    libraryId: 'damaged-v6-library',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  let damagedSnapshotError: unknown
  try {
    await adapter.loadSnapshot()
  } catch (error) {
    damagedSnapshotError = error
  }
  assert(
    damagedSnapshotError instanceof Error && damagedSnapshotError.message.includes('invalid trade'),
    '迁移后的损坏快照必须由当前结构校验拒绝',
  )

  await adapter.saveSnapshot(currentDialectSnapshot)
  const savedRaw = await adapter.loadRawSnapshot()
  const savedSnapshot = await adapter.loadSnapshot()
  assert(
    JSON.stringify(savedRaw) === JSON.stringify(currentDialectSnapshot) &&
      JSON.stringify(savedSnapshot) === JSON.stringify(currentDialectSnapshot),
    '普通 saveSnapshot 必须继续保存并加载当前快照',
  )

  const v7Candidate = { ...currentDialectSnapshot, schemaVersion: 7, reportingTimeZone: null }
  const commitResult = await adapter.commitUpgradeSnapshot(v7Candidate, 7, () => undefined)
  assert(commitResult === 'committed', 'validated browser upgrade must commit')
  assert((await adapter.getManifest()).schemaVersion === 7, 'browser manifest commits only after hydrate validation')
  assert((await adapter.loadRawSnapshot() as { schemaVersion?: number }).schemaVersion === 7, 'browser snapshot and manifest commit together')

  await putLibraryState(currentDialectSnapshot, {
    schemaVersion: 6,
    libraryId: 'rollback-v6-library',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  const rollbackResult = await adapter.commitUpgradeSnapshot(v7Candidate, 7, () => {
    throw new Error('hydrate failed')
  })
  assert(rollbackResult === 'restored', 'failed browser hydrate must restore v6')
  assert((await adapter.getManifest()).schemaVersion === 6, 'failed browser upgrade restores manifest')
  assert((await adapter.loadRawSnapshot() as { schemaVersion?: number }).schemaVersion === undefined, 'failed browser upgrade restores raw v6 snapshot')
}

declare global {
  interface Window {
    __indexedDbAdapterTest?: Promise<void>
  }
}

window.__indexedDbAdapterTest = run()
