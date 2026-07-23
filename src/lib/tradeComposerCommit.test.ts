import type { Trade } from '@/data/trades'
import {
  commitComposerTradeBatch,
  prepareComposerAssetsForCommit,
} from '@/lib/tradeComposerCommit'
import type { StorageAdapter } from '@/storage/adapter'
import type { ExportAssetRecord, PersistedSnapshot } from '@/storage/types'
import { useStore } from '@/store/useStore'

const existingTrade: Trade = {
  id: 'composer-existing',
  ref: 'TRD-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'planned',
  conviction: 'medium',
  strategyId: 'strategy-1',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'unreviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: null,
  stopLoss: 90,
  size: 1,
  pnl: null,
  rMultiple: null,
  timeframe: '1H',
  session: '',
  openedAt: '2026-07-01',
  closedAt: null,
  note: '<img src="journal-asset://old-shared-asset">',
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function image(text: string): { file: Blob; mime: string } {
  return { file: new Blob([text], { type: 'image/png' }), mime: 'image/png' }
}

export async function testComposerPreparationFailureNeverCallsStorage(): Promise<void> {
  let commitCalls = 0
  let reads = 0
  const broken = {
    size: 1,
    type: 'image/png',
    arrayBuffer: async () => {
      reads += 1
      throw new Error('forced third image read failure')
    },
  } as unknown as Blob
  let error: unknown
  try {
    await commitComposerTradeBatch({
      targetTradeId: existingTrade.id,
      images: [image('A'), image('B'), { file: broken, mime: 'image/png' }],
      storage: {
        commitImport: async () => { commitCalls += 1 },
      } as unknown as StorageAdapter,
      createAssetId: (() => {
        let index = 0
        return () => `composer-new-${++index}`
      })(),
      buildTrade: () => existingTrade,
    })
  } catch (caught) {
    error = caught
  }

  assert(error instanceof Error && error.message.includes('third image'), '第 N 张读取失败应原样返回')
  assert(reads === 1, '故障图片应只读取一次')
  assert(commitCalls === 0, '全部附件准备完成前不得调用任何存储提交')
}

export async function testComposerCommitFailurePublishesNeitherTradeNorAssets(): Promise<void> {
  const previous = useStore.getState()
  const initialTrades = [existingTrade]
  useStore.setState({ trades: initialTrades })
  let commitCalls = 0
  let error: unknown
  try {
    await commitComposerTradeBatch({
      targetTradeId: existingTrade.id,
      images: [image('new-image')],
      storage: {
        commitImport: async () => {
          commitCalls += 1
          throw new Error('forced CAS conflict')
        },
      } as unknown as StorageAdapter,
      createAssetId: () => 'composer-cas-asset',
      buildTrade: (state, html) => ({
        ...state.trades[0]!,
        note: `${state.trades[0]!.note}\n${html}`,
      }),
    })
  } catch (caught) {
    error = caught
  } finally {
    assert(commitCalls === 1, 'Composer 应只执行一次原子批次提交')
    assert(error instanceof Error && error.message.includes('CAS'), 'CAS 错误应返回调用方')
    assert(useStore.getState().trades === initialTrades, '提交失败不得发布候选交易到 store')
    useStore.setState({ trades: previous.trades })
  }
}

export async function testComposerCommitsNewAssetsAndTradeAsOneMergeBatch(): Promise<void> {
  const previous = useStore.getState()
  useStore.setState({ trades: [existingTrade] })
  let committedSnapshot: PersistedSnapshot | undefined
  let committedAssets: ExportAssetRecord[] | undefined
  let committedOptions: { pruneUnreferenced?: boolean } | undefined
  try {
    const result = await commitComposerTradeBatch({
      targetTradeId: existingTrade.id,
      images: [image('A'), image('B')],
      storage: {
        commitImport: async (snapshot, assets, options) => {
          committedSnapshot = snapshot
          committedAssets = assets
          committedOptions = options
        },
      } as StorageAdapter,
      createAssetId: (() => {
        let index = 0
        return () => `composer-batch-${++index}`
      })(),
      buildTrade: (state, html) => ({
        ...state.trades[0]!,
        side: 'short',
        note: `${state.trades[0]!.note}\n${html}`,
      }),
    })

    assert(result.trade?.side === 'short' && result.imageCount === 2, '成功结果应返回最终交易和附件数')
    assert(committedAssets?.length === 2, '两张截图必须作为同一批次提交')
    assert(committedSnapshot?.trades[0]?.note.includes('composer-batch-1'), '提交快照必须引用第一张新附件')
    assert(committedSnapshot?.trades[0]?.note.includes('composer-batch-2'), '提交快照必须引用第二张新附件')
    assert(committedSnapshot?.trades[0]?.note.includes('old-shared-asset'), '旧或共享附件引用必须保留')
    assert(committedOptions?.pruneUnreferenced !== true, 'Composer 合并提交不得删除旧或共享附件')
    assert(useStore.getState().trades[0]?.note === committedSnapshot?.trades[0]?.note, '存储成功后才可发布同一交易到 store')
  } finally {
    useStore.setState({ trades: previous.trades })
  }
}

async function verifyConcurrentTargetChangeIsCompensated(
  change: () => void,
  assertLatest: () => void,
): Promise<void> {
  const previous = useStore.getState()
  useStore.setState({ trades: [existingTrade] })
  let releaseCommit!: () => void
  const firstCommit = new Promise<void>((resolve) => { releaseCommit = resolve })
  let markCommitStarted!: () => void
  const commitStarted = new Promise<void>((resolve) => { markCommitStarted = resolve })
  const calls: Array<{
    snapshot: PersistedSnapshot
    assets: ExportAssetRecord[]
    options?: { pruneUnreferenced?: boolean }
  }> = []
  let error: unknown
  try {
    const pending = commitComposerTradeBatch({
      targetTradeId: existingTrade.id,
      images: [image('concurrent-image')],
      storage: {
        commitImport: async (snapshot, assets, options) => {
          calls.push({ snapshot, assets, options })
          if (calls.length === 1) {
            markCommitStarted()
            await firstCommit
          }
        },
      } as StorageAdapter,
      createAssetId: () => 'composer-concurrent-asset',
      buildTrade: (state, html) => {
        const latest = state.trades.find((trade) => trade.id === existingTrade.id)
        return latest ? { ...latest, side: 'short', note: `${latest.note}\n${html}` } : null
      },
    })
    await commitStarted
    change()
    releaseCommit()
    await pending
  } catch (caught) {
    error = caught
  } finally {
    assert(error instanceof Error && error.message.includes('已被修改或删除'), '同交易竞态必须返回可重试错误')
    assert(calls.length === 2, '检测到同交易竞态后必须执行一次原子补偿')
    assert(calls[1]?.options?.pruneUnreferenced === true, '补偿只能回收本批未引用附件')
    assert(calls[1]?.assets.length === 1 && calls[1]?.assets[0]?.id === 'composer-concurrent-asset', '补偿不得把旧或共享附件加入删除批次')
    assert(!calls[1]?.snapshot.trades.some((trade) => trade.note.includes('composer-concurrent-asset')), '补偿快照不得引用失败批次附件')
    assertLatest()
    useStore.setState({ trades: previous.trades })
  }
}

export async function testComposerConcurrentTradeEditPreservesLatestAndCleansBatch(): Promise<void> {
  await verifyConcurrentTargetChangeIsCompensated(() => {
    useStore.setState({
      trades: [{ ...existingTrade, side: 'long', timeframe: '4H', note: '<p>并发最新笔记</p>' }],
    })
  }, () => {
    const latest = useStore.getState().trades[0]
    assert(latest?.timeframe === '4H' && latest.note === '<p>并发最新笔记</p>', '并发修改必须保持为最新值')
  })
}

export async function testComposerConcurrentTradeDeletionDoesNotResurrectIt(): Promise<void> {
  await verifyConcurrentTargetChangeIsCompensated(() => {
    useStore.setState({ trades: [] })
  }, () => {
    assert(useStore.getState().trades.length === 0, '并发删除的交易不得被 Composer 复活')
  })
}

export async function testComposerPreparationRejectsDuplicateGeneratedIds(): Promise<void> {
  let error: unknown
  try {
    await prepareComposerAssetsForCommit([image('A'), image('B')], () => 'duplicate-safe-id')
  } catch (caught) {
    error = caught
  }
  assert(error instanceof Error && error.message.includes('唯一且安全'), '重复附件 ID 必须在提交前拒绝')
}
// Quality-Scenario: I-COMPOSER-N
