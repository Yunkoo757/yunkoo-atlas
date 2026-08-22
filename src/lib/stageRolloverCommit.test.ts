import type { LiveStage, ScheduledStageRollover } from '@/lib/liveStages'
import type { StageRolloverPublishState } from '@/types/journalBridge'
import fs from 'node:fs/promises'
import {
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
  liveStatsStartTradingDayKey: '2026-08-31',
  livePerformanceCycles: [{
    id: 'legacy-stage-2',
    name: '实盘阶段 2',
    startTradingDayKey: '2026-08-31',
    createdAt: '2026-08-31T00:10:00.000Z',
  }],
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
  assert(app.includes('reconcileCommittedStageRollover'), 'App must reload and bind the full authoritative snapshot')
  assert(app.includes('publishDurableStoreRefresh'), 'App must replace the autosave baseline during durable refresh')
  assert(manager.includes('notifyStageManagementOpened'), 'stage management must request an immediate due check when opened')
}
