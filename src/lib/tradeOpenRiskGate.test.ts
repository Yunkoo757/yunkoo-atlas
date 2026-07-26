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
