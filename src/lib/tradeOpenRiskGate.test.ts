import type { MonthlyRiskLimit, RiskPolicyVersion } from '@/data/riskManagement'
import type { Trade, TradeStatus } from '@/data/trades'
import {
  requestTradeOpenCandidate,
  requiresFirstOpenGate,
  validatePendingFingerprint,
  type TradeOpenRiskGateState,
} from '@/lib/tradeOpenRiskGate'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const policy: RiskPolicyVersion = {
  id: 'policy-2026-07',
  sourceWeekStart: '2026-07-27',
  effectiveTradingDay: '2026-07-01',
  capitalBase: 100_000,
  riskPercent: 1,
  riskAmount: 1_000,
  dailyLossLimitR: 2,
  weeklyLossLimitR: 5,
  monthlyLossLimitRDefault: 10,
  disciplineText: '遵守风险预算',
  confirmedAt: '2026-07-01T00:00:00.000Z',
}

const monthlyLimit: MonthlyRiskLimit = {
  id: 'monthly-risk-limit:2026-07',
  monthKey: '2026-07',
  limitR: 10,
  sourcePolicyVersionId: policy.id,
  lockedAt: '2026-07-01T00:00:00.000Z',
}

function trade(id: string, status: TradeStatus, pnl: number | null = null): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status,
    conviction: 'medium',
    strategyId: 'strategy-1',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: status === 'loss' ? 98 : null,
    size: 1,
    pnl,
    rMultiple: null,
    resultSource: pnl === null ? undefined : 'pnl',
    openedAt: '2026-07-27T08:00:00.000Z',
    closedAt: status === 'loss' ? '2026-07-27T09:00:00.000Z' : null,
    closedTradingDayKey: status === 'loss' ? '2026-07-27' : undefined,
    note: '',
    activities: [{
      id: `activity-${id}-${status}`,
      kind: 'status',
      status,
      timestamp: '2026-07-27T08:00:00.000Z',
    }],
  }
}

function triggeredState(source: 'planned' | 'missed' | 'loss'): TradeOpenRiskGateState {
  const target = trade('target', source, source === 'loss' ? -2_000 : null)
  const loss = trade('loss-history', 'loss', -2_000)
  return {
    trades: source === 'loss' ? [target] : [target, loss],
    riskPolicyVersions: [policy],
    monthlyRiskLimits: [monthlyLimit],
    currentTradingDayKey: '2026-07-27',
    liveStatsStartTradingDayKey: null,
    tradingDayStartHour: 0,
  }
}

export function testEveryFirstLiveOpenRequiresDomainGate(): void {
  for (const source of ['planned', 'missed', 'loss'] as const) {
    const state = triggeredState(source)
    const result = requestTradeOpenCandidate(state, state.trades[0]!.id)
    assert(result.kind === 'confirmation-required', `${source} → open 必须进入 Gate`)
    assert(result.request.decisionType === 'triggered', `${source} 必须保留触线判定`)
  }
}

export function testFingerprintRejectsChangedTradeIdentity(): void {
  const state = triggeredState('planned')
  const candidate = requestTradeOpenCandidate(state, 'target')
  assert(candidate.kind === 'confirmation-required', 'fixture 必须产生 pending request')
  const changed = {
    ...state,
    trades: state.trades.map((item) => item.id === 'target' ? { ...item, tradeKind: 'paper' as const } : item),
  }

  assert(
    validatePendingFingerprint(candidate.request, changed).kind === 'cancelled',
    '目标资格变化应取消',
  )
}

export function testRiskChangeRequiresFreshConfirmation(): void {
  const state = triggeredState('planned')
  const candidate = requestTradeOpenCandidate(state, 'target')
  assert(candidate.kind === 'confirmation-required', 'fixture 必须产生 pending request')
  const changed = {
    ...state,
    monthlyRiskLimits: [{ ...monthlyLimit, id: 'monthly-risk-limit:changed', limitR: 12 }],
  }

  assert(
    validatePendingFingerprint(candidate.request, changed).kind === 'needs-reconfirmation',
    'policy/月限额或三周期结果变化后必须重新确认',
  )
}

export function testOffsetConfirmedPolicyKeepsPendingAndOutcomeAligned(): void {
  const laterInstant = {
    ...policy,
    id: 'policy-later-instant',
    riskAmount: 1_000,
    dailyLossLimitR: 1,
    confirmedAt: '2026-07-01T23:30:00.000-02:00',
  }
  const earlierInstant = {
    ...policy,
    id: 'policy-earlier-instant',
    riskAmount: 2_000,
    dailyLossLimitR: 9,
    confirmedAt: '2026-07-02T00:30:00.000Z',
  }
  const state = {
    ...triggeredState('planned'),
    riskPolicyVersions: [laterInstant, earlierInstant],
    monthlyRiskLimits: [{ ...monthlyLimit, sourcePolicyVersionId: laterInstant.id }],
  }

  const candidate = requestTradeOpenCandidate(state, 'target')

  assert(candidate.kind === 'confirmation-required', '较晚真实瞬时的 1R policy 必须形成触线确认')
  assert(candidate.request.policyVersionId === laterInstant.id, 'pending 必须绑定真实瞬时较晚的 policy')
  assert(candidate.request.outcomes.day.netBudgetR === -2, 'outcome 必须使用同一 policy 的 1R 金额')
  assert(candidate.request.outcomes.day.limitR === 1, 'outcome 限额必须来自 pending 绑定的 policy')
}

export function testRiskBecomingBelowStillInvalidatesOldConfirmation(): void {
  const state = triggeredState('planned')
  const candidate = requestTradeOpenCandidate(state, 'target')
  assert(candidate.kind === 'confirmation-required', 'fixture 必须产生 pending request')
  const changed = { ...state, trades: [state.trades[0]!] }

  assert(
    validatePendingFingerprint(candidate.request, changed).kind === 'needs-reconfirmation',
    '风险变为 below 时也必须废弃旧确认，由最新请求决定是否直接开仓',
  )
}

export function testBelowAndUnconfiguredCleanOpenWithoutOverride(): void {
  const belowState = {
    ...triggeredState('planned'),
    trades: [trade('target', 'planned'), trade('small-loss', 'loss', -500)],
  }
  const below = requestTradeOpenCandidate(belowState, 'target', {
    now: () => '2026-07-27T10:00:00.000Z',
    createActivityId: () => 'activity-open',
  })
  assert(below.kind === 'opened' && below.decision === 'below', '未触线应直接生成 open 候选')
  assert(below.state.trades[0]!.status === 'open', 'below 候选必须包含 open 状态')
  assert(below.state.trades[0]!.activities?.at(-1)?.status === 'open', 'below 候选必须同时包含 open activity')

  const unconfigured = requestTradeOpenCandidate({
    ...belowState,
    trades: [trade('target', 'planned')],
    riskPolicyVersions: [],
    monthlyRiskLimits: [],
  }, 'target')
  assert(
    unconfigured.kind === 'opened' && unconfigured.decision === 'unconfigured-clean',
    '无规则且无未知风险时应直接生成 open 候选',
  )
}

export function testHistoricalMonthlyPolicyGapDoesNotBlockCurrentOpen(): void {
  const currentPolicy = {
    ...policy,
    id: 'policy-current-week',
    effectiveTradingDay: '2026-07-27',
    confirmedAt: '2026-07-27T00:00:00.000Z',
  }
  const historicalLoss = {
    ...trade('historical-loss', 'loss', -1_000),
    openedAt: '2026-07-01T08:00:00.000Z',
    closedAt: '2026-07-01T09:00:00.000Z',
    closedTradingDayKey: '2026-07-01',
  }
  const state = {
    ...triggeredState('planned'),
    trades: [trade('target', 'planned'), historicalLoss],
    riskPolicyVersions: [currentPolicy],
    monthlyRiskLimits: [{ ...monthlyLimit, sourcePolicyVersionId: currentPolicy.id }],
  }

  const result = requestTradeOpenCandidate(state, 'target')

  assert(result.kind === 'opened' && result.decision === 'below', '仅有月内历史规则缺口时不得反复阻断当前开仓')
}

export function testHistoricalMonthlyPolicyGapCannotHideKnownMonthlyBreach(): void {
  const currentPolicy = {
    ...policy,
    id: 'policy-current-month',
    effectiveTradingDay: '2026-07-21',
    confirmedAt: '2026-07-21T00:00:00.000Z',
  }
  const historicalLoss = {
    ...trade('historical-loss-before-policy', 'loss', -1_000),
    openedAt: '2026-07-01T08:00:00.000Z',
    closedAt: '2026-07-01T09:00:00.000Z',
    closedTradingDayKey: '2026-07-01',
  }
  const knownMonthlyLoss = {
    ...trade('known-monthly-breach', 'loss', -10_000),
    openedAt: '2026-07-21T08:00:00.000Z',
    closedAt: '2026-07-21T09:00:00.000Z',
    closedTradingDayKey: '2026-07-21',
  }
  const state = {
    ...triggeredState('planned'),
    trades: [trade('target', 'planned'), historicalLoss, knownMonthlyLoss],
    riskPolicyVersions: [currentPolicy],
    monthlyRiskLimits: [{ ...monthlyLimit, sourcePolicyVersionId: currentPolicy.id }],
    currentTradingDayKey: '2026-07-29',
  }

  const result = requestTradeOpenCandidate(state, 'target')

  assert(result.kind === 'confirmation-required', '历史规则缺口不得掩盖已知月度触线')
  assert(result.request.decisionType === 'triggered', '已知月度亏损达到限额时必须按触线处理')
}

export function testFutureRiskCycleStartFailsClosed(): void {
  const state = {
    ...triggeredState('planned'),
    liveStatsStartTradingDayKey: '2099-01-01',
  }

  const result = requestTradeOpenCandidate(state, 'target')

  assert(result.kind === 'confirmation-required', '未来风险核算起点不得把历史亏损过滤为空')
  assert(result.request.decisionType === 'unknown', '非法未来起点必须 fail-closed')
  assert(result.request.unknownReasons.includes('invalid-live-cycle-start'), '必须保留起点无效原因')
}

export function testLiveCycleMonthlyPolicyGapStillRequiresConfirmation(): void {
  const currentPolicy = {
    ...policy,
    id: 'policy-current-week-with-cycle',
    effectiveTradingDay: '2026-07-27',
    confirmedAt: '2026-07-27T00:00:00.000Z',
  }
  const previousWeekLoss = {
    ...trade('previous-week-loss-with-cycle', 'loss', -1_000),
    openedAt: '2026-07-20T08:00:00.000Z',
    closedAt: '2026-07-20T09:00:00.000Z',
    closedTradingDayKey: '2026-07-20',
  }
  const state = {
    ...triggeredState('planned'),
    trades: [trade('target', 'planned'), previousWeekLoss],
    riskPolicyVersions: [currentPolicy],
    monthlyRiskLimits: [{ ...monthlyLimit, sourcePolicyVersionId: currentPolicy.id }],
    currentTradingDayKey: '2026-07-29',
    liveStatsStartTradingDayKey: '2026-07-01',
  }

  const result = requestTradeOpenCandidate(state, 'target')

  assert(result.kind === 'confirmation-required', '周期已开启时同月前一周规则缺口必须继续确认')
  assert(result.request.decisionType === 'unknown', '周期内缺失规则覆盖必须保持 unknown')
}

export function testCurrentWeekPolicyGapStillRequiresConfirmation(): void {
  const currentPolicy = {
    ...policy,
    id: 'policy-midweek',
    effectiveTradingDay: '2026-07-28',
    confirmedAt: '2026-07-27T12:00:00.000Z',
  }
  const weeklyLoss = {
    ...trade('weekly-loss', 'loss', -1_000),
    closedAt: '2026-07-27T09:00:00.000Z',
    closedTradingDayKey: '2026-07-27',
  }
  const state = {
    ...triggeredState('planned'),
    trades: [trade('target', 'planned'), weeklyLoss],
    riskPolicyVersions: [currentPolicy],
    monthlyRiskLimits: [{ ...monthlyLimit, sourcePolicyVersionId: currentPolicy.id }],
    currentTradingDayKey: '2026-07-29',
  }

  const result = requestTradeOpenCandidate(state, 'target')

  assert(result.kind === 'confirmation-required', '本周亏损缺少适用规则时仍必须确认')
  assert(result.request.decisionType === 'unknown', '本周规则缺口必须保持 unknown 判定')
}

export function testUnknownRequiresConfirmationAndExistingPendingWins(): void {
  const unknownState = {
    ...triggeredState('planned'),
    trades: [
      trade('target', 'planned'),
      { ...trade('unknown-loss', 'loss'), closedAt: null, closedTradingDayKey: undefined },
    ],
  }
  const first = requestTradeOpenCandidate(unknownState, 'target')
  assert(first.kind === 'confirmation-required', '未知风险必须进入确认')
  assert(first.request.decisionType === 'unknown', '必须区分 unknown 确认')

  const second = requestTradeOpenCandidate(
    { ...unknownState, trades: [trade('second', 'planned'), ...unknownState.trades] },
    'second',
    { existingPending: first.request },
  )
  assert(second.kind === 'pending-exists', '第二个请求不得覆盖首个 pending')
  assert(second.request.tradeId === 'target', '必须保留首个 pending 的目标')
}

export function testPendingOutcomesAreIndependentFrozenDisplayEvidence(): void {
  const state = {
    ...triggeredState('planned'),
    trades: [
      trade('target', 'planned'),
      { ...trade('unknown-loss', 'loss'), closedAt: null, closedTradingDayKey: undefined },
    ],
  }
  const candidate = requestTradeOpenCandidate(state, 'target')
  assert(candidate.kind === 'confirmation-required', 'unknown fixture 必须产生 pending')
  const request = candidate.request
  const originalFingerprint = request.fingerprint
  const dayReasons = request.outcomes.day.unknownReasons
  const weekReasons = request.outcomes.week.unknownReasons
  const monthReasons = request.outcomes.month.unknownReasons
  assert(dayReasons !== weekReasons && weekReasons !== monthReasons && dayReasons !== monthReasons, '三周期 reasons 必须各自复制')
  assert(request.unknownReasons !== dayReasons, '顶层 reasons 必须与 period 去别名')

  let periodMutationRejected = false
  let reasonsMutationRejected = false
  let topReasonsMutationRejected = false
  try {
    request.outcomes.day.netBudgetR = 777
  } catch {
    periodMutationRejected = true
  }
  try {
    dayReasons.push('result-conflict')
  } catch {
    reasonsMutationRejected = true
  }
  try {
    request.unknownReasons.push('missing-policy')
  } catch {
    topReasonsMutationRejected = true
  }

  assert(periodMutationRejected && reasonsMutationRejected && topReasonsMutationRejected, 'pending 展示证据必须运行时不可变')
  assert(!weekReasons.includes('result-conflict') && !monthReasons.includes('result-conflict'), '单周期 mutation 不得污染其他周期')
  assert(request.fingerprint === originalFingerprint, 'pending 展示内容不得与已记录 fingerprint 漂移')
  assert(validatePendingFingerprint(request, state).kind === 'valid', '未被篡改的 pending 必须继续通过重算')
}

export function testConfiguredStateWithoutMonthlyLimitFailsClosed(): void {
  const state = {
    ...triggeredState('planned'),
    trades: [trade('target', 'planned')],
    monthlyRiskLimits: [],
  }
  const result = requestTradeOpenCandidate(state, 'target')
  assert(result.kind === 'confirmation-required', '规则已配置但月限额缺失时不得声称 below')
  assert(result.request.decisionType === 'unknown', '缺失物化月限额必须降级为 unknown')
}

export function testOnlyValidHistoricalOpenActivityBypassesFirstGate(): void {
  const state = triggeredState('planned')
  const target = state.trades[0]!
  const historical = {
    ...target,
    activities: [
      { id: 'open', kind: 'status' as const, status: 'open' as const, timestamp: '2026-07-27T07:00:00.000Z' },
      { id: 'planned', kind: 'status' as const, status: 'planned' as const, timestamp: '2026-07-27T08:00:00.000Z' },
    ],
  }
  assert(!requiresFirstOpenGate(historical), '可信历史 open activity 应豁免重复 Gate')

  const futureOpen = {
    ...target,
    activities: [
      { id: 'planned', kind: 'status' as const, status: 'planned' as const, timestamp: '2026-07-27T08:00:00.000Z' },
      { id: 'open', kind: 'status' as const, status: 'open' as const, timestamp: '2026-07-27T09:00:00.000Z' },
    ],
  }
  assert(requiresFirstOpenGate(futureOpen), '晚于当前状态活动的伪 open 证据不得绕过 Gate')

  const invalid = {
    ...target,
    activities: [{ id: 'open', kind: 'status' as const, status: 'open' as const, timestamp: 'not-a-time' }],
  }
  assert(requiresFirstOpenGate(invalid), '结构无效的 open activity 必须 fail-closed')
}

export function testRevertedFirstOpenRequiresGateAgain(): void {
  const before = triggeredState('planned')
  const pending = requestTradeOpenCandidate(before, 'target')
  assert(pending.kind === 'confirmation-required', '首次请求必须 pending')
  assert(
    requiresFirstOpenGate(before.trades[0]!),
    '撤销若恢复到首次 open 前、连同 activity 一起恢复，下一次 open 必须重新 Gate',
  )
}

export function testDomainOpenCandidateNeverCreatesUndoRedoEntries(): void {
  const state = {
    ...triggeredState('planned'),
    trades: [trade('target', 'planned'), trade('small-loss', 'loss', -500)],
    undoStack: ['existing-undo'],
    redoStack: ['existing-redo'],
  }
  const opened = requestTradeOpenCandidate(state, 'target')
  assert(opened.kind === 'opened', 'below fixture 必须直接生成 open 候选')
  assert(opened.state.undoStack === state.undoStack, '首次 open 领域命令不得追加 Undo')
  assert(opened.state.redoStack === state.redoStack, '首次 open 领域命令不得创建可绕过 Gate 的 Redo')
}

export function testRiskGateExcludesPreCycleLossButKeepsBoundaryUnknownFailClosed(): void {
  const state = {
    ...triggeredState('planned'),
    trades: [
      trade('target', 'planned'),
      {
        ...trade('old-loss', 'loss', -2_000),
        openedAt: '2026-07-26',
        closedAt: '2026-07-27T09:00:00.000Z',
        closedTradingDayKey: '2026-07-27',
      },
    ],
    liveStatsStartTradingDayKey: '2026-07-27',
    tradingDayStartHour: 0,
  }

  const below = requestTradeOpenCandidate(state, 'target')
  assert(below.kind === 'opened' && below.decision === 'below', '起点前开仓的旧亏损不得触发当前 Gate')

  const boundaryUnknown = requestTradeOpenCandidate({
    ...state,
    trades: state.trades.map((item) => item.id === 'old-loss' ? {
      ...item,
      openedAt: '2026-07-27',
      pnl: null,
      resultSource: 'r' as const,
      rMultiple: -1,
    } : item),
  }, 'target')
  assert(
    boundaryUnknown.kind === 'confirmation-required' && boundaryUnknown.request.decisionType === 'unknown',
    '起点日开仓的未知亏损必须继续 fail-closed',
  )
}

export function testChangingLiveCycleStartInvalidatesPendingConfirmation(): void {
  const state = {
    ...triggeredState('planned'),
    trades: [trade('target', 'planned')],
    monthlyRiskLimits: [],
  }
  const candidate = requestTradeOpenCandidate(state, 'target')
  assert(candidate.kind === 'confirmation-required', 'fixture 必须因缺少月限额产生 pending')

  const validation = validatePendingFingerprint(candidate.request, {
    ...state,
    liveStatsStartTradingDayKey: '2026-07-27',
  })

  assert(validation.kind === 'needs-reconfirmation', '周期起点变化必须使既有确认失效')
}

export function testChangingTradingDayStartHourInvalidatesPendingConfirmation(): void {
  const state = {
    ...triggeredState('planned'),
    trades: [trade('target', 'planned')],
    monthlyRiskLimits: [],
  }
  const candidate = requestTradeOpenCandidate(state, 'target')
  assert(candidate.kind === 'confirmation-required', 'fixture 必须因缺少月限额产生 pending')

  const validation = validatePendingFingerprint(candidate.request, {
    ...state,
    tradingDayStartHour: 1,
  })

  assert(validation.kind === 'needs-reconfirmation', '交易日起始小时变化必须使既有确认失效')
}
