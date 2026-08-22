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
  | 'planned-trades'
  | 'open-trades'
  | 'weekly-review-incomplete'

export interface StageRolloverBlocker {
  code: StageRolloverBlockerCode
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

function parseYmd(value: string): { year: number; month: number; day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('实盘阶段切换日期必须是 YYYY-MM-DD')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error('实盘阶段切换日期必须是有效日期')
  }
  return { year, month, day }
}

function addDays(date: string, offset: number): string {
  const { year, month, day } = parseYmd(date)
  const next = new Date(Date.UTC(year, month - 1, day + offset))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`
}

function followingMonday(currentTradingDayKey: string): string {
  const { year, month, day } = parseYmd(currentTradingDayKey)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const daysUntilFollowingMonday = weekday === 1 ? 7 : (8 - weekday) % 7
  return addDays(currentTradingDayKey, daysUntilFollowingMonday)
}

function precedingWeek(effectiveWeekStart: string): { weekStart: string; weekEnd: string } {
  return {
    weekStart: addDays(effectiveWeekStart, -7),
    weekEnd: addDays(effectiveWeekStart, -1),
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
  if (currentLiveTrades.some((trade) => trade.status === 'planned')) {
    blockers.push({ code: 'planned-trades' })
  }
  if (currentLiveTrades.some((trade) => trade.status === 'open')) {
    blockers.push({ code: 'open-trades' })
  }
  const preceding = precedingWeek(effectiveWeekStart)
  if (!isStageWeekCompleted(state.weeklyReviews, currentStage.id, preceding.weekStart)) {
    blockers.push({ code: 'weekly-review-incomplete' })
  }
  return blockers
}

export function scheduleStageRollover(
  currentTradingDayKey: string,
  requestedAt: string,
  id: string,
): ScheduledStageRollover {
  return {
    id,
    requestedAt,
    effectiveWeekStart: followingMonday(currentTradingDayKey),
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

export function postponeStageRollover(
  scheduled: ScheduledStageRollover,
  currentTradingDayKey: string,
): ScheduledStageRollover {
  return {
    ...scheduled,
    effectiveWeekStart: followingMonday(currentTradingDayKey),
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
