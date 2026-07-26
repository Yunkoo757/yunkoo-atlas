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

async function run(): Promise<void> {
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
