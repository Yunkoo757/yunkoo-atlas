import { enablePersistWrites, disablePersistWrites } from '@/storage/persist'
import type { PersistedSnapshot } from '@/storage/types'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { switchActiveLibrary } from '@/lib/importExport'
import { useStore } from '@/store/useStore'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testFailedLibrarySwitchNeverWritesOldStoreToChangedPath(): Promise<void> {
  let activePath = 'D:\\old-library'
  const savedPaths: string[] = []

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      journalBridge: {
        isElectron: true,
        getLibraryPath: async () => activePath,
        prepareLibrarySwitch: async () => ({ ok: true, token: 'failed-switch' }),
        activatePreparedLibrary: async () => {
          // 模拟旧版/异常主进程：路径已改变，但 IPC 最终返回失败。
          activePath = 'D:\\uncertain-library'
          return { ok: false, error: '候选库损坏' }
        },
        cancelPreparedLibrary: async () => false,
        saveSnapshot: async (_snapshot: PersistedSnapshot) => {
          savedPaths.push(activePath)
          return true
        },
      },
    },
  })

  enablePersistWrites()
  try {
    const result = await switchActiveLibrary('open', 'D:\\broken-library')
    assert(!result.ok, '损坏候选库必须返回失败')
    assert(savedPaths.includes('D:\\old-library'), '切库前应先保存旧库')
    assert(
      !savedPaths.includes('D:\\uncertain-library'),
      '切库失败且路径状态变化后，绝不能把旧 Zustand 快照写入不确定的新路径',
    )
  } finally {
    disablePersistWrites()
    Reflect.deleteProperty(globalThis, 'window')
  }
}

export async function testSuccessfulLibrarySwitchUsesSnapshotReturnedByAtomicIpc(): Promise<void> {
  let activePath = 'D:\\old-library'
  let separateLoadCount = 0
  const returnedSnapshot: PersistedSnapshot = {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
    tagPresets: ['已验证候选库'],
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      journalBridge: {
        isElectron: true,
        getLibraryPath: async () => activePath,
        prepareLibrarySwitch: async () => ({ ok: true, token: 'successful-switch' }),
        activatePreparedLibrary: async () => {
          activePath = 'D:\\new-library'
          return { ok: true, snapshot: returnedSnapshot }
        },
        cancelPreparedLibrary: async () => false,
        loadSnapshot: async () => {
          separateLoadCount += 1
          throw new Error('切库后不应再通过第二条 IPC 读取快照')
        },
        saveSnapshot: async () => true,
      },
    },
  })

  enablePersistWrites()
  try {
    const result = await switchActiveLibrary('open', 'D:\\new-library')
    assert(result.ok, '已验证候选库应成功切换')
    assert(separateLoadCount === 0, 'renderer 必须直接使用原子切库 IPC 返回的已验证快照')
    assert(useStore.getState().tagPresets.includes('已验证候选库'), '返回快照必须 hydrate 到当前 store')
  } finally {
    disablePersistWrites()
    Reflect.deleteProperty(globalThis, 'window')
  }
}

export async function testDelayedLibraryPreparationFlushesLateTradeToOldLibraryBeforeActivation(): Promise<void> {
  let activePath = 'D:\\old-library'
  let allowPreparation!: () => void
  let preparationStarted!: () => void
  const preparationStartedPromise = new Promise<void>((resolve) => {
    preparationStarted = resolve
  })
  const allowPreparationPromise = new Promise<void>((resolve) => {
    allowPreparation = resolve
  })
  const saved: Array<{ path: string; snapshot: PersistedSnapshot }> = []
  const oldTrade = {
    id: 'old-trade',
    ref: 'TRD-OLD',
    symbol: 'EURUSD',
    side: 'long' as const,
    status: 'open' as const,
    conviction: 'medium' as const,
    strategyId: 'breakout',
    tradeKind: 'live' as const,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed' as const,
    reviewCategory: 'normal' as const,
    entry: 1,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-14T09:00:00.000Z',
    closedAt: null,
    note: '',
  }
  const lateTrade = { ...oldTrade, id: 'late-trade', ref: 'TRD-LATE', symbol: 'XAUUSD' }
  const newSnapshot: PersistedSnapshot = {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
    tagPresets: ['新库'],
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      journalBridge: {
        isElectron: true,
        getLibraryPath: async () => activePath,
        prepareLibrarySwitch: async () => {
          preparationStarted()
          await allowPreparationPromise
          return { ok: true, token: 'prepared-switch' }
        },
        activatePreparedLibrary: async () => {
          const latestOld = saved.filter((entry) => entry.path === 'D:\\old-library').at(-1)?.snapshot
          assert(
            latestOld?.trades.some((trade) => trade.id === lateTrade.id),
            '激活候选库之前必须把准备期间新增的交易稳定写入旧库',
          )
          activePath = 'D:\\new-library'
          return { ok: true, snapshot: newSnapshot }
        },
        cancelPreparedLibrary: async () => true,
        saveSnapshot: async (snapshot: PersistedSnapshot) => {
          saved.push({ path: activePath, snapshot })
          return true
        },
      },
    },
  })

  enablePersistWrites()
  try {
    useStore.setState({ trades: [oldTrade] })
    const switching = switchActiveLibrary('open', 'D:\\new-library')
    await Promise.race([
      preparationStartedPromise,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('切库必须先进入候选库准备阶段')), 100)
      }),
    ])
    useStore.setState((state) => ({ trades: [...state.trades, lateTrade] }))
    allowPreparation()

    const result = await switching
    assert(result.ok, '两阶段切库应成功激活已准备的候选库')
    assert(useStore.getState().tagPresets.includes('新库'), '激活后必须 hydrate 候选库快照')
    assert(!useStore.getState().trades.some((trade) => trade.id === lateTrade.id), '旧库晚到交易不能串入新库')
  } finally {
    disablePersistWrites()
    Reflect.deleteProperty(globalThis, 'window')
  }
}
