import assert from 'node:assert/strict'
import { createBusinessDateAnchor } from '@/lib/periods'
import { buildPerformanceSelection } from '@/lib/performanceSelection'
import { performanceTruthFixture } from '@/test/fixtures/performanceTruthFixture'

const fixture = performanceTruthFixture

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
    'FX-CURRENCY-UNKNOWN',
  ]
  assert.deepEqual(selection.unknownCurrencyIds, [])
  assert.deepEqual(selection.pnlIds, expectedUsdIds)
  assert.deepEqual(selection.currencyGroups, [
    { currency: 'USD', ids: expectedUsdIds },
    { currency: 'CNY', ids: ['FX-CNY'] },
  ])
}
