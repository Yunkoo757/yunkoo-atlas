import { mapTradeRichText, tradeRichTextEntries } from '@/storage/tradeRichText'
import { collectAssetIdsFromSnapshot } from '@/storage/assets'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testTradeRichTextEntriesIncludesOptionalSourceSnapshot(): void {
  assert(
    tradeRichTextEntries({ note: 'case', sourceNoteHtml: 'source' }).join('|') === 'case|source',
    '必须枚举两个字段',
  )
  assert(
    tradeRichTextEntries({ note: 'legacy' }).join('|') === 'legacy',
    '旧记录不得伪造空来源字段',
  )
}

export function testMapTradeRichTextTransformsOnlyExistingFields(): void {
  const mapped = mapTradeRichText(
    { note: 'a', sourceNoteHtml: 'b' },
    (html) => `x:${html}`,
  )
  assert(
    mapped.note === 'x:a' && mapped.sourceNoteHtml === 'x:b',
    '两个字段都必须转换',
  )
  const legacy = mapTradeRichText({ note: 'a' }, (html) => `x:${html}`)
  assert(!('sourceNoteHtml' in legacy), '旧记录不能新增空字段')
}

export function testSnapshotAssetClosureIncludesCaseSourceSnapshot(): void {
  const snapshot = createFullPersistedSnapshotFixture()
  const source = snapshot.trades[0]!
  snapshot.trades.push({
    ...source,
    id: 'case-source-only',
    ref: 'CAS-SOURCE',
    tradeKind: 'case',
    sourceTradeId: source.id,
    note: '',
    sourceNoteHtml: '<img src="journal-asset://source-only">',
  })

  assert(
    collectAssetIdsFromSnapshot(snapshot).includes('source-only'),
    '来源快照附件必须进入引用集合',
  )
}
