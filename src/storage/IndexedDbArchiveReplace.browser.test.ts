import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import type { PersistedSnapshot } from '@/storage/types'

declare global {
  interface Window {
    __indexedDbArchiveReplaceTest?: Promise<void>
  }
}

const BROWSER_DB_NAME = 'linear-journal-v3'

async function seedHigherVersionDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(BROWSER_DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('测试数据库仍被占用'))
  })
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(BROWSER_DB_NAME, 3)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('snapshot')
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function snapshotWithNote(note: string, displayName: string): PersistedSnapshot {
  const trade: Trade = {
    id: `trade-${displayName}`,
    ref: `TRD-${displayName}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-16',
    closedAt: null,
    note,
  }
  return {
    trades: [trade],
    strategies: [{ id: 'strategy-1', name: '测试策略', icon: 'target', color: '#5e6ad2' }],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY },
    profile: { avatarId: null, displayName },
  }
}

async function run(): Promise<void> {
  await seedHigherVersionDatabase()
  const adapter = new IndexedDbStorageAdapter()
  await adapter.open()

  const oldAssetId = await adapter.saveAsset(new Blob(['old-image'], { type: 'image/png' }), 'image/png')
  await adapter.saveSnapshot(
    snapshotWithNote(`<p>旧库</p><img src="journal-asset://${oldAssetId}">`, '旧库'),
  )
  assert(await adapter.getAssetObjectUrl(oldAssetId), '旧附件应在替换前可读取')

  const nextAssetId = 'archive-replacement-asset'
  const nextSnapshot = snapshotWithNote(
    `<p>新库</p><img src="journal-asset://${nextAssetId}">`,
    '新库',
  )
  await adapter.replaceArchive(nextSnapshot, [{
    id: nextAssetId,
    mime: 'image/png',
    data: btoa('new-image'),
  }])

  const loaded = await adapter.loadSnapshot()
  assert(loaded?.profile?.displayName === '新库', '完整恢复必须替换主快照')
  assert(await adapter.getAssetForExport(nextAssetId), '完整恢复必须写入归档附件')
  assert((await adapter.getAssetForExport(oldAssetId)) === null, '完整恢复必须清除旧库孤儿附件')

  let rejected = false
  try {
    await adapter.replaceArchive(
      { ...nextSnapshot, trades: [{ ...nextSnapshot.trades[0], entry: Number.NaN }] },
      [],
    )
  } catch {
    rejected = true
  }
  assert(rejected, '非法快照必须在事务前被拒绝')
  assert((await adapter.loadSnapshot())?.profile?.displayName === '新库', '恢复失败后旧快照必须保持完整')
  assert(await adapter.getAssetForExport(nextAssetId), '恢复失败后旧附件必须保持完整')

  const transientAssetId = 'transaction-transient-asset'
  const failingAssetId = 'force-transaction-failure'
  const originalPut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function patchedPut(value: unknown, key?: IDBValidKey) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      value.id === failingAssetId
    ) {
      throw new DOMException('forced transaction failure', 'DataError')
    }
    return key === undefined
      ? originalPut.call(this, value)
      : originalPut.call(this, value, key)
  }

  rejected = false
  try {
    await adapter.replaceArchive(snapshotWithNote('<p>不应提交</p>', '事务失败库'), [
      { id: transientAssetId, mime: 'image/png', data: btoa('transient-image') },
      { id: failingAssetId, mime: 'image/png', data: btoa('failing-image') },
    ])
  } catch {
    rejected = true
  } finally {
    IDBObjectStore.prototype.put = originalPut
  }

  assert(rejected, '事务中途的同步 IDB 请求异常必须拒绝恢复')
  assert(
    (await adapter.loadSnapshot())?.profile?.displayName === '新库',
    '事务中途失败后原快照必须回滚',
  )
  assert(await adapter.getAssetForExport(nextAssetId), '事务中途失败后原附件必须回滚')
  assert(
    (await adapter.getAssetForExport(transientAssetId)) === null,
    '失败前已排队的新附件不得部分提交',
  )
  assert(
    (await adapter.getAssetForExport(failingAssetId)) === null,
    '抛错附件不得留在资料库',
  )
}

window.__indexedDbArchiveReplaceTest = run()
