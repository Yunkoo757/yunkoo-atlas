import assert from 'node:assert/strict'
import { countExpiringTradeTrash } from './trashCleanup'
import type { Trade } from '@/data/trades'

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 't1',
    ref: 'TRD-1',
    symbol: 'EURUSD',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategyId: 's1',
    tradeKind: 'live',
    liveStageId: 'stage',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 1,
    exit: null,
    size: 0,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-08-01',
    closedAt: null,
    note: '',
    ...overrides,
  }
}

export function testCountExpiringTradeTrashUsesRemainingDays(): void {
  const now = Date.now()
  const soon = new Date(now - 24 * 24 * 60 * 60 * 1000).toISOString()
  const later = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()
  const expired = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString()
  assert.equal(
    countExpiringTradeTrash([
      trade({ id: 'soon', deletedAt: soon }),
      trade({ id: 'later', deletedAt: later }),
      trade({ id: 'expired', deletedAt: expired }),
      trade({ id: 'active' }),
    ]),
    2,
  )
}
