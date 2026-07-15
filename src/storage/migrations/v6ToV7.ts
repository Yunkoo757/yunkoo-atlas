import type { Trade } from '@/data/trades'
import type { PersistedSnapshot } from '@/storage/types'
import type {
  MetricOrigin,
  PersistedSnapshotV7,
  PnlCurrencySource,
  StrategyV7,
  StrategyVersionV7,
  TradeV7,
} from '@/storage/schemaV7'

export type V7MigrationDiagnosticCode =
  | 'placeholder-pnl-zero'
  | 'placeholder-r-zero'
  | 'missing-strategy-version'
  | 'invalid-legacy-currency'
  | 'invalid-timestamp'

export interface V7MigrationDiagnostic {
  tradeId: string
  code: V7MigrationDiagnosticCode
}

export interface V6ToV7MigrationResult {
  snapshot: PersistedSnapshotV7
  diagnostics: V7MigrationDiagnostic[]
}

type LegacyTradeExtensions = {
  pnlCurrency?: unknown
  openedAtTimestamp?: unknown
  closedAtTimestamp?: unknown
}

function finiteOrNull(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function migrateDateEvidence(
  value: string | null,
  existingTimestamp: unknown,
  diagnostics: V7MigrationDiagnostic[],
  tradeId: string,
): { date: string | null; timestamp: string | null } {
  const candidate = typeof existingTimestamp === 'string' && Number.isFinite(Date.parse(existingTimestamp))
    ? existingTimestamp
    : null
  if (existingTimestamp !== undefined && candidate === null) {
    diagnostics.push({ tradeId, code: 'invalid-timestamp' })
  }
  if (value === null) {
    return {
      date: null,
      timestamp: candidate,
    }
  }
  const datePrefix = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? value
  const timestamp = candidate && candidate.startsWith(datePrefix)
    ? candidate
    : value.length > 10
      ? value
      : null
  if (candidate && !candidate.startsWith(datePrefix)) {
    diagnostics.push({ tradeId, code: 'invalid-timestamp' })
  }
  return { date: datePrefix, timestamp }
}

function migrateCurrency(
  rawCurrency: unknown,
  pnl: number | null,
  diagnostics: V7MigrationDiagnostic[],
  tradeId: string,
): { currency: string | null; source: PnlCurrencySource | null } {
  if (typeof rawCurrency === 'string' && /^[A-Z]{3}$/.test(rawCurrency)) {
    return { currency: rawCurrency, source: 'legacy' }
  }
  if (rawCurrency !== undefined && rawCurrency !== null && rawCurrency !== '') {
    diagnostics.push({ tradeId, code: 'invalid-legacy-currency' })
    return { currency: null, source: null }
  }
  if (pnl !== null) return { currency: 'USD', source: 'inferred' }
  return { currency: null, source: null }
}

function legacyMetricOrigin(value: number | null): MetricOrigin | null {
  return value === null ? null : 'legacy'
}

export function migrateV6ToV7(source: PersistedSnapshot): V6ToV7MigrationResult {
  const raw = structuredClone(source)
  const diagnostics: V7MigrationDiagnostic[] = []
  const strategyVersionByStrategy = new Map<string, string>()

  const strategies: StrategyV7[] = raw.strategies.map((strategy) => {
    const currentVersionId = `${strategy.id}:v1`
    strategyVersionByStrategy.set(strategy.id, currentVersionId)
    return { ...strategy, currentVersionId }
  })
  const strategyVersions: StrategyVersionV7[] = raw.strategies.map((strategy) => ({
    id: `${strategy.id}:v1`,
    strategyId: strategy.id,
    version: 1,
    label: 'v1',
    rulesHtml: '',
    reviewTemplateHtml: strategy.reviewTemplateHtml ?? '',
    createdAt: null,
  }))

  const trades: TradeV7[] = raw.trades.map((trade) => {
    const legacy = trade as Trade & LegacyTradeExtensions
    const entry = trade.entry === 0 ? null : finiteOrNull(trade.entry)
    const size = trade.size === 0 ? null : finiteOrNull(trade.size)
    let pnl = finiteOrNull(trade.pnl)
    let rMultiple = finiteOrNull(trade.rMultiple)
    if (trade.status !== 'breakeven' && pnl === 0) {
      pnl = null
      diagnostics.push({ tradeId: trade.id, code: 'placeholder-pnl-zero' })
    }
    if (trade.status !== 'breakeven' && rMultiple === 0) {
      rMultiple = null
      diagnostics.push({ tradeId: trade.id, code: 'placeholder-r-zero' })
    }

    const opened = migrateDateEvidence(trade.openedAt, legacy.openedAtTimestamp, diagnostics, trade.id)
    const closed = migrateDateEvidence(trade.closedAt, legacy.closedAtTimestamp, diagnostics, trade.id)
    const currency = migrateCurrency(legacy.pnlCurrency, pnl, diagnostics, trade.id)
    const strategyVersionId = strategyVersionByStrategy.get(trade.strategyId) ?? null
    if (strategyVersionId === null && trade.strategyId) {
      throw new Error(`trade ${trade.id} references missing strategy ${trade.strategyId}`)
    }

    return {
      ...trade,
      entry,
      size,
      pnl,
      rMultiple,
      openedAt: opened.date ?? trade.openedAt,
      closedAt: closed.date,
      openedAtTimestamp: opened.timestamp,
      closedAtTimestamp: closed.timestamp,
      pnlBasis: 'unknown',
      pnlCurrency: currency.currency,
      pnlCurrencySource: currency.source,
      strategyVersionId,
      pnlSource: legacyMetricOrigin(pnl),
      rSource: legacyMetricOrigin(rMultiple),
    }
  })

  return {
    snapshot: {
      ...raw,
      schemaVersion: 7,
      reportingTimeZone: null,
      trades,
      strategies,
      strategyVersions,
    },
    diagnostics,
  }
}
