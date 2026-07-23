import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import type { PersistedSnapshot } from '@/storage/types'
import { PERSISTED_SNAPSHOT_FIELDS } from '@/storage/persistedKeys'
import {
  createFullPersistedSnapshotFixture,
  FULL_SNAPSHOT_ASSET_IDS,
  canonicalContractJson,
} from '@/storage/fixtures/fullPersistedSnapshot'

declare global {
  interface Window {
    __indexedDbArchiveReplaceTest?: Promise<void>
  }
}

const BROWSER_DB_NAME = 'linear-journal-v3'

async function seedIncompleteHigherVersionDatabase(): Promise<void> {
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
      const legacySnapshot = snapshotWithNote('<p>缺表旧库</p>', '缺表旧库')
      const [{
        tags: _tags,
        note: _note,
        exit: _exit,
        pnl: _pnl,
        rMultiple: _rMultiple,
        closedAt: _closedAt,
        entry: _entry,
        size: _size,
        ...legacyTrade
      }] = legacySnapshot.trades
      db.createObjectStore('snapshot').put({
        ...legacySnapshot,
        trades: [{ ...legacyTrade, entry: null, size: null }],
      }, 'main')
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
  await seedIncompleteHigherVersionDatabase()
  const adapter = new IndexedDbStorageAdapter()
  await adapter.open()
  assert(await adapter.getSnapshotRevision() === 0, 'Release 0 旧库缺少 revision 时必须兼容读取为 0')
  assert((await adapter.getManifest()).libraryId.length > 0, '旧版缺失的资料库元数据表应自动补齐')
  const repairedSnapshot = await adapter.loadSnapshot()
  assert(repairedSnapshot?.profile?.displayName === '缺表旧库', '补齐存储表时不得覆盖旧交易快照')
  assert(repairedSnapshot?.trades[0]?.tags.length === 0, '旧交易缺少标签数组时应安全补为空数组')
  assert(repairedSnapshot?.trades[0]?.note === '', '旧交易缺少笔记时应安全补为空文本')
  assert(repairedSnapshot?.trades[0]?.closedAt === null, '旧交易缺少平仓日期时应安全补为空值')
  assert(repairedSnapshot?.trades[0]?.entry === 0, '旧交易缺少入场价时应使用兼容占位值')
  assert(repairedSnapshot?.trades[0]?.size === 0, '旧交易缺少仓位时应使用兼容占位值')

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

  const contractSnapshot = createFullPersistedSnapshotFixture()
  const contractAssets = Object.values(FULL_SNAPSHOT_ASSET_IDS).map((id, index) => ({
    id,
    mime: 'image/png',
    data: btoa(`indexed-db-contract-${index}`),
  }))
  await adapter.replaceArchive(contractSnapshot, contractAssets)
  assert(
    await adapter.getSnapshotRevision() === 4,
    'WEB2 PATH-B 必须在同一 mutation 中将 revision 从 3 推进到 4',
  )
  const contractLoaded = await adapter.loadSnapshot()
  assert(contractLoaded, 'PATH-B replace 后必须存在快照')
  for (const field of PERSISTED_SNAPSHOT_FIELDS) {
    assert(
      canonicalContractJson(contractLoaded[field]) === canonicalContractJson(contractSnapshot[field]),
      `PATH-B IndexedDB replace 字段 ${field} 必须逐字段保真`,
    )
  }
  for (const asset of contractAssets) {
    const restored = await adapter.getAssetForExport(asset.id)
    assert(restored?.data === asset.data, `PATH-B IndexedDB 附件 ${asset.id} 必须逐字节保真`)
  }

  const contractRevisionBeforeFailure = canonicalContractJson({
    revision: await adapter.getSnapshotRevision(),
    snapshot: contractLoaded,
    assets: await Promise.all(contractAssets.map((asset) => adapter.getAssetForExport(asset.id))),
  })
  const originalPutForContractFailure = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function patchedContractPut(value: unknown, key?: IDBValidKey) {
    if (typeof value === 'object' && value !== null && 'id' in value && value.id === failingAssetId) {
      throw new DOMException('forced contract transaction failure', 'DataError')
    }
    return key === undefined
      ? originalPutForContractFailure.call(this, value)
      : originalPutForContractFailure.call(this, value, key)
  }
  rejected = false
  try {
    await adapter.replaceArchive(snapshotWithNote('<p>失败候选</p>', '失败候选'), [
      { id: transientAssetId, mime: 'image/png', data: btoa('transient') },
      { id: failingAssetId, mime: 'image/png', data: btoa('failure') },
    ])
  } catch {
    rejected = true
  } finally {
    IDBObjectStore.prototype.put = originalPutForContractFailure
  }
  assert(rejected, 'PATH-B Nth 附件请求失败必须中止同一 CAS 事务')
  const contractRevisionAfterFailure = canonicalContractJson({
    revision: await adapter.getSnapshotRevision(),
    snapshot: await adapter.loadSnapshot(),
    assets: await Promise.all(contractAssets.map((asset) => adapter.getAssetForExport(asset.id))),
  })
  assert(
    contractRevisionAfterFailure === contractRevisionBeforeFailure,
    'PATH-B 失败后快照、全部附件与可观察 revision 指纹必须零变化',
  )
}

window.__indexedDbArchiveReplaceTest = run()
