import { migrateLegacyBrowserIdentity } from './legacyIdentity'
import { BROWSER_DATABASE_NAME } from './storageIdentity'

declare global {
  interface Window {
    __legacyIdentityMigrationTest?: Promise<void>
  }
}

const LEGACY_DATABASE_NAME = 'linear-journal-v3'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`数据库仍被占用：${name}`))
  })
}

function seedDatabase(
  name: string,
  displayName: string,
  assetKeyPath: string = 'id',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('snapshot').put({ displayName }, 'main')
      db.createObjectStore('assets', { keyPath: assetKeyPath }).put({
        id: 'asset-1',
        byteSize: 1,
        blob: new Blob(['x']),
      })
      const meta = db.createObjectStore('meta')
      meta.put({ schemaVersion: 8, libraryId: `${displayName}-library` }, 'manifest')
      meta.put(3, 'snapshotRevision')
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
}

function readValue<T>(name: string, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(storeName, 'readonly')
      const get = transaction.objectStore(storeName).get(key)
      get.onsuccess = () => resolve(get.result as T | undefined)
      get.onerror = () => reject(get.error)
      transaction.oncomplete = () => db.close()
    }
  })
}

async function resetDatabases(): Promise<void> {
  await deleteDatabase(LEGACY_DATABASE_NAME)
  await deleteDatabase(BROWSER_DATABASE_NAME)
}

async function run(): Promise<void> {
  await resetDatabases()
  await seedDatabase(LEGACY_DATABASE_NAME, 'legacy')

  const copied = await migrateLegacyBrowserIdentity(indexedDB)
  assert(copied === 'copied', '空目标库必须从旧库复制')
  const migrated = await readValue<{ displayName: string }>(BROWSER_DATABASE_NAME, 'snapshot', 'main')
  const source = await readValue<{ displayName: string }>(LEGACY_DATABASE_NAME, 'snapshot', 'main')
  assert(migrated?.displayName === 'legacy', '新库必须包含完整旧快照')
  assert(source?.displayName === 'legacy', '迁移后旧库必须保持不变')

  const repeated = await migrateLegacyBrowserIdentity(indexedDB)
  assert(repeated === 'skipped', '重复迁移不得再次覆盖目标库')

  await resetDatabases()
  await seedDatabase(LEGACY_DATABASE_NAME, 'legacy')
  await seedDatabase(BROWSER_DATABASE_NAME, 'current')
  const preserved = await migrateLegacyBrowserIdentity(indexedDB)
  const current = await readValue<{ displayName: string }>(BROWSER_DATABASE_NAME, 'snapshot', 'main')
  assert(preserved === 'skipped', '已有目标快照时必须跳过迁移')
  assert(current?.displayName === 'current', '已有目标快照不得被旧库覆盖')

  await resetDatabases()
  await seedDatabase(LEGACY_DATABASE_NAME, 'legacy')
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(BROWSER_DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('snapshot')
      db.createObjectStore('assets', { keyPath: 'required' })
      db.createObjectStore('meta')
    }
    request.onsuccess = () => {
      request.result.close()
      resolve()
    }
    request.onerror = () => reject(request.error)
  })
  let failed = false
  try {
    await migrateLegacyBrowserIdentity(indexedDB)
  } catch {
    failed = true
  }
  assert(failed, '目标事务写入失败必须向上报告')
  const sourceAfterFailure = await readValue<{ displayName: string }>(LEGACY_DATABASE_NAME, 'snapshot', 'main')
  const targetAfterFailure = await readValue(BROWSER_DATABASE_NAME, 'snapshot', 'main')
  assert(sourceAfterFailure?.displayName === 'legacy', '失败迁移不得修改旧库')
  assert(targetAfterFailure === undefined, '失败事务不得留下部分目标快照')
}

window.__legacyIdentityMigrationTest = run().finally(resetDatabases)
