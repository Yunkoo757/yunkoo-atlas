import type { Trade } from '@/data/trades'
import {
  completeWeeklyReviewCandidate,
  createWeeklyReview,
  normalizeWeeklyReviews,
  reopenCompletedReview,
  type CompleteWeeklyReviewState,
} from '@/data/weeklyReviews'
import type {
  MonthlyRiskLimit,
  RiskOverrideEvent,
  RiskPolicyVersion,
} from '@/data/riskManagement'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function policy(revision: number): RiskPolicyVersion {
  return {
    id: `policy-${revision}`,
    sourceWeekStart: '2026-07-20',
    effectiveTradingDay: '2026-07-20',
    capitalBase: 100_000,
    riskPercent: 1,
    riskAmount: 1_000,
    dailyLossLimitR: 2,
    weeklyLossLimitR: 5,
    monthlyLossLimitRDefault: 10,
    disciplineText: `只做版本 ${revision} 的计划`,
    confirmedAt: `2026-07-20T0${revision}:00:00.000Z`,
  }
}

function trade(revision: number): Trade {
  return {
    id: 'trade-1',
    ref: `TRD-${revision}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'loss',
    conviction: 'medium',
    strategyId: 'strategy',
    tags: [],
    mistakeTags: ['追价'],
    reviewStatus: 'reviewed',
    reviewCategory: 'mistake',
    tradeKind: 'live',
    entry: 100,
    exit: 90,
    size: 1,
    pnl: -1_000,
    rMultiple: null,
    resultSource: 'pnl',
    openedAt: '2026-07-21T08:00:00.000Z',
    closedAt: '2026-07-21T09:00:00.000Z',
    closedTradingDayKey: '2026-07-21',
    note: '',
  }
}

function overrideEvent(revision: number): RiskOverrideEvent {
  const outcome = {
    netBudgetR: -1,
    limitR: 2,
    consumedR: 1,
    remainingR: 1,
    progress: 0.5,
    coverage: 'complete' as const,
    triggered: false,
    includedTradeCount: 1,
    excludedTradeCount: 0,
    unknownReasons: [],
  }
  return {
    id: `event-${revision}`,
    tradeId: 'trade-1',
    tradeIdentityAtDecision: { ref: `TRD-${revision}`, symbol: 'BTCUSDT', tradeKind: 'live' },
    linkState: revision === 7 ? 'unresolved' : 'resolved',
    decisionType: 'triggered',
    tradingDayKeyAtDecision: '2026-07-21',
    policyVersionId: `policy-${revision}`,
    createdAt: '2026-07-21T10:00:00.000Z',
    reason: `版本 ${revision} 的继续交易原因`,
    fingerprint: `fingerprint-${revision}`,
    outcomesAtDecision: { day: outcome, week: outcome, month: outcome },
    unknownReasons: [],
  }
}

function monthlyLimit(revision: number): MonthlyRiskLimit {
  return {
    id: 'monthly-risk-limit:2026-07',
    monthKey: '2026-07',
    limitR: 10,
    sourcePolicyVersionId: `policy-${revision}`,
    lockedAt: '2026-07-20T07:00:00.000Z',
  }
}

function stateAtRevision(revision: number): CompleteWeeklyReviewState {
  const review = {
    ...createWeeklyReview('2026-07-20', new Date('2026-07-20T00:00:00.000Z')),
    id: 'review-1',
  }
  return {
    trades: [trade(revision)],
    weeklyReviews: [review],
    riskPolicyVersions: [policy(revision)],
    monthlyRiskLimits: [monthlyLimit(revision)],
    riskOverrideEvents: [overrideEvent(revision)],
    liveStatsStartTradingDayKey: null,
    display: { tradingDayStartHour: 0 },
  }
}

function completedFixture() {
  return completeWeeklyReviewCandidate(stateAtRevision(7), 'review-1').review
}

export function testCompleteReviewFreezesRiskFromOneState(): void {
  const state = stateAtRevision(7)
  const completed = completeWeeklyReviewCandidate(state, 'review-1')
  assert(completed.review.completedAt === completed.review.riskSnapshot?.frozenAt, '完成时间与风险冻结时间必须一致')
  assert(completed.review.riskSnapshot?.overrideEvents.length === 1, '必须冻结当时事件')
  assert(completed.review.riskSnapshot?.policyVersions[0]?.id === 'policy-7', '必须冻结同一版本的规则')
  assert(completed.review.riskSnapshot?.dailyOutcomes[1]?.netBudgetR === -1, '必须冻结每日风险结果')
  assert(completed.review.riskSnapshot?.monthlyOutcomeAtCompletion.netBudgetR === -1, '必须冻结完成时月度结果')
  assert(completed.review.metricsSnapshot?.totalPnl === -1_000, '必须从同一状态冻结绩效结果')

  state.trades[0]!.pnl = -9_000
  state.riskPolicyVersions[0]!.disciplineText = '后来修改的规则'
  state.riskOverrideEvents[0]!.reason = '后来修改的原因'
  assert(completed.review.metricsSnapshot?.totalPnl === -1_000, '绩效快照必须深拷贝')
  assert(completed.review.riskSnapshot.policyVersions[0]?.disciplineText === '只做版本 7 的计划', '规则快照必须深拷贝')
  assert(completed.review.riskSnapshot.overrideEvents[0]?.reason === '版本 7 的继续交易原因', '事件快照必须深拷贝')
  assert(completed.review.riskSnapshot.overrideEvents[0]?.tradeIdentityAtDecision.ref === 'TRD-7', '删除交易后仍须保留身份摘要')
  assert(completed.review.riskSnapshot.overrideEvents[0]?.linkState === 'unresolved', '必须保留冻结的关联状态')
}

export function testReopenClearsBothSnapshots(): void {
  const reopened = reopenCompletedReview(completedFixture())
  assert(!reopened.metricsSnapshot && !reopened.riskSnapshot, '重开必须同时清除两类快照')
  assert(reopened.status === 'draft' && reopened.completedAt === null, '重开必须恢复草稿状态')
}

export function testCompletedSnapshotSurvivesNormalizationReload(): void {
  const completed = completedFixture()
  const [reloaded] = normalizeWeeklyReviews(JSON.parse(JSON.stringify([completed])))
  assert(reloaded?.riskSnapshot?.policyVersions[0]?.id === 'policy-7', '重载后必须保留冻结规则')
  assert(reloaded?.riskSnapshot?.overrideEvents[0]?.reason === '版本 7 的继续交易原因', '重载后必须保留冻结事件')
}

export function testCompletionMetricsAndRiskUseTheSameFrozenTradingDay(): void {
  const state = stateAtRevision(7)
  state.display.tradingDayStartHour = 6
  state.trades[0] = {
    ...state.trades[0]!,
    closedAt: '2026-07-27T05:59:00+08:00',
    closedTradingDayKey: '2026-07-26',
  }
  const completed = completeWeeklyReviewCandidate(
    state,
    'review-1',
    new Date('2026-07-27T05:59:00+08:00'),
  ).review
  assert(completed.metricsSnapshot?.tradeCount === 1, '绩效必须按固化业务日归入周日')
  assert(completed.riskSnapshot?.weeklyOutcome.netBudgetR === -1, '风险周结果必须使用同一固化业务日')

  delete state.trades[0]!.closedTradingDayKey
  const legacyCompleted = completeWeeklyReviewCandidate(
    state,
    'review-1',
    new Date('2026-07-27T05:59:00+08:00'),
  ).review
  assert(legacyCompleted.metricsSnapshot?.tradeCount === 1, '旧交易必须按完成时的交易日起始小时回退归周')
  assert(legacyCompleted.riskSnapshot?.weeklyOutcome.netBudgetR === -1, '旧交易风险结果必须使用同一交易日起始小时')
  assert(state.trades[0]?.closedTradingDayKey === undefined, '生成快照不得突变旧交易业务日字段')
}

export function testHistoricalDailyOutcomesOnlyIncludeFactsKnownByThatDay(): void {
  const state = stateAtRevision(7)
  state.trades = [
    {
      ...trade(7),
      id: 'monday-loss',
      pnl: -1_000,
      closedAt: '2026-07-20T09:00:00.000Z',
      closedTradingDayKey: '2026-07-20',
    },
    {
      ...trade(7),
      id: 'tuesday-loss',
      pnl: -2_000,
      closedAt: '2026-07-21T09:00:00.000Z',
      closedTradingDayKey: '2026-07-21',
    },
  ]

  const completed = completeWeeklyReviewCandidate(
    state,
    'review-1',
    new Date('2026-07-21T23:00:00.000+08:00'),
  ).review
  const [monday, tuesday] = completed.riskSnapshot?.dailyOutcomes ?? []

  assert(monday?.date === '2026-07-20' && monday.netBudgetR === -1, '周一只应包含周一已发生亏损')
  assert(monday.coverage === 'complete', '周二正常交易不得把周一历史结果标为 unknown')
  assert(tuesday?.date === '2026-07-21' && tuesday.netBudgetR === -2, '周二应包含周二当日亏损')
  assert(tuesday.coverage === 'complete', '完成日前正常亏损必须保持完整覆盖')
}

export function testLossAfterReviewCompletionRemainsUnknown(): void {
  const state = stateAtRevision(7)
  state.trades = [{
    ...trade(7),
    id: 'future-loss',
    closedAt: '2026-07-22T09:00:00.000Z',
    closedTradingDayKey: '2026-07-22',
  }]

  const completed = completeWeeklyReviewCandidate(
    state,
    'review-1',
    new Date('2026-07-21T23:00:00.000+08:00'),
  ).review

  assert(completed.riskSnapshot?.dailyOutcomes[0]?.coverage === 'unknown', '完成业务日之后的亏损仍必须 unknown')
  assert(
    completed.riskSnapshot?.dailyOutcomes[0]?.unknownReasons.includes('future-loss-close-date') ?? false,
    '非法 future loss 必须保留具体原因',
  )
}

export function testWeeklyReviewSeparatesPerformanceEvidenceFromRiskCycle(): void {
  const state = stateAtRevision(7)
  state.liveStatsStartTradingDayKey = '2026-07-21'
  state.trades = [
    { ...trade(7), id: 'old', openedAt: '2026-07-20T08:00:00.000Z' },
    { ...trade(7), id: 'new', openedAt: '2026-07-21T08:00:00.000Z' },
  ]

  const completed = completeWeeklyReviewCandidate(state, 'review-1').review

  assert(completed.metricsSnapshot?.tradeCount === 2, '风险核算起点不得截断周复盘事实与绩效')
  assert(completed.riskSnapshot?.weeklyOutcome.includedTradeCount === 1, '风险快照仍必须只核算起点后的交易')
}

export function testCompletedWeeklyReviewCannotBeRewritten(): void {
  const state = stateAtRevision(7)
  const completed = completeWeeklyReviewCandidate(state, 'review-1').review
  const rewritten = completeWeeklyReviewCandidate({
    ...state,
    trades: [{ ...trade(7), pnl: -9_000 }],
    weeklyReviews: [completed],
  }, 'review-1').review

  assert(rewritten.metricsSnapshot?.totalPnl === -1_000, '已冻结周复盘不得被后续交易数据改写')
  assert(rewritten.completedAt === completed.completedAt, '已冻结周复盘必须保留原冻结时间')
}
