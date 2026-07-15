import { finalizeTrade, mapRowToTrade, type FieldMapping } from '@/lib/csvImport'
import type { Strategy } from '@/data/strategies'

const strategy: Strategy = {
  id: 'strategy-1',
  name: '突破',
  icon: 'trending-up',
  color: '#5e6ad2',
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const baseMapping: FieldMapping = {
  0: 'symbol',
  1: 'side',
  2: 'status',
  3: 'strategyId',
  4: 'entry',
  5: 'exit',
  6: 'size',
  7: 'stopLoss',
  8: 'openedAt',
}

export function testCsvPricesNeverInventCashPnlWithoutContractMetadata(): void {
  const preview = mapRowToTrade(
    ['EURUSD', 'long', 'win', '突破', '1.1', '1.11', '1', '1.095', '2026-07-01'],
    baseMapping,
    0,
    [strategy],
  )
  const trade = finalizeTrade(preview.trade, [strategy], 'TRD-1', 'trade-1')

  assert(trade?.pnl === null, 'CSV price fields must not be converted to fake cash PnL')
  assert(trade?.rMultiple === 2, 'CSV prices may derive unitless R from initial risk')
  assert(trade?.resultSource === 'price', 'derived CSV R must remain traceable to prices')
  assert(trade?.initialStopLoss === 1.095, 'the imported initial risk must be frozen')
}

export function testCsvExplicitMetricBecomesTheOnlyResultAuthority(): void {
  const mapping: FieldMapping = { ...baseMapping, 9: 'pnl' }
  const preview = mapRowToTrade(
    ['EURUSD', 'long', 'win', '突破', '1.1', '1.11', '1', '1.095', '2026-07-01', '1000'],
    mapping,
    0,
    [strategy],
  )
  const trade = finalizeTrade(preview.trade, [strategy], 'TRD-2', 'trade-2')

  assert(trade?.pnl === 1000, 'explicit CSV cash PnL must be preserved')
  assert(trade?.rMultiple === null, 'an explicit cash result must not trigger inferred R')
  assert(trade?.resultSource === 'pnl', 'explicit cash PnL must become authoritative')
}

export function testCsvCanPreserveMissingEntrySizeAndTimeframe(): void {
  const trade = finalizeTrade(
    {
      symbol: 'BTCUSDT',
      side: 'long',
      status: 'planned',
      strategyId: strategy.id,
      openedAt: '2026-07-16',
    },
    [strategy],
    'TRD-3',
    'trade-3',
  )

  assert(trade?.entry === null, 'missing CSV entry must remain unknown instead of becoming zero')
  assert(trade?.size === null, 'missing CSV size must remain unknown instead of becoming zero')
  assert(trade?.timeframe === undefined, 'missing CSV timeframe must remain unset')
}
