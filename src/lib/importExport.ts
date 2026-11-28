import { downloadBlob } from './downloadBlob'
import { verifyImportAssets } from '@/lib/importTradeIdentity'
import { sha256Hex } from '@/lib/sha256'
import { commitTradeBatch } from '@/lib/committedPublish'
import { collectRetiredSnapshotAssetIds, stripRetiredSnapshotDomains } from '@/storage/retiredSnapshotDomains'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { buildPortableSnapshotFromState, type PortableSnapshotState } from '@/storage/snapshotProjection'
import { useShortcutStore } from '@/store/shortcutStore'
import { collectAssetIdsFromSnapshot } from '@/storage/snapshotRichText'
import { getStorage } from '@/storage/provider'
import type { ExportAssetRecord } from '@/storage/types'
import { flushPersistNow } from '@/storage/persist'
import { isElectron, getJournalBridge } from '@/storage/runtime'
import type { PersistedSnapshot } from '@/storage/types'
import { beginWebOperation } from '@/storage/webOperationLogger'
import { decodeCanonicalSnapshot } from '@/storage/snapshotCodec'
import { SCHEMA_VERSION } from '@/storage/types'
import { isSafeAssetId } from '@/storage/assetId'
import { flushStorageBeforeCutover } from '@/storage/cutover'
import { waitForPendingStorageOperations } from '@/storage/pendingOperations'
import { applyNoteDraftsToSnapshot } from '@/storage/noteDrafts'
import { RECOVERY_MISSING_DRAFT_ASSET_PREFIX } from '@/storage/assets'
import { remapHtmlAssetIds, snapshotRichTextRecords } from '@/storage/snapshotRichText'
import { mapTradeRichText } from '@/storage/tradeRichText'
import {
  capturePersistedStateRevision,
  hasSamePersistedStateRevision,
} from '@/store/persistedRevision'
import { normalizeWebJournalImageMime } from '@/lib/webJournalArchiveContract'
import { buildWebJournalArchiveBlob } from '@/lib/webJournalArchiveWriter'
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
import { OperationalError } from '@/lib/operationalError'
import {
  createLegacyStageMigrationOptions,
  type LegacyStageMigrationOptions,
} from '@/lib/stageMigration'

export const EXPORT_VERSION = SCHEMA_VERSION
import type { ExportPayload, PersistedSlice } from '@/lib/importTypes'
import { canonicalImportValue, mergeImportPayload } from '@/lib/importMerge'
import { applySnapshotToStore } from '@/lib/snapshotStore'

export type { ExportPayload, PersistedSlice } from '@/lib/importTypes'

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
  snapshot: Pick<PersistedSnapshot, 'trades' | 'weeklyReviews' | 'quickNotes'>,
  value: unknown,
  retiredAssetIds: ReadonlySet<string> = new Set(),
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

  const referencedIds = new Set(collectAssetIdsFromSnapshot(snapshot))
  for (const id of referencedIds) {
    if (!isSafeAssetId(id)) throw new Error(`正文引用了非法附件 ID：${id}`)
    if (!assetIds.has(id)) throw new Error(`导入内容缺少附件：${id}`)
  }
  for (const id of assetIds) {
    if (!referencedIds.has(id) && !retiredAssetIds.has(id)) throw new Error(`附件 ${id} 未被任何正文引用`)
  }
  for (const { html } of snapshotRichTextRecords(snapshot)) {
    assertValidInlineImportImages(html, attachmentBudget)
  }
  return normalized.filter(asset => referencedIds.has(asset.id))
}

export async function buildExportPayloadFromState(
  state: PortableSnapshotState,
  getAssetForExport: (id: string) => Promise<ExportAssetRecord | null>,
  shortcutBindings = state.shortcuts ?? {},
): Promise<ExportPayload> {
  const assetIds = new Set(collectAssetIdsFromSnapshot(state))
  const assets = await loadReferencedAssetsForExport(assetIds, getAssetForExport)
  const portable = buildPortableSnapshotFromState(state, shortcutBindings)
  return {
    version: EXPORT_VERSION,
    ...portable,
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
  const storage = getStorage()
  return buildExportPayloadFromState(
    useStore.getState(),
    (id) => storage.getAssetForExport(id),
    useShortcutStore.getState().bindings,
  )
}

async function readExportRevision(storage: ReturnType<typeof getStorage>): Promise<number | null> {
  try { return await storage.getSnapshotRevision?.() ?? null } catch { return null }
}

export async function downloadExport(): Promise<void> {
  const storage = getStorage()
  const revisionBefore = await readExportRevision(storage)
  const operation = beginWebOperation('archive', {
    stage: 'export-json',
    revisionBefore,
    platform: isElectron() ? 'electron-renderer' : 'web',
  })
  try {
    await flushPersistNow()
    const revisionAfter = await readExportRevision(storage)
    const payload = await buildExportPayload()
    const json = serializeJsonExportPayload(payload)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const date = new Date().toISOString().slice(0, 10)
    downloadBlob(blob, `trader-atlas-backup-${date}.json`)
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
    const assets = normalizeAndValidateImportAssets(snapshot, payload.assets, collectRetiredSnapshotAssetIds(payload))
    payload = { ...stripRetiredSnapshotDomains(payload), ...(payload.assets === undefined ? {} : { assets }) }
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
  const revisionBefore = await readExportRevision(storage)
  const operation = beginWebOperation('archive', {
    stage: 'export-zip',
    revisionBefore,
    platform: isElectron() ? 'electron-renderer' : 'web',
  })
  try {
    await flushPersistNow()
    const revisionAfter = await readExportRevision(storage)
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
    const date = new Date().toISOString().slice(0, 10)
    downloadBlob(zipBlob, `trader-atlas-${date}.journal.zip`)
    operation.success({ stage: 'downloaded', revisionAfter })
  } catch (error) {
    operation.failure(error, { stage: 'export-zip' })
    throw error
  }
}

export function parseImportJson(
  text: string,
  stageMigration?: LegacyStageMigrationOptions,
): ImportResult {
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
    snapshotCandidate = decodeCanonicalSnapshot(raw, {
      version: raw.version,
      label: 'JSON backup',
      stageMigration: raw.version <= 11
        ? stageMigration ?? createLegacyStageMigrationOptions(raw, new Date())
        : undefined,
    })
    assets = normalizeAndValidateImportAssets(snapshotCandidate, raw.assets, collectRetiredSnapshotAssetIds(raw))
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
      ...stripRetiredSnapshotDomains(snapshot),
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
  const filename = `trader-atlas-${suffix}-${new Date().toISOString().slice(0, 10)}.json`
  const blob = new Blob([serializeJsonDocumentWithinFileBudget(payload)], { type: 'application/json;charset=utf-8' })
  downloadBlob(blob, filename)
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
  const sourceAssets = normalizeAndValidateImportAssets(payload, payload.assets, collectRetiredSnapshotAssetIds(payload))
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
    let html = remapHtmlAssetIds(source, (id) => {
      const importedId = idMap.get(id)
      if (!importedId) throw new Error(`导入内容缺少附件：${id}`)
      return importedId
    })
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
  const trades = payload.trades.map(trade => {
    const mapped = mapTradeRichText(trade, rewriteHtml)
    if (!trade.decisionImageId) return mapped
    // 已从正文移除的旧标记不能在目标库里碰巧指向另一张新图。
    return { ...mapped, decisionImageId: idMap.get(trade.decisionImageId) ?? null }
  })
  const weeklyReviews = payload.weeklyReviews?.map((review) => ({
    ...review,
    contentHtml: rewriteHtml(review.contentHtml),
  }))
  const quickNotes = payload.quickNotes?.map((note) => ({
    ...note,
    contentHtml: rewriteHtml(note.contentHtml),
  }))

  return {
    payload: { ...stripRetiredSnapshotDomains(payload), trades, weeklyReviews, quickNotes, assets },
    assets,
  }
}

function captureImportedTradeBaseline(trades: readonly Trade[], tradeIds: ReadonlyMap<string, string>) {
  const values = new Map<string, string | null>()
  for (const [source, target] of tradeIds) {
    values.set(source, null)
    values.set(target, null)
  }
  for (const trade of trades) {
    if (values.has(trade.id)) values.set(trade.id, JSON.stringify(trade))
  }
  return values
}

function assertImportTradesUnchanged(
  baseline: ReadonlyMap<string, string | null>,
  tradeIds: ReadonlyMap<string, string>,
  latest: readonly Trade[],
): void {
  const latestById = new Map(latest.map(trade => [trade.id, trade]))
  for (const [id, original] of baseline) {
    const current = latestById.get(id)
    if ((current ? JSON.stringify(current) : null) === original) continue
    if (Array.from(tradeIds).some(([source, target]) => source !== target && target === id)) {
      throw new Error(`导入已取消：稳定导入交易 ID ${id} 在等待期间被其他交易占用；最新本地内容已保留，请重新导入。`)
    }
    throw new Error('导入已取消：检测到相同交易存在等待期间的本地编辑，本地内容已保留，请重新导入。')
  }
}

const IMMUTABLE_RISK_IMPORT_FIELDS = [
  ['riskPolicyVersions', '风险策略版本'],
  ['monthlyRiskLimits', '月度风险限额'],
  ['riskOverrideEvents', '风险覆盖事件'],
] as const

type ImmutableRiskImportField = (typeof IMMUTABLE_RISK_IMPORT_FIELDS)[number][0]
type ImmutableRiskImportBaseline = Map<
  ImmutableRiskImportField,
  Map<string, string | null>
>

function captureImmutableRiskImportBaseline(
  current: PersistedSlice,
  payload: ExportPayload,
): ImmutableRiskImportBaseline {
  const baseline: ImmutableRiskImportBaseline = new Map()
  for (const [field] of IMMUTABLE_RISK_IMPORT_FIELDS) {
    const currentById = new Map(
      ((current[field] ?? []) as Array<{ id: string }>).map((item) => [item.id, item]),
    )
    baseline.set(field, new Map(
      (payload[field] as Array<{ id: string }>).map((item) => {
        const local = currentById.get(item.id)
        return [item.id, local ? canonicalImportValue(local) : null]
      }),
    ))
  }
  return baseline
}

function findConcurrentImmutableRiskConflict(
  baseline: ImmutableRiskImportBaseline,
  latest: PersistedSlice,
  payload: ExportPayload,
): { id: string; label: string } | null {
  for (const [field, label] of IMMUTABLE_RISK_IMPORT_FIELDS) {
    const latestById = new Map(
      ((latest[field] ?? []) as Array<{ id: string }>).map((item) => [item.id, item]),
    )
    const importedById = new Map(
      (payload[field] as Array<{ id: string }>).map((item) => [item.id, item]),
    )
    for (const [id, initialValue] of baseline.get(field) ?? []) {
      const latestEntity = latestById.get(id)
      const importedEntity = importedById.get(id)
      const latestValue = latestEntity ? canonicalImportValue(latestEntity) : null
      const importedValue = importedEntity ? canonicalImportValue(importedEntity) : null
      if (latestValue !== initialValue && latestValue !== importedValue) {
        return { id, label }
      }
    }
  }
  return null
}

async function sha256CanonicalImportPayload(payload: ExportPayload): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalImportValue(payload))
  return `sha256:${await sha256Hex(bytes)}`
}

export async function applyImport(payload: ExportPayload): Promise<{ summary: string }> {
  const storage = getStorage()
  const payloadDigest = await sha256CanonicalImportPayload(payload)
  const prepared = prepareImportPayloadForCommit(payload)
  const { summary } = await commitTradeBatch({
    storage, assets: prepared.assets, beforeCommit: flushStorageBeforeCutover, source: 'JsonImport',
  }, async writer => {
    let snapshot: PersistedSnapshot
    try {
      const initial = capturePersistedStateRevision()
      let revision = initial
      while (true) {
        const verifyAsset = verifyImportAssets(prepared.assets, id => storage.getAssetForExport(id))
        const merged = await mergeImportPayload(revision.state, prepared.payload, payloadDigest, verifyAsset)
        const baseline = captureImportedTradeBaseline(initial.state.trades, merged.tradeIds)
        // 并发阶段或项目变更可能令重算选中新的目标，也要对照导入开始时的本地内容。
        if (revision !== initial) assertImportTradesUnchanged(baseline, merged.tradeIds, revision.state.trades)
        const immutableRiskBaseline = captureImmutableRiskImportBaseline(revision.state, prepared.payload)
        let latest = capturePersistedStateRevision()
        if (hasSamePersistedStateRevision(revision, latest)) {
          snapshot = buildPortableSnapshotFromState({ ...merged.state, profile: revision.state.profile }, revision.shortcutBindings)
          await writer.commit(snapshot, { pruneUnreferenced: true })
          latest = capturePersistedStateRevision()
          if (hasSamePersistedStateRevision(revision, latest)) break
        }
        assertImportTradesUnchanged(baseline, merged.tradeIds, latest.state.trades)
        const immutableRiskConflict = findConcurrentImmutableRiskConflict(
          immutableRiskBaseline,
          latest.state,
          prepared.payload,
        )
        if (immutableRiskConflict) {
          throw new OperationalError(
            'import-immutable-entity-conflict',
            `导入已取消：检测到${immutableRiskConflict.label} ${immutableRiskConflict.id} 在等待期间出现同 ID 异内容的本地更新；最新本地内容已保留，请重新导入。`,
          )
        }
        revision = latest
      }
    } catch (error) {
      if (writer.diskAhead) {
        const latest = capturePersistedStateRevision()
        await writer.compensate(buildPortableSnapshotFromState(latest.state, latest.shortcutBindings))
      }
      throw error
    }

    applySnapshotToStore(snapshot)
    const parts: string[] = [`${prepared.payload.trades.length} 笔交易`]
    if (prepared.assets.length > 0) parts.push(`${prepared.assets.length} 个附件`)
    parts.push('保留当前实盘阶段与历史阶段')
    return { finalSave: 'required', result: { summary: `已导入 ${parts.join('、')}` } }
  })
  return { summary }
}

export async function exportJournalArchive(): Promise<{ ok: boolean; path?: string }> {
  if (!isElectron()) return { ok: false }
  await flushPersistNow()
  const result = await getJournalBridge()!.exportJournalZip()
  return result.ok ? { ok: true, path: result.path } : { ok: false }
}

export async function prepareJournalArchive(prepareRequestId: string) {
  if (!isElectron()) return { ok: false as const, error: 'Electron bridge is not available' }
  await flushPersistNow()
  return getJournalBridge()!.prepareJournalImport(prepareRequestId)
}
