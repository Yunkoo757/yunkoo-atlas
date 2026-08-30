import assert from 'node:assert/strict'
import type { Trade } from '@/data/trades'
import {
  buildTradeRowContext,
  resolveTradeRowResultPresentation,
} from '@/lib/tradeRowPresentation'

function fixture(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'row-presentation',
    ref: 'TRD-ROW',
    symbol: 'EURUSD',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy-1',
    session: 'London Open',
    timeframe: '4H',
    tags: ['伦敦开盘', '普通标签'],
    mistakeTags: ['追单', '过早入场'],
    reviewStatus: 'reviewed',
    reviewCategory: 'focus',
    tradeKind: 'live',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 100,
    cashCurrency: 'USD',
    rMultiple: null,
    resultSource: 'pnl',
    openedAt: '2026-08-20T09:00:00.000Z',
    closedAt: '2026-08-20T10:00:00.000Z',
    note: '',
    comments: [],
    activities: [],
    ...overrides,
  } as Trade
}

export async function testTradeRowContextUsesOneStablePriorityOrder(): Promise<void> {
  const items = buildTradeRowContext(fixture())
  assert.deepEqual(
    items.map((item) => [item.kind, item.label]),
    [
      ['session', '伦敦开盘'],
      ['mistake', '追单'],
      ['mistake', '过早入场'],
      ['review', '重点'],
      ['tag', '普通标签'],
    ],
  )
}

export async function testTradeRowResultsDistinguishMissingZeroAndUncollected(): Promise<void> {
  const pnlOnly = resolveTradeRowResultPresentation(fixture({ pnl: 0, status: 'breakeven' }), null, false)
  assert.deepEqual(pnlOnly.cash, { text: '$0', state: 'zero' })
  assert.deepEqual(pnlOnly.r, { text: '—', state: 'not-collected' })

  const missing = resolveTradeRowResultPresentation(
    fixture({ pnl: null, rMultiple: null, resultSource: undefined, status: 'breakeven' }),
    null,
    false,
  )
  assert.deepEqual(missing.cash, { text: '待补', state: 'missing' })
  assert.deepEqual(missing.r, { text: '待补', state: 'missing' })
}

export async function testTradeRowPrivacyKeepsRAndNeverLeaksCash(): Promise<void> {
  const result = resolveTradeRowResultPresentation(
    fixture({ pnl: 1250, rMultiple: 2.5, resultSource: 'imported' }),
    null,
    true,
  )
  assert.equal(result.cash.state, 'masked')
  assert.equal(result.cash.text, '****')
  assert.equal(result.r.text, '+2.5R')
  assert(!result.accessibleSummary.includes('1250'))
}

export async function testTradeRowConflictPreservesValuesWithoutOutcomeAuthority(): Promise<void> {
  const result = resolveTradeRowResultPresentation(
    fixture({ status: 'win', pnl: -100, rMultiple: 2, resultSource: 'imported' }),
    null,
    false,
  )
  assert.equal(result.integrity, 'conflict')
  assert.equal(result.cash.text, '-$100')
  assert.equal(result.r.text, '+2.0R')
  assert.equal(result.cash.state, 'conflict')
  assert.equal(result.r.state, 'conflict')
}
