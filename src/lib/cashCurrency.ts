import { normalizeCashCurrency, type Trade } from '@/data/trades'
import { fmtMoney } from '@/lib/format'
import type { LegacyCashCurrencyAssumption } from '@/storage/types'

export type CashCurrencyFactSource = 'explicit' | 'legacy-assumption' | 'unknown'

export interface CashCurrencyFactResolution {
  currency: string | null
  source: CashCurrencyFactSource
  isUsdEligible: boolean
}

type CashCurrencyTrade = Partial<Pick<Trade, 'pnl' | 'cashCurrency'>>
type IdentifiedCashCurrencyTrade = CashCurrencyTrade & Pick<Trade, 'id'>

const hasOwn = (value: object, property: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, property)

/** 资料库假设只解释真正缺字段的旧记录，不覆盖显式 null、非法值或其他币种。 */
export function resolveTradeCashCurrencyFact(
  trade: CashCurrencyTrade,
  assumption: LegacyCashCurrencyAssumption | null,
): CashCurrencyFactResolution {
  if (!hasOwn(trade, 'cashCurrency')) {
    const assumed = normalizeCashCurrency(assumption?.currency)
    if (assumed === 'USD') {
      return { currency: 'USD', source: 'legacy-assumption', isUsdEligible: true }
    }
    return { currency: null, source: 'unknown', isUsdEligible: false }
  }
  const currency = normalizeCashCurrency(trade.cashCurrency)
  if (currency === null) return { currency: null, source: 'unknown', isUsdEligible: false }
  return { currency, source: 'explicit', isUsdEligible: currency === 'USD' }
}

export function eligibleUsdPnlIds(
  trades: readonly IdentifiedCashCurrencyTrade[],
  assumption: LegacyCashCurrencyAssumption | null,
): string[] {
  return trades.flatMap((trade) => (
    typeof trade.pnl === 'number' && Number.isFinite(trade.pnl) &&
    resolveTradeCashCurrencyFact(trade, assumption).isUsdEligible
      ? [trade.id]
      : []
  ))
}

export function summarizeUsdPnl(
  trades: readonly IdentifiedCashCurrencyTrade[],
  assumption: LegacyCashCurrencyAssumption | null,
): { pnlCount: number, totalPnl: number, pnlIds: string[] } {
  const pnlIds = eligibleUsdPnlIds(trades, assumption)
  const eligible = new Set(pnlIds)
  return {
    pnlCount: pnlIds.length,
    totalPnl: trades.reduce((total, trade) =>
      eligible.has(trade.id) && typeof trade.pnl === 'number' ? total + trade.pnl : total, 0),
    pnlIds,
  }
}

export function formatTradeCashPnl(
  trade: CashCurrencyTrade,
  assumption: LegacyCashCurrencyAssumption | null,
  masked = false,
): string {
  const fact = resolveTradeCashCurrencyFact(trade, assumption)
  const value = fmtMoney(trade.pnl, fact.currency, masked)
  if (value === '—' || value === '****' || fact.source !== 'legacy-assumption') return value
  return `${value} · 按资料库假设作为 USD`
}
