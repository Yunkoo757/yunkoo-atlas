import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { applyImport } from '@/lib/importExport'
import { resolveLiveRecordBucket } from '@/lib/liveStatisticsArchive'
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

function fullFixtureWithTradeIdentity(): PersistedSnapshot {
  const fixture = createFullPersistedSnapshotFixture()
  return {
    ...fixture,
    trades: fixture.trades.map((item) => ({
      ...item,
      activities: [{
        id: `create:${item.id}`,
        kind: 'create',
        timestamp: item.openedAt,
      }],
    })),
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

  const current = fullFixtureWithTradeIdentity()
  useStore.setState({ ...current })
  const imported = fullFixtureWithTradeIdentity()
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

  const current = fullFixtureWithTradeIdentity()
  useStore.setState({ ...current })
  const imported = fullFixtureWithTradeIdentity()

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

  const current = fullFixtureWithTradeIdentity()
  useStore.setState({ ...current })
  const imported = fullFixtureWithTradeIdentity()

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

export async function testConcurrentLivePerformanceCycleEditRetriesAndKeepsLatestLocalConfiguration(): Promise<void> {
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
          if (commitCount === 1) {
            commitStarted.resolve()
            await allowCommit.promise
          }
          return true
        },
        saveSnapshot: async (snapshot: PersistedSnapshot) => {
          savedSnapshots.push(snapshot)
          return true
        },
      },
    },
  })

  const previous = useStore.getState()
  const localDuringImport = {
    id: 'local-during-import-cycle',
    name: '等待期间本地周期',
    startTradingDayKey: '2026-08-05',
    createdAt: '2026-08-05T00:00:00.000Z',
  }
  const importedCycle = {
    id: 'imported-cycle',
    name: '导入周期',
    startTradingDayKey: '2026-08-01',
    createdAt: '2026-08-01T00:00:00.000Z',
  }
  useStore.setState({
    trades: [], strategies: [strategy], starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY }, tagPresets: [], mistakeTagPresets: [], savedTradeViews: [],
    symbolIcons: {}, symbolCatalog: [], livePerformanceCycles: [],
  })

  enablePersistWrites()
  try {
    const importing = applyImport({
      version: 10,
      trades: [], weeklyRiskPreparations: [], riskPolicyVersions: [], monthlyRiskLimits: [], riskOverrideEvents: [],
      strategies: [strategy], starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: { ...DEFAULT_DISPLAY },
      livePerformanceCycles: [importedCycle],
    })
    await commitStarted.promise
    useStore.getState().replaceLivePerformanceCycles([localDuringImport])
    allowCommit.resolve()
    const result = await importing

    assert(commitCount === 2, '并发本地周期修改必须触发基于最新状态的重试')
    assert(useStore.getState().livePerformanceCycles[0]?.id === localDuringImport.id, '最终状态必须保留最新本地周期配置')
    assert(savedSnapshots.at(-1)?.livePerformanceCycles?.[0]?.id === localDuringImport.id, '最终落盘必须保留最新本地周期配置')
    assert(result.summary.includes('保留当前统计与历史归档设置'), '本地设置保留时摘要必须使用可理解的当前统计与历史归档文案')
  } finally {
    disablePersistWrites()
    useStore.setState(previous)
    Reflect.deleteProperty(globalThis, 'window')
  }
}

export async function testJsonImportSummaryPreservesEmptyLocalLivePerformanceCycles(): Promise<void> {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { journalBridge: { isElectron: true, commitImport: async () => true, saveSnapshot: async () => true } },
  })
  const previous = useStore.getState()
  useStore.setState({
    trades: [], strategies: [strategy], starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY }, tagPresets: [], mistakeTagPresets: [], savedTradeViews: [],
    symbolIcons: {}, symbolCatalog: [], livePerformanceCycles: [],
  })
  enablePersistWrites()
  try {
    const result = await applyImport({
      version: 10,
      trades: [], weeklyRiskPreparations: [], riskPolicyVersions: [], monthlyRiskLimits: [], riskOverrideEvents: [],
      strategies: [strategy], starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: { ...DEFAULT_DISPLAY },
    })
    assert(
      result.summary.includes('保留当前统计与历史归档设置'),
      '空本地边界也必须明确告知保留当前统计与历史归档设置',
    )
    assert(useStore.getState().livePerformanceCycles.length === 0, '导入周期不得覆盖本地空边界')
  } finally {
    disablePersistWrites()
    useStore.setState(previous)
    Reflect.deleteProperty(globalThis, 'window')
  }
}

export async function testImportedTradesUseLocalBoundaries(): Promise<void> {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { journalBridge: { isElectron: true, commitImport: async () => true, saveSnapshot: async () => true } },
  })
  const previous = useStore.getState()
  const localCycle = {
    id: 'local-boundary', name: '本地统计', startTradingDayKey: '2026-08-10', createdAt: '2026-08-10T00:00:00.000Z',
  }
  const imported = {
    ...trade('imported-local-boundary', 'BTCUSDT'),
    status: 'win' as const,
    closedAt: '2026-08-05T12:00:00.000Z',
    closedTradingDayKey: '2026-08-05',
    exit: 110,
    pnl: 100,
    rMultiple: 1,
    resultSource: 'imported' as const,
  }
  useStore.setState({
    trades: [], strategies: [strategy], starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
    display: { ...DEFAULT_DISPLAY, tradingDayStartHour: 0 }, tagPresets: [], mistakeTagPresets: [], savedTradeViews: [],
    symbolIcons: {}, symbolCatalog: [], livePerformanceCycles: [localCycle],
  })
  enablePersistWrites()
  try {
    await applyImport({
      version: 10, trades: [imported], weeklyRiskPreparations: [], riskPolicyVersions: [], monthlyRiskLimits: [], riskOverrideEvents: [],
      strategies: [strategy], starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: { ...DEFAULT_DISPLAY },
      livePerformanceCycles: [{ id: 'external-boundary', name: '外部统计', startTradingDayKey: '2026-08-01', createdAt: '2026-08-01T00:00:00.000Z' }],
    })
    const merged = useStore.getState()
    const actual = merged.trades.find((item) => item.id === imported.id)
    assert(merged.livePerformanceCycles[0]?.id === localCycle.id, '导入必须保留本地统计边界')
    assert(actual && resolveLiveRecordBucket(actual, merged.livePerformanceCycles, 0) === 'archive', '导入交易必须按本地边界重新投影')
  } finally {
    disablePersistWrites()
    useStore.setState(previous)
    Reflect.deleteProperty(globalThis, 'window')
  }
}

export async function testRepeatedRealImportKeepsStableTradesEventsAssetsAndReferences(): Promise<void> {
  const committedSnapshots: PersistedSnapshot[] = []
  const persistedAssets = new Set<string>()
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
          committedSnapshots.push(snapshot)
          const snapshotJson = JSON.stringify(snapshot)
          for (const asset of assets) {
            if (!options?.pruneUnreferenced || snapshotJson.includes(`journal-asset://${asset.id}`)) {
              persistedAssets.add(asset.id)
            }
          }
          return true
        },
        saveSnapshot: async () => true,
      },
    },
  })

  const current = createFullPersistedSnapshotFixture()
  const localTrade = trade('shared-import-id', 'EURUSD')
  const localReferencedTrade = trade('local-reference-target', 'GBPUSD')
  const importedTrade = {
    ...trade('shared-import-id', 'BTCUSDT'),
    ref: 'IMPORTED-REF',
    note: '<img src="journal-asset://source-asset">',
    activities: [{ id: 'import-create', kind: 'create' as const, timestamp: '2026-07-14T09:00:00.000Z' }],
  }
  const importedCase = {
    ...trade('imported-reference-case', 'GBPUSD'),
    tradeKind: 'case' as const,
    sourceTradeId: localReferencedTrade.id,
    activities: [{ id: 'imported-case-create', kind: 'create' as const, timestamp: '2026-07-14T09:00:00.000Z' }],
  }
  const importedEvent = {
    ...current.riskOverrideEvents[0]!,
    id: 'repeated-import-event',
    tradeId: importedTrade.id,
    tradeIdentityAtDecision: {
      ref: importedTrade.ref,
      symbol: importedTrade.symbol,
      tradeKind: 'live' as const,
    },
  }
  const importedReview = {
    ...current.weeklyReviews![0]!,
    id: 'weekly-review:2026-07-20',
    weekStart: '2026-07-20',
    weekEnd: '2026-07-26',
    contentHtml: '',
    highlightTradeIds: [importedTrade.id],
    mistakeTradeIds: [localReferencedTrade.id],
    followUpTradeIds: [localReferencedTrade.id],
    riskSnapshot: {
      ...current.weeklyReviews![0]!.riskSnapshot!,
      overrideEvents: [importedEvent],
    },
  }
  useStore.setState({
    ...current,
    trades: [localTrade, localReferencedTrade],
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [],
    weeklyReviews: [],
  })
  const payload = {
    version: 9,
    ...current,
    trades: [importedTrade, importedCase],
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [importedEvent],
    weeklyReviews: [importedReview],
    quickNotes: [],
    starredIds: [localReferencedTrade.id],
    subscribedIds: [localReferencedTrade.id],
    assets: [{ id: 'source-asset', mime: 'image/png', data: 'aW1hZ2U=' }],
  }

  enablePersistWrites()
  try {
    await applyImport(payload)
    const once = useStore.getState()
    const importedId = once.trades.find((item) => item.ref === importedTrade.ref)?.id
    const onceTradeCount = once.trades.length
    const onceEventCount = once.riskOverrideEvents.length
    const onceAssetCount = persistedAssets.size
    await applyImport(payload)
    const twice = useStore.getState()

    assert(importedId && importedId !== localTrade.id, '真实入口必须保留本地交易并稳定重编号冲突交易')
    assert(twice.trades.length === onceTradeCount, '同一原始 payload 重复导入不得新增交易')
    assert(twice.riskOverrideEvents.length === onceEventCount, '同一原始 payload 重复导入不得新增 override event')
    assert(persistedAssets.size === onceAssetCount, '同一原始 payload 重复导入不得留下重复附件')
    assert(twice.riskOverrideEvents[0]?.tradeId === importedId, '顶层 override 引用必须稳定指向导入交易')
    assert(
      twice.trades.find((item) => item.id === importedCase.id)?.sourceTradeId === localReferencedTrade.id,
      '真实片段导入必须保留指向既有本地交易的案例来源',
    )
    assert(
      twice.weeklyReviews[0]?.riskSnapshot?.overrideEvents[0]?.tradeId === importedId,
      '冻结 override 引用必须稳定指向导入交易',
    )
    assert(twice.weeklyReviews[0]?.mistakeTradeIds[0] === localReferencedTrade.id, '真实片段导入必须保留周复盘本地交易引用')
    assert(twice.starredIds.includes(localReferencedTrade.id), '真实片段导入必须保留收藏中的本地交易引用')
    assert(twice.subscribedIds.includes(localReferencedTrade.id), '真实片段导入必须保留订阅中的本地交易引用')
    assert(
      twice.riskOverrideEvents.every((event) => event.linkState === 'resolved'),
      '重复导入不得产生 unresolved 引用',
    )
    assert(committedSnapshots.length === 2, '无并发时每次真实导入只应提交一次')
  } finally {
    disablePersistWrites()
    Reflect.deleteProperty(globalThis, 'window')
  }
}

export async function testConcurrentStableImportedIdPreemptionCompensatesAndRejects(): Promise<void> {
  const committedSnapshots: PersistedSnapshot[] = []
  const persistedAssets = new Set<string>()
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
          const snapshotJson = JSON.stringify(snapshot)
          for (const asset of assets) {
            if (!options?.pruneUnreferenced || snapshotJson.includes(`journal-asset://${asset.id}`)) {
              persistedAssets.add(asset.id)
            } else {
              persistedAssets.delete(asset.id)
            }
          }
          if (commitCount === 1) {
            const mappedId = snapshot.trades.find((item) => item.ref === 'CONCURRENT-IMPORTED')?.id
            if (!mappedId) throw new Error('首次候选必须包含稳定映射后的导入交易')
            useStore.setState((state) => ({
              trades: [
                ...state.trades,
                { ...trade(mappedId, 'XAUUSD'), ref: 'CONCURRENT-OCCUPANT' },
              ],
            }))
          }
          return true
        },
        saveSnapshot: async () => true,
      },
    },
  })

  const current = createFullPersistedSnapshotFixture()
  const localTrade = trade('concurrent-shared-id', 'EURUSD')
  const importedTrade = {
    ...trade('concurrent-shared-id', 'BTCUSDT'),
    ref: 'CONCURRENT-IMPORTED',
    note: '<img src="journal-asset://concurrent-source-asset">',
    activities: [{ id: 'concurrent-create', kind: 'create' as const, timestamp: '2026-07-14T09:00:00.000Z' }],
  }
  const importedEvent = {
    ...current.riskOverrideEvents[0]!,
    id: 'concurrent-preemption-event',
    tradeId: importedTrade.id,
    tradeIdentityAtDecision: {
      ref: importedTrade.ref,
      symbol: importedTrade.symbol,
      tradeKind: 'live' as const,
    },
  }
  useStore.setState({
    ...current,
    trades: [localTrade],
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [],
    weeklyReviews: [],
  })

  enablePersistWrites()
  try {
    let errorMessage = ''
    try {
      await applyImport({
        version: 9,
        ...current,
        trades: [importedTrade],
        weeklyRiskPreparations: [],
        riskPolicyVersions: [],
        monthlyRiskLimits: [],
        riskOverrideEvents: [importedEvent],
        weeklyReviews: [],
        quickNotes: [],
        assets: [{ id: 'concurrent-source-asset', mime: 'image/png', data: 'aW1hZ2U=' }],
      })
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    }

    assert(errorMessage.includes('稳定导入交易 ID'), '并发预占稳定映射 ID 时必须明确拒绝导入')
    assert(commitCount === 2, '并发预占必须用第二次补偿提交撤销首次导入候选')
    assert(persistedAssets.size === 0, '补偿提交必须清理首次候选写入的附件')
    assert(useStore.getState().trades.some((item) => item.ref === 'CONCURRENT-OCCUPANT'), '并发本地交易必须保留')
    assert(useStore.getState().riskOverrideEvents.length === 0, '被拒绝导入的 event 不得发布到 Store')
    assert(committedSnapshots.at(-1)?.riskOverrideEvents.length === 0, '补偿快照不得保留错链 event')
  } finally {
    disablePersistWrites()
    Reflect.deleteProperty(globalThis, 'window')
  }
}
