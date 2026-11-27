import { resolveTradeCashCurrencyFact } from '@/lib/cashCurrency'
import { buildDashboardStats } from '@/lib/dashboardStats'
import { buildPerformanceSelection } from '@/lib/performanceSelection'
import { createBusinessDateAnchor } from '@/lib/periods'
import { performanceTruthFixture as fixture } from '@/test/fixtures/performanceTruthFixture'

const selection = buildPerformanceSelection(fixture.trades, {
  scope: { kind: 'all', range: 'all' },
  dateBounds: fixture.currentDateBounds,
  anchor: createBusinessDateAnchor(fixture.now, fixture.tradingDayStartHour),
  legacyCashCurrencyAssumption: null,
})
const stats = buildDashboardStats(
  [...fixture.trades],
  [],
  selection.eligibleMetricIds,
  fixture.tradingDayStartHour,
  selection.pnlIds,
)
const collectionNames = [
  'futureCloseDayIds', 'missingCloseDayIds', 'invalidCloseDayIds',
  'completeResultIds', 'conflictResultIds', 'missingResultIds',
  'eligibleMetricIds', 'pnlIds', 'rIds', 'unknownCurrencyIds',
] as const
export const goldenEvidence = {
  sampleCount: fixture.trades.length,
  collections: Object.fromEntries(collectionNames.map((name) => [name, {
    expectedIds: [...fixture.expected[name]],
    actualIds: [...selection[name]],
  }])),
  drilldownTarget: { expected: '?kind=all&range=all', actual: selection.drilldownTarget },
  kpiTruth: {
    futureCloseDayIds: [...selection.futureCloseDayIds],
    missingCloseDayIds: [...selection.missingCloseDayIds],
    invalidCloseDayIds: [...selection.invalidCloseDayIds],
    usdTradeFacts: fixture.trades
      .filter((trade) => typeof trade.pnl === 'number' && Number.isFinite(trade.pnl))
      .map((trade) => ({
        id: trade.id,
        currency: resolveTradeCashCurrencyFact(trade).currency,
        hasStoredCurrency: Object.prototype.hasOwnProperty.call(trade, 'cashCurrency'),
        pnl: trade.pnl,
      })),
    expected: {
      eligibleMetricIds: [...fixture.expected.eligibleMetricIds],
      pnlIds: [...fixture.expected.pnlIds],
      ...fixture.expected.dashboard,
    },
    actual: {
      eligibleMetricIds: [...selection.eligibleMetricIds],
      pnlIds: [...selection.pnlIds],
      pnlCount: stats.pnlCount,
      totalPnl: stats.totalPnl,
      curveTradeIds: stats.curve.map((point) => point.tradeId),
    },
  },
}
