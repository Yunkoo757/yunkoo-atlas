import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'
import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import { LEGACY_LOCAL_STORAGE_KEY } from '@/storage/legacyIdentity'
import { migrateFromLocalStorageIfNeeded } from '@/storage/migrate'
import { BROWSER_DATABASE_NAME } from '@/storage/storageIdentity'

declare global {
  interface Window {
    __migrateLegacyLocalStorageTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(BROWSER_DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('测试数据库仍被占用'))
  })
}

async function verifyInitializationCannotReplaceAnExistingSnapshot(): Promise<void> {
  await deleteDatabase()
  const target = new IndexedDbStorageAdapter()
  const peer = new IndexedDbStorageAdapter()
  const source = JSON.stringify({ state: { trades: [], strategies: [] } })
  localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, source)
  try {
    await target.open()
    await peer.open()
    const commit = target.commitImport.bind(target)
    target.commitImport = async (...args) => {
      await peer.saveSnapshot({ ...createEmptyPersistedSnapshot(), tagPresets: ['赢家'] })
      await target.loadSnapshotEnvelope()
      return commit(...args)
    }
    await migrateFromLocalStorageIfNeeded(target).catch(() => {})
    const winner = await peer.loadSnapshotEnvelope()
    assert(winner.revision === 1 && winner.snapshot?.tagPresets?.[0] === '赢家', '迁移准备期间出现的快照必须原样保留')
    assert(localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY) === source, '目标已被初始化时不能消费旧资料')
  } finally {
    peer.close()
    target.close()
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY)
  }
}

async function verifyChangedLegacySourceSurvives(oldValue: string | null): Promise<void> {
  await deleteDatabase()
  const target = new IndexedDbStorageAdapter()
  const newer = JSON.stringify({ state: { strategies: [], trades: [], display: { tradingDayStartHour: 8 } } })
  if (oldValue === null) localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY)
  else localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, oldValue)
  try {
    await target.open()
    const commit = target.commitImport.bind(target)
    target.commitImport = async (...args) => {
      await commit(...args)
      localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, newer)
    }
    assert(await migrateFromLocalStorageIfNeeded(target), '已提交的初始化须返回成功')
    assert(await target.getSnapshotRevision() === 1, '来源后续变化不得回滚已提交快照')
    assert(localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY) === newer, '收尾只能清理本次已经迁入的旧资料')
  } finally {
    target.close()
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY)
  }
}

async function run(): Promise<void> {
  await verifyChangedLegacySourceSurvives(null)
  await verifyChangedLegacySourceSurvives(JSON.stringify({ state: { trades: [], strategies: [] } }))
  await verifyInitializationCannotReplaceAnExistingSnapshot()
  await deleteDatabase()
  const trade: Trade = {
    id: 'legacy-terminal-live',
    ref: 'TRD-LEGACY-CLOSED',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'loss',
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
    pnl: -100,
    rMultiple: null,
    resultSource: 'pnl',
    openedAt: '2026-07-26T08:00:00+08:00',
    closedAt: '2026-07-27T05:30:00+08:00',
    note: '',
  }
  const failed = new IndexedDbStorageAdapter()
  await failed.open()
  try {
    const original = JSON.stringify({ state: {
      trades: [{ ...trade, note: '<img src="data:image/png;base64,AQID"><img src="data:image/png;base64,!!">' }],
      strategies: [{ id: 'strategy-1', name: '旧策略', icon: 'target', color: '#5e6ad2' }],
    } })
    localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, original)
    const failure = await migrateFromLocalStorageIfNeeded(failed).then(() => null, (error: Error) => error)
    assert(failure?.name === 'InvalidCharacterError', '第二张无效图片应报告解码失败')
    assert(localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY) === original, '解析失败须保留原文')
    assert(!(await failed.loadSnapshot()) && await failed.getSnapshotRevision() === 0, '解析失败不能发布快照或修订')
    assert((await failed.listAssetRecords()).length === 0, '解析失败不能留下已准备或已提交的第一张附件')
  } finally {
    failed.close()
  }

  localStorage.setItem(LEGACY_LOCAL_STORAGE_KEY, JSON.stringify({
    state: {
      trades: [trade],
      strategies: [{ id: 'strategy-1', name: '旧策略', icon: 'target', color: '#5e6ad2' }],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: { ...DEFAULT_DISPLAY, tradingDayStartHour: 6 },
    },
  }))

  const adapter = new IndexedDbStorageAdapter()
  try {
    await adapter.open()
    assert(await migrateFromLocalStorageIfNeeded(adapter), '旧 localStorage 应迁入 IndexedDB')
    const snapshot = await adapter.loadSnapshot()
    assert(snapshot?.trades[0]?.closedTradingDayKey === '2026-07-26', '迁移必须固化终态 live 业务日')
    assert(snapshot?.riskPolicyVersions.length === 0, '迁移必须补齐 v9 风险数组')
    assert(localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY) === null, '迁移成功后应清除旧 localStorage')
  } finally {
    adapter.close()
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY)
    await deleteDatabase()
  }
}

window.__migrateLegacyLocalStorageTest = run()
