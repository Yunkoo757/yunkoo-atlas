import type { Strategy } from '@/data/strategies'
import type { Trade, TradeStatus, TradeSide, Conviction, TradeKind } from '@/data/trades'
import { DEFAULT_DISPLAY, type DisplayPrefs } from '@/lib/tradeFilters'
import { ensureStrategies, migrateTrades } from '@/lib/strategies'
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

export const EXPORT_VERSION = 3

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
const TRADE_KINDS: TradeKind[] = ['live', 'paper', 'practice']
const TRADE_SIDES: TradeSide[] = ['long', 'short']
const CONVICTIONS: Conviction[] = ['low', 'medium', 'high', 'urgent']
const SORT_BY = ['date', 'pnl', 'conviction'] as const

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
  if (v.tradeKind !== undefined && !TRADE_KINDS.includes(v.tradeKind as TradeKind)) return false
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
  return {
    hideClosed: typeof v.hideClosed === 'boolean' ? v.hideClosed : DEFAULT_DISPLAY.hideClosed,
    showEmptyGroups:
      typeof v.showEmptyGroups === 'boolean' ? v.showEmptyGroups : DEFAULT_DISPLAY.showEmptyGroups,
    groupByStrategy:
      typeof v.groupByStrategy === 'boolean' ? v.groupByStrategy : DEFAULT_DISPLAY.groupByStrategy,
    sortBy: SORT_BY.includes(v.sortBy as (typeof SORT_BY)[number])
      ? (v.sortBy as DisplayPrefs['sortBy'])
      : DEFAULT_DISPLAY.sortBy,
    groupByDate:
      typeof v.groupByDate === 'boolean' ? v.groupByDate : DEFAULT_DISPLAY.groupByDate,
  }
}

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

export async function downloadExport(): Promise<void> {
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
    trades: Array.from(tradeMap.values()),
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
  if (result.snapshot) applySnapshotToStore(result.snapshot)
  return true
}

export async function getLibraryPath(): Promise<string | null> {
  if (!isElectron()) return null
  return getJournalBridge()!.getLibraryPath()
}
