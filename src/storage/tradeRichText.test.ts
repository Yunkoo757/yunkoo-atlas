import { mapTradeRichText, tradeRichTextEntries } from '@/storage/tradeRichText'
import { collectAssetIdsFromSnapshot } from '@/storage/assets'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

type IsEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false

type IsOptional<Value, Key extends keyof Value> =
  Record<never, never> extends Pick<Value, Key> ? true : false

function expectType<Condition extends true>(): void {}

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
  assert(
    !Object.prototype.hasOwnProperty.call(legacy, 'sourceNoteHtml'),
    '旧记录不能新增空字段',
  )
}

export function testMapTradeRichTextReturnsTruthfulWidenedTypes(): void {
  const mapped = mapTradeRichText(
    { id: 'case' as const, note: 'a' as const, sourceNoteHtml: 'b' as const },
    (html) => `x:${html}`,
  )
  expectType<IsEqual<typeof mapped.note, string>>()
  expectType<IsEqual<typeof mapped.sourceNoteHtml, string>>()
  expectType<IsEqual<IsOptional<typeof mapped, 'sourceNoteHtml'>, false>>()
  assert(mapped.note === 'x:a' && mapped.sourceNoteHtml === 'x:b', '必选字段转换结果不正确')

  const optionalInput: {
    id: 'optional'
    note: 'a'
    sourceNoteHtml?: 'b'
  } = { id: 'optional', note: 'a' }
  const optional = mapTradeRichText(optionalInput, (html) => `x:${html}`)
  expectType<IsEqual<typeof optional.note, string>>()
  expectType<IsEqual<typeof optional.sourceNoteHtml, string | undefined>>()
  expectType<IsEqual<IsOptional<typeof optional, 'sourceNoteHtml'>, true>>()

  const requiredMaybeUndefined: {
    id: 'required-maybe-undefined'
    note: 'a'
    sourceNoteHtml: string | undefined
  } = { id: 'required-maybe-undefined', note: 'a', sourceNoteHtml: undefined }
  const mappedRequiredMaybeUndefined = mapTradeRichText(
    requiredMaybeUndefined,
    (html) => `x:${html}`,
  )
  expectType<IsEqual<typeof mappedRequiredMaybeUndefined.sourceNoteHtml, string | undefined>>()
  expectType<
    IsEqual<IsOptional<typeof mappedRequiredMaybeUndefined, 'sourceNoteHtml'>, false>
  >()
  assert(
    Object.prototype.hasOwnProperty.call(mappedRequiredMaybeUndefined, 'sourceNoteHtml'),
    '静态必选的 undefined 来源字段仍必须保留 own property',
  )

  const legacy = mapTradeRichText(
    { id: 'legacy' as const, note: 'legacy' as const },
    (html) => `x:${html}`,
  )
  expectType<IsEqual<typeof legacy.note, string>>()
  expectType<IsEqual<'sourceNoteHtml' extends keyof typeof legacy ? true : false, false>>()
  assert(
    !Object.prototype.hasOwnProperty.call(legacy, 'sourceNoteHtml'),
    'legacy 输入运行时不得新增来源字段',
  )
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
