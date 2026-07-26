import type {
  RiskOverrideEvent,
  RiskPolicyDraft,
  RiskPolicyVersion,
} from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import {
  activeRiskPolicy,
  confirmWeeklyRiskPreparation,
  ensureRiskPeriodRecords,
  type ConfirmWeeklyRiskPreparationInput,
  type RiskPolicyState,
} from '@/lib/riskPolicy'
import { useStore } from '@/store/useStore'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function draft(): RiskPolicyDraft {
  return {
    capitalBase: 100_000,
    riskPercent: 1,
    riskAmount: null,
    dailyLossLimitR: 2,
    weeklyLossLimitR: 5,
    monthlyLossLimitRDefault: 10,
    disciplineText: '只做计划内交易',
  }
}

function emptyState(): RiskPolicyState {
  return {
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [] as RiskOverrideEvent[],
  }
}

function confirmation(
  day: string,
  patch: Partial<ConfirmWeeklyRiskPreparationInput & RiskPolicyDraft> = {},
): ConfirmWeeklyRiskPreparationInput {
  const baseDraft = draft()
  return {
    currentTradingDayKey: day,
    weekStart: '2026-07-27',
    hasClosedLiveTradeOnDay: false,
    draft: { ...baseDraft, ...patch },
    confirmedAt: '2026-07-27T08:00:00.000Z',
    policyVersionId: 'policy-1',
    ...patch,
  }
}

function stateWithPolicy(): RiskPolicyState {
  return confirmWeeklyRiskPreparation(emptyState(), confirmation('2026-07-27'))
}

export function testConfirmedPolicyIsImmutableAndEffectiveForward(): void {
  const first = confirmWeeklyRiskPreparation(emptyState(), confirmation('2026-07-27'))
  const second = confirmWeeklyRiskPreparation(first, confirmation('2026-07-27', {
    hasClosedLiveTradeOnDay: true,
    riskPercent: 2,
    policyVersionId: 'policy-2',
    confirmedAt: '2026-07-27T09:00:00.000Z',
  }))

  assert(first.riskPolicyVersions[0]?.riskPercent === 1, '旧版本不可被覆盖')
  assert(first.riskPolicyVersions[0]?.effectiveTradingDay === '2026-07-27', '干净新周首次确认当天生效')
  assert(second.riskPolicyVersions[1]?.effectiveTradingDay === '2026-07-28', '周中修订次日生效')
  assert(second.riskPolicyVersions[1]?.riskAmount === 2_000, 'riskAmount 必须使用 canonical 美分公式')
}

export function testFirstConfirmationWithClosedLiveTradeStartsNextDay(): void {
  const state = confirmWeeklyRiskPreparation(emptyState(), confirmation('2026-07-27', {
    hasClosedLiveTradeOnDay: true,
  }))
  assert(state.riskPolicyVersions[0]?.effectiveTradingDay === '2026-07-28', '当日已有平仓时首次规则次日生效')
}

export function testNonFirstConfirmationAlwaysStartsNextDay(): void {
  const first = confirmWeeklyRiskPreparation(emptyState(), confirmation('2026-07-27'))
  const second = confirmWeeklyRiskPreparation(first, confirmation('2026-07-27', {
    policyVersionId: 'policy-2',
    confirmedAt: '2026-07-27T09:00:00.000Z',
  }))
  assert(second.riskPolicyVersions[1]?.effectiveTradingDay === '2026-07-28', '非首次确认必须向后生效')
}

export function testActivePolicyUsesStablePrecedence(): void {
  const base: RiskPolicyVersion = stateWithPolicy().riskPolicyVersions[0]!
  const policies: RiskPolicyVersion[] = [
    { ...base, id: 'policy-z', effectiveTradingDay: '2026-07-28', confirmedAt: '2026-07-27T09:00:00.000Z' },
    { ...base, id: 'policy-a', effectiveTradingDay: '2026-07-28', confirmedAt: '2026-07-27T10:00:00.000Z' },
    { ...base, id: 'policy-b', effectiveTradingDay: '2026-07-28', confirmedAt: '2026-07-27T10:00:00.000Z' },
    { ...base, id: 'policy-future', effectiveTradingDay: '2026-07-29', confirmedAt: '2026-07-27T11:00:00.000Z' },
  ]
  assert(activeRiskPolicy(policies, '2026-07-28')?.id === 'policy-b', '同日必须按 confirmedAt/id 稳定选择')
}

export function testMonthlyLimitMaterializesOnce(): void {
  const once = ensureRiskPeriodRecords(stateWithPolicy(), '2026-07-27')
  const changedPolicy = confirmWeeklyRiskPreparation(once, confirmation('2026-07-28', {
    monthlyLossLimitRDefault: 20,
    policyVersionId: 'policy-2',
    confirmedAt: '2026-07-28T08:00:00.000Z',
  }))
  const twice = ensureRiskPeriodRecords(changedPolicy, '2026-07-29')

  assert(once.monthlyRiskLimits.length === 1, '首次显式动作创建月限额')
  assert(twice.monthlyRiskLimits.length === 1, '同月最多创建一次')
  assert(twice.monthlyRiskLimits[0]?.limitR === once.monthlyRiskLimits[0]?.limitR, '后续 policy 不得重写当月限额')
}

export function testInvalidDraftIsRejectedWithoutChangingState(): void {
  const state = emptyState()
  let failed = false
  try {
    confirmWeeklyRiskPreparation(state, confirmation('2026-07-27', { capitalBase: 0 }))
  } catch {
    failed = true
  }
  assert(failed, '非正数规则必须拒绝')
  assert(state.riskPolicyVersions.length === 0, '验证失败不得修改输入状态')
}

export function testDuplicatePolicyIdIsRejected(): void {
  const first = confirmWeeklyRiskPreparation(emptyState(), confirmation('2026-07-27'))
  let failed = false
  try {
    confirmWeeklyRiskPreparation(first, confirmation('2026-07-28'))
  } catch {
    failed = true
  }
  assert(failed, '重复 policy ID 必须拒绝，不能产生两个同身份版本')
  assert(first.riskPolicyVersions.length === 1, '拒绝重复 ID 时旧状态必须保持不变')
}

function closedLiveTrade(closedTradingDayKey: string): Trade {
  return {
    id: 'trade-1',
    ref: 'TRD-1',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'loss',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 90,
    size: 1,
    pnl: -1_000,
    rMultiple: null,
    resultSource: 'pnl',
    openedAt: '2026-07-26',
    closedAt: '2026-07-26T23:30:00.000Z',
    closedTradingDayKey,
    note: '',
  }
}

export function testStoreConfirmationUsesFrozenClosedTradingDayKey(): void {
  useStore.setState({
    trades: [closedLiveTrade('2026-07-27')],
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [],
  })

  useStore.getState().confirmWeeklyRiskPreparation({
    currentTradingDayKey: '2026-07-27',
    weekStart: '2026-07-27',
    draft: draft(),
    confirmedAt: '2026-07-27T08:00:00.000Z',
    policyVersionId: 'store-policy-1',
  })

  const state = useStore.getState()
  assert(state.riskPolicyVersions[0]?.effectiveTradingDay === '2026-07-28', 'Store 必须按固化业务日识别当日平仓')
  assert(state.monthlyRiskLimits[0]?.sourcePolicyVersionId === 'store-policy-1', '首个有效 policy 应显式物化当月限额')
}

export function testStoreSavesWeeklyDraftWithoutCreatingPolicy(): void {
  useStore.setState({
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [],
  })
  useStore.getState().saveWeeklyRiskDraft('2026-08-03', draft(), '2026-08-03T08:00:00.000Z')

  const state = useStore.getState()
  assert(state.weeklyRiskPreparations[0]?.weekStart === '2026-08-03', '草稿必须按周保存')
  assert(state.weeklyRiskPreparations[0]?.reviewedAt === null, '保存草稿不得标记已复核')
  assert(state.riskPolicyVersions.length === 0, '保存草稿不得隐式创建 policy')
}
