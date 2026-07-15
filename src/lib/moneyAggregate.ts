import type { Trade } from '@/data/trades'
import { isVerifiedTradeResult } from '@/lib/tradeTruth'

export type MoneyAggregate =
  | { state: 'none'; sampleSize: 0; total: null; currency: null }
  | { state: 'unknown-currency'; sampleSize: number; total: null; currency: null }
  | { state: 'mixed-currency'; sampleSize: number; total: null; currency: null; currencies: string[] }
  | {
      state: 'single-currency'
      sampleSize: number
      total: number
      currency: string
      currencyConfidence: 'confirmed' | 'inferred'
      basis: 'net' | 'unknown'
    }

type MoneyEvidenceTrade = Trade & {
  pnlCurrency?: string | null
  pnlCurrencySource?: 'manual' | 'imported' | 'inferred' | 'legacy' | null
  pnlBasis?: 'net' | 'unknown'
}

export function aggregateMoney(trades: readonly Trade[]): MoneyAggregate {
  const values = trades
    .filter(isVerifiedTradeResult)
    .filter((trade): trade is Trade & { pnl: number } => typeof trade.pnl === 'number' && Number.isFinite(trade.pnl))
    .map((trade) => trade as MoneyEvidenceTrade & { pnl: number })
  if (values.length === 0) return { state: 'none', sampleSize: 0, total: null, currency: null }
  if (values.some((trade) => !trade.pnlCurrency)) {
    return { state: 'unknown-currency', sampleSize: values.length, total: null, currency: null }
  }
  const currencies = [...new Set(values.map((trade) => trade.pnlCurrency!))].sort()
  if (currencies.length > 1) {
    return { state: 'mixed-currency', sampleSize: values.length, total: null, currency: null, currencies }
  }
  return {
    state: 'single-currency',
    sampleSize: values.length,
    total: values.reduce((sum, trade) => sum + trade.pnl, 0),
    currency: currencies[0]!,
    currencyConfidence: values.every((trade) => trade.pnlCurrencySource === 'manual' || trade.pnlCurrencySource === 'imported')
      ? 'confirmed'
      : 'inferred',
    basis: values.every((trade) => trade.pnlBasis === 'net') ? 'net' : 'unknown',
  }
}

export function moneyAggregateLabel(value: MoneyAggregate): string {
  if (value.state === 'none') return '—'
  if (value.state === 'unknown-currency') return '币种未知，无法合计'
  if (value.state === 'mixed-currency') return '多币种，无法合计'
  const sign = value.total > 0 ? '+' : ''
  return `${sign}${value.total.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${value.currency}`
}
