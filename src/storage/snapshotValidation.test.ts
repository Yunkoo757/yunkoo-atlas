import {
  assertValidPersistedSnapshot,
  isValidPersistedTrade,
} from '@/storage/snapshotValidation'
import { buildWeeklyReviewMetrics, createWeeklyReview } from '@/data/weeklyReviews'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

const valid = {
  liveStages: [{
    id: 'stage-current', sequence: 1, name: '实盘阶段 1', status: 'current',
    startsOn: '2026-07-01', endsOn: null, createdAt: '2026-07-01T00:00:00.000Z', archivedAt: null,
  }],
  currentLiveStageId: 'stage-current',
  scheduledStageRollover: null,
  trades: [{
    id: 'trade-1', ref: 'TRD-1', symbol: 'BTCUSDT', side: 'long', status: 'open',
    conviction: 'medium', strategyId: 'strategy-1', tags: [], mistakeTags: [],
    tradeKind: 'live', entry: 100, exit: null, size: 1, pnl: null, rMultiple: null,
    openedAt: '2026-07-14', closedAt: null, note: '', liveStageId: 'stage-current',
  }],
  strategies: [{ id: 'strategy-1', name: '趋势', icon: 'trending-up', color: '#5e6ad2' }],
  starredIds: [], subscribedIds: [], pinnedStrategyIds: [],
  weeklyRiskPreparations: [], riskPolicyVersions: [], monthlyRiskLimits: [], riskOverrideEvents: [],
}

export function testSnapshotValidationEnforcesV12StageOwnershipAcrossEntities(): void {
  const full = createFullPersistedSnapshotFixture()
  assertValidPersistedSnapshot(full)

  const unknown = 'missing-stage'
  const invalidSnapshots = [
    { ...full, trades: [{ ...full.trades[0]!, liveStageId: unknown }] },
    { ...full, trades: [{ ...full.trades[0]!, liveStageId: undefined }] },
    { ...full, weeklyReviews: [{ ...full.weeklyReviews![0]!, liveStageId: null }] },
    { ...full, weeklyRiskPreparations: [{ ...full.weeklyRiskPreparations[0]!, liveStageId: undefined }] },
    { ...full, riskPolicyVersions: [{ ...full.riskPolicyVersions[0]!, liveStageId: unknown }] },
    { ...full, monthlyRiskLimits: [{ ...full.monthlyRiskLimits[0]!, liveStageId: null }] },
    { ...full, riskOverrideEvents: [{ ...full.riskOverrideEvents[0]!, liveStageId: unknown }] },
  ]
  for (const snapshot of invalidSnapshots) {
    let rejected = false
    try { assertValidPersistedSnapshot(snapshot) } catch { rejected = true }
    assert(rejected, 'v12 未定义、null 或未知阶段归属必须按实体规则拒绝')
  }

  assertValidPersistedSnapshot({ ...full, trades: [{ ...full.trades[0]!, liveStageId: null }] })
  const caseTrade = { ...full.trades[0]!, id: 'case-pending', tradeKind: 'case' as const, liveStageId: null }
  assertValidPersistedSnapshot({ ...full, trades: [caseTrade] })

  const paperWithOwnership = { ...full.trades[0]!, tradeKind: 'paper' as const, liveStageId: full.currentLiveStageId }
  let rejectedPaper = false
  try { assertValidPersistedSnapshot({ ...full, trades: [paperWithOwnership] }) } catch { rejectedPaper = true }
  assert(rejectedPaper, '纸面交易必须拒绝 liveStageId 字段')
}

export function testRiskPeriodUniquenessIsScopedByLiveStage(): void {
  const full = createFullPersistedSnapshotFixture()
  const currentStage = { ...full.liveStages[0]!, sequence: 2 }
  const archivedStage = {
    ...currentStage,
    id: 'live-stage-archived',
    sequence: 1,
    name: '历史阶段',
    status: 'archived' as const,
    startsOn: '2026-07-01',
    endsOn: '2026-07-12',
    archivedAt: currentStage.createdAt,
  }
  const crossStage = {
    ...full,
    liveStages: [archivedStage, currentStage],
    weeklyRiskPreparations: [
      full.weeklyRiskPreparations[0]!,
      {
        ...full.weeklyRiskPreparations[0]!,
        id: `weekly-risk-preparation:${archivedStage.id}:${full.weeklyRiskPreparations[0]!.weekStart}`,
        liveStageId: archivedStage.id,
      },
    ],
    monthlyRiskLimits: [
      full.monthlyRiskLimits[0]!,
      {
        ...full.monthlyRiskLimits[0]!,
        id: `monthly-risk-limit:${archivedStage.id}:${full.monthlyRiskLimits[0]!.monthKey}`,
        liveStageId: archivedStage.id,
      },
    ],
  }
  assertValidPersistedSnapshot(crossStage)

  const sameStageDuplicates = [{
    ...crossStage,
    weeklyRiskPreparations: crossStage.weeklyRiskPreparations.map((item, index) =>
      index === 1 ? {
        ...item,
        liveStageId: currentStage.id,
        id: `weekly-risk-preparation:${currentStage.id}:${item.weekStart}`,
      } : item,
    ),
  }, {
    ...crossStage,
    monthlyRiskLimits: crossStage.monthlyRiskLimits.map((item, index) =>
      index === 1 ? {
        ...item,
        liveStageId: currentStage.id,
        id: `monthly-risk-limit:${currentStage.id}:${item.monthKey}`,
      } : item,
    ),
  }]
  for (const duplicate of sameStageDuplicates) {
    let rejected = false
    try {
      assertValidPersistedSnapshot(duplicate)
    } catch {
      rejected = true
    }
    assert(rejected, '同阶段同周期风险实体仍必须拒绝重复')
  }
}

export function testSnapshotValidationValidatesStageStateAndScheduledRollover(): void {
  const full = createFullPersistedSnapshotFixture()
  assertValidPersistedSnapshot({
    ...full,
    scheduledStageRollover: {
      id: 'rollover-1',
      requestedAt: '2026-08-22T00:00:00.000Z',
      effectiveWeekStart: '2026-08-24',
      postponedCount: 0,
    },
  })
  for (const patch of [
    { currentLiveStageId: 'missing-stage' },
    { liveStages: [{ ...full.liveStages[0]!, status: 'archived' }] },
    { scheduledStageRollover: undefined },
    { scheduledStageRollover: { id: '', requestedAt: 'bad', effectiveWeekStart: '2026-02-30', postponedCount: -1 } },
    { scheduledStageRollover: { id: 'rollover-tuesday', requestedAt: '2026-08-22T00:00:00.000Z', effectiveWeekStart: '2026-08-25', postponedCount: 0 } },
  ]) {
    let rejected = false
    try { assertValidPersistedSnapshot({ ...full, ...patch }) } catch { rejected = true }
    assert(rejected, '损坏的阶段状态或计划轮换不得进入 v12 快照')
  }
}

export function testSnapshotValidationAcceptsOpenTradesAndLegacyOptionalFields(): void {
  assertValidPersistedSnapshot(valid)
  const legacy = { ...valid, trades: valid.trades.map(({ tradeKind: _tradeKind, mistakeTags: _mistakes, ...trade }) => trade) }
  assertValidPersistedSnapshot(legacy)
}

export function testSnapshotValidationRejectsMalformedLiveCycleStart(): void {
  for (const value of ['2026-02-30', '27-07-2026', 20260727]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({ ...valid, liveStatsStartTradingDayKey: value })
    } catch {
      rejected = true
    }
    assert(rejected, `非法实盘统计起点 ${value} 必须拒绝`)
  }
}

export function testSnapshotValidationValidatesLivePerformanceCycles(): void {
  const cycles = [{
    id: 'performance-cycle-validation',
    name: '验证统计周期',
    startTradingDayKey: '2026-07-14',
    createdAt: '2026-07-14T00:00:00.000Z',
  }]
  const serialized = JSON.stringify(cycles)
  assertValidPersistedSnapshot({ ...valid, livePerformanceCycles: cycles })
  assert(JSON.stringify(cycles) === serialized, '合法非空周期集合必须原样通过验证')

  const invalidCollections = [
    [cycles[0], { ...cycles[0], name: '另一周期', startTradingDayKey: '2026-07-15' }],
    [cycles[0], { ...cycles[0], id: 'performance-cycle-validation-2', startTradingDayKey: '2026-07-15' }],
    [cycles[0], { ...cycles[0], id: 'performance-cycle-validation-2', name: '另一周期' }],
    [{ ...cycles[0], startTradingDayKey: '2026-07-15' }, cycles[0]],
    [{ ...cycles[0], startTradingDayKey: '2026-02-30' }],
    [{ ...cycles[0], createdAt: '2026-07-14T00:00:00' }],
    [{}],
  ]
  for (const livePerformanceCycles of invalidCollections) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({ ...valid, livePerformanceCycles })
    } catch {
      rejected = true
    }
    assert(rejected, '重复、无序或畸形实盘统计周期不得进入资料库快照')
  }
}

export function testSnapshotValidationAcceptsLegacyWeeklyMetricsAndRejectsMalformedExecutionGaps(): void {
  const review = {
    ...createWeeklyReview('2026-07-13', 'stage-current'),
    liveStageId: 'stage-current',
    metricsSnapshot: buildWeeklyReviewMetrics([]),
  }
  const legacyMetrics: Record<string, unknown> = { ...review.metricsSnapshot }
  delete legacyMetrics.missedCount
  delete legacyMetrics.missedReasonCounts
  assertValidPersistedSnapshot({
    ...valid,
    weeklyReviews: [{ ...review, metricsSnapshot: legacyMetrics }],
  })

  for (const metricsPatch of [
    { missedCount: '1' },
    { missedReasonCounts: { hesitation: '1' } },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({
        ...valid,
        weeklyReviews: [{
          ...review,
          metricsSnapshot: { ...review.metricsSnapshot, ...metricsPatch },
        }],
      })
    } catch {
      rejected = true
    }
    assert(rejected, '损坏的执行缺口统计不得进入资料库快照')
  }
}

export function testSnapshotValidationRejectsMalformedWeeklyEvidenceSnapshots(): void {
  const review = {
    ...createWeeklyReview('2026-07-13', 'stage-current'),
    liveStageId: 'stage-current',
    evidenceSnapshot: {
      trades: [{ ...valid.trades[0] }],
      missedTrades: [{ ...valid.trades[0] }],
    },
  }
  assertValidPersistedSnapshot({ ...valid, weeklyReviews: [review] })

  for (const evidenceSnapshot of [
    [],
    { trades: [], missedTrades: {} },
    { trades: [{ ...valid.trades[0], pnl: '100' }], missedTrades: [] },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({
        ...valid,
        weeklyReviews: [{ ...review, evidenceSnapshot }],
      })
    } catch {
      rejected = true
    }
    assert(rejected, '损坏的周复盘证据快照不得进入资料库')
  }
}

export function testSnapshotValidationRejectsMalformedTradeAndSettingsData(): void {
  let rejectedTrade = false
  try {
    assertValidPersistedSnapshot({ ...valid, trades: [{ ...valid.trades[0], entry: '100' }] })
  } catch {
    rejectedTrade = true
  }
  assert(rejectedTrade, '字符串价格不得进入资料库快照')

  let rejectedSettings = false
  try {
    assertValidPersistedSnapshot({ ...valid, starredIds: ['trade-1', 2] })
  } catch {
    rejectedSettings = true
  }
  assert(rejectedSettings, '损坏的设置数组不得进入资料库快照')
}

export function testSnapshotValidationRequiresRuntimeIdCollections(): void {
  for (const field of ['starredIds', 'subscribedIds', 'pinnedStrategyIds']) {
    const candidate: Record<string, unknown> = { ...valid }
    delete candidate[field]
    let rejected = false
    try {
      assertValidPersistedSnapshot(candidate)
    } catch {
      rejected = true
    }
    assert(rejected, `缺少 ${field} 时不得把快照提升为可运行状态`)
  }
}

export function testSnapshotValidationRejectsMissingRuntimeFieldsAndMalformedHistory(): void {
  for (const tradePatch of [
    { tags: undefined },
    { note: undefined },
    { comments: [{ id: 'comment-1', text: 42, createdAt: '2026-07-14' }] },
    { activities: [{ id: 'activity-1', kind: 'unknown', timestamp: '2026-07-14' }] },
    { activities: [{ id: 'activity-1', kind: 'status', timestamp: '2026-07-14', status: 'unknown' }] },
    { session: 42 },
    { timeframe: {} },
    { caseType: 'unknown' },
    { masteryState: 'learning' },
    { missReason: 'forgot' },
    { nextReviewAt: 20260720 },
    { deletedAt: false },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({
        ...valid,
        trades: [{ ...valid.trades[0], ...tradePatch }],
      })
    } catch {
      rejected = true
    }
    assert(rejected, '会破坏列表、搜索或活动流的畸形字段不得进入资料库')
  }
}

export function testSnapshotValidationRejectsMalformedDisplaySettings(): void {
  for (const display of [
    { hideClosed: 'false' },
    { sortBy: 'profit' },
    { sidebarPins: ['active', 2] },
    { sidebarWorkspaceItems: [{ id: 'broken' }] },
    { workspaceMemory: { trade: { pathname: 42 } } },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({ ...valid, display })
    } catch {
      rejected = true
    }
    assert(rejected, '完整恢复不得静默吞掉畸形显示设置')
  }
}

export function testSnapshotValidationAcceptsLegacyQuickViewSidebarPins(): void {
  assertValidPersistedSnapshot({
    ...valid,
    display: {
      sidebarWorkspaceItems: [
        {
          id: 'quick-view:paper:missed',
          target: { kind: 'quick-view', workspace: 'paper', view: 'missed' },
          placement: 'pinned',
          order: 0,
        },
        {
          id: 'system:missed',
          target: { kind: 'system', id: 'missed', workspaces: ['trade', 'case'] },
          placement: 'pinned',
          order: 1,
        },
      ],
    },
  })
}

export function testSnapshotValidationChecksResultAuthorityAndInitialRisk(): void {
  assertValidPersistedSnapshot({
    ...valid,
    trades: [{
      ...valid.trades[0],
      status: 'win',
      resultSource: 'price',
      exit: 110,
      initialStopLoss: 95,
      rMultiple: 2,
    }],
  })

  for (const tradePatch of [
    { resultSource: 'guessed' },
    { initialStopLoss: '95' },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({
        ...valid,
        trades: [{ ...valid.trades[0], ...tradePatch }],
      })
    } catch {
      rejected = true
    }
    assert(rejected, 'invalid result metadata must not enter a snapshot')
  }
}

export function testSnapshotValidationEnforcesDeclaredResultAuthorityMetrics(): void {
  const assertTradeAccepted = (tradePatch: Record<string, unknown>) => {
    assertValidPersistedSnapshot({
      ...valid,
      trades: [{ ...valid.trades[0], status: 'win', ...tradePatch }],
    })
  }
  const assertTradeRejected = (tradePatch: Record<string, unknown>) => {
    let rejected = false
    try {
      assertTradeAccepted(tradePatch)
    } catch {
      rejected = true
    }
    assert(rejected, 'declared authority must match its authoritative metric combination')
  }

  assertTradeAccepted({ pnl: 10, rMultiple: null, resultSource: 'pnl' })
  assertTradeAccepted({ pnl: null, rMultiple: 2, resultSource: 'r' })
  assertTradeAccepted({
    pnl: null,
    rMultiple: 2,
    resultSource: 'price',
    exit: 110,
    initialStopLoss: 95,
  })
  assertTradeAccepted({ pnl: 10, rMultiple: 2, resultSource: 'imported' })
  assertTradeAccepted({ pnl: 10, rMultiple: 2, resultSource: undefined })

  assertTradeRejected({ pnl: null, rMultiple: 2, resultSource: 'pnl' })
  assertTradeRejected({ pnl: 10, rMultiple: 2, resultSource: 'pnl' })
  assertTradeRejected({ pnl: 10, rMultiple: null, resultSource: 'r' })
  assertTradeRejected({ pnl: 10, rMultiple: 2, resultSource: 'price' })
  assertTradeRejected({ pnl: null, rMultiple: 2, resultSource: 'price', exit: null })
  assertTradeRejected({
    pnl: null,
    rMultiple: 3,
    resultSource: 'price',
    exit: 110,
    initialStopLoss: 95,
  })
  assertTradeRejected({ pnl: 10, rMultiple: null, resultSource: 'imported' })
}

export function testSnapshotValidationExportsReusableTradeValidation(): void {
  assert(isValidPersistedTrade(valid.trades[0]), '共享 Trade 校验应接受有效持久化记录')
  assert(isValidPersistedTrade({ ...valid.trades[0], cashCurrency: 'USD' }), '规范 active ISO 4217 币种必须接受')
  assert(isValidPersistedTrade({ ...valid.trades[0], cashCurrency: null }), '显式 null 币种事实必须接受')
  const missingCurrency: Record<string, unknown> = { ...valid.trades[0] }
  delete missingCurrency.cashCurrency
  assert(isValidPersistedTrade(missingCurrency), '旧记录缺失 cashCurrency 字段必须继续接受')
  assert(!isValidPersistedTrade({ ...valid.trades[0], cashCurrency: 'US' }), '非三字母 ISO 4217 币种必须拒绝')
  assert(!isValidPersistedTrade({ ...valid.trades[0], cashCurrency: 'usd' }), '非规范大小写币种不得在载入时静默改写')
  assert(
    !isValidPersistedTrade({ ...valid.trades[0], comments: [{ id: 'c-1', text: 2, createdAt: 'now' }] }),
    '共享 Trade 校验应拒绝会破坏评论流的数据',
  )

  const legacyCase = {
    ...valid.trades[0],
    tradeKind: 'case',
    sourceTradeId: 'source',
    note: '<p>历史混合正文</p>',
  }
  assert(isValidPersistedTrade(legacyCase), '历史案例缺少 sourceNoteHtml 必须继续有效')
  assert(
    isValidPersistedTrade({ ...legacyCase, sourceNoteHtml: '<p>来源快照</p>' }),
    '字符串快照必须有效',
  )
  assert(!isValidPersistedTrade({ ...legacyCase, sourceNoteHtml: 42 }), '非字符串快照必须拒绝')
}

export function testSnapshotValidationRejectsDuplicateEntityIds(): void {
  for (const candidate of [
    { ...valid, trades: [valid.trades[0], { ...valid.trades[0], ref: 'TRD-2' }] },
    { ...valid, strategies: [valid.strategies[0], { ...valid.strategies[0], name: '重复策略' }] },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot(candidate)
    } catch {
      rejected = true
    }
    assert(rejected, '重复的交易或策略 ID 不得进入资料库')
  }
}

export function testSnapshotValidationScopesWeeklyReviewUniquenessToStageAndWeek(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const currentStage = { ...fixture.liveStages[0]!, sequence: 2 }
  const archivedStage = {
    ...currentStage,
    id: 'weekly-review-archived-stage',
    sequence: 1,
    name: '历史阶段',
    status: 'archived' as const,
    startsOn: '2026-07-01',
    endsOn: '2026-07-12',
    createdAt: '2026-07-01T00:00:00.000Z',
    archivedAt: '2026-07-13T00:00:00.000Z',
  }
  const currentReview = fixture.weeklyReviews![0]!
  const archivedReview = {
    ...currentReview,
    id: `weekly-review:${archivedStage.id}:${currentReview.weekStart}`,
    liveStageId: archivedStage.id,
  }
  const base = {
    ...fixture,
    liveStages: [archivedStage, currentStage],
  }

  assertValidPersistedSnapshot({ ...base, weeklyReviews: [currentReview, archivedReview] })

  let rejected = false
  try {
    assertValidPersistedSnapshot({
      ...base,
      weeklyReviews: [currentReview, { ...currentReview, id: 'same-stage-duplicate' }],
    })
  } catch {
    rejected = true
  }
  assert(rejected, '同一阶段同一周的重复复盘必须拒绝')
}

function snapshotWithWeeklyRiskReview() {
  const fixture = createFullPersistedSnapshotFixture()
  const event = fixture.riskOverrideEvents[0]!
  const review = fixture.weeklyReviews![0]!
  return {
    ...fixture,
    weeklyReviews: [{
      ...review,
      riskSnapshot: {
        policyVersions: fixture.riskPolicyVersions,
        dailyOutcomes: [{ ...event.outcomesAtDecision.day, date: '2026-07-17' }],
        weeklyOutcome: event.outcomesAtDecision.week,
        monthlyOutcomeAtCompletion: event.outcomesAtDecision.month,
        overrideEvents: fixture.riskOverrideEvents,
        frozenAt: review.completedAt!,
      },
    }],
  }
}

export function testSnapshotValidationStrictlyValidatesWeeklyRiskReviewSnapshots(): void {
  const complete = snapshotWithWeeklyRiskReview()
  assertValidPersistedSnapshot(complete)
  const legacy = structuredClone(complete)
  delete (legacy.weeklyReviews[0]! as { riskSnapshot?: unknown }).riskSnapshot
  assertValidPersistedSnapshot(legacy)

  const corruptions: Array<(candidate: ReturnType<typeof snapshotWithWeeklyRiskReview>) => void> = [
    (candidate) => { candidate.weeklyReviews[0]!.riskSnapshot!.policyVersions[0]!.riskAmount = -1 },
    (candidate) => { candidate.weeklyReviews[0]!.riskSnapshot!.dailyOutcomes[0]!.date = '2026-02-30' },
    (candidate) => { candidate.weeklyReviews[0]!.riskSnapshot!.weeklyOutcome.coverage = 'safe' as 'complete' },
    (candidate) => { candidate.weeklyReviews[0]!.riskSnapshot!.monthlyOutcomeAtCompletion.progress = 2 },
    (candidate) => { candidate.weeklyReviews[0]!.riskSnapshot!.overrideEvents[0]!.reason = '' },
    (candidate) => { candidate.weeklyReviews[0]!.riskSnapshot!.frozenAt = 'not-a-timestamp' },
  ]
  for (const corrupt of corruptions) {
    const candidate = structuredClone(complete)
    corrupt(candidate)
    let rejected = false
    try {
      assertValidPersistedSnapshot(candidate)
    } catch {
      rejected = true
    }
    assert(rejected, '损坏的周复盘风险快照必须被中央验证器拒绝')
  }
}

export function testSnapshotValidationEnforcesClosedTradingDayKeyContract(): void {
  const closedLiveTrade = {
    ...valid.trades[0],
    status: 'loss',
    closedAt: '2026-07-27',
    pnl: -10,
    resultSource: 'pnl',
  }
  assertValidPersistedSnapshot({
    ...valid,
    trades: [{ ...closedLiveTrade, closedTradingDayKey: '2026-07-27' }],
  })
  assertValidPersistedSnapshot({
    ...valid,
    trades: [{ ...closedLiveTrade, closedAt: 'invalid-date', closedTradingDayKey: undefined }],
  })

  for (const trade of [
    closedLiveTrade,
    { ...closedLiveTrade, closedTradingDayKey: '2026-02-30' },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({ ...valid, trades: [trade] })
    } catch {
      rejected = true
    }
    assert(rejected, '合法 closedAt 的终态实盘交易必须携带合法 closedTradingDayKey')
  }
}

export function testSnapshotValidationRejectsMalformedRiskEntities(): void {
  const full = {
    ...valid,
    weeklyRiskPreparations: [{
      id: 'weekly-risk-preparation:2026-07-27',
      liveStageId: 'stage-current',
      weekStart: '2026-07-27',
      draft: {
        capitalBase: 10000,
        riskPercent: 1,
        riskAmount: 100,
        dailyLossLimitR: 2,
        weeklyLossLimitR: 5,
        monthlyLossLimitRDefault: 10,
        disciplineText: '只做计划内交易',
      },
      reviewedAt: '2026-07-26T08:00:00.000Z',
      confirmedPolicyVersionId: 'risk-policy:1',
      createdAt: '2026-07-26T07:00:00.000Z',
      updatedAt: '2026-07-26T08:00:00.000Z',
    }],
    riskPolicyVersions: [{
      id: 'risk-policy:1',
      liveStageId: 'stage-current',
      sourceWeekStart: '2026-07-27',
      effectiveTradingDay: '2026-07-27',
      capitalBase: 10000,
      riskPercent: 1,
      riskAmount: 100,
      dailyLossLimitR: 2,
      weeklyLossLimitR: 5,
      monthlyLossLimitRDefault: 10,
      disciplineText: '只做计划内交易',
      confirmedAt: '2026-07-26T08:00:00.000Z',
    }],
    monthlyRiskLimits: [{
      id: 'monthly-risk-limit:2026-07',
      liveStageId: 'stage-current',
      monthKey: '2026-07',
      limitR: 10,
      sourcePolicyVersionId: 'risk-policy:1',
      lockedAt: '2026-07-26T08:00:00.000Z',
    }],
    riskOverrideEvents: [{
      id: 'risk-override:1',
      liveStageId: 'stage-current',
      tradeId: 'trade-1',
      tradeIdentityAtDecision: { ref: 'TRD-1', symbol: 'BTCUSDT', tradeKind: 'live' },
      linkState: 'resolved',
      decisionType: 'triggered',
      tradingDayKeyAtDecision: '2026-07-27',
      policyVersionId: 'risk-policy:1',
      createdAt: '2026-07-26T08:00:00.000Z',
      reason: '接受风险',
      fingerprint: 'fingerprint-1',
      outcomesAtDecision: Object.fromEntries(['day', 'week', 'month'].map((scope) => [scope, {
        netBudgetR: -2,
        limitR: 2,
        consumedR: 2,
        remainingR: 0,
        progress: 1,
        coverage: 'complete',
        triggered: true,
        includedTradeCount: 1,
        excludedTradeCount: 0,
        unknownReasons: [],
      }])),
      unknownReasons: [],
    }],
  }
  assertValidPersistedSnapshot(full)

  for (const patch of [
    { weeklyRiskPreparations: [{ ...full.weeklyRiskPreparations[0], weekStart: '2026-02-30' }] },
    { riskPolicyVersions: [{ ...full.riskPolicyVersions[0], riskAmount: 99 }] },
    { riskPolicyVersions: [{
      ...full.riskPolicyVersions[0],
      capitalBase: 100.004,
      riskPercent: 1,
      riskAmount: 1,
    }] },
    { riskPolicyVersions: [{
      ...full.riskPolicyVersions[0],
      capitalBase: 10000,
      riskPercent: 1,
      riskAmount: 99.999,
    }] },
    { weeklyRiskPreparations: [{
      ...full.weeklyRiskPreparations[0],
      createdAt: '2026-07-26T07:00:00',
    }] },
    { riskPolicyVersions: [{
      ...full.riskPolicyVersions[0],
      confirmedAt: '2026-07-26',
    }] },
    { monthlyRiskLimits: [{
      ...full.monthlyRiskLimits[0],
      lockedAt: '2026-07-26T08:00:00',
    }] },
    { riskOverrideEvents: [{
      ...full.riskOverrideEvents[0],
      createdAt: '2026-07-26T08:00:00',
    }] },
    { monthlyRiskLimits: [{ ...full.monthlyRiskLimits[0], limitR: Number.POSITIVE_INFINITY }] },
    { riskOverrideEvents: [{
      ...full.riskOverrideEvents[0],
      tradeIdentityAtDecision: { ref: 'TRD-1', symbol: 'BTCUSDT', tradeKind: 'paper' },
    }] },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({ ...full, ...patch })
    } catch {
      rejected = true
    }
    assert(rejected, '损坏的风险实体不得进入资料库快照')
  }

  assertValidPersistedSnapshot({
    ...full,
    riskPolicyVersions: [{
      ...full.riskPolicyVersions[0],
      confirmedAt: '2026-07-26T16:00:00+08:00',
    }],
  })
}

export function testSnapshotValidationCoversWorkflowMetadataStructures(): void {
  assertValidPersistedSnapshot({
    ...valid,
    shortcuts: {
      'nav.list': { mod: true, key: 'l' },
      'nav.sequence': [{ key: 'g' }, { shift: true, key: 'l' }],
      'nav.disabled': null,
    },
    profile: {
      avatarId: null,
      displayName: 'Yunkoo',
      customAvatarDataUrl: null,
      legacyCashCurrencyAssumption: null,
    },
    savedTradeViews: [{
      id: 'view-1',
      name: '待复盘',
      pathname: '/list',
      search: { reviewStatus: 'unreviewed' },
      pinned: true,
      order: 0,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }],
    symbolCatalog: ['BTCUSDT'],
    symbolIcons: {
      BTCUSDT: { presetId: 'btc', customDataUrl: null, updatedAt: '2026-07-16' },
    },
  })

  for (const patch of [
    { shortcuts: { 'nav.list': { key: 42 } } },
    { shortcuts: { 'nav.list': [] } },
    { profile: { displayName: 'Yunkoo' } },
    { savedTradeViews: [{ id: 'view-1', name: '坏视图', pathname: '/list', search: { status: 2 }, pinned: true, order: 0, createdAt: 'now', updatedAt: 'now' }] },
    { symbolCatalog: ['BTCUSDT', 42] },
    { symbolIcons: { BTCUSDT: { presetId: 'btc', updatedAt: 42 } } },
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({ ...valid, ...patch })
    } catch {
      rejected = true
    }
    assert(rejected, '损坏的快捷键、资料、视图或品种设置不得进入恢复流程')
  }
}

export function testSnapshotValidationRejectsInvalidLegacyCashCurrencyAssumptions(): void {
  const full = createFullPersistedSnapshotFixture()
  assertValidPersistedSnapshot({
    ...full,
    profile: {
      ...full.profile!,
      legacyCashCurrencyAssumption: {
        currency: 'USD',
        confirmedAt: '2026-08-09T04:00:00.000Z',
      },
    },
  })

  for (const legacyCashCurrencyAssumption of [
    { currency: 'CNY', confirmedAt: '2026-08-09T04:00:00.000Z' },
    { currency: 'usd', confirmedAt: '2026-08-09T04:00:00.000Z' },
    { currency: 'USD', confirmedAt: 'not-a-timestamp' },
    { currency: 'USD', confirmedAt: '2026-02-30T04:00:00.000Z' },
    undefined,
  ]) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({
        ...full,
        profile: { ...full.profile!, legacyCashCurrencyAssumption },
      })
    } catch {
      rejected = true
    }
    assert(rejected, `非法旧现金币种假设 ${JSON.stringify(legacyCashCurrencyAssumption)} 必须拒绝`)
  }
}

export function testValidatesOptionalNotionImportProvenance(): void {
  const valid = createFullPersistedSnapshotFixture()
  const baseTrade = valid.trades[0]!
  assertValidPersistedSnapshot({
    ...valid,
    trades: [{
      ...baseTrade,
      importProvenance: {
        source: 'notion',
        importedAt: '2026-08-09T00:00:00.000Z',
        openedAtSource: 'notion-date',
        closedAtSource: 'missing-in-source',
      },
    }],
  })
  const invalidValues = [
    null,
    { source: 'manual', importedAt: '2026-08-09T00:00:00.000Z', openedAtSource: 'notion-date', closedAtSource: 'missing-in-source' },
    { source: 'notion', importedAt: 'not-a-time', openedAtSource: 'notion-date', closedAtSource: 'missing-in-source' },
    { source: 'notion', importedAt: '2026-08-09T00:00:00.000Z', openedAtSource: 'guessed', closedAtSource: 'missing-in-source' },
    { source: 'notion', importedAt: '2026-08-09T00:00:00.000Z', openedAtSource: 'notion-date', closedAtSource: 'copied' },
  ]
  for (const importProvenance of invalidValues) {
    let rejected = false
    try {
      assertValidPersistedSnapshot({ ...valid, trades: [{ ...baseTrade, importProvenance }] })
    } catch {
      rejected = true
    }
    assert(rejected, '非法 Notion 导入来源证据必须拒绝')
  }
}
