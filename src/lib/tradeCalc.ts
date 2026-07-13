import type { TradeSide } from '@/data/trades'

/** 根据方向、入场、出场、仓位计算盈亏金额 */
export function calcPnl(
  side: TradeSide,
  entry: number,
  exit: number,
  size: number,
): number | null {
  if (!entry || !exit || !size) return null
  const diff = side === 'long' ? exit - entry : entry - exit
  return Math.round(diff * size * 100) / 100
}

/** 根据盈亏与风险金额计算 R 倍数 */
export function calcR(pnl: number, risk: number): number | null {
  if (!risk) return null
  return Math.round((pnl / risk) * 10) / 10
}

/** 根据开仓时止损计算真实初始风险对应的 R 倍数。 */
export function calcRFromStop(
  side: TradeSide,
  pnl: number,
  entry: number,
  stopLoss: number | null | undefined,
  size: number,
): number | null {
  if (!entry || !stopLoss || !size) return null
  const priceRisk = side === 'long' ? entry - stopLoss : stopLoss - entry
  if (priceRisk <= 0) return null
  return calcR(pnl, priceRisk * size)
}

/** 根据盈亏推断平仓状态 */
export function pnlToStatus(pnl: number): 'win' | 'loss' | 'breakeven' {
  if (pnl > 0) return 'win'
  if (pnl < 0) return 'loss'
  return 'breakeven'
}
