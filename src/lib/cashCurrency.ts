import { normalizeCashCurrency, type Trade } from '@/data/trades'
import { fmtMoney } from '@/lib/format'
import { resolveTradeTruth } from '@/lib/tradeTruth'
import type { LegacyCashCurrencyAssumption } from '@/storage/types'

export type CashCurrencyFactSource = 'explicit' | 'legacy-assumption' | 'unknown'

export interface CashCurrencyFactResolution {
  currency: string | null
  source: CashCurrencyFactSource
  isUsdEligible: boolean
}

type CashCurrencyTrade = Partial<Pick<Trade, 'pnl' | 'cashCurrency'>>

const hasOwn = (value: object, property: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, property)

/**
 * 缺 cashCurrency 字段的旧记录默认按 USD 解释；不再依赖用户确认。
 * 显式 null、非法值或其他币种不会被覆盖。assumption 参数保留以兼容调用方签名，已不再参与决议。
 */
export function resolveTradeCashCurrencyFact(
  trade: CashCurrencyTrade,
  _assumption: LegacyCashCurrencyAssumption | null = null,
): CashCurrencyFactResolution {
  if (!hasOwn(trade, 'cashCurrency')) {
    return { currency: 'USD', source: 'legacy-assumption', isUsdEligible: true }
  }
  const currency = normalizeCashCurrency(trade.cashCurrency)
  if (currency === null) return { currency: null, source: 'unknown', isUsdEligible: false }
  return { currency, source: 'explicit', isUsdEligible: currency === 'USD' }
}

export function eligibleUsdPnlIds(
  trades: readonly Trade[],
  assumption: LegacyCashCurrencyAssumption | null,
): string[] {
  return trades.flatMap((trade) => (
    resolveTradeTruth(trade).isResultComplete &&
    typeof trade.pnl === 'number' && Number.isFinite(trade.pnl) &&
    resolveTradeCashCurrencyFact(trade, assumption).isUsdEligible
      ? [trade.id]
      : []
  ))
}

export function summarizeUsdPnl(
  trades: readonly Trade[],
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
  return fmtMoney(trade.pnl, fact.currency, masked)
}
