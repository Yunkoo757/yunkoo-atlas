import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import type { PersistedSnapshot } from '@/storage/types'
import { mergeAuthoritativeSnapshot } from '@/sync/runtime'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function trade(id: string): Trade {
  return {
    id, ref: 'TRD-1', symbol: 'BTCUSDT', side: 'long', status: 'open', conviction: 'medium',
    strategyId: '', tags: [], mistakeTags: [], reviewStatus: 'unreviewed',
    reviewCategory: 'normal', tradeKind: 'live', entry: null, exit: null, size: null,
    pnl: null, rMultiple: null, openedAt: '2026-07-15', closedAt: null, note: '',
  }
}

function snapshot(trades: Trade[], tags: string[]): PersistedSnapshot {
  return {
    trades, strategies: [], starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY, tagPresets: tags, mistakeTagPresets: [],
  }
}

export function testAuthoritativeEpochRemovesStaleEntitiesAndPreservesEditsMadeDuringDownload(): void {
  const stale = trade('stale-trade')
  const baseline = snapshot([stale], ['同步前'])
  const current = snapshot([stale], ['下载期间新编辑'])
  const authoritative = snapshot([], ['云端权威'])

  const merged = mergeAuthoritativeSnapshot(baseline, current, authoritative)

  assert(merged.trades.length === 0, '未在下载期间编辑的旧实体必须从新 epoch 移除')
  assert(merged.tagPresets?.[0] === '下载期间新编辑', '网络等待期间的新编辑必须保留并随后进入新 outbox')
}
