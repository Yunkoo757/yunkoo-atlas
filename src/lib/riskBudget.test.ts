import type { Trade } from '@/data/trades'
import type { MonthlyRiskLimit, RiskPolicyVersion } from '@/data/riskManagement'
import {
  quantizeR,
  resolveRiskOutcomes,
  resolveTrustedBudgetPnl,
  toMoneyCents,
  type ResolveRiskOutcomesInput,
} from '@/lib/riskBudget'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function fixture(options: { pnls?: number[]; lossWithoutClosedAt?: boolean } = {}): ResolveRiskOutcomesInput {
  const policy: RiskPolicyVersion = {
    id: 'policy-1',
    sourceWeekStart: '2026-07-27',
    effectiveTradingDay: '2026-07-01',
    capitalBase: 100_000,
    riskPercent: 1,
    riskAmount: 1_000,
    dailyLossLimitR: 2,
    weeklyLossLimitR: 5,
    monthlyLossLimitRDefault: 10,
    disciplineText: '',
    confirmedAt: '2026-07-01T00:00:00.000Z',
  }
  const monthlyLimit: MonthlyRiskLimit = {
    id: 'monthly-risk-limit:2026-07',
    monthKey: '2026-07',
    limitR: 10,
    sourcePolicyVersionId: policy.id,
    lockedAt: '2026-07-01T00:00:00.000Z',
  }
  const pnls = options.pnls ?? [-1_000]
  const trades: Trade[] = pnls.map((pnl, index) => ({
    id: `trade-${index + 1}`,
    ref: `TRD-${index + 1}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: pnl < 0 ? 'loss' : pnl > 0 ? 'win' : 'breakeven',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 110,
    size: 1,
    pnl,
    rMultiple: null,
    resultSource: 'pnl',
    openedAt: '2026-07-27',
    closedAt: options.lossWithoutClosedAt && pnl < 0 ? null : '2026-07-27',
    closedTradingDayKey: options.lossWithoutClosedAt && pnl < 0 ? undefined : '2026-07-27',
    note: '',
  }))
  return { trades, policies: [policy], monthlyLimits: [monthlyLimit], currentTradingDayKey: '2026-07-27' }
}

export function testRiskBudgetReturnsProfitCredit(): void {
  const result = resolveRiskOutcomes(fixture({ pnls: [-1000, 2000] }))
  assert(result.day.netBudgetR === 1, '净值应为 +1R')
  assert(result.day.consumedR === 0, '盈利后已用额度应返还到 0R')
}

export function testLossWithMissingCloseDateIsUnknown(): void {
  const result = resolveRiskOutcomes(fixture({ lossWithoutClosedAt: true }))
  assert(result.gateCoverage === 'unknown', '无法归期的亏损必须 unknown')
  assert(result.unknownReasons.includes('missing-close-date'), '必须保留具体原因')
}

export function testMoneyRoundsHalfAwayFromZero(): void {
  assert(toMoneyCents(1.005) === 101, '1.005 应规范化为 101 美分')
  assert(toMoneyCents(-1.005) === -101, '-1.005 应规范化为 -101 美分')
  assert(toMoneyCents(10.075) === 1008, '10.075 应规范化为 1008 美分')
  assert(toMoneyCents(-10.075) === -1008, '-10.075 应规范化为 -1008 美分')
  assert(toMoneyCents(123456789.125) === 12345678913, '大金额半分边界也必须确定')
  assert(quantizeR(-1.9999999999999998) === -2, '浮点边界应规范化为精确触线值')
}

export function testConflictingResultIsUnknownAndNeverCreditsBudget(): void {
  const input = fixture({ pnls: [1_000] })
  input.trades[0] = { ...input.trades[0]!, rMultiple: -1, resultSource: 'imported' }

  const result = resolveRiskOutcomes(input)

  assert(result.gateCoverage === 'unknown', '冲突结果必须降级为 unknown')
  assert(result.day.netBudgetR === 0, '冲突结果不得形成收益返还')
  assert(result.unknownReasons.includes('result-conflict'), '冲突必须保留具体原因')
}

export function testFutureProfitIsPartialAndDoesNotCreditCurrentBudget(): void {
  const input = fixture({ pnls: [1_000] })
  input.trades[0] = {
    ...input.trades[0]!,
    closedAt: '2026-07-28',
    closedTradingDayKey: '2026-07-28',
  }

  const result = resolveRiskOutcomes(input)

  assert(result.gateCoverage === 'partial', '未来盈利只应降低覆盖状态')
  assert(result.day.netBudgetR === 0, '未来盈利不得提前返还额度')
}

export function testInvalidPersistedBusinessDayIsNotRecomputedFromCloseDate(): void {
  const input = fixture({ pnls: [-1_000] })
  input.trades[0] = { ...input.trades[0]!, closedTradingDayKey: '2026-02-30' }

  const result = resolveRiskOutcomes(input)

  assert(result.gateCoverage === 'unknown', '非法已固化业务日不得被静默重算为安全日期')
  assert(result.unknownReasons.includes('invalid-close-date'), '非法已固化业务日必须保留异常原因')
}

export function testTrustedBudgetPnlUsesOnlyCashAuthority(): void {
  const input = fixture({ pnls: [1_000] })
  const trade = input.trades[0]!

  assert(resolveTrustedBudgetPnl(trade) === 1_000, '现金权威结果必须返回可信 PnL')
  assert(
    resolveTrustedBudgetPnl({ ...trade, resultSource: 'r', rMultiple: 1 }) === null,
    'R 权威下的残留 PnL 不得进入账户预算',
  )
}

export function testMonthlyBudgetUsesPolicyAtEachTradeCloseDate(): void {
  const input = fixture({ pnls: [-1_000, -2_000] })
  input.policies.push({
    ...input.policies[0]!,
    id: 'policy-2',
    effectiveTradingDay: '2026-07-20',
    riskAmount: 2_000,
    confirmedAt: '2026-07-20T00:00:00.000Z',
  })
  input.trades[0] = { ...input.trades[0]!, closedAt: '2026-07-13', closedTradingDayKey: '2026-07-13' }
  input.trades[1] = { ...input.trades[1]!, closedAt: '2026-07-27', closedTradingDayKey: '2026-07-27' }

  const result = resolveRiskOutcomes(input)

  assert(result.month.netBudgetR === -2, '月度预算必须按每笔平仓日对应的 policy 换算')
}
