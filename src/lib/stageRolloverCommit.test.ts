import type { LiveStage, ScheduledStageRollover } from '@/lib/liveStages'
import type { StageRolloverPublishState } from '@/types/journalBridge'
import fs from 'node:fs/promises'
import {
  classifyUncertainStageRolloverSnapshot,
  createStageRolloverCheck,
  executeDueStageRollover,
  reconcileCommittedStageRollover,
  type StageRolloverCapture,
} from '@/lib/stageRolloverCommit'
import { createEmptyPersistedSnapshot } from '@/storage/emptySnapshot'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const currentStage: LiveStage = {
  id: 'stage-1',
  sequence: 1,
  name: '实盘阶段 1',
  status: 'current',
  startsOn: '2026-08-01',
  endsOn: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  archivedAt: null,
}

const scheduled: ScheduledStageRollover = {
  id: 'rollover-1',
  requestedAt: '2026-08-28T09:00:00.000Z',
  effectiveWeekStart: '2026-08-31',
  postponedCount: 0,
}

function eligibleCapture(overrides: Partial<StageRolloverCapture> = {}): StageRolloverCapture {
  const snapshot = createEmptyPersistedSnapshot()
  snapshot.liveStages = [currentStage]
  snapshot.currentLiveStageId = currentStage.id
  snapshot.scheduledStageRollover = scheduled
  snapshot.weeklyReviews = [{
    id: 'weekly-review:2026-08-24',
    liveStageId: currentStage.id,
    weekStart: '2026-08-24',
    weekEnd: '2026-08-30',
    status: 'completed',
    executionScore: null,
    riskScore: null,
    emotionScore: null,
    strengthTags: [],
    mistakeTags: [],
    highlightTradeIds: [],
    mistakeTradeIds: [],
    followUpTradeIds: [],
    contentHtml: '',
    commitmentText: '',
    commitmentCriteria: '',
    previousCommitmentResult: null,
    metricsSnapshot: null,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    completedAt: '2026-08-30T00:00:00.000Z',
  }]
  return {
    state: stageState(snapshot),
    currentTradingDayKey: '2026-08-31',
    ...overrides,
  }
}

const authoritativePublish: StageRolloverPublishState = {
  liveStages: [{
    ...currentStage,
    status: 'archived',
    endsOn: '2026-08-30',
    archivedAt: '2026-08-31T00:10:00.000Z',
  }, {
    ...currentStage,
    id: 'stage-main-2',
    sequence: 2,
    name: '实盘阶段 2',
    startsOn: '2026-08-31',
    createdAt: '2026-08-31T00:10:00.000Z',
  }],
  currentLiveStageId: 'stage-main-2',
  scheduledStageRollover: null,
}

function stageState(snapshot: ReturnType<typeof createEmptyPersistedSnapshot>): StageRolloverCapture['state'] {
  return {
    liveStages: snapshot.liveStages,
    currentLiveStageId: snapshot.currentLiveStageId,
    scheduledStageRollover: snapshot.scheduledStageRollover,
    trades: snapshot.trades,
    weeklyReviews: snapshot.weeklyReviews ?? [],
    riskPolicyVersions: snapshot.riskPolicyVersions,
  }
}

export async function testPublishOccursOnlyAfterDurableCommit(): Promise<void> {
  const events: string[] = []
  const result = await executeDueStageRollover({
    captureLatest: () => eligibleCapture(),
    flushBeforeCommit: async () => { events.push('flush') },
    commitDurably: async (input) => {
      events.push('commit')
      assert(input.expectedCurrentStageId === 'stage-1', 'durable commit must carry the inspected stage ID')
      assert(input.expectedRollover.id === 'rollover-1', 'durable commit must carry the full inspected schedule')
      assert(!('snapshot' in input), 'renderer durable intent must not include a candidate snapshot')
      return { ok: true, publish: authoritativePublish }
    },
    publish: (publish) => {
      events.push('publish')
      assert(publish === authoritativePublish, 'renderer must publish the main-process authoritative state')
    },
    postpone: async () => { throw new Error('not expected') },
  })
  assert(result.kind === 'committed', 'eligible rollover must commit')
  assert(events.join(',') === 'flush,commit,publish', 'publish must follow durable commit')
}

export async function testCommitFailureNeverPublishesCandidate(): Promise<void> {
  let published = false
  const result = await executeDueStageRollover({
    captureLatest: () => eligibleCapture(),
    flushBeforeCommit: async () => {},
    commitDurably: async () => ({
      ok: false,
      reason: 'backup-failed',
      message: '无法创建重置前备份',
    }),
    publish: () => { published = true },
    postpone: async () => {},
  })
  assert(result.kind === 'failed' && result.reason === 'backup-failed', 'backup failure must be reported')
  assert(!published, 'failed durable commit must preserve old UI state')
}

export async function testLostCommitReplyReloadsAndPublishesCommittedDiskState(): Promise<void> {
  const events: string[] = []
  const result = await executeDueStageRollover({
    captureLatest: () => eligibleCapture(),
    flushBeforeCommit: async () => { events.push('flush') },
    commitDurably: async () => {
      events.push('commit-reply-lost')
      throw new Error('reply channel closed after durable rename')
    },
    recoverAfterCommitError: async (input) => {
      events.push('recover')
      const snapshot = createEmptyPersistedSnapshot()
      snapshot.liveStages = structuredClone(authoritativePublish.liveStages)
      snapshot.currentLiveStageId = authoritativePublish.currentLiveStageId
      snapshot.scheduledStageRollover = null
      return classifyUncertainStageRolloverSnapshot(input, snapshot)
    },
    publish: (publish) => {
      events.push('publish')
      assert(publish.currentLiveStageId === 'stage-main-2', '丢失回包后必须发布磁盘上的新阶段')
    },
    postpone: async () => {},
  })
  assert(result.kind === 'committed', '耐久提交后 IPC 回包丢失必须协调为 committed')
  assert(
    events.join(',') === 'flush,commit-reply-lost,recover,publish',
    '回包丢失后必须先重载磁盘真相再发布，不能保留陈旧 renderer 状态',
  )
}

export async function testLostCommitReplyWithUnchangedDiskRemainsRetryable(): Promise<void> {
  let published = false
  const result = await executeDueStageRollover({
    captureLatest: () => eligibleCapture(),
    flushBeforeCommit: async () => {},
    commitDurably: async () => { throw new Error('write failed before replace') },
    recoverAfterCommitError: async (input) => classifyUncertainStageRolloverSnapshot(
      input,
      eligibleSnapshotForReload(),
    ),
    publish: () => { published = true },
    postpone: async () => {},
  })
  assert(
    result.kind === 'failed' && result.reason === 'write-failed',
    '磁盘仍是完整旧预约时必须保持可重试 write-failed',
  )
  assert(!published, '旧磁盘状态不得误发布为已提交')
}

export async function testLostCommitReplyWithUnknownDiskRequiresRecovery(): Promise<void> {
  const unknown = eligibleSnapshotForReload()
  unknown.scheduledStageRollover = null
  const recoveryMessages: string[] = []
  const result = await executeDueStageRollover({
    captureLatest: () => eligibleCapture(),
    flushBeforeCommit: async () => {},
    commitDurably: async () => { throw new Error('unknown commit reply') },
    recoverAfterCommitError: async (input) => classifyUncertainStageRolloverSnapshot(input, unknown),
    publish: () => { throw new Error('must not publish') },
    postpone: async () => {},
    enterRecoveryRequired: (message) => { recoveryMessages.push(message) },
  })
  assert(
    result.kind === 'failed' && result.reason === 'recovery-required',
    '既非旧预约也非合法新阶段的磁盘状态必须阻止 renderer 继续覆盖',
  )
  assert(recoveryMessages.length === 1, '无法判定磁盘结果时必须立即进入 renderer 停写恢复态')
}

export async function testDurableCommitFollowedByPublishFailureEntersFailClosedRecoveryBeforeUnlock(): Promise<void> {
  const events: string[] = []
  const result = await executeDueStageRollover({
    captureLatest: () => eligibleCapture(),
    flushBeforeCommit: async () => { events.push('flush') },
    commitDurably: async () => {
      events.push('durable-commit')
      return { ok: true, publish: authoritativePublish }
    },
    publish: () => {
      events.push('publish-failed')
      throw new Error('renderer apply failed')
    },
    postpone: async () => {},
    enterRecoveryRequired: () => { events.push('persist-disabled') },
    lockInteraction: () => {
      events.push('lock')
      return () => { events.push('unlock') }
    },
  })

  assert(
    result.kind === 'failed' && result.reason === 'recovery-required',
    '磁盘已提交但 renderer 发布失败不能降级成可重试 write-failed',
  )
  assert(
    events.join(',') === 'lock,flush,durable-commit,publish-failed,persist-disabled,unlock',
    '必须在解除交互锁之前先关闭持久化，避免陈旧 renderer 覆盖新磁盘状态',
  )
}

export async function testRecoveryReloadFailureAlsoEntersFailClosedMode(): Promise<void> {
  let enteredRecovery = 0
  const result = await executeDueStageRollover({
    captureLatest: () => eligibleCapture(),
    flushBeforeCommit: async () => {},
    commitDurably: async () => { throw new Error('lost reply') },
    recoverAfterCommitError: async () => { throw new Error('reload failed') },
    publish: () => { throw new Error('must not publish') },
    postpone: async () => {},
    enterRecoveryRequired: () => { enteredRecovery += 1 },
  })
  assert(result.kind === 'failed' && result.reason === 'recovery-required', '恢复重载失败必须返回 typed recovery-required')
  assert(enteredRecovery === 1, '恢复重载失败必须同步关闭 renderer 持久化')
}

export async function testAuthoritativeReloadMustMatchSafePublishPayload(): Promise<void> {
  let published = false
  let rejected = false
  try {
    await reconcileCommittedStageRollover(authoritativePublish, {
      reloadAuthoritativeSnapshot: async () => eligibleSnapshotForReload(),
      publishDurableSnapshot: () => { published = true },
    })
  } catch {
    rejected = true
  }
  assert(rejected, 'an unrelated reloaded snapshot must not be published')
  assert(!published, 'mismatched reload must stop before Store publication')
}

function eligibleSnapshotForReload() {
  const snapshot = createEmptyPersistedSnapshot()
  snapshot.liveStages = [{ ...currentStage }]
  snapshot.currentLiveStageId = currentStage.id
  snapshot.scheduledStageRollover = { ...scheduled }
  return snapshot
}

export async function testFlushIsFollowedByFreshCaptureAndInspection(): Promise<void> {
  const events: string[] = []
  let captureCount = 0
  const latest = eligibleCapture()
  const result = await executeDueStageRollover({
    captureLatest: () => {
      captureCount += 1
      events.push(`capture-${captureCount}`)
      return latest
    },
    flushBeforeCommit: async () => { events.push('flush') },
    commitDurably: async () => {
      events.push('commit')
      return { ok: true, publish: authoritativePublish }
    },
    publish: () => { events.push('publish') },
    postpone: async () => { throw new Error('not expected') },
  })
  assert(result.kind === 'committed', 'fresh eligible state must commit')
  assert(
    events.join(',') === 'capture-1,flush,capture-2,commit,publish',
    'due rollover must flush and recapture before constructing its durable commit',
  )
}

export async function testBlockedRolloverPersistsOnlyPostponedSchedule(): Promise<void> {
  const capture = eligibleCapture()
  capture.currentTradingDayKey = '2026-09-24'
  capture.state = {
    ...capture.state,
    trades: [{
    id: 'planned-trade',
    ref: 'TRD-planned-trade',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    liveStageId: currentStage.id,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 0,
    exit: null,
    size: 0,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-08-31',
    closedAt: null,
    note: '',
    }],
  }
  const originalStages = capture.state.liveStages
  const postponed: ScheduledStageRollover[] = []
  let committed = false
  let published = false
  const result = await executeDueStageRollover({
    captureLatest: () => capture,
    flushBeforeCommit: async () => {},
    commitDurably: async () => {
      committed = true
      return { ok: true, publish: authoritativePublish }
    },
    publish: () => { published = true },
    postpone: async (next) => { postponed.push(next) },
  })
  assert(result.kind === 'postponed', 'domain blocker must postpone the rollover')
  assert(postponed[0]?.effectiveWeekStart === '2026-09-28', '离线多周后的权威执行必须从当前交易日选择下一周一')
  assert(postponed[0]?.postponedCount === 1, 'postponement counter must advance once')
  assert(capture.state.liveStages === originalStages, 'blocked rollover must retain the old stage graph')
  assert(!committed && !published, 'blocked rollover must not commit or publish a stage candidate')
}

export async function testConcurrentAutomaticChecksShareOneInFlightPromise(): Promise<void> {
  let calls = 0
  const releases: Array<() => void> = []
  const check = createStageRolloverCheck(async () => {
    calls += 1
    await new Promise<void>((resolve) => { releases.push(resolve) })
    return { kind: 'not-scheduled' }
  })
  const first = check()
  const second = check()
  assert(first === second, 'concurrent automatic checks must share one in-flight promise')
  assert(Number(calls) === 1, 'deduplication must execute the underlying check once')
  releases.shift()?.()
  await first
  const third = check()
  assert(Number(calls) === 2, 'a completed check must not block a later business-week check')
  releases.shift()?.()
  await third
}

export async function testDesktopLifecycleInvokesChecksAtEveryRequiredBoundary(): Promise<void> {
  const [app, manager] = await Promise.all([
    fs.readFile('src/App.tsx', 'utf8'),
    fs.readFile('src/components/LiveStageManager.tsx', 'utf8'),
  ])
  assert(app.includes('flushNoteDraftsToStore'), 'rollover check must flush note drafts before the durable boundary')
  assert(app.includes('flushStorageBeforeCutover'), 'rollover check must flush persistence before recapture')
  assert(app.match(/await checkDueStageRollover\(\)/g)?.length === 3, 'all three successful bootstrap paths must check before ready')
  assert(app.includes("document.visibilityState === 'visible'"), 'visibility restoration must be observed')
  assert(app.includes('lastVisibleBusinessWeek'), 'visibility restoration must compare the business week')
  assert(app.includes('STAGE_MANAGEMENT_OPEN_EVENT'), 'App must listen for stage management opening')
  assert(app.includes('createForegroundStageRolloverScheduler'), '持续可见的桌面端必须使用前台边界调度器')
  assert(app.includes("window.addEventListener('focus'"), '窗口 focus 必须立即重新核对到期阶段交接')
  assert(app.includes('useStore.subscribe'), '资料库切换、预约/取消/顺延/提交和显示起点变化必须驱动边界重算')
  assert(app.includes('rolloverScheduler.stop()'), '应用卸载必须清理阶段边界调度器')
  assert(app.includes('reconcileCommittedStageRollover'), 'App must reload and bind the full authoritative snapshot')
  assert(app.includes('publishDurableStoreRefresh'), 'App must replace the autosave baseline during durable refresh')
  assert(app.includes('disablePersistWrites'), '不确定或已提交但发布失败时 App 必须关闭 renderer 持久化')
  assert(app.includes('STORAGE_RECOVERY_REQUIRED_EVENT'), 'App 必须显示统一、不可原地重试的恢复界面')
  assert(manager.includes('notifyStageManagementOpened'), 'stage management must request an immediate due check when opened')
}
