import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import { assetUrl } from '@/storage/assets'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'

declare global {
  interface Window {
    __assetInventoryBrowserTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function seedRawAsset(databaseName: string, value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(databaseName)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('assets', 'readwrite')
      tx.objectStore('assets').put(value)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
  })
}

function deleteDatabase(databaseName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function run(): Promise<void> {
  const databaseName = `asset-inventory-${crypto.randomUUID()}`
  const storage = new IndexedDbStorageAdapter(databaseName)
  try {
    await storage.open()
    const healthyId = await storage.saveAsset(new Blob(['abc'], { type: 'image/png' }), 'image/png')
    const snapshot = createFullPersistedSnapshotFixture()
    snapshot.trades[0].note = `<img src="${assetUrl(healthyId)}">`
    snapshot.weeklyReviews = []
    snapshot.quickNotes = []
    await storage.saveSnapshot(snapshot)

    const preparedId = await storage.saveAsset(new Blob(['temp']), 'image/png')
    await seedRawAsset(databaseName, {
      id: 'size-mismatch', mime: 'image/png', byteSize: 9,
      createdAt: new Date().toISOString(), blob: new Blob(['x']),
    })
    await seedRawAsset(databaseName, {
      id: 'missing-blob', mime: 'image/png', byteSize: 9,
      createdAt: new Date().toISOString(),
    })
    await seedRawAsset(databaseName, {
      id: '../foreign', mime: 'image/png', byteSize: 1,
      createdAt: new Date().toISOString(), blob: new Blob(['x']),
    })

    const records = await storage.listAssetRecords()
    const state = (id: string) => records.find((record) => record.id === id)?.state
    assert(state(healthyId) === 'healthy', '真实 IndexedDB 已提交附件必须识别为 healthy')
    assert(state(preparedId) === 'temp', '尚未提交的 prepared 附件必须识别为 temp')
    assert(state('size-mismatch') === 'size-mismatch', '尺寸不符必须显式报告')
    assert(state('missing-blob') === 'missing', '有记录无 Blob 必须显式报告 missing')
    assert(state('../foreign') === 'foreign', '非法附件 ID 必须隔离为 foreign')
  } finally {
    storage.close()
    await deleteDatabase(databaseName)
  }
}

window.__assetInventoryBrowserTest = run()
