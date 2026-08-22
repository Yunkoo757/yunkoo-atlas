import { toMoneyCents } from '@/lib/money'

type RiskAmountSource = {
  capitalBase?: unknown
  riskPercent?: unknown
  riskAmount?: unknown
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** 与持久化合同共用的 canonical 金额关系：资金按分精确，风险金额按分四舍五入。 */
export function hasCanonicalRiskAmount(value: RiskAmountSource): boolean {
  try {
    if (!isPositiveFiniteNumber(value.capitalBase) || !isPositiveFiniteNumber(value.riskPercent)) {
      return false
    }
    if (!isPositiveFiniteNumber(value.riskAmount)) return false
    const capitalCents = toMoneyCents(value.capitalBase)
    const expectedCents = toMoneyCents((capitalCents / 100) * value.riskPercent / 100)
    return capitalCents > 0 &&
      value.capitalBase === capitalCents / 100 &&
      expectedCents > 0 &&
      value.riskAmount === expectedCents / 100
  } catch {
    return false
  }
}
