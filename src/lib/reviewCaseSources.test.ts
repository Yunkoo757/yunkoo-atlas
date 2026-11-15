import type { Trade } from '@/data/trades'
import { syncReviewCaseSourceNotes } from './reviewCaseSources'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const source = { id: 'source', tradeKind: 'live', note: '<p>最新来源</p><img src="journal-asset://new-image">' } as Trade
const own = { id: 'case', tradeKind: 'case', sourceTradeId: source.id, sourceNoteHtml: '<p>旧来源</p>', note: '<p>独立结论</p>', masteryState: 'mastered', nextReviewAt: null, activities: [] } as unknown as Trade

export function testSourceSyncPreservesAllCaseOwnedFieldsAndInputObjects(): void {
  const input = [source, own]
  const result = syncReviewCaseSourceNotes(input)
  assert(result !== input && result[0] === source, '仅受影响案例可以替换对象')
  assert(result[1]!.sourceNoteHtml === source.note, '来源文字和图片必须逐字同步')
  for (const key of Object.keys(own) as (keyof Trade)[]) {
    if (key !== 'sourceNoteHtml') assert(result[1]![key] === own[key], `案例字段 ${key} 不得被覆盖`)
  }
  assert(input[1] === own && own.sourceNoteHtml === '<p>旧来源</p>', '不得原地改写输入')
  assert(syncReviewCaseSourceNotes(result) === result, '无变化的同步必须保留数组与对象引用')
}

export function testMissingSourcesAndCaseSourcesNeverCascadeOrEraseSnapshots(): void {
  const missing = { ...own, sourceTradeId: 'missing' }
  const chained = { ...own, id: 'chained', sourceTradeId: own.id }
  const input = [own, missing, chained]
  assert(syncReviewCaseSourceNotes(input) === input, '来源不存在或为案例时保留快照，不反写、不级联')
}

export function testEmptySavedSourceIsSyncedExactly(): void {
  const result = syncReviewCaseSourceNotes([{ ...source, note: '' }, own])
  assert(result[1]!.sourceNoteHtml === '' && result[1]!.note === own.note, '空来源正文仍须同步，独立结论必须保留')
}
