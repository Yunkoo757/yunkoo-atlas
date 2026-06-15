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

/**
 * 简易 R：以 |entry - exit| × size 作为 1R 参考（价格位移即风险单位）。
 * 仅作建议值，实际 R 应基于真实止损风险，可手动覆盖。
 */
export function calcRSimple(
  pnl: number,
  entry: number,
  exit: number,
  size: number,
): number | null {
  const riskUnit = Math.abs(exit - entry) * size
  return calcR(pnl, riskUnit)
}

/** 根据盈亏推断平仓状态 */
export function pnlToStatus(pnl: number): 'win' | 'loss' | 'breakeven' {
  if (pnl > 0) return 'win'
  if (pnl < 0) return 'loss'
  return 'breakeven'
}
