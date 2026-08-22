import type { Trade } from '@/data/trades'
import type { LiveStage, ScheduledStageRollover } from '@/lib/liveStages'
import type { StageRolloverPublishState } from '@/types/journalBridge'
import { applySnapshotToStore } from '@/lib/importExport'
import { haveSamePersistedReferences } from '@/storage/bootstrap'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import {
  applyTradeUpsertsToSlice,
  currentLiveStageIdForWrite,
  useStore,
} from '@/store/useStore'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const stages: LiveStage[] = [{
  id: 'stage-old',
  sequence: 1,
  name: '历史阶段',
  status: 'archived',
  startsOn: '2026-07-01',
  endsOn: '2026-07-31',
  createdAt: '2026-07-01T00:00:00.000Z',
  archivedAt: '2026-08-01T00:00:00.000Z',
}, {
  id: 'stage-current',
  sequence: 2,
  name: '当前阶段',
  status: 'current',
  startsOn: '2026-08-01',
  endsOn: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  archivedAt: null,
}]

function plannedLiveTrade(id: string, liveStageId?: string | null): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategyId: 'strategy-contract',
    tradeKind: 'live',
    ...(liveStageId === undefined ? {} : { liveStageId }),
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 0,
    exit: null,
    size: 0,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-15',
    closedAt: null,
    note: '',
  }
}

function plannedPaperTrade(id: string): Trade {
  const live = plannedLiveTrade(id, 'stage-old')
  if (live.tradeKind !== 'live') throw new Error('测试 fixture 必须是 live')
  const { liveStageId: _liveStageId, ...paper } = live
  return { ...paper, tradeKind: 'paper' }
}

function seedStore(trades: Trade[] = []): void {
  useStore.setState({
    trades,
    liveStages: stages.map((stage) => ({ ...stage })),
    currentLiveStageId: 'stage-current',
    scheduledStageRollover: null,
    strategies: [{ id: 'strategy-contract', name: '策略', icon: 'target', color: '#000000' }],
    symbolCatalog: [],
  })
}

export function testNewLiveTradeAlwaysUsesCurrentStage(): void {
  const previous = useStore.getState()
  try {
    seedStore()
    const trade = plannedLiveTrade('new-live')
    useStore.getState().upsertTrade(trade)
    const stored = useStore.getState().getById(trade.id)
    assert(stored?.tradeKind === 'live' && stored.liveStageId === 'stage-current', '新实盘交易必须使用当前阶段')
  } finally {
    useStore.setState(previous)
  }
}

export function testStorePublishesOnlyOneScheduledRolloverUntilCancelled(): void {
  const previous = useStore.getState()
  try {
    seedStore()
    useStore.getState().scheduleLiveStageRollover('2026-08-24', '2026-08-24T09:00:00.000Z')
    const scheduled = useStore.getState().scheduledStageRollover
    assert(scheduled?.effectiveWeekStart === '2026-08-31', 'Store 预约在周一必须指向严格未来的下周一')

    useStore.getState().scheduleLiveStageRollover('2026-08-28', '2026-08-28T10:00:00.000Z')
    assert(useStore.getState().scheduledStageRollover === scheduled, '已有预约不得被重复请求覆盖')

    const postponed: ScheduledStageRollover = {
      ...scheduled,
      effectiveWeekStart: '2026-09-07',
      postponedCount: 1,
    }
    useStore.getState().publishPostponedRollover(postponed)
    assert(useStore.getState().scheduledStageRollover === postponed, 'Store 必须发布已计算的顺延预约')

    useStore.getState().cancelLiveStageRollover()
    assert(useStore.getState().scheduledStageRollover === null, '取消必须清空预约')
  } finally {
    useStore.setState(previous)
  }
}

export function testStorePublishesEveryAuthoritativeDurableStageFieldTogether(): void {
  const previous = useStore.getState()
  try {
    seedStore()
    useStore.setState({
      liveStatsStartTradingDayKey: '2026-08-01',
      livePerformanceCycles: [{
        id: 'legacy-before',
        name: '旧镜像',
        startTradingDayKey: '2026-08-01',
        createdAt: '2026-08-01T00:00:00.000Z',
      }],
    })
    const publish: StageRolloverPublishState = {
      liveStages: [{ ...stages[0]! }, {
        id: 'stage-next',
        sequence: 3,
        name: '新阶段',
        status: 'current',
        startsOn: '2026-08-31',
        endsOn: null,
        createdAt: '2026-08-31T00:00:00.000Z',
        archivedAt: null,
      }],
      currentLiveStageId: 'stage-next',
      scheduledStageRollover: null,
      liveStatsStartTradingDayKey: '2026-08-31',
      livePerformanceCycles: [{
        id: 'legacy-stage-3',
        name: '新阶段',
        startTradingDayKey: '2026-08-31',
        createdAt: '2026-08-31T00:00:00.000Z',
      }],
    }
    useStore.getState().publishCommittedStageRollover(publish)
    const state = useStore.getState()
    assert(state.liveStages === publish.liveStages, 'Store must publish authoritative stages')
    assert(state.currentLiveStageId === publish.currentLiveStageId, 'Store must publish authoritative stage pointer')
    assert(state.scheduledStageRollover === null, 'Store must publish the cleared schedule')
    assert(
      state.liveStatsStartTradingDayKey === publish.liveStatsStartTradingDayKey,
      'Store must publish compatibility start key',
    )
    assert(
      state.livePerformanceCycles === publish.livePerformanceCycles,
      'Store must publish compatibility cycles atomically',
    )
  } finally {
    useStore.setState(previous)
  }
}

export function testEveryCanonicalStageReferenceParticipatesInPersistenceRevision(): void {
  const snapshot = createFullPersistedSnapshotFixture()
  const changedStages = { ...snapshot, liveStages: [...snapshot.liveStages] }
  const changedCurrent = { ...snapshot, currentLiveStageId: 'another-stage-id' }
  const changedRollover = {
    ...snapshot,
    scheduledStageRollover: {
      id: 'rollover-new',
      requestedAt: '2026-08-20T00:00:00.000Z',
      effectiveWeekStart: '2026-08-24',
      postponedCount: 0,
    },
  }
  assert(!haveSamePersistedReferences(snapshot, changedStages), 'liveStages 引用变化必须触发持久化')
  assert(!haveSamePersistedReferences(snapshot, changedCurrent), 'currentLiveStageId 变化必须触发持久化')
  assert(!haveSamePersistedReferences(snapshot, changedRollover), 'scheduledStageRollover 引用变化必须触发持久化')
}

export function testTradeKindTransitionsMaintainCanonicalStageShape(): void {
  const previous = useStore.getState()
  try {
    seedStore([plannedLiveTrade('transition', 'stage-old')])
    assert(useStore.getState().transitionTradeKind('transition', 'paper'), 'live→paper 应成功')
    const paper = useStore.getState().getById('transition')
    assert(paper?.tradeKind === 'paper', '转换后必须是 paper')
    assert(!Object.prototype.hasOwnProperty.call(paper, 'liveStageId'), 'live→paper 必须移除 liveStageId')

    assert(useStore.getState().transitionTradeKind('transition', 'live'), 'paper→live 应成功')
    const live = useStore.getState().getById('transition')
    assert(live?.tradeKind === 'live' && live.liveStageId === 'stage-current', 'paper→live 必须归当前阶段')
  } finally {
    useStore.setState(previous)
  }
}

export function testAccountCopiesAlwaysEnterCurrentStage(): void {
  const previous = useStore.getState()
  try {
    seedStore([plannedLiveTrade('source-old', 'stage-old'), plannedLiveTrade('source-null', null)])
    useStore.getState().upsertTrade({ ...plannedLiveTrade('source-old', 'stage-old'), id: 'copy-old' })
    useStore.getState().upsertTrade({ ...plannedLiveTrade('source-null', null), id: 'copy-null' })
    const historicalCopy = useStore.getState().getById('copy-old')
    const nullCopy = useStore.getState().getById('copy-null')
    assert(historicalCopy?.tradeKind === 'live' && historicalCopy.liveStageId === 'stage-current', '历史 live 副本必须归当前阶段')
    assert(nullCopy?.tradeKind === 'live' && nullCopy.liveStageId === 'stage-current', '遗留 null live 副本必须归当前阶段')
  } finally {
    useStore.setState(previous)
  }
}

export function testWeeklyReviewPatchCannotChangeStageOwnership(): void {
  const previous = useStore.getState()
  try {
    const review = {
      ...createFullPersistedSnapshotFixture().weeklyReviews![0]!,
      liveStageId: 'stage-old',
    }
    seedStore()
    useStore.setState({ weeklyReviews: [review] })
    if (Date.now() < 0) {
      // @ts-expect-error 普通周复盘 patch 不得包含阶段归属
      useStore.getState().updateWeeklyReview(review.id, { liveStageId: 'stage-current' })
    }
    useStore.getState().updateWeeklyReview(
      review.id,
      { liveStageId: 'stage-current' } as never,
    )
    assert(useStore.getState().weeklyReviews[0]?.liveStageId === 'stage-old', '运行时周复盘 patch 不得改写阶段归属')
  } finally {
    useStore.setState(previous)
  }
}

export function testExistingPaperUpsertRemovesInjectedStageField(): void {
  const previous = useStore.getState()
  try {
    const paper = plannedPaperTrade('paper-existing')
    seedStore([paper])
    const injected = { ...paper, liveStageId: 'stage-old', note: 'edited' } as Trade
    useStore.getState().upsertTrade(injected)
    const stored = useStore.getState().getById(paper.id)
    assert(stored?.tradeKind === 'paper' && stored.note === 'edited', '已有 paper 普通编辑必须成功')
    assert(!Object.prototype.hasOwnProperty.call(stored, 'liveStageId'), '已有 paper upsert 必须清除注入的 liveStageId')
    const direct = applyTradeUpsertsToSlice({
      trades: [paper],
      strategies: useStore.getState().strategies,
      symbolCatalog: [],
      tagPresets: [],
      mistakeTagPresets: [],
    }, [injected])
    assert(
      !Object.prototype.hasOwnProperty.call(direct.trades[0], 'liveStageId'),
      '中央批量 upsert 也必须清除已有 paper 的注入字段',
    )
  } finally {
    useStore.setState(previous)
  }
}

export function testCsvStyleNonInteractiveImportUsesCurrentStage(): void {
  const previous = useStore.getState()
  try {
    seedStore()
    const imported = plannedLiveTrade('csv-live')
    useStore.getState().upsertTradesFromNonInteractiveImport([imported])
    const stored = useStore.getState().getById(imported.id)
    assert(stored?.tradeKind === 'live' && stored.liveStageId === 'stage-current', 'CSV 导入必须进入当前阶段')
  } finally {
    useStore.setState(previous)
  }
}

export function testCaseInheritsSourceStage(): void {
  const previous = useStore.getState()
  try {
    seedStore([plannedLiveTrade('trade-old', 'stage-old')])
    const result = useStore.getState().createReviewCaseFromTrade('trade-old')
    assert(result.status === 'created', '历史交易应能生成案例')
    assert(result.reviewCase.tradeKind === 'case' && result.reviewCase.liveStageId === 'stage-old', '案例必须继承来源阶段')
  } finally {
    useStore.setState(previous)
  }
}

export function testEditingHistoricalDateDoesNotMoveStage(): void {
  const previous = useStore.getState()
  try {
    seedStore([plannedLiveTrade('trade-old', 'stage-old')])
    useStore.getState().updateTradeData('trade-old', { openedAt: '2026-12-01' })
    const stored = useStore.getState().getById('trade-old')
    assert(stored?.tradeKind === 'live' && stored.liveStageId === 'stage-old', '日期编辑必须保留阶段')
  } finally {
    useStore.setState(previous)
  }
}

export function testOrdinaryUpsertCannotMoveHistoricalOrNullOwnership(): void {
  const previous = useStore.getState()
  try {
    seedStore([plannedLiveTrade('trade-old', 'stage-old'), plannedLiveTrade('trade-unrepaired', null)])
    useStore.getState().upsertTrade({ ...plannedLiveTrade('trade-old', 'stage-current'), note: 'edited' })
    useStore.getState().upsertTrade({ ...plannedLiveTrade('trade-unrepaired', 'stage-current'), note: 'edited' })
    const historical = useStore.getState().getById('trade-old')
    const unrepaired = useStore.getState().getById('trade-unrepaired')
    assert(historical?.tradeKind === 'live' && historical.liveStageId === 'stage-old', '普通编辑不得迁移历史阶段')
    assert(unrepaired?.tradeKind === 'live' && unrepaired.liveStageId === null, '普通编辑必须保留未修复 null 归属')
  } finally {
    useStore.setState(previous)
  }
}

export function testWeeklyAndRiskCreationUseCurrentStage(): void {
  const previous = useStore.getState()
  try {
    seedStore()
    useStore.getState().upsertWeeklyReview({
      id: 'weekly-review:2026-08-17', weekStart: '2026-08-17', weekEnd: '2026-08-23', status: 'draft',
      executionScore: null, riskScore: null, emotionScore: null, strengthTags: [], mistakeTags: [],
      highlightTradeIds: [], mistakeTradeIds: [], followUpTradeIds: [], contentHtml: '', commitmentText: '',
      commitmentCriteria: '', previousCommitmentResult: null, metricsSnapshot: null,
      createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z', completedAt: null,
    })
    useStore.getState().saveWeeklyRiskDraft('2026-08-17', {
      capitalBase: 10_000, riskPercent: 1, riskAmount: null, dailyLossLimitR: 2,
      weeklyLossLimitR: 5, monthlyLossLimitRDefault: 10, disciplineText: '按计划执行',
    }, '2026-08-17T00:00:00.000Z')
    useStore.getState().confirmWeeklyRiskPreparation({
      currentTradingDayKey: '2026-08-17',
      weekStart: '2026-08-17',
      draft: {
        capitalBase: 10_000, riskPercent: 1, riskAmount: null, dailyLossLimitR: 2,
        weeklyLossLimitR: 5, monthlyLossLimitRDefault: 10, disciplineText: '按计划执行',
      },
      confirmedAt: '2026-08-17T01:00:00.000Z',
      policyVersionId: 'policy-current-stage',
    })
    assert(useStore.getState().weeklyReviews[0]?.liveStageId === 'stage-current', '新周复盘必须属于当前阶段')
    assert(useStore.getState().weeklyRiskPreparations[0]?.liveStageId === 'stage-current', '新风险草稿必须属于当前阶段')
    assert(useStore.getState().riskPolicyVersions[0]?.liveStageId === 'stage-current', '新风险策略必须属于当前阶段')
    assert(useStore.getState().monthlyRiskLimits[0]?.liveStageId === 'stage-current', '新月度限额必须属于当前阶段')
  } finally {
    useStore.setState(previous)
  }
}

export function testNewStageRiskDraftDoesNotReuseArchivedStageDraft(): void {
  const previous = useStore.getState()
  try {
    seedStore()
    useStore.setState({
      weeklyRiskPreparations: [{
        id: 'weekly-risk-preparation:2026-08-17',
        liveStageId: 'stage-old',
        weekStart: '2026-08-17',
        draft: {
          capitalBase: 99_999,
          riskPercent: 9,
          riskAmount: 9_000,
          dailyLossLimitR: 9,
          weeklyLossLimitR: 9,
          monthlyLossLimitRDefault: 9,
          disciplineText: '旧阶段草稿',
        },
        reviewedAt: '2026-08-17T00:00:00.000Z',
        confirmedPolicyVersionId: 'policy-old',
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
      }],
    })

    useStore.getState().saveWeeklyRiskDraft('2026-08-17', {
      capitalBase: 10_000,
      riskPercent: 1,
      riskAmount: null,
      dailyLossLimitR: 2,
      weeklyLossLimitR: 5,
      monthlyLossLimitRDefault: 10,
      disciplineText: '新阶段草稿',
    }, '2026-08-17T01:00:00.000Z')

    const preparations = useStore.getState().weeklyRiskPreparations
    assert(preparations.length === 2, '新阶段同周草稿必须独立新建')
    assert(preparations.at(-1)?.liveStageId === 'stage-current', '新草稿必须属于当前阶段')
    assert(preparations.at(-1)?.reviewedAt === null, '新阶段不得继承旧阶段已复核状态')
  } finally {
    useStore.setState(previous)
  }
}

export function testCurrentStageForWriteRejectsInvalidStageState(): void {
  let message = ''
  try {
    currentLiveStageIdForWrite({ liveStages: stages, currentLiveStageId: 'missing' })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('当前实盘阶段无效'), '写入边界必须拒绝无效当前阶段')
}

export function testFullRestorePreservesArchiveStageGraph(): void {
  const previous = useStore.getState()
  try {
    const snapshot = createFullPersistedSnapshotFixture()
    snapshot.liveStages = stages.map((stage) => ({ ...stage }))
    snapshot.currentLiveStageId = 'stage-current'
    snapshot.scheduledStageRollover = {
      id: 'rollover-contract', requestedAt: '2026-08-20T00:00:00.000Z',
      effectiveWeekStart: '2026-08-24', postponedCount: 1,
    }
    const archivedTrade = snapshot.trades[0]!
    assert(archivedTrade.tradeKind === 'live', '完整快照 fixture 必须包含实盘交易')
    snapshot.trades[0] = { ...archivedTrade, liveStageId: 'stage-old' }
    applySnapshotToStore(snapshot)
    const restored = useStore.getState()
    assert(restored.liveStages.length === 2 && restored.liveStages[0]?.id === 'stage-old', '完整恢复必须保留阶段图')
    assert(restored.currentLiveStageId === 'stage-current', '完整恢复必须保留当前阶段指针')
    assert(restored.scheduledStageRollover?.id === 'rollover-contract', '完整恢复必须保留待执行切换')
    const restoredTrade = restored.trades[0]
    assert(restoredTrade?.tradeKind === 'live' && restoredTrade.liveStageId === 'stage-old', '完整恢复不得重写交易阶段')
  } finally {
    useStore.setState(previous)
  }
}
