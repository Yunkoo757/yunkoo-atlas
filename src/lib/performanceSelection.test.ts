import assert from 'node:assert/strict'
import { createBusinessDateAnchor } from '@/lib/periods'
import { buildPerformanceSelection } from '@/lib/performanceSelection'
import { performanceTruthFixture } from '@/test/fixtures/performanceTruthFixture'

const fixture = performanceTruthFixture
const hasOwn = (value: object, property: string): boolean => Object.prototype.hasOwnProperty.call(value, property)

function selectionFor(range: 'all' | '30d' = 'all') {
  return buildPerformanceSelection(fixture.trades, {
    scope: { kind: 'all', range },
    liveScope: fixture.currentLiveScope,
    anchor: createBusinessDateAnchor(fixture.now, fixture.tradingDayStartHour),
    legacyCashCurrencyAssumption: null,
  })
}

export function testPerformanceSelectionFreezesEveryGoldenTruthCollection(): void {
  const selection = selectionFor()

  assert.equal(fixture.trades.length, 56)
  assert.equal(selection.drilldownTarget, '?kind=all&range=all')
  assert.deepEqual(selection.futureCloseDayIds, fixture.expected.futureCloseDayIds)
  assert.deepEqual(selection.missingCloseDayIds.sort(), fixture.expected.missingCloseDayIds)
  assert.deepEqual(selection.invalidCloseDayIds, fixture.expected.invalidCloseDayIds)
  assert.deepEqual(selection.completeResultIds, fixture.expected.completeResultIds)
  assert.deepEqual(selection.conflictResultIds, fixture.expected.conflictResultIds)
  assert.deepEqual(selection.missingResultIds, fixture.expected.missingResultIds)
  assert.deepEqual(selection.eligibleMetricIds, fixture.expected.eligibleMetricIds)
  assert.deepEqual(selection.pnlIds, fixture.expected.pnlIds)
  assert.deepEqual(selection.rIds, fixture.expected.rIds)
  assert.deepEqual(selection.unknownCurrencyIds, fixture.expected.unknownCurrencyIds)
  assert.deepEqual(selection.currencyGroups, fixture.expected.currencyGroups)

  assert(!selection.eligibleMetricIds.includes('FX-CLOSE-FUTURE'))
  assert(!selection.eligibleMetricIds.includes('FX-PAPER-MISSING'))
  assert(selection.pnlIds.includes('FX-USD'))
  assert(!selection.pnlIds.includes('FX-CNY'))
  assert(!selection.pnlIds.includes('FX-CURRENCY-UNKNOWN'))
}

export function testPerformanceSelectionIntersectsNaturalRangeAfterTheLiveBoundary(): void {
  const selection = selectionFor('30d')

  assert.equal(selection.drilldownTarget, '?kind=all&range=30d')
  assert.deepEqual(selection.eligibleMetricIds, [
    'tr-1016', 'tr-1017', 'tr-1018', 'tr-1019', 'tr-1020', 'tr-1021', 'tr-1022',
    'tr-1023', 'tr-1024', 'tr-1025', 'tr-1026', 'tr-1027', 'tr-1028', 'tr-1029',
    'tr-1031', 'paper-1', 'paper-2', 'FX-CLOSE-0559', 'FX-CLOSE-0600', 'FX-PNL-ONLY',
    'FX-R-ONLY', 'FX-USD', 'FX-CNY', 'FX-CURRENCY-UNKNOWN',
  ])
}

export function testPerformanceSelectionUsesTheExplicitLegacyCashCurrencyAssumption(): void {
  const selection = buildPerformanceSelection(fixture.trades, {
    scope: { kind: 'all', range: 'all' },
    liveScope: fixture.currentLiveScope,
    anchor: createBusinessDateAnchor(fixture.now, fixture.tradingDayStartHour),
    legacyCashCurrencyAssumption: 'USD',
  })

  const expectedUsdIds = [
    ...fixture.expected.unknownCurrencyIds.slice(0, -1),
    'FX-USD',
  ]
  assert.deepEqual(selection.unknownCurrencyIds, ['FX-CURRENCY-UNKNOWN'])
  assert.deepEqual(selection.pnlIds, expectedUsdIds)
  assert.deepEqual(selection.currencyGroups, [
    { currency: 'USD', ids: expectedUsdIds },
    { currency: 'CNY', ids: ['FX-CNY'] },
  ])
}

export function testPerformanceSelectionAppliesLegacyCashOnlyWhenCurrencyIsOmitted(): void {
  const legacyTrade = fixture.trades.find((trade) => trade.id === 'tr-1011')!
  const explicitUnknownTrade = fixture.trades.find((trade) => trade.id === 'FX-CURRENCY-UNKNOWN')!
  assert.equal(hasOwn(legacyTrade, 'currency'), false)
  assert.equal(hasOwn(explicitUnknownTrade, 'currency'), true)

  const selection = buildPerformanceSelection([legacyTrade, explicitUnknownTrade], {
    scope: { kind: 'all', range: 'all' },
    liveScope: null,
    anchor: createBusinessDateAnchor(fixture.now, fixture.tradingDayStartHour),
    legacyCashCurrencyAssumption: 'USD',
  })

  assert.deepEqual(selection.pnlIds, ['tr-1011'])
  assert.deepEqual(selection.unknownCurrencyIds, ['FX-CURRENCY-UNKNOWN'])
}

export function testPerformanceSelectionUsesThePreCurrentBoundaryForAllArchives(): void {
  const early = fixture.trades.find((trade) => trade.id === 'tr-1001')!
  const current = fixture.trades.find((trade) => trade.id === 'tr-1011')!
  const input = {
    scope: { kind: 'live' as const, range: 'all' as const },
    anchor: createBusinessDateAnchor(fixture.now, fixture.tradingDayStartHour),
    legacyCashCurrencyAssumption: null,
  }

  const archives = buildPerformanceSelection([early, current], {
    ...input,
    liveScope: {
      kind: 'all-archives', archiveId: null,
      bounds: { startInclusive: '2026-07-01', endExclusive: null }, label: '全部归档',
    },
  })
  assert.deepEqual(archives.eligibleMetricIds, ['tr-1001'])
}

export function testPerformanceSelectionExcludesReliableDaysFromPendingLiveScope(): void {
  const early = fixture.trades.find((trade) => trade.id === 'tr-1001')!
  const current = fixture.trades.find((trade) => trade.id === 'tr-1011')!
  const pending = buildPerformanceSelection([early, current], {
    scope: { kind: 'live', range: 'all' },
    liveScope: { kind: 'pending', archiveId: null, bounds: null, label: '待整理' },
    anchor: createBusinessDateAnchor(fixture.now, fixture.tradingDayStartHour),
    legacyCashCurrencyAssumption: null,
  })

  assert.deepEqual(pending.eligibleMetricIds, [])
}

export function testPerformanceSelectionFreezesTheSixAmCloseDayBoundary(): void {
  const close0559 = fixture.trades.find((trade) => trade.id === 'FX-CLOSE-0559')!
  const close0600 = fixture.trades.find((trade) => trade.id === 'FX-CLOSE-0600')!
  const selection = buildPerformanceSelection([close0559, close0600], {
    scope: { kind: 'live', range: 'all' },
    liveScope: {
      kind: 'current', archiveId: 'day-nine',
      bounds: { startInclusive: '2026-08-09', endExclusive: null }, label: '当前实盘',
    },
    anchor: createBusinessDateAnchor(fixture.now, fixture.tradingDayStartHour),
    legacyCashCurrencyAssumption: null,
  })

  assert.deepEqual(selection.eligibleMetricIds, ['FX-CLOSE-0600'])
}

export function testPerformanceSelectionDrilldownReproducesArchiveScope(): void {
  const trade = fixture.trades.find((item) => item.id === 'tr-1001')!
  const base = {
    scope: { kind: 'live' as const, range: 'all' as const },
    anchor: createBusinessDateAnchor(fixture.now, fixture.tradingDayStartHour),
    legacyCashCurrencyAssumption: null,
  }
  const archive = buildPerformanceSelection([trade], {
    ...base,
    liveScope: {
      kind: 'archive',
      archiveId: 'archive-alpha',
      bounds: { startInclusive: '2026-06-01', endExclusive: '2026-07-01' },
      label: '历史归档',
    },
  })
  const stale = buildPerformanceSelection([trade], {
    ...base,
    liveScope: {
      kind: 'current',
      archiveId: null,
      bounds: null,
      label: '当前实盘',
      missingRequestedKey: 'removed-archive',
    },
  })

  assert.equal(archive.drilldownTarget, '?kind=live&range=all&statsCycle=archive-alpha')
  assert.equal(stale.drilldownTarget, '?kind=live&range=all&statsCycle=removed-archive')
}
