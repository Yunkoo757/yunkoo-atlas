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
  const originalOrder = policies.map((policy) => policy.id).join(',')
  assert(activeRiskPolicy(policies, '2026-07-28')?.id === 'policy-b', '同日必须按 confirmedAt/id 稳定选择')
  assert(policies.map((policy) => policy.id).join(',') === originalOrder, 'active policy 纯读取不得改变输入顺序')
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
  assert(once.monthlyRiskLimits[0]?.sourcePolicyVersionId === 'policy-1', '月限额必须记录来源 policy')
  assert(once.monthlyRiskLimits[0]?.lockedAt === '2026-07-27T08:00:00.000Z', '月限额必须记录来源确认时间')
  assert(twice.monthlyRiskLimits.length === 1, '同月最多创建一次')
  assert(twice.monthlyRiskLimits[0]?.limitR === once.monthlyRiskLimits[0]?.limitR, '后续 policy 不得重写当月限额')
}

export function testEnsureWithoutPolicyReturnsOriginalState(): void {
  const state = emptyState()
  const result = ensureRiskPeriodRecords(state, '2026-07-27')
  assert(result === state, '无 active policy 时 ensure 必须保持原 state 且不创建记录')
  assert(result.monthlyRiskLimits.length === 0, '无 policy 不得创建月限额')
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

function closedLiveTrade(closedTradingDayKey?: string): Trade {
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
    ...(closedTradingDayKey === undefined ? {} : { closedTradingDayKey }),
    note: '',
  }
}

export function testStoreConfirmationFallsBackForLegacyClosedTrade(): void {
  useStore.setState((state) => ({
    trades: [{ ...closedLiveTrade(), closedAt: '2026-07-27' }],
    display: { ...state.display, tradingDayStartHour: 6 },
    weeklyRiskPreparations: [],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
    riskOverrideEvents: [],
  }))

  useStore.getState().confirmWeeklyRiskPreparation({
    currentTradingDayKey: '2026-07-27',
    weekStart: '2026-07-27',
    draft: draft(),
    confirmedAt: '2026-07-27T08:00:00.000Z',
    policyVersionId: 'legacy-policy-1',
  })

  assert(
    useStore.getState().riskPolicyVersions[0]?.effectiveTradingDay === '2026-07-28',
    '缺少固化 key 的旧终态 live 必须按 closedAt fallback 识别当日平仓',
  )
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

export function testLaterConfirmationDoesNotPrematurelyLockNextMonth(): void {
  const initial = ensureRiskPeriodRecords(stateWithPolicy(), '2026-07-27')
  useStore.setState({
    trades: [],
    weeklyRiskPreparations: initial.weeklyRiskPreparations,
    riskPolicyVersions: initial.riskPolicyVersions,
    monthlyRiskLimits: initial.monthlyRiskLimits,
    riskOverrideEvents: [],
  })

  useStore.getState().confirmWeeklyRiskPreparation({
    currentTradingDayKey: '2026-07-31',
    weekStart: '2026-07-27',
    draft: { ...draft(), monthlyLossLimitRDefault: 20 },
    confirmedAt: '2026-07-31T08:00:00.000Z',
    policyVersionId: 'policy-2',
  })
  assert(
    !useStore.getState().monthlyRiskLimits.some((limit) => limit.monthKey === '2026-08'),
    '非首个 policy 不得按未来生效日提前锁定下月',
  )

  useStore.getState().confirmWeeklyRiskPreparation({
    currentTradingDayKey: '2026-07-31',
    weekStart: '2026-07-27',
    draft: { ...draft(), monthlyLossLimitRDefault: 30 },
    confirmedAt: '2026-07-31T09:00:00.000Z',
    policyVersionId: 'policy-3',
  })
  useStore.getState().ensureRiskPeriodRecords('2026-08-01')

  const august = useStore.getState().monthlyRiskLimits.find((limit) => limit.monthKey === '2026-08')
  assert(august?.limitR === 30, '跨月显式 ensure 必须使用最终 active policy')
  assert(august?.sourcePolicyVersionId === 'policy-3', '月限额必须记录最终 active policy 来源')
  assert(august?.lockedAt === '2026-07-31T09:00:00.000Z', 'lockedAt 必须来自最终 active policy')
}

export function testConfirmationRejectsInvalidTemporalIdentityInputs(): void {
  const invalidInputs: ConfirmWeeklyRiskPreparationInput[] = [
    confirmation('2026-02-30'),
    confirmation('2026-07-27', { confirmedAt: 'not-an-iso-time' }),
    confirmation('2026-07-27', { policyVersionId: '   ' }),
    confirmation('2026-07-27', { weekStart: '2026-07-28' }),
    confirmation('2026-07-27', { weekStart: '2026-07-20' }),
  ]

  for (const input of invalidInputs) {
    const state = emptyState()
    let failed = false
    try {
      confirmWeeklyRiskPreparation(state, input)
    } catch {
      failed = true
    }
    assert(failed, `非法输入必须确定性拒绝：${JSON.stringify(input)}`)
    assert(state.riskPolicyVersions.length === 0, '非法输入不得修改状态')
  }
}

export function testEnsureRejectsInvalidTradingDay(): void {
  const state = stateWithPolicy()
  let failed = false
  try {
    ensureRiskPeriodRecords(state, '2026-13-40')
  } catch {
    failed = true
  }
  assert(failed, 'ensure 必须拒绝非 canonical 业务日')
  assert(state.monthlyRiskLimits.length === 0, '非法 ensure 不得伪造 month key')
}

export function testStoreCopiesSavedDraft(): void {
  const externalDraft = draft()
  useStore.setState({ weeklyRiskPreparations: [] })
  useStore.getState().saveWeeklyRiskDraft(
    '2026-08-03',
    externalDraft,
    '2026-08-03T08:00:00.000Z',
  )
  externalDraft.disciplineText = '调用后被外部修改'

  assert(
    useStore.getState().weeklyRiskPreparations[0]?.draft.disciplineText === '只做计划内交易',
    'Store 必须复制 draft，不能保留调用方引用',
  )
}

export function testDraftChangesInvalidateReviewOnlyWhenContentChanges(): void {
  const confirmed = stateWithPolicy()
  const preparation = confirmed.weeklyRiskPreparations[0]!
  useStore.setState({
    weeklyRiskPreparations: confirmed.weeklyRiskPreparations,
    riskPolicyVersions: confirmed.riskPolicyVersions,
    monthlyRiskLimits: [],
    riskOverrideEvents: [],
  })

  useStore.getState().saveWeeklyRiskDraft(
    preparation.weekStart,
    { ...preparation.draft },
    '2026-07-27T09:00:00.000Z',
  )
  const unchanged = useStore.getState().weeklyRiskPreparations[0]!
  assert(unchanged.reviewedAt === preparation.reviewedAt, '相同内容不得无意义清除复核时间')
  assert(
    unchanged.confirmedPolicyVersionId === preparation.confirmedPolicyVersionId,
    '相同内容不得清除已确认版本关联',
  )

  useStore.getState().saveWeeklyRiskDraft(
    preparation.weekStart,
    { ...preparation.draft, dailyLossLimitR: 3 },
    '2026-07-27T10:00:00.000Z',
  )
  const changed = useStore.getState().weeklyRiskPreparations[0]!
  assert(changed.reviewedAt === null, '草稿内容变化后必须重新复核')
  assert(changed.confirmedPolicyVersionId === null, '草稿内容变化后必须清除已确认版本关联')
}
