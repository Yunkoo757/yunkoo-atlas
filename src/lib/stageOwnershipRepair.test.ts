import type { Trade } from '@/data/trades'
import {
  applyRecommendedStageBoundaryRepair,
  assignPendingStageOwnership,
  listPendingStageOwnership,
  recommendStageBoundaryRepair,
  rollbackAssignedStageOwnership,
  StageOwnershipRepairError,
  type StageOwnershipEntityType,
  type StageOwnershipRepairState,
} from '@/lib/stageOwnershipRepair'
import { filterStageOwnedRecords, filterStageTrades, matchesStageScope } from '@/lib/stageArchive'
import type { LiveStage } from '@/lib/liveStages'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const stages: LiveStage[] = [{
  id: 'stage-old',
  sequence: 1,
  name: '旧阶段',
  status: 'archived',
  startsOn: '2026-06-01',
  endsOn: '2026-06-30',
  createdAt: '2026-06-01T00:00:00.000Z',
  archivedAt: '2026-07-01T00:00:00.000Z',
}, {
  id: 'stage-current',
  sequence: 2,
  name: '当前阶段',
  status: 'current',
  startsOn: '2026-07-01',
  endsOn: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  archivedAt: null,
}]

function trade(id: string, overrides: Partial<Trade> = {}): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    liveStageId: null,
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 100,
    cashCurrency: 'USD',
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: '2026-06-15',
    recordedAt: '2026-06-16T08:00:00.000Z',
    closedAt: '2026-06-17',
    closedTradingDayKey: '2026-06-17',
    note: '<p>原始正文</p>',
    ...overrides,
  } as Trade
}

function pendingState(): StageOwnershipRepairState {
  const fixture = createFullPersistedSnapshotFixture()
  const live = trade('live')
  const missed = trade('missed', { status: 'missed', missReason: 'hesitation' })
  const source = trade('source', { liveStageId: 'stage-old' })
  const reviewCase = trade('case', {
    tradeKind: 'case',
    sourceTradeId: source.id,
    recordedAt: '2026-06-20T09:00:00.000Z',
  })
  const paper = trade('paper', { tradeKind: 'paper' }) as Trade & { liveStageId?: string | null }
  delete paper.liveStageId
  return {
    liveStages: stages.map((stage) => ({ ...stage })),
    currentLiveStageId: 'stage-current',
    trades: [live, missed, source, reviewCase, paper],
    weeklyReviews: [{
      ...fixture.weeklyReviews![0]!,
      id: 'review',
      liveStageId: null,
      weekStart: '2026-06-08',
      weekEnd: '2026-06-14',
      highlightTradeIds: [],
      mistakeTradeIds: [],
      followUpTradeIds: [],
    }],
    weeklyRiskPreparations: [{
      ...fixture.weeklyRiskPreparations[0]!,
      id: 'preparation',
      liveStageId: null,
      weekStart: '2026-06-08',
      confirmedPolicyVersionId: 'policy-source',
    }],
    riskPolicyVersions: [{
      ...fixture.riskPolicyVersions[0]!,
      id: 'policy',
      liveStageId: null,
      sourceWeekStart: '2026-06-08',
      effectiveTradingDay: '2026-06-09',
    }, {
      ...fixture.riskPolicyVersions[0]!,
      id: 'policy-source',
      liveStageId: 'stage-old',
      sourceWeekStart: '2026-06-01',
      effectiveTradingDay: '2026-06-02',
    }],
    monthlyRiskLimits: [{
      ...fixture.monthlyRiskLimits[0]!,
      id: 'limit',
      liveStageId: null,
      monthKey: '2026-06',
      sourcePolicyVersionId: 'policy-source',
    }],
    riskOverrideEvents: [{
      ...fixture.riskOverrideEvents[0]!,
      id: 'override',
      liveStageId: null,
      tradeId: source.id,
      policyVersionId: 'policy-source',
      tradingDayKeyAtDecision: '2026-06-17',
    }],
  }
}

const entityMatrix: Array<{
  entityType: StageOwnershipEntityType
  entityId: string
  slice: Exclude<keyof StageOwnershipRepairState, 'liveStages' | 'currentLiveStageId'>
}> = [
  { entityType: 'live-trade', entityId: 'live', slice: 'trades' },
  { entityType: 'missed-trade', entityId: 'missed', slice: 'trades' },
  { entityType: 'case-trade', entityId: 'case', slice: 'trades' },
  { entityType: 'weekly-review', entityId: 'review', slice: 'weeklyReviews' },
  { entityType: 'weekly-risk-preparation', entityId: 'preparation', slice: 'weeklyRiskPreparations' },
  { entityType: 'risk-policy-version', entityId: 'policy', slice: 'riskPolicyVersions' },
  { entityType: 'monthly-risk-limit', entityId: 'limit', slice: 'monthlyRiskLimits' },
  { entityType: 'risk-override-event', entityId: 'override', slice: 'riskOverrideEvents' },
]

function expectRepairError(code: StageOwnershipRepairError['code'], action: () => unknown): void {
  let caught: unknown
  try {
    action()
  } catch (error) {
    caught = error
  }
  assert(caught instanceof StageOwnershipRepairError, `必须抛出 StageOwnershipRepairError：${code}`)
  assert(caught.code === code, `错误码必须是 ${code}，实际为 ${caught.code}`)
}

export function testListPendingStageOwnershipIsExhaustiveAndHumanReadable(): void {
  const pending = listPendingStageOwnership(pendingState())
  assert(
    pending.map((item) => `${item.entityType}:${item.entityId}`).join('|') === entityMatrix
      .map((item) => `${item.entityType}:${item.entityId}`).join('|'),
    '待整理发现必须完整覆盖实盘、错过、案例、周复盘与四类风险实体',
  )
  for (const item of pending) {
    assert(item.reference.trim().length > 0, `${item.entityType} 缺少稳定引用`)
    assert(item.title.trim().length > 0, `${item.entityType} 缺少可读标题`)
    assert(item.context.length > 0, `${item.entityType} 缺少原始日期/周期上下文`)
    assert(item.reason.includes('无法可靠归属') && item.reason.includes('未根据日期猜测'), `${item.entityType} 缺少非猜测原因`)
    assert(item.fingerprint.length > 0, `${item.entityType} 缺少 stale 检查指纹`)
  }
  const caseItem = pending.find((item) => item.entityType === 'case-trade')
  assert(caseItem?.source?.id === 'source' && caseItem.source.reference === 'TRD-source', '案例必须显示来源交易关系')
  const overrideItem = pending.find((item) => item.entityType === 'risk-override-event')
  assert(overrideItem?.source?.id === 'source' && overrideItem.source.reference === 'TRD-source', '风险覆盖必须显示来源交易关系')
}

export function testPendingDiscoveryIgnoresPaperAssignedAndUndefinedOwnership(): void {
  const state = pendingState()
  const injectedPaper = { ...trade('paper-null', { tradeKind: 'paper' }), liveStageId: null } as Trade
  const undefinedLive = { ...trade('undefined'), liveStageId: undefined }
  state.trades = [
    ...state.trades,
    injectedPaper,
    undefinedLive,
    trade('assigned', { liveStageId: 'stage-current' }),
  ]

  const ids = listPendingStageOwnership(state).map((item) => item.entityId)
  assert(!ids.includes('paper') && !ids.includes('paper-null'), 'paper 永远不得进入阶段待整理队列')
  assert(!ids.includes('undefined'), 'undefined 是无效旧 schema 状态，不得静默进入修复队列')
  assert(!ids.includes('assigned'), '已有归属实体不得进入修复队列')
}

export function testAssignmentRepairsEveryEntityFamilyWithoutChangingOtherFacts(): void {
  for (const row of entityMatrix) {
    const state = pendingState()
    const beforeJson = JSON.stringify(state)
    const beforeSlice = state[row.slice]
    const targetBefore = (beforeSlice as ReadonlyArray<{ id: string }>).find((item) => item.id === row.entityId)
    const item = listPendingStageOwnership(state).find((candidate) => candidate.entityId === row.entityId)!
    const repaired = assignPendingStageOwnership(state, {
      entityType: row.entityType,
      entityId: row.entityId,
      liveStageId: 'stage-old',
      expectedFingerprint: item.fingerprint,
    })
    const targetAfter = (repaired[row.slice] as ReadonlyArray<{ id: string; liveStageId?: string | null }>)
      .find((candidate) => candidate.id === row.entityId)
    assert(targetAfter?.liveStageId === 'stage-old', `${row.entityType} 必须写入用户显式选择的阶段`)
    assert(targetAfter !== targetBefore, `${row.entityType} 目标对象必须不可变更新`)
    assert(repaired[row.slice] !== beforeSlice, `${row.entityType} 所在集合必须不可变更新`)
    for (const other of entityMatrix) {
      if (other.slice === row.slice) continue
      assert(repaired[other.slice] === state[other.slice], `${row.entityType} 不得改写 ${other.slice} 引用`)
    }
    const normalizedAfter = structuredClone(repaired) as StageOwnershipRepairState
    const normalizedTarget = (normalizedAfter[row.slice] as Array<{ id: string; liveStageId?: string | null }>)
      .find((candidate) => candidate.id === row.entityId)
    assert(normalizedTarget, `${row.entityType} 修复后目标必须仍存在`)
    normalizedTarget.liveStageId = null
    assert(JSON.stringify(normalizedAfter) === beforeJson, `${row.entityType} 除 liveStageId 外不得改变任何事实`)
    assert(JSON.stringify(state) === beforeJson, `${row.entityType} 修复不得修改输入 state`)
  }
}

export function testPendingTradeMovesIntoExactlyOneSelectedScopeAfterRepair(): void {
  const state = pendingState()
  for (const row of entityMatrix) {
    const entity = (state[row.slice] as ReadonlyArray<{ id: string; liveStageId?: string | null }>)
      .find((candidate) => candidate.id === row.entityId)!
    assert(matchesStageScope(entity, { kind: 'pending' }), `${row.entityType} 必须进入 pending scope`)
    assert(!matchesStageScope(entity, { kind: 'current', stageId: 'stage-current' }), `${row.entityType} 不得进入 current scope`)
    assert(!matchesStageScope(entity, { kind: 'stage', stageId: 'stage-old' }), `${row.entityType} 不得进入单个历史 scope`)
    assert(!matchesStageScope(entity, { kind: 'all-history', archivedStageIds: new Set(['stage-old']) }), `${row.entityType} 不得进入全部历史 scope`)
  }
  const pendingTrade = state.trades.find((item) => item.id === 'live')!
  assert(filterStageTrades(state.trades, { kind: 'current', stageId: 'stage-current' }).every((item) => item.id !== 'live'), '待整理交易不得进入当前阶段')
  assert(filterStageTrades(state.trades, { kind: 'all-history', archivedStageIds: new Set(['stage-old']) }).every((item) => item.id !== 'live'), '待整理交易不得进入全部历史')
  assert(filterStageTrades(state.trades, { kind: 'pending' }).some((item) => item.id === 'live'), '待整理交易必须只进入 pending scope')

  const repaired = assignPendingStageOwnership(state, {
    entityType: 'live-trade',
    entityId: pendingTrade.id,
    liveStageId: 'stage-old',
    expectedFingerprint: listPendingStageOwnership(state).find((item) => item.entityId === pendingTrade.id)!.fingerprint,
  })
  assert(filterStageTrades(repaired.trades, { kind: 'pending' }).every((item) => item.id !== 'live'), '成功修复后必须离开 pending scope')
  assert(filterStageTrades(repaired.trades, { kind: 'current', stageId: 'stage-current' }).every((item) => item.id !== 'live'), '选择历史阶段后不得进入当前 scope')
  assert(filterStageTrades(repaired.trades, { kind: 'stage', stageId: 'stage-old' }).filter((item) => item.id === 'live').length === 1, '成功修复后必须只进入所选历史 scope 一次')
  assert(filterStageOwnedRecords(repaired.trades, { kind: 'stage', stageId: 'stage-old' }).filter((item) => item.id === 'live').length === 1, '工作台 stage 投影必须立即反映修复结果')
}

export function testAssignmentRejectsEveryInvalidOrStaleRequestWithoutPartialMutation(): void {
  const state = pendingState()
  const before = JSON.stringify(state)
  const assigned = {
    ...state,
    trades: state.trades.map((item) => item.id === 'live' ? { ...item, liveStageId: 'stage-current' } : item),
  }
  const undefinedOwnership = {
    ...state,
    trades: state.trades.map((item) => item.id === 'live' ? { ...item, liveStageId: undefined } : item),
  }
  const invalidStages = {
    ...state,
    liveStages: state.liveStages.map((stage) => stage.id === 'stage-old' ? { ...stage, name: '' } : stage),
  }
  const fingerprint = listPendingStageOwnership(state).find((item) => item.entityId === 'live')!.fingerprint
  const stale = {
    ...state,
    trades: state.trades.map((item) => item.id === 'live' ? { ...item, note: '<p>并发编辑</p>' } : item),
  }
  const duplicate = { ...state, trades: [...state.trades, { ...state.trades.find((item) => item.id === 'live')! }] }

  expectRepairError('entity-not-found', () => assignPendingStageOwnership(state, { entityType: 'live-trade', entityId: 'missing', liveStageId: 'stage-old', expectedFingerprint: 'missing' }))
  expectRepairError('wrong-entity-type', () => assignPendingStageOwnership(state, { entityType: 'case-trade', entityId: 'live', liveStageId: 'stage-old', expectedFingerprint: fingerprint }))
  expectRepairError('already-assigned', () => assignPendingStageOwnership(assigned, { entityType: 'live-trade', entityId: 'live', liveStageId: 'stage-old', expectedFingerprint: fingerprint }))
  expectRepairError('paper-trade', () => assignPendingStageOwnership(state, { entityType: 'live-trade', entityId: 'paper', liveStageId: 'stage-old', expectedFingerprint: 'paper' }))
  expectRepairError('invalid-ownership', () => assignPendingStageOwnership(undefinedOwnership, { entityType: 'live-trade', entityId: 'live', liveStageId: 'stage-old', expectedFingerprint: fingerprint }))
  expectRepairError('target-stage-not-found', () => assignPendingStageOwnership(state, { entityType: 'live-trade', entityId: 'live', liveStageId: 'missing-stage', expectedFingerprint: fingerprint }))
  expectRepairError('target-stage-invalid', () => assignPendingStageOwnership(invalidStages, { entityType: 'live-trade', entityId: 'live', liveStageId: 'stage-old', expectedFingerprint: fingerprint }))
  expectRepairError('stale-request', () => assignPendingStageOwnership(stale, {
    entityType: 'live-trade',
    entityId: 'live',
    liveStageId: 'stage-old',
    expectedFingerprint: fingerprint,
  }))
  expectRepairError('stale-request', () => assignPendingStageOwnership(duplicate, {
    entityType: 'live-trade',
    entityId: 'live',
    liveStageId: 'stage-old',
    expectedFingerprint: fingerprint,
  }))
  assert(JSON.stringify(state) === before, '任何拒绝路径都不得部分修改原 state')
}

export function testAssignmentUsesCompositeIdentityAndTracksDisplayedSourceContext(): void {
  const state = pendingState()
  state.trades.push(trade('review', { tradeKind: 'paper' }))
  const review = listPendingStageOwnership(state).find((item) => item.entityType === 'weekly-review')!
  const repaired = assignPendingStageOwnership(state, {
    entityType: 'weekly-review',
    entityId: review.entityId,
    liveStageId: 'stage-old',
    expectedFingerprint: review.fingerprint,
  })
  assert(repaired.weeklyReviews[0]?.liveStageId === 'stage-old', '无关 paper 同 ID 不得阻止其他实体族修复')

  const caseItem = listPendingStageOwnership(state).find((item) => item.entityType === 'case-trade')!
  const changedCaseSource = {
    ...state,
    trades: state.trades.map((item) => item.id === 'source' ? { ...item, ref: 'TRD-source-updated' } : item),
  }
  expectRepairError('stale-request', () => assignPendingStageOwnership(changedCaseSource, {
    entityType: 'case-trade',
    entityId: caseItem.entityId,
    liveStageId: 'stage-old',
    expectedFingerprint: caseItem.fingerprint,
  }))

  const overrideItem = listPendingStageOwnership(state).find((item) => item.entityType === 'risk-override-event')!
  const removedOverrideSource = {
    ...state,
    trades: state.trades.filter((item) => item.id !== 'source'),
  }
  expectRepairError('stale-request', () => assignPendingStageOwnership(removedOverrideSource, {
    entityType: 'risk-override-event',
    entityId: overrideItem.entityId,
    liveStageId: 'stage-old',
    expectedFingerprint: overrideItem.fingerprint,
  }))
}

export function testAssignmentRejectsTargetStagePeriodCollisionsBeforeMutation(): void {
  const cases: Array<{
    entityType: StageOwnershipEntityType
    entityId: string
    state: StageOwnershipRepairState
  }> = [
    {
      entityType: 'weekly-review',
      entityId: 'review',
      state: (() => {
        const state = pendingState()
        state.weeklyReviews.push({ ...state.weeklyReviews[0]!, id: 'assigned-review', liveStageId: 'stage-old' })
        return state
      })(),
    },
    {
      entityType: 'weekly-risk-preparation',
      entityId: 'preparation',
      state: (() => {
        const state = pendingState()
        state.weeklyRiskPreparations.push({
          ...state.weeklyRiskPreparations[0]!,
          id: 'assigned-preparation',
          liveStageId: 'stage-old',
        })
        return state
      })(),
    },
    {
      entityType: 'monthly-risk-limit',
      entityId: 'limit',
      state: (() => {
        const state = pendingState()
        state.monthlyRiskLimits.push({ ...state.monthlyRiskLimits[0]!, id: 'assigned-limit', liveStageId: 'stage-old' })
        return state
      })(),
    },
  ]

  for (const testCase of cases) {
    const before = JSON.stringify(testCase.state)
    expectRepairError('ownership-conflict', () => assignPendingStageOwnership(testCase.state, {
      entityType: testCase.entityType,
      entityId: testCase.entityId,
      liveStageId: 'stage-old',
      expectedFingerprint: listPendingStageOwnership(testCase.state)
        .find((item) => item.entityType === testCase.entityType && item.entityId === testCase.entityId)!.fingerprint,
    }))
    assert(JSON.stringify(testCase.state) === before, `${testCase.entityType} 周期冲突不得部分修改 state`)
  }
}

export function testAssignmentRequiresFingerprintAtRuntime(): void {
  const state = pendingState()
  const request = {
    entityType: 'live-trade',
    entityId: 'live',
    liveStageId: 'stage-old',
  } as unknown as Parameters<typeof assignPendingStageOwnership>[1]

  expectRepairError('missing-fingerprint', () => assignPendingStageOwnership(state, request))
  const unchanged = state.trades.find((item) => item.id === 'live')
  assert(unchanged?.tradeKind !== 'paper' && unchanged?.liveStageId === null, '缺少 fingerprint 不得修改 ownership')
}

export function testDependentEntityRepairRequiresAssignedSameStageReferences(): void {
  const cases: Array<{
    entityType: StageOwnershipEntityType
    entityId: string
    target: string
    makeState: () => StageOwnershipRepairState
    code: StageOwnershipRepairError['code']
  }> = [
    {
      entityType: 'case-trade', entityId: 'case', target: 'stage-current', code: 'relationship-conflict',
      makeState: pendingState,
    },
    {
      entityType: 'weekly-risk-preparation', entityId: 'preparation', target: 'stage-current', code: 'relationship-conflict',
      makeState: pendingState,
    },
    {
      entityType: 'monthly-risk-limit', entityId: 'limit', target: 'stage-current', code: 'relationship-conflict',
      makeState: pendingState,
    },
    {
      entityType: 'risk-override-event', entityId: 'override', target: 'stage-current', code: 'relationship-conflict',
      makeState: pendingState,
    },
    {
      entityType: 'monthly-risk-limit', entityId: 'limit', target: 'stage-old', code: 'dependency-pending',
      makeState: () => {
        const state = pendingState()
        state.riskPolicyVersions = state.riskPolicyVersions.map((item) => (
          item.id === 'policy-source' ? { ...item, liveStageId: null } : item
        ))
        return state
      },
    },
    {
      entityType: 'risk-override-event', entityId: 'override', target: 'stage-old', code: 'relationship-conflict',
      makeState: () => {
        const state = pendingState()
        state.trades = state.trades.filter((item) => item.id !== 'source')
        state.riskOverrideEvents = state.riskOverrideEvents.map((event) => ({
          ...event,
          tradeIdentityAtDecision: { ...event.tradeIdentityAtDecision, ref: '' },
        }))
        return state
      },
    },
  ]

  for (const testCase of cases) {
    const state = testCase.makeState()
    const item = listPendingStageOwnership(state)
      .find((candidate) => candidate.entityType === testCase.entityType && candidate.entityId === testCase.entityId)!
    const before = JSON.stringify(state)
    expectRepairError(testCase.code, () => assignPendingStageOwnership(state, {
      entityType: testCase.entityType,
      entityId: testCase.entityId,
      liveStageId: testCase.target,
      expectedFingerprint: item.fingerprint,
    }))
    assert(JSON.stringify(state) === before, `${testCase.entityType} 引用冲突不得部分修改 state`)
  }
}

export function testReferencedEntityRepairRejectsAlreadyAssignedDependentsFromAnotherStage(): void {
  const policyState = pendingState()
  policyState.monthlyRiskLimits = policyState.monthlyRiskLimits.map((item) => ({
    ...item,
    liveStageId: 'stage-old',
    sourcePolicyVersionId: 'policy',
  }))
  const policyItem = listPendingStageOwnership(policyState).find((item) => item.entityId === 'policy')!
  expectRepairError('relationship-conflict', () => assignPendingStageOwnership(policyState, {
    entityType: 'risk-policy-version',
    entityId: 'policy',
    liveStageId: 'stage-current',
    expectedFingerprint: policyItem.fingerprint,
  }))

  const tradeState = pendingState()
  tradeState.trades = tradeState.trades.map((item) => item.id === 'source'
    ? { ...item, liveStageId: null }
    : item.id === 'case' ? { ...item, liveStageId: 'stage-old' } : item)
  const sourceItem = listPendingStageOwnership(tradeState).find((item) => item.entityId === 'source')!
  expectRepairError('relationship-conflict', () => assignPendingStageOwnership(tradeState, {
    entityType: 'live-trade',
    entityId: 'source',
    liveStageId: 'stage-current',
    expectedFingerprint: sourceItem.fingerprint,
  }))
}

export function testWeeklyReviewRepairValidatesFrozenRiskAndTradeDependenciesBeforeAssignment(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const makeRiskSnapshot = (liveStageId: string | null) => ({
    policyVersions: fixture.riskPolicyVersions.map((policy) => ({ ...policy, liveStageId })),
    dailyOutcomes: [{ ...fixture.riskOverrideEvents[0]!.outcomesAtDecision.day, date: '2026-06-08' }],
    weeklyOutcome: fixture.riskOverrideEvents[0]!.outcomesAtDecision.week,
    monthlyOutcomeAtCompletion: fixture.riskOverrideEvents[0]!.outcomesAtDecision.month,
    overrideEvents: [],
    frozenAt: fixture.weeklyReviews![0]!.completedAt!,
  })

  const crossStage = pendingState()
  crossStage.weeklyReviews = crossStage.weeklyReviews.map((review) => ({
    ...review,
    riskSnapshot: makeRiskSnapshot('stage-current'),
  }))
  const crossItem = listPendingStageOwnership(crossStage).find((item) => item.entityId === 'review')!
  expectRepairError('relationship-conflict', () => assignPendingStageOwnership(crossStage, {
    entityType: 'weekly-review', entityId: 'review', liveStageId: 'stage-old', expectedFingerprint: crossItem.fingerprint,
  }))

  const dependencyPending = pendingState()
  dependencyPending.weeklyReviews = dependencyPending.weeklyReviews.map((review) => ({
    ...review,
    highlightTradeIds: ['live'],
    riskSnapshot: makeRiskSnapshot(null),
  }))
  const pendingItem = listPendingStageOwnership(dependencyPending).find((item) => item.entityId === 'review')!
  expectRepairError('dependency-pending', () => assignPendingStageOwnership(dependencyPending, {
    entityType: 'weekly-review', entityId: 'review', liveStageId: 'stage-old', expectedFingerprint: pendingItem.fingerprint,
  }))

  dependencyPending.trades = dependencyPending.trades.map((candidate) => candidate.id === 'live'
    ? { ...candidate, liveStageId: 'stage-old' }
    : candidate)
  const readyItem = listPendingStageOwnership(dependencyPending).find((item) => item.entityId === 'review')!
  const repaired = assignPendingStageOwnership(dependencyPending, {
    entityType: 'weekly-review', entityId: 'review', liveStageId: 'stage-old', expectedFingerprint: readyItem.fingerprint,
  })
  const repairedReview = repaired.weeklyReviews[0]!
  assert(repairedReview.liveStageId === 'stage-old', '依赖先修后 outer review 必须可归属目标阶段')
  assert(
    repairedReview.riskSnapshot?.policyVersions.every((policy) => policy.liveStageId === 'stage-old'),
    '纯嵌套 pending 冻结政策必须与 outer review 原子归属同一阶段',
  )

  const atomicEmbeddedGraph = pendingState()
  atomicEmbeddedGraph.trades = atomicEmbeddedGraph.trades.map((candidate) => candidate.id === 'live'
    ? { ...candidate, liveStageId: 'stage-old' }
    : candidate)
  atomicEmbeddedGraph.weeklyReviews = atomicEmbeddedGraph.weeklyReviews.map((review) => ({
    ...review,
    riskSnapshot: {
      ...makeRiskSnapshot(null),
      overrideEvents: [{
        ...fixture.riskOverrideEvents[0]!,
        liveStageId: null,
        tradeId: 'live',
        policyVersionId: fixture.riskPolicyVersions[0]!.id,
      }],
    },
  }))
  const atomicItem = listPendingStageOwnership(atomicEmbeddedGraph)
    .find((item) => item.entityId === 'review')!
  const atomicRepaired = assignPendingStageOwnership(atomicEmbeddedGraph, {
    entityType: 'weekly-review',
    entityId: 'review',
    liveStageId: 'stage-old',
    expectedFingerprint: atomicItem.fingerprint,
  })
  assert(
    atomicRepaired.weeklyReviews[0]?.riskSnapshot?.policyVersions[0]?.liveStageId === 'stage-old' &&
      atomicRepaired.weeklyReviews[0]?.riskSnapshot?.overrideEvents[0]?.liveStageId === 'stage-old',
    '同一冻结图内的 pending policy/override 必须随 outer review 一次原子归属',
  )
}

export function testPendingOverrideCanBeAssignedAfterSourcePurgeUsingFrozenIdentity(): void {
  const state = pendingState()
  state.trades = state.trades.filter((candidate) => candidate.id !== 'source')
  const item = listPendingStageOwnership(state).find((candidate) => candidate.entityId === 'override')!

  const repaired = assignPendingStageOwnership(state, {
    entityType: 'risk-override-event',
    entityId: 'override',
    liveStageId: 'stage-old',
    expectedFingerprint: item.fingerprint,
  })
  assert(
    repaired.riskOverrideEvents.find((event) => event.id === 'override')?.liveStageId === 'stage-old',
    '来源已永久删除时，完整 tradeIdentityAtDecision 必须足以修复顶层 override 归属',
  )
}

export function testPendingReviewCanBeAssignedAfterSourcePurgeUsingFrozenEvidence(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const state = pendingState()
  const deletedTradeId = 'deleted-frozen-trade'
  state.weeklyReviews = state.weeklyReviews.map((review) => ({
    ...review,
    highlightTradeIds: [deletedTradeId],
    evidenceSnapshot: {
      trades: [{
        id: deletedTradeId,
        ref: 'TRD-DELETED-FROZEN',
        symbol: 'BTCUSDT',
        status: 'win' as const,
        pnl: 100,
        rMultiple: 1,
        cashCurrency: 'USD' as const,
      }],
      missedTrades: [],
      legacyCashCurrencyAssumption: null,
    },
    riskSnapshot: {
      policyVersions: fixture.riskPolicyVersions.map((policy) => ({
        ...policy,
        liveStageId: null,
      })),
      dailyOutcomes: [{ ...fixture.riskOverrideEvents[0]!.outcomesAtDecision.day, date: '2026-06-10' }],
      weeklyOutcome: fixture.riskOverrideEvents[0]!.outcomesAtDecision.week,
      monthlyOutcomeAtCompletion: fixture.riskOverrideEvents[0]!.outcomesAtDecision.month,
      overrideEvents: fixture.riskOverrideEvents.map((event) => ({
        ...event,
        liveStageId: null,
        tradeId: deletedTradeId,
        tradeIdentityAtDecision: {
          ref: 'TRD-DELETED-FROZEN',
          symbol: 'BTCUSDT',
          tradeKind: 'live' as const,
        },
      })),
      frozenAt: review.completedAt!,
    },
  }))
  const item = listPendingStageOwnership(state).find((candidate) => candidate.entityId === 'review')!

  const repaired = assignPendingStageOwnership(state, {
    entityType: 'weekly-review',
    entityId: 'review',
    liveStageId: 'stage-old',
    expectedFingerprint: item.fingerprint,
  })
  const review = repaired.weeklyReviews[0]!
  assert(review.liveStageId === 'stage-old', '冻结 evidence 覆盖来源 ID 时必须允许修复 outer review')
  assert(
    review.riskSnapshot?.policyVersions.every((policy) => policy.liveStageId === 'stage-old') &&
      review.riskSnapshot.overrideEvents.every((event) => event.liveStageId === 'stage-old'),
    '源已删除的自包含冻结图仍必须与 outer review 原子归属',
  )
}

export function testQuarantinedWeeklyReviewRequiresExplicitValidPeriodAndRollsBackRawFacts(): void {
  const initial = pendingState()
  initial.weeklyReviews = initial.weeklyReviews.map((review) => ({
    ...review,
    weekStart: '2026-02-30',
    weekEnd: '2026-03-08',
    legacyPeriodQuarantine: true,
    riskSnapshot: undefined,
  }))
  const item = listPendingStageOwnership(initial).find((candidate) => candidate.entityId === 'review')!
  assert(item.requiresWeeklyPeriodCorrection === true, '隔离周复盘必须在待整理列表显式标记日期修复')
  assert(
    item.weeklyPeriod?.weekStart === '2026-02-30' && item.weeklyPeriod.weekEnd === '2026-03-08',
    '日期修复 UI 必须拿到原始日期，而不是迁移时猜测值',
  )

  const baseRequest = {
    entityType: 'weekly-review' as const,
    entityId: 'review',
    liveStageId: 'stage-old',
    expectedFingerprint: item.fingerprint,
  }
  expectRepairError('invalid-weekly-period', () => assignPendingStageOwnership(initial, baseRequest))
  for (const correctedWeeklyPeriod of [
    { weekStart: '2026-06-09', weekEnd: '2026-06-15' },
    { weekStart: '2026-06-08', weekEnd: '2026-06-13' },
  ]) {
    expectRepairError('invalid-weekly-period', () => assignPendingStageOwnership(initial, {
      ...baseRequest,
      correctedWeeklyPeriod,
    }))
  }
  expectRepairError('weekly-period-crosses-stage-boundary', () => assignPendingStageOwnership(initial, {
    ...baseRequest,
    correctedWeeklyPeriod: { weekStart: '2026-06-29', weekEnd: '2026-07-05' },
  }))

  const repaired = assignPendingStageOwnership(initial, {
    ...baseRequest,
    correctedWeeklyPeriod: { weekStart: '2026-06-08', weekEnd: '2026-06-14' },
  })
  const repairedReview = repaired.weeklyReviews[0]!
  assert(
    repairedReview.liveStageId === 'stage-old' &&
      repairedReview.weekStart === '2026-06-08' &&
      repairedReview.weekEnd === '2026-06-14' &&
      !Object.prototype.hasOwnProperty.call(repairedReview, 'legacyPeriodQuarantine'),
    '显式修复必须原子写入目标阶段、规范周区间并清除隔离标记',
  )

  const rolledBack = rollbackAssignedStageOwnership(repaired, {
    entityType: 'weekly-review',
    entityId: 'review',
    assignedLiveStageId: 'stage-old',
    weeklyReviewPrevious: {
      weekStart: '2026-02-30',
      weekEnd: '2026-03-08',
      assignedWeekStart: '2026-06-08',
      assignedWeekEnd: '2026-06-14',
      legacyPeriodQuarantine: true,
      pendingPolicyVersionIds: [],
      pendingOverrideEventIds: [],
    },
  })
  const restoredReview = rolledBack.weeklyReviews[0]!
  assert(
    restoredReview.liveStageId === null &&
      restoredReview.weekStart === '2026-02-30' &&
      restoredReview.weekEnd === '2026-03-08' &&
      restoredReview.legacyPeriodQuarantine === true,
    '耐久保存失败回滚必须恢复原始非法日期与隔离标记',
  )
}

export function testCanonicalLegacyReviewAcrossStageBoundaryCanBeExplicitlyArchivedWithoutChangingDates(): void {
  const initial = pendingState()
  initial.weeklyReviews = initial.weeklyReviews.map((review) => ({
    ...review,
    weekStart: '2026-06-29',
    weekEnd: '2026-07-05',
    legacyStageBoundaryOverlap: true,
    riskSnapshot: undefined,
  }))
  const item = listPendingStageOwnership(initial).find((candidate) => candidate.entityId === 'review')!
  assert(item.requiresWeeklyPeriodCorrection !== true, '合法的跨阶段周区间不得要求伪造修正日期')

  const repaired = assignPendingStageOwnership(initial, {
    entityType: 'weekly-review',
    entityId: 'review',
    liveStageId: 'stage-old',
    expectedFingerprint: item.fingerprint,
  })
  const review = repaired.weeklyReviews[0]!
  assert(
    review.liveStageId === 'stage-old' &&
      review.weekStart === '2026-06-29' &&
      review.weekEnd === '2026-07-05' &&
      review.legacyStageBoundaryOverlap === true,
    '显式归档必须保留合法原始周区间，并记录旧阶段边界重叠事实',
  )
}

export function testRollbackUsesLatestStateAndOnlyReversesTargetOwnership(): void {
  const initial = pendingState()
  const item = listPendingStageOwnership(initial).find((candidate) => candidate.entityId === 'live')!
  const assigned = assignPendingStageOwnership(initial, {
    entityType: item.entityType,
    entityId: item.entityId,
    liveStageId: 'stage-current',
    expectedFingerprint: item.fingerprint,
  })
  const latest = {
    ...assigned,
    trades: assigned.trades.map((candidate) => candidate.id === 'live'
      ? { ...candidate, note: '<p>保存期间并发修改目标正文</p>' }
      : candidate.id === 'source'
        ? { ...candidate, note: '<p>保存期间并发修改无关交易</p>' }
        : candidate),
    weeklyReviews: assigned.weeklyReviews.map((review) => ({ ...review, contentHtml: '<p>并发周复盘草稿</p>' })),
  }

  const rolledBack = rollbackAssignedStageOwnership(latest, {
    entityType: item.entityType,
    entityId: item.entityId,
    assignedLiveStageId: 'stage-current',
  })
  const target = rolledBack.trades.find((candidate) => candidate.id === 'live')
  const unrelated = rolledBack.trades.find((candidate) => candidate.id === 'source')
  assert(target?.tradeKind === 'live' && target.liveStageId === null, '回滚必须只把本次目标归属恢复为 null')
  assert(target?.note.includes('目标正文'), '回滚必须基于最新 Store 保留目标实体并发字段')
  assert(unrelated?.note.includes('无关交易'), '回滚必须保留无关交易并发修改')
  assert(rolledBack.weeklyReviews[0]?.contentHtml.includes('周复盘草稿'), '回滚必须保留其他 slice 的并发修改')
}

export function testRollbackRejectsOwnershipCasConflictWithoutMutation(): void {
  const initial = pendingState()
  const conflicting = {
    ...initial,
    trades: initial.trades.map((candidate) => candidate.id === 'live'
      ? { ...candidate, liveStageId: 'stage-old' }
      : candidate),
  }
  expectRepairError('rollback-conflict', () => rollbackAssignedStageOwnership(conflicting, {
    entityType: 'live-trade',
    entityId: 'live',
    assignedLiveStageId: 'stage-current',
  }))
  const latest = conflicting.trades.find((candidate) => candidate.id === 'live')
  assert(latest?.tradeKind !== 'paper' && latest?.liveStageId === 'stage-old', 'CAS 冲突不得覆盖新的归属')

  expectRepairError('rollback-conflict', () => rollbackAssignedStageOwnership({
    ...initial,
    trades: initial.trades.filter((candidate) => candidate.id !== 'live'),
  }, {
    entityType: 'live-trade',
    entityId: 'live',
    assignedLiveStageId: 'stage-current',
  }))
  expectRepairError('rollback-conflict', () => rollbackAssignedStageOwnership(conflicting, {
    entityType: 'case-trade',
    entityId: 'live',
    assignedLiveStageId: 'stage-old',
  }))
}

export function testRecommendedBoundaryRepairMovesOnlyReliableUnconstrainedRecords(): void {
  const state = pendingState()
  state.weeklyReviews = state.weeklyReviews.map((review) => ({
    ...review,
    weekStart: '2026-06-29',
    weekEnd: '2026-07-05',
  }))
  state.trades = [
    trade('recent-live', {
      liveStageId: 'stage-old',
      openedAt: '2026-06-29',
      closedAt: '2026-06-29',
      closedTradingDayKey: '2026-06-29',
    }),
    trade('recent-case', {
      tradeKind: 'case',
      liveStageId: 'stage-old',
      openedAt: '2026-06-30',
      recordedAt: '2026-06-30T08:00:00.000Z',
    }),
    trade('historical-source', {
      liveStageId: 'stage-old',
      openedAt: '2026-06-10',
      closedAt: '2026-06-10',
      closedTradingDayKey: '2026-06-10',
    }),
    trade('linked-case', {
      tradeKind: 'case',
      liveStageId: 'stage-old',
      sourceTradeId: 'historical-source',
      openedAt: '2026-06-10',
      recordedAt: '2026-06-30T09:00:00.000Z',
    }),
  ]

  const recommendation = recommendStageBoundaryRepair(state, 'review')
  assert(recommendation !== null, '跨相邻阶段边界的完整周必须产生推荐设置')
  assert(
    recommendation.targetStageStartAfter === '2026-06-29' &&
      recommendation.previousStageEndAfter === '2026-06-28',
    '推荐设置必须把后续阶段对齐到周一并闭合前一阶段',
  )
  assert(
    [...recommendation.affectedTradeIds].sort().join(',') === 'recent-case,recent-live',
    '推荐设置只能移动日期明确且没有历史来源约束的记录',
  )

  const repaired = applyRecommendedStageBoundaryRepair(state, recommendation)
  assert(repaired.liveStages[0]?.endsOn === '2026-06-28', '前一阶段截止日必须随边界同步调整')
  assert(repaired.liveStages[1]?.startsOn === '2026-06-29', '目标阶段必须从完整周周一开始')
  assert(repaired.weeklyReviews[0]?.liveStageId === 'stage-current', '周复盘必须归入推荐目标阶段')
  const recentLive = repaired.trades.find((candidate) => candidate.id === 'recent-live')
  const recentCase = repaired.trades.find((candidate) => candidate.id === 'recent-case')
  assert(
    recentLive?.tradeKind !== 'paper' && recentLive?.liveStageId === 'stage-current' &&
      recentCase?.tradeKind !== 'paper' && recentCase?.liveStageId === 'stage-current',
    '边界夹缝内的可靠记录必须同步归入目标阶段',
  )
  const linkedCase = repaired.trades.find((candidate) => candidate.id === 'linked-case')
  assert(
    linkedCase?.tradeKind !== 'paper' && linkedCase?.liveStageId === 'stage-old',
    '带历史来源约束的案例必须保留原阶段',
  )
}

export function testRecommendedBoundaryRepairRejectsStaleRecommendation(): void {
  const state = pendingState()
  state.weeklyReviews = state.weeklyReviews.map((review) => ({
    ...review,
    weekStart: '2026-06-29',
    weekEnd: '2026-07-05',
  }))
  const recommendation = recommendStageBoundaryRepair(state, 'review')
  assert(recommendation !== null, '测试前提：必须存在推荐设置')
  const changed = {
    ...state,
    weeklyReviews: state.weeklyReviews.map((review) => ({ ...review, contentHtml: '<p>并发编辑</p>' })),
  }
  expectRepairError('recommended-repair-unavailable', () => (
    applyRecommendedStageBoundaryRepair(changed, recommendation)
  ))
}
