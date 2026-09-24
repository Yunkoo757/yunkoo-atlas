import assert from 'node:assert/strict'
import type { Trade } from '@/data/trades'
import { createQuickNote, textFromQuickNoteHtml } from '@/data/quickNotes'
import { matchesSearchQuery } from '@/lib/tradeFilters'
import { findIndexedCommandMatches, indexCommandNote, indexCommandTrade } from './commandPaletteIndex'

function trade(id: string, note: string): Trade {
  return {
    id, ref: `TRD-${id}`, symbol: 'EURUSD', strategyId: 's1', side: 'long', status: 'win',
    conviction: 'medium', tags: ['回调', 'London'], mistakeTags: [], reviewStatus: 'reviewed',
    reviewCategory: 'normal', tradeKind: 'live', entry: 1, exit: 2, size: 1, pnl: 10,
    rMultiple: 1, openedAt: '2026-09-01', closedAt: '2026-09-01', note,
  }
}

export function testIndexedSearchPreservesTextSearchSemanticsAndSourceOrder() {
  const trades = [
    trade('first', '<p>价格 &amp; 流动性 <strong>确认</strong></p>'),
    trade('second', '<p>等待&#x786e;&#35748;<br>Momentum</p>'),
    trade('third', ''),
  ]
  const entries = trades.map((item) => indexCommandTrade(item, '结构 Strategy'))
  for (const query of ['eurusd', '  STRATEGY london ', 'EURUSD 确认', '& 流动性', 'momentum', '不存在', 'trd-first']) {
    const expected = trades.filter((item) => matchesSearchQuery(query,
      item.ref, item.symbol, '结构 Strategy', item.tags.join(' '), textFromQuickNoteHtml(item.note),
    ))
    assert.deepEqual(findIndexedCommandMatches(entries, query), expected, query)
  }
  assert.deepEqual(findIndexedCommandMatches(entries, ' '), [])
}

export function testIndexReusesUnchangedTextButInvalidatesEditedTradeAndRenamedStrategy() {
  let reads = 0
  const item = trade('source', '<p>first note</p>')
  Object.defineProperty(item, 'note', { enumerable: true, get: () => { reads += 1; return '<p>first note</p>' } })
  const original = indexCommandTrade(item, 'Original')
  assert.equal(reads, 1)
  for (let i = 0; i < 10; i += 1) {
    assert.equal(indexCommandTrade(item, 'Original'), original)
    assert.equal(findIndexedCommandMatches([original], 'first').length, 1)
  }
  assert.equal(reads, 1, 'query changes must not reparse unchanged HTML')
  const renamed = indexCommandTrade(item, 'Renamed')
  assert.deepEqual(findIndexedCommandMatches([renamed], 'original'), [])
  assert.deepEqual(findIndexedCommandMatches([renamed], 'renamed'), [item])
  const edited = { ...item, note: '<p>replacement body</p>' }
  const editedIndex = indexCommandTrade(edited, 'Renamed')
  assert.deepEqual(findIndexedCommandMatches([editedIndex], 'first'), [])
  assert.deepEqual(findIndexedCommandMatches([editedIndex], 'replacement'), [edited])
}

export function testNoteIndexInvalidatesContentAndTitleWithoutChangingMatchRules() {
  const note = { ...createQuickNote(new Date('2026-09-01')), title: '交易提醒', contentHtml: '<p>Risk &amp; Reward</p>' }
  const entry = indexCommandNote(note)
  assert.equal(indexCommandNote(note), entry)
  assert.deepEqual(findIndexedCommandMatches([entry], '提醒 reward'), [note])
  const edited = { ...note, title: '新标题', contentHtml: '<p>等待确认</p>' }
  const editedEntry = indexCommandNote(edited)
  assert.deepEqual(findIndexedCommandMatches([editedEntry], 'reward'), [])
  assert.deepEqual(findIndexedCommandMatches([editedEntry], '新标题 确认'), [edited])
}
