import {
  JsonAttachmentBudget,
  JsonImportBudgetError,
  MAX_JSON_FILE_BYTES,
  MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES,
  MAX_JSON_TOTAL_ATTACHMENT_DECODED_BYTES,
  MAX_JSON_TOTAL_ENTITIES,
  assertJsonEntityBudget,
  assertJsonFileByteBudget,
  estimateBase64DecodedBytes,
  estimatePrettyJsonUtf8Bytes,
  readJsonImportFile,
  utf8ByteLength,
} from '@/lib/importLimits'
import { parseImportJson, serializeJsonExportPayload } from '@/lib/importExport'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function errorCode(run: () => void): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof JsonImportBudgetError ? error.code : 'unexpected-error'
  }
}

function encodedShape(decodedBytes: number): { length: number; padding: 0 | 1 | 2 } {
  return {
    length: Math.ceil(decodedBytes / 3) * 4,
    padding: ((3 - (decodedBytes % 3)) % 3) as 0 | 1 | 2,
  }
}

function jsonWithOneAttachment(decodedBytes: number): string {
  const shape = encodedShape(decodedBytes)
  const data = `${'A'.repeat(shape.length - shape.padding)}${'='.repeat(shape.padding)}`
  return JSON.stringify({
    version: 8,
    trades: [{
      id: 'boundary-trade', ref: 'BOUNDARY', symbol: 'BTCUSDT', side: 'long', status: 'win',
      conviction: 'medium', strategyId: 'boundary-strategy', tradeKind: 'live', tags: [], mistakeTags: [],
      reviewStatus: 'reviewed', entry: 1, exit: 2, size: 1, pnl: 1, rMultiple: 1,
      openedAt: '2026-01-01', closedAt: '2026-01-01', note: '<img src="journal-asset://boundary-asset">',
    }],
    strategies: [{ id: 'boundary-strategy', name: 'Boundary', icon: 'target', color: '#000000' }],
    starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: {},
    assets: [{ id: 'boundary-asset', mime: 'image/png', data }],
  })
}

export async function testJsonFileBudgetChecksLimitMinusOneLimitAndLimitPlusOneBeforeRead(): Promise<void> {
  for (const size of [MAX_JSON_FILE_BYTES - 1, MAX_JSON_FILE_BYTES]) {
    let reads = 0
    const text = await readJsonImportFile({ size, text: async () => { reads += 1; return '{}' } })
    assert(text === '{}' && reads === 1, `允许的 ${size} bytes 文件必须读取一次`)
  }

  let reads = 0
  let code = ''
  try {
    await readJsonImportFile({
      size: MAX_JSON_FILE_BYTES + 1,
      text: async () => { reads += 1; return '{}' },
    })
  } catch (error) {
    code = error instanceof JsonImportBudgetError ? error.code : ''
  }
  assert(code === 'json-file-too-large', 'limit+1 必须返回稳定文件超限 code')
  assert(reads === 0, '文件超限时不得调用 file.text()')
  assertJsonFileByteBudget(MAX_JSON_FILE_BYTES)
  assert(errorCode(() => assertJsonFileByteBudget(MAX_JSON_FILE_BYTES + 1)) === 'json-file-too-large', '纯文件预算门也必须拒绝 limit+1')
}

export function testJsonEntityBudgetCountsEveryTopLevelCollectionAtBoundaries(): void {
  assertJsonEntityBudget({ trades: new Array(MAX_JSON_TOTAL_ENTITIES - 1), strategies: ['one'] })
  assertJsonEntityBudget({ trades: new Array(MAX_JSON_TOTAL_ENTITIES) })
  assert(
    errorCode(() => assertJsonEntityBudget({ trades: new Array(MAX_JSON_TOTAL_ENTITIES), assets: ['one'] })) === 'json-entity-limit',
    '所有顶层数组必须合计，limit+1 返回稳定实体超限 code',
  )
  assertJsonEntityBudget({ trades: new Array(MAX_JSON_TOTAL_ENTITIES - 1), symbolIcons: { BTC: 'icon' } })
  assert(
    errorCode(() => assertJsonEntityBudget({ trades: new Array(MAX_JSON_TOTAL_ENTITIES), shortcuts: { save: {} } })) === 'json-entity-limit',
    '顶层 map 集合也必须计入实体预算',
  )
}

export function testJsonAttachmentBudgetsCoverExactDecodedBoundariesWithoutDecoding(): void {
  const below = encodedShape(MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES - 1)
  const exact = encodedShape(MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES)
  const above = encodedShape(MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES + 1)
  assert(estimateBase64DecodedBytes(below.length, below.padding) === MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES - 1, '单附件 limit-1 估算必须精确')
  assert(estimateBase64DecodedBytes(exact.length, exact.padding) === MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES, '单附件 limit 估算必须精确')
  new JsonAttachmentBudget().add(below.length, below.padding)
  const budget = new JsonAttachmentBudget()
  budget.add(exact.length, exact.padding)
  assert(errorCode(() => new JsonAttachmentBudget().add(above.length, above.padding)) === 'json-single-asset-too-large', '单附件 limit+1 必须拒绝')

  const total = new JsonAttachmentBudget()
  const first = encodedShape(MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES)
  const remainder = encodedShape(MAX_JSON_TOTAL_ATTACHMENT_DECODED_BYTES - MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES)
  total.add(first.length, first.padding)
  const remainderMinusOne = encodedShape(
    MAX_JSON_TOTAL_ATTACHMENT_DECODED_BYTES - MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES - 1,
  )
  const totalBelow = new JsonAttachmentBudget()
  totalBelow.add(first.length, first.padding)
  totalBelow.add(remainderMinusOne.length, remainderMinusOne.padding)
  total.add(remainder.length, remainder.padding)
  const oneByte = encodedShape(1)
  assert(errorCode(() => total.add(oneByte.length, oneByte.padding)) === 'json-total-assets-too-large', '附件总量 limit+1 必须拒绝')
}

export function testJsonParserEnforcesSingleAttachmentLimitMinusOneLimitAndLimitPlusOne(): void {
  const below = parseImportJson(jsonWithOneAttachment(MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES - 1))
  assert(below.ok, 'parser 必须接受单附件 limit-1')
  const exact = parseImportJson(jsonWithOneAttachment(MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES))
  assert(exact.ok, 'parser 必须接受单附件 limit')
  const above = parseImportJson(jsonWithOneAttachment(MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES + 1))
  assert(!above.ok && above.code === 'json-single-asset-too-large', 'parser 必须在 decode 前拒绝单附件 limit+1')
}

export function testPrettyJsonByteEstimatorMatchesTheActualWriterWithoutAllocatingTheWholeDocument(): void {
  const representative = {
    ascii: 'quote " slash \\',
    chinese: '中文与🙂',
    controls: '\n\t\u0000',
    omitted: undefined,
    array: [1, undefined, null, true, Number.NaN],
    nested: { empty: {}, list: ['a', '乙'] },
  }
  const actual = JSON.stringify(representative, null, 2)
  assert(
    estimatePrettyJsonUtf8Bytes(representative) === utf8ByteLength(actual),
    'stringify 前预估必须与实际 pretty JSON 的 UTF-8 bytes 完全一致',
  )
  const circular: { self?: unknown } = {}
  circular.self = circular
  assert(errorCode(() => estimatePrettyJsonUtf8Bytes(circular)) === 'json-contract-invalid', '循环对象必须在 stringify 前拒绝')
}

export function testJsonParserAndWriterExposeStableCodesAndOneSharedByteBudget(): void {
  const invalidJson = parseImportJson('{')
  assert(!invalidJson.ok && invalidJson.code === 'json-contract-invalid', '语法错误必须返回稳定合同 code')

  const invalidBase64 = parseImportJson(JSON.stringify({
    version: 8,
    trades: [{
      id: 'asset-trade', ref: 'ASSET-TRADE', symbol: 'BTCUSDT', side: 'long', status: 'win',
      conviction: 'medium', strategyId: 's', tradeKind: 'live', tags: [], mistakeTags: [],
      reviewStatus: 'reviewed', entry: 1, exit: 2, size: 1, pnl: 1, rMultiple: 1,
      openedAt: '2026-01-01', closedAt: '2026-01-01', note: '<img src="journal-asset://bad">',
    }],
    strategies: [{ id: 's', name: 'S', icon: 'x', color: '#000' }],
    starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: {},
    assets: [{ id: 'bad', mime: 'image/png', data: '!!!!' }],
  }))
  assert(!invalidBase64.ok && invalidBase64.code === 'json-invalid-base64', '损坏附件必须返回稳定 Base64 code')

  const entityOverflow = { version: 8, trades: new Array(MAX_JSON_TOTAL_ENTITIES + 1).fill(null) }
  const rejectedImport = parseImportJson(JSON.stringify(entityOverflow))
  assert(!rejectedImport.ok && rejectedImport.code === 'json-entity-limit', 'parser 必须在合同解码前拒绝实体超限')
  assert(
    errorCode(() => serializeJsonExportPayload(entityOverflow)) === 'json-entity-limit',
    'writer 必须拒绝 importer 无法重新导入的实体超限 JSON',
  )

  const json = serializeJsonExportPayload({ version: 8, label: '中文' })
  assert(utf8ByteLength(json) === new TextEncoder().encode(json).length, 'writer 必须按 UTF-8 bytes 而不是 UTF-16 字符计数')
  assert(MAX_JSON_TOTAL_ATTACHMENT_DECODED_BYTES > MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES, '总附件预算必须允许多个合规附件')

  const orphan = {
    version: 8,
    trades: [], strategies: [], starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: {},
    assets: [{ id: 'orphan', mime: 'image/png', data: 'AAAA' }],
  }
  assert(errorCode(() => serializeJsonExportPayload(orphan)) === 'json-contract-invalid', 'writer 必须在生成前拒绝 importer 会拒绝的孤儿附件')
}
// Quality-Scenario: I-JSON-BASE64
// Quality-Scenario: I-JSON-WRITER
