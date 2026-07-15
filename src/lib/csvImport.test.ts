import { finalizeTrade, mapRowToTrade, TRADE_FIELD_LIST, type FieldMapping } from '@/lib/csvImport'
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

export function testCsvMinimalContractDoesNotRequireExecutionOrStrategy(): void {
  const trade = finalizeTrade({
    symbol: 'BTCUSDT',
    side: 'long',
    openedAt: '2026-07-15',
  }, [strategy], 'TRD-3', 'trade-3')

  assert(trade !== null, 'symbol, side and date should be enough to import a planned trade')
  assert(trade?.status === 'planned', 'a CSV row without status should remain a planned trade')
  assert(trade?.strategyId === 'uncategorized', 'a missing strategy should use the canonical uncategorized id')
  assert(trade?.timeframe === undefined, 'a missing timeframe should remain unknown')
  assert(trade?.entry === null, 'a missing entry should remain unknown')
  assert(trade?.size === null, 'a missing position size should remain unknown')
}

export function testCsvResultInfersStatusWhenTheOptionalStatusColumnIsMissing(): void {
  const trade = finalizeTrade({
    symbol: 'BTCUSDT',
    side: 'long',
    openedAt: '2026-07-15',
    rMultiple: -1,
    resultSource: 'r',
  }, [strategy], 'TRD-RESULT', 'trade-result')

  assert(trade?.status === 'loss', 'an imported result should not remain planned when status is omitted')
}

export function testCsvFieldListMarksOnlyTheMinimalContractAsRequired(): void {
  const required = TRADE_FIELD_LIST
    .filter((field) => field.required)
    .map((field) => field.key)

  assert(
    JSON.stringify(required) === JSON.stringify(['symbol', 'side', 'openedAt']),
    'CSV mapping should only require symbol, side and date',
  )
}

export function testCsvBlankOptionalColumnsRemainUnknownWithoutErrors(): void {
  const mapping: FieldMapping = {
    0: 'symbol',
    1: 'side',
    2: 'status',
    3: 'strategyId',
    4: 'entry',
    5: 'size',
    6: 'openedAt',
  }
  const preview = mapRowToTrade(
    ['BTCUSDT', 'long', '', '', '', '', '2026-07-15'],
    mapping,
    0,
    [strategy],
  )

  assert(preview.errors.length === 0, 'blank optional CSV cells should not be invalid')
  const trade = finalizeTrade(preview.trade, [strategy], 'TRD-4', 'trade-4')
  assert(trade?.entry === null && trade?.size === null, 'blank execution cells should remain unknown')
  assert(trade?.strategyId === 'uncategorized', 'blank strategy cells should remain uncategorized')
}

export function testCsvLegacyZeroExecutionPlaceholdersBecomeUnknown(): void {
  const trade = finalizeTrade({
    symbol: 'BTCUSDT',
    side: 'long',
    openedAt: '2026-07-15',
    entry: 0,
    size: 0,
  }, [strategy], 'TRD-5', 'trade-5')

  assert(trade?.entry === null, 'zero entry placeholders should not enter the live store')
  assert(trade?.size === null, 'zero size placeholders should not enter the live store')
}
