import assert from 'node:assert/strict'
import { flattenGroups, type TradeListGroup } from '@/components/trades/TradeList'
import type { Trade } from '@/data/trades'

function trade(id: string): Trade {
  return {
    id,
    ref: id.toUpperCase(),
    symbol: 'EURUSD',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 's1',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 1,
    exit: 1.1,
    size: 1,
    pnl: 10,
    rMultiple: 1,
    openedAt: '2026-07-01T00:00:00.000Z',
    closedAt: '2026-07-01T01:00:00.000Z',
    note: '',
  }
}

export function testFlattenGroupsOmitsRowsWhenCollapsed(): void {
  const groups: TradeListGroup[] = [
    { key: '2026-07', label: '2026年7月', recency: 'current', items: [trade('a'), trade('b')] },
    { key: '2026-06', label: '2026年6月', recency: 'recent', items: [trade('c')] },
  ]

  const expanded = flattenGroups(groups)
  assert.equal(expanded.length, 5)
  assert.equal(expanded.filter((item) => item.kind === 'header').length, 2)
  assert.equal(expanded.filter((item) => item.kind === 'row').length, 3)
  const julyHeader = expanded.find(
    (item): item is Extract<typeof item, { kind: 'header' }> =>
      item.kind === 'header' && item.groupKey === '2026-07',
  )
  assert.equal(julyHeader?.openProgress, 1)
  assert.equal(julyHeader?.recency, 'current')

  const collapsed = flattenGroups(groups, new Map([['2026-07', 0]]))
  assert.equal(collapsed.length, 3)
  const collapsedJuly = collapsed.find(
    (item): item is Extract<typeof item, { kind: 'header' }> =>
      item.kind === 'header' && item.groupKey === '2026-07',
  )
  assert.equal(collapsedJuly?.openProgress, 0)
  assert.ok(collapsed.some((item) => item.kind === 'row' && item.trade.id === 'c'))
  assert.ok(!collapsed.some((item) => item.kind === 'row' && item.trade.id === 'a'))
}

export function testFlattenGroupsKeepsRowsWhileCollapsing(): void {
  const groups: TradeListGroup[] = [
    { key: '2026-07', label: '2026年7月', items: [trade('a'), trade('b')] },
  ]
  const mid = flattenGroups(groups, new Map([['2026-07', 0.4]]))
  assert.equal(mid.filter((item) => item.kind === 'row').length, 2)
  assert.ok(mid.every((item) => item.openProgress === 0.4))
}
