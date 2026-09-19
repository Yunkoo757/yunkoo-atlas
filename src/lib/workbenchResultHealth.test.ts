import assert from 'node:assert/strict'
import type { Trade } from '@/data/trades'
import { collectWorkbenchResultRepairIds } from './workbenchResultHealth'

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 't1',
    ref: 'TRD-1',
    symbol: 'EURUSD',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 's1',
    tradeKind: 'live',
    liveStageId: 'stage',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 1,
    exit: 2,
    size: 1,
    pnl: 10,
    rMultiple: 2,
    resultSource: 'imported',
    openedAt: '2026-08-01',
    closedAt: '2026-08-01',
    note: '',
    ...overrides,
  }
}

export function testWorkbenchResultRepairSkipsCasesAndOpenTrades(): void {
  const ids = collectWorkbenchResultRepairIds([
    trade({ id: 'complete' }),
    trade({ id: 'missing', status: 'win', pnl: null, rMultiple: null, resultSource: undefined }),
    trade({ id: 'conflict', status: 'win', pnl: -10, rMultiple: 2, resultSource: 'imported' }),
    trade({ id: 'open', status: 'open', pnl: null, rMultiple: null, closedAt: null }),
    trade({ id: 'case', tradeKind: 'case', status: 'win', pnl: null, rMultiple: null }),
    trade({ id: 'trashed', deletedAt: '2026-08-01T00:00:00.000Z', pnl: null, rMultiple: null }),
  ])
  assert.deepEqual(ids, ['missing', 'conflict'])
}
