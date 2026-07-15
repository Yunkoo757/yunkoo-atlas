import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import type { PersistedSnapshot } from '@/storage/types'

export type MetricOrigin = 'manual' | 'calculated' | 'imported' | 'legacy'
export type PnlBasis = 'unknown' | 'net'
export type PnlCurrencySource = 'manual' | 'imported' | 'inferred' | 'legacy'
export type RuleAdherence = 'followed' | 'deviated' | 'unknown'
export type ExitReason = 'target' | 'stop' | 'manual' | 'time' | 'rule' | 'other'

export interface TradeCostsV7 {
  commission: number | null
  exchange: number | null
  financing: number | null
  tax: number | null
  other: number | null
  completeness: 'partial' | 'complete'
  source?: 'manual' | 'imported'
}

export type TradeV7 = Omit<Trade, 'entry' | 'size'> & {
  entry: number | null
  size: number | null
  grossPnl?: number | null
  pnlBasis: PnlBasis
  pnlCurrency: string | null
  pnlCurrencySource: PnlCurrencySource | null
  costs?: TradeCostsV7
  slippageCost?: number | null
  initialRiskAmount?: number | null
  initialRiskPct?: number | null
  accountEquityAtEntry?: number | null
  openedAtTimestamp: string | null
  closedAtTimestamp: string | null
  ruleAdherence?: RuleAdherence
  exitReason?: ExitReason
  strategyVersionId: string | null
  pnlSource: MetricOrigin | null
  rSource: MetricOrigin | null
}

export interface StrategyVersionV7 {
  id: string
  strategyId: string
  version: number
  label: string
  rulesHtml?: string
  reviewTemplateHtml?: string
  changeNote?: string
  createdAt: string | null
  retiredAt?: string | null
}

export type StrategyV7 = Strategy & {
  currentVersionId: string
  archivedAt?: string | null
}

export type PersistedSnapshotV7 = Omit<PersistedSnapshot, 'trades' | 'strategies'> & {
  schemaVersion: 7
  reportingTimeZone: string | null
  trades: TradeV7[]
  strategies: StrategyV7[]
  strategyVersions: StrategyVersionV7[]
}

const TRADE_SIDES = new Set(['long', 'short'])
const TRADE_STATUSES = new Set(['planned', 'open', 'missed', 'win', 'loss', 'breakeven'])
const TRADE_KINDS = new Set(['live', 'paper', 'case'])
const CONVICTIONS = new Set(['low', 'medium', 'high', 'urgent'])
const METRIC_ORIGINS = new Set<MetricOrigin>(['manual', 'calculated', 'imported', 'legacy'])
const CURRENCY_SOURCES = new Set<PnlCurrencySource>(['manual', 'imported', 'inferred', 'legacy'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableFinite(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isOptionalNullableFinite(value: unknown): boolean {
  return value === undefined || isNullableFinite(value)
}

function isPositiveWhenPresent(value: unknown): boolean {
  return value === undefined || value === null || (
    typeof value === 'number' && Number.isFinite(value) && value > 0
  )
}

function isCurrency(value: unknown): boolean {
  return value === null || (typeof value === 'string' && /^[A-Z]{3}$/.test(value))
}

function isCosts(value: unknown): value is TradeCostsV7 {
  if (!isRecord(value)) return false
  if (value.completeness !== 'partial' && value.completeness !== 'complete') return false
  if (value.source !== undefined && value.source !== 'manual' && value.source !== 'imported') return false
  const fields = ['commission', 'exchange', 'financing', 'tax', 'other'] as const
  for (const field of fields) {
    const amount = value[field]
    if (!isNullableFinite(amount) || (typeof amount === 'number' && amount < 0)) return false
    if (value.completeness === 'complete' && typeof amount !== 'number') return false
  }
  return true
}

function hasConsistentRisk(trade: Record<string, unknown>): boolean {
  const risk = trade.initialRiskAmount
  const pct = trade.initialRiskPct
  const equity = trade.accountEquityAtEntry
  if (!isPositiveWhenPresent(risk) || !isPositiveWhenPresent(pct) || !isPositiveWhenPresent(equity)) {
    return false
  }
  if (typeof risk !== 'number' || typeof pct !== 'number' || typeof equity !== 'number') return true
  const expectedPct = (risk / equity) * 100
  return Math.abs(pct - expectedPct) <= Math.abs(expectedPct) * 0.01
}

function assertValidTradeV7(
  value: unknown,
  strategyVersions: ReadonlyMap<string, StrategyVersionV7>,
  label: string,
): asserts value is TradeV7 {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  if (
    typeof value.id !== 'string' ||
    typeof value.ref !== 'string' ||
    typeof value.symbol !== 'string' ||
    typeof value.strategyId !== 'string' ||
    typeof value.openedAt !== 'string' ||
    (value.closedAt !== null && typeof value.closedAt !== 'string') ||
    !TRADE_SIDES.has(String(value.side)) ||
    !TRADE_STATUSES.has(String(value.status)) ||
    !TRADE_KINDS.has(String(value.tradeKind)) ||
    !CONVICTIONS.has(String(value.conviction))
  ) throw new Error(`${label} has invalid core fields`)
  for (const field of ['entry', 'size', 'exit', 'pnl', 'rMultiple'] as const) {
    if (!isNullableFinite(value[field])) throw new Error(`${label}.${field} must be finite or null`)
  }
  for (const field of ['grossPnl', 'slippageCost'] as const) {
    if (!isOptionalNullableFinite(value[field])) throw new Error(`${label}.${field} must be finite or null`)
  }
  if (typeof value.slippageCost === 'number' && value.slippageCost < 0) {
    throw new Error(`${label}.slippageCost cannot be negative`)
  }
  if (!hasConsistentRisk(value)) throw new Error(`${label} has invalid risk fields`)
  if (value.pnlBasis !== 'unknown' && value.pnlBasis !== 'net') {
    throw new Error(`${label}.pnlBasis is invalid`)
  }
  if (!isCurrency(value.pnlCurrency)) throw new Error(`${label}.pnlCurrency is invalid`)
  if (
    value.pnlCurrencySource !== null &&
    !CURRENCY_SOURCES.has(value.pnlCurrencySource as PnlCurrencySource)
  ) throw new Error(`${label}.pnlCurrencySource is invalid`)
  if ((value.pnlCurrency === null) !== (value.pnlCurrencySource === null)) {
    throw new Error(`${label}.pnlCurrencySource must match currency presence`)
  }
  for (const field of ['pnlSource', 'rSource'] as const) {
    if (value[field] !== null && !METRIC_ORIGINS.has(value[field] as MetricOrigin)) {
      throw new Error(`${label}.${field} is invalid`)
    }
  }
  if (value.costs !== undefined && !isCosts(value.costs)) {
    throw new Error(`${label}.costs is invalid`)
  }
  if (
    typeof value.grossPnl === 'number' &&
    typeof value.pnl === 'number' &&
    value.pnlBasis === 'net' &&
    isRecord(value.costs) &&
    value.costs.completeness === 'complete'
  ) {
    const completeCosts = value.costs
    const explicitCosts = (['commission', 'exchange', 'financing', 'tax', 'other'] as const)
      .reduce((sum, field) => sum + Number(completeCosts[field]), 0)
    const expectedNet = value.grossPnl - explicitCosts
    const tolerance = Math.max(0.01, Math.abs(expectedNet) * 0.0001)
    if (Math.abs(value.pnl - expectedNet) > tolerance) {
      throw new Error(`${label}.grossPnl and complete costs do not match net pnl`)
    }
  }
  if (value.openedAtTimestamp !== null && typeof value.openedAtTimestamp !== 'string') {
    throw new Error(`${label}.openedAtTimestamp is invalid`)
  }
  if (value.closedAtTimestamp !== null && typeof value.closedAtTimestamp !== 'string') {
    throw new Error(`${label}.closedAtTimestamp is invalid`)
  }
  if (value.strategyVersionId !== null) {
    if (typeof value.strategyVersionId !== 'string') {
      throw new Error(`${label}.strategyVersionId is invalid`)
    }
    const version = strategyVersions.get(value.strategyVersionId)
    if (!version || version.strategyId !== value.strategyId) {
      throw new Error(`${label}.strategyVersionId does not belong to its strategy`)
    }
  }
}

export function assertValidV7Snapshot(
  value: unknown,
  label = 'snapshot',
): asserts value is PersistedSnapshotV7 {
  if (!isRecord(value) || value.schemaVersion !== 7) {
    throw new Error(`${label}.schemaVersion must be 7`)
  }
  if (value.reportingTimeZone !== null && typeof value.reportingTimeZone !== 'string') {
    throw new Error(`${label}.reportingTimeZone must be a string or null`)
  }
  if (!Array.isArray(value.trades) || !Array.isArray(value.strategies) || !Array.isArray(value.strategyVersions)) {
    throw new Error(`${label} is missing v7 collections`)
  }

  const strategyIds = new Set<string>()
  for (const [index, strategy] of value.strategies.entries()) {
    if (!isRecord(strategy) || typeof strategy.id !== 'string' || typeof strategy.name !== 'string') {
      throw new Error(`${label}.strategies[${index}] is invalid`)
    }
    if (strategyIds.has(strategy.id)) throw new Error(`${label} has duplicate strategy IDs`)
    strategyIds.add(strategy.id)
  }

  const versions = new Map<string, StrategyVersionV7>()
  const versionNumbers = new Set<string>()
  for (const [index, rawVersion] of value.strategyVersions.entries()) {
    if (
      !isRecord(rawVersion) ||
      typeof rawVersion.id !== 'string' ||
      typeof rawVersion.strategyId !== 'string' ||
      !Number.isInteger(rawVersion.version) ||
      Number(rawVersion.version) < 1 ||
      typeof rawVersion.label !== 'string' ||
      rawVersion.createdAt !== null && typeof rawVersion.createdAt !== 'string'
    ) throw new Error(`${label}.strategyVersions[${index}] is invalid`)
    if (!strategyIds.has(rawVersion.strategyId)) {
      throw new Error(`${label}.strategyVersions[${index}] has a missing strategy`)
    }
    if (versions.has(rawVersion.id)) throw new Error(`${label} has duplicate strategy version IDs`)
    const versionKey = `${rawVersion.strategyId}:${rawVersion.version}`
    if (versionNumbers.has(versionKey)) throw new Error(`${label} has duplicate strategy version numbers`)
    versions.set(rawVersion.id, rawVersion as unknown as StrategyVersionV7)
    versionNumbers.add(versionKey)
  }

  for (const [index, rawStrategy] of value.strategies.entries()) {
    const strategy = rawStrategy as Record<string, unknown>
    if (typeof strategy.currentVersionId !== 'string') {
      throw new Error(`${label}.strategies[${index}].currentVersionId is invalid`)
    }
    const currentVersion = versions.get(strategy.currentVersionId)
    if (!currentVersion || currentVersion.strategyId !== strategy.id) {
      throw new Error(`${label}.strategies[${index}].currentVersionId does not belong to the strategy`)
    }
  }

  value.trades.forEach((trade, index) => {
    assertValidTradeV7(trade, versions, `${label}.trades[${index}]`)
  })
}
