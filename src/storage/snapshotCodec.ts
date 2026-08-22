import { createDefaultUserProfile } from '@/config/defaultProfile'
import { normalizeQuickNotes } from '@/data/quickNoteCodec'
import { normalizeReviewTemplates } from '@/data/reviewTemplates'
import { normalizeWeeklyReviews } from '@/data/weeklyReviews'
import { normalizeSavedTradeViews } from '@/lib/savedTradeViews'
import { OperationalError } from '@/lib/operationalError'
import { normalizeTradeStrategyReferences } from '@/lib/strategies'
import { isTerminal } from '@/lib/tradeStatus'
import { normalizeSymbolCatalog, normalizeSymbolIcons } from '@/lib/symbolIconCodec'
import { mergeTagPresets } from '@/lib/tags'
import { normalizeDisplay } from '@/lib/tradeFilters'
import { normalizeTrades } from '@/lib/tradeKind'
import { closedTradingDayKeyFromClosedAt } from '@/lib/riskBudget'
import { normalizeTradingDayStartHour } from '@/lib/periods'
import { isValidLiveCycleDayKey } from '@/lib/liveCycle'
import { cloneLivePerformanceCycles } from '@/lib/livePerformanceCycles'
import { migrateLegacyStageSnapshot, type LegacyStageMigrationOptions } from '@/lib/stageMigration'
import { migrateShortcutBindings } from '@/shortcuts/migrate'
import type { ActivePersistedSnapshotKey } from '@/storage/persistedKeys'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import { SCHEMA_VERSION, type PersistedSnapshot } from '@/storage/types'

export type CanonicalSnapshot = {
  [Key in ActivePersistedSnapshotKey]-?: Exclude<PersistedSnapshot[Key], undefined>
}

export interface SnapshotDecodeOptions {
  version: number
  label?: string
  stageMigration?: LegacyStageMigrationOptions
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertSupportedVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) {
    throw new OperationalError(
      'unsupported-future-version',
      `Unsupported snapshot version: ${version}`,
    )
  }
}

function assertSnapshotContract(
  snapshot: PersistedSnapshot,
  label: string,
): void {
  try {
    assertValidPersistedSnapshot(snapshot, label)
  } catch (error) {
    throw new OperationalError(
      'snapshot-contract-invalid',
      error instanceof Error ? error.message : `${label} contract is invalid`,
      error,
    )
  }
}

function migrateHistoricalTrade(value: unknown, version: number): unknown {
  if (!isRecord(value)) return value
  const migrated: Record<string, unknown> = { ...value }
  if (version === 1) {
    const closedAtWasMissing = !Object.prototype.hasOwnProperty.call(value, 'closedAt')
    for (const [field, fallback] of Object.entries({
      tags: [],
      note: '',
      exit: null,
      pnl: null,
      rMultiple: null,
      entry: 0,
      size: 0,
    })) {
      if (migrated[field] === undefined || ((field === 'entry' || field === 'size') && migrated[field] === null)) {
        migrated[field] = fallback
      }
    }
    if (closedAtWasMissing) {
      migrated.closedAt = isTerminal(migrated.status as Parameters<typeof isTerminal>[0])
        ? migrated.openedAt ?? null
        : null
    }
  }
  if (version <= 6) {
    if (migrated.strategyId === undefined && typeof migrated.strategy === 'string') {
      migrated.strategyId = migrated.strategy
    }
    if (migrated.tradeKind === 'practice') migrated.tradeKind = 'paper'
  }
  return migrated
}

function migrateVersionedSnapshot(
  raw: Record<string, unknown>,
  version: number,
): Record<string, unknown> {
  return {
    ...raw,
    trades: Array.isArray(raw.trades)
      ? raw.trades.map((trade) => migrateHistoricalTrade(trade, version))
      : raw.trades,
  }
}

const V9_RISK_FIELDS = [
  'weeklyRiskPreparations',
  'riskPolicyVersions',
  'monthlyRiskLimits',
  'riskOverrideEvents',
] as const

function requireArray(raw: Record<string, unknown>, field: (typeof V9_RISK_FIELDS)[number]): void {
  if (!Object.prototype.hasOwnProperty.call(raw, field)) {
    throw new Error(`缺少必需字段 ${field}`)
  }
  if (!Array.isArray(raw[field])) throw new Error(`必需字段 ${field} 必须是数组`)
}

function decodeVersionedArray(
  raw: Record<string, unknown>,
  field: (typeof V9_RISK_FIELDS)[number],
  version: number,
): unknown[] {
  if (version >= 9) requireArray(raw, field)
  const value = raw[field]
  if (value === undefined && version <= 8) return []
  if (!Array.isArray(value)) throw new Error(`${field} 必须是数组`)
  return value
}

function decodeLiveCycleStart(raw: Record<string, unknown>): string | null {
  const value = raw.liveStatsStartTradingDayKey
  if (value === undefined || value === null) return null
  if (isValidLiveCycleDayKey(value)) return value
  throw new Error('liveStatsStartTradingDayKey 必须是有效交易日或 null')
}

function decodeLivePerformanceCycles(
  raw: Record<string, unknown>,
  version: number,
): unknown[] {
  const value = raw.livePerformanceCycles
  // 周期边界是可选的资料库设置；缺失时保留旧资料库的全历史当前语义。
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('livePerformanceCycles 必须是数组')
  return value
}

function decodeProfile(raw: Record<string, unknown>, version: number): unknown {
  const value = raw.profile
  if (value === undefined || !isRecord(value)) return value
  if (version <= 10 && !Object.prototype.hasOwnProperty.call(value, 'legacyCashCurrencyAssumption')) {
    return { ...value, legacyCashCurrencyAssumption: null }
  }
  return value
}

function defaultStageMigrationOptions(raw: Record<string, unknown>): LegacyStageMigrationOptions {
  const cycles = Array.isArray(raw.livePerformanceCycles)
    ? raw.livePerformanceCycles.filter(isRecord)
    : []
  const latest = cycles.at(-1)
  const explicitBoundary = isValidLiveCycleDayKey(latest?.startTradingDayKey)
    ? latest.startTradingDayKey
    : isValidLiveCycleDayKey(raw.liveStatsStartTradingDayKey)
      ? raw.liveStatsStartTradingDayKey
      : null
  const recordDays = [
    ...(Array.isArray(raw.trades) ? raw.trades : []).flatMap((trade) => {
      if (!isRecord(trade)) return []
      return [trade.closedTradingDayKey, trade.closedAt, trade.openedAt]
        .map((value) => typeof value === 'string' ? value.slice(0, 10) : '')
        .filter(isValidLiveCycleDayKey)
    }),
    ...(Array.isArray(raw.weeklyReviews) ? raw.weeklyReviews : []).flatMap((review) => (
      isRecord(review) && isValidLiveCycleDayKey(review.weekStart) ? [review.weekStart] : []
    )),
  ].sort()
  const latestRecordDay = recordDays.at(-1)
  const inferredCurrentDay = latestRecordDay === undefined
    ? '2000-01-03'
    : (() => {
        const date = new Date(`${latestRecordDay}T00:00:00.000Z`)
        date.setUTCDate(date.getUTCDate() + 1)
        return date.toISOString().slice(0, 10)
      })()
  const currentTradingDayKey = explicitBoundary ?? inferredCurrentDay
  const now = typeof latest?.createdAt === 'string' && !Number.isNaN(Date.parse(latest.createdAt))
    ? new Date(latest.createdAt).toISOString()
    : `${currentTradingDayKey}T00:00:00.000Z`
  return {
    now,
    currentTradingDayKey,
    idFactory: (sequence) => `legacy-live-stage-${sequence}`,
  }
}

function backfillClosedTradingDayKeys(
  value: unknown,
  tradingDayStartHour: unknown,
): unknown {
  if (!Array.isArray(value)) return value
  const startHour = normalizeTradingDayStartHour(tradingDayStartHour)
  return value.map((trade) => {
    if (
      !isRecord(trade) ||
      trade.closedTradingDayKey !== undefined ||
      (trade.tradeKind !== undefined && trade.tradeKind !== 'live') ||
      !(
        trade.status === 'win' ||
        trade.status === 'loss' ||
        trade.status === 'breakeven'
      )
    ) return trade
    const closedAt = trade.closedAt === null || typeof trade.closedAt === 'string'
      ? trade.closedAt
      : null
    const closedTradingDayKey = closedTradingDayKeyFromClosedAt(closedAt, startHour)
    return closedTradingDayKey === null ? trade : { ...trade, closedTradingDayKey }
  })
}

/**
 * 纯快照 codec：处理 legacy v1–v9 迁移与严格 v10 快照的校验、规范化。
 * format envelope、merge/replace 策略以及任何持久化提交均由调用方负责。
 */
export function decodeCanonicalSnapshot(
  value: unknown,
  options: SnapshotDecodeOptions,
): CanonicalSnapshot {
  assertSupportedVersion(options.version)
  if (!isRecord(value)) {
    throw new OperationalError(
      'snapshot-contract-invalid',
      `${options.label ?? 'snapshot'} must be an object`,
    )
  }

  const raw = migrateVersionedSnapshot(value, options.version)
  const strategiesWereMissing = raw.strategies === undefined
  const display = raw.display as Record<string, unknown> | undefined
  const versionedTrades = options.version <= 8
    ? backfillClosedTradingDayKeys(raw.trades, display?.tradingDayStartHour)
    : raw.trades
  const candidate: PersistedSnapshot = {
    trades: (versionedTrades === undefined ? [] : versionedTrades) as PersistedSnapshot['trades'],
    liveStages: raw.liveStages as PersistedSnapshot['liveStages'],
    currentLiveStageId: raw.currentLiveStageId as PersistedSnapshot['currentLiveStageId'],
    scheduledStageRollover: raw.scheduledStageRollover as PersistedSnapshot['scheduledStageRollover'],
    weeklyRiskPreparations: decodeVersionedArray(raw, 'weeklyRiskPreparations', options.version) as PersistedSnapshot['weeklyRiskPreparations'],
    riskPolicyVersions: decodeVersionedArray(raw, 'riskPolicyVersions', options.version) as PersistedSnapshot['riskPolicyVersions'],
    monthlyRiskLimits: decodeVersionedArray(raw, 'monthlyRiskLimits', options.version) as PersistedSnapshot['monthlyRiskLimits'],
    riskOverrideEvents: decodeVersionedArray(raw, 'riskOverrideEvents', options.version) as PersistedSnapshot['riskOverrideEvents'],
    liveStatsStartTradingDayKey: decodeLiveCycleStart(raw),
    livePerformanceCycles: decodeLivePerformanceCycles(raw, options.version) as PersistedSnapshot['livePerformanceCycles'],
    weeklyReviews: (raw.weeklyReviews === undefined ? [] : raw.weeklyReviews) as PersistedSnapshot['weeklyReviews'],
    quickNotes: (raw.quickNotes === undefined ? [] : raw.quickNotes) as PersistedSnapshot['quickNotes'],
    strategies: (raw.strategies === undefined ? [] : raw.strategies) as PersistedSnapshot['strategies'],
    starredIds: (raw.starredIds === undefined ? [] : raw.starredIds) as PersistedSnapshot['starredIds'],
    subscribedIds: (raw.subscribedIds === undefined ? [] : raw.subscribedIds) as PersistedSnapshot['subscribedIds'],
    pinnedStrategyIds: (raw.pinnedStrategyIds === undefined ? [] : raw.pinnedStrategyIds) as PersistedSnapshot['pinnedStrategyIds'],
    display: raw.display as PersistedSnapshot['display'],
    shortcuts: raw.shortcuts as PersistedSnapshot['shortcuts'],
    tagPresets: raw.tagPresets as PersistedSnapshot['tagPresets'],
    mistakeTagPresets: raw.mistakeTagPresets as PersistedSnapshot['mistakeTagPresets'],
    profile: decodeProfile(raw, options.version) as PersistedSnapshot['profile'],
    savedTradeViews: raw.savedTradeViews as PersistedSnapshot['savedTradeViews'],
    symbolIcons: raw.symbolIcons as PersistedSnapshot['symbolIcons'],
    symbolCatalog: raw.symbolCatalog as PersistedSnapshot['symbolCatalog'],
    reviewTemplates: raw.reviewTemplates as PersistedSnapshot['reviewTemplates'],
  }
  const stagedCandidate = options.version <= 11
    ? migrateLegacyStageSnapshot(
        candidate as unknown as Record<string, unknown>,
        options.stageMigration ?? defaultStageMigrationOptions(raw),
      )
    : candidate
  assertSnapshotContract(stagedCandidate, options.label ?? 'snapshot')

  const normalizedRelations = normalizeTradeStrategyReferences(
    stagedCandidate.trades,
    strategiesWereMissing ? undefined : stagedCandidate.strategies,
  )
  const trades = normalizeTrades(normalizedRelations.trades)
  const symbolIcons = normalizeSymbolIcons(candidate.symbolIcons)
  const symbolCatalogSource = candidate.symbolCatalog === undefined
    ? [...Object.keys(symbolIcons), ...trades.map((trade) => trade.symbol)]
    : candidate.symbolCatalog

  const normalized: CanonicalSnapshot = {
    trades,
    liveStages: stagedCandidate.liveStages.map((stage) => ({ ...stage })),
    currentLiveStageId: stagedCandidate.currentLiveStageId,
    scheduledStageRollover: stagedCandidate.scheduledStageRollover
      ? { ...stagedCandidate.scheduledStageRollover }
      : null,
    weeklyRiskPreparations: stagedCandidate.weeklyRiskPreparations.map((item) => ({
      ...item,
      draft: { ...item.draft },
    })),
    riskPolicyVersions: stagedCandidate.riskPolicyVersions.map((item) => ({ ...item })),
    monthlyRiskLimits: stagedCandidate.monthlyRiskLimits.map((item) => ({ ...item })),
    riskOverrideEvents: stagedCandidate.riskOverrideEvents.map((item) => ({
      ...item,
      tradeIdentityAtDecision: { ...item.tradeIdentityAtDecision },
      outcomesAtDecision: {
        day: { ...item.outcomesAtDecision.day, unknownReasons: [...item.outcomesAtDecision.day.unknownReasons] },
        week: { ...item.outcomesAtDecision.week, unknownReasons: [...item.outcomesAtDecision.week.unknownReasons] },
        month: { ...item.outcomesAtDecision.month, unknownReasons: [...item.outcomesAtDecision.month.unknownReasons] },
      },
      unknownReasons: [...item.unknownReasons],
    })),
    liveStatsStartTradingDayKey: stagedCandidate.liveStatsStartTradingDayKey ?? null,
    livePerformanceCycles: cloneLivePerformanceCycles(stagedCandidate.livePerformanceCycles),
    weeklyReviews: normalizeWeeklyReviews(stagedCandidate.weeklyReviews),
    quickNotes: normalizeQuickNotes(stagedCandidate.quickNotes),
    strategies: normalizedRelations.strategies,
    starredIds: [...stagedCandidate.starredIds],
    subscribedIds: [...stagedCandidate.subscribedIds],
    pinnedStrategyIds: [...stagedCandidate.pinnedStrategyIds],
    display: normalizeDisplay(stagedCandidate.display),
    shortcuts: migrateShortcutBindings(stagedCandidate.shortcuts),
    tagPresets: mergeTagPresets(stagedCandidate.tagPresets),
    mistakeTagPresets: mergeTagPresets(stagedCandidate.mistakeTagPresets),
    profile: stagedCandidate.profile
      ? {
          ...stagedCandidate.profile,
          legacyCashCurrencyAssumption: stagedCandidate.profile.legacyCashCurrencyAssumption
            ? { ...stagedCandidate.profile.legacyCashCurrencyAssumption }
            : null,
        }
      : createDefaultUserProfile(),
    savedTradeViews: normalizeSavedTradeViews(stagedCandidate.savedTradeViews),
    symbolIcons,
    symbolCatalog: normalizeSymbolCatalog(symbolCatalogSource),
    reviewTemplates: normalizeReviewTemplates(stagedCandidate.reviewTemplates),
  }
  assertSnapshotContract(normalized, options.label ?? 'snapshot')
  return normalized
}
