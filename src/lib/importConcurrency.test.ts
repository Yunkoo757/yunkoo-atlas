import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { enablePersistWrites, disablePersistWrites } from '@/storage/persist'
import type { PersistedSnapshot } from '@/storage/types'
import { useStore } from '@/store/useStore'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const strategy: Strategy = {
  id: 'breakout',
  name: 'Breakout',
  icon: 'trending-up',
  color: '#6b6ee6',
}

function trade(id: string, symbol: string): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol,
    side: 'long',
    status: 'open',
    conviction: 'medium',
    strategyId: strategy.id,
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-14T09:00:00.000Z',
    closedAt: null,
    note: '',
  }
}

export async function testJsonImportPreservesEditsMadeWhileCommitIsPending(): Promise<void> {
  const commitStarted = deferred()
  const allowCommit = deferred()
  const savedSnapshots: PersistedSnapshot[] = []
  let commitCount = 0

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      journalBridge: {
        isElectron: true,
        commitImport: async () => {
          commitCount += 1
          commitStarted.resolve()
          await allowCommit.promise
          return true
        },
        saveSnapshot: async (snapshot: PersistedSnapshot) => {
          savedSnapshots.push(snapshot)
          return true
        },
      },
    },
  })

  const original = trade('original', 'EURUSD')
  const imported = trade('imported', 'BTCUSDT')
  const localDuringImport = trade('local', 'XAUUSD')
  useStore.setState({
    trades: [original],
    strategies: [strategy],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY },
    tagPresets: ['原有标签'],
    mistakeTagPresets: [],
    savedTradeViews: [],
    symbolIcons: {},
    symbolCatalog: ['EURUSD'],
  })

  enablePersistWrites()
  try {
    const { applyImport } = await import('@/lib/importExport')
    const importing = applyImport({
      version: 6,
      trades: [imported],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: { ...DEFAULT_DISPLAY },
      tagPresets: ['导入标签'],
      mistakeTagPresets: [],
      savedTradeViews: [],
      symbolIcons: {},
      symbolCatalog: ['BTCUSDT'],
    })

    await commitStarted.promise
    useStore.setState((state) => ({
      trades: [...state.trades, localDuringImport],
      tagPresets: [...state.tagPresets, '等待期间新增'],
      symbolCatalog: [...state.symbolCatalog, 'XAUUSD'],
    }))
    allowCommit.resolve()
    await importing

    const finalState = useStore.getState()
    assert(finalState.trades.some((item) => item.id === imported.id), '导入交易必须保留')
    assert(finalState.trades.some((item) => item.id === localDuringImport.id), '等待提交期间新增的交易不得被旧快照覆盖')
    assert(finalState.tagPresets.includes('导入标签'), '导入标签必须保留')
    assert(finalState.tagPresets.includes('等待期间新增'), '等待提交期间新增的标签不得丢失')
    assert(commitCount === 2, '检测到并发编辑后必须基于最新状态重新合并并提交')

    const finalSaved = savedSnapshots.at(-1)
    assert(finalSaved?.trades.some((item) => item.id === imported.id), '最终落盘快照必须包含导入交易')
    assert(finalSaved?.trades.some((item) => item.id === localDuringImport.id), '最终落盘快照必须包含并发本地编辑')
  } finally {
    disablePersistWrites()
    Reflect.deleteProperty(globalThis, 'window')
  }
}

export async function testJsonImportAbortsWhenTheSameTradeIsEditedDuringCommit(): Promise<void> {
  const commitStarted = deferred()
  const allowCommit = deferred()
  const savedSnapshots: PersistedSnapshot[] = []
  const committedSnapshots: PersistedSnapshot[] = []
  let commitCount = 0

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      journalBridge: {
        isElectron: true,
        commitImport: async (snapshot: PersistedSnapshot) => {
          commitCount += 1
          committedSnapshots.push(snapshot)
          commitStarted.resolve()
          await allowCommit.promise
          return true
        },
        saveSnapshot: async (snapshot: PersistedSnapshot) => {
          savedSnapshots.push(snapshot)
          return true
        },
      },
    },
  })

  const original = trade('shared', 'EURUSD')
  const imported = { ...trade('shared', 'BTCUSDT'), note: '<p>导入内容</p>' }
  useStore.setState({
    trades: [original],
    strategies: [strategy],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY },
    tagPresets: [],
    mistakeTagPresets: [],
    savedTradeViews: [],
    symbolIcons: {},
    symbolCatalog: ['EURUSD'],
  })

  enablePersistWrites()
  try {
    const { applyImport } = await import('@/lib/importExport')
    const importing = applyImport({
      version: 6,
      trades: [imported],
      strategies: [strategy],
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      display: { ...DEFAULT_DISPLAY },
    })

    await commitStarted.promise
    const locallyEdited = { ...original, symbol: 'XAUUSD', note: '<p>等待期间本地编辑</p>' }
    useStore.setState({ trades: [locallyEdited] })
    allowCommit.resolve()

    let errorMessage = ''
    try {
      await importing
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    }

    const finalTrade = useStore.getState().trades.find((item) => item.id === original.id)
    assert(errorMessage.includes('本地编辑'), '同 ID 记录发生并发修改时必须明确告知导入已取消')
    assert(finalTrade?.symbol === 'XAUUSD', '导入提交等待期间的同 ID 本地编辑不得被覆盖')
    assert(finalTrade?.note === '<p>等待期间本地编辑</p>', '本地笔记必须完整保留')
    assert(commitCount === 2, '同 ID 冲突后必须用补偿提交恢复本地快照并清理本批附件')
    assert(
      committedSnapshots.at(-1)?.trades.find((item) => item.id === original.id)?.symbol === 'XAUUSD',
      '补偿提交必须以最新本地交易为准',
    )

    const finalSaved = savedSnapshots.at(-1)
    assert(
      finalSaved?.trades.find((item) => item.id === original.id)?.symbol === 'XAUUSD',
      '取消导入后必须把保留的本地编辑重新落盘',
    )
  } finally {
    disablePersistWrites()
    Reflect.deleteProperty(globalThis, 'window')
  }
}
