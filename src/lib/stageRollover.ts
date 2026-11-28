import { calendarWeekStart, shiftCalendarDay } from '@/lib/calendarDay'
import type { LiveTrade, Trade } from '@/data/trades'
import type { RiskPolicyVersion } from '@/data/riskManagement'
import type { WeeklyReview } from '@/data/weeklyReviews'
import { isStageWeekCompleted } from '@/lib/weeklyReviewCompletion'
import {
  createNextLiveStage,
  getCurrentLiveStage,
  type LiveStage,
  type ScheduledStageRollover,
} from '@/lib/liveStages'

export type StageRolloverBlockerCode =
  | 'open-trades'

export type StageRolloverAdvisoryCode = 'planned-trades' | 'weekly-review-incomplete'

export interface StageRolloverBlocker {
  code: StageRolloverBlockerCode
}

export interface StageRolloverAdvisory {
  code: StageRolloverAdvisoryCode
}

export interface StageRolloverState {
  liveStages: readonly LiveStage[]
  currentLiveStageId: string
  scheduledStageRollover: ScheduledStageRollover | null
  trades: readonly Trade[]
  weeklyReviews: readonly WeeklyReview[]
  riskPolicyVersions: readonly RiskPolicyVersion[]
}

export type StageRolloverInspection =
  | { kind: 'not-due'; scheduled: ScheduledStageRollover }
  | { kind: 'blocked'; scheduled: ScheduledStageRollover; blockers: StageRolloverBlocker[] }
  | { kind: 'eligible'; scheduled: ScheduledStageRollover }

export interface StageRolloverCandidate {
  liveStages: LiveStage[]
  currentLiveStageId: string
  scheduledStageRollover: null
  trades: readonly Trade[]
  weeklyReviews: readonly WeeklyReview[]
  riskPolicyVersions: readonly RiskPolicyVersion[]
}

export interface BuildStageRolloverCandidateOptions {
  effectiveWeekStart: string
  now: string
  nextStageId: string
}

function precedingWeek(effectiveWeekStart: string): { weekStart: string; weekEnd: string } {
  return {
    weekStart: shiftCalendarDay(effectiveWeekStart, -7),
    weekEnd: shiftCalendarDay(effectiveWeekStart, -1),
  }
}

export function listCurrentStageLiveTrades(
  trades: readonly Trade[],
  currentLiveStageId: string,
): LiveTrade[] {
  return trades.filter((trade): trade is LiveTrade =>
    trade.tradeKind === 'live' &&
    !trade.deletedAt &&
    trade.liveStageId === currentLiveStageId,
  )
}

export function listStageRolloverBlockers(
  state: StageRolloverState,
  effectiveWeekStart: string,
): StageRolloverBlocker[] {
  const currentStage = getCurrentLiveStage([...state.liveStages], state.currentLiveStageId)
  const currentLiveTrades = listCurrentStageLiveTrades(state.trades, currentStage.id)
  const blockers: StageRolloverBlocker[] = []
  if (currentLiveTrades.some((trade) => trade.status === 'open')) {
    blockers.push({ code: 'open-trades' })
  }
  return blockers
}

export function listStageRolloverAdvisories(
  state: StageRolloverState,
  effectiveWeekStart: string,
): StageRolloverAdvisory[] {
  const currentStage = getCurrentLiveStage([...state.liveStages], state.currentLiveStageId)
  const currentLiveTrades = listCurrentStageLiveTrades(state.trades, currentStage.id)
  const advisories: StageRolloverAdvisory[] = []
  if (currentLiveTrades.some((trade) => trade.status === 'planned')) {
    advisories.push({ code: 'planned-trades' })
  }
  const preceding = precedingWeek(effectiveWeekStart)
  if (!isStageWeekCompleted(state.weeklyReviews, currentStage.id, preceding.weekStart)) {
    advisories.push({ code: 'weekly-review-incomplete' })
  }
  return advisories
}

export function scheduleStageRollover(
  currentTradingDayKey: string,
  requestedAt: string,
  id: string,
): ScheduledStageRollover {
  return {
    id,
    requestedAt,
    effectiveWeekStart: shiftCalendarDay(calendarWeekStart(currentTradingDayKey), 7),
    postponedCount: 0,
  }
}

export function inspectDueStageRollover(
  state: StageRolloverState,
  currentTradingDayKey: string,
): StageRolloverInspection {
  const scheduled = state.scheduledStageRollover
  if (!scheduled) throw new Error('没有待执行的实盘阶段切换')
  if (currentTradingDayKey < scheduled.effectiveWeekStart) return { kind: 'not-due', scheduled }

  const blockers = listStageRolloverBlockers(state, scheduled.effectiveWeekStart)

  return blockers.length > 0
    ? { kind: 'blocked', scheduled, blockers }
    : { kind: 'eligible', scheduled }
}

/** 未到期的正常预约不占壳层；顺延或已到生效日才需要工作台横幅。 */
export function shouldSurfaceStageRolloverBanner(
  scheduled: ScheduledStageRollover | null,
  currentTradingDayKey: string,
): boolean {
  if (!scheduled) return false
  return scheduled.postponedCount > 0 || currentTradingDayKey >= scheduled.effectiveWeekStart
}

export function postponeStageRollover(
  scheduled: ScheduledStageRollover,
  currentTradingDayKey: string,
): ScheduledStageRollover {
  return {
    ...scheduled,
    effectiveWeekStart: shiftCalendarDay(calendarWeekStart(currentTradingDayKey), 7),
    postponedCount: scheduled.postponedCount + 1,
  }
}

export function buildStageRolloverCandidate(
  state: StageRolloverState,
  options: BuildStageRolloverCandidateOptions,
): StageRolloverCandidate {
  if (state.liveStages.some((stage) => stage.id === options.nextStageId)) {
    throw new Error(`新实盘阶段 ID 已存在：${options.nextStageId}`)
  }
  const current = getCurrentLiveStage([...state.liveStages], state.currentLiveStageId)
  const next = createNextLiveStage(
    current,
    options.effectiveWeekStart,
    options.now,
    options.nextStageId,
    state.liveStages,
  )
  return {
    liveStages: state.liveStages.map((stage) => stage.id === current.id ? next.archived : stage).concat(next.current),
    currentLiveStageId: next.current.id,
    scheduledStageRollover: null,
    trades: state.trades,
    weeklyReviews: state.weeklyReviews,
    riskPolicyVersions: state.riskPolicyVersions,
  }
}
