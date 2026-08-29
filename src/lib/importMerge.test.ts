import type { Trade } from '@/data/trades'
import { mergeImportPayload } from '@/lib/importMerge'
import { riskSetupStateForStage } from '@/test/fixtures/stageRisk'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function importedTrade(id: string, kind: 'live' | 'case' | 'paper', sourceTradeId?: string): Trade {
  const base = {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long' as const,
    status: 'planned' as const,
    conviction: 'medium' as const,
    strategyId: 'strategy-contract',
    tags: [], mistakeTags: [], reviewStatus: 'unreviewed' as const, reviewCategory: 'normal' as const,
    entry: 0, exit: null, size: 0, pnl: null, rMultiple: null, openedAt: '2026-08-20', closedAt: null, note: '',
  }
  if (kind === 'paper') return { ...base, tradeKind: 'paper' }
  if (kind === 'case') return { ...base, tradeKind: 'case', ...(sourceTradeId ? { sourceTradeId } : {}) }
  return { ...base, tradeKind: 'live' }
}

function currentState() {
  const state = createFullPersistedSnapshotFixture()
  state.liveStages = [{
    id: 'stage-old', sequence: 1, name: '历史阶段', status: 'archived', startsOn: '2026-07-01',
    endsOn: '2026-07-31', createdAt: '2026-07-01T00:00:00.000Z', archivedAt: '2026-08-01T00:00:00.000Z',
  }, {
    id: 'stage-current', sequence: 2, name: '当前阶段', status: 'current', startsOn: '2026-08-01',
    endsOn: null, createdAt: '2026-08-01T00:00:00.000Z', archivedAt: null,
  }]
  state.currentLiveStageId = 'stage-current'
  state.trades = []
  state.weeklyRiskPreparations = []
  state.riskPolicyVersions = []
  state.monthlyRiskLimits = []
  state.riskOverrideEvents = []
  state.weeklyReviews = []
  return state
}

export function testMergeImportAssignsUnknownLiveRecordsToCurrentStage(): void {
  const current = currentState()
  const fixture = createFullPersistedSnapshotFixture()
  const source = importedTrade('imported-source', 'live')
  const derivedCase = importedTrade('imported-derived-case', 'case', source.id)
  const standaloneCase = importedTrade('imported-standalone-case', 'case')
  const paper = importedTrade('imported-paper', 'paper')
  const policy = { ...fixture.riskPolicyVersions[0]!, id: 'imported-policy', liveStageId: undefined }
  const preparation = {
    ...fixture.weeklyRiskPreparations[0]!,
    id: 'imported-preparation',
    confirmedPolicyVersionId: policy.id,
    liveStageId: undefined,
  }
  const monthlyLimit = {
    ...fixture.monthlyRiskLimits[0]!,
    id: 'imported-monthly-limit',
    sourcePolicyVersionId: policy.id,
    liveStageId: undefined,
  }
  const overrideEvent = {
    ...fixture.riskOverrideEvents[0]!,
    id: 'imported-override',
    tradeId: source.id,
    policyVersionId: policy.id,
    liveStageId: undefined,
  }
  const weeklyReview = {
    ...fixture.weeklyReviews![0]!,
    id: 'imported-weekly-review',
    liveStageId: undefined,
    riskSnapshot: {
      policyVersions: [{ ...policy, id: 'imported-frozen-policy' }],
      dailyOutcomes: [],
      weeklyOutcome: overrideEvent.outcomesAtDecision.week,
      monthlyOutcomeAtCompletion: overrideEvent.outcomesAtDecision.month,
      overrideEvents: [{ ...overrideEvent, id: 'imported-frozen-override' }],
      frozenAt: '2026-08-20T00:00:00.000Z',
    },
  }
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (message?: unknown) => { warnings.push(String(message)) }
  let merged
  try {
    merged = mergeImportPayload(current, {
      version: 11,
      trades: [source, derivedCase, standaloneCase, paper],
      weeklyRiskPreparations: [preparation], riskPolicyVersions: [policy],
      monthlyRiskLimits: [monthlyLimit], riskOverrideEvents: [overrideEvent], weeklyReviews: [weeklyReview],
      strategies: current.strategies, starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: current.display,
    })
  } finally {
    console.warn = originalWarn
  }
  const imported = merged.trades.filter((trade) => trade.id.startsWith('imported-'))
  assert(imported.filter((trade) => trade.tradeKind === 'live').every((trade) => trade.liveStageId === 'stage-current'), 'merge live 必须进入当前阶段')
  const mergedDerived = imported.find((trade) => trade.id === derivedCase.id)
  const mergedStandalone = imported.find((trade) => trade.id === standaloneCase.id)
  assert(mergedDerived?.tradeKind === 'case' && mergedDerived.liveStageId === 'stage-current', '来源案例必须继承导入来源的阶段')
  assert(mergedStandalone?.tradeKind === 'case' && mergedStandalone.liveStageId === 'stage-current', '独立案例必须进入当前阶段')
  assert(imported.find((trade) => trade.id === paper.id)?.tradeKind === 'paper' && !Object.prototype.hasOwnProperty.call(imported.find((trade) => trade.id === paper.id), 'liveStageId'), 'paper 不得获得阶段字段')
  assert(!merged.weeklyRiskPreparations?.some((item) => item.id === preparation.id), '未知归属风险草稿不得配置当前阶段')
  assert(!merged.riskPolicyVersions?.some((item) => item.id === policy.id), '未知归属风险策略不得配置当前阶段')
  assert(!merged.monthlyRiskLimits?.some((item) => item.id === monthlyLimit.id), '未知归属月度限额不得配置当前阶段')
  assert(!merged.riskOverrideEvents?.some((item) => item.id === overrideEvent.id), '未知归属风险事件不得写入当前阶段')
  assert(riskSetupStateForStage({
    riskPolicyVersions: merged.riskPolicyVersions ?? [],
    monthlyRiskLimits: merged.monthlyRiskLimits ?? [],
  }, 'stage-current', '2026-08-20') === 'unconfigured', '导入后当前阶段仍须本地确认建档')
  assert(warnings.some((message) => message.includes('风险配置')), '跳过未知归属风险配置必须记录非敏感警告')
  const mergedReview = merged.weeklyReviews?.find((item) => item.id === weeklyReview.id)
  assert(mergedReview?.liveStageId === 'stage-current', 'merge 周复盘必须进入当前阶段')
  assert(mergedReview.riskSnapshot?.policyVersions[0]?.liveStageId === 'stage-current', 'merge 冻结风险策略必须进入当前阶段')
  assert(mergedReview.riskSnapshot?.overrideEvents[0]?.liveStageId === 'stage-current', 'merge 冻结风险事件必须进入当前阶段')
}

export function testMergeImportPreservesExplicitKnownHistoricalRiskWithoutConfiguringCurrentStage(): void {
  const current = currentState()
  const fixture = createFullPersistedSnapshotFixture()
  const localTrade = { ...fixture.trades[0]!, liveStageId: 'stage-old' }
  current.trades = [localTrade]
  const policy = { ...fixture.riskPolicyVersions[0]!, id: 'historical-policy', liveStageId: 'stage-old' }
  const preparation = {
    ...fixture.weeklyRiskPreparations[0]!,
    id: 'weekly-risk-preparation:stage-old:2026-07-13',
    liveStageId: 'stage-old',
    confirmedPolicyVersionId: policy.id,
  }
  const monthlyLimit = {
    ...fixture.monthlyRiskLimits[0]!,
    id: 'monthly-risk-limit:stage-old:2026-07',
    liveStageId: 'stage-old',
    sourcePolicyVersionId: policy.id,
  }
  const override = {
    ...fixture.riskOverrideEvents[0]!,
    id: 'historical-override',
    liveStageId: 'stage-old',
    tradeId: localTrade.id,
    policyVersionId: policy.id,
  }

  const merged = mergeImportPayload(current, {
    version: 12,
    trades: [],
    weeklyRiskPreparations: [preparation],
    riskPolicyVersions: [policy],
    monthlyRiskLimits: [monthlyLimit],
    riskOverrideEvents: [override],
    strategies: current.strategies,
    starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: current.display,
  })

  assert(merged.riskPolicyVersions?.some((item) => item.id === policy.id && item.liveStageId === 'stage-old'), '已知本地历史阶段风险策略必须保留原归属')
  assert(merged.weeklyRiskPreparations?.some((item) => item.id === preparation.id && item.liveStageId === 'stage-old'), '已知历史草稿必须保留原归属')
  assert(merged.monthlyRiskLimits?.some((item) => item.id === monthlyLimit.id && item.liveStageId === 'stage-old'), '已知历史月限额必须保留原归属')
  assert(merged.riskOverrideEvents?.some((item) => item.id === override.id && item.liveStageId === 'stage-old'), '引用本地历史交易的完整 override 必须保留原归属')
  assert(riskSetupStateForStage({
    riskPolicyVersions: merged.riskPolicyVersions ?? [],
    monthlyRiskLimits: merged.monthlyRiskLimits ?? [],
  }, 'stage-current', '2026-08-20') === 'unconfigured', '历史风险资料不得完成当前阶段建档')
  assertValidPersistedSnapshot(merged, '完整历史风险导入结果')
}

export function testMergeImportDropsHistoricalOverrideWhenImportedTradeMovesToCurrentStage(): void {
  const current = currentState()
  const fixture = createFullPersistedSnapshotFixture()
  const trade = { ...fixture.trades[0]!, liveStageId: 'stage-old' }
  const policy = { ...fixture.riskPolicyVersions[0]!, id: 'override-policy', liveStageId: 'stage-old' }
  const override = {
    ...fixture.riskOverrideEvents[0]!,
    id: 'override-for-remapped-trade',
    liveStageId: 'stage-old',
    tradeId: trade.id,
    policyVersionId: policy.id,
  }

  const merged = mergeImportPayload(current, {
    version: 12,
    trades: [trade],
    weeklyRiskPreparations: [],
    riskPolicyVersions: [policy],
    monthlyRiskLimits: [],
    riskOverrideEvents: [override],
    strategies: current.strategies,
    starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: current.display,
  })

  const mergedTrade = merged.trades.find((item) => item.id === trade.id)
  assert(mergedTrade?.tradeKind === 'live' && mergedTrade.liveStageId === 'stage-current', '导入 live 交易必须进入当前阶段')
  assert(!merged.riskOverrideEvents?.some((item) => item.id === override.id), '旧阶段 override 不得指向已归入当前阶段的导入交易')
  assertValidPersistedSnapshot(merged, '交易重归后的导入结果')
}

export function testMergeImportDropsHistoricalDependentsWhenSourcePolicyIsSkipped(): void {
  const current = currentState()
  const fixture = createFullPersistedSnapshotFixture()
  const skippedPolicy = { ...fixture.riskPolicyVersions[0]!, id: 'skipped-current-policy', liveStageId: 'stage-current' }
  const preparation = {
    ...fixture.weeklyRiskPreparations[0]!,
    id: 'weekly-risk-preparation:stage-old:2026-07-13',
    liveStageId: 'stage-old',
    confirmedPolicyVersionId: skippedPolicy.id,
  }
  const monthlyLimit = {
    ...fixture.monthlyRiskLimits[0]!,
    id: 'monthly-risk-limit:stage-old:2026-07',
    liveStageId: 'stage-old',
    sourcePolicyVersionId: skippedPolicy.id,
  }

  const merged = mergeImportPayload(current, {
    version: 12,
    trades: [],
    weeklyRiskPreparations: [preparation],
    riskPolicyVersions: [skippedPolicy],
    monthlyRiskLimits: [monthlyLimit],
    riskOverrideEvents: [],
    strategies: current.strategies,
    starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: current.display,
  })

  assert(!merged.riskPolicyVersions?.some((item) => item.id === skippedPolicy.id), '当前阶段导入 policy 必须跳过')
  assert(!merged.weeklyRiskPreparations?.some((item) => item.id === preparation.id), '来源 policy 被跳过时 preparation 也必须跳过')
  assert(!merged.monthlyRiskLimits?.some((item) => item.id === monthlyLimit.id), '来源 policy 被跳过时 monthly limit 也必须跳过')
  assertValidPersistedSnapshot(merged, '依赖闭包导入结果')
}

export function testMergeImportRetainsHistoricalRiskClosedByLocalArchivedReferents(): void {
  const current = currentState()
  const fixture = createFullPersistedSnapshotFixture()
  const localTrade = { ...fixture.trades[0]!, liveStageId: 'stage-old' }
  const localPolicy = { ...fixture.riskPolicyVersions[0]!, id: 'local-archived-policy', liveStageId: 'stage-old' }
  current.trades = [localTrade]
  current.riskPolicyVersions = [localPolicy]
  const preparation = {
    ...fixture.weeklyRiskPreparations[0]!,
    id: 'weekly-risk-preparation:stage-old:2026-07-13',
    liveStageId: 'stage-old',
    confirmedPolicyVersionId: localPolicy.id,
  }
  const monthlyLimit = {
    ...fixture.monthlyRiskLimits[0]!,
    id: 'monthly-risk-limit:stage-old:2026-07',
    liveStageId: 'stage-old',
    sourcePolicyVersionId: localPolicy.id,
  }
  const override = {
    ...fixture.riskOverrideEvents[0]!,
    id: 'local-closed-override',
    liveStageId: 'stage-old',
    tradeId: localTrade.id,
    policyVersionId: localPolicy.id,
  }

  const merged = mergeImportPayload(current, {
    version: 12,
    trades: [],
    weeklyRiskPreparations: [preparation],
    riskPolicyVersions: [],
    monthlyRiskLimits: [monthlyLimit],
    riskOverrideEvents: [override],
    strategies: current.strategies,
    starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: current.display,
  })

  assert(merged.weeklyRiskPreparations?.some((item) => item.id === preparation.id), '本地历史 policy 必须能闭合 preparation 引用')
  assert(merged.monthlyRiskLimits?.some((item) => item.id === monthlyLimit.id), '本地历史 policy 必须能闭合 monthly limit 引用')
  assert(merged.riskOverrideEvents?.some((item) => item.id === override.id), '本地历史交易与 policy 必须能闭合 override 引用')
  assert(riskSetupStateForStage({
    riskPolicyVersions: merged.riskPolicyVersions ?? [],
    monthlyRiskLimits: merged.monthlyRiskLimits ?? [],
  }, 'stage-current', '2026-08-20') === 'unconfigured', '保留完整历史包也不得配置当前阶段')
  assertValidPersistedSnapshot(merged, '本地历史引用闭包导入结果')
}

export function testMergeImportRejectsUnknownLocalStageReference(): void {
  const current = currentState()
  const foreign = { ...importedTrade('foreign-stage', 'live'), liveStageId: 'stage-foreign' } as Trade
  let message = ''
  try {
    mergeImportPayload(current, {
      version: 12,
      trades: [foreign], weeklyRiskPreparations: [], riskPolicyVersions: [], monthlyRiskLimits: [], riskOverrideEvents: [],
      strategies: current.strategies, starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: current.display,
    })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('stage-foreign'), 'merge 必须明确拒绝未知本地阶段引用')
}

export function testMergeImportRemapsReviewPoolConflictsWithoutChangingHomeLayout(): void {
  const current = currentState()
  const baseFilters = {
    sources: [], results: [], caseTypes: [], strategyIds: [], symbols: [], sides: [], tags: [], mistakeTags: [], requireContent: false,
  }
  const localPreset = {
    id: 'pool-shared', name: '本地池', filters: baseFilters,
    createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  }
  current.reviewPoolPresets = [localPreset]
  current.reviewPoolLayout = {
    homeOrder: [{ kind: 'system', id: 'all' }, { kind: 'custom', id: localPreset.id }],
    hiddenSystemIds: ['wins'],
  }
  const importedPreset = { ...localPreset, name: '导入池', updatedAt: '2026-08-21T00:00:00.000Z' }
  const merged = mergeImportPayload(current, {
    version: 13,
    trades: [], weeklyRiskPreparations: [], riskPolicyVersions: [], monthlyRiskLimits: [], riskOverrideEvents: [],
    strategies: current.strategies, starredIds: [], subscribedIds: [], pinnedStrategyIds: [], display: current.display,
    reviewPoolPresets: [importedPreset],
    reviewPoolLayout: { homeOrder: [{ kind: 'system', id: 'all' }], hiddenSystemIds: [] },
  })
  assert(merged.reviewPoolPresets?.length === 2, '同 ID 不同内容的导入复盘池必须稳定改写 ID 后并存')
  assert(merged.reviewPoolPresets?.some((preset) => preset.name === '导入池' && preset.id !== localPreset.id), '导入冲突池必须获得新 ID')
  assert(JSON.stringify(merged.reviewPoolLayout) === JSON.stringify(current.reviewPoolLayout), '合并导入不得打乱当前首页布局')
}
