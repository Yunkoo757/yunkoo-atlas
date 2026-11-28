import { bytesToBase64 } from '@/lib/base64'
import { commitTradeBatch } from '@/lib/committedPublish'
import type { Trade } from '@/data/trades'
import { isSafeAssetId } from '@/storage/assetId'
import type { StorageAdapter } from '@/storage/adapter'
import { getStorage } from '@/storage/provider'
import { pickPersisted } from '@/storage/snapshotProjection'
import { flushPersistNow } from '@/storage/persist'
import type { ExportAssetRecord } from '@/storage/types'
import {
  capturePersistedStateRevision,
  hasSamePersistedStateRevision,
} from '@/store/persistedRevision'
import { applyTradeUpsertsToSlice } from '@/lib/tradeUpsert'
import { useStore } from '@/store/useStore'
import { assetUrl } from '@/storage/assets'

export interface ComposerImageInput {
  file: Blob
  mime: string
}

type ComposerState = ReturnType<typeof useStore.getState>

export interface ComposerTradeCandidate {
  trade: Trade
  statePatch?: Pick<ComposerState, 'starredIds'>
}

export type ComposerTradeBuildResult = Trade | ComposerTradeCandidate | null

interface CommitComposerOptions {
  images: readonly ComposerImageInput[]
  targetTradeId: string
  buildTrade: (state: ComposerState, imageHtml: string) => ComposerTradeBuildResult
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

function resolveComposerCandidate(result: ComposerTradeBuildResult): ComposerTradeCandidate | null {
  if (!result) return null
  return 'trade' in result ? result : { trade: result }
}

function buildTradePatch(state: ComposerState, candidate: ComposerTradeCandidate) {
  const { trade } = candidate
  const patch = applyTradeUpsertsToSlice({
    trades: state.trades,
    strategies: state.strategies,
    symbolCatalog: state.symbolCatalog,
  }, [trade], state.display.tradingDayStartHour, state.currentLiveStageId)
  return {
    ...patch,
    ...candidate.statePatch,
    trades: patch.trades,
  }
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
  return commitTradeBatch<Omit<CommittedComposerTrade, 'trailingSaveFailed'>>({
    storage, assets: prepared.assets, beforeCommit: flushPersistNow, source: 'TradeComposer',
  }, async writer => {
    const revision = capturePersistedStateRevision()
    const candidate = resolveComposerCandidate(buildTrade(revision.state, prepared.imageHtml))
    if (!candidate) {
      return { result: { trade: null, imageCount: 0 }, finalSave: 'already-persisted' }
    }
    const patch = buildTradePatch(revision.state, candidate)
    const snapshot = pickPersisted({ ...revision.state, ...patch }, revision.shortcutBindings)

    await writer.commit(snapshot)

    const latest = capturePersistedStateRevision()
    const unchanged = hasSamePersistedStateRevision(revision, latest)
    const originalTarget = revision.state.trades.find((item) => item.id === targetTradeId)
    const latestTarget = latest.state.trades.find((item) => item.id === targetTradeId)
    if (originalTarget && latestTarget !== originalTarget) {
      const latestSnapshot = pickPersisted(latest.state, latest.shortcutBindings)
      await writer.compensate(latestSnapshot)
      throw new TradeComposerConcurrentEditError()
    }
    const finalCandidate = unchanged
      ? candidate
      : resolveComposerCandidate(buildTrade(latest.state, prepared.imageHtml)) ?? candidate
    const finalTrade = finalCandidate.trade
    const finalPatch = unchanged
      ? patch
      : buildTradePatch(latest.state, finalCandidate)
    useStore.setState(finalPatch)

    return {
      result: { trade: finalTrade, imageCount: prepared.assets.length },
      finalSave: unchanged ? 'already-persisted' : 'best-effort',
    }
  })
}
