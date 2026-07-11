import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { resolveTimeframe } from '@/data/trades'
import { getStrategyName } from '@/lib/strategies'

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
  result: 'Profit' | 'Loss' | 'Breakeven'
  mistakes: string[]
}

function formatTableDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, '/')
}

function formatUsd(value: number): string {
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
  if (trade.pnl > 0 || trade.status === 'win') return 'Profit'
  if (trade.pnl < 0 || trade.status === 'loss') return 'Loss'
  return 'Breakeven'
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
    rMultiple: Number.isFinite(trade.rMultiple)
      ? Number(trade.rMultiple.toFixed(2)).toString()
      : '0',
    result: tableResult(trade),
    mistakes: trade.mistakeTags,
  }
}
