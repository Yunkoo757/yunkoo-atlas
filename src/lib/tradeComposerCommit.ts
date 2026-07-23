import type { Trade } from '@/data/trades'
import { isSafeAssetId } from '@/storage/assetId'
import type { StorageAdapter } from '@/storage/adapter'
import { getStorage } from '@/storage/provider'
import {
  discardPendingAndResumePersist,
  flushPersistNow,
  pickPersisted,
  resumePersistAndFlush,
  suspendPersist,
} from '@/storage/persist'
import type { ExportAssetRecord } from '@/storage/types'
import { PERSISTED_STATE_REFERENCE_KEYS } from '@/storage/persistedKeys'
import { lockStorageCutoverInteraction } from '@/storage/cutover'
import { useShortcutStore } from '@/store/shortcutStore'
import { applyTradeUpsertsToSlice, useStore } from '@/store/useStore'
import { assetUrl } from '@/storage/assets'

export interface ComposerImageInput {
  file: Blob
  mime: string
}

interface PersistedRevision {
  state: ReturnType<typeof useStore.getState>
  bindings: ReturnType<typeof useShortcutStore.getState>['bindings']
  references: readonly unknown[]
}

interface CommitComposerOptions {
  images: readonly ComposerImageInput[]
  targetTradeId: string
  buildTrade: (state: ReturnType<typeof useStore.getState>, imageHtml: string) => Trade | null
  storage?: StorageAdapter
  createAssetId?: () => string
}

export interface CommittedComposerTrade {
  trade: Trade | null
  imageCount: number
  trailingSaveFailed: boolean
}

export class TradeComposerConcurrentEditError extends Error {
  readonly code = 'trade-composer-concurrent-edit'

  constructor() {
    super('交易在截图提交期间已被修改或删除，本次截图未写入，请基于最新内容重试')
    this.name = 'TradeComposerConcurrentEditError'
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

export async function prepareComposerAssetsForCommit(
  images: readonly ComposerImageInput[],
  createAssetId: () => string = () => crypto.randomUUID(),
): Promise<{ assets: ExportAssetRecord[]; imageHtml: string }> {
  const assets: ExportAssetRecord[] = []
  const imageTags: string[] = []
  const allocatedIds = new Set<string>()

  for (const image of images) {
    const id = createAssetId()
    if (!isSafeAssetId(id) || allocatedIds.has(id)) {
      throw new Error('无法为交易截图生成唯一且安全的附件 ID')
    }
    allocatedIds.add(id)
    const bytes = new Uint8Array(await image.file.arrayBuffer())
    assets.push({ id, mime: image.mime || 'image/png', data: bytesToBase64(bytes) })
    imageTags.push(`<img src="${assetUrl(id)}" />`)
  }

  return { assets, imageHtml: imageTags.join('\n') }
}

function captureRevision(): PersistedRevision {
  const state = useStore.getState()
  const bindings = useShortcutStore.getState().bindings
  return {
    state,
    bindings,
    references: [
      ...PERSISTED_STATE_REFERENCE_KEYS.map((key) => state[key]),
      bindings,
    ],
  }
}

function sameRevision(left: PersistedRevision, right: PersistedRevision): boolean {
  return left.references.every((value, index) => value === right.references[index])
}

function buildTradePatch(state: ReturnType<typeof useStore.getState>, trade: Trade) {
  return applyTradeUpsertsToSlice({
    trades: state.trades,
    strategies: state.strategies,
    symbolCatalog: state.symbolCatalog,
    tagPresets: state.tagPresets,
    mistakeTagPresets: state.mistakeTagPresets,
  }, [trade])
}

/**
 * Composer 提交边界：全部附件先只在内存中准备，再与最终快照一次提交。
 * commitImport 在 Web 使用单一 CAS 事务，在 Electron 使用临时文件和数据库补偿。
 */
export async function commitComposerTradeBatch({
  images,
  targetTradeId,
  buildTrade,
  storage = getStorage(),
  createAssetId,
}: CommitComposerOptions): Promise<CommittedComposerTrade> {
  const prepared = await prepareComposerAssetsForCommit(images, createAssetId)
  const unlockInteraction = lockStorageCutoverInteraction()
  let suspended = false
  let released = false

  try {
    await flushPersistNow()
    suspendPersist()
    suspended = true
    const revision = captureRevision()
    const trade = buildTrade(revision.state, prepared.imageHtml)
    if (!trade) {
      discardPendingAndResumePersist()
      suspended = false
      released = true
      return { trade: null, imageCount: 0, trailingSaveFailed: false }
    }
    const patch = buildTradePatch(revision.state, trade)
    const snapshot = pickPersisted({ ...revision.state, ...patch }, revision.bindings)

    await storage.commitImport(snapshot, prepared.assets)

    const latest = captureRevision()
    const originalTarget = revision.state.trades.find((item) => item.id === targetTradeId)
    const latestTarget = latest.state.trades.find((item) => item.id === targetTradeId)
    if (originalTarget && latestTarget !== originalTarget) {
      const latestSnapshot = pickPersisted(latest.state, latest.bindings)
      await storage.commitImport(latestSnapshot, prepared.assets, { pruneUnreferenced: true })
      released = true
      await resumePersistAndFlush()
      suspended = false
      throw new TradeComposerConcurrentEditError()
    }
    const finalTrade = sameRevision(revision, latest)
      ? trade
      : buildTrade(latest.state, prepared.imageHtml) ?? trade
    const finalPatch = sameRevision(revision, latest)
      ? patch
      : buildTradePatch(latest.state, finalTrade)
    useStore.setState(finalPatch)

    let trailingSaveFailed = false
    if (sameRevision(revision, latest)) {
      discardPendingAndResumePersist()
      suspended = false
      released = true
    } else {
      released = true
      try {
        await resumePersistAndFlush()
        suspended = false
      } catch (error) {
        trailingSaveFailed = true
        console.error('[TradeComposer] failed to persist concurrent changes after commit', error)
      }
    }

    return { trade: finalTrade, imageCount: prepared.assets.length, trailingSaveFailed }
  } catch (error) {
    if (!released) {
      released = true
      try {
        await resumePersistAndFlush()
        suspended = false
      } catch (resumeError) {
        console.error('[TradeComposer] failed to resume persistence after commit error', resumeError)
      }
    }
    throw error
  } finally {
    if (suspended) {
      await resumePersistAndFlush().catch((resumeError) => {
        console.error('[TradeComposer] failed to resume persistence', resumeError)
      })
    }
    unlockInteraction()
  }
}
