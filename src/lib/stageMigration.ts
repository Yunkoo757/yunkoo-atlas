import type { Trade } from '@/data/trades'
import type { WeeklyReview } from '@/data/weeklyReviews'
import { isValidLiveCycleDayKey, openedTradingDayKey } from '@/lib/liveCycle'
import type { LiveStage } from '@/lib/liveStages'
import { assertValidLiveStageState, normalizeLiveStageName } from '@/lib/liveStages'
import { isExecutedClosed, isMissed } from '@/lib/tradeStatus'
import { createBusinessDateAnchor } from '@/lib/periods'
import { closedTradingDayKeyFromClosedAt } from '@/lib/riskBudget'
import { isCanonicalWeeklyReviewPeriod, stageContainsWeeklyReviewPeriod } from '@/lib/weeklyReviewPeriod'
import type { PersistedSnapshot } from '@/storage/types'

export interface LegacyPerformanceCycle {
  id: string
  name: string
  startTradingDayKey: string
  createdAt: string
}

export type LegacyStageSnapshot = Record<string, unknown> & Partial<PersistedSnapshot> & {
  liveStatsStartTradingDayKey?: string | null
  livePerformanceCycles?: LegacyPerformanceCycle[]
}

export interface LegacyStageMigrationOptions {
  now: string
  currentTradingDayKey: string
  idFactory(sequence: number): string
}

export function createLegacyStageMigrationOptions(
  raw: unknown,
  now: Date,
  idFactory: LegacyStageMigrationOptions['idFactory'] = (sequence) => `legacy-live-stage-${sequence}`,
): LegacyStageMigrationOptions {
  const snapshot = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as LegacyStageSnapshot
    : {}
  const anchor = createBusinessDateAnchor(now, snapshot.display?.tradingDayStartHour)
  return {
    now: anchor.now.toISOString(),
    currentTradingDayKey: anchor.currentTradingDayKey,
    idFactory,
  }
}

function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function tradingDayStartHour(raw: LegacyStageSnapshot): number {
  const value = raw.display?.tradingDayStartHour
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23
    ? value
    : 6
}

function legacyCycles(raw: LegacyStageSnapshot): LegacyPerformanceCycle[] {
  const cycles = raw.livePerformanceCycles ?? []
  if (!Array.isArray(cycles)) throw new Error('旧实盘周期必须是数组')
  let previousStart: string | null = null
  for (const cycle of cycles) {
    if (
      typeof cycle?.id !== 'string' || !cycle.id.trim() ||
      typeof cycle.name !== 'string' || !cycle.name.trim() ||
      !isValidLiveCycleDayKey(cycle.startTradingDayKey) ||
      typeof cycle.createdAt !== 'string' || new Date(cycle.createdAt).toISOString() !== cycle.createdAt ||
      (previousStart !== null && cycle.startTradingDayKey <= previousStart)
    ) throw new Error('旧实盘周期无效')
    previousStart = cycle.startTradingDayKey
  }
  return cycles
}

function reliableCaseDay(trade: Trade, startHour: number): string | null {
  if (trade.tradeKind !== 'case') return null
  for (const value of [trade.recordedAt, trade.openedAt]) {
    if (typeof value !== 'string') continue
    const day = openedTradingDayKey({ openedAt: value }, startHour)
    if (day !== null) return day
  }
  return null
}

function reliableTradeDay(trade: Trade, startHour: number): string | null {
  if (trade.tradeKind !== 'live' && trade.tradeKind !== 'case') return null
  if (trade.tradeKind === 'case') return reliableCaseDay(trade, startHour)
  if (!isExecutedClosed(trade.status) && !isMissed(trade.status)) {
    return openedTradingDayKey(trade, startHour)
  }
  if (trade.closedTradingDayKey !== undefined) {
    return isValidLiveCycleDayKey(trade.closedTradingDayKey) ? trade.closedTradingDayKey : null
  }
  const day = closedTradingDayKeyFromClosedAt(trade.closedAt, startHour)
  return day !== null && isValidLiveCycleDayKey(day) ? day : null
}

export function collectReliableLegacyStageRecordDays(
  raw: LegacyStageSnapshot,
): string[] {
  const startHour = tradingDayStartHour(raw)
  const trades = Array.isArray(raw.trades) ? raw.trades : []
  const weeklyReviews = Array.isArray(raw.weeklyReviews) ? raw.weeklyReviews : []
  return [
    ...trades.map((trade) => reliableTradeDay(trade, startHour)),
    ...weeklyReviews.map((review) => (
      isCanonicalWeeklyReviewPeriod(review.weekStart, review.weekEnd) ? review.weekStart : null
    )),
  ].filter((day): day is string => day !== null)
}

function stageForDay(stages: readonly LiveStage[], day: string | null): LiveStage | null {
  if (day === null) return null
  return stages.find((stage) => (
    day >= stage.startsOn && (stage.endsOn === null || day <= stage.endsOn)
  )) ?? null
}

function disambiguateLegacyStageNames<T extends { name: string }>(definitions: readonly T[]): T[] {
  const reservedNames = new Set(definitions.map((definition) => normalizeLiveStageName(definition.name)))
  const usedNames = new Set<string>()
  return definitions.map((definition) => {
    let name = definition.name
    if (usedNames.has(normalizeLiveStageName(name))) {
      const baseName = name.trim()
      let suffix = 2
      do {
        name = `${baseName} (${suffix})`
        suffix += 1
      } while (
        usedNames.has(normalizeLiveStageName(name)) ||
        reservedNames.has(normalizeLiveStageName(name))
      )
    }
    usedNames.add(normalizeLiveStageName(name))
    return name === definition.name ? definition : { ...definition, name }
  })
}

function buildStages(
  raw: LegacyStageSnapshot,
  options: LegacyStageMigrationOptions,
): { liveStages: LiveStage[]; currentLiveStageId: string } {
  const cycles = legacyCycles(raw)
  const firstStart = cycles[0]?.startTradingDayKey ?? (
    isValidLiveCycleDayKey(raw.liveStatsStartTradingDayKey)
      ? raw.liveStatsStartTradingDayKey
      : options.currentTradingDayKey
  )
  const recordDays = collectReliableLegacyStageRecordDays(raw)
  const preCycleDays = recordDays.filter((day) => day < firstStart).sort()
  const definitions = disambiguateLegacyStageNames([
    ...(preCycleDays.length > 0 ? [{
      name: '更早记录',
      startsOn: preCycleDays[0]!,
      createdAt: options.now,
    }] : []),
    ...(cycles.length > 0
      ? cycles.map((cycle) => ({
          name: cycle.name,
          startsOn: cycle.startTradingDayKey,
          createdAt: cycle.createdAt,
        }))
      : [{
          name: '实盘阶段 1',
          startsOn: firstStart,
          createdAt: options.now,
        }]),
  ])

  const liveStages = definitions.map((definition, index): LiveStage => {
    const sequence = index + 1
    const next = definitions[index + 1]
    return {
      id: options.idFactory(sequence),
      sequence,
      name: definition.name,
      status: next ? 'archived' : 'current',
      startsOn: definition.startsOn,
      endsOn: next ? previousDay(next.startsOn) : null,
      createdAt: definition.createdAt,
      archivedAt: next ? next.createdAt : null,
    }
  })
  const currentLiveStageId = liveStages.at(-1)?.id ?? ''
  assertValidLiveStageState({ liveStages, currentLiveStageId })
  return { liveStages, currentLiveStageId }
}

function migrateTrades(
  trades: readonly Trade[],
  stages: readonly LiveStage[],
  startHour: number,
): Trade[] {
  const migratedLive = new Map<string, string>()
  const firstPass = trades.map((trade): Trade => {
    if (trade.tradeKind === 'paper' || trade.tradeKind === undefined) {
      const { liveStageId: _legacyOwnership, ...paper } = trade as Trade & { liveStageId?: unknown }
      return paper as Trade
    }
    if (trade.tradeKind === 'case') return { ...trade, liveStageId: null }
    const liveStageId = stageForDay(stages, reliableTradeDay(trade, startHour))?.id ?? null
    if (liveStageId !== null) migratedLive.set(trade.id, liveStageId)
    return { ...trade, liveStageId }
  })
  return firstPass.map((trade): Trade => {
    if (trade.tradeKind !== 'case') return trade
    const inherited = trade.sourceTradeId ? migratedLive.get(trade.sourceTradeId) : undefined
    return {
      ...trade,
      liveStageId: inherited ?? stageForDay(stages, reliableCaseDay(trade, startHour))?.id ?? null,
    }
  })
}

function migrateWeeklyReviews(
  reviews: readonly WeeklyReview[],
  stages: readonly LiveStage[],
  trades: readonly Trade[],
  topLevelPolicies: readonly PersistedSnapshot['riskPolicyVersions'][number][],
  topLevelRiskLiveStageId: string | null,
): WeeklyReview[] {
  return reviews.map((review) => {
    const canonicalPeriod = isCanonicalWeeklyReviewPeriod(review.weekStart, review.weekEnd)
    const periodStage = stages.find((candidate) => (
      stageContainsWeeklyReviewPeriod(candidate, review.weekStart, review.weekEnd)
    )) ?? null
    let stage = periodStage
    const referencedTradeIds = new Set([
      ...review.highlightTradeIds,
      ...review.mistakeTradeIds,
      ...review.followUpTradeIds,
      ...(review.evidenceSnapshot?.trades.map((trade) => trade.id) ?? []),
      ...(review.evidenceSnapshot?.missedTrades.map((trade) => trade.id) ?? []),
      ...(review.riskSnapshot?.overrideEvents.map((event) => event.tradeId) ?? []),
    ])
    if (stage && [...referencedTradeIds].some((tradeId) => {
      const trade = trades.find((candidate) => candidate.id === tradeId)
      return !trade || trade.tradeKind === 'paper' || trade.liveStageId !== stage?.id
    })) stage = null
    if (stage && review.riskSnapshot?.overrideEvents.some((event) => {
      if (event.policyVersionId === null) return false
      const embedded = review.riskSnapshot?.policyVersions.some(
        (policy) => policy.id === event.policyVersionId,
      )
      if (embedded) return false
      const topLevel = topLevelPolicies.some((policy) => policy.id === event.policyVersionId)
      return !topLevel || topLevelRiskLiveStageId !== stage?.id
    })) stage = null
    const liveStageId = stage?.id ?? null
    const riskSnapshot = review.riskSnapshot
      ? {
          ...review.riskSnapshot,
          policyVersions: review.riskSnapshot.policyVersions.map((item) => ({ ...item, liveStageId })),
          overrideEvents: review.riskSnapshot.overrideEvents.map((item) => ({ ...item, liveStageId })),
        }
      : undefined
    const {
      legacyPeriodQuarantine: _legacyPeriodMarker,
      legacyStageBoundaryOverlap: _legacyBoundaryMarker,
      ...preserved
    } = review
    return {
      ...preserved,
      liveStageId,
      ...(!canonicalPeriod
        ? { legacyPeriodQuarantine: true as const }
        : periodStage === null
          ? { legacyStageBoundaryOverlap: true as const }
          : {}),
      ...(riskSnapshot ? { riskSnapshot } : {}),
    }
  })
}

export function migrateLegacyStageSnapshot(
  raw: LegacyStageSnapshot,
  options: LegacyStageMigrationOptions,
): PersistedSnapshot {
  if (!isValidLiveCycleDayKey(options.currentTradingDayKey)) throw new Error('当前交易日无效')
  if (new Date(options.now).toISOString() !== options.now) throw new Error('迁移时间必须是 ISO 时间点')
  for (const field of [
    'trades',
    'weeklyRiskPreparations',
    'riskPolicyVersions',
    'monthlyRiskLimits',
    'riskOverrideEvents',
  ] as const) {
    if (!Array.isArray(raw[field])) throw new Error(`旧快照 ${field} 必须是数组`)
  }
  if (raw.weeklyReviews !== undefined && !Array.isArray(raw.weeklyReviews)) {
    throw new Error('旧快照 weeklyReviews 必须是数组')
  }
  const startHour = tradingDayStartHour(raw)
  const { liveStages, currentLiveStageId } = buildStages(raw, options)
  const trades = migrateTrades(raw.trades ?? [], liveStages, startHour)
  const riskReferenceStages = new Set<string>()
  let riskReferencesReliable = true
  const topLevelPolicyIds = new Set((raw.riskPolicyVersions ?? []).map((policy) => policy.id))
  const referencedPolicyIds = [
    ...(raw.weeklyRiskPreparations ?? []).map((preparation) => preparation.confirmedPolicyVersionId),
    ...(raw.monthlyRiskLimits ?? []).map((limit) => limit.sourcePolicyVersionId),
    ...(raw.riskOverrideEvents ?? []).map((event) => event.policyVersionId),
  ].filter((policyId): policyId is string => typeof policyId === 'string')
  if (referencedPolicyIds.some((policyId) => !topLevelPolicyIds.has(policyId))) {
    riskReferencesReliable = false
  }
  for (const event of raw.riskOverrideEvents ?? []) {
    const trade = trades.find((candidate) => candidate.id === event.tradeId)
    if (!trade || trade.tradeKind === 'paper' || typeof trade.liveStageId !== 'string') riskReferencesReliable = false
    else riskReferenceStages.add(trade.liveStageId)
  }
  const riskLiveStageId = riskReferencesReliable && riskReferenceStages.size <= 1
    ? [...riskReferenceStages][0] ?? currentLiveStageId
    : null
  const weeklyReviews = migrateWeeklyReviews(
    raw.weeklyReviews ?? [],
    liveStages,
    trades,
    raw.riskPolicyVersions ?? [],
    riskLiveStageId,
  )

  const migrated = {
    ...(raw as unknown as Omit<PersistedSnapshot, 'trades' | 'weeklyReviews' | 'weeklyRiskPreparations' | 'riskPolicyVersions' | 'monthlyRiskLimits' | 'riskOverrideEvents'>),
    trades,
    weeklyReviews,
    weeklyRiskPreparations: (raw.weeklyRiskPreparations ?? []).map((item) => ({ ...item, liveStageId: riskLiveStageId })),
    riskPolicyVersions: (raw.riskPolicyVersions ?? []).map((item) => ({ ...item, liveStageId: riskLiveStageId })),
    monthlyRiskLimits: (raw.monthlyRiskLimits ?? []).map((item) => ({ ...item, liveStageId: riskLiveStageId })),
    riskOverrideEvents: (raw.riskOverrideEvents ?? []).map((item) => ({ ...item, liveStageId: riskLiveStageId })),
    liveStages,
    currentLiveStageId,
    scheduledStageRollover: null,
  }
  delete (migrated as LegacyStageSnapshot).liveStatsStartTradingDayKey
  delete (migrated as LegacyStageSnapshot).livePerformanceCycles
  return migrated
}
