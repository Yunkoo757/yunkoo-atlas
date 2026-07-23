import { canonicalContractJson } from '@/storage/fixtures/fullPersistedSnapshot'
import {
  createFullPersistedSnapshotFixture,
  FULL_SNAPSHOT_ASSET_IDS,
} from '@/storage/fixtures/fullPersistedSnapshot'
import { PERSISTED_SNAPSHOT_FIELDS } from '@/storage/persistedKeys'
import { queueIndexedDbSnapshotAssetWrites } from '@/storage/indexedDbSnapshotAssetWrites'
import type { ExportAssetRecord, PersistedSnapshot } from '@/storage/types'

declare global {
  interface Window {
    __release0ArchiveCompatibilityTest?: Promise<void>
  }
}

const DATABASE_NAME = 'linear-release-0-archive-contract'
const REVISION_KEY = 'snapshotRevision'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Release 0 测试数据库仍被占用'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('snapshot')
      request.result.createObjectStore('assets', { keyPath: 'id' })
      request.result.createObjectStore('meta')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function toAssetRecord(asset: ExportAssetRecord) {
  const binary = atob(asset.data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const blob = new Blob([bytes], { type: asset.mime })
  return {
    id: asset.id,
    mime: asset.mime,
    byteSize: blob.size,
    createdAt: '2026-07-23T00:00:00.000Z',
    blob,
  }
}

function seedRelease0Library(
  db: IDBDatabase,
  snapshot: unknown,
  assets: readonly ExportAssetRecord[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['snapshot', 'assets', 'meta'], 'readwrite')
    transaction.objectStore('snapshot').put(snapshot, 'main')
    for (const asset of assets) transaction.objectStore('assets').put(toAssetRecord(asset))
    transaction.objectStore('meta').put({ schemaVersion: 8 }, 'manifest')
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error ?? new Error('Release 0 seed aborted'))
  })
}

function replaceArchiveAsRelease0(
  db: IDBDatabase,
  snapshot: PersistedSnapshot,
  assets: readonly ExportAssetRecord[],
  abortAfterWrites = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['snapshot', 'assets'], 'readwrite')
    queueIndexedDbSnapshotAssetWrites(
      transaction.objectStore('snapshot'),
      transaction.objectStore('assets'),
      {
        snapshot,
        assetMode: 'replace',
        assetPuts: assets.map(toAssetRecord),
      },
    )
    if (abortAfterWrites) transaction.abort()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Release 0 replace failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Release 0 replace aborted'))
  })
}

function readRawRevision(db: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('meta', 'readonly')
    const request = transaction.objectStore('meta').get(REVISION_KEY)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readCompatibleRevision(db: IDBDatabase): Promise<number> {
  const raw = await readRawRevision(db)
  if (raw === undefined) return 0
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0) return raw
  throw new Error('Invalid snapshot revision metadata')
}

async function readLibraryState(db: IDBDatabase) {
  const stored = await new Promise<{ snapshot: unknown; assets: Array<ReturnType<typeof toAssetRecord>> }>(
    (resolve, reject) => {
      const transaction = db.transaction(['snapshot', 'assets'], 'readonly')
      const snapshotRequest = transaction.objectStore('snapshot').get('main')
      const assetsRequest = transaction.objectStore('assets').getAll()
      transaction.oncomplete = () => resolve({
        snapshot: snapshotRequest.result,
        assets: assetsRequest.result as Array<ReturnType<typeof toAssetRecord>>,
      })
      transaction.onerror = () => reject(transaction.error)
    },
  )
  const assets = await Promise.all(stored.assets.map(async (asset) => ({
    id: asset.id,
    mime: asset.mime,
    byteSize: asset.byteSize,
    text: await asset.blob.text(),
  })))
  assets.sort((left, right) => left.id.localeCompare(right.id))
  return { snapshot: stored.snapshot, assets }
}

async function readLibraryFingerprint(db: IDBDatabase): Promise<string> {
  return canonicalContractJson(await readLibraryState(db))
}

function makeAssets(prefix: string): ExportAssetRecord[] {
  return Object.values(FULL_SNAPSHOT_ASSET_IDS).map((id, index) => ({
    id,
    mime: 'image/png',
    data: btoa(`${prefix}-${index}`),
  }))
}

async function run(): Promise<void> {
  await deleteDatabase()
  const db = await openDatabase()
  try {
    const oldSnapshot = Object.fromEntries(PERSISTED_SNAPSHOT_FIELDS.map((field) => [
      field,
      { release0OldField: field },
    ]))
    const nextSnapshot = {
      ...createFullPersistedSnapshotFixture(),
      profile: { avatarId: null, displayName: 'Release 0 成功候选' },
    }
    await seedRelease0Library(db, oldSnapshot, makeAssets('old'))

    assert(await readRawRevision(db) === undefined, 'Release 0 初始库不得存在 revision 原始键')
    assert(await readCompatibleRevision(db) === 0, 'Release 0 缺失 revision 必须兼容读取为 0')

    const successAssets = makeAssets('success')
    await replaceArchiveAsRelease0(db, nextSnapshot, successAssets)
    assert(await readRawRevision(db) === undefined, 'Release 0 成功替换不得创建 revision 原始键')
    assert(await readCompatibleRevision(db) === 0, 'Release 0 成功替换后兼容 revision 必须保持 0')

    const successState = await readLibraryState(db)
    const successFingerprint = canonicalContractJson(successState)
    assert(
      canonicalContractJson(successState.snapshot) === canonicalContractJson(nextSnapshot),
      'Release 0 PATH-B 成功后必须完整替换快照，不得保留旧字段',
    )
    for (const field of PERSISTED_SNAPSHOT_FIELDS) {
      assert(
        canonicalContractJson((successState.snapshot as PersistedSnapshot)[field]) === canonicalContractJson(nextSnapshot[field]),
        `Release 0 PATH-B 字段 ${field} 必须逐字段保真`,
      )
    }
    const expectedAssets = successAssets.map((asset) => ({
      id: asset.id,
      mime: asset.mime,
      byteSize: atob(asset.data).length,
      text: atob(asset.data),
    })).sort((left, right) => left.id.localeCompare(right.id))
    assert(
      canonicalContractJson(successState.assets) === canonicalContractJson(expectedAssets),
      'Release 0 PATH-B 成功后附件数量、ID、MIME、大小与字节内容必须完全一致',
    )

    let aborted = false
    try {
      await replaceArchiveAsRelease0(
        db,
        { ...nextSnapshot, profile: { avatarId: null, displayName: '不得提交的候选' } },
        makeAssets('aborted'),
        true,
      )
    } catch {
      aborted = true
    }
    assert(aborted, 'Release 0 PATH-B 必须观察到事务中止')
    assert(
      await readLibraryFingerprint(db) === successFingerprint,
      'Release 0 PATH-B 中止后旧 snapshot 与 assets 必须逐项不变',
    )
    assert(await readRawRevision(db) === undefined, 'Release 0 失败替换不得创建 revision 原始键')
    assert(await readCompatibleRevision(db) === 0, 'Release 0 失败替换后兼容 revision 必须保持 0')
  } finally {
    db.close()
    await deleteDatabase()
  }
}

window.__release0ArchiveCompatibilityTest = run()
