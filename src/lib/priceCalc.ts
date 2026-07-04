/**
 * 交易价格计算辅助函数
 */

/**
 * 计算盈亏金额
 * @param entry 入场价
 * @param exit 出场价
 * @param size 仓位大小
 * @param side 方向（long/short）
 * @returns 盈亏金额
 */
export function calculatePnL(
  entry: number,
  exit: number | null,
  size: number,
  side: 'long' | 'short'
): number {
  if (!exit || entry === 0) return 0

  if (side === 'long') {
    return (exit - entry) * size
  } else {
    return (entry - exit) * size
  }
}

/**
 * 计算 R 倍数
 * @param pnl 盈亏金额
 * @param stopLoss 止损价
 * @param entry 入场价
 * @param size 仓位大小
 * @param side 方向
 * @returns R 倍数
 */
export function calculateRMultiple(
  pnl: number,
  stopLoss: number | null,
  entry: number,
  size: number,
  side: 'long' | 'short'
): number {
  if (!stopLoss || entry === 0 || size === 0) return 0

  // 计算风险金额（止损会亏多少）
  let risk: number
  if (side === 'long') {
    risk = (entry - stopLoss) * size
  } else {
    risk = (stopLoss - entry) * size
  }

  if (risk === 0) return 0

  return pnl / risk
}

/**
 * 建议止损价（基于入场价的一定比例）
 */
export function suggestStopLoss(
  entry: number,
  riskPercent: number = 0.02, // 默认 2% 风险
  side: 'long' | 'short'
): number {
  if (side === 'long') {
    return entry * (1 - riskPercent)
  } else {
    return entry * (1 + riskPercent)
  }
}