import { applyTradeUpsertsToSlice, type TradeUpsertSlice } from '@/lib/tradeUpsert'
import { bytesToBase64 } from '@/lib/base64'
import { commitTradeBatch } from '@/lib/committedPublish'
import type { Strategy } from '@/data/strategies'
import type { Trade, TradeKind } from '@/data/trades'
import {
  applyNotionImageAssetsToNote,
  executeNotionImport,
  getImportableNotionPreviews,
  type NotionTradePreview,
} from '@/lib/notionImport'
import { isSafeAssetId } from '@/storage/assetId'
import type { StorageAdapter } from '@/storage/adapter'
import { getStorage } from '@/storage/provider'
import { pickPersisted } from '@/storage/snapshotProjection'
import type { ExportAssetRecord, PersistedSnapshot } from '@/storage/types'
import { useStore } from '@/store/useStore'
import { flushStorageBeforeCutover } from '@/storage/cutover'
import {
  assertNotionImageByteLimits,
  MAX_NOTION_IMAGE_BYTES,
  MAX_NOTION_IMPORT_IMAGE_BYTES,
} from '@/lib/notionImportLimits'
import {
  capturePersistedStateRevision,
  hasSamePersistedStateRevision,
  type PersistedStateRevision,
} from '@/store/persistedRevision'

export interface PreparedNotionAssets {
  assets: ExportAssetRecord[]
  assetIdsByRow: ReadonlyMap<number, readonly (string | undefined)[]>
}

export { MAX_NOTION_IMAGE_BYTES, MAX_NOTION_IMPORT_IMAGE_BYTES }

export interface CommittedNotionImport {
  importedTrades: Trade[]
  newStrategies: Strategy[]
  imageCount: number
  /** 极少数情况下，导入已原子提交，但并发设置的追写仍可能失败。 */
  trailingSaveFailed: boolean
}

interface CommitOptions {
  storage?: StorageAdapter
  createAssetId?: () => string
  targetKind?: TradeKind
  now?: Date
}

/**
 * 只在内存中准备原图附件；不调用 saveAsset，避免中途失败留下不可达文件。
 * Uint8Array → Base64 是无损编码，不改变格式、尺寸或压缩质量。
 */
export function prepareNotionAssetsForCommit(
  previews: NotionTradePreview[],
  createAssetId: () => string = () => crypto.randomUUID(),
): PreparedNotionAssets {
  const importablePreviews = getImportableNotionPreviews(previews)
  const imageBytes = importablePreviews.flatMap((preview) => preview.images).map((image) => image.data.byteLength)
  assertNotionImageByteLimits(imageBytes)

  const assets: ExportAssetRecord[] = []
  const assetIdsByRow = new Map<number, readonly (string | undefined)[]>()
  const allocatedIds = new Set<string>()

  for (const preview of importablePreviews) {
    const ids: Array<string | undefined> = []
    for (const image of preview.images) {
      const id = createAssetId()
      if (!isSafeAssetId(id) || allocatedIds.has(id)) {
        throw new Error('无法为 Notion 图片生成唯一且安全的附件 ID')
      }
      allocatedIds.add(id)
      if (!Number.isInteger(image.slotId) || image.slotId < 0 || ids[image.slotId] !== undefined) {
        throw new Error('Notion 图片槽位无效或重复')
      }
      ids[image.slotId] = id
      assets.push({
        id,
        mime: image.mime,
        data: bytesToBase64(image.data),
      })
    }
    assetIdsByRow.set(preview.rowIndex, ids)
  }

  return { assets, assetIdsByRow }
}

function mergeStrategies(current: Strategy[], additions: Strategy[]): Strategy[] {
  const next = [...current]
  for (const strategy of additions) {
    if (next.some((item) => item.id === strategy.id || item.name === strategy.name)) continue
    next.push(strategy)
  }
  return next
}

function buildStorePatch(
  state: ReturnType<typeof useStore.getState>,
  importedTrades: Trade[],
  newStrategies: Strategy[],
): TradeUpsertSlice {
  return applyTradeUpsertsToSlice({
    trades: state.trades,
    strategies: mergeStrategies(state.strategies, newStrategies),
    symbolCatalog: state.symbolCatalog,
  }, importedTrades, state.display.tradingDayStartHour, state.currentLiveStageId)
}

function buildSnapshot(
  revision: PersistedStateRevision,
  patch: TradeUpsertSlice,
): PersistedSnapshot {
  return pickPersisted({ ...revision.state, ...patch }, revision.shortcutBindings)
}

/**
 * Notion 批次提交边界：准备原图 → 一次提交最终快照与全部附件 → 发布到 store。
 * commitImport 返回前，任何导入交易、策略和附件都不会对用户可见。
 */
export async function commitNotionImportBatch(
  previews: NotionTradePreview[],
  options: CommitOptions = {},
): Promise<CommittedNotionImport> {
  const storage = options.storage ?? getStorage()
  const prepared = prepareNotionAssetsForCommit(previews, options.createAssetId)
  return commitTradeBatch<Omit<CommittedNotionImport, 'trailingSaveFailed'>>({
    storage, assets: prepared.assets, beforeCommit: flushStorageBeforeCutover, source: 'NotionImport',
  }, async writer => {
    const revision = capturePersistedStateRevision()
    const imported = executeNotionImport(
      previews,
      revision.state.strategies,
      revision.state.trades,
      {
        tradeKind: options.targetKind,
        now: options.now,
        tradingDayStartHour: revision.state.display.tradingDayStartHour,
      },
    )
    const importablePreviews = getImportableNotionPreviews(previews)
    const importedTrades = imported.trades.map((trade, index) => {
      const preview = importablePreviews[index]
      const assetIds = preview ? prepared.assetIdsByRow.get(preview.rowIndex) ?? [] : []
      return {
        ...trade,
        note: applyNotionImageAssetsToNote(trade.note || '', [...assetIds]),
      }
    })
    const newStrategies = imported.strategies.filter(
      (strategy) => !revision.state.strategies.some(
        (existing) => existing.id === strategy.id || existing.name === strategy.name,
      ),
    )
    const patch = buildStorePatch(revision.state, importedTrades, newStrategies)
    const snapshot = buildSnapshot(revision, patch)

    await writer.commit(snapshot)

    // commit 等待期间若有其他设置变化，只把本批内容合并进最新 store，绝不回退并发编辑。
    const latest = capturePersistedStateRevision()
    const unchanged = hasSamePersistedStateRevision(revision, latest)
    const finalPatch = unchanged
      ? patch
      : buildStorePatch(latest.state, importedTrades, newStrategies)
    useStore.setState(finalPatch)
    const committedImportedTrades = importedTrades.map((trade) =>
      finalPatch.trades.find((candidate) => candidate.id === trade.id) ?? trade,
    )

    return {
      result: { importedTrades: committedImportedTrades, newStrategies, imageCount: prepared.assets.length },
      finalSave: unchanged ? 'already-persisted' : 'best-effort',
    }
  })
}
