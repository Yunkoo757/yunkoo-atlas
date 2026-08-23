import type { Trade } from '@/data/trades'
import type { WeeklyReview } from '@/data/weeklyReviews'
import type { RiskPolicyVersion } from '@/data/riskManagement'
import type { LiveStage, ScheduledStageRollover } from '@/lib/liveStages'
import {
  buildStageRolloverCandidate,
  inspectDueStageRollover,
  listStageRolloverAdvisories,
  listStageRolloverBlockers,
  postponeStageRollover,
  scheduleStageRollover,
  type StageRolloverState,
} from '@/lib/stageRollover'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const currentStage: LiveStage = {
  id: 'stage-1',
  sequence: 1,
  name: '实盘阶段 1',
  status: 'current',
  startsOn: '2026-08-01',
  endsOn: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  archivedAt: null,
}

function liveTrade(id: string, status: Trade['status'], liveStageId = currentStage.id): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status,
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    liveStageId,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 0,
    exit: null,
    size: 0,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-08-28',
    closedAt: null,
    note: '',
  }
}

function caseTrade(id: string, status: 'planned' | 'open'): Trade {
  return {
    ...liveTrade(id, status),
    tradeKind: 'case',
    sourceTradeId: 'source-live-trade',
  }
}

function weeklyReview(status: WeeklyReview['status'], liveStageId = currentStage.id): WeeklyReview {
  return {
    id: 'weekly-review:2026-08-24',
    liveStageId,
    weekStart: '2026-08-24',
    weekEnd: '2026-08-30',
    status,
    executionScore: null,
    riskScore: null,
    emotionScore: null,
    strengthTags: [],
    mistakeTags: [],
    highlightTradeIds: [],
    mistakeTradeIds: [],
    followUpTradeIds: [],
    contentHtml: '',
    commitmentText: '',
    commitmentCriteria: '',
    previousCommitmentResult: null,
    metricsSnapshot: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    completedAt: status === 'completed' ? '2026-08-30T00:00:00.000Z' : null,
  }
}

function scheduled(): ScheduledStageRollover {
  return {
    id: 'rollover-1',
    requestedAt: '2026-08-28T09:00:00.000Z',
    effectiveWeekStart: '2026-08-31',
    postponedCount: 0,
  }
}

function baseState(): StageRolloverState {
  return {
    liveStages: [currentStage],
    currentLiveStageId: currentStage.id,
    scheduledStageRollover: scheduled(),
    trades: [],
    weeklyReviews: [weeklyReview('completed')],
    riskPolicyVersions: [],
  }
}

function blockedState(): StageRolloverState {
  return {
    ...baseState(),
    trades: [
      liveTrade('planned', 'planned'),
      liveTrade('open', 'open'),
      liveTrade('historical-planned', 'planned', 'stage-old'),
    ],
    weeklyReviews: [weeklyReview('draft')],
  }
}

function eligibleState(): StageRolloverState {
  const currentPolicy: RiskPolicyVersion = {
    id: 'risk-policy-1',
    liveStageId: currentStage.id,
    sourceWeekStart: '2026-08-24',
    effectiveTradingDay: '2026-08-24',
    capitalBase: 10_000,
    riskPercent: 1,
    riskAmount: 100,
    dailyLossLimitR: 2,
    weeklyLossLimitR: 5,
    monthlyLossLimitRDefault: 10,
    disciplineText: '按计划执行',
    confirmedAt: '2026-08-24T00:00:00.000Z',
  }
  return {
    ...baseState(),
    trades: [liveTrade('historical-win', 'win', 'stage-old')],
    riskPolicyVersions: [currentPolicy],
  }
}

export function testScheduleAlwaysTargetsFollowingMonday(): void {
  const monday = scheduleStageRollover('2026-08-24', '2026-08-24T09:00:00.000Z', 'rollover-1')
  assert(monday.effectiveWeekStart === '2026-08-31', 'Monday request must target the following Monday')
  const friday = scheduleStageRollover('2026-08-28', '2026-08-28T09:00:00.000Z', 'rollover-2')
  assert(friday.effectiveWeekStart === '2026-08-31', 'Friday request must target next Monday')
}

export function testDueRolloverListsEveryBlockerAndPostpones(): void {
  const inspection = inspectDueStageRollover(blockedState(), '2026-08-31')
  assert(inspection.kind === 'blocked', 'blocked rollover must not build a candidate')
  assert(inspection.blockers.map((item) => item.code).join(',') === 'open-trades', 'only open trades may block rollover')
  assert(
    listStageRolloverAdvisories(blockedState(), '2026-08-31').map((item) => item.code).join(',') === 'planned-trades,weekly-review-incomplete',
    'planned trades and incomplete reviews must remain neutral advisories',
  )
  const postponed = postponeStageRollover(blockedState().scheduledStageRollover!, '2026-08-31')
  assert(postponed.effectiveWeekStart === '2026-09-07' && postponed.postponedCount === 1, 'blocked rollover must move one week')
}

export function testPostponementUsesTheNextMondayAfterTheCurrentTradingDay(): void {
  const oneWeekOverdue = postponeStageRollover(scheduled(), '2026-09-07')
  assert(
    oneWeekOverdue.effectiveWeekStart === '2026-09-14',
    '启动时已逾期一周必须从当前交易日选择严格未来的周一，不能落在当前日或旧预约后一周',
  )

  const multipleWeeksOverdue = postponeStageRollover(scheduled(), '2026-09-24')
  assert(
    multipleWeeksOverdue.effectiveWeekStart === '2026-09-28',
    '离线多周后必须从当前交易日选择下一规范周一，不能只给陈旧预约加七天',
  )
  assert(
    oneWeekOverdue.postponedCount === 1 && multipleWeeksOverdue.postponedCount === 1,
    '一次权威顺延检查只推进一次顺延计数',
  )
}

export function testCaseRecordsNeverCreatePlannedOrOpenRolloverBlockers(): void {
  const state = baseState()
  state.trades = [caseTrade('planned-case', 'planned'), caseTrade('open-case', 'open')]
  const blockers = listStageRolloverBlockers(state, state.scheduledStageRollover!.effectiveWeekStart)
  assert(
    blockers.length === 0,
    '案例即使继承 planned/open 状态和当前阶段归属，也不得构成实盘阶段切换阻断项',
  )
}

export function testCurrentBlockersCanBeShownBeforeTheScheduleIsDue(): void {
  const state = blockedState()
  const blockers = listStageRolloverBlockers(state, state.scheduledStageRollover!.effectiveWeekStart)
  assert(
    blockers.map((item) => item.code).join(',') === 'open-trades',
    '预约确认与未到期 banner 必须只把持仓显示为阻断项',
  )
}

export function testPrecedingReviewMustBeCompletedAndOwnedByCurrentStage(): void {
  const state = baseState()
  state.weeklyReviews = [weeklyReview('completed', 'stage-old')]
  const inspection = inspectDueStageRollover(state, '2026-08-31')
  assert(inspection.kind === 'eligible', 'an incomplete current-stage review must not block rollover')
  assert(
    listStageRolloverAdvisories(state, '2026-08-31').some((item) => item.code === 'weekly-review-incomplete'),
    'the incomplete current-stage review remains visible as an advisory',
  )
}

export function testSuccessfulCandidateArchivesOldAndCreatesBlankCurrent(): void {
  const state = eligibleState()
  const candidate = buildStageRolloverCandidate(state, {
    effectiveWeekStart: '2026-08-31',
    now: '2026-08-31T00:10:00.000Z',
    nextStageId: 'stage-2',
  })
  assert(candidate.currentLiveStageId === 'stage-2', 'candidate must select the new stage')
  assert(candidate.scheduledStageRollover === null, 'candidate must consume the schedule')
  assert(candidate.riskPolicyVersions.filter((item) => item.liveStageId === 'stage-2').length === 0, 'new stage risk must be empty')
  assert(candidate.liveStages[0]?.status === 'archived' && candidate.liveStages[1]?.id === 'stage-2', 'candidate must archive only the previous current stage and append a new one')
  assert(candidate.trades === state.trades && candidate.weeklyReviews === state.weeklyReviews, 'candidate must retain old entities without deleting or rewriting them')
}

export function testCandidateKeepsAutomaticStageNameUniqueAfterUserRenamesHistory(): void {
  const state = eligibleState()
  state.liveStages = [{ ...currentStage, name: '实盘阶段 2' }]
  const candidate = buildStageRolloverCandidate(state, {
    effectiveWeekStart: '2026-08-31',
    now: '2026-08-31T00:00:00.000Z',
    nextStageId: 'stage-2',
  })
  assert(
    candidate.liveStages[1]?.name === '实盘阶段 2 (2)',
    '用户已占用下一默认名称时，权威候选必须生成稳定且唯一的后缀名称',
  )
}

export function testCandidateRejectsAnArchivedStageIdWithoutMutatingInput(): void {
  const archived: LiveStage = {
    ...currentStage,
    id: 'stage-archived',
    name: '实盘阶段 1',
    status: 'archived',
    startsOn: '2026-07-01',
    endsOn: '2026-07-31',
    archivedAt: '2026-08-01T00:00:00.000Z',
  }
  const current: LiveStage = {
    ...currentStage,
    id: 'stage-current',
    sequence: 2,
  }
  const archivedPolicy: RiskPolicyVersion = {
    ...eligibleState().riskPolicyVersions[0]!,
    liveStageId: archived.id,
  }
  const state: StageRolloverState = {
    ...baseState(),
    liveStages: [archived, current],
    currentLiveStageId: current.id,
    riskPolicyVersions: [archivedPolicy],
  }
  let message = ''
  try {
    buildStageRolloverCandidate(state, {
      effectiveWeekStart: '2026-08-31',
      now: '2026-08-31T00:10:00.000Z',
      nextStageId: archived.id,
    })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message.includes('已存在'), 'an existing archived stage ID must be rejected before building a candidate')
  assert(state.liveStages[0] === archived && archived.status === 'archived', 'rejected candidate must not rewrite archived stages')
  assert(state.riskPolicyVersions[0] === archivedPolicy && archivedPolicy.liveStageId === archived.id, 'rejected candidate must not rewrite archived risk policies')
}
