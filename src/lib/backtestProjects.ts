import { isCalendarDay } from '@/lib/calendarDay'
import type { Trade } from '@/data/trades'
import { TradeResultAccumulator, resolveTradeTruth } from '@/lib/tradeTruth'

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

/** 首笔样本锁定的测试条件；项目名称、目标和归档状态仍可调整。 */
export function hasSameBacktestRules(left: BacktestProject, right: BacktestProject): boolean {
  return left.symbol === right.symbol && left.startedAt === right.startedAt && left.rules === right.rules
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

const refOrder = new Intl.Collator(undefined, { numeric: true })

function compareProjectTrades(a: Trade, b: Trade): number {
  return a.openedAt.localeCompare(b.openedAt) || refOrder.compare(a.ref, b.ref)
}

export function getProjectTrades(trades: readonly Trade[], projectId: string): Trade[] {
  return trades.filter(trade => trade.tradeKind === 'backtest' && trade.backtestProjectId === projectId && !trade.deletedAt)
    .sort(compareProjectTrades)
}

export function summarizeBacktest(trades: readonly Trade[]) {
  const results = new TradeResultAccumulator()
  let pendingCount = 0
  let observationCount = 0
  let totalR = 0
  for (const trade of trades) {
    const truth = resolveTradeTruth(trade)
    results.add(trade, truth)
    if (truth.executionState !== 'missed' && !truth.isResultComplete) pendingCount += 1
    if (trade.status === 'missed') observationCount += 1
    if (truth.isResultComplete && typeof trade.rMultiple === 'number' && Number.isFinite(trade.rMultiple)) {
      totalR += trade.rMultiple
    }
  }
  return {
    ...results.summarize(),
    recordedCount: trades.length,
    pendingCount,
    observationCount,
    totalR,
    firstDate: trades[0]?.openedAt.slice(0, 10) ?? null,
    lastDate: trades.at(-1)?.openedAt.slice(0, 10) ?? null,
  }
}

/** 总览按项目一次分组；项目内沿用历史顺序，保证浮点汇总和详情统计相同。 */
export function summarizeBacktestProjects(trades: readonly Trade[], projectIds?: readonly string[]): Map<string, ReturnType<typeof summarizeBacktest>> {
  if (projectIds?.length === 0) return new Map()
  const allowedProjects = projectIds ? new Set(projectIds) : null
  const grouped = new Map<string, Trade[]>()
  for (const trade of trades) {
    if (trade.tradeKind !== 'backtest' || !trade.backtestProjectId || trade.deletedAt) continue
    if (allowedProjects && !allowedProjects.has(trade.backtestProjectId)) continue
    const records = grouped.get(trade.backtestProjectId)
    if (records) records.push(trade)
    else grouped.set(trade.backtestProjectId, [trade])
  }
  const summaries = new Map<string, ReturnType<typeof summarizeBacktest>>()
  for (const [projectId, records] of grouped) {
    records.sort(compareProjectTrades)
    summaries.set(projectId, summarizeBacktest(records))
  }
  return summaries
}

export function isBacktestProject(value: unknown): value is BacktestProject {
  if (!value || typeof value !== 'object') return false
  const p = value as BacktestProject
  return typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 100 &&
    typeof p.symbol === 'string' && p.symbol.trim().length > 0 &&
    isCalendarDay(p.startedAt) &&
    Number.isInteger(p.targetCount) && p.targetCount > 0 && p.targetCount <= 100000 &&
    (p.defaultStrategyId === null || typeof p.defaultStrategyId === 'string') &&
    typeof p.rules === 'string' && p.rules.length <= 20000 &&
    (p.archivedAt === null || typeof p.archivedAt === 'string') &&
    (p.completedAt === null || typeof p.completedAt === 'string') &&
    typeof p.createdAt === 'string' && typeof p.updatedAt === 'string'
}
