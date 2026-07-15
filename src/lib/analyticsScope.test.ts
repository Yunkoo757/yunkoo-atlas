import type { Trade } from '@/data/trades'
import { buildAnalyticsUniverse, selectAnalyticsCandidates } from '@/lib/analyticsScope'

type AnalyticsFixtureTrade = Trade & {
  closedAtTimestamp?: string | null
  strategyVersionId?: string | null
  pnlCurrency?: string | null
}

const baseTrade: AnalyticsFixtureTrade = {
  id: 'live-closed',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'breakout',
  tradeKind: 'live',
  tags: ['伦敦开盘'],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 10,
  rMultiple: 2,
  openedAt: '2026-07-01',
  closedAt: '2026-07-02',
  note: '',
}

function fixture(
  id: string,
  overrides: Partial<AnalyticsFixtureTrade> = {},
): AnalyticsFixtureTrade {
  return {
    ...baseTrade,
    ...overrides,
    id,
    ref: `TRD-${id}`,
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function ids(trades: readonly Trade[]): string {
  return trades.map((trade) => trade.id).join(',')
}

export function testDefaultScopeIncludesOnlyActiveClosedLiveTrades(): void {
  const result = selectAnalyticsCandidates([
    fixture('live-closed'),
    fixture('paper-closed', { tradeKind: 'paper' }),
    fixture('case-closed', { tradeKind: 'case' }),
    fixture('live-open', { status: 'open', closedAt: null }),
    fixture('live-missed', { status: 'missed' }),
    fixture('live-deleted', { deletedAt: '2026-07-03T10:00:00.000Z' }),
  ], { range: 'all' })

  assert(ids(result.included) === 'live-closed', 'default analytics scope must include only closed live trades')
  assert(ids(result.temporalCandidates) === 'live-closed', 'dated included trades must be temporal candidates')
  assert(result.excludedCounts.deleted === 1, 'deleted trades must be excluded explicitly')
  assert(result.excludedCounts.case === 1, 'case records must never enter performance analytics')
  assert(result.excludedCounts.tradeKind === 1, 'paper trades must be excluded by the default live scope')
  assert(result.excludedCounts.status === 2, 'open and missed records must be excluded by execution status')
}

export function testFiniteRangeUsesClosedTimestampWithoutOpenedAtFallback(): void {
  const result = selectAnalyticsCandidates([
    fixture('closed-in-range', { openedAt: '2025-01-01', closedAt: '2026-07-02' }),
    fixture('timestamp-in-range', {
      closedAt: '2026-06-30',
      closedAtTimestamp: '2026-07-03T09:30:00+08:00',
    }),
    fixture('timestamp-outside-range', {
      closedAt: '2026-07-04',
      closedAtTimestamp: '2026-06-30T23:30:00+08:00',
    }),
    fixture('source-date-wins-across-utc-boundary', {
      closedAt: '2026-07-04',
      closedAtTimestamp: '2026-06-30T23:30:00-02:00',
    }),
    fixture('missing-close-date', { openedAt: '2026-07-05', closedAt: null }),
    fixture('invalid-close-date', { openedAt: '2026-07-05', closedAt: '2026-02-31' }),
    fixture('closed-outside-range', { openedAt: '2026-07-06', closedAt: '2026-06-29' }),
    fixture('null-timestamp-falls-back', {
      closedAt: '2026-07-07',
      closedAtTimestamp: null,
    }),
  ], { range: 'this-month' }, { today: '2026-07-15' })

  assert(
    ids(result.included) === 'closed-in-range,timestamp-in-range,null-timestamp-falls-back',
    'finite ranges must use closedAtTimestamp ?? closedAt and never openedAt',
  )
  assert(
    ids(result.temporalCandidates) === ids(result.included),
    'every finite-range included record must have a valid close date',
  )
  assert(
    ids(result.missingClosedAt) === 'missing-close-date,invalid-close-date',
    'missing or invalid close dates must remain visible as a quality issue',
  )
  assert(result.excludedCounts.missingClosedAt === 2, 'finite ranges must count undated closed records as excluded')
  assert(result.excludedCounts.outsideRange === 3, 'records outside the close-date range must be counted')
}

export function testAllTimeKeepsUndatedClosedResultsOutOfTemporalSeries(): void {
  const result = selectAnalyticsCandidates([
    fixture('dated-result'),
    fixture('undated-result', { openedAt: '2026-07-08', closedAt: null }),
  ], { tradeKind: 'live', range: 'all' })

  assert(ids(result.included) === 'dated-result,undated-result', 'all-time cross-sectional analytics must retain undated closed results')
  assert(ids(result.temporalCandidates) === 'dated-result', 'undated results must never enter ordered temporal analytics')
  assert(ids(result.missingClosedAt) === 'undated-result', 'all-time analytics must expose undated results separately')
  assert(result.excludedCounts.missingClosedAt === 0, 'an all-time undated result is included, not counted as excluded')
}

export function testDifferentSingleValueDimensionsComposeWithAndSemantics(): void {
  const matching = {
    tradeKind: 'paper' as const,
    strategyId: 'mean-reversion',
    strategyVersionId: 'mean-reversion-v2',
    symbol: 'EURUSD',
    side: 'short' as const,
    timeframe: '15M',
    session: 'London Open',
    tags: ['A+ setup'],
    mistakeTags: ['late entry'],
    pnlCurrency: 'EUR',
  }
  const result = selectAnalyticsCandidates([
    fixture('matches-every-dimension', matching),
    fixture('wrong-strategy', { ...matching, strategyId: 'breakout' }),
    fixture('wrong-version', { ...matching, strategyVersionId: 'mean-reversion-v1' }),
    fixture('wrong-symbol', { ...matching, symbol: 'GBPUSD' }),
    fixture('wrong-side', { ...matching, side: 'long' }),
    fixture('wrong-timeframe', { ...matching, timeframe: '1H' }),
    fixture('wrong-session', { ...matching, session: 'Asia' }),
    fixture('wrong-tag', { ...matching, tags: ['B setup'] }),
    fixture('wrong-mistake-tag', { ...matching, mistakeTags: ['early exit'] }),
    fixture('wrong-currency', { ...matching, pnlCurrency: 'USD' }),
  ], {
    tradeKind: 'paper',
    range: 'all',
    strategyId: matching.strategyId,
    strategyVersionId: matching.strategyVersionId,
    symbol: matching.symbol,
    side: matching.side,
    timeframe: matching.timeframe,
    session: matching.session,
    tag: matching.tags[0],
    mistakeTag: matching.mistakeTags[0],
    currency: matching.pnlCurrency,
  })

  assert(ids(result.included) === 'matches-every-dimension', 'different scope dimensions must combine with AND semantics')
  assert(result.excludedCounts.scope === 9, 'each first dimension mismatch must be counted once')
}

export function testCalendarRangesUseInclusiveBusinessDayBoundaries(): void {
  const trades = [
    fixture('day-30-first', { closedAt: '2026-06-16' }),
    fixture('day-30-before', { closedAt: '2026-06-15' }),
    fixture('day-90-first', { closedAt: '2026-04-17' }),
    fixture('day-90-before', { closedAt: '2026-04-16' }),
    fixture('ytd-first', { closedAt: '2026-01-01' }),
    fixture('previous-year', { closedAt: '2025-12-31' }),
    fixture('today', { closedAt: '2026-07-15' }),
    fixture('future-this-month', { closedAt: '2026-07-16' }),
  ]

  assert(
    ids(selectAnalyticsCandidates(trades, { range: '30d' }, { today: '2026-07-15' }).included)
      === 'day-30-first,today',
    '30d includes today and the previous 29 calendar days only',
  )
  assert(
    ids(selectAnalyticsCandidates(trades, { range: '90d' }, { today: '2026-07-15' }).included)
      === 'day-30-first,day-30-before,day-90-first,today',
    '90d includes today and the previous 89 calendar days only',
  )
  assert(
    ids(selectAnalyticsCandidates(trades, { range: 'ytd' }, { today: '2026-07-15' }).included)
      === 'day-30-first,day-30-before,day-90-first,day-90-before,ytd-first,today',
    'YTD includes the reporting year through today and excludes future records',
  )
  assert(
    ids(selectAnalyticsCandidates(trades, { range: 'this-month' }, { today: '2026-07-15' }).included)
      === 'today',
    'this month must not include records after the reporting day',
  )
}

export function testAllTimeIgnoresTodayAndAllKindNamesBothAccountKinds(): void {
  const result = selectAnalyticsCandidates([
    fixture('live'),
    fixture('paper', { tradeKind: 'paper' }),
    fixture('case', { tradeKind: 'case' }),
  ], { tradeKind: 'all', range: 'all' }, { today: 'not-a-date' })

  assert(ids(result.included) === 'live,paper', 'all kind combines live and paper but never cases')
}

export function testAnalyticsUniversePartitionsEvidenceOnceForEveryConsumer(): void {
  const universe = buildAnalyticsUniverse([
    fixture('usable-dated'),
    fixture('usable-undated', { closedAt: null }),
    fixture('conflict', { pnl: -10, rMultiple: 2 }),
    fixture('missing-result', { pnl: null, rMultiple: null }),
  ], { range: 'all' })

  assert(ids(universe.usable) === 'usable-dated,usable-undated', 'only coherent results are usable')
  assert(ids(universe.temporal) === 'usable-dated', 'only dated usable results enter sequence metrics')
  assert(ids(universe.usableMissingClosedAt) === 'usable-undated', 'undated usable results remain cross-sectional')
  assert(ids(universe.conflicts) === 'conflict', 'conflicting evidence has its own partition')
  assert(ids(universe.missingResults) === 'missing-result', 'missing evidence has its own partition')
}
