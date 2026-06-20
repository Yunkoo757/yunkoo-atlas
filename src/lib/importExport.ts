import type { Strategy } from '@/data/strategies'
import type { Trade, TradeStatus, TradeSide, Conviction, TradeKind } from '@/data/trades'
import { DEFAULT_DISPLAY, normalizeDisplay, type DisplayPrefs } from '@/lib/tradeFilters'
import { ensureStrategies, migrateTrades } from '@/lib/strategies'
import { normalizeTrades } from '@/lib/tradeKind'
import { useStore } from '@/store/useStore'
import {
  collectAssetIdsFromNotes,
  externalizeNoteImages,
  getStorage,
} from '@/storage'
import type { ExportAssetRecord } from '@/storage/types'
import { flushPersistNow } from '@/storage/persist'
import { isElectron, getJournalBridge } from '@/storage/runtime'
import type { PersistedSnapshot } from '@/storage/types'

export const EXPORT_VERSION = 4 // 4: +shortcuts bindings, +tradeKind activities

export interface ExportPayload {
  version: number
  trades: (Trade & { strategy?: string })[]
  strategies: Strategy[]
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: DisplayPrefs
  assets?: ExportAssetRecord[]
}

export interface PersistedSlice {
  trades: Trade[]
  strategies: Strategy[]
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: DisplayPrefs
}

export type ImportResult =
  | { ok: true; data: ExportPayload }
  | { ok: false; error: string }

const TRADE_STATUSES: TradeStatus[] = [
  'planned',
  'open',
  'missed',
  'win',
  'loss',
  'breakeven',
]
const TRADE_KINDS: TradeKind[] = ['live', 'paper']
const TRADE_SIDES: TradeSide[] = ['long', 'short']
const CONVICTIONS: Conviction[] = ['low', 'medium', 'high', 'urgent']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function isAssetRecord(v: unknown): v is ExportAssetRecord {
  if (!isRecord(v)) return false
  return typeof v.id === 'string' && typeof v.mime === 'string' && typeof v.data === 'string'
}

function isTrade(v: unknown): v is Trade & { strategy?: string } {
  if (!isRecord(v)) return false
  if (typeof v.id !== 'string' || !v.id) return false
  if (typeof v.ref !== 'string') return false
  if (typeof v.symbol !== 'string') return false
  if (!TRADE_SIDES.includes(v.side as TradeSide)) return false
  if (!TRADE_STATUSES.includes(v.status as TradeStatus)) return false
  if (!CONVICTIONS.includes(v.conviction as Conviction)) return false
  if (typeof v.strategyId !== 'string' && typeof v.strategy !== 'string') return false
  if (!Array.isArray(v.tags) || !v.tags.every((t) => typeof t === 'string')) return false
  if (typeof v.entry !== 'number') return false
  if (v.exit !== null && typeof v.exit !== 'number') return false
  if (typeof v.size !== 'number') return false
  if (typeof v.pnl !== 'number') return false
  if (typeof v.rMultiple !== 'number') return false
  if (typeof v.openedAt !== 'string') return false
  if (v.closedAt !== null && typeof v.closedAt !== 'string') return false
  if (typeof v.note !== 'string') return false
  if (
    v.tradeKind !== undefined &&
    v.tradeKind !== 'practice' &&
    !TRADE_KINDS.includes(v.tradeKind as TradeKind)
  ) {
    return false
  }
  return true
}

function isStrategy(v: unknown): v is Strategy {
  if (!isRecord(v)) return false
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.icon === 'string' &&
    typeof v.color === 'string'
  )
}

function parseDisplay(v: unknown): DisplayPrefs {
  if (!isRecord(v)) return { ...DEFAULT_DISPLAY }
  return normalizeDisplay(v as Partial<DisplayPrefs>)
}

export interface AssetStats {
  count: number
  totalBytes: number
  /** 格式化后的体积描述，如 "12.5 MB" */
  formattedSize: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 统计资产数量和总体积 */
export function estimateAssetStats(assets: ExportAssetRecord[]): AssetStats {
  let totalBytes = 0
  for (const a of assets) {
    // base64 解码后大小 ≈ 原始字节数 * 0.75
    totalBytes += Math.round(a.data.length * 0.75)
  }
  return {
    count: assets.length,
    totalBytes,
    formattedSize: formatBytes(totalBytes),
  }
}

/** 资产预警阈值 */
export const ASSET_WARN_COUNT = 10
export const ASSET_WARN_BYTES = 50 * 1024 * 1024 // 50 MB

export async function buildExportPayload(): Promise<ExportPayload> {
  const { trades, strategies, starredIds, subscribedIds, pinnedStrategyIds, display } =
    useStore.getState()
  const storage = getStorage()
  const assetIds = collectAssetIdsFromNotes(trades)
  const assets: ExportAssetRecord[] = []
  for (const id of assetIds) {
    const rec = await storage.getAssetForExport(id)
    if (rec) assets.push(rec)
  }
  return {
    version: EXPORT_VERSION,
    trades,
    strategies,
    starredIds,
    subscribedIds,
    pinnedStrategyIds,
    display,
    assets,
  }
}

export async function downloadExport(): Promise<AssetStats> {
  const payload = await buildExportPayload()
  const stats = estimateAssetStats(payload.assets ?? [])
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
  return stats
}

/**
 * Web 端导出 .journal.zip。
 * 包含 data.json（交易数据）+ assets/ 目录（图片原始二进制），
 * 比 JSON 内嵌 base64 更适合图片密集场景。
 */
export async function downloadWebJournalZip(): Promise<AssetStats> {
  const payload = await buildExportPayload()
  const assets = payload.assets ?? []
  const stats = estimateAssetStats(assets)

  // 构建不含 assets base64 的元数据（zip 中图片作为独立文件）
  const meta = { ...payload, assets: assets.map((a) => ({ id: a.id, mime: a.mime })) }
  const metaJson = new TextEncoder().encode(JSON.stringify(meta, null, 2))

  // 收集所有文件条目
  interface ZipEntry {
    name: string
    data: Uint8Array
  }
  const entries: ZipEntry[] = [
    { name: 'data.json', data: metaJson },
  ]
  for (const a of assets) {
    const bin = base64ToBytes(a.data)
    const ext = mimeToExt(a.mime)
    entries.push({ name: `assets/${a.id}.${ext}`, data: bin })
  }

  const zipBlob = buildZipBlob(entries)
  const url = URL.createObjectURL(zipBlob)
  const a = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `linear-journal-${date}.journal.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return stats
}

// ---- minimal ZIP builder (stored, no compression) ----

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  }
  return map[mime] ?? 'bin'
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

  if (!raw.trades.every(isTrade)) {
    return { ok: false, error: 'trades 数据格式不正确' }
  }

  if (raw.strategies !== undefined && !Array.isArray(raw.strategies)) {
    return { ok: false, error: 'strategies 必须是数组' }
  }

  if (raw.strategies && !raw.strategies.every(isStrategy)) {
    return { ok: false, error: 'strategies 数据格式不正确' }
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

  if (raw.assets !== undefined) {
    if (!Array.isArray(raw.assets) || !raw.assets.every(isAssetRecord)) {
      return { ok: false, error: 'assets 数据格式不正确' }
    }
  }

  return {
    ok: true,
    data: {
      version: raw.version,
      trades: raw.trades,
      strategies: raw.strategies ?? [],
      starredIds: raw.starredIds ?? [],
      subscribedIds: raw.subscribedIds ?? [],
      pinnedStrategyIds: raw.pinnedStrategyIds ?? [],
      display: parseDisplay(raw.display),
      assets: raw.assets as ExportAssetRecord[] | undefined,
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
  const strategies = mergeStrategies(current.strategies, ensureStrategies(payload.strategies))
  const migrated = migrateTrades(payload.trades, strategies)
  const tradeMap = new Map(current.trades.map((t) => [t.id, t]))
  for (const t of migrated) {
    tradeMap.set(t.id, t)
  }
  return {
    strategies,
    trades: normalizeTrades(Array.from(tradeMap.values())),
    starredIds: [...new Set([...current.starredIds, ...payload.starredIds])],
    subscribedIds: [...new Set([...current.subscribedIds, ...payload.subscribedIds])],
    pinnedStrategyIds: [
      ...new Set([...current.pinnedStrategyIds, ...payload.pinnedStrategyIds]),
    ],
    display: { ...current.display, ...payload.display },
  }
}

export async function applyImport(payload: ExportPayload): Promise<void> {
  const storage = getStorage()
  if (payload.assets?.length) {
    await storage.importAssets(payload.assets)
  }

  const trades = await Promise.all(
    payload.trades.map(async (t) => ({
      ...t,
      note: await externalizeNoteImages(t.note, storage),
    })),
  )

  useStore.getState().importData({ ...payload, trades })
  await flushPersistNow()
}

function applySnapshotToStore(snapshot: PersistedSnapshot): void {
  useStore.setState({
    trades: snapshot.trades,
    strategies: snapshot.strategies,
    starredIds: snapshot.starredIds,
    subscribedIds: snapshot.subscribedIds,
    pinnedStrategyIds: snapshot.pinnedStrategyIds,
    display: snapshot.display,
  })
}

export async function exportJournalArchive(): Promise<{ ok: boolean; path?: string }> {
  if (!isElectron()) return { ok: false }
  const result = await getJournalBridge()!.exportJournalZip()
  return result.ok ? { ok: true, path: result.path } : { ok: false }
}

/** 桌面端：整库替换导入 .journal.zip */
export async function importJournalArchive(): Promise<boolean> {
  if (!isElectron()) return false
  const result = await getJournalBridge()!.importJournalZip()
  if (!result.ok) return false
  if (result.snapshot) {
    applySnapshotToStore(result.snapshot)
    await flushPersistNow()
  }
  return true
}

export async function getLibraryPath(): Promise<string | null> {
  if (!isElectron()) return null
  return getJournalBridge()!.getLibraryPath()
}
