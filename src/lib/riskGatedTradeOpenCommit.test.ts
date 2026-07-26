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
} from '@/lib/riskGatedTradeOpenCommit'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function baseline(): PersistedSnapshot {
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
  }
}

function pending(snapshot: PersistedSnapshot) {
  const result = requestTradeOpenCandidate({
    trades: snapshot.trades,
    riskPolicyVersions: snapshot.riskPolicyVersions,
    monthlyRiskLimits: snapshot.monthlyRiskLimits,
    currentTradingDayKey: '2026-07-27',
  }, 'target')
  assert(result.kind === 'confirmation-required', 'fixture 必须触发 Gate')
  return result.request
}

function electronAdapter(commit: (snapshot: PersistedSnapshot) => Promise<void>): StorageAdapter {
  return {
    commitImport: (snapshot: PersistedSnapshot) => commit(snapshot),
  } as unknown as StorageAdapter
}

export async function testPublishFailureAfterDurableCommitRequiresReloadAndDiscardsAutosave(): Promise<void> {
  const original = baseline()
  let persisted = original
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
    const commitError = error as RiskGatePublishAfterCommitError<PersistedSnapshot>
    assert(commitError.durablyCommitted && commitError.requiresStorageReload, '错误必须明确要求从 storage reload')
    assert(commitError.cause instanceof Error && commitError.cause.message === 'store publish failed', '错误必须保留 publish cause')
    assert(commitError.committedSnapshot === persisted, '错误必须携带已 durable commit 的完整 snapshot')
    assert(commitError.committedState.trades.find((trade) => trade.id === 'target')?.status === 'open', '错误必须携带候选 state')
    assert(persisted.riskOverrideEvents.at(-1)?.id === 'override-after-publish-failure', '磁盘必须保留完整 event')
    assert(!hasPendingChanges(), 'durable commit 后必须 discard publish 触发的旧 autosave pending')
    assert(getPersistenceDiagnostics().pendingSnapshotCount === 0, '不得留下可覆盖新磁盘的旧快照')
    assert(getPersistSuspendDepth() === 0, 'publish 失败后必须恢复 autosave suspend depth')
    assert(!isStorageCutoverInteractionLocked(), 'publish 失败后必须释放交互锁')
  } finally {
    disablePersistWrites()
  }
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
  let stateEventWasImmutable = false
  let periodWasImmutable = false
  let reasonsWereImmutable = false
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
      request.outcomes.day.netBudgetR = 999
      request.outcomes.day.unknownReasons.push('missing-policy')
      request.outcomes.week.unknownReasons.push('result-conflict')
      request.outcomes.month.unknownReasons.push('missing-loss-pnl')
      request.unknownReasons.push('future-loss-close-date')
      try {
        event.reason = '篡改候选 event'
      } catch {
        stateEventWasImmutable = true
      }
      try {
        event.outcomesAtDecision.day.netBudgetR = 123
      } catch {
        periodWasImmutable = true
      }
      try {
        event.outcomesAtDecision.day.unknownReasons.push('invalid-close-date')
      } catch {
        reasonsWereImmutable = true
      }
      state.riskOverrideEvents.push(event)
    },
    now: () => '2026-07-27T10:00:00.000Z',
    createActivityId: () => 'activity-open-frozen-audit',
    createEventId: () => 'override-frozen-audit',
  })

  assert(persisted !== null, 'adapter 必须收到候选 snapshot')
  const persistedSnapshot = persisted as PersistedSnapshot
  const event = persistedSnapshot.riskOverrideEvents.at(-1)!
  assert(stateEventWasImmutable, '候选 state 与 snapshot 共享的 event 必须深层不可变')
  assert(periodWasImmutable, '每个 period 审计对象必须不可变')
  assert(reasonsWereImmutable, '每个 period 的 unknownReasons 必须不可变')
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
  let persisted = original
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
