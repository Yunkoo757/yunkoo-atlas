import assert from 'node:assert/strict'
import { createQuickNote } from '@/data/quickNotes'
import { buildQuickNoteRecord, getNextTradeRef } from './quickNoteRecordDraft'

export function testNextTradeRefContinuesExistingSeries(): void {
  assert.equal(getNextTradeRef([], 'live'), 'TRD-1')
  assert.equal(getNextTradeRef([{ ref: 'TRD-12' }, { ref: 'CAS-3' }], 'live'), 'TRD-13')
  assert.equal(getNextTradeRef([{ ref: 'CAS-3' }, { ref: 'TRD-12' }], 'case'), 'CAS-4')
}

export function testQuickNoteBecomesPlannedLiveOrCase(): void {
  const note = { ...createQuickNote(new Date('2026-09-07T00:00:00.000Z')), contentHtml: '<p>盘前观察</p>' }
  const live = buildQuickNoteRecord({
    note,
    kind: 'live',
    id: 'live-1',
    ref: 'TRD-8',
    strategyId: 's1',
    symbol: 'xauusd',
    liveStageId: 'stage',
    now: new Date('2026-09-07T00:00:00.000Z'),
  })
  assert.equal(live.tradeKind, 'live')
  assert.equal(live.status, 'planned')
  assert.equal(live.symbol, 'XAUUSD')
  assert.equal(live.note, '<p>盘前观察</p>')

  const reviewCase = buildQuickNoteRecord({
    note,
    kind: 'case',
    id: 'case-1',
    ref: 'CAS-2',
    strategyId: 's1',
    symbol: 'eurusd',
    liveStageId: 'stage',
    now: new Date('2026-09-07T00:00:00.000Z'),
  })
  assert.equal(reviewCase.tradeKind, 'case')
  assert.equal(reviewCase.caseType, 'exemplar')
  assert.equal(reviewCase.note, '<p>盘前观察</p>')
}
