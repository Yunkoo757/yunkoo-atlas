import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { resolveTimeframe } from '@/data/trades'
import { getStrategyName } from '@/lib/strategies'
import { resolveTradeTruth } from '@/lib/tradeTruth'

export interface TradeTableRow {
  ref: string
  date: string
  symbol: string
  timeframe: string
  model: string
  confluences: string[]
  entrySignal: string
  position: 'Buy' | 'Sell'
  status: string
  pnl: string
  rMultiple: string
  result: 'Profit' | 'Loss' | 'Breakeven' | 'Pending'
  mistakes: string[]
}

function formatTableDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, '/')
}

function formatUsd(value: number | null): string {
  if (value == null) return '—'
  const sign = value < 0 ? '-' : ''
  return `${sign}US$${Math.abs(value).toFixed(2)}`
}

function tableStatus(trade: Trade): string {
  if (trade.status === 'win') return 'Closed by T/P'
  if (trade.status === 'loss') return 'Closed by S/L'
  if (trade.status === 'missed') return 'MISS'
  if (trade.status === 'open') return 'Open'
  if (trade.status === 'breakeven') return 'Breakeven'
  return 'Planned'
}

function tableResult(trade: Trade): TradeTableRow['result'] {
  const outcome = resolveTradeTruth(trade).outcome
  if (outcome === 'win') return 'Profit'
  if (outcome === 'loss') return 'Loss'
  if (outcome === 'breakeven') return 'Breakeven'
  return 'Pending'
}

export function buildTradeTableRow(trade: Trade, strategies: Strategy[]): TradeTableRow {
  return {
    ref: trade.ref,
    date: formatTableDate(trade.openedAt),
    symbol: trade.symbol,
    timeframe: resolveTimeframe(trade.timeframe),
    model: getStrategyName(strategies, trade.strategyId),
    confluences: trade.tags,
    entrySignal: trade.tags[1] ?? trade.tags[0] ?? '—',
    position: trade.side === 'long' ? 'Buy' : 'Sell',
    status: tableStatus(trade),
    pnl: formatUsd(trade.pnl),
    rMultiple: typeof trade.rMultiple === 'number' && Number.isFinite(trade.rMultiple)
      ? Number(trade.rMultiple.toFixed(2)).toString()
      : '—',
    result: tableResult(trade),
    mistakes: trade.mistakeTags,
  }
}
