import fs from 'node:fs'
import path from 'node:path'
import type { Trade } from '../../src/data/trades'
import type { ScheduledStageRollover } from '../../src/lib/liveStages'
import { applySnapshotToStore } from '../../src/lib/importExport'
import { reconcileCommittedStageRollover } from '../../src/lib/stageRolloverCommit'
import { pickPersisted } from '../../src/storage/persist'
import { createPersistedSnapshotCoordinator } from '../../src/storage/persistedSnapshotCoordinator'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import { assertValidPersistedSnapshot } from '../../src/storage/snapshotValidation'
import type { PersistedSnapshot } from '../../src/storage/types'
import { useShortcutStore } from '../../src/store/shortcutStore'
import { useStore } from '../../src/store/useStore'
import type {
  StageRolloverCommitInput,
  StageRolloverCommitResult,
} from '../../src/types/journalBridge'
import {
  commitDueStageRollover,
  type StageRolloverCommitDependencies,
  type StageRolloverCommitStorage,
} from './stageRolloverCommit'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const scheduled: ScheduledStageRollover = {
  id: 'rollover-1',
  requestedAt: '2026-08-28T09:00:00.000Z',
  effectiveWeekStart: '2026-08-31',
  postponedCount: 0,
}

function eligibleSnapshot(): PersistedSnapshot {
  const snapshot = createEmptyPersistedSnapshot()
  snapshot.liveStages = [{
    id: 'stage-1',
    sequence: 1,
    name: '实盘阶段 1',
    status: 'current',
    startsOn: '2026-08-01',
    endsOn: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    archivedAt: null,
  }]
  snapshot.currentLiveStageId = 'stage-1'
  snapshot.scheduledStageRollover = { ...scheduled }
  snapshot.weeklyReviews = [{
    id: 'weekly-review:2026-08-24',
    liveStageId: 'stage-1',
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
  return snapshot
}

function commitInput(overrides: Partial<StageRolloverCommitInput> = {}): StageRolloverCommitInput {
  return {
    expectedCurrentStageId: 'stage-1',
    expectedRollover: { ...scheduled },
    ...overrides,
  }
}

interface Harness {
  deps: StageRolloverCommitDependencies
  events: string[]
  saved: PersistedSnapshot[]
  errors: string[]
  storage: StageRolloverCommitStorage
  backupSnapshots: PersistedSnapshot[]
}

function createHarness(
  current: PersistedSnapshot | null = eligibleSnapshot(),
  failures: Partial<Record<'reload' | 'backup' | 'verify-throw' | 'verify-invalid' | 'validate' | 'save', true>> = {},
): Harness {
  const events: string[] = []
  const saved: PersistedSnapshot[] = []
  const errors: string[] = []
  const backupSnapshots: PersistedSnapshot[] = []
  const storage: StageRolloverCommitStorage = {
    loadSnapshot: () => {
      events.push('reload')
      if (failures.reload) throw new Error('D:\\private\\journal.db')
      return current ? structuredClone(current) : null
    },
    saveSnapshot: (candidate) => {
      events.push('save')
      if (failures.save) throw new Error('D:\\private\\journal.db')
      saved.push(structuredClone(candidate))
    },
  }
  const deps: StageRolloverCommitDependencies = {
    runExclusive: async (operation) => {
      events.push('exclusive')
      return operation()
    },
    loadStorage: async () => {
      events.push('storage')
      return storage
    },
    createBackup: (received) => {
      events.push('backup')
      assert(received === storage, 'backup must use the same storage reloaded inside the exclusive gate')
      const snapshot = received.loadSnapshot()
      if (snapshot) backupSnapshots.push(structuredClone(snapshot))
      return failures.backup ? null : 'opaque-backup-reference'
    },
    verifyBackup: async (received, reference) => {
      events.push('verify')
      assert(received === storage, 'verification must remain bound to the reloaded storage')
      assert(reference === 'opaque-backup-reference', 'verification must receive only the backup adapter reference')
      if (failures['verify-throw']) throw new Error('D:\\private\\backups\\secret.zip')
      return failures['verify-invalid']
        ? { status: 'invalid', checkedAt: 1, error: 'D:\\private\\backups\\secret.zip' }
        : { status: 'verified', checkedAt: 1 }
    },
    validateSnapshot: (candidate) => {
      events.push('validate')
      if (failures.validate) throw new Error('candidate rejected')
      assertValidPersistedSnapshot(candidate, 'stage rollover behavior test')
    },
    now: () => new Date(2026, 7, 31, 12, 0, 0),
    createStageId: () => 'stage-main-2',
    reportError: (event) => { errors.push(event) },
  }
  return { deps, events, saved, errors, storage, backupSnapshots }
}

function plannedTrade(status: 'planned' | 'open'): Trade {
  return {
    id: `${status}-trade`,
    ref: `TRD-${status}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status,
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    liveStageId: 'stage-1',
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
  }
}

export async function testRendererCandidateFieldsAreRejectedWithoutWrites(): Promise<void> {
  const harness = createHarness()
  const maliciousInput = {
    ...commitInput(),
    snapshot: { ...eligibleSnapshot(), tagPresets: ['renderer 覆盖'] },
    nextStageId: 'renderer-controlled-id',
    now: '1999-01-01T00:00:00.000Z',
  } as StageRolloverCommitInput

  const result = await commitDueStageRollover(maliciousInput, harness.deps)
  assert(!result.ok && result.reason === 'stale', 'renderer candidate fields must invalidate the intent')
  assert(harness.saved.length === 0 && !harness.events.includes('backup'), 'invalid renderer candidate must not write')
}

export async function testConcurrentNonStageFieldsArePreservedFromReloadedSnapshot(): Promise<void> {
  const current = eligibleSnapshot()
  current.tagPresets = ['主进程并发新增']
  const harness = createHarness(current)
  const result = await commitDueStageRollover(commitInput(), harness.deps)
  assert(result.ok, 'eligible minimal intent must succeed')
  assert(harness.saved.length === 1, 'eligible commit must durably save exactly once')
  const saved = harness.saved[0]!
  assert(saved.tagPresets?.[0] === '主进程并发新增', 'renderer snapshot must not overwrite current non-stage fields')
  assert(saved.currentLiveStageId === 'stage-main-2', 'new stage ID must be generated by the main process')
  assert(harness.backupSnapshots[0]?.tagPresets?.[0] === '主进程并发新增', 'backup must come from the reloaded current library')
  assert(!('snapshot' in result.publish), 'publish result must not expose the private library snapshot')
  assert(!('path' in result.publish) && !('backupPath' in result.publish), 'publish result must not expose storage paths')
}

export async function testFullScheduledStateIsPartOfStaleCheck(): Promise<void> {
  const changedSchedules: ScheduledStageRollover[] = [
    { ...scheduled, requestedAt: '2026-08-28T10:00:00.000Z' },
    { ...scheduled, effectiveWeekStart: '2026-09-07' },
    { ...scheduled, postponedCount: 1 },
  ]
  for (const changed of changedSchedules) {
    const current = eligibleSnapshot()
    current.scheduledStageRollover = changed
    const harness = createHarness(current)
    const result = await commitDueStageRollover(commitInput(), harness.deps)
    assert(!result.ok && result.reason === 'stale', 'same rollover ID with any changed schedule content must be stale')
    assert(!harness.events.includes('backup') && harness.saved.length === 0, 'stale state must not back up or save')
  }
}

export async function testNotDueAndAllBlockersNeverReachDurableWrites(): Promise<void> {
  const cases: Array<{ label: string; mutate(snapshot: PersistedSnapshot): void }> = [
    {
      label: 'not due',
      mutate: (snapshot) => { snapshot.scheduledStageRollover!.effectiveWeekStart = '2026-09-07' },
    },
    {
      label: 'planned trade',
      mutate: (snapshot) => { snapshot.trades = [plannedTrade('planned')] },
    },
    {
      label: 'open trade',
      mutate: (snapshot) => { snapshot.trades = [plannedTrade('open')] },
    },
    {
      label: 'weekly review incomplete',
      mutate: (snapshot) => { snapshot.weeklyReviews = [] },
    },
  ]
  for (const testCase of cases) {
    const current = eligibleSnapshot()
    testCase.mutate(current)
    const harness = createHarness(current)
    const input = commitInput({ expectedRollover: structuredClone(current.scheduledStageRollover!) })
    const result = await commitDueStageRollover(input, harness.deps)
    assert(!result.ok, `${testCase.label} must not report success`)
    assert(!harness.events.includes('backup'), `${testCase.label} must stop before backup`)
    assert(harness.saved.length === 0, `${testCase.label} must not save`)
  }
}

export async function testMainClockUsesReloadedDisplayTradingDayBoundary(): Promise<void> {
  const current = eligibleSnapshot()
  current.display.tradingDayStartHour = 4
  const harness = createHarness(current)
  harness.deps.now = () => new Date(2026, 7, 31, 3, 30, 0)
  const result = await commitDueStageRollover(commitInput(), harness.deps)
  assert(!result.ok, 'before the configured display boundary the rollover must remain not due')
  assert(!harness.events.includes('backup') && harness.saved.length === 0, 'display-boundary not-due must not write')
}

export async function testEveryDurabilityFailureIsNonSuccessAndNeverCommits(): Promise<void> {
  const cases: Array<{
    failure: Parameters<typeof createHarness>[1]
    reason: Exclude<StageRolloverCommitResult, { ok: true }>['reason']
  }> = [
    { failure: { reload: true }, reason: 'write-failed' },
    { failure: { backup: true }, reason: 'backup-failed' },
    { failure: { 'verify-throw': true }, reason: 'backup-failed' },
    { failure: { 'verify-invalid': true }, reason: 'backup-failed' },
    { failure: { validate: true }, reason: 'validation-failed' },
    { failure: { save: true }, reason: 'write-failed' },
  ]
  for (const testCase of cases) {
    const harness = createHarness(eligibleSnapshot(), testCase.failure)
    const result = await commitDueStageRollover(commitInput(), harness.deps)
    assert(!result.ok && result.reason === testCase.reason, `failure must map to ${testCase.reason}`)
    assert(harness.saved.length === 0, `${testCase.reason} must not commit a candidate`)
    assert(!result.message.includes('private') && !result.message.includes('\\'), 'failure result must not leak a path')
  }
}

export async function testSuccessfulCommitOrderAndAuthoritativePublishState(): Promise<void> {
  const harness = createHarness()
  const result = await commitDueStageRollover(commitInput(), harness.deps)
  assert(result.ok, 'eligible commit must succeed')
  assert(
    harness.events.join(',') === 'exclusive,storage,reload,backup,reload,verify,validate,save',
    'commit order must be exclusive, reload, backup, verify, validate, save',
  )
  const saved = harness.saved[0]!
  assert(result.publish.currentLiveStageId === saved.currentLiveStageId, 'publish pointer must come from durable candidate')
  assert(result.publish.liveStages.length === saved.liveStages.length, 'publish stages must come from durable candidate')
  assert(result.publish.scheduledStageRollover === null, 'successful publish must clear the schedule')
  assert(
    result.publish.liveStages.find((stage) => stage.id === result.publish.currentLiveStageId)?.status === 'current',
    'publish state must expose the durable canonical current stage',
  )
}

export async function testCommittedReloadReconcilesStoreWithoutStaleAutosave(): Promise<void> {
  const previousStore = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  const current = eligibleSnapshot()
  current.tagPresets = ['主进程并发新增']
  current.shortcuts = { 'global.newTrade': { key: 'n', mod: true } }
  const harness = createHarness(current)
  const result = await commitDueStageRollover(commitInput(), harness.deps)
  assert(result.ok, 'cross-layer fixture must commit')
  const durable = harness.saved[0]!
  const scheduledAutosaves: PersistedSnapshot[] = []
  let unsubscribeStore = () => {}
  let unsubscribeShortcuts = () => {}
  try {
    applySnapshotToStore({ ...eligibleSnapshot(), tagPresets: ['renderer 陈旧值'] })
    const capture = () => pickPersisted(useStore.getState(), useShortcutStore.getState().bindings)
    const coordinator = createPersistedSnapshotCoordinator(capture(), {
      capture,
      schedule: (snapshot) => { scheduledAutosaves.push(structuredClone(snapshot)) },
    })
    unsubscribeStore = useStore.subscribe(() => coordinator.observe(capture(), { source: 'store' }))
    unsubscribeShortcuts = useShortcutStore.subscribe(() => coordinator.observe(capture(), { source: 'shortcuts' }))

    await reconcileCommittedStageRollover(result.publish, {
      reloadAuthoritativeSnapshot: async () => structuredClone(durable),
      publishDurableSnapshot: (snapshot, publish) => coordinator.publishDurable(() => {
        applySnapshotToStore(snapshot)
        useStore.getState().publishCommittedStageRollover(publish)
      }),
    })

    assert(useStore.getState().tagPresets.includes('主进程并发新增'), 'renderer store must adopt reloaded non-stage fields')
    assert(!useStore.getState().tagPresets.includes('renderer 陈旧值'), 'renderer stale non-stage fields must be replaced')
    const refreshedBinding = useShortcutStore.getState().bindings['global.newTrade']
    assert(
      refreshedBinding !== null && !Array.isArray(refreshedBinding) && refreshedBinding?.key === 'n',
      'renderer shortcuts must adopt the valid authoritative binding',
    )
    assert(scheduledAutosaves.length === 0, 'durable refresh must not schedule a second stale full snapshot write')

    useShortcutStore.getState().setBinding('global.newTrade', { key: 'r', shift: true })
    assert(Number(scheduledAutosaves.length) === 1, 'a shortcut-only edit must schedule persistence once')
    assert(
      scheduledAutosaves[0]?.tagPresets?.includes('主进程并发新增') && (() => {
        const binding = scheduledAutosaves[0]?.shortcuts?.['global.newTrade']
        return binding !== null && !Array.isArray(binding) && binding?.key === 'r'
      })(),
      'shortcut persistence must contain the full authoritative Store and the new binding',
    )
    scheduledAutosaves.splice(0)

    useStore.setState({ starredIds: ['later-edit'] })
    assert(Number(scheduledAutosaves.length) === 1, 'a later real edit must still schedule persistence')
    assert(
      scheduledAutosaves[0]?.tagPresets?.includes('主进程并发新增'),
      'later persistence must start from the reconciled authoritative non-stage fields',
    )
  } finally {
    unsubscribeStore()
    unsubscribeShortcuts()
    useStore.setState(previousStore)
    useShortcutStore.setState(previousShortcuts)
  }
}

export function testIpcWiresExecutableCoreThroughExistingGate(): void {
  const source = fs.readFileSync(path.resolve('electron/library/ipc.ts'), 'utf8')
  const start = source.indexOf("ipcMain.handle('stage:commitRollover'")
  const end = source.indexOf("ipcMain.handle('", start + 24)
  assert(start >= 0, 'stage:commitRollover IPC handler must exist')
  const handler = source.slice(start, end < 0 ? source.length : end)
  assert(handler.includes('commitDueStageRollover'), 'IPC must delegate behavior to the executable commit core')
  assert(handler.includes('operationGate.runExclusive'), 'IPC dependencies must reuse the existing operation gate')
  assert(handler.includes("beginOperation('stage-rollover'"), 'IPC must keep the sanitized operation log')
}

export function testTypedBridgeCarriesIntentWithoutSnapshotOrClock(): void {
  const preload = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
  const bridge = fs.readFileSync(path.resolve('src/types/journalBridge.ts'), 'utf8')
  const inputStart = bridge.indexOf('export interface StageRolloverCommitInput')
  const inputEnd = bridge.indexOf('\n}', inputStart)
  const input = bridge.slice(inputStart, inputEnd)
  assert(
    preload.includes("commitStageRollover: (input) => ipcRenderer.invoke('stage:commitRollover', input)"),
    'preload must expose the single typed stage commit invoke',
  )
  assert(input.includes('expectedRollover: ScheduledStageRollover'), 'intent must carry the full expected schedule')
  assert(!input.includes('snapshot'), 'renderer intent must not carry a library snapshot')
  assert(!input.includes('nextStageId') && !input.includes('now'), 'renderer must not control the clock or next stage ID')
  assert(!preload.includes('stage:createBackup'), 'renderer must not receive a stage backup primitive')
  assert(!preload.includes('stage:verifyBackup'), 'renderer must not receive a stage verification primitive')
}

// Quality-Scenario: LS-ROLLOVER-ATOMIC
