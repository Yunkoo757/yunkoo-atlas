import assert from 'node:assert/strict'
import type { Trade } from '@/data/trades'
import { collectPerformanceCloseDayRepairIds } from './performanceCloseDayRepair'

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
    openedAt: '2026-08-01',
    closedAt: null,
    note: '',
    ...overrides,
  }
}

export function testCloseDayRepairOnlyKeepsLiveRecords(): void {
  assert.deepEqual(
    collectPerformanceCloseDayRepairIds(
      ['missing', 'paper', 'gone', 'case'],
      [
        trade({ id: 'missing' }),
        trade({ id: 'paper', tradeKind: 'paper' }),
        trade({ id: 'case', tradeKind: 'case' }),
        trade({ id: 'trashed', deletedAt: '2026-08-01T00:00:00.000Z' }),
      ],
    ),
    ['missing'],
  )
}
