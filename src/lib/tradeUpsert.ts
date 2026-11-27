import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { createDefaultStrategies } from '@/config/defaultProfile'
import { appendActivity, createActivity } from '@/lib/activities'
import { DEFAULT_TRADING_DAY_START_HOUR } from '@/lib/periods'
import { syncReviewCaseSourceNotes } from '@/lib/reviewCaseSources'
import { closedTradingDayKeyFromClosedAt } from '@/lib/riskBudget'
import { normalizeSelectableSymbolCatalog, normalizeSymbol } from '@/lib/symbolIconCodec'
import { assignTradeStage, normalizeTradeFields } from '@/lib/tradeKind'
import { reconcileExistingExecutionEdit, reopenReviewAfterResultChange } from '@/lib/tradeResult'
import { isExecutedClosed } from '@/lib/tradeStatus'

export type TradeUpsertSlice = {
  trades: Trade[]
  strategies: Strategy[]
  symbolCatalog: string[]
}

function freezeUpsertedClosedTradingDay(
  previous: Trade | undefined,
  trade: Trade,
  tradingDayStartHour: number,
): Trade {
  if (trade.tradeKind !== 'live' || !isExecutedClosed(trade.status)) return trade
  const shouldCalculate =
    !previous ||
    !isExecutedClosed(previous.status) ||
    previous.closedTradingDayKey === undefined ||
    previous.closedAt !== trade.closedAt
  if (!shouldCalculate) {
    return { ...trade, closedTradingDayKey: previous.closedTradingDayKey }
  }
  return {
    ...trade,
    closedTradingDayKey:
      closedTradingDayKeyFromClosedAt(trade.closedAt, tradingDayStartHour) ?? undefined,
  }
}

function prepareTradeUpsert(
  s: Pick<TradeUpsertSlice, 'strategies' | 'symbolCatalog'>,
  trade: Trade,
  previousTrade: Trade | undefined,
  tradingDayStartHour: number,
  currentLiveStageId: string | (() => string) | undefined,
): { trade: Trade; strategies: Strategy[]; symbolCatalog: string[] } | null {
  if (previousTrade && (trade.tradeKind ?? 'live') !== previousTrade.tradeKind) return null
  if (previousTrade?.tradeKind === 'backtest' && (previousTrade.backtestProjectId !== trade.backtestProjectId || previousTrade.symbol !== trade.symbol)) return null
  const incomingStage = 'liveStageId' in trade ? trade.liveStageId : undefined
  const stage = previousTrade
    ? ('liveStageId' in previousTrade ? previousTrade.liveStageId : undefined)
    : currentLiveStageId ?? incomingStage
  trade = assignTradeStage(trade, stage)
  const strategies = s.strategies.length > 0 ? s.strategies : createDefaultStrategies()
  const strategyId = strategies.some((strategy) => strategy.id === trade.strategyId)
    ? trade.strategyId
    : strategies[0]?.id ?? 'uncategorized'
  let normalized = normalizeTradeFields({
    ...trade,
    strategyId,
    tradeKind: trade.tradeKind ?? 'live',
    comments: trade.comments ?? [],
  })
  normalized = freezeUpsertedClosedTradingDay(previousTrade, normalized, tradingDayStartHour)
  if (previousTrade) {
    normalized = reopenReviewAfterResultChange(
      previousTrade,
      reconcileExistingExecutionEdit(previousTrade, normalized),
    )
  }
  const symbolKey = normalizeSymbol(normalized.symbol)
  const symbolCatalog =
    !previousTrade && symbolKey && !s.symbolCatalog.includes(symbolKey)
      ? normalizeSelectableSymbolCatalog([...s.symbolCatalog, symbolKey])
      : s.symbolCatalog
  if (!previousTrade) {
    return {
      trade: createActivity(normalized),
      strategies,
      symbolCatalog,
    }
  }
  if (previousTrade.status !== normalized.status) {
    normalized = appendActivity(normalized, {
      kind: 'status',
      status: normalized.status,
      timestamp: new Date().toISOString(),
    })
  }
  return {
    trade: normalized,
    strategies,
    symbolCatalog,
  }
}

/** 只生成交易、策略与品种的更新，供即时编辑和先落盘的批次共用。 */
export function applyTradeUpsertsToSlice(
  initial: TradeUpsertSlice,
  trades: readonly Trade[],
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
  currentLiveStageId?: string | (() => string),
): TradeUpsertSlice {
  if (trades.length === 0) return initial
  // 单条编辑无需索引整个资料库。重复输入依次读取上一次更新的结果。
  const byId = new Map<string, Trade>()
  if (trades.length === 1) {
    const existing = initial.trades.find(candidate => candidate.id === trades[0]!.id)
    if (existing) byId.set(existing.id, existing)
  } else {
    for (const trade of initial.trades) {
      if (!byId.has(trade.id)) byId.set(trade.id, trade)
    }
  }
  const addedIds: string[] = []
  const replacements = new Map<string, Trade>()
  let strategies = initial.strategies
  let symbolCatalog = initial.symbolCatalog
  for (const trade of trades) {
    const existing = byId.get(trade.id)
    const prepared = prepareTradeUpsert({ strategies, symbolCatalog }, trade, existing, tradingDayStartHour, currentLiveStageId)
    if (!prepared) continue
    if (!existing) addedIds.push(trade.id)
    else replacements.set(trade.id, prepared.trade)
    byId.set(trade.id, prepared.trade)
    strategies = prepared.strategies
    symbolCatalog = prepared.symbolCatalog
  }
  if (addedIds.length === 0 && replacements.size === 0) return initial
  const existingTrades = replacements.size === 0
    ? initial.trades
    : initial.trades.map((trade) => replacements.get(trade.id) ?? trade)
  return {
    trades: syncReviewCaseSourceNotes(addedIds.length === 0
      ? existingTrades
      : [...addedIds.reverse().map((id) => byId.get(id)!), ...existingTrades]),
    strategies,
    symbolCatalog,
  }
}
