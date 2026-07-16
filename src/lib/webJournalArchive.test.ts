import JSZip from 'jszip'
import { SCHEMA_VERSION, type PersistedSnapshot } from '@/storage/types'
import { buildWebJournalArchiveBlob } from '@/lib/importExport'
import {
  MAX_WEB_JOURNAL_ENTRY_BYTES,
  WEB_JOURNAL_EXPORT_VERSION,
  WebJournalArchiveError,
  parseWebJournalArchive,
} from '@/lib/webJournalArchive'

const CENTRAL_DIRECTORY_ENTRY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function makePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: WEB_JOURNAL_EXPORT_VERSION,
    trades: [
      {
        id: 'trade-1',
        ref: 'TRD-1',
        symbol: 'BTCUSDT',
        side: 'long',
        status: 'planned',
        conviction: 'medium',
        strategyId: 'strategy-1',
        tags: [' 突破 ', '重点'],
        mistakeTags: [],
        reviewStatus: 'unreviewed',
        reviewCategory: 'normal',
        tradeKind: 'live',
        entry: 100,
        exit: null,
        size: 1,
        pnl: null,
        rMultiple: null,
        openedAt: '2026-07-16T08:00:00.000Z',
        closedAt: null,
        note: '',
      },
    ],
    strategies: [
      {
        id: 'strategy-1',
        name: '趋势突破',
        icon: 'target',
        color: '#5e6ad2',
      },
    ],
    starredIds: ['trade-1'],
    subscribedIds: [],
    pinnedStrategyIds: ['strategy-1'],
    display: {
      hideClosed: false,
      showEmptyGroups: false,
      groupByStrategy: false,
      groupByDate: true,
      sortBy: 'date',
      sidebarPins: ['active'],
      sidebarWorkspaceItems: [],
    },
    tagPresets: ['重点', ' 突破 '],
    mistakeTagPresets: ['追涨'],
    profile: {
      avatarId: null,
      displayName: '测试用户',
      customAvatarDataUrl: null,
    },
    shortcuts: {
      'nav.dashboard': { key: 'i' },
    },
    savedTradeViews: [
      {
        id: 'view-1',
        name: '待执行',
        pathname: '/active',
        search: { status: 'planned' },
        pinned: true,
        order: 0,
        createdAt: '2026-07-16T08:00:00.000Z',
        updatedAt: '2026-07-16T08:00:00.000Z',
      },
    ],
    symbolIcons: {
      BTCUSDT: {
        presetId: 'btc',
        customDataUrl: null,
        updatedAt: '2026-07-16T08:00:00.000Z',
      },
    },
    symbolCatalog: ['BTCUSDT', 'ETHUSDT'],
    assets: [],
    ...overrides,
  }
}

async function buildZip(
  payload: Record<string, unknown> | null,
  files: Record<string, Uint8Array | string> = {},
  options: { streamFiles?: boolean } = {},
): Promise<ArrayBuffer> {
  const zip = new JSZip()
  if (payload) zip.file('data.json', JSON.stringify(payload))
  for (const [path, data] of Object.entries(files)) zip.file(path, data)
  return zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    streamFiles: options.streamFiles ?? false,
  })
}

function forgeCentralDirectoryUncompressedSize(
  input: ArrayBuffer,
  targetPath: string,
  uncompressedSize: number,
): ArrayBuffer {
  const patched = input.slice(0)
  const bytes = new Uint8Array(patched)
  const view = new DataView(patched)
  let endOffset = -1
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      endOffset = offset
      break
    }
  }
  assert(endOffset >= 0, '测试归档应包含 ZIP 中央目录结束记录')

  const entryCount = view.getUint16(endOffset + 10, true)
  let offset = view.getUint32(endOffset + 16, true)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let index = 0; index < entryCount; index += 1) {
    assert(
      view.getUint32(offset, true) === CENTRAL_DIRECTORY_ENTRY_SIGNATURE,
      '测试归档中央目录条目应有效',
    )
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    const entryEnd = nameEnd + extraLength + commentLength
    assert(entryEnd <= endOffset, '测试归档中央目录范围应有效')
    const path = decoder.decode(bytes.subarray(nameStart, nameEnd))
    if (path === targetPath) {
      view.setUint32(offset + 24, uncompressedSize, true)
      return patched
    }
    offset = entryEnd
  }

  throw new Error(`测试归档缺少中央目录条目：${targetPath}`)
}

async function expectArchiveError(
  operation: () => Promise<unknown>,
  expectedText: string,
  expectedCode?: WebJournalArchiveError['code'],
): Promise<void> {
  let error: unknown
  try {
    await operation()
  } catch (caught) {
    error = caught
  }
  assert(error instanceof Error, `应拒绝归档并包含“${expectedText}”`)
  assert(/[\u3400-\u9fff]/.test(error.message), '归档错误应使用简体中文')
  assert(error.message.includes(expectedText), `实际错误：${error.message}`)
  if (expectedCode) {
    assert(error instanceof WebJournalArchiveError, '应返回可供 UI 分类的归档错误')
    assert(error.code === expectedCode, `错误码应为 ${expectedCode}，实际为 ${error.code}`)
  }
}

export async function testParsesCurrentWebArchiveAndPreservesCompleteSnapshot(): Promise<void> {
  const payload = makePayload()
  const trade = (payload.trades as Array<Record<string, unknown>>)[0]!
  trade.note = '<p>复盘截图</p><img src="journal-asset://asset-one">'
  payload.assets = [{ id: 'asset-one', mime: 'image/png' }]
  const input = await buildZip(payload, {
    'assets/asset-one.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  })

  const parsed = await parseWebJournalArchive(new Blob([input]))

  assert(parsed.preview.exportVersion === 6, '应兼容无 schemaVersion 的 version=6 Web 导出')
  assert(parsed.preview.schemaVersion === null, '缺少 schemaVersion 时应在预览中明确为 null')
  assert(parsed.preview.tradeCount === 1, '预览应包含记录数量')
  assert(parsed.preview.strategyCount === 1, '预览应包含策略数量')
  assert(parsed.preview.assetCount === 1, '预览应包含附件数量')
  assert(parsed.preview.assetBytes === 8, '预览应包含附件原始字节数')
  assert(parsed.preview.shortcutCount === 1, '预览应包含快捷键数量')
  assert(parsed.preview.savedViewCount === 1, '预览应包含已保存视图数量')
  assert(parsed.preview.symbolIconCount === 1, '预览应包含品种图标数量')
  assert(parsed.preview.symbolCatalogCount === 2, '预览应包含品种目录数量')
  assert(parsed.preview.profileDisplayName === '测试用户', '预览应保留个人资料名称')
  assert(parsed.snapshot.profile?.displayName === '测试用户', '应保留 profile')
  assert(parsed.snapshot.shortcuts?.['nav.dashboard'] !== undefined, '应保留 shortcuts')
  assert(parsed.snapshot.savedTradeViews?.[0]?.id === 'view-1', '应保留 savedTradeViews')
  assert(parsed.snapshot.symbolIcons?.BTCUSDT?.presetId === 'btc', '应保留 symbolIcons')
  assert(parsed.snapshot.symbolCatalog?.includes('ETHUSDT'), '应保留 symbolCatalog')
  assert(parsed.snapshot.display.groupByDate, '应规范化并保留 display')
  assert(parsed.snapshot.tagPresets?.[0] === '突破', '标签应安全去空并规范化')
  assert(parsed.assets[0]?.data === 'iVBORw0KGgo=', '附件应无损转换为 base64')
}

export async function testCurrentWriterRoundTripsEverySafeImageMime(): Promise<void> {
  const payload = makePayload()
  const trade = (payload.trades as Array<Record<string, unknown>>)[0]!
  trade.note = '<p>新格式截图</p><img src="journal-asset://asset-vendor">'
  const { version: _version, assets: _assets, ...snapshotFields } = payload
  const archive = buildWebJournalArchiveBlob(
    snapshotFields as unknown as PersistedSnapshot,
    [{ id: 'asset-vendor', mime: 'image/x-linear-capture', data: 'AAECAw==' }],
  )

  const parsed = await parseWebJournalArchive(archive)

  assert(parsed.snapshot.trades[0]?.note.includes('asset-vendor'), 'writer/parser round-trip 应保留附件引用')
  assert(parsed.assets[0]?.mime === 'image/x-linear-capture', '安全的 image/* MIME 应可完整恢复')
  assert(parsed.assets[0]?.data === 'AAECAw==', 'writer/parser round-trip 应无损保留附件字节')
}

export async function testRejectsDeclaredButMissingImage(): Promise<void> {
  const payload = makePayload({
    assets: [{ id: 'missing-image', mime: 'image/png' }],
  })
  ;(payload.trades as Array<Record<string, unknown>>)[0]!.note =
    '<img src="journal-asset://missing-image">'
  const input = await buildZip(payload)
  await expectArchiveError(
    () => parseWebJournalArchive(input),
    '已声明但文件缺失',
    'invalid-asset',
  )
}

export async function testRejectsZipPathTraversalBeforeExtraction(): Promise<void> {
  const input = await buildZip(makePayload(), {
    '../outside.png': new Uint8Array([1]),
  })
  await expectArchiveError(
    () => parseWebJournalArchive(input),
    '路径穿越',
    'unsafe-path',
  )
}

export async function testRejectsForgedCentralDirectorySizeMismatch(): Promise<void> {
  const input = await buildZip(makePayload())
  const forged = forgeCentralDirectoryUncompressedSize(input, 'data.json', 1)

  await expectArchiveError(
    () => parseWebJournalArchive(forged),
    '大小不一致',
    'not-zip',
  )
}

export async function testRejectsActualOversizeWhenCentralDirectoryUnderreportsIt(): Promise<void> {
  const input = await buildZip(
    {
      version: WEB_JOURNAL_EXPORT_VERSION,
      padding: 'x'.repeat(MAX_WEB_JOURNAL_ENTRY_BYTES + 1024),
    },
    {},
    { streamFiles: true },
  )
  const forged = forgeCentralDirectoryUncompressedSize(input, 'data.json', 1)

  await expectArchiveError(
    () => parseWebJournalArchive(forged),
    '单个文件超过',
    'entry-too-large',
  )
}

export async function testRejectsDesktopJournalArchiveWithSpecificMessage(): Promise<void> {
  const input = await buildZip(null, {
    'manifest.json': JSON.stringify({ schemaVersion: SCHEMA_VERSION, libraryId: 'desktop' }),
    'journal.db': new Uint8Array([1, 2, 3]),
  })
  await expectArchiveError(
    () => parseWebJournalArchive(input),
    '桌面版完整交易库归档',
    'desktop-format',
  )
}

export async function testRejectsFutureExportAndSchemaVersions(): Promise<void> {
  const futureExport = await buildZip(
    makePayload({ version: WEB_JOURNAL_EXPORT_VERSION + 1 }),
  )
  await expectArchiveError(
    () => parseWebJournalArchive(futureExport),
    '来自更新版本',
    'incompatible-version',
  )

  const futureSchema = await buildZip(
    makePayload({ schemaVersion: SCHEMA_VERSION + 1 }),
  )
  await expectArchiveError(
    () => parseWebJournalArchive(futureSchema),
    '资料库来自更新版本',
    'incompatible-version',
  )
}

export async function testRejectsDuplicateAssetDeclaration(): Promise<void> {
  const payload = makePayload({
    assets: [
      { id: 'same-id', mime: 'image/png' },
      { id: 'same-id', mime: 'image/png' },
    ],
  })
  const input = await buildZip(payload, {
    'assets/same-id.png': new Uint8Array([1, 2, 3]),
  })
  await expectArchiveError(
    () => parseWebJournalArchive(input),
    '重复附件声明',
    'invalid-asset',
  )
}

export async function testRejectsDeclaredAssetThatNoTradeReferences(): Promise<void> {
  const payload = makePayload({
    assets: [{ id: 'orphan-image', mime: 'image/png' }],
  })
  const input = await buildZip(payload, {
    'assets/orphan-image.png': new Uint8Array([1, 2, 3]),
  })
  await expectArchiveError(
    () => parseWebJournalArchive(input),
    '未被任何交易正文引用',
    'invalid-asset',
  )
}

export async function testParsesArchiveWithoutImagesOrAssetsDirectory(): Promise<void> {
  const input = await buildZip(makePayload())
  const parsed = await parseWebJournalArchive(input)
  assert(parsed.assets.length === 0, '纯文本归档不应伪造附件')
  assert(parsed.preview.assetCount === 0, '纯文本归档预览附件数应为 0')
  assert(parsed.snapshot.trades.length === 1, '纯文本归档仍应完整恢复快照')
}

export async function testRejectsMalformedTradeCollectionsBeforeNormalization(): Promise<void> {
  for (const tradePatch of [
    { tags: undefined },
    { comments: {} },
    { activities: { length: 1 } },
    { comments: [{ id: 'comment-1', text: 42, createdAt: '2026-07-16' }] },
    { session: 42 },
    { caseType: 'unknown' },
    { masteryState: 'learning' },
  ]) {
    const payload = makePayload()
    Object.assign(
      (payload.trades as Array<Record<string, unknown>>)[0]!,
      tradePatch,
    )
    await expectArchiveError(
      async () => parseWebJournalArchive(await buildZip(payload)),
      '交易或策略数据格式无效',
      'invalid-snapshot',
    )
  }


  const malformedDisplay = makePayload({ display: { hideClosed: 'false' } })
  await expectArchiveError(
    async () => parseWebJournalArchive(await buildZip(malformedDisplay)),
    '交易或策略数据格式无效',
    'invalid-snapshot',
  )
}

export async function testWebArchiveRepairsDanglingStrategyReferencesWithoutChangingTrueEmptyLibraries(): Promise<void> {
  const orphanPayload = makePayload({ strategies: [] })
  ;(orphanPayload.trades as Array<Record<string, unknown>>)[0]!.strategyId = 'missing-strategy'
  const repaired = await parseWebJournalArchive(await buildZip(orphanPayload))

  assert(repaired.snapshot.strategies.length === 1, '有记录的空策略归档必须补中性策略')
  assert(
    repaired.snapshot.strategies.some(
      (strategy) => strategy.id === repaired.snapshot.trades[0]?.strategyId,
    ),
    'Web 归档恢复后的交易不得引用不存在的策略',
  )

  const emptyPayload = makePayload({ trades: [], strategies: [] })
  const empty = await parseWebJournalArchive(await buildZip(emptyPayload))
  assert(empty.snapshot.strategies.length === 0, '显式空策略的真正空归档必须保持为空')
}

export async function testRejectsMimeExtensionMismatchAndUndeclaredReference(): Promise<void> {
  const mismatchPayload = makePayload({
    assets: [{ id: 'wrong-extension', mime: 'image/png' }],
  })
  const mismatch = await buildZip(mismatchPayload, {
    'assets/wrong-extension.jpg': new Uint8Array([1]),
  })
  await expectArchiveError(
    () => parseWebJournalArchive(mismatch),
    '扩展名与 MIME 类型不匹配',
    'invalid-asset',
  )

  const undeclaredPayload = makePayload()
  ;(undeclaredPayload.trades as Array<Record<string, unknown>>)[0]!.note =
    '<img src="journal-asset://not-declared">'
  const undeclared = await buildZip(undeclaredPayload)
  await expectArchiveError(
    () => parseWebJournalArchive(undeclared),
    '未声明或缺失的附件',
    'invalid-asset',
  )
}

export async function testParserDoesNotAccessIndexedDb(): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  if (descriptor && descriptor.configurable === false) return
  let accessCount = 0
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    get() {
      accessCount += 1
      throw new Error('测试期间禁止访问 IndexedDB')
    },
  })
  try {
    const input = await buildZip(makePayload())
    await parseWebJournalArchive(input)
    assert(accessCount === 0, '纯解析模块不应读取或写入 IndexedDB')
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor)
    else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
  }
}
