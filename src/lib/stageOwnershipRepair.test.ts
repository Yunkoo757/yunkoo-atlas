import type { Trade } from '@/data/trades'
import {
  assignPendingStageOwnership,
  listPendingStageOwnership,
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

  expectRepairError('entity-not-found', () => assignPendingStageOwnership(state, { entityType: 'live-trade', entityId: 'missing', liveStageId: 'stage-old' }))
  expectRepairError('wrong-entity-type', () => assignPendingStageOwnership(state, { entityType: 'case-trade', entityId: 'live', liveStageId: 'stage-old' }))
  expectRepairError('already-assigned', () => assignPendingStageOwnership(assigned, { entityType: 'live-trade', entityId: 'live', liveStageId: 'stage-old' }))
  expectRepairError('paper-trade', () => assignPendingStageOwnership(state, { entityType: 'live-trade', entityId: 'paper', liveStageId: 'stage-old' }))
  expectRepairError('invalid-ownership', () => assignPendingStageOwnership(undefinedOwnership, { entityType: 'live-trade', entityId: 'live', liveStageId: 'stage-old' }))
  expectRepairError('target-stage-not-found', () => assignPendingStageOwnership(state, { entityType: 'live-trade', entityId: 'live', liveStageId: 'missing-stage' }))
  expectRepairError('target-stage-invalid', () => assignPendingStageOwnership(invalidStages, { entityType: 'live-trade', entityId: 'live', liveStageId: 'stage-old' }))
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
    }))
    assert(JSON.stringify(testCase.state) === before, `${testCase.entityType} 周期冲突不得部分修改 state`)
  }
}
