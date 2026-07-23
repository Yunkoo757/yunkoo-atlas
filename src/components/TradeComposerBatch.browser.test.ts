import type { Trade } from '@/data/trades'
import { commitComposerTradeBatch } from '@/lib/tradeComposerCommit'
import { pickPersisted } from '@/storage/persist'
import { StorageRevisionConflictError } from '@/storage/adapter'
import { IndexedDbStorageAdapter } from '@/storage/indexedDbAdapter'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'

declare global {
  interface Window {
    __tradeComposerBatchTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function candidateTrade(id: string, imageHtml: string): Trade {
  return {
    id,
    ref: 'TRD-1',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategyId: useStore.getState().strategies[0]?.id ?? '',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 0,
    exit: null,
    stopLoss: null,
    size: 0,
    pnl: null,
    rMultiple: null,
    timeframe: '1H',
    session: '',
    openedAt: '2026-07-22',
    closedAt: null,
    note: imageHtml,
  }
}

async function run(): Promise<void> {
  const databaseName = `composer-cas-${crypto.randomUUID()}`
  const staleComposer = new IndexedDbStorageAdapter(databaseName)
  const winner = new IndexedDbStorageAdapter(databaseName)
  await staleComposer.open()
  await winner.open()
  const originalTrades = useStore.getState().trades
  try {
    useStore.setState({ trades: [] })
    const initial = pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
    await winner.saveSnapshot(initial)
    assert((await staleComposer.loadSnapshotEnvelope()).revision === 1, 'Composer 必须先持有旧 revision')
    await winner.saveSnapshot({
      ...initial,
      profile: {
        avatarId: initial.profile?.avatarId ?? null,
        customAvatarDataUrl: initial.profile?.customAvatarDataUrl ?? null,
        displayName: '并发赢家',
      },
    })

    let error: unknown
    try {
      await commitComposerTradeBatch({
        targetTradeId: 'composer-stale-trade',
        images: [{ file: new Blob(['composer-image'], { type: 'image/png' }), mime: 'image/png' }],
        storage: staleComposer,
        createAssetId: () => 'composer-stale-asset',
        buildTrade: (_state, imageHtml) => candidateTrade('composer-stale-trade', imageHtml),
      })
    } catch (caught) {
      error = caught
    }

    assert(error instanceof StorageRevisionConflictError, 'Composer stale commit 必须返回 typed CAS conflict')
    const observed = await winner.loadSnapshotEnvelope()
    assert(observed.revision === 2, 'Composer 冲突不得推进赢家 revision')
    assert(observed.snapshot?.profile?.displayName === '并发赢家', 'Composer 冲突不得覆盖赢家快照')
    assert(observed.snapshot?.trades.length === 0, 'Composer 冲突不得部分新增交易')
    assert(await winner.getAssetForExport('composer-stale-asset') === null, 'Composer 冲突不得留下新孤儿附件')
    assert(useStore.getState().trades.length === 0, 'Composer 冲突不得发布候选交易到 Store')
  } finally {
    useStore.setState({ trades: originalTrades })
    staleComposer.close()
    winner.close()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

window.__tradeComposerBatchTest = run()
