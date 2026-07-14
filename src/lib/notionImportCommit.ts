import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import {
  applyNotionImageAssetsToNote,
  executeNotionImport,
  getImportableNotionPreviews,
  type NotionTradePreview,
} from '@/lib/notionImport'
import { isSafeAssetId } from '@/storage/assetId'
import type { StorageAdapter } from '@/storage/adapter'
import { getStorage } from '@/storage'
import {
  discardPendingAndResumePersist,
  pickPersisted,
  resumePersistAndFlush,
  suspendPersist,
} from '@/storage/persist'
import type { ExportAssetRecord, PersistedSnapshot } from '@/storage/types'
import { useShortcutStore } from '@/store/shortcutStore'
import {
  applyTradeUpsertsToSlice,
  useStore,
  type TradeUpsertSlice,
} from '@/store/useStore'
import {
  flushStorageBeforeCutover,
  lockStorageCutoverInteraction,
} from '@/storage/cutover'
import {
  assertNotionImageByteLimits,
  MAX_NOTION_IMAGE_BYTES,
  MAX_NOTION_IMPORT_IMAGE_BYTES,
} from '@/lib/notionImportLimits'

const PERSISTED_STATE_KEYS = [
  'trades',
  'strategies',
  'starredIds',
  'subscribedIds',
  'pinnedStrategyIds',
  'display',
  'tagPresets',
  'mistakeTagPresets',
  'profile',
  'savedTradeViews',
  'symbolIcons',
  'symbolCatalog',
] as const

interface PersistedRevision {
  state: ReturnType<typeof useStore.getState>
  bindings: ReturnType<typeof useShortcutStore.getState>['bindings']
  references: readonly unknown[]
}

export interface PreparedNotionAssets {
  assets: ExportAssetRecord[]
  assetIdsByRow: ReadonlyMap<number, readonly string[]>
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
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
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
  const assetIdsByRow = new Map<number, readonly string[]>()
  const allocatedIds = new Set<string>()

  for (const preview of importablePreviews) {
    const ids: string[] = []
    for (const image of preview.images) {
      const id = createAssetId()
      if (!isSafeAssetId(id) || allocatedIds.has(id)) {
        throw new Error('无法为 Notion 图片生成唯一且安全的附件 ID')
      }
      allocatedIds.add(id)
      ids.push(id)
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

function captureRevision(): PersistedRevision {
  const state = useStore.getState()
  const bindings = useShortcutStore.getState().bindings
  return {
    state,
    bindings,
    references: [
      ...PERSISTED_STATE_KEYS.map((key) => state[key]),
      bindings,
    ],
  }
}

function sameRevision(left: PersistedRevision, right: PersistedRevision): boolean {
  return left.references.every((value, index) => value === right.references[index])
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
    tagPresets: state.tagPresets,
    mistakeTagPresets: state.mistakeTagPresets,
  }, importedTrades)
}

function buildSnapshot(
  revision: PersistedRevision,
  patch: TradeUpsertSlice,
): PersistedSnapshot {
  return pickPersisted({ ...revision.state, ...patch }, revision.bindings)
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
  const unlockInteraction = lockStorageCutoverInteraction()
  let suspended = false
  let released = false

  try {
    await flushStorageBeforeCutover()
    suspendPersist()
    suspended = true
    const revision = captureRevision()
    const imported = executeNotionImport(previews, revision.state.strategies, revision.state.trades)
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

    await storage.commitImport(snapshot, prepared.assets)

    // commit 等待期间若有其他设置变化，只把本批内容合并进最新 store，绝不回退并发编辑。
    const latest = captureRevision()
    const finalPatch = sameRevision(revision, latest)
      ? patch
      : buildStorePatch(latest.state, importedTrades, newStrategies)
    useStore.setState(finalPatch)

    let trailingSaveFailed = false
    if (sameRevision(revision, latest)) {
      // 原子提交的 snapshot 与发布到 store 的内容一致，清掉订阅器产生的冗余待写。
      discardPendingAndResumePersist()
      suspended = false
      released = true
    } else {
      // 批次已完整提交；仅追写提交期间发生的并发设置，不把追写错误误报为导入回滚。
      released = true
      try {
        await resumePersistAndFlush()
        suspended = false
      } catch (error) {
        trailingSaveFailed = true
        console.error('[NotionImport] failed to persist concurrent changes after import', error)
      }
    }

    return {
      importedTrades,
      newStrategies,
      imageCount: prepared.assets.length,
      trailingSaveFailed,
    }
  } catch (error) {
    if (!released) {
      released = true
      try {
        // 导入本身未发布；仅保存等待期间可能发生的既有数据变化。
        await resumePersistAndFlush()
        suspended = false
      } catch (resumeError) {
        console.error('[NotionImport] failed to resume persistence after import error', resumeError)
      }
    }
    throw error
  } finally {
    if (suspended) {
      await resumePersistAndFlush().catch((resumeError) => {
        console.error('[NotionImport] failed to resume persistence', resumeError)
      })
    }
    unlockInteraction()
  }
}
