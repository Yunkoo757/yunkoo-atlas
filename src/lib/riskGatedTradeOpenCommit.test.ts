import type {
  RevisionedLibraryMutation,
  StorageAdapter,
  RevisionedStorageAdapter,
} from '@/storage/adapter'
import { StorageRevisionConflictError } from '@/storage/adapter'
import { isStorageCutoverInteractionLocked } from '@/storage/cutover'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import {
  disablePersistWrites,
  enablePersistWrites,
  getPersistenceDiagnostics,
  getPersistSuspendDepth,
  hasPendingChanges,
  schedulePersist,
} from '@/storage/persist'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import type { PersistedSnapshot } from '@/storage/types'
import { requestTradeOpenCandidate } from '@/lib/tradeOpenRiskGate'
import {
  commitRiskGatedTradeOpen,
  RiskGatePublishAfterCommitError,
  type RiskGateCommitState,
} from '@/lib/riskGatedTradeOpenCommit'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function baseline(): PersistedSnapshot & RiskGateCommitState {
  const snapshot = createFullPersistedSnapshotFixture()
  const loss = {
    ...snapshot.trades[0]!,
    id: 'loss-history',
    ref: 'TRD-LOSS',
    status: 'loss' as const,
    pnl: -200,
    rMultiple: null,
    resultSource: 'pnl' as const,
    closedAt: '2026-07-27T09:00:00.000Z',
    closedTradingDayKey: '2026-07-27',
    activities: [{
      id: 'loss-status',
      kind: 'status' as const,
      status: 'loss' as const,
      timestamp: '2026-07-27T09:00:00.000Z',
    }],
  }
  const target = {
    ...snapshot.trades[0]!,
    id: 'target',
    ref: 'TRD-TARGET',
    status: 'planned' as const,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    closedAt: null,
    closedTradingDayKey: undefined,
    activities: [{
      id: 'target-planned',
      kind: 'status' as const,
      status: 'planned' as const,
      timestamp: '2026-07-27T08:00:00.000Z',
    }],
  }
  return {
    ...snapshot,
    trades: [target, loss],
    riskPolicyVersions: snapshot.riskPolicyVersions.map((item) => ({
      ...item,
      effectiveTradingDay: '2026-07-01',
      dailyLossLimitR: 1.5,
      weeklyLossLimitR: 4.5,
    })),
    riskOverrideEvents: [],
    liveStatsStartTradingDayKey: snapshot.liveStatsStartTradingDayKey ?? null,
  }
}

function pending(snapshot: PersistedSnapshot) {
  const currentStage = snapshot.liveStages.find((stage) => stage.id === snapshot.currentLiveStageId)
  assert(currentStage, 'fixture 必须存在当前阶段')
  const result = requestTradeOpenCandidate({
    trades: snapshot.trades,
    riskPolicyVersions: snapshot.riskPolicyVersions,
    monthlyRiskLimits: snapshot.monthlyRiskLimits,
    currentLiveStageId: currentStage.id,
    currentLiveStageStartsOn: currentStage.startsOn,
    currentTradingDayKey: '2026-07-27',
    tradingDayStartHour: snapshot.display.tradingDayStartHour,
  }, 'target')
  assert(result.kind === 'confirmation-required', 'fixture 必须触发 Gate')
  return result.request
}

function electronAdapter(commit: (snapshot: PersistedSnapshot) => Promise<void>): StorageAdapter {
  return {
    commitImport: (snapshot: PersistedSnapshot) => commit(snapshot),
  } as unknown as StorageAdapter
}

export async function testCycleSettingsSnapshotMismatchRequiresReconfirmation(): Promise<void> {
  const original = baseline()
  const state = {
    ...original,
    liveStatsStartTradingDayKey: null,
    display: { ...original.display, tradingDayStartHour: original.display.tradingDayStartHour },
  }
  let writes = 0

  const result = await commitRiskGatedTradeOpen({
    request: pending(original),
    reason: '周期设置快照不一致',
    storage: electronAdapter(async () => { writes += 1 }),
    captureLatestState: () => ({
      state,
      snapshot: original,
      currentTradingDayKey: '2026-07-27',
    }),
    publish: () => undefined,
  })

  assert(result.kind === 'needs-reconfirmation', '周期设置与持久化快照不一致时必须重新确认')
  assert(writes === 0, '快照不一致时不得写盘')
}

export async function testPublishFailureAfterDurableCommitRequiresReloadAndDiscardsAutosave(): Promise<void> {
  const original = baseline()
  let persisted: PersistedSnapshot = original
  let error: unknown
  try {
    await commitRiskGatedTradeOpen({
      request: pending(original),
      reason: 'publish 失败测试',
      storage: electronAdapter(async (snapshot) => { persisted = snapshot }),
      captureLatestState: () => ({
        state: original,
        snapshot: original,
        currentTradingDayKey: '2026-07-27',
      }),
      publish: () => {
        enablePersistWrites()
        schedulePersist(original)
        throw new Error('store publish failed')
      },
      now: () => '2026-07-27T10:00:00.000Z',
      createActivityId: () => 'activity-open-after-publish-failure',
      createEventId: () => 'override-after-publish-failure',
    })
  } catch (reason) {
    error = reason
  }

  await Promise.resolve()
  await Promise.resolve()

  try {
    assert(error instanceof RiskGatePublishAfterCommitError, 'durable commit 后 publish 失败必须使用专用错误')
    const commitError = error as RiskGatePublishAfterCommitError
    assert(commitError.durablyCommitted && commitError.requiresStorageReload, '错误必须明确要求从 storage reload')
    assert(commitError.cause instanceof Error && commitError.cause.message === 'store publish failed', '错误必须保留 publish cause')
    assert(commitError.committedSnapshot === persisted, '错误必须携带已 durable commit 的完整 snapshot')
    assert(persisted.riskOverrideEvents.at(-1)?.id === 'override-after-publish-failure', '磁盘必须保留完整 event')
    assert(!hasPendingChanges(), 'durable commit 后必须 discard publish 触发的旧 autosave pending')
    assert(getPersistenceDiagnostics().pendingSnapshotCount === 0, '不得留下可覆盖新磁盘的旧快照')
    assert(getPersistSuspendDepth() === 0, 'publish 失败后必须恢复 autosave suspend depth')
    assert(!isStorageCutoverInteractionLocked(), 'publish 失败后必须释放交互锁')
  } finally {
    disablePersistWrites()
  }
}

export async function testPublishMutationCannotChangeFrozenDurableRecoverySnapshot(): Promise<void> {
  const original = baseline()
  const originalPolicyCount = original.riskPolicyVersions.length
  let persisted: PersistedSnapshot | null = null
  let error: unknown
  try {
    await commitRiskGatedTradeOpen({
      request: pending(original),
      reason: 'durable 恢复快照测试',
      storage: electronAdapter(async (snapshot) => { persisted = snapshot }),
      captureLatestState: () => ({
        state: original,
        snapshot: original,
        currentTradingDayKey: '2026-07-27',
      }),
      publish: (state) => {
        const target = state.trades.find((trade) => trade.id === 'target')!
        target.status = 'missed'
        target.activities!.push({
          id: 'publish-only-activity',
          kind: 'status',
          status: 'missed',
          timestamp: '2026-07-27T11:00:00.000Z',
        })
        state.riskPolicyVersions.push({
          ...state.riskPolicyVersions[0]!,
          id: 'publish-only-policy',
        })
        const event = state.riskOverrideEvents.at(-1)!
        event.reason = 'publish 篡改原因'
        event.outcomesAtDecision.day.netBudgetR = 999
        event.outcomesAtDecision.day.unknownReasons.push('missing-policy')
        throw new Error('publish mutated then failed')
      },
      now: () => '2026-07-27T10:00:00.000Z',
      createActivityId: () => 'activity-open-durable-recovery',
      createEventId: () => 'override-durable-recovery',
    })
  } catch (reason) {
    error = reason
  }

  assert(error instanceof RiskGatePublishAfterCommitError, 'publish 失败必须返回 durable recovery error')
  assert(error.cause instanceof Error && error.cause.message === 'publish mutated then failed', '必须保留真实 publish failure')
  assert(!('committedState' in error), '恢复合同不得暴露无法可靠冻结的 committedState')
  const adapterSnapshot = persisted as PersistedSnapshot | null
  assert(error.committedSnapshot === adapterSnapshot, 'error snapshot 必须就是 adapter 实际提交对象')
  const durable = error.committedSnapshot
  const durableTarget = durable.trades.find((trade) => trade.id === 'target')!
  const durableEvent = durable.riskOverrideEvents.at(-1)!
  assert(durableTarget.status === 'open', 'publish 修改 status 不得污染 durable snapshot')
  assert(durableTarget.activities?.at(-1)?.id === 'activity-open-durable-recovery', 'publish activity 不得污染 durable snapshot')
  assert(durable.riskPolicyVersions.length === originalPolicyCount, 'publish policy array 不得污染 durable snapshot')
  assert(durableEvent.reason === 'durable 恢复快照测试', 'publish event 不得污染 durable snapshot')
  assert(durableEvent.outcomesAtDecision.day.netBudgetR !== 999, 'publish outcome 不得污染 durable snapshot')
  assert(durableEvent.outcomesAtDecision.day.unknownReasons.length === 0, 'publish reasons 不得污染 durable snapshot')
  assert(original.riskPolicyVersions.length === originalPolicyCount, 'publish state 不得复用 baseline policy array')

  let snapshotMutationRejected = false
  let snapshotObjectMutationRejected = false
  let errorMutationRejected = false
  let flagsMutationRejected = false
  try {
    durable.trades.push(durableTarget)
  } catch {
    snapshotMutationRejected = true
  }
  try {
    durableTarget.status = 'loss'
  } catch {
    snapshotObjectMutationRejected = true
  }
  try {
    ;(error as unknown as { code: string }).code = 'tampered'
  } catch {
    errorMutationRejected = true
  }
  try {
    ;(error as unknown as { requiresStorageReload: boolean }).requiresStorageReload = false
  } catch {
    flagsMutationRejected = true
  }
  assert(snapshotMutationRejected && Object.isFrozen(durable.trades), 'durable snapshot 数组必须运行时不可变')
  assert(snapshotObjectMutationRejected && Object.isFrozen(durableTarget), 'durable snapshot 对象必须运行时不可变')
  assert(errorMutationRejected && error.code === 'risk-gate-publish-after-commit', 'error code/flags 必须运行时不可写')
  assert(flagsMutationRejected && error.durablyCommitted && error.requiresStorageReload, 'error 恢复 flags 不得变化')
  assert(getPersistSuspendDepth() === 0, 'publish 失败后必须恢复 autosave')
  assert(!isStorageCutoverInteractionLocked(), 'publish 失败后必须释放 cutover lock')
}

export async function testWebPublishFailureAlsoReportsDurableCandidate(): Promise<void> {
  const original = baseline()
  let persisted: PersistedSnapshot | null = null
  const storage = {
    loadSnapshotEnvelope: async () => ({ revision: 31, snapshot: original }),
    commitLibraryMutation: async (input: RevisionedLibraryMutation) => {
      persisted = input.snapshot
      return { revision: 32 }
    },
    commitImport: async () => { throw new Error('Web 不得调用 commitImport') },
  } as unknown as RevisionedStorageAdapter
  let error: unknown
  try {
    await commitRiskGatedTradeOpen({
      request: pending(original),
      reason: 'Web publish 失败测试',
      storage,
      captureLatestState: () => ({
        state: original,
        snapshot: original,
        currentTradingDayKey: '2026-07-27',
      }),
      publish: () => { throw new Error('Web store publish failed') },
    })
  } catch (reason) {
    error = reason
  }

  assert(error instanceof RiskGatePublishAfterCommitError, 'Web durable commit 后也必须返回专用恢复错误')
  assert(error.committedSnapshot === persisted, 'Web 恢复错误必须携带 CAS 已提交候选')
  const webPersisted = persisted as PersistedSnapshot | null
  assert(webPersisted?.trades.find((trade) => trade.id === 'target')?.status === 'open', 'Web 磁盘候选必须完整 open')
  assert(getPersistSuspendDepth() === 0, 'Web publish 失败后必须恢复 autosave')
  assert(!isStorageCutoverInteractionLocked(), 'Web publish 失败后必须释放交互锁')
}

export async function testCommittedOverrideAuditIsDetachedAndImmutable(): Promise<void> {
  const original = baseline()
  const request = pending(original)
  const originalDayNet = request.outcomes.day.netBudgetR
  let persisted: PersistedSnapshot | null = null
  let stateEventMutationApplied = false
  let periodMutationApplied = false
  let reasonsMutationApplied = false
  await commitRiskGatedTradeOpen({
    request,
    reason: '冻结审计测试',
    storage: electronAdapter(async (snapshot) => { persisted = snapshot }),
    captureLatestState: () => ({
      state: original,
      snapshot: original,
      currentTradingDayKey: '2026-07-27',
    }),
    publish: (state) => {
      const event = state.riskOverrideEvents.at(-1)!
      event.reason = '篡改候选 event'
      stateEventMutationApplied = event.reason === '篡改候选 event'
      event.outcomesAtDecision.day.netBudgetR = 123
      periodMutationApplied = event.outcomesAtDecision.day.netBudgetR === 123
      event.outcomesAtDecision.day.unknownReasons.push('invalid-close-date')
      reasonsMutationApplied = event.outcomesAtDecision.day.unknownReasons.length === 1
      state.riskOverrideEvents.push(event)
    },
    now: () => '2026-07-27T10:00:00.000Z',
    createActivityId: () => 'activity-open-frozen-audit',
    createEventId: () => 'override-frozen-audit',
  })

  assert(persisted !== null, 'adapter 必须收到候选 snapshot')
  const persistedSnapshot = persisted as PersistedSnapshot
  const event = persistedSnapshot.riskOverrideEvents.at(-1)!
  assert(stateEventMutationApplied, 'publish state event 应是独立可用副本')
  assert(periodMutationApplied, 'publish state period 应与 durable snapshot 去别名')
  assert(reasonsMutationApplied, 'publish state reasons 应与 durable snapshot 去别名')
  assert(persistedSnapshot.riskOverrideEvents.length === 1, '候选 state 的 event 数组修改不得污染持久 snapshot')
  assert(event.reason === '冻结审计测试', '候选 event 原地修改不得改变持久审计原因')
  assert(event.outcomesAtDecision.day.netBudgetR === originalDayNet, 'pending period 修改不得改变 event')
  assert(event.outcomesAtDecision.day.unknownReasons.length === 0, 'day unknownReasons 必须去别名')
  assert(event.outcomesAtDecision.week.unknownReasons.length === 0, 'week unknownReasons 必须单独去别名')
  assert(event.outcomesAtDecision.month.unknownReasons.length === 0, 'month unknownReasons 必须单独去别名')
  assert(event.unknownReasons.length === 0, '顶层 unknownReasons 必须去别名')
  assert(event.outcomesAtDecision.day !== request.outcomes.day, 'event day 必须复制 pending day')
  assert(event.outcomesAtDecision.week !== request.outcomes.week, 'event week 必须复制 pending week')
  assert(event.outcomesAtDecision.month !== request.outcomes.month, 'event month 必须复制 pending month')
}

export async function testElectronPublishesOnlyAfterAtomicSnapshotCommit(): Promise<void> {
  const original = baseline()
  let persisted: PersistedSnapshot = original
  let published: PersistedSnapshot | null = null
  const result = await commitRiskGatedTradeOpen({
    request: pending(original),
    reason: '达到日止损后只执行 A+ 机会',
    storage: electronAdapter(async (snapshot) => {
      assert(isStorageCutoverInteractionLocked(), 'Electron await 期间必须持有全局交互锁')
      assert(getPersistSuspendDepth() > 0, 'Electron await 期间必须暂停 autosave')
      persisted = snapshot
    }),
    captureLatestState: () => ({
      state: original,
      snapshot: original,
      currentTradingDayKey: '2026-07-27',
    }),
    publish: (state) => { published = state },
    now: () => '2026-07-27T10:00:00.000Z',
    createActivityId: () => 'activity-open',
    createEventId: () => 'override-event',
  })

  assert(result.kind === 'committed', 'Electron 原子提交应成功')
  assert(published !== null, '持久化成功后才应发布 Store')
  const opened = persisted.trades.find((trade) => trade.id === 'target')
  assert(opened?.status === 'open', '持久化候选必须包含 open 状态')
  assert(opened.activities?.at(-1)?.status === 'open', '状态 activity 必须与状态同一快照')
  assert(persisted.riskOverrideEvents.at(-1)?.id === 'override-event', 'override event 必须与状态同一快照')
  assert(
    persisted.riskOverrideEvents.at(-1)?.liveStageId === original.currentLiveStageId,
    '耐久 snapshot 的新 override event 必须属于当前阶段',
  )
  assert(
    (published as PersistedSnapshot).riskOverrideEvents.at(-1)?.liveStageId === original.currentLiveStageId,
    '发布 state 的新 override event 必须与耐久 snapshot 同阶段',
  )
  assertValidPersistedSnapshot(persisted, 'risk gate committed snapshot')
  assert(!isStorageCutoverInteractionLocked(), '成功后必须释放全局交互锁')
  assert(getPersistSuspendDepth() === 0, '成功后必须恢复 autosave')
}

export async function testElectronFailurePublishesNothing(): Promise<void> {
  const original = baseline()
  let published = false
  let failed = false
  try {
    await commitRiskGatedTradeOpen({
      request: pending(original),
      reason: '失败测试仍保留原因',
      storage: electronAdapter(async () => { throw new Error('disk full') }),
      captureLatestState: () => ({
        state: original,
        snapshot: original,
        currentTradingDayKey: '2026-07-27',
      }),
      publish: () => { published = true },
    })
  } catch {
    failed = true
  }
  assert(failed, '磁盘失败必须传播')
  assert(!published, '磁盘失败不得发布候选 Store')
  assert(original.trades[0]!.status === 'planned', '原快照不得被原地修改')
  assert(original.riskOverrideEvents.length === 0, '失败后原快照不得出现 event')
  assert(!isStorageCutoverInteractionLocked(), '失败后必须释放全局交互锁')
  assert(getPersistSuspendDepth() === 0, '失败后必须恢复 autosave')
}

export async function testWebUsesEnvelopeRevisionAndCanonicalBaseline(): Promise<void> {
  const original = baseline()
  let mutation: Parameters<RevisionedStorageAdapter['commitLibraryMutation']>[0] | null = null
  let commitImportCalled = false
  const storage = {
    loadSnapshotEnvelope: async () => ({ revision: 17, snapshot: original }),
    commitLibraryMutation: async (input: RevisionedLibraryMutation) => {
      mutation = input
      return { revision: 18 }
    },
    commitImport: async () => { commitImportCalled = true },
  } as unknown as RevisionedStorageAdapter

  const result = await commitRiskGatedTradeOpen({
    request: pending(original),
    reason: 'Web CAS 测试',
    storage,
    captureLatestState: () => ({
      state: original,
      snapshot: original,
      currentTradingDayKey: '2026-07-27',
    }),
    publish: () => undefined,
  })

  assert(result.kind === 'committed', 'Web CAS 应提交成功')
  const committedMutation = mutation as RevisionedLibraryMutation | null
  assert(committedMutation?.expectedRevision === 17, 'Web 必须使用 envelope 的真实 revision')
  assert(committedMutation?.reason === 'risk-gate', 'Web mutation 必须标记 risk-gate')
  assert(!commitImportCalled, 'revisioned adapter 不得退回 commitImport')
}

export async function testWebBaselineOrFingerprintRaceRequiresReconfirmation(): Promise<void> {
  const original = baseline()
  const changedOnDisk = { ...original, starredIds: ['concurrent-change'] }
  let commits = 0
  const storage = {
    loadSnapshotEnvelope: async () => ({ revision: 4, snapshot: changedOnDisk }),
    commitLibraryMutation: async () => { commits += 1; return { revision: 5 } },
    commitImport: async () => undefined,
  } as unknown as RevisionedStorageAdapter
  const baselineRace = await commitRiskGatedTradeOpen({
    request: pending(original),
    reason: '竞态测试',
    storage,
    captureLatestState: () => ({
      state: original,
      snapshot: original,
      currentTradingDayKey: '2026-07-27',
    }),
    publish: () => { throw new Error('不应发布') },
  })
  assert(baselineRace.kind === 'needs-reconfirmation', '磁盘 canonical baseline 变化必须重新确认')
  assert(commits === 0, 'baseline 变化不得发起 CAS')

  const request = pending(original)
  const changedState = {
    ...original,
    monthlyRiskLimits: original.monthlyRiskLimits.map((item) => ({ ...item, limitR: item.limitR + 1 })),
  }
  const fingerprintRace = await commitRiskGatedTradeOpen({
    request,
    reason: '指纹竞态测试',
    storage: electronAdapter(async () => { throw new Error('不应写盘') }),
    captureLatestState: () => ({
      state: changedState,
      snapshot: changedState,
      currentTradingDayKey: '2026-07-27',
    }),
    publish: () => { throw new Error('不应发布') },
  })
  assert(fingerprintRace.kind === 'needs-reconfirmation', '最新 state 指纹变化必须重新确认')
}

export async function testTradingDayRolloverAndCasConflictPublishNothing(): Promise<void> {
  const original = baseline()
  let publishes = 0
  let writes = 0
  const dayChanged = await commitRiskGatedTradeOpen({
    request: pending(original),
    reason: '跨日重算测试',
    storage: electronAdapter(async () => { writes += 1 }),
    captureLatestState: () => ({
      state: original,
      snapshot: original,
      currentTradingDayKey: '2026-07-28',
    }),
    publish: () => { publishes += 1 },
  })
  assert(dayChanged.kind === 'needs-reconfirmation', '业务日变化必须从最新日期重算 fingerprint')
  assert(writes === 0 && publishes === 0, '跨日重算失败不得写盘或发布')

  const storage = {
    loadSnapshotEnvelope: async () => ({ revision: 9, snapshot: original }),
    commitLibraryMutation: async () => {
      throw new StorageRevisionConflictError(9, 10)
    },
    commitImport: async () => undefined,
  } as unknown as RevisionedStorageAdapter
  const conflict = await commitRiskGatedTradeOpen({
    request: pending(original),
    reason: 'CAS 冲突测试',
    storage,
    captureLatestState: () => ({
      state: original,
      snapshot: original,
      currentTradingDayKey: '2026-07-27',
    }),
    publish: () => { publishes += 1 },
  })
  assert(conflict.kind === 'needs-reconfirmation', 'CAS 冲突必须要求基于最新 state 重新确认')
  assert(publishes === 0, 'CAS 冲突不得发布 Store')
  assert(getPersistSuspendDepth() === 0, 'CAS 冲突后必须恢复 autosave')
  assert(!isStorageCutoverInteractionLocked(), 'CAS 冲突后必须释放交互锁')
}
