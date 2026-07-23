import { createDefaultUserProfile } from '@/config/defaultProfile'
import { normalizeQuickNotes } from '@/data/quickNoteCodec'
import { normalizeReviewTemplates } from '@/data/reviewTemplates'
import { normalizeWeeklyReviews } from '@/data/weeklyReviews'
import { normalizeSavedTradeViews } from '@/lib/savedTradeViews'
import { normalizeTradeStrategyReferences } from '@/lib/strategies'
import { normalizeSymbolCatalog, normalizeSymbolIcons } from '@/lib/symbolIconCodec'
import { mergeTagPresets } from '@/lib/tags'
import { normalizeDisplay } from '@/lib/tradeFilters'
import { normalizeTrades } from '@/lib/tradeKind'
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertSupportedVersion(version: number): void {
  if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) {
    throw new Error(`Unsupported snapshot version: ${version}`)
  }
}

function migrateHistoricalTrade(value: unknown, version: number): unknown {
  if (!isRecord(value)) return value
  const migrated: Record<string, unknown> = { ...value }
  if (version === 1) {
    for (const [field, fallback] of Object.entries({
      tags: [],
      note: '',
      exit: null,
      pnl: null,
      rMultiple: null,
      closedAt: null,
      entry: 0,
      size: 0,
    })) {
      if (migrated[field] === undefined || ((field === 'entry' || field === 'size') && migrated[field] === null)) {
        migrated[field] = fallback
      }
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

/**
 * 纯快照 codec：只处理 v1–v8 原始字段到完整 CanonicalSnapshot 的迁移、校验与规范化。
 * format envelope、merge/replace 策略以及任何持久化提交均由调用方负责。
 */
export function decodeCanonicalSnapshot(
  value: unknown,
  options: SnapshotDecodeOptions,
): CanonicalSnapshot {
  assertSupportedVersion(options.version)
  if (!isRecord(value)) throw new Error(`${options.label ?? 'snapshot'} must be an object`)

  const raw = migrateVersionedSnapshot(value, options.version)
  const strategiesWereMissing = raw.strategies === undefined
  const candidate: PersistedSnapshot = {
    trades: (raw.trades === undefined ? [] : raw.trades) as PersistedSnapshot['trades'],
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
    profile: raw.profile as PersistedSnapshot['profile'],
    savedTradeViews: raw.savedTradeViews as PersistedSnapshot['savedTradeViews'],
    symbolIcons: raw.symbolIcons as PersistedSnapshot['symbolIcons'],
    symbolCatalog: raw.symbolCatalog as PersistedSnapshot['symbolCatalog'],
    reviewTemplates: raw.reviewTemplates as PersistedSnapshot['reviewTemplates'],
  }
  assertValidPersistedSnapshot(candidate, options.label ?? 'snapshot')

  const normalizedRelations = normalizeTradeStrategyReferences(
    candidate.trades,
    strategiesWereMissing ? undefined : candidate.strategies,
  )
  const trades = normalizeTrades(normalizedRelations.trades)
  const symbolIcons = normalizeSymbolIcons(candidate.symbolIcons)
  const symbolCatalogSource = candidate.symbolCatalog === undefined
    ? [...Object.keys(symbolIcons), ...trades.map((trade) => trade.symbol)]
    : candidate.symbolCatalog

  const normalized: CanonicalSnapshot = {
    trades,
    weeklyReviews: normalizeWeeklyReviews(candidate.weeklyReviews),
    quickNotes: normalizeQuickNotes(candidate.quickNotes),
    strategies: normalizedRelations.strategies,
    starredIds: [...candidate.starredIds],
    subscribedIds: [...candidate.subscribedIds],
    pinnedStrategyIds: [...candidate.pinnedStrategyIds],
    display: normalizeDisplay(candidate.display),
    shortcuts: migrateShortcutBindings(candidate.shortcuts),
    tagPresets: mergeTagPresets(candidate.tagPresets),
    mistakeTagPresets: mergeTagPresets(candidate.mistakeTagPresets),
    profile: candidate.profile ? { ...candidate.profile } : createDefaultUserProfile(),
    savedTradeViews: normalizeSavedTradeViews(candidate.savedTradeViews),
    symbolIcons,
    symbolCatalog: normalizeSymbolCatalog(symbolCatalogSource),
    reviewTemplates: normalizeReviewTemplates(candidate.reviewTemplates),
  }
  assertValidPersistedSnapshot(normalized, options.label ?? 'snapshot')
  return normalized
}
