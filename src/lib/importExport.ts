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
  isValidPersistedTrade,
} from '@/storage/snapshotValidation'

export const EXPORT_VERSION = WEB_JOURNAL_EXPORT_VERSION // 8: +quickNotes

export interface ExportPayload {
  version: number
  trades: (Trade & { strategy?: string })[]
  weeklyReviews?: WeeklyReview[]
  quickNotes?: QuickNote[]
  strategies: Strategy[]
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: DisplayPrefs
  tagPresets?: string[]
  mistakeTagPresets?: string[]
  savedTradeViews?: SavedTradeView[]
  symbolIcons?: SymbolIconsMap
  symbolCatalog?: string[]
  reviewTemplates?: ReviewTemplate[]
  assets?: ExportAssetRecord[]
}

export interface PersistedSlice {
  trades: Trade[]
  weeklyReviews?: WeeklyReview[]
  quickNotes?: QuickNote[]
  strategies: Strategy[]
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: DisplayPrefs
  tagPresets?: string[]
  mistakeTagPresets?: string[]
  savedTradeViews?: SavedTradeView[]
  symbolIcons?: SymbolIconsMap
  symbolCatalog?: string[]
  reviewTemplates?: ReviewTemplate[]
}

interface ExportState extends PersistedSlice {
  tagPresets?: string[]
  mistakeTagPresets?: string[]
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
    tagPresets: state.tagPresets,
    mistakeTagPresets: state.mistakeTagPresets,
    profile: state.profile,
    savedTradeViews: normalizeSavedTradeViews(state.savedTradeViews),
    symbolIcons: normalizeSymbolIcons(state.symbolIcons),
    symbolCatalog: normalizeSymbolCatalog(state.symbolCatalog),
    reviewTemplates: normalizeReviewTemplates(state.reviewTemplates),
    ...(Object.keys(shortcuts).length > 0 ? { shortcuts } : {}),
  }
}

export type ImportResult =
  | { ok: true; data: ExportPayload }
  | { ok: false; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function normalizeLegacyImportTrade(
  value: unknown,
): (Trade & { strategy?: string }) | null {
  if (!isRecord(value)) return null
  const strategyId = typeof value.strategyId === 'string'
    ? value.strategyId
    : value.strategy
  const tradeKind = value.tradeKind === 'practice' ? 'paper' : value.tradeKind
  const candidate = { ...value, strategyId, tradeKind }
  return isValidPersistedTrade(candidate)
    ? candidate as Trade & { strategy?: string }
    : null
}

function parseDisplay(v: unknown): DisplayPrefs {
  if (!isRecord(v)) return { ...DEFAULT_DISPLAY }
  return normalizeDisplay(v as Partial<DisplayPrefs>)
}

const STRICT_BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const IMPORT_DATA_IMAGE_SRC_RE = /<img\b[^>]*\ssrc=["'](data:[^"']*)["'][^>]*>/gi
const IMPORT_DATA_IMAGE_RE = /<img([^>]*)\ssrc=["']data:([^;,"']+);base64,([^"']+)["']([^>]*)>/gi

function isStrictBase64(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !STRICT_BASE64_RE.test(value)
  ) return false

  if (value.endsWith('==')) {
    return BASE64_ALPHABET.indexOf(value[value.length - 3] ?? '') % 16 === 0
  }
  if (value.endsWith('=')) {
    return BASE64_ALPHABET.indexOf(value[value.length - 2] ?? '') % 4 === 0
  }
  return true
}

function assertValidInlineImportImages(htmlEntries: readonly string[]): void {
  for (const html of htmlEntries) {
    IMPORT_DATA_IMAGE_SRC_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = IMPORT_DATA_IMAGE_SRC_RE.exec(html)) !== null) {
      const parsed = /^data:([^;,]+);base64,(.*)$/i.exec(match[1] ?? '')
      const mime = normalizeWebJournalImageMime(parsed?.[1])
      if (!parsed || !mime) {
        throw new Error('正文中的内嵌附件不是受支持的图片')
      }
      if (!isStrictBase64(parsed[2])) {
        throw new Error('交易笔记中的内嵌图片内容已损坏')
      }
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
  for (const v of value ?? []) {
    if (!isRecord(v) || !isSafeAssetId(v.id)) {
      throw new Error('assets 中存在非法附件 ID')
    }
    if (assetIds.has(v.id)) {
      throw new Error(`assets 中存在重复附件 ID：${v.id}`)
    }
    const mime = normalizeWebJournalImageMime(v.mime)
    if (!mime) throw new Error(`附件 ${v.id} 不是受支持的图片`)
    if (!isStrictBase64(v.data)) throw new Error(`附件 ${v.id} 的内容已损坏`)
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
  assertValidInlineImportImages(htmlEntries)
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
    tagPresets: state.tagPresets,
    mistakeTagPresets: state.mistakeTagPresets,
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
  const { trades, weeklyReviews, quickNotes, strategies, starredIds, subscribedIds, pinnedStrategyIds, display, tagPresets, mistakeTagPresets, savedTradeViews, symbolIcons, symbolCatalog, reviewTemplates } =
    useStore.getState()
  const storage = getStorage()
  return buildExportPayloadFromState(
    { trades, weeklyReviews, quickNotes, strategies, starredIds, subscribedIds, pinnedStrategyIds, display, tagPresets, mistakeTagPresets, savedTradeViews, symbolIcons, symbolCatalog, reviewTemplates },
    (id) => storage.getAssetForExport(id),
  )
}

export async function downloadExport(): Promise<void> {
  await flushPersistNow()
  const payload = await buildExportPayload()
  const json = JSON.stringify(payload, null, 2)
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
}

/**
 * Web 端导出 .journal.zip — 主力备份格式。
 * 包含 data.json（元数据）+ assets/ 目录（图片原始二进制）。
 * 图片按原始格式存储，无 base64 膨胀，适合大量图片场景。
 */
export async function downloadWebJournalZip(): Promise<void> {
  await flushPersistNow()
  const state = useStore.getState()
  const portableSnapshot = buildPortableSnapshotFromState(
    state,
    useShortcutStore.getState().bindings,
  )
  const storage = getStorage()
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
}

/**
 * 构建一个能被当前 Web 恢复器重新读取的完整归档。
 * 导出前即执行与解析器一致的附件类型、条目与容量检查，避免下载不可恢复的文件。
 */
export function buildWebJournalArchiveBlob(
  snapshot: PersistedSnapshot,
  assets: readonly ExportAssetRecord[],
): Blob {
  const referencedIds = new Set(collectAssetIdsFromSnapshot(snapshot))
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
    if (!referencedIds.has(asset.id)) {
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

  if (normalizedAssets.length + 1 > MAX_WEB_JOURNAL_ENTRY_COUNT) {
    throw new Error(`无法创建 Web 归档：条目超过 ${MAX_WEB_JOURNAL_ENTRY_COUNT} 个。`)
  }

  // 元数据不含 base64，只保留附件声明；二进制写入 assets/。
  const meta = {
    ...snapshot,
    version: EXPORT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    assets: normalizedAssets.map(({ id, mime }) => ({ id, mime })),
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
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '无法解析 JSON 文件' }
  }

  if (!isRecord(raw)) {
    return { ok: false, error: '备份文件格式无效' }
  }

  if (typeof raw.version !== 'number' || raw.version < 1 || raw.version > EXPORT_VERSION) {
    return { ok: false, error: `不支持的备份版本（当前支持 1–${EXPORT_VERSION}）` }
  }

  if (!Array.isArray(raw.trades)) {
    return { ok: false, error: '缺少 trades 数组' }
  }

  const trades = raw.trades.map(normalizeLegacyImportTrade)
  if (trades.some((trade) => trade === null)) {
    return { ok: false, error: 'trades 数据格式不正确' }
  }

  if (raw.strategies !== undefined && !Array.isArray(raw.strategies)) {
    return { ok: false, error: 'strategies 必须是数组' }
  }

  if (raw.starredIds !== undefined && !isStringArray(raw.starredIds)) {
    return { ok: false, error: 'starredIds 必须是字符串数组' }
  }

  if (raw.subscribedIds !== undefined && !isStringArray(raw.subscribedIds)) {
    return { ok: false, error: 'subscribedIds 必须是字符串数组' }
  }

  if (raw.pinnedStrategyIds !== undefined && !isStringArray(raw.pinnedStrategyIds)) {
    return { ok: false, error: 'pinnedStrategyIds 必须是字符串数组' }
  }

  // 旧备份中的 cases / disputeTypes 字段忽略（判例库已移除）

  if (raw.tagPresets !== undefined && !isStringArray(raw.tagPresets)) {
    return { ok: false, error: 'tagPresets 必须是字符串数组' }
  }

  if (raw.mistakeTagPresets !== undefined && !isStringArray(raw.mistakeTagPresets)) {
    return { ok: false, error: 'mistakeTagPresets 必须是字符串数组' }
  }

  const snapshotCandidate: unknown = {
    trades,
    weeklyReviews: raw.weeklyReviews ?? [],
    quickNotes: raw.quickNotes ?? [],
    strategies: raw.strategies ?? [],
    starredIds: raw.starredIds ?? [],
    subscribedIds: raw.subscribedIds ?? [],
    pinnedStrategyIds: raw.pinnedStrategyIds ?? [],
    display: parseDisplay(raw.display),
    tagPresets: raw.tagPresets,
    mistakeTagPresets: raw.mistakeTagPresets,
    savedTradeViews: raw.savedTradeViews,
    symbolIcons: raw.symbolIcons,
    symbolCatalog: raw.symbolCatalog,
    reviewTemplates: raw.reviewTemplates,
  }
  let assets: ExportAssetRecord[]
  try {
    assertValidPersistedSnapshot(snapshotCandidate, 'JSON backup')
    assets = normalizeAndValidateImportAssets([
      ...snapshotCandidate.trades.map((trade) => trade.note),
      ...(snapshotCandidate.weeklyReviews ?? []).map((review) => review.contentHtml),
      ...(snapshotCandidate.quickNotes ?? []).map((note) => note.contentHtml),
    ], raw.assets)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '备份内容结构损坏',
    }
  }

  return {
    ok: true,
    data: {
      version: raw.version,
      trades: snapshotCandidate.trades,
      weeklyReviews: normalizeWeeklyReviews(snapshotCandidate.weeklyReviews),
      quickNotes: normalizeQuickNotes(snapshotCandidate.quickNotes),
      strategies: snapshotCandidate.strategies,
      starredIds: snapshotCandidate.starredIds,
      subscribedIds: snapshotCandidate.subscribedIds,
      pinnedStrategyIds: snapshotCandidate.pinnedStrategyIds,
      display: snapshotCandidate.display,
      assets: raw.assets === undefined ? undefined : assets,
      tagPresets: snapshotCandidate.tagPresets ?? [],
      mistakeTagPresets: snapshotCandidate.mistakeTagPresets ?? [],
      savedTradeViews: normalizeSavedTradeViews(snapshotCandidate.savedTradeViews),
      symbolIcons: normalizeSymbolIcons(snapshotCandidate.symbolIcons),
      symbolCatalog: normalizeSymbolCatalog(
        snapshotCandidate.symbolCatalog ?? [
          ...Object.keys(normalizeSymbolIcons(snapshotCandidate.symbolIcons)),
          ...snapshotCandidate.trades.map((trade) => trade.symbol),
        ],
      ),
      reviewTemplates: normalizeReviewTemplates(snapshotCandidate.reviewTemplates),
    },
  }
}

function mergeStrategies(current: Strategy[], imported: Strategy[]): Strategy[] {
  const map = new Map(current.map((s) => [s.id, s]))
  for (const s of imported) {
    map.set(s.id, s)
  }
  return Array.from(map.values())
}

export function mergeImportPayload(current: PersistedSlice, payload: ExportPayload): PersistedSlice {
  const combinedStrategies = mergeStrategies(
    current.strategies,
    ensureStrategies(payload.strategies),
  )
  const { strategies, trades: migrated } = normalizeTradeStrategyReferences(
    payload.trades,
    combinedStrategies,
  )
  const tradeMap = new Map(current.trades.map((t) => [t.id, t]))
  for (const t of migrated) {
    tradeMap.set(t.id, t)
  }
  const trades = normalizeTrades(Array.from(tradeMap.values()))
  const weeklyReviews = normalizeWeeklyReviews([
    ...(current.weeklyReviews ?? []),
    ...(payload.weeklyReviews ?? []),
  ])
  const quickNotes = mergeQuickNotes(
    current.quickNotes ?? [],
    payload.quickNotes ?? [],
  )
  const templatesById = new Map(
    normalizeReviewTemplates(current.reviewTemplates ?? []).map((template) => [template.id, template]),
  )
  for (const template of payload.reviewTemplates === undefined
    ? []
    : normalizeReviewTemplates(payload.reviewTemplates)) {
    if (!templatesById.has(template.id)) templatesById.set(template.id, template)
  }
  return {
    strategies,
    trades,
    weeklyReviews,
    quickNotes,
    starredIds: [...new Set([...current.starredIds, ...payload.starredIds])],
    subscribedIds: [...new Set([...current.subscribedIds, ...payload.subscribedIds])],
    pinnedStrategyIds: [
      ...new Set([...current.pinnedStrategyIds, ...payload.pinnedStrategyIds]),
    ],
    display: normalizeDisplay({ ...current.display, ...payload.display }),
    tagPresets: mergeTagPresets(
      current.tagPresets ?? [],
      payload.tagPresets ?? [],
    ),
    mistakeTagPresets: mergeTagPresets(
      current.mistakeTagPresets ?? [],
      payload.mistakeTagPresets ?? [],
    ),
    savedTradeViews: mergeSavedTradeViews(
      current.savedTradeViews ?? [],
      payload.savedTradeViews ?? [],
    ),
    symbolIcons: mergeSymbolIcons(
      current.symbolIcons ?? {},
      payload.symbolIcons ?? {},
    ),
    symbolCatalog: mergeSymbolCatalog(
      current.symbolCatalog ?? [],
      payload.symbolCatalog ?? [],
    ),
    reviewTemplates: Array.from(templatesById.values()),
  }
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

    await getIndexedDbAdapter().replaceArchive(archive.snapshot, archive.assets)
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
