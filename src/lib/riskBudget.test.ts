import type { Trade } from '@/data/trades'
import type { MonthlyRiskLimit, RiskPolicyVersion } from '@/data/riskManagement'
import {
  quantizeR,
  resolveRiskDataIssues,
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
    liveStageId: 'stage-current',
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
    liveStageId: 'stage-current',
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
    liveStageId: 'stage-current',
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
  return {
    trades,
    policies: [policy],
    monthlyLimits: [monthlyLimit],
    liveStageId: 'stage-current',
    liveStageStartsOn: '2026-07-01',
    currentTradingDayKey: '2026-07-27',
  }
}

export function testRiskBudgetReturnsProfitCredit(): void {
  const result = resolveRiskOutcomes(fixture({ pnls: [-1000, 2000] }))
  assert(result.day.netBudgetR === 1, '净值应为 +1R')
  assert(result.day.consumedR === 0, '盈利后已用额度应返还到 0R')
}

export function testRiskBudgetUsesOnlySelectedStageEntitiesAndStart(): void {
  const input = fixture({ pnls: [-2_000] })
  input.trades[0] = {
    ...input.trades[0]!,
    tradeKind: 'live',
    liveStageId: 'stage-old',
    openedAt: '2026-07-01',
  }
  input.trades.push({
    ...input.trades[0]!,
    tradeKind: 'live',
    id: 'trade-current',
    ref: 'TRD-current',
    liveStageId: 'stage-current',
    openedAt: '2026-07-27',
    pnl: -1_000,
  })
  input.policies = [
    { ...input.policies[0]!, liveStageId: 'stage-old', riskAmount: 100 },
    { ...input.policies[0]!, id: 'policy-current', liveStageId: 'stage-current', riskAmount: 1_000 },
  ]
  input.monthlyLimits = [
    { ...input.monthlyLimits[0]!, liveStageId: 'stage-old', limitR: 1 },
    { ...input.monthlyLimits[0]!, id: 'limit-current', liveStageId: 'stage-current', limitR: 10 },
  ]
  input.liveStageId = 'stage-current'
  input.liveStageStartsOn = '2026-07-27'
  input.liveStatsStartTradingDayKey = '2026-07-01'

  const result = resolveRiskOutcomes(input)

  assert(result.day.netBudgetR === -1, '预算只能使用所选阶段交易与策略')
  assert(result.month.limitR === 10, '月限额只能来自所选阶段')
  assert(!result.month.triggered, '归档阶段触线记录不得影响当前阶段')
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

export function testQuantizeRRejectsInvalidPrecision(): void {
  for (const digits of [-1, 1.5, 16, Number.POSITIVE_INFINITY]) {
    let error = ''
    try {
      quantizeR(1, digits)
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason)
    }
    assert(error.includes('精度'), `非法精度 ${digits} 必须明确抛错`)
  }
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

export function testFutureLossIsUnknownAndDoesNotEnterCurrentBudget(): void {
  const input = fixture({ pnls: [-1_000] })
  input.trades[0] = {
    ...input.trades[0]!,
    closedAt: '2026-07-28',
    closedTradingDayKey: '2026-07-28',
  }

  const result = resolveRiskOutcomes(input)

  assert(result.gateCoverage === 'unknown', '未来亏损必须降级为 unknown')
  assert(result.day.netBudgetR === 0, '未来亏损不得进入当前预算')
  assert(result.unknownReasons.includes('future-loss-close-date'), '必须保留未来亏损日期原因')
}

export function testExactLossLimitIsTriggeredAfterCanonicalQuantization(): void {
  const result = resolveRiskOutcomes(fixture({ pnls: [-1_999.9999999998] }))

  assert(result.day.netBudgetR === -2, '金额与 R 必须先规范化到精确触线值')
  assert(result.day.triggered, '净预算精确等于日限额时必须触线')
}

export function testRiskAggregationIsStableAcrossInputOrder(): void {
  const input = fixture({ pnls: [100, 200, -300] })
  const reversed = { ...input, trades: [...input.trades].reverse() }

  const forwardResult = resolveRiskOutcomes(input)
  const reverseResult = resolveRiskOutcomes(reversed)

  assert(
    JSON.stringify(forwardResult) === JSON.stringify(reverseResult),
    '聚合必须按稳定 trade ID 排序，不得受输入遍历顺序影响',
  )
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

export function testRAuthoredLossWithoutCashPnlKeepsAccountBudgetUnknown(): void {
  const input = fixture({ pnls: [-1_000] })
  input.trades[0] = {
    ...input.trades[0]!,
    pnl: null,
    rMultiple: -1,
    resultSource: 'r',
  }

  const result = resolveRiskOutcomes(input)

  assert(result.gateCoverage === 'unknown', '缺少现金 PnL 的亏损不得伪造账户预算覆盖率')
  assert(result.day.netBudgetR === 0, '交易 R 不得直接计入账户预算 R')
  assert(result.day.includedTradeCount === 0, '缺少现金 PnL 的交易不得进入账户预算数值聚合')
  assert(result.unknownReasons.includes('missing-loss-pnl'), '必须明确标记缺少亏损 PnL')
}

export function testHistoricalDirtyResultDoesNotPoisonCurrentRiskCoverage(): void {
  const input = fixture({ pnls: [-1_000] })
  input.trades.push({
    ...input.trades[0]!,
    id: 'historical-dirty-loss',
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    closedAt: '2026-06-15',
    closedTradingDayKey: '2026-06-15',
  })

  const result = resolveRiskOutcomes(input)

  assert(result.gateCoverage === 'complete', '当前月覆盖率不得被其他月份的历史脏结果污染')
  assert(result.day.coverage === 'complete', '今日覆盖率只应检查今日相关结果')
  assert(result.week.coverage === 'complete', '本周覆盖率只应检查本周相关结果')
  assert(result.month.coverage === 'complete', '本月覆盖率只应检查本月相关结果')
  assert(!result.unknownReasons.includes('missing-loss-pnl'), '当前闸门原因不得混入其他月份问题')
}

export function testRiskBudgetExcludesPreCycleTradeByOpenDay(): void {
  const input = fixture({ pnls: [-1_000, -1_000] })
  input.liveStageStartsOn = '2026-07-27'
  input.tradingDayStartHour = 0
  input.trades[0] = {
    ...input.trades[0]!,
    openedAt: '2026-07-26',
    closedAt: '2026-07-27',
    closedTradingDayKey: '2026-07-27',
  }

  const result = resolveRiskOutcomes(input)

  assert(result.month.coverage === 'complete', '规则前交易不得制造当前周期未知覆盖')
  assert(result.month.netBudgetR === -1, '只应计入边界日开仓的当前周期交易')
  assert(result.month.includedTradeCount === 1, '规则前交易不得显示为当前周期未计入')
}

export function testMonthlyBudgetResetsAtCalendarMonthWhileWeekCanCrossMonth(): void {
  const input = fixture({ pnls: [-1_000] })
  input.currentTradingDayKey = '2026-08-01'
  input.liveStageStartsOn = '2026-07-27'
  input.monthlyLimits = [{
    ...input.monthlyLimits[0]!,
    id: 'monthly-risk-limit:2026-08',
    monthKey: '2026-08',
    lockedAt: '2026-08-01T00:00:00.000Z',
  }]
  input.trades[0] = {
    ...input.trades[0]!,
    openedAt: '2026-07-31',
    closedAt: '2026-07-31',
    closedTradingDayKey: '2026-07-31',
  }

  const result = resolveRiskOutcomes(input)

  assert(result.week.netBudgetR === -1, '跨月自然周必须继续计入 7 月 31 日亏损')
  assert(result.month.netBudgetR === 0, '8 月月度额度不得计入 7 月平仓结果')
  assert(result.month.remainingR === 10, '自然月切换后月度额度必须恢复为 10R')
}

export function testRiskBudgetKeepsCurrentCycleUnknownFailClosed(): void {
  const input = fixture({ pnls: [-1_000] })
  input.liveStageStartsOn = '2026-07-27'
  input.trades[0] = { ...input.trades[0]!, pnl: null, resultSource: 'r', rMultiple: -1 }

  const result = resolveRiskOutcomes(input)

  assert(result.gateCoverage === 'unknown', '当前周期缺失现金亏损必须继续 unknown')
}

export function testRiskBudgetIncludesPlanOpenedAfterCycleStart(): void {
  const input = fixture({ pnls: [-1_000] })
  input.currentTradingDayKey = '2026-07-28'
  input.liveStageStartsOn = '2026-07-27'
  input.tradingDayStartHour = 0
  input.trades[0] = {
    ...input.trades[0]!,
    openedAt: '2026-07-26',
    closedAt: '2026-07-28',
    closedTradingDayKey: '2026-07-28',
    activities: [{
      id: 'activity-open-current-cycle',
      kind: 'status',
      status: 'open',
      timestamp: '2026-07-28T08:00:00.000Z',
    }],
  }

  const result = resolveRiskOutcomes(input)

  assert(result.month.includedTradeCount === 1, '起点后首次真实开仓的计划单必须计入风险预算')
  assert(result.month.netBudgetR === -1, '起点后首次真实开仓的亏损不得被规则前日期排除')
}

export function testRiskBudgetUsesConfiguredTradingDayBoundaryForCloseDate(): void {
  const input = fixture({ pnls: [-1_000] })
  input.currentTradingDayKey = '2026-07-27'
  input.tradingDayStartHour = 6
  input.trades[0] = {
    ...input.trades[0]!,
    closedAt: new Date(2026, 6, 28, 5, 0).toISOString(),
    closedTradingDayKey: undefined,
  }

  const result = resolveRiskOutcomes(input)

  assert(result.day.coverage === 'complete', '06:00 前平仓必须归入前一交易日')
  assert(result.day.netBudgetR === -1, '凌晨平仓亏损必须进入对应交易日风险预算')
}

export function testRiskDataIssuesMergeReasonsAndKeepStableOrder(): void {
  const input = fixture({ pnls: [-1_000, 1_000] })
  input.trades[0] = {
    ...input.trades[0]!,
    pnl: null,
    resultSource: 'r',
    rMultiple: -1,
    closedAt: null,
    closedTradingDayKey: undefined,
  }
  input.trades[1] = {
    ...input.trades[1]!,
    pnl: null,
    resultSource: 'r',
    rMultiple: 1,
  }

  const issues = resolveRiskDataIssues({ ...input, trades: [...input.trades].reverse() })

  assert(issues.length === 2, '同一交易的多个原因必须合并为一项')
  assert(issues[0]?.tradeId === 'trade-1' && issues[0].severity === 'blocking', '阻断项必须优先')
  assert(issues[0]?.reasons.join() === 'missing-loss-pnl,missing-close-date', '阻断原因必须稳定排序')
  assert(issues[1]?.severity === 'partial', '部分覆盖项必须排在阻断项之后')
  assert(issues[1]?.reasons.includes('partial-missing-pnl'), '非亏损缺金额必须显式标为部分覆盖')
}

export function testRiskDataIssuesExposeGlobalCycleStartProblem(): void {
  const input = fixture({ pnls: [-1_000] })
  input.liveStageStartsOn = '2026-07-28'

  const issues = resolveRiskDataIssues(input)

  assert(issues.length === 1 && issues[0]?.severity === 'global', '未来核算起点必须生成独立全局项')
  assert(issues[0]?.tradeId === null, '全局项不得伪装成交易问题')
  assert(issues[0]?.reasons[0] === 'invalid-live-cycle-start', '全局项必须保留准确原因')
}

export function testRiskDataIssuesExplainEveryPartialCoverageCause(): void {
  const input = fixture({ pnls: [1_000, 1_000, 1_000, 1_000, 1_000] })
  input.trades[0] = { ...input.trades[0]!, pnl: null, resultSource: 'r', rMultiple: 1 }
  input.trades[1] = { ...input.trades[1]!, closedAt: null, closedTradingDayKey: undefined }
  input.trades[2] = { ...input.trades[2]!, closedAt: 'invalid', closedTradingDayKey: undefined }
  input.trades[3] = { ...input.trades[3]!, closedAt: '2026-07-28', closedTradingDayKey: '2026-07-28' }
  input.trades[4] = { ...input.trades[4]!, closedAt: '2026-06-30', closedTradingDayKey: '2026-06-30' }

  const reasons = new Set(resolveRiskDataIssues(input).flatMap((issue) => issue.reasons))

  for (const reason of [
    'partial-missing-pnl',
    'partial-missing-close-date',
    'partial-invalid-close-date',
    'partial-future-close-date',
    'partial-missing-policy',
  ] as const) {
    assert(reasons.has(reason), `部分覆盖清单缺少 ${reason}`)
  }
}

export function testRiskDataIssuesExcludeNonCurrentLiveCycleRecords(): void {
  const input = fixture({ pnls: [-1_000, -1_000, -1_000, -1_000] })
  input.liveStageStartsOn = '2026-07-27'
  input.trades = input.trades.map((item) => ({ ...item, pnl: null, resultSource: 'r', rMultiple: -1 }))
  input.trades[0] = { ...input.trades[0]!, openedAt: '2026-07-26' }
  input.trades[1] = { ...input.trades[1]!, tradeKind: 'paper' }
  input.trades[2] = { ...input.trades[2]!, tradeKind: 'case' }
  input.trades[3] = { ...input.trades[3]!, deletedAt: '2026-07-27T12:00:00.000Z' }

  assert(resolveRiskDataIssues(input).length === 0, '规则前、模拟、案例和已删除记录不得进入风险修复清单')
}

export function testRiskDataIssuesAreEmptyForCompleteCurrentCycle(): void {
  assert(resolveRiskDataIssues(fixture({ pnls: [-1_000, 2_000] })).length === 0, '完整风险数据不得生成修复项')
}
