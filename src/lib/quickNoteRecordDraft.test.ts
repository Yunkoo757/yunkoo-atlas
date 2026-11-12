import assert from 'node:assert/strict'
import { createQuickNote } from '@/data/quickNotes'
import { buildQuickNoteRecord, getNextTradeRef } from './quickNoteRecordDraft'
import { applyCaseClassificationMutation } from './reviewCaseClassification'
import { buildReviewAssessmentPatch, buildReviewSessionPool, DEFAULT_REVIEW_SESSION_FILTERS } from './reviewSession'

export function testNextTradeRefContinuesExistingSeries(): void {
  assert.equal(getNextTradeRef([], 'live'), 'TRD-1')
  assert.equal(getNextTradeRef([{ ref: 'TRD-12' }, { ref: 'CAS-3' }], 'live'), 'TRD-13')
  assert.equal(getNextTradeRef([{ ref: 'CAS-3' }, { ref: 'TRD-12' }], 'case'), 'CAS-4')
  const imported = [{ ref: 'CAS-0040' }, { ref: 'CAS-2' }, { ref: 'TRD-100' }, { ref: 'CAS-invalid' }, { ref: 'CAS-200-extra' }]
  assert.equal(getNextTradeRef(imported, 'case'), 'CAS-41')
  assert.equal(getNextTradeRef(imported, 'live'), 'TRD-101')
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

export function testQuickNoteCaseKeepsNormalReviewSchedulingAndClassification(): void {
  const now = new Date(2026, 8, 7, 12)
  const note = { ...createQuickNote(now), contentHtml: '<p>只等待结构确认，暂不追价。</p><img src="journal-asset://note-chart">' }
  const reviewCase = buildQuickNoteRecord({ note, kind: 'case', id: 'note-case', ref: 'CAS-41', strategyId: 'strategy', symbol: 'eurusd', liveStageId: 'stage', now, tradingDayStartHour: 0 })
  assert.equal(reviewCase.caseType, 'exemplar')
  assert.equal(reviewCase.masteryState, 'new')
  assert.equal(reviewCase.nextReviewAt, '2026-09-10')
  assert.equal(reviewCase.reviewStatus, 'unreviewed')
  assert.equal(reviewCase.note, note.contentHtml)
  const filters = { ...DEFAULT_REVIEW_SESSION_FILTERS, includeLiveTrades: false, includePaperTrades: false }
  const context = { liveStages: [], currentLiveStageId: 'stage' }
  assert.equal(buildReviewSessionPool([reviewCase], filters, new Set(), '2026-09-09', 0, context).length, 0)
  assert.equal(buildReviewSessionPool([reviewCase], filters, new Set(), '2026-09-10', 0, context)[0]?.id, reviewCase.id)
  const assessed = applyCaseClassificationMutation(reviewCase, buildReviewAssessmentPatch(reviewCase, 'mastered', now, 0))
  assert(assessed.ok)
  assert.equal(assessed.trade.caseType, 'exemplar')
  assert.equal(assessed.trade.masteryState, 'mastered')
  assert.equal(assessed.trade.reviewStatus, 'reviewed')
  assert.equal(assessed.trade.nextReviewAt, null)
  assert.equal(buildReviewSessionPool([assessed.trade], filters, new Set(), '2026-09-10', 0, context).length, 0)
  assert.equal(buildReviewSessionPool([assessed.trade], { ...filters, reviewTiming: 'all' }, new Set(), '2026-09-10', 0, context).length, 1)
  assert.equal(note.contentHtml, '<p>只等待结构确认，暂不追价。</p><img src="journal-asset://note-chart">')
}
