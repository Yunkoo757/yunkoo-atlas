import {
  countDashboardDimensionFilters,
  parseDashboardQuery,
  updateDashboardQuery,
} from '@/lib/dashboardQuery'
import { resolveTradeDetailReturn } from '@/lib/tradeRoute'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testDashboardQueryRoundTripsUnicodeAndComposedDimensions(): void {
  const parsed = parseDashboardQuery(
    '?kind=all&range=90d&strategy=breakout&symbol=BTCUSDT&side=long&mistakeTag=%E8%BF%BD%E5%8D%95',
  )

  assert(parsed.tradeKind === 'all' && parsed.range === '90d', 'primary dashboard scope must restore')
  assert(parsed.scope.mistakeTag === '追单', 'unicode dimensions must decode without loss')
  assert(countDashboardDimensionFilters(parsed) === 4, 'every active dimension must be counted once')
}

export function testDashboardQueryRejectsInvalidEnumsAndKeepsUnknownParameters(): void {
  const parsed = parseDashboardQuery('?kind=case&range=forever&quality=trusted&side=flat')
  assert(parsed.tradeKind === 'live' && parsed.range === 'all', 'invalid enums must use stable defaults')
  assert(parsed.quality === 'all' && parsed.scope.side === undefined, 'invalid quality and side must not leak into scope')

  const next = updateDashboardQuery('?future=keep&kind=paper', 'range', '30d')
  assert(next.get('future') === 'keep', 'query updates must preserve forward-compatible parameters')
  assert(next.get('kind') === 'paper' && next.get('range') === '30d', 'query updates must compose')
}

export function testChangingStrategyClearsOnlyItsVersionAndCompactsDefaults(): void {
  const changed = updateDashboardQuery(
    '?strategy=old&strategyVersion=old%3Av2&symbol=EURUSD',
    'strategy',
    'new',
  )
  assert(changed.get('strategy') === 'new', 'strategy filter must update')
  assert(!changed.has('strategyVersion'), 'a version from the old strategy must be cleared')
  assert(changed.get('symbol') === 'EURUSD', 'unrelated dimensions must remain')

  const compact = updateDashboardQuery('?kind=paper', 'kind', 'live')
  assert(!compact.has('kind'), 'default values should be omitted while remaining reproducible')
}

export function testAnalyticsDrilldownReturnsToTheExactDashboardQuery(): void {
  const target = resolveTradeDetailReturn({
    from: {
      pathname: '/dashboard',
      search: '?kind=paper&quality=conflict&symbol=BTCUSDT',
    },
    tradeKind: 'paper',
  })
  assert(target.pathname === '/dashboard', 'analytics detail must return to dashboard')
  assert(target.search.includes('quality=conflict'), 'analytics detail must preserve evidence drilldown')
  assert(target.search.includes('symbol=BTCUSDT'), 'analytics detail must preserve dimension filters')
}
