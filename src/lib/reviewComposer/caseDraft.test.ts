import assert from 'node:assert/strict'
import { buildComposerReviewCase, composerSideFromState, composerTextToNoteHtml } from './caseDraft'

export function testComposerTextBecomesParagraphHtml(): void {
  assert.equal(composerTextToNoteHtml('  '), '')
  assert.equal(
    composerTextToNoteHtml('第一段\n换行\n\n第二段 <b>'),
    '<p>第一段<br>换行</p><p>第二段 &lt;b&gt;</p>',
  )
}

export function testComposerReviewCaseUsesGeneratedNote(): void {
  const created = buildComposerReviewCase({
    id: 'case-1',
    ref: 'CAS-3',
    symbol: 'xauusd',
    side: 'short',
    strategyId: 'nav-1',
    openedAt: '2026-09-01',
    noteHtml: '<p>复盘正文</p>',
    liveStageId: 'stage',
    now: new Date('2026-09-07T00:00:00.000Z'),
  })
  assert.equal(created.tradeKind, 'case')
  assert.equal(created.symbol, 'XAUUSD')
  assert.equal(created.side, 'short')
  assert.equal(created.note, '<p>复盘正文</p>')
  assert.equal(created.caseType, 'exemplar')
  assert.equal(composerSideFromState('long'), 'long')
}
