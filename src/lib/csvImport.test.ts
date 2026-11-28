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

export function testCsvImportDoesNotRequireEntryOrExitPrices(): void {
  const mapping: FieldMapping = {
    0: 'symbol',
    1: 'side',
    2: 'status',
    3: 'strategyId',
    4: 'size',
    5: 'openedAt',
  }
  const preview = mapRowToTrade(
    ['EURUSD', 'long', 'open', '突破', '1', '2026-07-01'],
    mapping,
    0,
    [strategy],
  )
  const trade = finalizeTrade(preview.trade, [strategy], 'TRD-3', 'trade-3')

  assert(preview.errors.length === 0, '缺少入场/出场价不应产生导入错误')
  assert(trade?.entry === 0, '无历史入场价时应使用兼容默认值')
  assert(trade?.exit === null, '无历史出场价时应保留为空')
}

export function testCsvPreviewRequiresRealDatesAndKeepsSourceCalendarDays(): void {
  const zone = process.env.TZ
  const mapping: FieldMapping = { ...baseMapping, 9: 'closedAt' }
  try {
    process.env.TZ = 'America/Los_Angeles'
    const preview = (opened: string, closed: string) => mapRowToTrade(
      ['EURUSD', 'long', 'win', '突破', '1', '2', '1', '0.5', opened, closed], mapping, 0, [strategy],
    )
    for (const bad of ['2026-02-30', '02/30/2026', '4-31-2025', '1900年2月29日', '2026/00/15', '2026-02-30T11:00:00Z']) {
      const row = preview(bad, bad)
      assert(row.errors.length === 2 && !row.trade.openedAt && !row.trade.closedAt,
        `开仓和平仓列必须分别标记错误并保留空值：${bad}`)
    }
    for (const [source, expected] of [
      ['1989-01-01', '1989-01-01'], ['0099/1/5', '0099-01-05'], ['2-29-2024', '2024-02-29'],
      ['2024年2月29日', '2024-02-29'], ['02/29/2024', '2024-02-29'],
      ['2026-07-27T01:00:00Z', '2026-07-26'], ['July 27, 2026', '2026-07-27'],
    ]) {
      const row = preview(source, source)
      const saved = finalizeTrade(row.trade, [strategy], 'TRD-1', 'csv-calendar-test')
      assert(!row.errors.length && saved?.openedAt === expected && saved.closedAt === expected,
        `确认导入须保留 ${source} 对应的日期 ${expected}`)
    }
  } finally {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  }
}
