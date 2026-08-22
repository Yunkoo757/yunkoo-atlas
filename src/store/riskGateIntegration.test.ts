import type { MonthlyRiskLimit, RiskPolicyVersion } from '@/data/riskManagement'
import type { Trade, TradeStatus } from '@/data/trades'
import { getTradingDayKey } from '@/lib/periods'
import { useStore } from '@/store/useStore'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const today = getTradingDayKey(new Date(), 0)
const monthKey = today.slice(0, 7)

const policy: RiskPolicyVersion = {
  id: 'policy-task-6',
  liveStageId: 'stage-current',
  sourceWeekStart: '2026-07-20',
  effectiveTradingDay: '2026-07-01',
  capitalBase: 100_000,
  riskPercent: 1,
  riskAmount: 1_000,
  dailyLossLimitR: 2,
  weeklyLossLimitR: 5,
  monthlyLossLimitRDefault: 10,
  disciplineText: '触线后停止开仓，先复核执行偏差。',
  confirmedAt: '2026-07-20T01:00:00.000Z',
}

const monthlyLimit: MonthlyRiskLimit = {
  id: `monthly-risk-limit:${monthKey}`,
  liveStageId: 'stage-current',
  monthKey,
  limitR: 10,
  sourcePolicyVersionId: policy.id,
  lockedAt: policy.confirmedAt,
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
    resultSource: pnl == null ? undefined : 'pnl',
    openedAt: `${today}T01:00:00.000Z`,
    closedAt: status === 'loss' ? `${today}T02:00:00.000Z` : null,
    closedTradingDayKey: status === 'loss' ? today : undefined,
    note: '',
    activities: [{
      id: `activity-${id}-${status}`,
      kind: 'status',
      status,
      timestamp: `${today}T01:00:00.000Z`,
    }],
  }
}

function restore(previous: ReturnType<typeof useStore.getState>): void {
  useStore.setState({
    trades: previous.trades,
    weeklyRiskPreparations: previous.weeklyRiskPreparations,
    riskPolicyVersions: previous.riskPolicyVersions,
    monthlyRiskLimits: previous.monthlyRiskLimits,
    riskOverrideEvents: previous.riskOverrideEvents,
    liveStatsStartTradingDayKey: previous.liveStatsStartTradingDayKey,
    pendingTradeOpenRequest: previous.pendingTradeOpenRequest,
    riskSetupTradeOpenRequest: previous.riskSetupTradeOpenRequest,
    undoStack: previous.undoStack,
    redoStack: previous.redoStack,
    display: previous.display,
  })
}

function setGateFixture(trades: Trade[]): void {
  useStore.setState((state) => ({
    trades: trades.map((item) => ({ ...item, liveStageId: state.currentLiveStageId })),
    weeklyRiskPreparations: [],
    riskPolicyVersions: [{ ...policy, liveStageId: state.currentLiveStageId }],
    monthlyRiskLimits: [{ ...monthlyLimit, liveStageId: state.currentLiveStageId }],
    riskOverrideEvents: [],
    liveStatsStartTradingDayKey: null,
    pendingTradeOpenRequest: null,
    riskSetupTradeOpenRequest: null,
    undoStack: [],
    redoStack: [],
    display: { ...state.display, tradingDayStartHour: 0 },
  }))
}

export function testPublicSetStatusFailsClosedForEveryFirstLiveOpenSource(): void {
  const previous = useStore.getState()
  try {
    for (const source of ['planned', 'missed', 'loss'] as const) {
      const target = trade(`target-${source}`, source, source === 'loss' ? -2_000 : null)
      setGateFixture(source === 'loss' ? [target] : [target, trade(`loss-${source}`, 'loss', -2_000)])

      const result = useStore.getState().setStatus(target.id, 'open')

      assert(result === 'requires-risk-gate', `${source} → open 必须 fail-closed`)
      assert(useStore.getState().trades[0]?.status === source, `${source} → open 不得提前改状态`)
      assert(useStore.getState().pendingTradeOpenRequest === null, '通用 setStatus 不得偷偷打开确认框')
    }
  } finally {
    restore(previous)
  }
}

export function testInteractiveOpenPathsExplicitlyRejectHistoricalOrUnownedTrades(): void {
  const previous = useStore.getState()
  try {
    for (const liveStageId of ['stage-old', null] as const) {
      const target = { ...trade(`historical-${String(liveStageId)}`, 'planned'), liveStageId }
      setGateFixture([])
      useStore.setState({ trades: [target] })

      assert(useStore.getState().requestTradeOpen(target.id) === 'not-current-stage', 'requestTradeOpen 必须明确拒绝历史/null 交易')
      assert(useStore.getState().setStatus(target.id, 'open') === 'not-current-stage', 'setStatus 必须明确拒绝历史/null 交易')
      assert(useStore.getState().upsertTrade({ ...target, status: 'open' }) === 'not-current-stage', 'upsertTrade 必须明确拒绝历史/null 交易')
      assert(useStore.getState().upsertTrades([{ ...target, status: 'open' }]) === 'not-current-stage', 'upsertTrades 必须明确拒绝历史/null 交易')
      assert(useStore.getState().getById(target.id)?.status === 'planned', '所有公开路径都不得静默迁移或开仓')
    }
  } finally {
    restore(previous)
  }
}

export function testFirstOpenIsBlockedUntilCurrentStageRiskSetup(): void {
  const previous = useStore.getState()
  try {
    const currentStage = previous.liveStages.find((stage) => stage.id === previous.currentLiveStageId)
    assert(currentStage, 'fixture 必须存在当前阶段')
    const target = { ...trade('stage-new-target', 'planned'), liveStageId: currentStage.id }
    useStore.setState((state) => ({
      trades: [target, { ...trade('stage-new-unknown', 'loss'), liveStageId: currentStage.id, closedAt: null }],
      weeklyRiskPreparations: [],
      riskPolicyVersions: [{ ...policy, liveStageId: 'stage-old' }],
      monthlyRiskLimits: [{ ...monthlyLimit, liveStageId: 'stage-old', limitR: 1 }],
      riskOverrideEvents: [],
      liveStatsStartTradingDayKey: '2000-01-01',
      pendingTradeOpenRequest: null,
      display: { ...state.display, tradingDayStartHour: 0 },
    }))

    const result = useStore.getState().requestTradeOpen(target.id)

    assert(result === 'requires-risk-setup', '新阶段第一次开仓必须先返回 requires-risk-setup')
    assert(useStore.getState().trades[0]?.status === 'planned', '未建档不得开仓')
    assert(useStore.getState().pendingTradeOpenRequest === null, '未建档不得提供填写原因绕过入口')
  } finally {
    restore(previous)
  }
}

export function testRequestTradeOpenBranchesNeverEnterUndoOrRedoHistory(): void {
  const previous = useStore.getState()
  try {
    const scenarios: Array<{ name: string; trades: Trade[]; expected: string }> = [
      {
        name: 'below',
        trades: [trade('target-below', 'planned'), trade('small-loss', 'loss', -500)],
        expected: 'opened',
      },
      {
        name: 'triggered',
        trades: [trade('target-triggered', 'planned'), trade('full-loss', 'loss', -2_000)],
        expected: 'pending-confirmation',
      },
      {
        name: 'unknown',
        trades: [
          trade('target-unknown', 'planned'),
          { ...trade('unknown-loss', 'loss'), closedAt: null, closedTradingDayKey: undefined },
        ],
        expected: 'pending-confirmation',
      },
    ]

    for (const scenario of scenarios) {
      setGateFixture(scenario.trades)
      const target = scenario.trades[0]!
      const result = useStore.getState().requestTradeOpen(target.id)

      assert(result === scenario.expected, `${scenario.name} 分支返回值错误`)
      assert(useStore.getState().undoStack.length === 0, `${scenario.name} 不得写 undoStack`)
      assert(useStore.getState().redoStack.length === 0, `${scenario.name} 不得写 redoStack`)
    }
  } finally {
    restore(previous)
  }
}

export function testExplicitCorrectionPreservesTrustedOpenAuditFact(): void {
  const previous = useStore.getState()
  try {
    const target = trade('target-correction', 'planned')
    setGateFixture([target, trade('small-loss-correction', 'loss', -500)])
    assert(useStore.getState().requestTradeOpen(target.id) === 'opened', '首次 below 应直接开仓')
    const trustedOpenActivity = useStore.getState().trades[0]?.activities?.at(-1)
    assert(trustedOpenActivity?.status === 'open', '首次开仓必须留下可信 open activity')

    useStore.getState().setStatus(target.id, 'planned')
    const historyLength = useStore.getState().undoStack.length
    assert(useStore.getState().requestTradeOpen(target.id) === 'opened', '有可信证据后再 open 应视为修正')

    const state = useStore.getState()
    assert(state.pendingTradeOpenRequest === null, '修正 open 不应再次要求确认')
    assert(state.riskOverrideEvents.length === 0, 'below 首次开仓与后续修正都不应生成 override event')
    assert(state.undoStack.length === historyLength, 'requestTradeOpen 修正不得进入 undo/redo')
    assert(
      state.trades[0]?.activities?.some((activity) => activity.id === trustedOpenActivity.id),
      '离开再回 open 必须保留既有审计事实',
    )
  } finally {
    restore(previous)
  }
}

export function testPublicUpsertsFailClosedForFirstLiveOpen(): void {
  const previous = useStore.getState()
  try {
    const planned = trade('upsert-target', 'planned')
    setGateFixture([planned])

    const singleResult = useStore.getState().upsertTrade({ ...planned, status: 'open' })
    assert(singleResult === 'requires-risk-gate', 'upsertTrade 首次 live open 必须 fail-closed')
    assert(useStore.getState().trades[0]?.status === 'planned', 'upsertTrade 不得提前写 open')

    const batchResult = useStore.getState().upsertTrades([{ ...planned, status: 'open' }])
    assert(batchResult === 'requires-risk-gate', 'upsertTrades 首次 live open 必须 fail-closed')
    assert(useStore.getState().trades[0]?.status === 'planned', 'upsertTrades 不得提前写 open')
  } finally {
    restore(previous)
  }
}

export function testNamedNonInteractiveImportCanRestoreOpenTrades(): void {
  const previous = useStore.getState()
  try {
    setGateFixture([])
    const imported = { ...trade('imported-open', 'planned'), status: 'open' as const }

    useStore.getState().upsertTradesFromNonInteractiveImport([imported])

    assert(useStore.getState().trades[0]?.status === 'open', '命名导入入口应保真恢复 open')
    assert(useStore.getState().pendingTradeOpenRequest === null, '历史导入不得误触交互 Gate')
  } finally {
    restore(previous)
  }
}

export function testDeletedPublicUpsertCannotDeferFirstOpenUntilRestore(): void {
  const previous = useStore.getState()
  try {
    const deletedAt = `${today}T03:00:00.000Z`
    const deletedPlanned = { ...trade('deleted-upsert-target', 'planned'), deletedAt }
    setGateFixture([deletedPlanned])

    const result = useStore.getState().upsertTrade({ ...deletedPlanned, status: 'open' })
    assert(result === 'requires-risk-gate', '已删除 live 的公开 upsert open 仍必须 fail-closed')
    useStore.getState().restoreTrade(deletedPlanned.id)
    assert(useStore.getState().trades[0]?.status === 'planned', 'restore 不得显露此前绕过 Gate 写入的 open')

    const newDeletedOpen = { ...trade('new-deleted-open', 'planned'), status: 'open' as const, deletedAt }
    const batchResult = useStore.getState().upsertTrades([newDeletedOpen])
    assert(batchResult === 'requires-risk-gate', '新建 deleted live open 也不得通过公开批量入口')
    assert(!useStore.getState().trades.some((item) => item.id === newDeletedOpen.id), '被拒绝的新建 deleted open 不得写入 Store')
  } finally {
    restore(previous)
  }
}
