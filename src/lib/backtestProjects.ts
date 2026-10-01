import { formatYmd, parseLocalDate } from '@/lib/periods'
import type { Trade } from '@/data/trades'
import { summarizeTradeResults, resolveTradeTruth } from '@/lib/tradeTruth'

export interface BacktestProject {
  id: string
  name: string
  symbol: string
  startedAt: string
  targetCount: number
  defaultStrategyId: string | null
  rules: string
  archivedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export function projectPath(id: string): string {
  return `/backtests/${encodeURIComponent(id)}`
}

export function backtestProjectIdForPath(pathname: string, trades: readonly Trade[] = []): string | null {
  const match = /^\/backtests\/([^/]+)$/.exec(pathname)
  if (match) { try { return decodeURIComponent(match[1]!) } catch { return null } }
  const detail = /^\/trade\/([^/]+)$/.exec(pathname)
  if (!detail) return null
  const record = trades.find(trade => trade.id === detail[1] || trade.ref === detail[1])
  return record?.tradeKind === 'backtest' ? record.backtestProjectId ?? null : null
}

export function getProjectTrades(trades: readonly Trade[], projectId: string): Trade[] {
  return trades.filter(trade => trade.tradeKind === 'backtest' && trade.backtestProjectId === projectId && !trade.deletedAt)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.ref.localeCompare(b.ref, undefined, { numeric: true }))
}

export function summarizeBacktest(trades: readonly Trade[]) {
  const summary = summarizeTradeResults([...trades])
  const completed = trades.filter(trade => resolveTradeTruth(trade).isResultComplete)
  const validR = completed.filter(trade => typeof trade.rMultiple === 'number' && Number.isFinite(trade.rMultiple))
  return {
    ...summary,
    recordedCount: trades.length,
    pendingCount: trades.filter(trade => resolveTradeTruth(trade).executionState !== 'missed' && !resolveTradeTruth(trade).isResultComplete).length,
    observationCount: trades.filter(trade => trade.status === 'missed').length,
    totalR: validR.reduce((sum, trade) => sum + trade.rMultiple!, 0),
    firstDate: trades[0]?.openedAt.slice(0, 10) ?? null,
    lastDate: trades.at(-1)?.openedAt.slice(0, 10) ?? null,
  }
}

export function isBacktestProject(value: unknown): value is BacktestProject {
  if (!value || typeof value !== 'object') return false
  const p = value as BacktestProject
  return typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 100 &&
    typeof p.symbol === 'string' && p.symbol.trim().length > 0 &&
    typeof p.startedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.startedAt) && formatYmd(parseLocalDate(p.startedAt)) === p.startedAt &&
    Number.isInteger(p.targetCount) && p.targetCount > 0 && p.targetCount <= 100000 &&
    (p.defaultStrategyId === null || typeof p.defaultStrategyId === 'string') &&
    typeof p.rules === 'string' && p.rules.length <= 20000 &&
    (p.archivedAt === null || typeof p.archivedAt === 'string') &&
    (p.completedAt === null || typeof p.completedAt === 'string') &&
    typeof p.createdAt === 'string' && typeof p.updatedAt === 'string'
}
