import { IndexedDbStorageAdapter } from './indexedDbAdapter'
import { createFullPersistedSnapshotFixture } from './fixtures/fullPersistedSnapshot'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

async function withRawDatabase<T>(name: string, run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try { return await run(db) } finally { db.close() }
}

async function run(): Promise<void> {
  const name = `atlas-isolated-retired-domains-${crypto.randomUUID()}`
  let storage = new IndexedDbStorageAdapter(name, { assetPurgeCommitEnabled: true })
  try {
    await storage.open()
    const sharedId = await storage.saveAsset(new Blob(['shared-business-image'], { type: 'image/png' }), 'image/png')
    const active = createFullPersistedSnapshotFixture({ trade: sharedId, weeklyReview: sharedId, quickNote: sharedId, shared: sharedId })
    const legacy = { ...active, judgmentDesk: { samples: [{ images: [{ assetId: sharedId }, { assetId: 'retired-only-image' }] }] }, reviewComposer: { obsolete: true },
      shortcuts: { 'judgment.yes': true }, display: { ...active.display, sidebarWorkspaceItems: [{ id: 'retired-workspace', target: { kind: 'system', id: 'judgmentDesk' } }] },
    }
    await storage.saveSnapshot(legacy as unknown as typeof active)
    await withRawDatabase(name, async db => {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('assets', 'readwrite')
        const blob = new Blob(['old-retired-image'], { type: 'image/png' })
        tx.objectStore('assets').put({ id: 'retired-only-image', mime: 'image/png', byteSize: blob.size, createdAt: '2026-01-01T00:00:00.000Z', blob })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      const raw = await new Promise<Blob>((resolve, reject) => {
        const request = db.transaction('snapshot').objectStore('snapshot').get('main')
        request.onsuccess = () => resolve(request.result as Blob)
        request.onerror = () => reject(request.error)
      })
      const json = await raw.text()
      assert(!json.includes('judgmentDesk') && !json.includes('reviewComposer'), 'IndexedDB中心writer必须剥离退役字段')
      assert(!json.includes('judgment.yes'), '退役导航和快捷键必须在旧格式校验前清理')
    })
    storage.close()
    storage = new IndexedDbStorageAdapter(name, { assetPurgeCommitEnabled: true })
    await storage.open()
    const loaded = await storage.loadSnapshot()
    assert(loaded && !('judgmentDesk' in loaded) && !('reviewComposer' in loaded), '重开不得复活退役state')
    assert(await storage.getAssetForExport('retired-only-image'), '启动不得主动删除旧专属物理图片')
    assert(await storage.getAssetForExport(sharedId), '启动必须保留现行业务共享图片')
    const preview = await storage.previewAssetPurge()
    assert(preview.candidateIds.includes('retired-only-image') && !preview.candidateIds.includes(sharedId), 'GC仅将退役独占图列为候选，不能误选共享业务图')
    const imported = { ...active, trades: active.trades.map(trade => ({ ...trade, note: trade.note })), judgmentDesk: legacy.judgmentDesk, reviewComposer: legacy.reviewComposer }
    const shared = await storage.getAssetForExport(sharedId)
    assert(shared, '隔离共享图必须可读')
    await storage.commitImport(imported, [shared], { pruneUnreferenced: true })
    assert(await storage.getAssetForExport(sharedId), '导入prune必须继续保留业务共享图')
    assert(await storage.getAssetForExport('retired-only-image'), '导入prune不能顺带删除非本批历史图片')
  } finally {
    storage.close()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

declare global { interface Window { __retiredDomainsTest?: Promise<void> } }
window.__retiredDomainsTest = run()
