import type { Trade } from '@/data/trades'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import type { PersistedSnapshot } from '@/storage/types'
import { assertValidV7Snapshot } from '@/storage/schemaV7'
import { migrateV6ToV7 } from '@/storage/migrations/v6ToV7'

const baseTrade: Trade = {
  id: 'trade-1',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'breakout',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  tradeKind: 'live',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 10,
  rMultiple: 2,
  resultSource: 'imported',
  openedAt: '2026-07-01',
  closedAt: '2026-07-02',
  note: '',
}

function fixtureSnapshot(trades: Trade[] = [baseTrade]): PersistedSnapshot {
  return {
    trades,
    strategies: [{
      id: 'breakout',
      name: '突破',
      icon: 'trending-up',
      color: '#5e6ad2',
      reviewTemplateHtml: '<p>复盘模板</p>',
    }],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY },
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testV6ToV7MigrationIsDeterministicAndDoesNotMutateSource(): void {
  const raw = fixtureSnapshot()
  const before = JSON.stringify(raw)
  const first = migrateV6ToV7(raw)
  const second = migrateV6ToV7(raw)

  assert(JSON.stringify(first) === JSON.stringify(second), 'migration output and diagnostics must be deterministic')
  assert(JSON.stringify(raw) === before, 'migration must never mutate the v6 source')
  assertValidV7Snapshot(first.snapshot)
}

export function testV6ToV7KeepsRealBreakevenZeroAndClearsPlaceholderZeros(): void {
  const raw = fixtureSnapshot([
    { ...baseTrade, id: 'placeholder', status: 'planned', entry: 0, size: 0, pnl: 0, rMultiple: 0, closedAt: null },
    { ...baseTrade, id: 'breakeven', status: 'breakeven', entry: 0, size: 0, pnl: 0, rMultiple: 0 },
  ])
  const result = migrateV6ToV7(raw)
  const placeholder = result.snapshot.trades[0]!
  const breakeven = result.snapshot.trades[1]!

  assert(placeholder.entry === null && placeholder.size === null, 'entry and size zero are always unknown')
  assert(placeholder.pnl === null && placeholder.rMultiple === null, 'non-breakeven result zero is a placeholder')
  assert(breakeven.entry === null && breakeven.size === null, 'breakeven does not make entry or size zero valid')
  assert(breakeven.pnl === 0 && breakeven.rMultiple === 0, 'explicit breakeven keeps real result zeros')
  assert(result.diagnostics.filter((item) => item.tradeId === 'placeholder').length === 2, 'cleared result zeros need stable diagnostics')
}

export function testV6ToV7PreservesTimeframeAndDateEvidenceWithoutTimezoneConversion(): void {
  const raw = fixtureSnapshot([
    { ...baseTrade, id: 'unknown-timeframe', timeframe: undefined, openedAt: '2026-07-01', closedAt: '2026-07-02' },
    { ...baseTrade, id: 'known-timeframe', timeframe: '4H', openedAt: '2026-07-01T23:30:00-02:00', closedAt: '2026-07-02T00:30:00+08:00' },
  ])
  const result = migrateV6ToV7(raw)

  assert(result.snapshot.reportingTimeZone === null, 'legacy libraries must not guess a reporting timezone')
  assert(result.snapshot.trades[0]?.timeframe === undefined, 'missing timeframe must stay unknown')
  assert(result.snapshot.trades[1]?.timeframe === '4H', 'explicit 4H must remain explicit')
  assert(result.snapshot.trades[1]?.openedAt === '2026-07-01', 'opened business date uses the original prefix')
  assert(result.snapshot.trades[1]?.openedAtTimestamp === '2026-07-01T23:30:00-02:00', 'opened timestamp preserves the original ISO string')
  assert(result.snapshot.trades[1]?.closedAt === '2026-07-02', 'closed business date uses the original prefix')
  assert(result.snapshot.trades[1]?.closedAtTimestamp === '2026-07-02T00:30:00+08:00', 'closed timestamp preserves the original ISO string')
}

export function testV6ToV7MakesCurrencyProvenanceAndStrategyV1Explicit(): void {
  const explicitCurrency = { ...baseTrade, id: 'explicit' } as Trade & { pnlCurrency?: string }
  explicitCurrency.pnlCurrency = 'EUR'
  const raw = fixtureSnapshot([
    explicitCurrency,
    { ...baseTrade, id: 'inferred-usd' },
    { ...baseTrade, id: 'no-money', pnl: null },
    { ...baseTrade, id: 'unknown-strategy', strategyId: 'missing' },
  ])
  let message = ''
  try {
    migrateV6ToV7(raw)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('missing strategy'), 'orphan strategy references must fail explicitly')

  const result = migrateV6ToV7({ ...raw, trades: raw.trades.slice(0, 3) })
  const [explicit, inferred, noMoney] = result.snapshot.trades

  assert(explicit?.pnlCurrency === 'EUR' && explicit.pnlCurrencySource === 'legacy', 'explicit legacy currency is preserved')
  assert(inferred?.pnlCurrency === 'USD' && inferred.pnlCurrencySource === 'inferred', 'current fixed-dollar legacy amount is marked inferred USD')
  assert(noMoney?.pnlCurrency === null && noMoney.pnlCurrencySource === null, 'records without money must not invent a currency')
  assert(result.snapshot.strategyVersions[0]?.id === 'breakout:v1', 'legacy strategy gets deterministic v1')
  assert(result.snapshot.strategyVersions[0]?.createdAt === null, 'legacy strategy creation time stays unknown')
  assert(result.snapshot.strategyVersions[0]?.reviewTemplateHtml === '<p>复盘模板</p>', 'review template is copied into v1')
  assert(result.snapshot.strategies[0]?.currentVersionId === 'breakout:v1', 'strategy points to its v1')
  assert(explicit?.strategyVersionId === 'breakout:v1', 'known strategy trades bind to v1')
}

export function testV7ValidatorRejectsBrokenStrategyVersionReferences(): void {
  const snapshot = migrateV6ToV7(fixtureSnapshot()).snapshot
  snapshot.trades[0] = { ...snapshot.trades[0]!, strategyVersionId: 'other:v1' }

  let message = ''
  try {
    assertValidV7Snapshot(snapshot)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('strategyVersionId'), 'broken trade strategy version references must be rejected')
}

export function testV7ValidatorEnforcesRiskCostAndCurrencyRelations(): void {
  const baseline = migrateV6ToV7(fixtureSnapshot()).snapshot
  const errorFor = (mutate: (snapshot: typeof baseline) => void): string => {
    const snapshot = structuredClone(baseline)
    mutate(snapshot)
    try {
      assertValidV7Snapshot(snapshot)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  assert(errorFor((snapshot) => {
    Object.assign(snapshot.trades[0]!, {
      initialRiskAmount: 100,
      accountEquityAtEntry: 10_000,
      initialRiskPct: 10,
    })
  }) === '', 'risk result conflicts are accepted for later quality diagnostics')

  assert(errorFor((snapshot) => {
    snapshot.trades[0]!.costs = {
      commission: null,
      exchange: 0,
      financing: 0,
      tax: 0,
      other: 0,
      completeness: 'complete',
    }
  }).includes('costs'), 'complete costs cannot contain unknown components')

  assert(errorFor((snapshot) => {
    snapshot.trades[0]!.pnlCurrencySource = null
  }).includes('pnlCurrencySource'), 'a known currency requires provenance')

  assert(errorFor((snapshot) => {
    Object.assign(snapshot.trades[0]!, {
      grossPnl: 20,
      pnl: 10,
      pnlBasis: 'net',
      costs: {
        commission: 2,
        exchange: 0,
        financing: 0,
        tax: 0,
        other: 0,
        completeness: 'complete',
      },
    })
  }) === '', 'gross/net/cost conflicts are accepted for later quality diagnostics')
}
