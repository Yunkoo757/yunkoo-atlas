import assert from 'node:assert/strict'
import { executeNotionImport, parseNotionCsv } from '@/lib/notionImport'

const baseHeaders = 'Symbol,Date,Close Date,Position,Status,Net PnL,Cash Currency'

function parseRows(rows: string[]) {
  return parseNotionCsv([baseHeaders, ...rows].join('\n'), [])
}

export function testNotionImportParsesCurrencyOnlyFromSourceMoneyFacts(): void {
  const result = parseRows([
    'CNY-ASSET,2026-08-01,2026-08-02,Buy,Closed by T/P,¥123.45,',
    'EUR-ASSET,2026-08-01,2026-08-02,Buy,Closed by T/P,€123.45,',
    'GBP-ASSET,2026-08-01,2026-08-02,Buy,Closed by T/P,£123.45,',
    'USD-ASSET,2026-08-01,2026-08-02,Buy,Closed by T/P,USD 123.45,',
    'BTCUSDT,2026-08-01,2026-08-02,Buy,Closed by T/P,123.45,',
  ])

  assert.deepEqual(
    result.previews.map((preview) => ({
      pnl: preview.trade.pnl,
      cashCurrency: preview.trade.cashCurrency,
    })),
    [
      { pnl: 123.45, cashCurrency: 'CNY' },
      { pnl: 123.45, cashCurrency: 'EUR' },
      { pnl: 123.45, cashCurrency: 'GBP' },
      { pnl: 123.45, cashCurrency: 'USD' },
      { pnl: 123.45, cashCurrency: null },
    ],
  )
}

export function testNotionImportNormalizesOnlyIsoCurrencyDeclaredByTheSource(): void {
  const result = parseRows([
    'BTCUSDT,2026-08-01,2026-08-02,Buy,Closed by T/P,123.45, usd ',
    'EURUSD,2026-08-01,2026-08-02,Buy,Closed by T/P,123.45,US dollars',
    'AUDUSD,2026-08-01,2026-08-02,Buy,Closed by T/P,AUD 123.45,',
    'DOLLAR,2026-08-01,2026-08-02,Buy,Closed by T/P,$123.45,',
  ])

  assert.deepEqual(
    result.previews.map((preview) => ({
      pnl: preview.trade.pnl,
      cashCurrency: preview.trade.cashCurrency,
    })),
    [
      { pnl: 123.45, cashCurrency: 'USD' },
      { pnl: 123.45, cashCurrency: null },
      { pnl: 123.45, cashCurrency: 'AUD' },
      { pnl: 123.45, cashCurrency: null },
    ],
  )
}

export function testNotionImportUsesTheCurrentActiveIsoCurrencySnapshot(): void {
  const result = parseRows([
    'ZWG,2026-08-01,2026-08-02,Buy,Closed by T/P,ZWG 123.45,',
    'ZWL,2026-08-01,2026-08-02,Buy,Closed by T/P,ZWL 123.45,',
    'NOT-ISO,2026-08-01,2026-08-02,Buy,Closed by T/P,ABC 123.45,',
  ])

  assert.deepEqual(
    result.previews.map((preview) => ({
      pnl: preview.trade.pnl,
      cashCurrency: preview.trade.cashCurrency,
    })),
    [
      { pnl: 123.45, cashCurrency: 'ZWG' },
      { pnl: 123.45, cashCurrency: null },
      { pnl: 123.45, cashCurrency: null },
    ],
  )
}

export function testNotionTerminalTradeWithoutSourceCloseDateStaysPending(): void {
  const result = parseRows([
    'BTCUSDT,2026-08-01,,Buy,Closed by T/P,USD 20,',
  ])
  const preview = result.previews[0]!

  assert.equal(preview.trade.closedAt, null)
  assert.equal(Object.prototype.hasOwnProperty.call(preview.trade, 'closedTradingDayKey'), false)

  const imported = executeNotionImport(result.previews, [], [], { tradeKind: 'live' }).trades[0]!
  assert.equal(imported.closedAt, null)
  assert.equal(imported.closedTradingDayKey, undefined)
  assert.equal(imported.cashCurrency, 'USD')
}

export function testNotionImportPreservesOnlyValidSourceCloseDates(): void {
  const result = parseRows([
    'VALID,2026-08-01,2026-08-03,Buy,Closed by T/P,€20,',
    'INVALID,2026-08-01,02/30/2026,Buy,Closed by T/P,£20,',
  ])

  assert.deepEqual(
    result.previews.map((preview) => preview.trade.closedAt),
    ['2026-08-03', null],
  )
  assert.deepEqual(
    executeNotionImport(result.previews, [], [], { tradeKind: 'live' }).trades.map((trade) => trade.closedAt),
    ['2026-08-03', null],
  )
}

export function testNotionCaseReviewDateUsesConfiguredBusinessDayBoundary(): void {
  const result = parseRows([
    'BTCUSDT,2026-08-01,,Buy,Open,0,USD',
  ])
  const beforeBoundary = executeNotionImport(result.previews, [], [], {
    tradeKind: 'case',
    now: new Date(2026, 7, 12, 5, 30),
    tradingDayStartHour: 6,
  }).trades[0]!
  const afterBoundary = executeNotionImport(result.previews, [], [], {
    tradeKind: 'case',
    now: new Date(2026, 7, 12, 6, 30),
    tradingDayStartHour: 6,
  }).trades[0]!
  const accountTrade = executeNotionImport(result.previews, [], [], {
    tradeKind: 'live',
    now: new Date(2026, 7, 12, 5, 30),
    tradingDayStartHour: 6,
  }).trades[0]!

  assert.equal(beforeBoundary.nextReviewAt, '2026-08-14')
  assert.equal(afterBoundary.nextReviewAt, '2026-08-15')
  assert.equal(accountTrade.nextReviewAt, undefined)
}
