import {
  canonicalizeTradeViewSearch,
  savedViewMatchesLocation,
  savedViewSearch,
  searchParamsToRecord,
  type SavedTradeView,
} from '@/lib/savedTradeViews'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const legacyView: SavedTradeView = {
  id: 'saved-stage-view',
  name: '实盘交易',
  pathname: '/list',
  search: { statsCycle: 'retired-boundary-id', liveCycle: 'pre-cycle', symbol: 'BTCUSDT' },
  pinned: true,
  order: 0,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
}

export function testSavedViewCanonicalizationDropsRetiredDateMembershipParameters(): void {
  const canonical = canonicalizeTradeViewSearch(legacyView.search)
  assert(!canonical.has('statsCycle'), '保存视图不得保留已退役的统计周期归属参数')
  assert(!canonical.has('liveCycle'), '保存视图不得保留已退役的风险周期参数')
  assert(canonical.get('symbol') === 'BTCUSDT', '清理旧参数不得丢失正常筛选')
}

export function testSavedViewRoundTripUsesOnlyCanonicalFilters(): void {
  const saved = { ...legacyView, search: searchParamsToRecord(new URLSearchParams(legacyView.search)) }
  assert(savedViewSearch(saved) === '?symbol=BTCUSDT', '恢复链接必须只包含规范筛选')
  assert(savedViewMatchesLocation(saved, '/list', '?symbol=BTCUSDT'), '清理后的保存视图必须稳定匹配')
}

export function testSavedViewMigratesRemovedHistoricalAggregateScope(): void {
  const canonical = canonicalizeTradeViewSearch({
    liveStage: 'all-history',
    strategyId: 'navigation-2',
  })
  assert(canonical.get('liveStage') === 'all', '旧保存视图的历史聚合范围必须迁移为全部阶段')
  assert(canonical.get('strategyId') === 'navigation-2', '迁移阶段范围不得丢失其他视图条件')
}
