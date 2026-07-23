import { DEFAULT_STRATEGIES, type Strategy } from '@/data/strategies'
import {
  createDefaultUserProfile,
  createDefaultMistakeTagPresets,
  createDefaultTagPresets,
} from '@/config/defaultProfile'
import type { Trade } from '@/data/trades'
import {
  normalizeWeeklyReviews,
  type WeeklyReview,
} from '@/data/weeklyReviews'
import {
  createDefaultReviewTemplates,
  normalizeReviewTemplates,
  type ReviewTemplate,
} from '@/data/reviewTemplates'
import {
  mergeQuickNotes,
  normalizeQuickNotes,
  type QuickNote,
} from '@/data/quickNotes'
import { DEFAULT_DISPLAY, normalizeDisplay, type DisplayPrefs } from '@/lib/tradeFilters'
import {
  ensureStrategies,
  normalizeTradeStrategyReferences,
} from '@/lib/strategies'
import { normalizeTrades } from '@/lib/tradeKind'
import { useStore } from '@/store/useStore'
import { bindingsForPersist, useShortcutStore } from '@/store/shortcutStore'
import {
  collectAssetIdsFromNotes,
  collectAssetIdsFromHtml,
  collectAssetIdsFromSnapshot,
  getStorage,
} from '@/storage'
import type { ExportAssetRecord } from '@/storage/types'
import {
  disablePersistWrites,
  discardPendingAndResumePersist,
  flushPersistNow,
  suspendPersist,
  resumePersistAndFlush,
} from '@/storage/persist'
import { isElectron, getJournalBridge } from '@/storage/runtime'
import type { PersistedSnapshot } from '@/storage/types'
import { beginWebOperation } from '@/storage/webOperationLogger'
import { decodeCanonicalSnapshot } from '@/storage/snapshotCodec'
import { SCHEMA_VERSION } from '@/storage/types'
import {
  mergeSavedTradeViews,
  normalizeSavedTradeViews,
  type SavedTradeView,
} from '@/lib/savedTradeViews'
import {
  mergeSymbolIcons,
  normalizeSymbolIcons,
  mergeSymbolCatalog,
  normalizeSymbolCatalog,
  DEFAULT_SYMBOL_CATALOG,
  type SymbolIconsMap,
} from '@/lib/symbolIcons'
import { mergeTagPresets } from '@/lib/tags'
import { getElectronAdapter } from '@/storage/electronAdapter'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import { useSaveStatus } from '@/store/saveStatus'
import { isSafeAssetId } from '@/storage/assetId'
import {
  flushStorageBeforeCutover,
  lockStorageCutoverInteraction,
} from '@/storage/cutover'
import { waitForPendingStorageOperations } from '@/storage/pendingOperations'
import { applyNoteDraftsToSnapshot } from '@/storage/noteDrafts'
import { RECOVERY_MISSING_DRAFT_ASSET_PREFIX } from '@/storage/assets'
import { PERSISTED_STATE_REFERENCE_KEYS } from '@/storage/persistedKeys'
import {
  MAX_WEB_JOURNAL_ARCHIVE_BYTES,
  MAX_WEB_JOURNAL_ENTRY_BYTES,
  MAX_WEB_JOURNAL_ENTRY_COUNT,
  MAX_WEB_JOURNAL_EXPANDED_BYTES,
  WEB_JOURNAL_EXPORT_VERSION,
  normalizeWebJournalImageMime,
  webJournalExtensionForMime,
  type ParsedWebJournalArchive,
} from '@/lib/webJournalArchive'
import { clearReviewSessionStorage } from '@/lib/reviewSession'
import {
  assertValidPersistedSnapshot,
} from '@/storage/snapshotValidation'
import {
  JsonAttachmentBudget,
  JsonImportBudgetError,
  assertJsonEntityBudget,
  assertJsonFileByteBudget,
  estimatePrettyJsonUtf8Bytes,
  getJsonImportErrorMessage,
  utf8ByteLength,
  type JsonImportErrorCode,
} from '@/lib/importLimits'

export const EXPORT_VERSION = WEB_JOURNAL_EXPORT_VERSION // 8: +quickNotes
import type { ExportPayload, PersistedSlice } from '@/lib/importTypes'
import { mergeImportPayload } from '@/lib/importMerge'

export type { ExportPayload, PersistedSlice } from '@/lib/importTypes'
export { mergeImportPayload } from '@/lib/importMerge'

interface ExportState extends PersistedSlice {
  shortcuts?: PersistedSnapshot['shortcuts']
  tagPresets?: string[]
  mistakeTagPresets?: string[]
  profile?: PersistedSnapshot['profile']
  savedTradeViews?: SavedTradeView[]
  symbolIcons?: SymbolIconsMap
  symbolCatalog?: string[]
  reviewTemplates?: ReviewTemplate[]
}

interface PortableSnapshotState {
  trades: PersistedSnapshot['trades']
  weeklyReviews?: PersistedSnapshot['weeklyReviews']
  quickNotes?: PersistedSnapshot['quickNotes']
  strategies: PersistedSnapshot['strategies']
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: PersistedSnapshot['display']
  tagPresets: string[]
  mistakeTagPresets: string[]
  profile: PersistedSnapshot['profile']
  savedTradeViews: PersistedSnapshot['savedTradeViews']
  symbolIcons: PersistedSnapshot['symbolIcons']
  symbolCatalog: PersistedSnapshot['symbolCatalog']
  reviewTemplates?: PersistedSnapshot['reviewTemplates']
}

export function buildPortableSnapshotFromState(
  state: PortableSnapshotState,
  shortcutBindings: Parameters<typeof bindingsForPersist>[0],
): PersistedSnapshot {
  const shortcuts = bindingsForPersist(shortcutBindings)
  return {
    trades: state.trades,
    weeklyReviews: normalizeWeeklyReviews(state.weeklyReviews),
    quickNotes: normalizeQuickNotes(state.quickNotes),
    strategies: state.strategies,
    starredIds: state.starredIds,
    subscribedIds: state.subscribedIds,
    pinnedStrategyIds: state.pinnedStrategyIds,
    display: state.display,
    tagPresets: state.tagPresets ?? [],
    mistakeTagPresets: state.mistakeTagPresets ?? [],
    profile: state.profile ?? createDefaultUserProfile(),
    savedTradeViews: normalizeSavedTradeViews(state.savedTradeViews),
    symbolIcons: normalizeSymbolIcons(state.symbolIcons),
    symbolCatalog: normalizeSymbolCatalog(state.symbolCatalog),
    reviewTemplates: normalizeReviewTemplates(state.reviewTemplates),
    shortcuts,
  }
}

export type ImportResult =
  | { ok: true; data: ExportPayload }
  | { ok: false; code: JsonImportErrorCode; error: string }

function importFailure(code: JsonImportErrorCode): ImportResult {
  return { ok: false, code, error: getJsonImportErrorMessage(code) }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function parseDisplay(v: unknown): DisplayPrefs {
  if (!isRecord(v)) return { ...DEFAULT_DISPLAY }
  return normalizeDisplay(v as Partial<DisplayPrefs>)
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const IMPORT_DATA_IMAGE_SRC_RE = /<img\b[^>]*\ssrc=["'](data:[^"']*)["'][^>]*>/gi
const IMPORT_DATA_IMAGE_RE = /<img([^>]*)\ssrc=["']data:([^;,"']+);base64,([^"']+)["']([^>]*)>/gi

function isStrictBase64(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0
  ) return false

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const contentLength = value.length - padding
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index)
    const valid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47
    if (!valid) return false
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false
  }

  if (padding === 2) {
    return BASE64_ALPHABET.indexOf(value[value.length - 3] ?? '') % 16 === 0
  }
  if (padding === 1) {
    return BASE64_ALPHABET.indexOf(value[value.length - 2] ?? '') % 4 === 0
  }
  return true
}

function assertBase64WithinBudget(value: unknown, budget: JsonAttachmentBudget): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) {
    throw new JsonImportBudgetError('json-invalid-base64')
  }
  const padding: 0 | 1 | 2 = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  budget.add(value.length, padding)
  if (!isStrictBase64(value)) throw new JsonImportBudgetError('json-invalid-base64')
}

function assertValidInlineImportImages(
  htmlEntries: readonly string[],
  budget: JsonAttachmentBudget,
): void {
  for (const html of htmlEntries) {
    IMPORT_DATA_IMAGE_SRC_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = IMPORT_DATA_IMAGE_SRC_RE.exec(html)) !== null) {
      const parsed = /^data:([^;,]+);base64,(.*)$/i.exec(match[1] ?? '')
      const mime = normalizeWebJournalImageMime(parsed?.[1])
      if (!parsed || !mime) {
        throw new Error('正文中的内嵌附件不是受支持的图片')
      }
      assertBase64WithinBudget(parsed[2], budget)
    }
  }
}

function normalizeAndValidateImportAssets(
  htmlEntries: readonly string[],
  value: unknown,
): ExportAssetRecord[] {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error('assets 数据格式不正确')
  }

  const normalized: ExportAssetRecord[] = []
  const assetIds = new Set<string>()
  const attachmentBudget = new JsonAttachmentBudget()
  for (const v of value ?? []) {
    if (!isRecord(v) || !isSafeAssetId(v.id)) {
      throw new Error('assets 中存在非法附件 ID')
    }
    if (assetIds.has(v.id)) {
      throw new Error(`assets 中存在重复附件 ID：${v.id}`)
    }
    const mime = normalizeWebJournalImageMime(v.mime)
    if (!mime) throw new Error(`附件 ${v.id} 不是受支持的图片`)
    assertBase64WithinBudget(v.data, attachmentBudget)
    assetIds.add(v.id)
    normalized.push({ id: v.id, mime, data: v.data })
  }

  const referencedIds = new Set(collectAssetIdsFromHtml(htmlEntries))
  for (const id of referencedIds) {
    if (!isSafeAssetId(id)) throw new Error(`正文引用了非法附件 ID：${id}`)
    if (!assetIds.has(id)) throw new Error(`导入内容缺少附件：${id}`)
  }
  for (const id of assetIds) {
    if (!referencedIds.has(id)) throw new Error(`附件 ${id} 未被任何正文引用`)
  }
  assertValidInlineImportImages(htmlEntries, attachmentBudget)
  return normalized
}

export async function buildExportPayloadFromState(
  state: ExportState,
  getAssetForExport: (id: string) => Promise<ExportAssetRecord | null>,
): Promise<ExportPayload> {
  const assetIds = new Set(collectAssetIdsFromSnapshot(state))
  const assets = await loadReferencedAssetsForExport(assetIds, getAssetForExport)
  return {
    version: EXPORT_VERSION,
    trades: state.trades,
    weeklyReviews: normalizeWeeklyReviews(state.weeklyReviews),
    quickNotes: normalizeQuickNotes(state.quickNotes),
    strategies: state.strategies,
    starredIds: state.starredIds,
    subscribedIds: state.subscribedIds,
    pinnedStrategyIds: state.pinnedStrategyIds,
    display: state.display,
    shortcuts: state.shortcuts ?? {},
    tagPresets: state.tagPresets ?? [],
    mistakeTagPresets: state.mistakeTagPresets ?? [],
    profile: state.profile ?? createDefaultUserProfile(),
    savedTradeViews: normalizeSavedTradeViews(state.savedTradeViews),
    symbolIcons: normalizeSymbolIcons(state.symbolIcons),
    symbolCatalog: normalizeSymbolCatalog(state.symbolCatalog),
    reviewTemplates: normalizeReviewTemplates(state.reviewTemplates),
    assets,
  }
}

export async function loadReferencedAssetsForExport(
  assetIds: Iterable<string>,
  getAssetForExport: (id: string) => Promise<ExportAssetRecord | null>,
): Promise<ExportAssetRecord[]> {
  const assets: ExportAssetRecord[] = []
  let missingCount = 0
  for (const id of new Set(assetIds)) {
    if (!isSafeAssetId(id)) {
      throw new Error('无法创建可恢复备份：笔记中存在非法附件引用。')
    }
    const record = await getAssetForExport(id)
    if (!record) {
      missingCount += 1
      continue
    }
    if (
      record.id !== id ||
      !isSafeAssetId(record.id) ||
      typeof record.mime !== 'string' ||
      typeof record.data !== 'string'
    ) {
      throw new Error(`无法创建可恢复备份：附件 ${id} 的存储记录无效。`)
    }
    assets.push(record)
  }
  if (missingCount > 0) {
    throw new Error(
      `无法创建可恢复备份：有 ${missingCount} 个笔记附件缺失。请先检查存储健康，再重新导出。`,
    )
  }
  return assets
}

export async function buildExportPayload(): Promise<ExportPayload> {
  const { trades, weeklyReviews, quickNotes, strategies, starredIds, subscribedIds, pinnedStrategyIds, display, tagPresets, mistakeTagPresets, profile, savedTradeViews, symbolIcons, symbolCatalog, reviewTemplates } =
    useStore.getState()
  const storage = getStorage()
  return buildExportPayloadFromState(
    {
      trades,
      weeklyReviews,
      quickNotes,
      strategies,
      starredIds,
      subscribedIds,
      pinnedStrategyIds,
      display,
      shortcuts: bindingsForPersist(useShortcutStore.getState().bindings),
      tagPresets,
      mistakeTagPresets,
      profile,
      savedTradeViews,
      symbolIcons,
      symbolCatalog,
      reviewTemplates,
    },
    (id) => storage.getAssetForExport(id),
  )
}

export async function downloadExport(): Promise<void> {
  const storage = getStorage()
  const revisionBefore = (await storage.getSnapshotRevision?.()) ?? 0
  const operation = beginWebOperation('archive', {
    stage: 'export-json',
    revisionBefore,
    platform: isElectron() ? 'electron-renderer' : 'web',
  })
  try {
    await flushPersistNow()
    const revisionAfter = (await storage.getSnapshotRevision?.()) ?? revisionBefore
    const payload = await buildExportPayload()
    const json = serializeJsonExportPayload(payload)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const date = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `linear-journal-backup-${date}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    operation.success({ stage: 'downloaded', revisionAfter })
  } catch (error) {
    operation.failure(error, { stage: 'export-json' })
    throw error
  }
}

export function serializeJsonExportPayload(payload: unknown): string {
  if (!isRecord(payload)) throw new JsonImportBudgetError('json-contract-invalid')
  if (typeof payload.version !== 'number' || payload.version < 1 || payload.version > EXPORT_VERSION) {
    throw new JsonImportBudgetError('json-contract-invalid')
  }
  try {
    assertJsonEntityBudget(payload)
    const snapshot = decodeCanonicalSnapshot(payload, { version: payload.version, label: 'JSON export' })
    normalizeAndValidateImportAssets([
      ...snapshot.trades.map((trade) => trade.note),
      ...(snapshot.weeklyReviews ?? []).map((review) => review.contentHtml),
      ...(snapshot.quickNotes ?? []).map((note) => note.contentHtml),
    ], payload.assets)
  } catch (error) {
    if (error instanceof JsonImportBudgetError) throw error
    throw new JsonImportBudgetError('json-contract-invalid', error)
  }
  return serializeJsonDocumentWithinFileBudget(payload)
}

function serializeJsonDocumentWithinFileBudget(payload: unknown): string {
  assertJsonFileByteBudget(estimatePrettyJsonUtf8Bytes(payload))
  const json = JSON.stringify(payload, null, 2)
  return json
}

/**
 * Web 端导出 .journal.zip — 主力备份格式。
 * 包含 data.json（元数据）+ assets/ 目录（图片原始二进制）。
 * 图片按原始格式存储，无 base64 膨胀，适合大量图片场景。
 */
export async function downloadWebJournalZip(): Promise<void> {
  const storage = getStorage()
  const revisionBefore = (await storage.getSnapshotRevision?.()) ?? 0
  const operation = beginWebOperation('archive', {
    stage: 'export-zip',
    revisionBefore,
    platform: isElectron() ? 'electron-renderer' : 'web',
  })
  try {
    await flushPersistNow()
    const revisionAfter = (await storage.getSnapshotRevision?.()) ?? revisionBefore
    const state = useStore.getState()
    const portableSnapshot = buildPortableSnapshotFromState(
      state,
      useShortcutStore.getState().bindings,
    )
    const assetIds = new Set(collectAssetIdsFromSnapshot(portableSnapshot))
    const assets = await loadReferencedAssetsForExport(
      assetIds,
      (id) => storage.getAssetForExport(id),
    )

    const zipBlob = buildWebJournalArchiveBlob(portableSnapshot, assets)
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement('a')
    const date = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `linear-journal-${date}.journal.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    operation.success({ stage: 'downloaded', revisionAfter })
  } catch (error) {
    operation.failure(error, { stage: 'export-zip' })
    throw error
  }
}

/**
 * 构建一个能被当前 Web 恢复器重新读取的完整归档。
 * 导出前即执行与解析器一致的附件类型、条目与容量检查，避免下载不可恢复的文件。
 */
export function buildWebJournalArchiveBlob(
  snapshot: PersistedSnapshot,
  assets: readonly ExportAssetRecord[],
  options: { recoveryOrphanAssetIds?: readonly string[] } = {},
): Blob {
  const referencedIds = new Set(collectAssetIdsFromSnapshot(snapshot))
  const recoveryOrphanAssetIds = [...new Set(options.recoveryOrphanAssetIds ?? [])]
  for (const id of recoveryOrphanAssetIds) {
    if (!isSafeAssetId(id)) throw new Error(`无法创建 Web 归档：恢复附件 ID ${id} 无效。`)
  }
  const allowedIds = new Set([...referencedIds, ...recoveryOrphanAssetIds])
  const assetById = new Map<string, ExportAssetRecord>()
  const normalizedAssets: Array<ExportAssetRecord & { extension: string }> = []

  for (const asset of assets) {
    if (!isSafeAssetId(asset.id)) {
      throw new Error('无法创建 Web 归档：附件 ID 无效。')
    }
    if (assetById.has(asset.id)) {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 重复。`)
    }
    const mime = normalizeWebJournalImageMime(asset.mime)
    const extension = webJournalExtensionForMime(mime)
    if (!mime || !extension) {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 不是受支持的图片。`)
    }
    if (!allowedIds.has(asset.id)) {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 未被任何笔记引用。`)
    }
    const normalized = { ...asset, mime, extension }
    assetById.set(asset.id, normalized)
    normalizedAssets.push(normalized)
  }

  for (const id of referencedIds) {
    if (!isSafeAssetId(id) || !assetById.has(id)) {
      throw new Error(`无法创建 Web 归档：笔记引用的附件 ${id} 缺失。`)
    }
  }

  for (const id of recoveryOrphanAssetIds) {
    if (!assetById.has(id)) {
      throw new Error(`无法创建 Web 归档：恢复附件 ${id} 缺少声明或字节。`)
    }
  }

  if (normalizedAssets.length + 1 > MAX_WEB_JOURNAL_ENTRY_COUNT) {
    throw new Error(`无法创建 Web 归档：条目超过 ${MAX_WEB_JOURNAL_ENTRY_COUNT} 个。`)
  }

  // 元数据不含 base64，只保留附件声明；二进制写入 assets/。
  const meta = {
    ...snapshot,
    version: EXPORT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    assets: normalizedAssets.map(({ id, mime }) => ({ id, mime })),
    ...(recoveryOrphanAssetIds.length > 0 ? { recoveryOrphanAssetIds } : {}),
  }
  const metaJson = new TextEncoder().encode(JSON.stringify(meta, null, 2))
  if (metaJson.byteLength > MAX_WEB_JOURNAL_ENTRY_BYTES) {
    throw new Error('无法创建 Web 归档：data.json 超过单文件容量限制。')
  }

  const entries: Array<{ name: string; data: Uint8Array }> = [
    { name: 'data.json', data: metaJson },
  ]
  let expandedBytes = metaJson.byteLength
  for (const asset of normalizedAssets) {
    if (asset.data.length > Math.ceil(MAX_WEB_JOURNAL_ENTRY_BYTES * 4 / 3) + 4) {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 超过单文件容量限制。`)
    }
    let data: Uint8Array
    try {
      data = base64ToBytes(asset.data)
    } catch {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 的内容已损坏。`)
    }
    if (data.byteLength > MAX_WEB_JOURNAL_ENTRY_BYTES) {
      throw new Error(`无法创建 Web 归档：附件 ${asset.id} 超过单文件容量限制。`)
    }
    expandedBytes += data.byteLength
    if (expandedBytes > MAX_WEB_JOURNAL_EXPANDED_BYTES) {
      throw new Error('无法创建 Web 归档：归档解压后超过容量限制。')
    }
    entries.push({ name: `assets/${asset.id}.${asset.extension}`, data })
  }

  const archive = buildZipBlob(entries)
  if (archive.size > MAX_WEB_JOURNAL_ARCHIVE_BYTES) {
    throw new Error('无法创建 Web 归档：压缩包超过容量限制。')
  }
  return archive
}

// ---- minimal ZIP builder (stored, no compression) ----

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function buildZipBlob(entries: { name: string; data: Uint8Array }[]): Blob {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const centralDir: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const compressed = entry.data // stored, no compression
    const crc = crc32(entry.data)

    // Local file header
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(localHeader.buffer)
    lv.setUint32(0, 0x04034b50, true)       // signature
    lv.setUint16(4, 20, true)                // version needed
    lv.setUint16(6, 0, true)                 // flags
    lv.setUint16(8, 0, true)                 // compression: stored
    lv.setUint16(10, 0, true)                // mod time
    lv.setUint16(12, 0, true)                // mod date
    lv.setUint32(14, crc, true)              // crc32
    lv.setUint32(18, compressed.length, true) // compressed size
    lv.setUint32(22, entry.data.length, true) // uncompressed size
    lv.setUint16(26, nameBytes.length, true)  // filename length
    lv.setUint16(28, 0, true)                 // extra field length
    localHeader.set(nameBytes, 30)
    parts.push(localHeader, compressed)
    offset += 30 + nameBytes.length + compressed.length

    // Central directory entry
    const cdEntry = new Uint8Array(46 + nameBytes.length)
    const cdv = new DataView(cdEntry.buffer)
    cdv.setUint32(0, 0x02014b50, true)
    cdv.setUint16(4, 20, true)
    cdv.setUint16(6, 20, true)
    cdv.setUint16(8, 0, true)
    cdv.setUint16(10, 0, true)
    cdv.setUint16(12, 0, true)
    cdv.setUint16(14, 0, true)
    cdv.setUint32(16, crc, true)
    cdv.setUint32(20, compressed.length, true)
    cdv.setUint32(24, entry.data.length, true)
    cdv.setUint16(28, nameBytes.length, true)
    cdv.setUint16(30, 0, true)
    cdv.setUint16(32, 0, true)
    cdv.setUint16(34, 0, true)
    cdv.setUint32(36, 0, true)
    cdv.setUint32(40, 0, true)
    cdv.setUint32(42, offset - (30 + nameBytes.length + compressed.length), true) // local header offset
    cdEntry.set(nameBytes, 46)
    centralDir.push(cdEntry)
  }

  const cdStart = parts.reduce((sum, p) => sum + p.length, 0)
  const cdSize = centralDir.reduce((sum, p) => sum + p.length, 0)
  parts.push(...centralDir)

  // End of central directory record
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, cdStart, true)
  ev.setUint16(20, 0, true)
  parts.push(eocd)

  // 合并所有 parts
  const totalLen = parts.reduce((s, p) => s + p.length, 0)
  const result = new Uint8Array(totalLen)
  let pos = 0
  for (const p of parts) {
    result.set(p, pos)
    pos += p.length
  }
  return new Blob([result], { type: 'application/zip' })
}

/** CRC32 查表法实现 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]!
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function parseImportJson(text: string): ImportResult {
  try {
    assertJsonFileByteBudget(utf8ByteLength(text))
  } catch (error) {
    if (error instanceof JsonImportBudgetError) return importFailure(error.code)
    return importFailure('json-file-too-large')
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return importFailure('json-contract-invalid')
  }

  if (!isRecord(raw)) {
    return importFailure('json-contract-invalid')
  }

  try {
    assertJsonEntityBudget(raw)
  } catch (error) {
    if (error instanceof JsonImportBudgetError) return importFailure(error.code)
    return importFailure('json-contract-invalid')
  }

  if (typeof raw.version !== 'number' || raw.version < 1 || raw.version > EXPORT_VERSION) {
    return importFailure('json-contract-invalid')
  }

  if (raw.trades !== undefined && !Array.isArray(raw.trades)) {
    return importFailure('json-contract-invalid')
  }

  if (raw.strategies !== undefined && !Array.isArray(raw.strategies)) {
    return importFailure('json-contract-invalid')
  }

  if (raw.starredIds !== undefined && !isStringArray(raw.starredIds)) {
    return importFailure('json-contract-invalid')
  }

  if (raw.subscribedIds !== undefined && !isStringArray(raw.subscribedIds)) {
    return importFailure('json-contract-invalid')
  }

  if (raw.pinnedStrategyIds !== undefined && !isStringArray(raw.pinnedStrategyIds)) {
    return importFailure('json-contract-invalid')
  }

  if (raw.display !== undefined && !isRecord(raw.display)) {
    return importFailure('json-contract-invalid')
  }

  // 旧备份中的 cases / disputeTypes 字段忽略（判例库已移除）

  if (raw.tagPresets !== undefined && !isStringArray(raw.tagPresets)) {
    return importFailure('json-contract-invalid')
  }

  if (raw.mistakeTagPresets !== undefined && !isStringArray(raw.mistakeTagPresets)) {
    return importFailure('json-contract-invalid')
  }

  let snapshotCandidate: PersistedSnapshot
  let assets: ExportAssetRecord[]
  try {
    snapshotCandidate = decodeCanonicalSnapshot(
      raw,
      { version: raw.version, label: 'JSON backup' },
    )
    assets = normalizeAndValidateImportAssets([
      ...snapshotCandidate.trades.map((trade) => trade.note),
      ...(snapshotCandidate.weeklyReviews ?? []).map((review) => review.contentHtml),
      ...(snapshotCandidate.quickNotes ?? []).map((note) => note.contentHtml),
    ], raw.assets)
  } catch (error) {
    if (error instanceof JsonImportBudgetError) return importFailure(error.code)
    return importFailure('json-contract-invalid')
  }

  return {
    ok: true,
    data: {
      version: raw.version,
      ...snapshotCandidate,
      assets: raw.assets === undefined ? undefined : assets,
    },
  }
}

export interface WebConflictRecoveryResult {
  missingAssetIds: string[]
  filename: string
}

export async function buildWebConflictRecoveryPayload(
  snapshot: PersistedSnapshot,
  getAssetForExport: (id: string) => Promise<ExportAssetRecord | null>,
): Promise<{
  payload: PersistedSnapshot & {
    version: number
    schemaVersion: number
    assets: ExportAssetRecord[]
    recovery: {
      kind: 'web-conflict-local-copy'
      complete: boolean
      missingAssetIds: string[]
      exportedAt: string
      warning: string
    }
  }
  missingAssetIds: string[]
}> {
  const assets: ExportAssetRecord[] = []
  const missingAssetIds: string[] = []
  for (const id of new Set(collectAssetIdsFromSnapshot(snapshot))) {
    if (id.startsWith(RECOVERY_MISSING_DRAFT_ASSET_PREFIX)) {
      missingAssetIds.push(id)
      continue
    }
    const asset = await getAssetForExport(id)
    if (asset) assets.push(asset)
    else missingAssetIds.push(id)
  }
  const complete = missingAssetIds.length === 0
  return {
    missingAssetIds,
    payload: {
      ...snapshot,
      version: EXPORT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      assets,
      recovery: {
        kind: 'web-conflict-local-copy',
        complete,
        missingAssetIds,
        exportedAt: new Date().toISOString(),
        warning: complete
          ? '这是 CAS 冲突时导出的本标签页副本，请人工确认后再恢复。'
          : '此副本缺少所列附件，不能视为完整备份。',
      },
    },
  }
}

/**
 * CAS 冲突后的本标签页抢救导出不触发 flush，也不要求当前标签页仍有写权限。
 * 它同时读取已提交附件和本标签页尚未提交的 prepared 附件；若存在缺失引用，
 * 文件名与 recovery 元数据都会明确标记 incomplete，绝不冒充完整可恢复备份。
 */
export async function downloadWebConflictRecoveryCopy(): Promise<WebConflictRecoveryResult> {
  try {
    await waitForPendingStorageOperations()
  } catch {
    // 冲突抢救仍应继续：失败的图片任务会留下 blob 草稿，随后被明确标记为缺失。
  }
  const snapshot = applyNoteDraftsToSnapshot(
    buildPortableSnapshotFromState(
      useStore.getState(),
      useShortcutStore.getState().bindings,
    ),
  )
  const storage = getStorage()
  const { payload, missingAssetIds } = await buildWebConflictRecoveryPayload(
    snapshot,
    (id) => storage.getAssetForExport(id),
  )
  const complete = missingAssetIds.length === 0
  const suffix = complete ? 'recovery' : 'recovery-incomplete'
  const filename = `linear-journal-${suffix}-${new Date().toISOString().slice(0, 10)}.json`
  const blob = new Blob([serializeJsonDocumentWithinFileBudget(payload)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return { missingAssetIds, filename }
}

/**
 * 导入附件一律重编号，避免同 ID 不同内容覆盖现有笔记；内嵌图片也只暂存，
 * 由适配器与最终快照一起提交。
 */
export function prepareImportPayloadForCommit(
  payload: ExportPayload,
  createId: () => string = () => crypto.randomUUID(),
): { payload: ExportPayload; assets: ExportAssetRecord[] } {
  const sourceAssets = normalizeAndValidateImportAssets([
    ...payload.trades.map((trade) => trade.note),
    ...(payload.weeklyReviews ?? []).map((review) => review.contentHtml),
    ...(payload.quickNotes ?? []).map((note) => note.contentHtml),
  ], payload.assets)
  const idMap = new Map<string, string>()
  const generatedIds = new Set<string>()
  const nextAssetId = (): string => {
    const id = createId()
    if (!isSafeAssetId(id)) throw new Error('无法为导入附件生成安全 ID')
    if (generatedIds.has(id)) throw new Error('导入附件生成了重复 ID')
    generatedIds.add(id)
    return id
  }
  const assets = sourceAssets.map((asset) => {
    const id = nextAssetId()
    idMap.set(asset.id, id)
    return { ...asset, id }
  })

  const rewriteHtml = (source: string): string => {
    let html = source.replace(
      /journal-asset:\/\/([^"'\s>]+)/g,
      (_full, id: string) => {
        const importedId = idMap.get(id)
        if (!importedId) throw new Error(`导入内容缺少附件：${id}`)
        return `journal-asset://${importedId}`
      },
    )
    IMPORT_DATA_IMAGE_RE.lastIndex = 0
    html = html.replace(
      IMPORT_DATA_IMAGE_RE,
      (_full, before: string, mime: string, data: string, after: string) => {
        const normalizedMime = normalizeWebJournalImageMime(mime)
        if (!normalizedMime || !isStrictBase64(data)) {
        throw new Error('正文中的内嵌图片内容已损坏')
        }
        const id = nextAssetId()
        assets.push({ id, mime: normalizedMime, data })
        return `<img${before} src="journal-asset://${id}"${after}>`
      },
    )
    return html
  }
  const trades = payload.trades.map((trade) => ({ ...trade, note: rewriteHtml(trade.note) }))
  const weeklyReviews = payload.weeklyReviews?.map((review) => ({
    ...review,
    contentHtml: rewriteHtml(review.contentHtml),
  }))
  const quickNotes = payload.quickNotes?.map((note) => ({
    ...note,
    contentHtml: rewriteHtml(note.contentHtml),
  }))

  return {
    payload: { ...payload, trades, weeklyReviews, quickNotes, assets },
    assets,
  }
}

interface PersistedStateRevision {
  state: ReturnType<typeof useStore.getState>
  shortcutBindings: ReturnType<typeof useShortcutStore.getState>['bindings']
  references: readonly unknown[]
}

function capturePersistedStateRevision(): PersistedStateRevision {
  const state = useStore.getState()
  const shortcutBindings = useShortcutStore.getState().bindings
  return {
    state,
    shortcutBindings,
    references: [
      ...PERSISTED_STATE_REFERENCE_KEYS.map((key) => state[key]),
      shortcutBindings,
    ],
  }
}

function hasSamePersistedStateRevision(
  previous: PersistedStateRevision,
  next: PersistedStateRevision,
): boolean {
  return previous.references.every((value, index) => value === next.references[index])
}

function captureImportedTradeBaseline(
  revision: PersistedStateRevision,
  payload: ExportPayload,
): Map<string, string | null> {
  const currentById = new Map(revision.state.trades.map((trade) => [trade.id, trade]))
  return new Map(
    payload.trades.map((trade) => {
      const current = currentById.get(trade.id)
      return [trade.id, current ? JSON.stringify(current) : null]
    }),
  )
}

function hasConcurrentImportedTradeConflict(
  baseline: Map<string, string | null>,
  latest: PersistedStateRevision,
): boolean {
  const latestById = new Map(latest.state.trades.map((trade) => [trade.id, trade]))
  for (const [id, initialValue] of baseline) {
    const current = latestById.get(id)
    const currentValue = current ? JSON.stringify(current) : null
    if (currentValue !== initialValue) return true
  }
  return false
}

function buildImportSnapshot(
  current: PersistedStateRevision,
  payload: ExportPayload,
): PersistedSnapshot {
  const merged = mergeImportPayload(current.state, payload)
  return buildPortableSnapshotFromState({
    ...current.state,
    ...merged,
    tagPresets: merged.tagPresets ?? current.state.tagPresets,
    mistakeTagPresets: merged.mistakeTagPresets ?? current.state.mistakeTagPresets,
    savedTradeViews: merged.savedTradeViews ?? current.state.savedTradeViews,
    symbolIcons: merged.symbolIcons ?? current.state.symbolIcons,
    symbolCatalog: merged.symbolCatalog ?? current.state.symbolCatalog,
    reviewTemplates: merged.reviewTemplates ?? current.state.reviewTemplates,
    profile: current.state.profile,
  }, current.shortcutBindings)
}

export async function applyImport(payload: ExportPayload): Promise<{ summary: string }> {
  const storage = getStorage()
  const prepared = prepareImportPayloadForCommit(payload)
  const unlockInteraction = lockStorageCutoverInteraction()
  let suspended = false
  try {
    await flushStorageBeforeCutover()
    suspendPersist()
    suspended = true
    let revision = capturePersistedStateRevision()
    const importedTradeBaseline = captureImportedTradeBaseline(revision, prepared.payload)
    while (true) {
      const snapshot = buildImportSnapshot(revision, prepared.payload)
      await storage.commitImport(snapshot, prepared.assets)

      const latest = capturePersistedStateRevision()
      if (hasSamePersistedStateRevision(revision, latest)) {
        // 读取、合并与 setState 之间没有 await；不会再让用户事件插入并被整体快照覆盖。
        applySnapshotToStore(snapshot)
        break
      }
      if (hasConcurrentImportedTradeConflict(importedTradeBaseline, latest)) {
        // 正常界面在整段提交期间已被冻结；这里是防御性补偿，确保异常后台修改时
        // 磁盘也恢复到最新本地状态，并由 commitImport 清理本批未引用附件。
        const localSnapshot = buildPortableSnapshotFromState(
          latest.state,
          latest.shortcutBindings,
        )
        await storage.commitImport(localSnapshot, prepared.assets, { pruneUnreferenced: true })
        throw new Error(
          '导入已取消：检测到相同交易存在等待期间的本地编辑，本地内容已保留，请重新导入。',
        )
      }
      revision = latest
    }

    const parts: string[] = [`${prepared.payload.trades.length} 笔交易`]
    if (prepared.assets.length > 0) parts.push(`${prepared.assets.length} 个附件`)
    return { summary: `已导入 ${parts.join('、')}` }
  } finally {
    if (suspended) await resumePersistAndFlush()
    unlockInteraction()
  }
}

export function applySnapshotToStore(snapshot: PersistedSnapshot): void {
  const normalized = normalizeTradeStrategyReferences(snapshot.trades, snapshot.strategies)
  const trades = normalizeTrades(normalized.trades)
  useStore.setState({
    trades,
    weeklyReviews: normalizeWeeklyReviews(snapshot.weeklyReviews),
    quickNotes: normalizeQuickNotes(snapshot.quickNotes),
    strategies: normalized.strategies,
    starredIds: snapshot.starredIds,
    subscribedIds: snapshot.subscribedIds,
    pinnedStrategyIds: snapshot.pinnedStrategyIds,
    display: normalizeDisplay(snapshot.display),
    tagPresets: mergeTagPresets(snapshot.tagPresets ?? []),
    mistakeTagPresets: mergeTagPresets(snapshot.mistakeTagPresets ?? []),
    savedTradeViews: normalizeSavedTradeViews(snapshot.savedTradeViews),
    symbolIcons: normalizeSymbolIcons(snapshot.symbolIcons),
    symbolCatalog: normalizeSymbolCatalog(
      snapshot.symbolCatalog ?? [
        ...Object.keys(normalizeSymbolIcons(snapshot.symbolIcons)),
        ...trades.map((trade) => trade.symbol),
      ],
    ),
    reviewTemplates: normalizeReviewTemplates(snapshot.reviewTemplates),
    undoStack: [],
    redoStack: [],
  })
  useStore.getState().hydrateProfile(snapshot.profile ?? createDefaultUserProfile())
  useShortcutStore.getState().hydrateBindings(snapshot.shortcuts)
}

/** 空库 / 新建库时重置到默认内存状态。 */
export function resetEmptyLibraryIntoStore(): void {
  useStore.setState({
    trades: [],
    weeklyReviews: [],
    quickNotes: [],
    strategies: DEFAULT_STRATEGIES.map((strategy) => ({ ...strategy })),
    selectedId: null,
    composerOpen: false,
    composerTrade: null,
    composerKind: null,
    closeTradeRequest: null,
    undoStack: [],
    redoStack: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    tagPresets: createDefaultTagPresets(),
    mistakeTagPresets: createDefaultMistakeTagPresets(),
    display: { ...DEFAULT_DISPLAY },
    savedTradeViews: [],
    symbolIcons: {},
    symbolCatalog: [...DEFAULT_SYMBOL_CATALOG],
    reviewTemplates: createDefaultReviewTemplates(),
  })
  useStore.getState().hydrateProfile(createDefaultUserProfile())
  useShortcutStore.getState().hydrateBindings({})
}

export function clearSessionUiAfterLibrarySwitch(): void {
  useStore.setState({
    selectedId: null,
    composerOpen: false,
    composerTrade: null,
    composerKind: null,
    closeTradeRequest: null,
    undoStack: [],
    redoStack: [],
  })
  useShortcutStore.setState({ listContext: null, lightbox: null })
  useSaveStatus.getState().reset()
}

async function flushCurrentLibraryAtStableRevision(): Promise<PersistedStateRevision> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await waitForPendingStorageOperations()
    const before = capturePersistedStateRevision()
    await flushPersistNow()
    const after = capturePersistedStateRevision()
    if (hasSamePersistedStateRevision(before, after)) return after
  }
  throw new Error('切换期间内容持续变化，请停止编辑后重试')
}

/**
 * 设置内切换活跃库：先保存当前库，再打开/新建目录，最后重载快照到 store。
 * 挂起 persist，避免切换瞬间把旧内存写入新路径。
 * @param libPath 已选目录；省略则弹出系统文件夹选择器。
 */
export async function switchActiveLibrary(
  mode: 'open' | 'create',
  libPath?: string,
): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }> {
  if (!isElectron()) return { ok: false, error: '仅桌面端支持切换库目录' }
  const bridge = getJournalBridge()
  if (!bridge) return { ok: false, error: 'Electron bridge is not available' }

  const picked = libPath ?? (await bridge.pickLibraryFolder())
  if (!picked) return { ok: false, canceled: true }

  const previousPath = await bridge.getLibraryPath()
  let prepared: Awaited<ReturnType<typeof bridge.prepareLibrarySwitch>>
  try {
    prepared = await bridge.prepareLibrarySwitch(picked, mode)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '候选交易库准备失败',
    }
  }
  if (!prepared.ok) {
    return { ok: false, error: prepared.error ?? '候选交易库准备失败' }
  }

  const unlockInteraction = lockStorageCutoverInteraction()
  suspendPersist()
  let safeToFlush = false
  let candidateActivated = false
  try {
    const stableRevision = await flushCurrentLibraryAtStableRevision()
    const result = await bridge.activatePreparedLibrary(prepared.token)
    if (!result.ok) {
      safeToFlush = await bridge.getLibraryPath().then(
        (activePath) => activePath === previousPath,
        () => false,
      )
      const message =
        mode === 'open' && 'error' in result && typeof result.error === 'string' && result.error
          ? result.error
          : '切换库失败'
      return {
        ok: false,
        error: safeToFlush
          ? message
          : `${message}；交易库状态已变化，为保护数据已暂停自动保存，请重新启动应用`,
      }
    }

    candidateActivated = true
    if (!hasSamePersistedStateRevision(stableRevision, capturePersistedStateRevision())) {
      throw new Error('切库激活期间内容发生变化')
    }
    getElectronAdapter().clearObjectUrlCache()

    const snapshot = result.snapshot
    if (snapshot) {
      applySnapshotToStore(snapshot)
      clearSessionUiAfterLibrarySwitch()
    } else {
      resetEmptyLibraryIntoStore()
      useSaveStatus.getState().reset()
    }

    safeToFlush = true
    return { ok: true, path: await bridge.getLibraryPath() }
  } catch (err) {
    safeToFlush = candidateActivated
      ? false
      : await bridge.getLibraryPath().then(
          (activePath) => activePath === previousPath,
          () => false,
        )
    return {
      ok: false,
      error: safeToFlush
        ? (err instanceof Error ? err.message : '切换库时发生错误')
        : '新交易库载入失败；为保护数据已暂停自动保存，请重新启动应用',
    }
  } finally {
    if (!candidateActivated) {
      await bridge.cancelPreparedLibrary(prepared.token).catch(() => false)
    }
    unlockInteraction()
    if (safeToFlush) {
      await resumePersistAndFlush()
    } else {
      discardPendingAndResumePersist()
      disablePersistWrites()
      useSaveStatus.getState().setError('新交易库载入失败，自动保存已暂停')
      try {
        window.location?.reload()
      } catch {
        /* 非浏览器测试环境没有 location；正式客户端会立即重新载入当前资料库。 */
      }
    }
  }
}

export async function exportJournalArchive(): Promise<{ ok: boolean; path?: string }> {
  if (!isElectron()) return { ok: false }
  await flushPersistNow()
  const result = await getJournalBridge()!.exportJournalZip()
  return result.ok ? { ok: true, path: result.path } : { ok: false }
}

/** 桌面端：整库替换导入 .journal.zip */
export async function importJournalArchive(): Promise<{
  ok: boolean
  canceled?: boolean
  error?: string
}> {
  if (!isElectron()) return { ok: false, error: 'Electron bridge is not available' }
  const unlockInteraction = lockStorageCutoverInteraction()
  let suspended = false
  let safeToFlush = true
  try {
    await flushStorageBeforeCutover()
    suspendPersist()
    suspended = true
    const result = await getJournalBridge()!.importJournalZip()
    if (!result.ok) {
      console.error('[importJournalArchive] result not ok', result.error)
      return { ok: false, canceled: result.canceled, error: result.error }
    }
    // ok 表示 bridge 已完成磁盘替换；即使返回快照异常也不得再写回旧内存。
    safeToFlush = false
    if (!result.snapshot) {
      console.error('[importJournalArchive] snapshot is null after import')
      return { ok: false, error: 'Imported archive did not contain a readable snapshot' }
    }
    getElectronAdapter().clearObjectUrlCache()
    const manifest = await getStorage().getManifest()
    clearReviewSessionStorage(manifest.libraryId)
    applySnapshotToStore(result.snapshot)
    clearSessionUiAfterLibrarySwitch()
    safeToFlush = true
    return { ok: true }
  } finally {
    try {
      if (suspended) {
        if (safeToFlush) {
          await resumePersistAndFlush()
        } else {
          discardPendingAndResumePersist()
          disablePersistWrites()
          useSaveStatus.getState().setError('完整恢复后的内存载入失败，自动保存已暂停')
          try {
            window.location?.reload()
          } catch {
            /* 正式客户端会重新载入已经替换的资料库。 */
          }
        }
      }
    } finally {
      unlockInteraction()
    }
  }
}

/** 浏览器端：用已经完整校验的 Web 归档精确替换当前交易库。 */
export async function restoreWebJournalArchive(
  archive: ParsedWebJournalArchive,
): Promise<{ summary: string }> {
  if (isElectron()) throw new Error('浏览器归档恢复仅在 Web 存储中可用')

  const unlockInteraction = lockStorageCutoverInteraction()
  let suspended = false
  let safeToFlush = true
  try {
    await flushStorageBeforeCutover()
    suspendPersist()
    suspended = true

    await getIndexedDbAdapter().replaceArchive(
      archive.snapshot,
      archive.assets,
      archive.recoveryOrphanAssetIds ?? [],
    )
    // 从这里到内存快照完成切换前，不能让旧内存重新写回已经替换的新库。
    safeToFlush = false
    const manifest = await getIndexedDbAdapter().getManifest()
    clearReviewSessionStorage(manifest.libraryId)
    applySnapshotToStore(archive.snapshot)
    clearSessionUiAfterLibrarySwitch()
    safeToFlush = true

    const parts = [`${archive.snapshot.trades.length} 条记录`]
    if (archive.assets.length > 0) parts.push(`${archive.assets.length} 个附件`)
    return { summary: `已恢复 ${parts.join('、')}` }
  } finally {
    try {
      if (suspended) {
        if (safeToFlush) {
          await resumePersistAndFlush()
        } else {
          discardPendingAndResumePersist()
          disablePersistWrites()
          useSaveStatus.getState().setError('完整恢复后的内存载入失败，自动保存已暂停')
          try {
            window.location?.reload()
          } catch {
            /* 正式浏览器会重新载入已经原子提交的新资料库。 */
          }
        }
      }
    } finally {
      unlockInteraction()
    }
  }
}

export async function getLibraryPath(): Promise<string | null> {
  if (!isElectron()) return null
  return getJournalBridge()!.getLibraryPath()
}
