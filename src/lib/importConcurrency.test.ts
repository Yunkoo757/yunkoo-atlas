import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { applyImport } from '@/lib/importExport'
import { enablePersistWrites, disablePersistWrites } from '@/storage/persist'
import type { ExportAssetRecord, PersistedSnapshot } from '@/storage/types'
import { useStore } from '@/store/useStore'
import {
  canonicalContractJson,
  createFullPersistedSnapshotFixture,
} from '@/storage/fixtures/fullPersistedSnapshot'

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
    const importing = applyImport({
      version: 6,
      trades: [imported],
      weeklyRiskPreparations: [],
      riskPolicyVersions: [],
      monthlyRiskLimits: [],
      riskOverrideEvents: [],
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
    assert(
      finalState.trades.some((item) => item.id === imported.id),
      `导入交易必须保留；实际交易=${finalState.trades.map((item) => item.id).join(',')}；提交次数=${commitCount}`,
    )
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
    const importing = applyImport({
      version: 6,
      trades: [imported],
      weeklyRiskPreparations: [],
      riskPolicyVersions: [],
      monthlyRiskLimits: [],
      riskOverrideEvents: [],
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
    assert(
      errorMessage.includes('本地编辑'),
      `同 ID 记录发生并发修改时必须明确告知导入已取消；实际错误=${errorMessage || '<empty>'}`,
    )
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

export async function testImmutableRiskConflictRejectsBeforeCommitWithoutPartialStateOrAssets(): Promise<void> {
  let commitCount = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      journalBridge: {
        isElectron: true,
        commitImport: async () => {
          commitCount += 1
          return true
        },
        saveSnapshot: async () => true,
      },
    },
  })

  const current = createFullPersistedSnapshotFixture()
  useStore.setState({ ...current })
  const imported = createFullPersistedSnapshotFixture()
  const localOverride = current.riskOverrideEvents[0]!
  const originalTrades = useStore.getState().trades
  const originalOverrides = useStore.getState().riskOverrideEvents

  enablePersistWrites()
  try {
    let code: unknown
    try {
      await applyImport({
        version: 9,
        ...imported,
        trades: imported.trades.map((item) => ({
          ...item,
          note: '<img src="data:image/png;base64,aW5saW5l">',
        })),
        weeklyReviews: [],
        quickNotes: [],
        riskOverrideEvents: [{ ...localOverride, reason: '冲突的导入原因' }],
        assets: [],
      })
    } catch (error) {
      code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    }

    assert(code === 'import-immutable-entity-conflict', '真实 applyImport 必须传播不可变实体冲突码')
    assert(commitCount === 0, '冲突必须在 commitImport 与附件提交前拒绝')
    assert(useStore.getState().trades === originalTrades, '冲突导入不得写入任何交易状态')
    assert(useStore.getState().riskOverrideEvents === originalOverrides, '冲突导入不得写入 override 状态')
  } finally {
    disablePersistWrites()
    Reflect.deleteProperty(globalThis, 'window')
  }
}

interface ConcurrentImmutableRiskScenario {
  label: string
  mutate: (current: PersistedSnapshot) => string | number
  readSnapshot: (snapshot: PersistedSnapshot) => string | number | undefined
  readStore: () => string | number | undefined
}

async function runConcurrentImmutableRiskScenario(
  scenario: ConcurrentImmutableRiskScenario,
): Promise<void> {
  const commitStarted = deferred()
  const allowCommit = deferred()
  const committedSnapshots: PersistedSnapshot[] = []
  const commitOptions: Array<{ pruneUnreferenced?: boolean } | undefined> = []
  const persistedImportedAssetIds = new Set<string>()
  let commitCount = 0

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      journalBridge: {
        isElectron: true,
        commitImport: async (
          snapshot: PersistedSnapshot,
          assets: ExportAssetRecord[],
          options?: { pruneUnreferenced?: boolean },
        ) => {
          commitCount += 1
          committedSnapshots.push(snapshot)
          commitOptions.push(options)
          const snapshotJson = JSON.stringify(snapshot)
          for (const asset of assets) {
            if (!options?.pruneUnreferenced || snapshotJson.includes(`journal-asset://${asset.id}`)) {
              persistedImportedAssetIds.add(asset.id)
            } else {
              persistedImportedAssetIds.delete(asset.id)
            }
          }
          if (commitCount === 1) {
            commitStarted.resolve()
            await allowCommit.promise
          }
          return true
        },
        saveSnapshot: async () => true,
      },
    },
  })

  const current = createFullPersistedSnapshotFixture()
  useStore.setState({ ...current })
  const imported = createFullPersistedSnapshotFixture()

  enablePersistWrites()
  try {
    const importing = applyImport({
      version: 9,
      ...imported,
      trades: imported.trades.map((item) => ({
        ...item,
        note: '<img src="data:image/png;base64,aW5saW5l">',
      })),
      weeklyReviews: [],
      quickNotes: [],
      assets: [],
    })

    await commitStarted.promise
    const expected = scenario.mutate(current)
    const concurrentTag = `并发字段-${scenario.label}`
    useStore.setState((state) => ({ tagPresets: [...state.tagPresets, concurrentTag] }))
    allowCommit.resolve()

    let code: unknown
    try {
      await importing
    } catch (error) {
      code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    }

    const compensated = committedSnapshots.at(-1)
    assert(code === 'import-immutable-entity-conflict', `${scenario.label} 并发冲突必须传播稳定错误码`)
    assert(commitCount === 2, `${scenario.label} 并发冲突必须执行一次补偿提交`)
    assert(commitOptions.at(-1)?.pruneUnreferenced === true, `${scenario.label} 补偿必须清理未引用附件`)
    assert(persistedImportedAssetIds.size === 0, `${scenario.label} 首次提交的导入附件必须被清理`)
    assert(compensated && scenario.readSnapshot(compensated) === expected, `${scenario.label} 补偿必须持久化最新本地实体`)
    assert(scenario.readStore() === expected, `${scenario.label} Store 不得发布旧导入候选`)
    assert(compensated?.tagPresets?.includes(concurrentTag), `${scenario.label} 补偿必须包含其他并发持久字段`)
    assert(
      useStore.getState().trades[0]?.note === current.trades[0]?.note,
      `${scenario.label} Store 不得发布包含暂存附件的旧交易`,
    )
    for (const field of [
      'weeklyRiskPreparations',
      'riskPolicyVersions',
      'monthlyRiskLimits',
      'riskOverrideEvents',
    ] as const) {
      assert(
        canonicalContractJson(compensated?.[field]) === canonicalContractJson(useStore.getState()[field]),
        `${scenario.label} 补偿快照必须包含最新 ${field}`,
      )
    }
  } finally {
    disablePersistWrites()
    Reflect.deleteProperty(globalThis, 'window')
  }
}

export async function testConcurrentImmutableRiskChangesCompensateBeforeRejectingImport(): Promise<void> {
  await runConcurrentImmutableRiskScenario({
    label: 'policy',
    mutate: (current) => {
      const disciplineText = '并发本地 policy'
      useStore.setState({
        riskPolicyVersions: [{ ...current.riskPolicyVersions[0]!, disciplineText }],
      })
      return disciplineText
    },
    readSnapshot: (snapshot) => snapshot.riskPolicyVersions[0]?.disciplineText,
    readStore: () => useStore.getState().riskPolicyVersions[0]?.disciplineText,
  })
  await runConcurrentImmutableRiskScenario({
    label: 'monthly-limit',
    mutate: (current) => {
      const limitR = 8.5
      useStore.setState({
        monthlyRiskLimits: [{ ...current.monthlyRiskLimits[0]!, limitR }],
      })
      return limitR
    },
    readSnapshot: (snapshot) => snapshot.monthlyRiskLimits[0]?.limitR,
    readStore: () => useStore.getState().monthlyRiskLimits[0]?.limitR,
  })
  await runConcurrentImmutableRiskScenario({
    label: 'override-event',
    mutate: (current) => {
      const reason = '并发本地覆盖原因'
      useStore.setState({
        riskOverrideEvents: [{ ...current.riskOverrideEvents[0]!, reason }],
      })
      return reason
    },
    readSnapshot: (snapshot) => snapshot.riskOverrideEvents[0]?.reason,
    readStore: () => useStore.getState().riskOverrideEvents[0]?.reason,
  })
}

export async function testSameValueImmutableRiskReplacementRetriesWithoutConflict(): Promise<void> {
  const commitStarted = deferred()
  const allowCommit = deferred()
  let commitCount = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      journalBridge: {
        isElectron: true,
        commitImport: async () => {
          commitCount += 1
          if (commitCount === 1) {
            commitStarted.resolve()
            await allowCommit.promise
          }
          return true
        },
        saveSnapshot: async () => true,
      },
    },
  })

  const current = createFullPersistedSnapshotFixture()
  useStore.setState({ ...current })
  const imported = createFullPersistedSnapshotFixture()

  enablePersistWrites()
  try {
    const importing = applyImport({
      version: 9,
      ...imported,
      trades: imported.trades.map((item) => ({ ...item, note: '' })),
      weeklyReviews: [],
      quickNotes: [],
      assets: [],
    })
    await commitStarted.promise
    useStore.setState({
      riskPolicyVersions: [{ ...current.riskPolicyVersions[0]! }],
    })
    allowCommit.resolve()
    await importing

    assert(commitCount === 2, '同值并发替换应安全重试一次')
    assert(
      useStore.getState().riskPolicyVersions[0]?.disciplineText ===
        current.riskPolicyVersions[0]?.disciplineText,
      '同值并发替换不得误报不可变冲突',
    )
  } finally {
    disablePersistWrites()
    Reflect.deleteProperty(globalThis, 'window')
  }
}
