import type { Trade } from '@/data/trades'
import { aggregateMoney, moneyAggregateLabel, moneyAggregateTitle } from '@/lib/moneyAggregate'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

type EvidenceTrade = Trade & {
  pnlCurrency?: string | null
  pnlCurrencySource?: 'manual' | 'imported' | 'inferred' | 'legacy' | null
  pnlBasis?: 'net' | 'unknown'
}

function trade(id: string, pnl: number, currency?: string): EvidenceTrade {
  return {
    id, ref: id, symbol: 'EURUSD', side: 'long', status: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven',
    conviction: 'medium', strategyId: 's', tags: [], mistakeTags: [], reviewStatus: 'reviewed',
    reviewCategory: 'normal', tradeKind: 'live', entry: 1, exit: 1, size: 1, pnl, rMultiple: pnl,
    resultSource: 'imported', openedAt: '2026-01-01', closedAt: '2026-01-02', note: '',
    pnlCurrency: currency, pnlCurrencySource: currency ? 'manual' : null, pnlBasis: 'net',
  }
}

export function testMoneyAggregateRejectsUnknownAndMixedCurrencies(): void {
  assert(aggregateMoney([trade('a', 10)]).state === 'unknown-currency', 'unknown currency must not be summed')
  const mixed = aggregateMoney([trade('a', 10, 'USD'), trade('b', 20, 'EUR')])
  assert(mixed.state === 'mixed-currency' && mixed.total === null, 'mixed currency must not produce a false total')
}

export function testMoneyAggregateLabelsSingleCurrencyEvidence(): void {
  const result = aggregateMoney([trade('a', 10, 'USD'), trade('b', -2, 'USD')])
  assert(result.state === 'single-currency' && result.total === 8, 'single currency values are summed')
  assert(moneyAggregateLabel(result) === '+8 USD', 'single currency label preserves currency')
  assert(moneyAggregateTitle(result) === '净盈亏', 'confirmed net evidence may use the net PnL title')
}

export function testLegacyCurrencyRemainsConfirmedButInferredCurrencyStaysExplicit(): void {
  const legacy = trade('legacy', 10, 'USD')
  legacy.pnlCurrencySource = 'legacy'
  const legacyResult = aggregateMoney([legacy])
  assert(legacyResult.state === 'single-currency' && legacyResult.currencyConfidence === 'confirmed', 'explicit legacy currencies remain confirmed evidence')

  const inferred = trade('inferred', 10, 'USD')
  inferred.pnlCurrencySource = 'inferred'
  const inferredResult = aggregateMoney([inferred])
  assert(inferredResult.state === 'single-currency' && inferredResult.currencyConfidence === 'inferred', 'inferred currency remains distinct')
  assert(moneyAggregateTitle(inferredResult) === '累计盈亏（推断 USD）', 'inferred totals never claim confirmed net PnL')
}
