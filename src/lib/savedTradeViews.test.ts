import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import {
  canonicalizeTradeViewSearch,
  resolveTradeViewPerformanceCycleLabel,
  savedViewMatchesLocation,
  savedViewSearch,
  type SavedTradeView,
} from '@/lib/savedTradeViews'
import {
  resolveSidebarSelection,
  resolveSidebarWorkspaceItem,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const cycles: LivePerformanceCycle[] = [
  {
    id: 'cycle-human-name-id',
    name: '稳健执行期',
    startTradingDayKey: '2026-04-01',
    createdAt: '2026-04-01T00:00:00.000Z',
  },
  {
    id: 'cycle-current-id',
    name: '当前提升期',
    startTradingDayKey: '2026-07-01',
    createdAt: '2026-07-01T00:00:00.000Z',
  },
]

function savedView(statsCycle: string): SavedTradeView {
  return {
    id: 'saved-cycle-view',
    name: '周期交易',
    pathname: '/list',
    search: { statsCycle, symbol: 'BTCUSDT' },
    pinned: true,
    order: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

export function testSavedViewsPreserveValidPerformanceCycleIdsAndResolveHumanLabels(): void {
  const canonical = canonicalizeTradeViewSearch(
    '?statsCycle=cycle-human-name-id&symbol=BTCUSDT',
    cycles,
  )

  assert(canonical.get('statsCycle') === 'cycle-human-name-id', '有效统计周期 ID 必须保留')
  assert(
    resolveTradeViewPerformanceCycleLabel(canonical, cycles) === '实盘归档：稳健执行期',
    '渲染标签必须从当前 Store 周期名称解析，不得显示原始 ID',
  )
  assert(
    !resolveTradeViewPerformanceCycleLabel(canonical, cycles)?.includes('cycle-human-name-id'),
    '用户可见标签绝不能泄漏 UUID/内部 ID',
  )
  assert(
    savedViewSearch(savedView('cycle-human-name-id'), cycles) ===
      '?statsCycle=cycle-human-name-id&symbol=BTCUSDT',
    '有效保存视图必须稳定恢复显式周期与无关筛选',
  )
}

export function testCurrentSavedViewTracksTheCurrentArchiveWithoutPersistingItsId(): void {
  const canonical = canonicalizeTradeViewSearch('?statsCycle=cycle-current-id&symbol=BTCUSDT', cycles)

  assert(!canonical.has('statsCycle'), '当前保存视图必须删除 statsCycle 以动态跟随当前')
  assert(canonical.get('symbol') === 'BTCUSDT', '删除当前范围不得丢失 symbol')
  assert(
    savedViewSearch(savedView('cycle-current-id'), cycles) === '?symbol=BTCUSDT',
    '当前保存视图恢复时必须仍指向当前范围',
  )
}

export function testRemovedPerformanceCycleIdsStayInactiveAndRouteToArchiveHome(): void {
  const removed = savedView('removed-cycle-uuid')
  const canonical = canonicalizeTradeViewSearch(removed.search, cycles)

  assert(canonical.get('statsCycle') === 'removed-cycle-uuid', '失效保存视图必须保留请求，不能漂移到当前周期')
  assert(canonical.get('symbol') === 'BTCUSDT', '保留失效周期不得丢失无关筛选')
  assert(
    savedViewSearch(removed, cycles) === '?statsCycle=removed-cycle-uuid&symbol=BTCUSDT',
    '恢复失效保存视图必须保留归档首页请求',
  )
  assert(
    !savedViewMatchesLocation(removed, '/list', '?statsCycle=removed-cycle-uuid&symbol=BTCUSDT', cycles),
    '失效保存视图虽保留归档请求，仍不得被视为可用视图',
  )
  assert(
    resolveTradeViewPerformanceCycleLabel(removed.search, cycles) === null,
    '失效周期不得退化为内部 ID 标签',
  )

  const workspaceItem: SidebarWorkspaceItem = {
    id: 'saved-view:saved-cycle-view',
    target: { kind: 'saved-view', viewId: removed.id },
    placement: 'pinned',
    order: 0,
  }
  const resolved = resolveSidebarWorkspaceItem(workspaceItem, {
    savedViews: [removed],
    strategies: [],
    livePerformanceCycles: cycles,
  })
  assert(resolved.search === '?statsCycle=removed-cycle-uuid&symbol=BTCUSDT', '侧栏恢复链接必须保留失效归档请求')
  assert('inactive' in resolved && resolved.inactive === true, '失效周期保存视图在侧栏必须呈 inactive')
  const selection = resolveSidebarSelection({
    pathname: '/list',
    search: '?statsCycle=removed-cycle-uuid&symbol=BTCUSDT',
    items: [resolved],
  })
  assert(!selection.activeWorkspaceItemId, '失效归档请求不得激活已失效保存视图')
}

export function testPerformanceAndRiskCycleConflictsCanonicalizeToStatisticsScope(): void {
  const canonical = canonicalizeTradeViewSearch(
    '?liveCycle=pre-cycle&statsCycle=cycle-human-name-id&status=win',
    cycles,
  )

  assert(canonical.get('statsCycle') === 'cycle-human-name-id', '冲突时必须保留统计周期')
  assert(!canonical.has('liveCycle'), '冲突时必须删除风险周期')
  assert(canonical.get('status') === 'win', '冲突规范化不得丢失其他筛选')
}
