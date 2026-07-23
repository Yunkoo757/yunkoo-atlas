import type { Trade } from '@/data/trades'
import {
  filterTradesByAnalysisScope,
  parseAnalysisScope,
  strategyAnalysisHref,
  writeAnalysisScope,
} from '@/lib/analysisScope'
import { createBusinessDateAnchor } from '@/lib/periods'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const closedLiveTrade: Trade = {
  id: 'live-closed',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'breakout',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 100,
  rMultiple: 2,
  openedAt: '2026-07-01',
  closedAt: '2026-07-02',
  note: '',
}

export function testStrategyAnalysisHrefPreservesDashboardScope(): void {
  const href = strategyAnalysisHref('breakout alpha', {
    kind: 'paper',
    range: '30d',
  })

  assert(
    href === '/strategy/breakout%20alpha?kind=paper&range=30d',
    'strategy drill-down must preserve kind and range in a stable URL',
  )
}

export function testParseAnalysisScopeDistinguishesExplicitDrilldown(): void {
  const ordinaryStrategyPage = parseAnalysisScope('')
  const dashboardDrilldown = parseAnalysisScope('?kind=paper&range=90d')

  assert(!ordinaryStrategyPage.explicit, 'an ordinary strategy route must keep its legacy workspace behavior')
  assert(dashboardDrilldown.explicit, 'dashboard scope parameters must activate analysis mode')
  assert(dashboardDrilldown.scope.kind === 'paper', 'analysis kind must survive URL parsing')
  assert(dashboardDrilldown.scope.range === '90d', 'analysis range must survive URL parsing')
}

export function testAnalysisScopeMatchesDashboardResultSet(): void {
  const trades: Trade[] = [
    closedLiveTrade,
    { ...closedLiveTrade, id: 'paper-closed', tradeKind: 'paper' },
    { ...closedLiveTrade, id: 'case-closed', tradeKind: 'case' },
    { ...closedLiveTrade, id: 'deleted-live', deletedAt: '2026-07-03T00:00:00.000Z' },
    { ...closedLiveTrade, id: 'open-live', status: 'open', closedAt: null },
  ]

  const result = filterTradesByAnalysisScope(trades, { kind: 'live', range: 'all' })

  assert(result.length === 1, 'analysis scope must exclude other kinds, cases, deleted and open trades')
  assert(result[0]?.id === closedLiveTrade.id, 'analysis scope must keep the matching closed trade')
}

export function testThirtyDayScopeUsesInclusiveClosedDateWindow(): void {
  const trades: Trade[] = [
    {
      ...closedLiveTrade,
      id: 'boundary-day',
      openedAt: '2026-01-01',
      closedAt: '2026-06-17',
    },
    {
      ...closedLiveTrade,
      id: 'too-old',
      openedAt: '2026-07-16',
      closedAt: '2026-06-16',
    },
    {
      ...closedLiveTrade,
      id: 'future-result',
      closedAt: '2026-07-17',
    },
  ]

  const result = filterTradesByAnalysisScope(
    trades,
    { kind: 'live', range: '30d' },
    new Date(2026, 6, 16, 12),
  )

  assert(result.length === 1, '30-day analysis must include exactly today and the previous 29 days')
  assert(result[0]?.id === 'boundary-day', 'analysis ranges must use closed date instead of opened date')
}

export function testNinetyDayScopeUsesInclusiveCalendarWindow(): void {
  const trades: Trade[] = [
    { ...closedLiveTrade, id: 'ninety-boundary', closedAt: '2026-04-18' },
    { ...closedLiveTrade, id: 'ninety-too-old', closedAt: '2026-04-17' },
  ]

  const result = filterTradesByAnalysisScope(
    trades,
    { kind: 'live', range: '90d' },
    new Date(2026, 6, 16, 12),
  )

  assert(result.length === 1, '90-day analysis must include exactly today and the previous 89 days')
  assert(result[0]?.id === 'ninety-boundary', '90-day analysis must include its first calendar day')
}

export function testThisWeekScopeUsesMondayThroughToday(): void {
  // 2026-07-16 周四 → 本周起点 2026-07-13（周一）
  const trades: Trade[] = [
    { ...closedLiveTrade, id: 'week-monday', closedAt: '2026-07-13' },
    { ...closedLiveTrade, id: 'week-today', closedAt: '2026-07-16' },
    { ...closedLiveTrade, id: 'previous-sunday', closedAt: '2026-07-12' },
    { ...closedLiveTrade, id: 'future-friday', closedAt: '2026-07-17' },
  ]

  const result = filterTradesByAnalysisScope(
    trades,
    { kind: 'live', range: 'this-week' },
    new Date(2026, 6, 16, 12),
  )

  assert(result.length === 2, 'this-week analysis must run from Monday through today')
  assert(
    result.map((trade) => trade.id).join(',') === 'week-monday,week-today',
    'this-week analysis must include Monday and today, exclude last week and future days',
  )
}

export function testThisMonthScopeStopsAtToday(): void {
  const trades: Trade[] = [
    { ...closedLiveTrade, id: 'month-start', closedAt: '2026-07-01' },
    { ...closedLiveTrade, id: 'previous-month', closedAt: '2026-06-30' },
    { ...closedLiveTrade, id: 'future-in-month', closedAt: '2026-07-17' },
  ]

  const result = filterTradesByAnalysisScope(
    trades,
    { kind: 'live', range: 'this-month' },
    new Date(2026, 6, 16, 12),
  )

  assert(result.length === 1, 'this-month analysis must run from month start through today')
  assert(result[0]?.id === 'month-start', 'this-month analysis must include the first day of the month')
}

export function testYearToDateScopeStartsOnJanuaryFirst(): void {
  const trades: Trade[] = [
    { ...closedLiveTrade, id: 'year-start', closedAt: '2026-01-01' },
    { ...closedLiveTrade, id: 'previous-year', closedAt: '2025-12-31' },
    { ...closedLiveTrade, id: 'future-this-year', closedAt: '2026-12-31' },
  ]

  const result = filterTradesByAnalysisScope(
    trades,
    { kind: 'live', range: 'ytd' },
    new Date(2026, 6, 16, 12),
  )

  assert(result.length === 1, 'year-to-date analysis must run from January 1 through today')
  assert(result[0]?.id === 'year-start', 'year-to-date analysis must include January 1')
}

export function testWriteAnalysisScopePreservesUnrelatedQueryState(): void {
  const params = writeAnalysisScope('?source=weekly&kind=live', {
    kind: 'paper',
    range: 'this-month',
  })

  assert(params.get('source') === 'weekly', 'writing analysis scope must preserve unrelated query state')
  assert(params.get('kind') === 'paper', 'writing analysis scope must replace the selected kind')
  assert(params.get('range') === 'this-month', 'writing analysis scope must persist the selected range')
}

export function testAnalysisRangesUseTheSharedBusinessDateAnchorWithoutMutatingTrades(): void {
  const original = {
    ...closedLiveTrade,
    id: 'anchor-boundary',
    openedAt: '2026-08-02',
    closedAt: '2026-08-02',
    recordedAt: '2026-08-03T03:30:00.000Z',
  }
  const before = JSON.stringify(original)
  const anchor = createBusinessDateAnchor(new Date(2026, 7, 3, 3, 59, 59, 999), 4)
  for (const range of ['this-week', 'this-month', '30d', '90d', 'ytd'] as const) {
    const result = filterTradesByAnalysisScope([original], { kind: 'live', range }, anchor)
    assert(result.length === 1, `${range} 必须使用共同锚点 2026-08-02`)
  }
  assert(JSON.stringify(original) === before, '相对范围计算不得改写 openedAt/closedAt/recordedAt')
}

export function testEveryRelativeRangeUsesBothSidesOfTheFourAmBoundary(): void {
  const before = createBusinessDateAnchor(new Date(2027, 0, 1, 3, 59, 59, 999), 4)
  const after = createBusinessDateAnchor(new Date(2027, 0, 1, 4, 0, 0, 0), 4)
  const priorYear = { ...closedLiveTrade, id: 'prior-year', closedAt: '2026-12-31' }
  const newYear = { ...closedLiveTrade, id: 'new-year', closedAt: '2027-01-01' }
  for (const range of ['this-week', 'this-month', '30d', '90d', 'ytd'] as const) {
    const beforeIds = filterTradesByAnalysisScope(
      [priorYear, newYear],
      { kind: 'live', range },
      before,
    ).map((trade) => trade.id)
    const afterIds = filterTradesByAnalysisScope(
      [priorYear, newYear],
      { kind: 'live', range },
      after,
    ).map((trade) => trade.id)
    assert(beforeIds.includes('prior-year') && !beforeIds.includes('new-year'), `${range} 在 04:00 前必须截止上一交易日`)
    assert(afterIds.includes('new-year'), `${range} 在 04:00 时必须包含新交易日`)
    if (range === 'this-month' || range === 'ytd') {
      assert(!afterIds.includes('prior-year'), `${range} 跨年后不得保留上一年度日期`)
    }
  }
}
// Quality-Scenario: B-CALENDAR
