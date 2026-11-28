import { deleteTestDatabase } from '@/test/deleteTestDatabase'
import { SCHEMA_VERSION } from './types'
import { IndexedDbStorageAdapter } from './indexedDbAdapter'
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
  await deleteTestDatabase(LEGACY_DATABASE_NAME)
  await deleteTestDatabase(BROWSER_DATABASE_NAME)
}

async function verifyChangesDuringMigration(side: 'source' | 'target'): Promise<void> {
  await resetDatabases()
  await seedDatabase(LEGACY_DATABASE_NAME, 'legacy')
  const originalTransaction = IDBDatabase.prototype.transaction
  let injected = false
  IDBDatabase.prototype.transaction = function (stores, mode, options) {
    if (!injected && side === 'target' && this.name === BROWSER_DATABASE_NAME && mode === 'readwrite') {
      injected = true
      const writer = originalTransaction.call(this, ['snapshot', 'assets', 'meta'], 'readwrite')
      writer.objectStore('snapshot').put({ displayName: 'concurrent' }, 'main')
      writer.objectStore('meta').put(42, 'snapshotRevision')
      writer.objectStore('assets').put({ id: 'asset-1', blob: new Blob(['new image']) })
    }
    if (!injected && side === 'source' && this.name === LEGACY_DATABASE_NAME && Array.isArray(stores) && stores.includes('assets')) {
      injected = true
      originalTransaction.call(this, 'snapshot', 'readwrite').objectStore('snapshot').delete('main')
    }
    return originalTransaction.call(this, stores, mode, options)
  }
  try {
    const result = await migrateLegacyBrowserIdentity(indexedDB)
    assert(injected, '应在迁移读取或写入边界安排并发事务')
    const current = await readValue<{ displayName: string }>(BROWSER_DATABASE_NAME, 'snapshot', 'main')
    const asset = await readValue<{ blob: Blob }>(BROWSER_DATABASE_NAME, 'assets', 'asset-1')
    const revision = await readValue<number>(BROWSER_DATABASE_NAME, 'meta', 'snapshotRevision')
    if (side === 'target') {
      assert(result === 'skipped' && current?.displayName === 'concurrent', '迁移必须保留预检后写入的目标快照')
      assert(revision === 42 && await asset?.blob.text() === 'new image', '并发写入的版本和附件必须与快照一起保留')
    } else {
      assert(result === 'unavailable' && current === undefined && !asset && revision === undefined, '源快照消失后不得单独复制附件或版本')
    }
  } finally {
    IDBDatabase.prototype.transaction = originalTransaction
  }
}

async function verifyBlockedRepair(entry: 'adapter' | 'migration'): Promise<void> {
  await resetDatabases()
  if (entry === 'migration') await seedDatabase(LEGACY_DATABASE_NAME, 'legacy')
  const open = indexedDB.open(BROWSER_DATABASE_NAME, 1)
  open.onupgradeneeded = () => open.result.createObjectStore('snapshot').put('original', 'marker')
  const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })

  const adapter = new IndexedDbStorageAdapter()
  const attempt = () => entry === 'adapter' ? adapter.open() : migrateLegacyBrowserIdentity(indexedDB)
  let failure: unknown
  try {
    await attempt()
  } catch (error) {
    failure = error
  } finally {
    blocker.close()
  }
  assert(failure instanceof Error && failure.message.includes('blocked'), '被其他连接占用时应立即报告受阻')
  if (entry === 'adapter') assert(failure.name === 'InvalidStateError', '普通开库须保留原有错误类型')

  const inspect = indexedDB.open(BROWSER_DATABASE_NAME)
  const beforeRetry = await new Promise<{ version: number; stores: string[] }>((resolve, reject) => {
    inspect.onsuccess = () => {
      const db = inspect.result
      resolve({ version: db.version, stores: Array.from(db.objectStoreNames) })
      db.close()
    }
    inspect.onerror = () => reject(inspect.error)
  })
  assert(beforeRetry.version === 1 && beforeRetry.stores.join(',') === 'snapshot', '被拒绝的修复不能在占用解除后继续改库')

  try {
    const result = await attempt()
    if (entry === 'migration') assert(result === 'copied', '显式重试后应能完成旧库复制')
    else assert((await adapter.getManifest()).schemaVersion === SCHEMA_VERSION, '显式重试后应能初始化目标清单')
    assert(await readValue(BROWSER_DATABASE_NAME, 'snapshot', 'marker') === 'original', '修复应保留已有数据')
  } finally {
    adapter.close()
  }
  await deleteTestDatabase(BROWSER_DATABASE_NAME)
}

async function verifyAbortedSourceRead(allStores: boolean): Promise<void> {
  await resetDatabases()
  await seedDatabase(LEGACY_DATABASE_NAME, 'legacy')
  const original = IDBDatabase.prototype.transaction
  let injected = false
  IDBDatabase.prototype.transaction = function abortSourceRead(stores, mode, options) {
    const tx = original.call(this, stores, mode, options)
    if (!injected && this.name === LEGACY_DATABASE_NAME && mode === 'readonly' && Array.isArray(stores) === allStores) {
      injected = true
      queueMicrotask(() => tx.abort())
    }
    return tx
  }
  let failure: unknown
  try {
    await migrateLegacyBrowserIdentity(indexedDB)
  } catch (error) {
    failure = error
  } finally {
    IDBDatabase.prototype.transaction = original
  }
  assert(injected && failure instanceof DOMException && failure.name === 'AbortError', '中断旧库读取应向调用方报告 AbortError')
  const asset = await readValue<{ blob: Blob }>(LEGACY_DATABASE_NAME, 'assets', 'asset-1')
  assert(await asset?.blob.text() === 'x', '中断后源附件字节须保留')
  assert(await migrateLegacyBrowserIdentity(indexedDB) === 'copied', '读取中断后重试应能完整迁移')
  const copied = await readValue<{ blob: Blob }>(BROWSER_DATABASE_NAME, 'assets', 'asset-1')
  assert(await copied?.blob.text() === 'x' && await readValue(BROWSER_DATABASE_NAME, 'meta', 'snapshotRevision') === 3,
    '重试后目标附件和版本应与来源一致')
}

async function verifyCancelledCopy(): Promise<void> {
  await resetDatabases()
  await seedDatabase(LEGACY_DATABASE_NAME, 'legacy')
  const controller = new AbortController()
  const original = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = function cancelAfterScan(stores, mode, options) {
    const tx = original.call(this, stores, mode, options)
    if (this.name === LEGACY_DATABASE_NAME && Array.isArray(stores) && mode === 'readonly') {
      tx.addEventListener('complete', () => controller.abort(), { once: true })
    }
    return tx
  }
  try {
    const result = await migrateLegacyBrowserIdentity(indexedDB, controller.signal)
      .then(() => 'copied', (error: Error) => error.name)
    assert(result === 'AbortError', '关闭期间结束的扫描不能发起目标写入')
    assert(await readValue(BROWSER_DATABASE_NAME, 'snapshot', 'main') === undefined, '取消后目标快照应保持空白')
    assert(await readValue(BROWSER_DATABASE_NAME, 'assets', 'asset-1') === undefined, '取消后目标附件应保持空白')
    assert(await readValue(BROWSER_DATABASE_NAME, 'meta', 'snapshotRevision') === undefined, '取消后目标版本应保持空白')
  } finally {
    IDBDatabase.prototype.transaction = original
  }
}

async function run(): Promise<void> {
  await verifyCancelledCopy()
  await verifyAbortedSourceRead(false)
  await verifyAbortedSourceRead(true)
  await resetDatabases()
  await seedDatabase(LEGACY_DATABASE_NAME, 'legacy')

  const results = await Promise.all([migrateLegacyBrowserIdentity(indexedDB), migrateLegacyBrowserIdentity(indexedDB)])
  assert(results.sort().join(',') === 'copied,skipped', '并发迁移只能有一次提交旧快照')
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

  await verifyChangesDuringMigration('target')
  await verifyChangesDuringMigration('source')
  await verifyBlockedRepair('adapter')
  await verifyBlockedRepair('migration')
}

window.__legacyIdentityMigrationTest = run().finally(resetDatabases)
