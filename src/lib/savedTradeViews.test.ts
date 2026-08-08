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
    resolveTradeViewPerformanceCycleLabel(canonical, cycles) === '统计周期：稳健执行期',
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

export function testRemovedPerformanceCycleIdsBecomeClearedAndInactive(): void {
  const removed = savedView('removed-cycle-uuid')
  const canonical = canonicalizeTradeViewSearch(removed.search, cycles)

  assert(!canonical.has('statsCycle'), '失效保存视图周期必须清除，不能漂移到当前周期')
  assert(canonical.get('symbol') === 'BTCUSDT', '清除失效周期不得丢失无关筛选')
  assert(
    savedViewSearch(removed, cycles) === '?symbol=BTCUSDT',
    '恢复失效保存视图时必须只清除周期条件',
  )
  assert(
    !savedViewMatchesLocation(removed, '/list', '?symbol=BTCUSDT', cycles),
    '引用已删除周期的保存视图必须呈 inactive，不能把清除后的页面误判为 active',
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
  assert(resolved.search === '?symbol=BTCUSDT', '侧栏恢复链接也必须清除失效周期')
  assert('inactive' in resolved && resolved.inactive === true, '失效周期保存视图在侧栏必须呈 inactive')
  const selection = resolveSidebarSelection({
    pathname: '/list',
    search: '?symbol=BTCUSDT',
    items: [resolved],
  })
  assert(!selection.activeWorkspaceItemId, '清除后的普通页面不得误激活原失效周期保存视图')
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
