import JSZip from 'jszip'
import { normalizeTradeStrategyReferences } from '@/lib/strategies'
import { normalizeTrades } from '@/lib/tradeKind'
import { normalizeDisplay } from '@/lib/tradeFilters'
import { normalizeSavedTradeViews } from '@/lib/savedTradeViews'
import { normalizeSymbolCatalog, normalizeSymbolIcons } from '@/lib/symbolIcons'
import { mergeTagPresets } from '@/lib/tags'
import { normalizeWeeklyReviews } from '@/data/weeklyReviews'
import { normalizeQuickNotes } from '@/data/quickNotes'
import { migrateShortcutBindings } from '@/store/shortcutStore'
import { isSafeAssetId } from '@/storage/assetId'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import {
  SCHEMA_VERSION,
  type ExportAssetRecord,
  type PersistedSnapshot,
} from '@/storage/types'
import {
  WEB_JOURNAL_EXPORT_VERSION,
  MAX_WEB_JOURNAL_ENTRY_BYTES,
  normalizeWebJournalImageMime,
  webJournalExtensionsForMime,
} from '@/lib/webJournalArchiveContract'
export {
  WEB_JOURNAL_EXPORT_VERSION,
  MAX_WEB_JOURNAL_ENTRY_BYTES,
  normalizeWebJournalImageMime,
  webJournalExtensionForMime,
  webJournalExtensionsForMime,
} from '@/lib/webJournalArchiveContract'

export const MAX_WEB_JOURNAL_ARCHIVE_BYTES = 128 * 1024 * 1024
export const MAX_WEB_JOURNAL_ENTRY_COUNT = 10_000
export const MAX_WEB_JOURNAL_EXPANDED_BYTES = 256 * 1024 * 1024

export type WebJournalArchiveErrorCode =
  | 'not-zip'
  | 'archive-too-large'
  | 'too-many-entries'
  | 'entry-too-large'
  | 'expanded-too-large'
  | 'desktop-format'
  | 'unsafe-path'
  | 'unsupported-entry'
  | 'incompatible-version'
  | 'invalid-snapshot'
  | 'invalid-asset'

export class WebJournalArchiveError extends Error {
  readonly code: WebJournalArchiveErrorCode

  constructor(code: WebJournalArchiveErrorCode, message: string) {
    super(message)
    this.name = 'WebJournalArchiveError'
    this.code = code
  }
}

export interface WebJournalArchivePreview {
  exportVersion: number
  schemaVersion: number | null
  tradeCount: number
  weeklyReviewCount: number
  strategyCount: number
  assetCount: number
  assetBytes: number
  compressedBytes: number
  expandedBytes: number
  starredCount: number
  subscribedCount: number
  pinnedStrategyCount: number
  shortcutCount: number
  tagPresetCount: number
  mistakeTagPresetCount: number
  savedViewCount: number
  symbolIconCount: number
  symbolCatalogCount: number
  profileDisplayName: string | null
}

export interface ParsedWebJournalArchive {
  snapshot: PersistedSnapshot
  assets: ExportAssetRecord[]
  preview: WebJournalArchivePreview
}

type RecordValue = Record<string, unknown>

interface CentralDirectoryEntry {
  path: string
  canonicalPath: string
  compressedSize: number
  uncompressedSize: number
  crc32: number
}

interface DeclaredAsset {
  id: string
  mime: string
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50
const LOCAL_ENTRY_SIGNATURE = 0x04034b50
const MAX_ZIP_COMMENT_BYTES = 0xffff
const MAX_WEB_JOURNAL_ENTRY_DECODE_MS = 30_000
const CRC32_TABLE = new Uint32Array(256)

for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  CRC32_TABLE[index] = value >>> 0
}

function archiveError(
  code: WebJournalArchiveErrorCode,
  message: string,
): WebJournalArchiveError {
  return new WebJournalArchiveError(code, message)
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) {
    throw archiveError('not-zip', '无法读取 ZIP 目录，归档可能已损坏')
  }
  return view.getUint16(offset, true)
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    throw archiveError('not-zip', '无法读取 ZIP 目录，归档可能已损坏')
  }
  return view.getUint32(offset, true)
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimumOffset = Math.max(0, view.byteLength - 22 - MAX_ZIP_COMMENT_BYTES)
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (readUint32(view, offset) !== EOCD_SIGNATURE) continue
    const commentLength = readUint16(view, offset + 20)
    if (offset + 22 + commentLength === view.byteLength) return offset
  }
  throw archiveError('not-zip', '所选文件不是有效的 ZIP 归档')
}

function decodeZipPath(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw archiveError('unsafe-path', 'ZIP 中存在无法识别的文件路径编码')
  }
}

function inspectPath(path: string): { canonicalPath: string; unsafe: boolean } {
  if (
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path)
  ) {
    throw archiveError('unsafe-path', `ZIP 中存在非法路径：${path || '（空路径）'}`)
  }

  const isDirectory = path.endsWith('/')
  const segments = path.split('/')
  if (segments.includes('..')) {
    throw archiveError('unsafe-path', `ZIP 中存在路径穿越：${path}`)
  }
  const canonicalSegments = segments.filter((segment) => segment && segment !== '.')
  if (canonicalSegments.length === 0) {
    throw archiveError('unsafe-path', `ZIP 中存在非法路径：${path}`)
  }
  const canonicalPath = `${canonicalSegments.join('/')}${isDirectory ? '/' : ''}`
  return { canonicalPath, unsafe: canonicalPath !== path }
}

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let next = crc
  for (const byte of bytes) {
    next = CRC32_TABLE[(next ^ byte) & 0xff]! ^ (next >>> 8)
  }
  return next >>> 0
}

function validateLocalEntryHeader(
  view: DataView,
  bytes: Uint8Array,
  centralOffset: number,
  entry: {
    path: string
    flags: number
    compression: number
    crc32: number
    compressedSize: number
    uncompressedSize: number
    localHeaderOffset: number
  },
): void {
  const offset = entry.localHeaderOffset
  if (offset >= centralOffset || readUint32(view, offset) !== LOCAL_ENTRY_SIGNATURE) {
    throw archiveError('not-zip', 'ZIP 本地文件头无效，归档可能已损坏')
  }
  const localFlags = readUint16(view, offset + 6)
  const localCompression = readUint16(view, offset + 8)
  const localCrc32 = readUint32(view, offset + 14)
  const localCompressedSize = readUint32(view, offset + 18)
  const localUncompressedSize = readUint32(view, offset + 22)
  const nameLength = readUint16(view, offset + 26)
  const extraLength = readUint16(view, offset + 28)
  const dataOffset = offset + 30 + nameLength + extraLength
  if (dataOffset > centralOffset || dataOffset + entry.compressedSize > centralOffset) {
    throw archiveError('not-zip', 'ZIP 文件数据范围无效，归档可能已损坏')
  }
  const localPath = decodeZipPath(bytes.subarray(offset + 30, offset + 30 + nameLength))
  if (localPath !== entry.path || localFlags !== entry.flags || localCompression !== entry.compression) {
    throw archiveError('not-zip', 'ZIP 本地文件头与中央目录不一致')
  }

  const usesDataDescriptor = (entry.flags & 0x0008) !== 0
  if (!usesDataDescriptor) {
    if (
      localCrc32 !== entry.crc32 ||
      localCompressedSize !== entry.compressedSize ||
      localUncompressedSize !== entry.uncompressedSize
    ) {
      throw archiveError('not-zip', 'ZIP 本地文件头与中央目录大小不一致')
    }
  } else if (
    (localCrc32 !== 0 && localCrc32 !== entry.crc32) ||
    (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize) ||
    (localUncompressedSize !== 0 && localUncompressedSize !== entry.uncompressedSize)
  ) {
    throw archiveError('not-zip', 'ZIP 数据描述符与中央目录不一致')
  }
}

function parseCentralDirectory(bytes: Uint8Array): CentralDirectoryEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocdOffset = findEndOfCentralDirectory(view)
  const diskNumber = readUint16(view, eocdOffset + 4)
  const centralDisk = readUint16(view, eocdOffset + 6)
  const entriesOnDisk = readUint16(view, eocdOffset + 8)
  const entryCount = readUint16(view, eocdOffset + 10)
  const centralSize = readUint32(view, eocdOffset + 12)
  const centralOffset = readUint32(view, eocdOffset + 16)

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw archiveError('not-zip', '不支持分卷 ZIP，请选择单个完整归档')
  }
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw archiveError('archive-too-large', '暂不支持 ZIP64 超大归档，请拆分数据后重试')
  }
  if (entryCount > MAX_WEB_JOURNAL_ENTRY_COUNT) {
    throw archiveError(
      'too-many-entries',
      `归档条目超过 ${MAX_WEB_JOURNAL_ENTRY_COUNT} 个，请减少附件后重试`,
    )
  }
  if (centralOffset + centralSize > eocdOffset) {
    throw archiveError('not-zip', 'ZIP 中央目录范围无效，归档可能已损坏')
  }

  const entries: CentralDirectoryEntry[] = []
  const canonicalPaths = new Set<string>()
  const unsafePaths: string[] = []
  let expandedBytes = 0
  let offset = centralOffset

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, offset) !== CENTRAL_ENTRY_SIGNATURE) {
      throw archiveError('not-zip', 'ZIP 中央目录条目无效，归档可能已损坏')
    }
    const flags = readUint16(view, offset + 8)
    const compression = readUint16(view, offset + 10)
    const crc32 = readUint32(view, offset + 16)
    const compressedSize = readUint32(view, offset + 20)
    const uncompressedSize = readUint32(view, offset + 24)
    const nameLength = readUint16(view, offset + 28)
    const extraLength = readUint16(view, offset + 30)
    const commentLength = readUint16(view, offset + 32)
    const localHeaderOffset = readUint32(view, offset + 42)
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength
    if (entryEnd > centralOffset + centralSize || entryEnd > eocdOffset) {
      throw archiveError('not-zip', 'ZIP 中央目录条目长度无效，归档可能已损坏')
    }
    if ((flags & 0x0001) !== 0) {
      throw archiveError('unsupported-entry', '归档包含加密文件，当前无法恢复')
    }
    if (compression !== 0 && compression !== 8) {
      throw archiveError('unsupported-entry', '归档使用了不支持的压缩方式')
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw archiveError('archive-too-large', '暂不支持 ZIP64 超大条目')
    }
    if (uncompressedSize > MAX_WEB_JOURNAL_ENTRY_BYTES) {
      throw archiveError(
        'entry-too-large',
        `归档内单个文件超过 ${MAX_WEB_JOURNAL_ENTRY_BYTES / 1024 / 1024} MB`,
      )
    }
    expandedBytes += uncompressedSize
    if (expandedBytes > MAX_WEB_JOURNAL_EXPANDED_BYTES) {
      throw archiveError(
        'expanded-too-large',
        `归档解压后超过 ${MAX_WEB_JOURNAL_EXPANDED_BYTES / 1024 / 1024} MB，请减少附件后重试`,
      )
    }

    const path = decodeZipPath(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
    )
    const inspected = inspectPath(path)
    validateLocalEntryHeader(view, bytes, centralOffset, {
      path,
      flags,
      compression,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    })
    if (canonicalPaths.has(inspected.canonicalPath)) {
      throw archiveError(
        'unsafe-path',
        `ZIP 中存在重复的规范路径：${inspected.canonicalPath}`,
      )
    }
    canonicalPaths.add(inspected.canonicalPath)
    if (inspected.unsafe) unsafePaths.push(path)
    entries.push({
      path,
      canonicalPath: inspected.canonicalPath,
      compressedSize,
      uncompressedSize,
      crc32,
    })
    offset = entryEnd
  }

  if (offset !== centralOffset + centralSize) {
    throw archiveError('not-zip', 'ZIP 中央目录包含无法识别的数据')
  }
  if (unsafePaths.length > 0) {
    throw archiveError('unsafe-path', `ZIP 中存在不规范路径：${unsafePaths[0]}`)
  }
  return entries
}

async function inputToBytes(input: Blob | ArrayBuffer): Promise<Uint8Array> {
  const byteLength = input instanceof Blob ? input.size : input.byteLength
  if (byteLength > MAX_WEB_JOURNAL_ARCHIVE_BYTES) {
    throw archiveError(
      'archive-too-large',
      `归档压缩包超过 ${MAX_WEB_JOURNAL_ARCHIVE_BYTES / 1024 / 1024} MB，请减少附件后重试`,
    )
  }
  if (byteLength === 0) throw archiveError('not-zip', '所选归档为空文件')
  try {
    return new Uint8Array(input instanceof Blob ? await input.arrayBuffer() : input)
  } catch {
    throw archiveError('not-zip', '无法读取所选归档文件')
  }
}

function validateProfile(value: unknown): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    throw archiveError('invalid-snapshot', '归档中的个人资料格式无效')
  }
  if (value.avatarId !== null && typeof value.avatarId !== 'string') {
    throw archiveError('invalid-snapshot', '归档中的头像设置格式无效')
  }
  if (typeof value.displayName !== 'string') {
    throw archiveError('invalid-snapshot', '归档中的显示名称格式无效')
  }
  if (
    value.customAvatarDataUrl !== undefined &&
    value.customAvatarDataUrl !== null &&
    typeof value.customAvatarDataUrl !== 'string'
  ) {
    throw archiveError('invalid-snapshot', '归档中的自定义头像格式无效')
  }
}

function isShortcutChord(value: unknown): boolean {
  if (!isRecord(value) || typeof value.key !== 'string' || !value.key.trim()) return false
  return ['mod', 'shift', 'alt'].every(
    (key) => value[key] === undefined || typeof value[key] === 'boolean',
  )
}

function validateShortcuts(value: unknown): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    throw archiveError('invalid-snapshot', '归档中的快捷键设置格式无效')
  }
  for (const [actionId, binding] of Object.entries(value)) {
    const validBinding =
      binding === null ||
      isShortcutChord(binding) ||
      (Array.isArray(binding) && binding.length > 0 && binding.every(isShortcutChord))
    if (!actionId.trim() || !validBinding) {
      throw archiveError('invalid-snapshot', `快捷键 ${actionId || '（空动作）'} 的格式无效`)
    }
  }
}

function validateSavedTradeViews(value: unknown): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    throw archiveError('invalid-snapshot', '归档中的已保存视图格式无效')
  }
  const ids = new Set<string>()
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      typeof item.name !== 'string' ||
      typeof item.pathname !== 'string' ||
      !isRecord(item.search) ||
      !Object.entries(item.search).every(
        ([key, searchValue]) => Boolean(key.trim()) && typeof searchValue === 'string',
      ) ||
      typeof item.pinned !== 'boolean' ||
      typeof item.order !== 'number' ||
      !Number.isFinite(item.order) ||
      typeof item.createdAt !== 'string' ||
      typeof item.updatedAt !== 'string'
    ) {
      throw archiveError('invalid-snapshot', '归档中存在格式无效的已保存视图')
    }
    if (ids.has(item.id)) {
      throw archiveError('invalid-snapshot', `归档中存在重复的已保存视图：${item.id}`)
    }
    ids.add(item.id)
  }
}

function validateSymbolData(symbolIcons: unknown, symbolCatalog: unknown): void {
  if (symbolIcons !== undefined) {
    if (!isRecord(symbolIcons)) {
      throw archiveError('invalid-snapshot', '归档中的品种图标设置格式无效')
    }
    for (const [symbol, icon] of Object.entries(symbolIcons)) {
      if (
        !symbol.trim() ||
        !isRecord(icon) ||
        typeof icon.updatedAt !== 'string' ||
        (icon.presetId !== undefined &&
          icon.presetId !== null &&
          typeof icon.presetId !== 'string') ||
        (icon.customDataUrl !== undefined &&
          icon.customDataUrl !== null &&
          typeof icon.customDataUrl !== 'string')
      ) {
        throw archiveError('invalid-snapshot', `品种 ${symbol || '（空名称）'} 的图标格式无效`)
      }
    }
  }
  if (symbolCatalog !== undefined && !isStringArray(symbolCatalog)) {
    throw archiveError('invalid-snapshot', '归档中的品种目录格式无效')
  }
}

function validateSnapshotRelations(snapshot: PersistedSnapshot): void {
  const tradeIds = new Set<string>()
  for (const trade of snapshot.trades) {
    if (tradeIds.has(trade.id)) {
      throw archiveError('invalid-snapshot', `归档中存在重复的记录 ID：${trade.id}`)
    }
    tradeIds.add(trade.id)
  }
  const strategyIds = new Set<string>()
  for (const strategy of snapshot.strategies) {
    if (strategyIds.has(strategy.id)) {
      throw archiveError('invalid-snapshot', `归档中存在重复的策略 ID：${strategy.id}`)
    }
    strategyIds.add(strategy.id)
  }
  for (const trade of snapshot.trades) {
    if (!strategyIds.has(trade.strategyId)) {
      throw archiveError(
        'invalid-snapshot',
        `记录 ${trade.ref || trade.id} 引用了不存在的策略`,
      )
    }
  }
}

function buildNormalizedSnapshot(raw: RecordValue): PersistedSnapshot {
  if (raw.display !== undefined && !isRecord(raw.display)) {
    throw archiveError('invalid-snapshot', '归档中的显示设置格式无效')
  }
  validateProfile(raw.profile)
  validateShortcuts(raw.shortcuts)
  validateSavedTradeViews(raw.savedTradeViews)
  validateSymbolData(raw.symbolIcons, raw.symbolCatalog)

  const candidate: PersistedSnapshot = {
    trades: raw.trades as PersistedSnapshot['trades'],
    weeklyReviews: (raw.weeklyReviews ?? []) as NonNullable<PersistedSnapshot['weeklyReviews']>,
    quickNotes: (raw.quickNotes ?? []) as NonNullable<PersistedSnapshot['quickNotes']>,
    strategies: raw.strategies as PersistedSnapshot['strategies'],
    starredIds: (raw.starredIds ?? []) as string[],
    subscribedIds: (raw.subscribedIds ?? []) as string[],
    pinnedStrategyIds: (raw.pinnedStrategyIds ?? []) as string[],
    display: raw.display as unknown as PersistedSnapshot['display'],
    tagPresets: (raw.tagPresets ?? []) as string[],
    mistakeTagPresets: (raw.mistakeTagPresets ?? []) as string[],
    profile: raw.profile as PersistedSnapshot['profile'],
    shortcuts: raw.shortcuts as PersistedSnapshot['shortcuts'],
    savedTradeViews: raw.savedTradeViews as PersistedSnapshot['savedTradeViews'],
    symbolIcons: raw.symbolIcons as PersistedSnapshot['symbolIcons'],
    symbolCatalog: raw.symbolCatalog as PersistedSnapshot['symbolCatalog'],
  }

  try {
    assertValidPersistedSnapshot(candidate, 'Web journal snapshot')
  } catch {
    throw archiveError('invalid-snapshot', '归档中的交易或策略数据格式无效')
  }
  const normalized = normalizeTradeStrategyReferences(candidate.trades, candidate.strategies)
  const strategies = normalized.strategies
  const trades = normalizeTrades(normalized.trades)
  validateSnapshotRelations({ ...candidate, strategies, trades })
  const symbolIcons = normalizeSymbolIcons(candidate.symbolIcons)
  return {
    ...candidate,
    trades,
    weeklyReviews: normalizeWeeklyReviews(candidate.weeklyReviews),
    quickNotes: normalizeQuickNotes(candidate.quickNotes),
    strategies,
    display: normalizeDisplay(candidate.display),
    tagPresets: mergeTagPresets(candidate.tagPresets),
    mistakeTagPresets: mergeTagPresets(candidate.mistakeTagPresets),
    shortcuts: migrateShortcutBindings(candidate.shortcuts),
    savedTradeViews: normalizeSavedTradeViews(candidate.savedTradeViews),
    symbolIcons,
    symbolCatalog: normalizeSymbolCatalog(
      candidate.symbolCatalog ?? [
        ...Object.keys(symbolIcons),
        ...trades.map((trade) => trade.symbol),
      ],
    ),
  }
}

function parseDeclaredAssets(value: unknown): DeclaredAsset[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw archiveError('invalid-asset', 'data.json 中的附件声明必须是数组')
  }
  const ids = new Set<string>()
  return value.map((item): DeclaredAsset => {
    if (!isRecord(item) || !isSafeAssetId(item.id)) {
      throw archiveError('invalid-asset', 'data.json 中存在非法附件 ID')
    }
    const mime = normalizeWebJournalImageMime(item.mime)
    if (!mime) {
      throw archiveError('invalid-asset', `附件 ${item.id} 使用了不支持的图片类型`)
    }
    if (ids.has(item.id)) {
      throw archiveError('invalid-asset', `data.json 中存在重复附件声明：${item.id}`)
    }
    ids.add(item.id)
    return { id: item.id, mime }
  })
}

function parseAssetFiles(
  entries: CentralDirectoryEntry[],
  declarations: DeclaredAsset[],
): Map<string, { entry: CentralDirectoryEntry; extension: string; mime: string }> {
  const declaredById = new Map(declarations.map((asset) => [asset.id, asset]))
  const files = new Map<
    string,
    { entry: CentralDirectoryEntry; extension: string; mime: string }
  >()

  for (const entry of entries) {
    if (entry.path === 'data.json' || entry.path === 'assets/') continue
    const match = /^assets\/([^/]+)\.([A-Za-z0-9]+)$/.exec(entry.path)
    if (!match) {
      throw archiveError('unsupported-entry', `归档包含未知文件：${entry.path}`)
    }
    const [, id, extension] = match
    if (!isSafeAssetId(id)) {
      throw archiveError('invalid-asset', `归档中存在非法附件 ID：${id}`)
    }
    if (files.has(id)) {
      throw archiveError('invalid-asset', `归档中存在重复附件文件：${id}`)
    }
    const declaration = declaredById.get(id)
    if (!declaration) {
      throw archiveError('invalid-asset', `附件文件 ${id} 未在 data.json 中声明`)
    }
    const normalizedExtension = extension.toLowerCase()
    const supportedExtensions = webJournalExtensionsForMime(declaration.mime)
    if (
      extension !== normalizedExtension ||
      !supportedExtensions.has(normalizedExtension)
    ) {
      throw archiveError(
        'invalid-asset',
        `附件 ${id} 的文件扩展名与 MIME 类型不匹配`,
      )
    }
    files.set(id, {
      entry,
      extension: normalizedExtension,
      mime: declaration.mime,
    })
  }

  for (const declaration of declarations) {
    if (!files.has(declaration.id)) {
      throw archiveError('invalid-asset', `附件 ${declaration.id} 已声明但文件缺失`)
    }
  }
  return files
}

function validateNoteAssetReferences(
  snapshot: PersistedSnapshot,
  declaredIds: ReadonlySet<string>,
): void {
  const referencedIds = new Set<string>()
  for (const trade of snapshot.trades) {
    const note = typeof trade.note === 'string' ? trade.note : ''
    for (const match of note.matchAll(/journal-asset:\/\/([^"'\s>]+)/g)) {
      const id = match[1]
      if (!id || !isSafeAssetId(id)) {
        throw archiveError('invalid-asset', `记录 ${trade.ref || trade.id} 引用了非法附件`)
      }
      if (!declaredIds.has(id)) {
        throw archiveError(
          'invalid-asset',
          `记录 ${trade.ref || trade.id} 引用了未声明或缺失的附件：${id}`,
        )
      }
      referencedIds.add(id)
    }
  }
  for (const review of snapshot.weeklyReviews ?? []) {
    for (const match of review.contentHtml.matchAll(/journal-asset:\/\/([^"'\s>]+)/g)) {
      const id = match[1]
      if (!id || !isSafeAssetId(id)) {
        throw archiveError('invalid-asset', `周复盘 ${review.weekStart} 引用了非法附件`)
      }
      if (!declaredIds.has(id)) {
        throw archiveError('invalid-asset', `周复盘 ${review.weekStart} 引用了缺失的附件：${id}`)
      }
      referencedIds.add(id)
    }
  }
  for (const note of snapshot.quickNotes ?? []) {
    for (const match of note.contentHtml.matchAll(/journal-asset:\/\/([^"'\s>]+)/g)) {
      const id = match[1]
      if (!id || !isSafeAssetId(id)) {
        throw archiveError('invalid-asset', `随记「${note.title}」引用了非法附件`)
      }
      if (!declaredIds.has(id)) {
        throw archiveError('invalid-asset', `随记「${note.title}」引用了缺失的附件：${id}`)
      }
      referencedIds.add(id)
    }
  }
  for (const id of declaredIds) {
    if (!referencedIds.has(id)) {
      throw archiveError('invalid-asset', `附件 ${id} 已声明但未被任何正文引用`)
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))
  }
  return btoa(chunks.join(''))
}

function parseVersion(raw: RecordValue): { exportVersion: number; schemaVersion: number | null } {
  if (!Number.isInteger(raw.version) || Number(raw.version) < 1) {
    throw archiveError('incompatible-version', 'data.json 缺少有效的导出版本')
  }
  const exportVersion = Number(raw.version)
  if (exportVersion > WEB_JOURNAL_EXPORT_VERSION) {
    throw archiveError(
      'incompatible-version',
      `该归档来自更新版本（v${exportVersion}），当前仅支持至 v${WEB_JOURNAL_EXPORT_VERSION}`,
    )
  }

  if (raw.schemaVersion === undefined) {
    return { exportVersion, schemaVersion: null }
  }
  if (!Number.isInteger(raw.schemaVersion) || Number(raw.schemaVersion) < 1) {
    throw archiveError('incompatible-version', 'data.json 中的交易库版本无效')
  }
  const schemaVersion = Number(raw.schemaVersion)
  if (schemaVersion > SCHEMA_VERSION) {
    throw archiveError(
      'incompatible-version',
      `该交易库来自更新版本（v${schemaVersion}），当前仅支持至 v${SCHEMA_VERSION}`,
    )
  }
  return { exportVersion, schemaVersion }
}

async function loadZip(bytes: Uint8Array): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false })
  } catch (error) {
    if (error instanceof WebJournalArchiveError) throw error
    throw archiveError('not-zip', '无法解压归档，文件可能损坏或不是 ZIP')
  }
}

type StreamableZipEntry = JSZip.JSZipObject & {
  internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>
}

async function readZipEntryBytesBounded(
  zipEntry: JSZip.JSZipObject,
  metadata: CentralDirectoryEntry,
  expandedBefore: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let stream: JSZip.JSZipStreamHelper<Uint8Array>
    try {
      stream = (zipEntry as StreamableZipEntry).internalStream('uint8array')
    } catch {
      reject(archiveError('not-zip', `归档条目 ${metadata.path} 无法开始解压`))
      return
    }

    let settled = false
    let byteLength = 0
    let crc = 0xffffffff
    const chunks: Uint8Array[] = []
    const timeout = setTimeout(() => {
      fail(archiveError('not-zip', `归档条目 ${metadata.path} 解压超时`))
    }, MAX_WEB_JOURNAL_ENTRY_DECODE_MS)

    function fail(error: WebJournalArchiveError) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      stream.pause()
      reject(error)
    }

    stream.on('data', (chunk) => {
      if (settled) return
      byteLength += chunk.byteLength
      if (byteLength > MAX_WEB_JOURNAL_ENTRY_BYTES) {
        fail(archiveError('entry-too-large', `归档内单个文件超过 ${MAX_WEB_JOURNAL_ENTRY_BYTES / 1024 / 1024} MB`))
        return
      }
      if (expandedBefore + byteLength > MAX_WEB_JOURNAL_EXPANDED_BYTES) {
        fail(archiveError(
          'expanded-too-large',
          `归档实际解压后超过 ${MAX_WEB_JOURNAL_EXPANDED_BYTES / 1024 / 1024} MB，请减少附件后重试`,
        ))
        return
      }
      crc = updateCrc32(crc, chunk)
      chunks.push(chunk.slice())
    })
    stream.on('error', () => {
      fail(archiveError('not-zip', `归档条目 ${metadata.path} 已损坏，无法解压`))
    })
    stream.on('end', () => {
      if (settled) return
      if (byteLength !== metadata.uncompressedSize) {
        fail(archiveError('not-zip', `归档条目 ${metadata.path} 的实际解压大小与 ZIP 目录不一致`))
        return
      }
      if (((crc ^ 0xffffffff) >>> 0) !== metadata.crc32) {
        fail(archiveError('not-zip', `归档条目 ${metadata.path} 的校验和不匹配`))
        return
      }

      const combined = new Uint8Array(byteLength)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.byteLength
      }
      settled = true
      clearTimeout(timeout)
      resolve(combined)
    })
    stream.resume()
  })
}

async function readDataJson(
  zip: JSZip,
  metadata: CentralDirectoryEntry,
): Promise<{ raw: RecordValue; byteLength: number }> {
  const entry = zip.file('data.json')
  if (!entry) {
    throw archiveError('unsupported-entry', '归档缺少 data.json，无法恢复 Web 交易库')
  }
  try {
    const bytes = await readZipEntryBytesBounded(entry, metadata, 0)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const value: unknown = JSON.parse(text)
    if (!isRecord(value)) throw new Error('not an object')
    return { raw: value, byteLength: bytes.byteLength }
  } catch (error) {
    if (error instanceof WebJournalArchiveError) throw error
    throw archiveError('invalid-snapshot', 'data.json 不是有效的 UTF-8 JSON 对象')
  }
}

/**
 * 纯解析 Web 端 .journal.zip，不读取或写入任何 Store、IndexedDB 或桌面资料库。
 * 所有数据会在返回前完成容量、路径、版本、快照与附件一致性校验。
 */
export async function parseWebJournalArchive(
  input: Blob | ArrayBuffer,
): Promise<ParsedWebJournalArchive> {
  const bytes = await inputToBytes(input)
  const entries = parseCentralDirectory(bytes)
  const pathSet = new Set(entries.map((entry) => entry.path))

  if (pathSet.has('manifest.json') || pathSet.has('journal.db')) {
    throw archiveError(
      'desktop-format',
      '这是桌面版完整交易库归档；浏览器当前仅支持恢复由浏览器导出的 data.json + assets 归档',
    )
  }
  if (!pathSet.has('data.json')) {
    throw archiveError('unsupported-entry', '归档缺少 data.json，无法恢复 Web 交易库')
  }
  const dataJsonEntry = entries.find((entry) => entry.path === 'data.json')
  if (!dataJsonEntry) {
    throw archiveError('unsupported-entry', '归档缺少 data.json，无法恢复 Web 交易库')
  }

  const zip = await loadZip(bytes)
  const dataJson = await readDataJson(zip, dataJsonEntry)
  if (dataJson.byteLength > MAX_WEB_JOURNAL_ENTRY_BYTES) {
    throw archiveError('entry-too-large', 'data.json 超过单文件容量限制')
  }
  const raw = dataJson.raw
  const { exportVersion, schemaVersion } = parseVersion(raw)
  const snapshot = buildNormalizedSnapshot(raw)
  const declarations = parseDeclaredAssets(raw.assets)
  const assetFiles = parseAssetFiles(entries, declarations)
  const declaredIds = new Set(declarations.map((asset) => asset.id))
  validateNoteAssetReferences(snapshot, declaredIds)

  const assets: ExportAssetRecord[] = []
  let expandedBytes = dataJson.byteLength
  let assetBytes = 0
  for (const declaration of declarations) {
    const assetFile = assetFiles.get(declaration.id)!
    const zipEntry = zip.file(assetFile.entry.path)
    if (!zipEntry) {
      throw archiveError('invalid-asset', `附件 ${declaration.id} 无法从归档读取`)
    }
    let assetData: Uint8Array
    try {
      assetData = await readZipEntryBytesBounded(
        zipEntry,
        assetFile.entry,
        expandedBytes,
      )
    } catch (error) {
      if (error instanceof WebJournalArchiveError) throw error
      throw archiveError('invalid-asset', `附件 ${declaration.id} 已损坏，无法解压`)
    }
    if (assetData.byteLength > MAX_WEB_JOURNAL_ENTRY_BYTES) {
      throw archiveError('entry-too-large', `附件 ${declaration.id} 超过单文件容量限制`)
    }
    assetBytes += assetData.byteLength
    expandedBytes += assetData.byteLength
    if (expandedBytes > MAX_WEB_JOURNAL_EXPANDED_BYTES) {
      throw archiveError(
        'expanded-too-large',
        `归档实际解压后超过 ${MAX_WEB_JOURNAL_EXPANDED_BYTES / 1024 / 1024} MB，请减少附件后重试`,
      )
    }
    assets.push({
      id: declaration.id,
      mime: declaration.mime,
      data: bytesToBase64(assetData),
    })
  }

  return {
    snapshot,
    assets,
    preview: {
      exportVersion,
      schemaVersion,
      tradeCount: snapshot.trades.length,
      weeklyReviewCount: snapshot.weeklyReviews?.length ?? 0,
      strategyCount: snapshot.strategies.length,
      assetCount: assets.length,
      assetBytes,
      compressedBytes: bytes.byteLength,
      expandedBytes,
      starredCount: snapshot.starredIds.length,
      subscribedCount: snapshot.subscribedIds.length,
      pinnedStrategyCount: snapshot.pinnedStrategyIds.length,
      shortcutCount: Object.keys(snapshot.shortcuts ?? {}).length,
      tagPresetCount: snapshot.tagPresets?.length ?? 0,
      mistakeTagPresetCount: snapshot.mistakeTagPresets?.length ?? 0,
      savedViewCount: snapshot.savedTradeViews?.length ?? 0,
      symbolIconCount: Object.keys(snapshot.symbolIcons ?? {}).length,
      symbolCatalogCount: snapshot.symbolCatalog?.length ?? 0,
      profileDisplayName: snapshot.profile?.displayName ?? null,
    },
  }
}
