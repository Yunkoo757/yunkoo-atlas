# Complete Live Stage Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace date-derived “reset live statistics” with an explicit, durable live-stage rollover that archives trades, cases, weekly reviews and risk, then starts a blank risk-unconfigured stage.

**Architecture:** `LiveStage` and `liveStageId` become the single source of truth for current and historical membership. Pure domain modules own validation, migration, rollover and archive projection; Zustand publishes only durable candidates, while Electron serializes backup-plus-rollover work through the existing library operation gate.

**Tech Stack:** TypeScript 5.6, React 18, Zustand 4, Electron 43, sql.js, Vite 8, Node test runner, project browser-test harness.

## Global Constraints

- Product support is limited to Windows and macOS desktop clients; browser code is only a QA and compatibility harness.
- Read and write every text file as UTF-8 without BOM; preserve all Chinese and other non-ASCII text.
- Raise the persisted library schema from v11 to v12 and provide crash-safe v11 → v12 migration.
- `liveStages`, `currentLiveStageId` and entity `liveStageId` are the only runtime membership truth; dates never move an entity between stages.
- New stage-scoped entities always receive a valid stage ID; `liveStageId: null` is reserved for unresolved v11 migration data.
- A rollover may be scheduled at any time but becomes eligible only on the next Monday.
- Planned trades, open trades, an incomplete preceding weekly review, unfinished storage work, backup failure or stale data must block rollover and postpone it one week.
- A successful rollover preserves profile, strategies, symbols, tags, templates, quick notes, shortcuts, display settings and saved views.
- A new stage starts with no live trades, cases, weekly reviews, risk policy or performance and must complete risk onboarding before first open.
- Historical trades, cases and weekly-review content remain freely editable; historical stage metrics recompute, while completed weekly-review snapshots remain frozen.
- Random review defaults to the current stage plus all archived stages.
- Keep unrelated dirty-worktree changes untouched; every task commits only its listed files.

---

## File and Responsibility Map

- `src/lib/liveStages.ts`: stage types, invariants, creation and lookup.
- `src/lib/stageMigration.ts`: deterministic v11 → v12 ownership migration.
- `src/lib/stageRollover.ts`: scheduling, blockers, postponement and pure candidate generation.
- `src/lib/stageRolloverCommit.ts`: renderer-side cutover orchestration and durable publish rules.
- `src/lib/stageArchive.ts`: current/history/pending projections and live metrics scopes.
- `src/lib/stageOwnershipRepair.ts`: explicit repair for `liveStageId: null` entities.
- `src/storage/snapshotCodec.ts`: version-aware decode and migration entrypoint.
- `src/storage/snapshotValidation.ts`: v12 cross-entity stage validation.
- `electron/library/ipc.ts`: exclusive verified-backup and rollover commit IPC.
- `src/store/useStore.ts`: persisted stage state and thin actions delegating to domain modules.
- `src/components/LiveStageManager.tsx`: schedule/cancel/rename workflow.
- `src/components/StageRolloverBanner.tsx`: persistent due date, blockers and postponement state.
- `src/views/LiveArchiveView.tsx`: all-history and one-stage archive shell.
- `src/views/StageOwnershipRepairView.tsx`: unresolved legacy ownership repair.
- `src/lib/reviewSession.ts`: stage-aware random-review candidate pool.

---

### Task 1: Define the live-stage domain contract

**Files:**
- Create: `src/lib/liveStages.ts`
- Create: `src/lib/liveStages.test.ts`
- Modify: `src/data/trades.ts:69-132`
- Modify: `src/data/weeklyReviews.ts:61-84`
- Modify: `src/data/riskManagement.ts:58-109`

**Interfaces:**
- Produces: `LiveStage`, `ScheduledStageRollover`, `LiveStageState`, `assertValidLiveStageState`, `getCurrentLiveStage`, `createInitialLiveStage`, `createNextLiveStage`.
- Produces: `liveStageId?: string | null` compatibility fields on stage-scoped entities; runtime creation is tightened in Task 3.

- [ ] **Step 1: Write failing invariant tests**

```ts
import {
  assertValidLiveStageState,
  createInitialLiveStage,
  createNextLiveStage,
  getCurrentLiveStage,
} from '@/lib/liveStages'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

export function testLiveStageStateRequiresExactlyOneCurrentStage(): void {
  const first = createInitialLiveStage('2026-08-24', '2026-08-24T00:00:00.000Z', 'stage-1')
  assert(getCurrentLiveStage([first], first.id).id === first.id, 'initial stage must be current')
  let rejected = false
  try {
    assertValidLiveStageState({ liveStages: [{ ...first, status: 'archived', endsOn: '2026-08-23', archivedAt: first.createdAt }], currentLiveStageId: first.id })
  } catch { rejected = true }
  assert(rejected, 'archived currentLiveStageId must be rejected')
}

export function testNextStageArchivesPreviousWithoutChangingItsIdentity(): void {
  const first = createInitialLiveStage('2026-08-24', '2026-08-24T00:00:00.000Z', 'stage-1')
  const next = createNextLiveStage(first, '2026-08-31', '2026-08-31T00:00:00.000Z', 'stage-2')
  assert(next.archived.id === first.id, 'old stage identity must remain stable')
  assert(next.archived.endsOn === '2026-08-30', 'old stage must end before new Monday')
  assert(next.current.sequence === 2 && next.current.status === 'current', 'new stage must increment sequence')
}
```

- [ ] **Step 2: Run the tests and verify the module is missing**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveStages.test.ts`

Expected: FAIL because `src/lib/liveStages.ts` does not exist.

- [ ] **Step 3: Implement the domain types and validators**

```ts
export interface LiveStage {
  id: string
  sequence: number
  name: string
  status: 'current' | 'archived'
  startsOn: string
  endsOn: string | null
  createdAt: string
  archivedAt: string | null
}

export interface ScheduledStageRollover {
  id: string
  requestedAt: string
  effectiveWeekStart: string
  postponedCount: number
}

export interface LiveStageState {
  liveStages: LiveStage[]
  currentLiveStageId: string
}

export function getCurrentLiveStage(stages: readonly LiveStage[], currentId: string): LiveStage {
  const current = stages.find((stage) => stage.id === currentId)
  if (!current || current.status !== 'current') throw new Error('当前实盘阶段无效')
  return current
}
```

Implement canonical `YYYY-MM-DD` checks, unique IDs/sequences, exactly one current stage, chronological non-overlap, default `实盘阶段 N` naming, and previous-day calculation without UTC date drift.

- [ ] **Step 4: Add compatibility ownership fields to domain entities**

```ts
// Trade, WeeklyReview and every risk entity listed in the design:
/** v12 stage ownership; undefined is accepted only while decoding v1-v11. */
liveStageId?: string | null
```

Do not add stage ownership to paper trades or quick notes.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveStages.test.ts`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the domain contract**

```bash
git add src/lib/liveStages.ts src/lib/liveStages.test.ts src/data/trades.ts src/data/weeklyReviews.ts src/data/riskManagement.ts
git commit -m "feat(live-stage): define explicit stage ownership"
```

---

### Task 2: Migrate persisted libraries to schema v12

**Files:**
- Create: `src/lib/stageMigration.ts`
- Create: `src/lib/stageMigration.test.ts`
- Modify: `src/storage/types.ts:31-96`
- Modify: `src/storage/snapshotCodec.ts`
- Modify: `src/storage/snapshotCodec.test.ts`
- Modify: `src/storage/snapshotValidation.ts`
- Modify: `src/storage/snapshotValidation.test.ts`
- Modify: `src/storage/emptySnapshot.ts`
- Modify: `src/storage/fixtures/fullPersistedSnapshot.ts`
- Modify: `src/storage/persist.ts`
- Modify: `src/storage/persistedKeys.ts`
- Modify: `electron/library/schemaMigration.ts`
- Modify: `electron/library/schemaMigration.test.ts`

**Interfaces:**
- Consumes: Task 1 `LiveStage` contract and existing `LivePerformanceCycle` membership helpers.
- Produces: `SCHEMA_VERSION = 12` and canonical persisted fields `liveStages`, `currentLiveStageId`, `scheduledStageRollover`.
- Produces: `migrateLegacyStageSnapshot(raw, options): PersistedSnapshot`.

- [ ] **Step 1: Add failing migration fixtures**

```ts
export function testV11CyclesBecomeStableV12Stages(): void {
  const migrated = migrateLegacyStageSnapshot(v11Snapshot({
    livePerformanceCycles: [
      { id: 'old', name: '旧周期', startTradingDayKey: '2026-08-03', createdAt: '2026-08-03T00:00:00.000Z' },
      { id: 'current', name: '当前', startTradingDayKey: '2026-08-10', createdAt: '2026-08-10T00:00:00.000Z' },
    ],
  }), {
    now: '2026-08-22T00:00:00.000Z',
    currentTradingDayKey: '2026-08-22',
    idFactory: sequence => `stage-${sequence}`,
  })
  assert(migrated.liveStages.length === 2, 'each legacy cycle must become a stage')
  assert(migrated.currentLiveStageId === 'stage-2', 'latest cycle must become current')
  assert(migrated.trades.every(trade => trade.tradeKind === 'paper' || trade.liveStageId !== undefined), 'all live/case records must be resolved or explicitly pending')
}

export function testUnreliableLegacyMembershipBecomesPending(): void {
  const migrated = migrateLegacyStageSnapshot(v11Snapshot({ trades: [liveTradeWithoutUsableDates()] }), deterministicOptions)
  assert(migrated.trades[0]?.liveStageId === null, 'unreliable ownership must not be guessed')
}
```

- [ ] **Step 2: Run the migration and validation tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageMigration.test.ts src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts`

Expected: FAIL because v12 fields and migration do not exist.

- [ ] **Step 3: Extend the persisted snapshot contract**

```ts
export const SCHEMA_VERSION = 12

export interface PersistedSnapshot {
  liveStages: LiveStage[]
  currentLiveStageId: string
  scheduledStageRollover: ScheduledStageRollover | null
  // existing fields remain unchanged
}
```

Keep `livePerformanceCycles` and `liveStatsStartTradingDayKey` as decode-only v11 compatibility inputs. `pickPersisted` must derive any temporarily required compatibility mirror from the current stage and no runtime selector may consume those mirrors after Task 8.

- [ ] **Step 4: Implement deterministic legacy migration**

```ts
export interface LegacyStageMigrationOptions {
  now: string
  currentTradingDayKey: string
  idFactory(sequence: number): string
}

export function migrateLegacyStageSnapshot(
  raw: LegacyStageSnapshot,
  options: LegacyStageMigrationOptions,
): PersistedSnapshot
```

Use the existing closed-day resolver for closed/missed live trades and opened-day resolver for planned/open live trades. Create a “更早记录” archive only when pre-cycle records exist. Cases inherit a valid source stage first, then fall back to reliable `recordedAt`/`openedAt`; otherwise assign `null`. Weekly reviews map by `weekStart`. Existing risk entities map to the current stage.

- [ ] **Step 5: Enforce v12 cross-entity validation**

```ts
function assertStageOwnership(snapshot: PersistedSnapshot, label: string): void {
  const ids = new Set(snapshot.liveStages.map(stage => stage.id))
  for (const trade of snapshot.trades) {
    if (trade.tradeKind === 'paper') continue
    if (trade.liveStageId !== null && !ids.has(trade.liveStageId ?? '')) {
      throw new Error(`${label}.trades contains an unknown liveStageId`)
    }
  }
}
```

Apply the same rule to weekly reviews and risk entities. For v12, reject `undefined`; accept `null` only for migrated trade/case entities, never weekly reviews or risk entities.

- [ ] **Step 6: Wire crash-safe Electron schema migration**

Extend the existing recoverable database/manifest pair protocol from v8-v11 to v12. Decode the v11 snapshot, migrate it, validate the v12 candidate, atomically replace `journal.db`, then replace `manifest.json`. Add forced-failure coverage after database replacement and after manifest replacement.

- [ ] **Step 7: Run migration, codec and Electron migration tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageMigration.test.ts src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts`

Run: `node scripts/run-quality-node-tests.mjs`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Commit schema v12**

```bash
git add src/lib/stageMigration.ts src/lib/stageMigration.test.ts src/storage/types.ts src/storage/snapshotCodec.ts src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.ts src/storage/snapshotValidation.test.ts src/storage/emptySnapshot.ts src/storage/fixtures/fullPersistedSnapshot.ts src/storage/persist.ts src/storage/persistedKeys.ts electron/library/schemaMigration.ts electron/library/schemaMigration.test.ts
git commit -m "feat(live-stage): migrate libraries to schema v12"
```

---

### Task 3: Make runtime writes stage-aware

**Files:**
- Modify: `src/store/useStore.ts`
- Modify: `src/storage/bootstrap.ts`
- Modify: `src/lib/importExport.ts`
- Modify: `src/lib/importMerge.ts`
- Create: `src/lib/importMerge.test.ts`
- Modify: `src/components/TradeComposer.tsx`
- Modify: `src/data/weeklyReviews.ts`
- Modify: `src/lib/riskPolicy.ts`
- Create: `src/store/liveStageOwnership.test.ts`
- Modify: `src/lib/importConcurrency.test.ts`

**Interfaces:**
- Consumes: v12 canonical snapshot and `getCurrentLiveStage`.
- Produces: required Store fields `liveStages`, `currentLiveStageId`, `scheduledStageRollover`.
- Produces: `currentLiveStageIdForWrite(state): string` and stage-safe trade/case/risk/weekly creation paths.

- [ ] **Step 1: Write failing write-path tests**

```ts
export function testNewLiveTradeAlwaysUsesCurrentStage(): void {
  seedStoreWithStages('stage-old', 'stage-current')
  const trade = plannedLiveTrade({ liveStageId: undefined })
  useStore.getState().upsertTrade(trade)
  assert(useStore.getState().getById(trade.id)?.liveStageId === 'stage-current', 'new live trade must use current stage')
}

export function testCaseInheritsSourceStage(): void {
  seedStoreWithHistoricalTrade('trade-old', 'stage-old')
  const result = useStore.getState().createReviewCaseFromTrade('trade-old')
  assert(result.status === 'created' && result.reviewCase.liveStageId === 'stage-old', 'case must inherit source stage')
}

export function testEditingHistoricalDateDoesNotMoveStage(): void {
  seedStoreWithHistoricalTrade('trade-old', 'stage-old')
  useStore.getState().updateTradeData('trade-old', { openedAt: '2026-12-01' })
  assert(useStore.getState().getById('trade-old')?.liveStageId === 'stage-old', 'date edit must preserve stage')
}

export function testMergeImportAssignsUnknownLiveRecordsToCurrentStage(): void {
  const merged = mergeImportPayload(currentStageState('stage-current'), legacyMergePayload())
  assert(merged.trades.filter(trade => trade.tradeKind === 'live').every(trade => trade.liveStageId === 'stage-current'), 'merge import must enter the active workspace')
}
```

- [ ] **Step 2: Run focused Store tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/store/liveStageOwnership.test.ts src/lib/importConcurrency.test.ts`

Expected: FAIL because Store state and write boundaries are not stage-aware.

- [ ] **Step 3: Hydrate required stage state before enabling persistence**

```ts
useStore.setState({
  liveStages: snapshot.liveStages,
  currentLiveStageId: snapshot.currentLiveStageId,
  scheduledStageRollover: snapshot.scheduledStageRollover,
  // existing hydrated fields
})
```

Reject bootstrap if canonical stage invariants fail; never fall back to an empty stage after a failed load.

- [ ] **Step 4: Centralize stage ownership on every creation path**

```ts
function withCurrentStage(state: State, trade: Trade): Trade {
  if (trade.tradeKind === 'paper') return { ...trade, liveStageId: undefined }
  if (trade.liveStageId !== undefined) return trade
  return { ...trade, liveStageId: state.currentLiveStageId }
}
```

Use this only for genuinely new records. Existing records retain their current `liveStageId`, including `null`, on all ordinary edits. Cases created from a source bypass the helper and explicitly inherit the source stage.

- [ ] **Step 5: Define import ownership**

CSV, Notion and merge-style JSON imports are ingestion into the active workspace: assign imported live trades and standalone cases to the current stage, while derived cases inherit their imported source. Full `.journal.zip` restore preserves the archive's v12 stage graph. Reject merge input that attempts to reference an unknown local stage ID.

- [ ] **Step 6: Run Store, import and type tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/store/liveStageOwnership.test.ts src/lib/importConcurrency.test.ts src/lib/importMerge.test.ts`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit stage-aware writes**

```bash
git add src/store/useStore.ts src/storage/bootstrap.ts src/lib/importExport.ts src/lib/importMerge.ts src/lib/importMerge.test.ts src/components/TradeComposer.tsx src/data/weeklyReviews.ts src/lib/riskPolicy.ts src/store/liveStageOwnership.test.ts src/lib/importConcurrency.test.ts
git commit -m "feat(live-stage): assign current stage on writes"
```

---

### Task 4: Implement the rollover state machine

**Files:**
- Create: `src/lib/stageRollover.ts`
- Create: `src/lib/stageRollover.test.ts`
- Modify: `src/store/useStore.ts`

**Interfaces:**
- Consumes: current stage state, stage-owned trades and weekly reviews.
- Produces: `scheduleStageRollover`, `inspectDueStageRollover`, `postponeStageRollover`, `buildStageRolloverCandidate`.
- Produces: Store actions `scheduleLiveStageRollover`, `cancelLiveStageRollover`, `publishPostponedRollover`.

- [ ] **Step 1: Write failing scheduling and blocker tests**

```ts
export function testScheduleAlwaysTargetsFollowingMonday(): void {
  const monday = scheduleStageRollover('2026-08-24', '2026-08-24T09:00:00.000Z', 'rollover-1')
  assert(monday.effectiveWeekStart === '2026-08-31', 'Monday request must target the following Monday')
  const friday = scheduleStageRollover('2026-08-28', '2026-08-28T09:00:00.000Z', 'rollover-2')
  assert(friday.effectiveWeekStart === '2026-08-31', 'Friday request must target next Monday')
}

export function testDueRolloverListsEveryBlockerAndPostpones(): void {
  const inspection = inspectDueStageRollover(blockedState(), '2026-08-31')
  assert(inspection.kind === 'blocked', 'blocked rollover must not build a candidate')
  assert(inspection.blockers.map(item => item.code).join(',') === 'planned-trades,open-trades,weekly-review-incomplete', 'all domain blockers must be stable')
  const postponed = postponeStageRollover(blockedState().scheduledStageRollover!, '2026-08-31')
  assert(postponed.effectiveWeekStart === '2026-09-07' && postponed.postponedCount === 1, 'blocked rollover must move one week')
}

export function testSuccessfulCandidateArchivesOldAndCreatesBlankCurrent(): void {
  const candidate = buildStageRolloverCandidate(eligibleState(), {
    effectiveWeekStart: '2026-08-31',
    now: '2026-08-31T00:10:00.000Z',
    nextStageId: 'stage-2',
  })
  assert(candidate.currentLiveStageId === 'stage-2', 'candidate must select the new stage')
  assert(candidate.scheduledStageRollover === null, 'candidate must consume the schedule')
  assert(candidate.riskPolicyVersions.filter(item => item.liveStageId === 'stage-2').length === 0, 'new stage risk must be empty')
}
```

- [ ] **Step 2: Run the state-machine tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageRollover.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement canonical Monday and preceding-review rules**

```ts
export type StageRolloverBlockerCode =
  | 'planned-trades'
  | 'open-trades'
  | 'weekly-review-incomplete'

export type StageRolloverInspection =
  | { kind: 'not-due'; scheduled: ScheduledStageRollover }
  | { kind: 'blocked'; scheduled: ScheduledStageRollover; blockers: StageRolloverBlocker[] }
  | { kind: 'eligible'; scheduled: ScheduledStageRollover }
```

The weekly-review blocker must target the Monday-through-Sunday week immediately before `effectiveWeekStart`, require a completed review owned by the current stage, and treat a missing empty-week review as incomplete.

- [ ] **Step 4: Build immutable candidates without deleting old entities**

Archive the old `LiveStage`, append the new one, change `currentLiveStageId`, clear the schedule and leave every old entity unchanged. “Blank current stage” is produced by stage filtering, not array deletion.

- [ ] **Step 5: Add thin Store schedule/cancel actions**

```ts
scheduleLiveStageRollover: (currentTradingDayKey, now) => set(state => ({
  scheduledStageRollover: state.scheduledStageRollover ?? scheduleStageRollover(
    currentTradingDayKey,
    now,
    crypto.randomUUID(),
  ),
})),
cancelLiveStageRollover: () => set({ scheduledStageRollover: null }),
```

- [ ] **Step 6: Run state-machine and Store tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageRollover.test.ts src/store/liveStageOwnership.test.ts`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the rollover state machine**

```bash
git add src/lib/stageRollover.ts src/lib/stageRollover.test.ts src/store/useStore.ts
git commit -m "feat(live-stage): add scheduled rollover state machine"
```

---

### Task 5: Commit due rollovers through a verified desktop boundary

**Files:**
- Create: `src/lib/stageRolloverCommit.ts`
- Create: `src/lib/stageRolloverCommit.test.ts`
- Modify: `src/types/journalBridge.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/library/ipc.ts`
- Create: `electron/library/stageRolloverCommit.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/storage/cutover.ts`

**Interfaces:**
- Consumes: Task 4 inspection/candidate functions and existing storage cutover lock.
- Produces: `JournalBridge.commitStageRollover(input): Promise<StageRolloverCommitResult>`.
- Produces: `executeDueStageRollover(dependencies): Promise<StageRolloverExecutionResult>`.

- [ ] **Step 1: Write failing durable-boundary tests**

```ts
export async function testPublishOccursOnlyAfterDurableCommit(): Promise<void> {
  const events: string[] = []
  const result = await executeDueStageRollover({
    captureLatest: () => eligibleCapture(),
    flushBeforeCommit: async () => { events.push('flush') },
    commitDurably: async () => { events.push('commit'); return { ok: true } },
    publish: () => { events.push('publish') },
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
    commitDurably: async () => ({ ok: false, reason: 'backup-failed' }),
    publish: () => { published = true },
    postpone: async () => {},
  })
  assert(result.kind === 'failed' && !published, 'failed durable commit must preserve old UI state')
}
```

- [ ] **Step 2: Run renderer and Electron boundary tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageRolloverCommit.test.ts`

Run: `node scripts/run-quality-node-tests.mjs`

Expected: FAIL because rollover IPC and executor do not exist.

- [ ] **Step 3: Add the typed preload bridge**

```ts
export interface StageRolloverCommitInput {
  expectedCurrentStageId: string
  expectedRolloverId: string
  snapshot: PersistedSnapshot
}

export type StageRolloverCommitResult =
  | { ok: true }
  | { ok: false; reason: 'stale' | 'backup-failed' | 'validation-failed' | 'write-failed'; message: string }
```

Expose only `ipcRenderer.invoke('stage:commitRollover', input)`; do not expose filesystem or backup primitives to the renderer.

- [ ] **Step 4: Implement exclusive main-process commit**

Inside `operationGate.runExclusive`:

```ts
const current = lib.loadSnapshot()
if (!current || current.currentLiveStageId !== input.expectedCurrentStageId || current.scheduledStageRollover?.id !== input.expectedRolloverId) {
  return { ok: false, reason: 'stale', message: '资料库中的阶段状态已经变化' }
}
const backupName = createBackup(lib)
if (!backupName) {
  return { ok: false, reason: 'backup-failed', message: '无法创建重置前备份' }
}
const verification = await verifyBackup(backupName)
if (verification.status !== 'verified') {
  return { ok: false, reason: 'backup-failed', message: verification.error ?? '重置前备份验证失败' }
}
assertValidPersistedSnapshot(input.snapshot, 'Stage rollover snapshot')
lib.saveSnapshot(input.snapshot)
return { ok: true }
```

Map thrown validation/write errors to the declared result and write operational logs without sensitive paths.

- [ ] **Step 5: Implement renderer cutover and automatic checks**

Use `lockStorageCutoverInteraction`, flush note drafts and persistence, recapture latest state, then inspect again. For domain blockers, persist only the postponed schedule. For eligible state, call the new IPC and publish the candidate only after `{ ok: true }`.

Run the check after storage bootstrap before `setReady(true)`, on visibility restoration when the business week changed, and when stage management opens. Deduplicate concurrent checks with one in-flight promise.

- [ ] **Step 6: Test stale, backup failure, write failure and forced ordering**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageRolloverCommit.test.ts`

Run: `node scripts/run-quality-node-tests.mjs`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the durable boundary**

```bash
git add src/lib/stageRolloverCommit.ts src/lib/stageRolloverCommit.test.ts src/types/journalBridge.ts electron/preload.ts electron/library/ipc.ts electron/library/stageRolloverCommit.test.ts src/App.tsx src/storage/cutover.ts
git commit -m "feat(live-stage): commit rollovers after verified backup"
```

---

### Task 6: Reset risk and require new-stage onboarding

**Files:**
- Create: `src/lib/stageRisk.ts`
- Create: `src/lib/stageRisk.test.ts`
- Modify: `src/lib/activeRiskPolicy.ts`
- Modify: `src/lib/riskPolicy.ts`
- Modify: `src/lib/riskBudget.ts`
- Modify: `src/lib/riskBudget.test.ts`
- Modify: `src/lib/tradeOpenRiskGate.ts`
- Modify: `src/lib/tradeOpenRiskGate.test.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/components/TradeOpenRiskDialog.tsx`
- Modify: `src/components/RiskStatusStrip.tsx`
- Modify: `src/views/settings/RiskManagementSettingsPanel.tsx`
- Modify: `src/store/riskGateIntegration.test.ts`

**Interfaces:**
- Consumes: `currentLiveStageId` and current stage `startsOn`.
- Produces: `riskSetupStateForStage(state, stageId): 'unconfigured' | 'configured'`.
- Produces: `requestTradeOpen` result `'requires-risk-setup'` before evaluating ordinary limit/unknown overrides.

- [ ] **Step 1: Write failing onboarding and isolation tests**

```ts
export function testArchivedRiskPolicyDoesNotConfigureNewStage(): void {
  const state = riskState({ policies: [policy({ liveStageId: 'stage-old' })] })
  assert(riskSetupStateForStage(state, 'stage-new') === 'unconfigured', 'old policy must not configure new stage')
}

export function testFirstOpenIsBlockedUntilCurrentStageRiskSetup(): void {
  seedStoreWithPlannedTrade('stage-new')
  const result = useStore.getState().requestTradeOpen('trade-new')
  assert(result === 'requires-risk-setup', 'new stage must require risk onboarding before first open')
}
```

- [ ] **Step 2: Run focused risk tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageRisk.test.ts src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.test.ts src/store/riskGateIntegration.test.ts`

Expected: FAIL because risk selection is not stage-aware.

- [ ] **Step 3: Filter every risk calculation by stage ID**

Add `liveStageId` to risk-policy creation and outcome inputs. Replace runtime reads of `liveStatsStartTradingDayKey` with the selected stage's `startsOn`. Current risk cards always use the current stage even while the dashboard displays a historical performance stage.

- [ ] **Step 4: Add the hard first-open onboarding result**

```ts
export type TradeOpenRequestResult =
  | 'opened'
  | 'pending-confirmation'
  | 'requires-risk-gate'
  | 'requires-risk-setup'
  | 'not-found'
```

Evaluate `requires-risk-setup` before limit coverage and override logic. The dialog must route the user to risk settings and must not offer a reason-based override for missing initial setup.

- [ ] **Step 5: Ensure risk confirmation writes the current stage**

`saveWeeklyRiskDraft`, `confirmWeeklyRiskPreparation`, monthly-limit locking and override creation must receive `currentLiveStageId` from Store and write it to every new entity. Do not copy old-stage draft values into the new-stage form.

- [ ] **Step 6: Run risk, Store and browser tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageRisk.test.ts src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.test.ts src/store/riskGateIntegration.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit stage-scoped risk**

```bash
git add src/lib/stageRisk.ts src/lib/stageRisk.test.ts src/lib/activeRiskPolicy.ts src/lib/riskPolicy.ts src/lib/riskBudget.ts src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.ts src/lib/tradeOpenRiskGate.test.ts src/store/useStore.ts src/components/TradeOpenRiskDialog.tsx src/components/RiskStatusStrip.tsx src/views/settings/RiskManagementSettingsPanel.tsx src/store/riskGateIntegration.test.ts
git commit -m "feat(live-stage): require fresh risk onboarding"
```

---

### Task 7: Scope weekly reviews to one stage and preserve completion snapshots

**Files:**
- Modify: `src/data/weeklyReviews.ts`
- Modify: `src/data/weeklyReviews.test.ts`
- Modify: `src/data/weeklyReviewTrend.test.ts`
- Modify: `src/lib/weeklyReviewCompletion.ts`
- Modify: `src/lib/weeklyReviewCompletion.test.ts`
- Modify: `src/lib/weeklyReviewSnapshot.test.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/views/WeeklyReviewView.tsx`
- Modify: `src/views/WeeklyReviewView.browser.test.tsx`
- Modify: `src/views/WeeklyReviewPresentation.browser.test.tsx`

**Interfaces:**
- Consumes: current stage ID, stage-aware risk and stage-owned trades.
- Produces: `createWeeklyReview(weekStart, liveStageId, now)`.
- Produces: `isStageWeekCompleted(reviews, liveStageId, weekStart): boolean` for Task 4 blocker checks.
- Produces: `buildWeeklyReviewTrend(reviews, liveStageId?: string): WeeklyReviewTrendPoint[]`.

- [ ] **Step 1: Write failing stage-isolation tests**

```ts
export function testWeeklyReviewSelectsOnlyItsStage(): void {
  const review = createWeeklyReview('2026-08-24', 'stage-2', new Date('2026-08-24T12:00:00.000Z'))
  const completed = completeWeeklyReviewCandidate(stateWithSameWeekTradesInTwoStages(), review.id, new Date('2026-08-30T12:00:00.000Z'))
  assert(completed.review.metricsSnapshot?.tradeCount === 1, 'review must exclude same-week trades from another stage')
  assert(completed.review.liveStageId === 'stage-2', 'completed review must retain stage ownership')
}

export function testHistoricalFactEditDoesNotRewriteCompletedSnapshot(): void {
  const completed = completedReviewWithSnapshot('stage-1', 500)
  const editedTrade = historicalTrade({ pnl: 900 })
  assert(completed.metricsSnapshot?.totalPnl === 500, 'completed snapshot must remain frozen after fact edits')
  assert(editedTrade.pnl === 900, 'historical entity remains freely editable')
}
```

- [ ] **Step 2: Run weekly-review tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/data/weeklyReviews.test.ts src/data/weeklyReviewTrend.test.ts src/lib/weeklyReviewCompletion.test.ts src/lib/weeklyReviewSnapshot.test.ts`

Expected: FAIL because weekly reviews are not stage-scoped.

- [ ] **Step 3: Require stage ownership on creation and completion**

```ts
export function createWeeklyReview(
  weekStart: string,
  liveStageId: string,
  now = new Date(),
): WeeklyReview
```

Filter trades, missed trades, risk policies, limits and overrides by the review's `liveStageId` before building metrics/evidence/risk snapshots. Reopening a historical review retains its stage ID.

- [ ] **Step 4: Preserve snapshot semantics while allowing content edits**

Keep `metricsSnapshot`, `evidenceSnapshot`, `riskSnapshot` and `completedAt` untouched when editing scores, tags, commitment or HTML on a completed review. Add a presentation label “完成周复盘时的数据”.

- [ ] **Step 5: Add stage-filtered trends and blocker helper**

```ts
export function isStageWeekCompleted(
  reviews: readonly WeeklyReview[],
  liveStageId: string,
  weekStart: string,
): boolean {
  return reviews.some(review => review.liveStageId === liveStageId && review.weekStart === weekStart && review.status === 'completed')
}
```

Use the same stage filter for yearly trend selection; changing the trend scope must not modify reviews.

- [ ] **Step 6: Run weekly-review unit and browser tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/data/weeklyReviews.test.ts src/data/weeklyReviewTrend.test.ts src/lib/weeklyReviewCompletion.test.ts src/lib/weeklyReviewSnapshot.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit stage-scoped weekly reviews**

```bash
git add src/data/weeklyReviews.ts src/data/weeklyReviews.test.ts src/data/weeklyReviewTrend.test.ts src/lib/weeklyReviewCompletion.ts src/lib/weeklyReviewCompletion.test.ts src/lib/weeklyReviewSnapshot.test.ts src/store/useStore.ts src/views/WeeklyReviewView.tsx src/views/WeeklyReviewView.browser.test.tsx src/views/WeeklyReviewPresentation.browser.test.tsx
git commit -m "feat(live-stage): archive weekly reviews by stage"
```

---

### Task 8: Unify current and historical projections around stage IDs

**Files:**
- Create: `src/lib/stageArchive.ts`
- Create: `src/lib/stageArchive.test.ts`
- Modify: `src/lib/workbenchTrades.ts`
- Create: `src/lib/workbenchTrades.test.ts`
- Modify: `src/lib/analysisScope.ts`
- Modify: `src/lib/analysisScope.test.ts`
- Modify: `src/lib/tradeFilters.ts`
- Modify: `src/hooks/useWorkbenchVisibleTrades.ts`
- Modify: `src/lib/sidebarWorkspace.ts`
- Create: `src/lib/sidebarWorkspace.test.ts`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/views/TodayWorkspace.tsx`
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/ListView.tsx`
- Modify: `src/views/BoardView.tsx`
- Modify: `src/views/LiveArchiveView.tsx`
- Modify: `src/views/LiveArchiveView.css`
- Modify: `src/views/LiveArchiveView.browser.test.tsx`
- Modify: `src/views/LiveArchiveModeHierarchy.browser.test.tsx`
- Modify: `src/views/DashboardScope.browser.test.tsx`

**Interfaces:**
- Consumes: explicit stage state and stage-owned entities.
- Produces: `resolveStageScope`, `filterStageTrades`, `filterStageCases`, `buildStageArchiveSummary`.
- Produces: URL query `liveStage=current|all-history|<stage-id>`.

- [ ] **Step 1: Write failing projection tests**

```ts
export function testDateEditCannotMoveHistoricalRecordIntoCurrentProjection(): void {
  const edited = { ...historicalTrade('stage-old'), openedAt: '2027-01-01', closedAt: '2027-01-02' }
  assert(filterStageTrades([edited], { kind: 'current', stageId: 'stage-current' }).length === 0, 'dates must not override stage ownership')
  assert(filterStageTrades([edited], { kind: 'stage', stageId: 'stage-old' }).length === 1, 'historical membership must remain stable')
}

export function testAllHistoryExcludesCurrentAndPending(): void {
  const result = filterStageTrades(stageFixture(), { kind: 'all-history', archivedStageIds: new Set(['stage-1', 'stage-2']) })
  assert(result.every(trade => trade.liveStageId === 'stage-1' || trade.liveStageId === 'stage-2'), 'all history must exclude current and null ownership')
}
```

- [ ] **Step 2: Run archive, workbench and scope tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageArchive.test.ts src/lib/workbenchTrades.test.ts src/lib/analysisScope.test.ts src/lib/sidebarWorkspace.test.ts`

Expected: FAIL because projections still consume dates and legacy cycles.

- [ ] **Step 3: Implement one stage-scope resolver**

```ts
export type StageScope =
  | { kind: 'current'; stageId: string }
  | { kind: 'stage'; stageId: string }
  | { kind: 'all-history'; archivedStageIds: ReadonlySet<string> }
  | { kind: 'pending' }
```

Every workbench, dashboard, sidebar and archive consumer must call the same filter. `null` ownership appears only in pending scope.

- [ ] **Step 4: Replace current-workspace consumers**

Today workspace, active/favorites/missed lists, current transaction log, current cases, sidebar counts, strategy performance and default dashboard must filter by `currentLiveStageId`. Paper-trade behavior remains unchanged.

- [ ] **Step 5: Build independent history navigation**

Historical live navigation provides “全部历史” plus every archived stage in reverse sequence. A selected stage offers tabs for overview, live records, associated cases, weekly reviews and risk records. Stage summaries recompute from current historical facts; weekly-review cards use frozen snapshots.

Preserve list/board mode, content tab and existing filter query parameters when changing stage.

- [ ] **Step 6: Keep historical editing on existing detail paths**

Historical rows continue to open `/trade/:id`. Store update actions operate on the original entity and preserve `liveStageId`; returning from detail restores the selected history stage and scroll anchor.

- [ ] **Step 7: Run projection, browser and type tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageArchive.test.ts src/lib/workbenchTrades.test.ts src/lib/analysisScope.test.ts src/lib/sidebarWorkspace.test.ts src/lib/workspaceFacetConsistency.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 8: Commit unified stage projections**

```bash
git add src/lib/stageArchive.ts src/lib/stageArchive.test.ts src/lib/workbenchTrades.ts src/lib/workbenchTrades.test.ts src/lib/analysisScope.ts src/lib/analysisScope.test.ts src/lib/tradeFilters.ts src/hooks/useWorkbenchVisibleTrades.ts src/lib/sidebarWorkspace.ts src/lib/sidebarWorkspace.test.ts src/components/Sidebar.tsx src/views/TodayWorkspace.tsx src/views/Dashboard.tsx src/views/ListView.tsx src/views/BoardView.tsx src/views/LiveArchiveView.tsx src/views/LiveArchiveView.css src/views/LiveArchiveView.browser.test.tsx src/views/LiveArchiveModeHierarchy.browser.test.tsx src/views/DashboardScope.browser.test.tsx
git commit -m "feat(live-stage): browse current and archived stages"
```

---

### Task 9: Replace the reset dialog with stage scheduling UX

**Files:**
- Create: `src/components/LiveStageManager.tsx`
- Create: `src/components/LiveStageManager.css`
- Create: `src/components/LiveStageManager.browser.test.tsx`
- Create: `src/components/LiveStageManager.browser.test.html`
- Create: `src/components/StageRolloverBanner.tsx`
- Create: `src/components/StageRolloverBanner.css`
- Create: `src/components/StageRolloverBanner.browser.test.tsx`
- Create: `src/components/StageRolloverBanner.browser.test.html`
- Modify: `src/components/LivePerformanceCycleControl.tsx`
- Delete: `src/components/LivePerformanceCycleManager.tsx`
- Delete: `src/components/LivePerformanceCycleManager.css`
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/settings/DataSettingsPanel.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 4 schedule/cancel actions and due inspection results.
- Produces: “开启新实盘阶段” scheduling dialog and persistent schedule status.

- [ ] **Step 1: Write failing scheduling interaction tests**

```tsx
export async function testScheduleExplainsPreservedAndArchivedData(): Promise<void> {
  renderStageManagerWithFixture()
  click(screen.getByRole('button', { name: '开启新实盘阶段' }))
  assert(screen.getByText('预计下周一生效'), 'dialog must show effective boundary')
  assert(screen.getByText(/交易、案例、周复盘和风险记录将归入当前阶段档案/), 'dialog must explain archived scope')
  assert(screen.getByText(/策略、标签、模板和随记继续保留/), 'dialog must explain preserved scope')
}

export async function testBlockedDueScheduleShowsEveryReasonAndNewDate(): Promise<void> {
  renderRolloverBanner(blockedInspection())
  assert(screen.getByText(/计划中 2 笔/), 'planned blocker must be visible')
  assert(screen.getByText(/持仓中 1 笔/), 'open blocker must be visible')
  assert(screen.getByText(/周复盘尚未完成/), 'weekly blocker must be visible')
  assert(screen.getByText(/已顺延至 9月7日/), 'postponed date must be visible')
}
```

- [ ] **Step 2: Run the new browser tests**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: FAIL because the stage manager and banner do not exist.

- [ ] **Step 3: Implement schedule, cancel and rename flows**

The dialog shows current stage, next Monday, trade/case/review/risk counts, current blockers, preserved global settings and automatic postponement. Scheduling is allowed while blockers exist. Reject a second schedule and expose cancel until durable rollover starts.

Rename only changes `LiveStage.name`; it must not change dates, sequence, status or entity ownership.

- [ ] **Step 4: Add persistent status without locking normal work**

Render the banner in the app shell whenever `scheduledStageRollover` is non-null. It reports effective date and current blockers but does not disable trade creation/opening before the due date.

- [ ] **Step 5: Remove old reset copy and arbitrary date selection**

Remove user-facing “重置实盘统计”, “重置统计” and the DatePicker-based start selection. The only standard action is “开启新实盘阶段”; legacy risk-date repair remains outside normal stage management only if still required for migrated pending data.

- [ ] **Step 6: Run browser, design and type checks**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Run: `pnpm qa:design`

Run: `pnpm typecheck`

Expected: PASS at 960, 1280 and 1920 desktop widths.

- [ ] **Step 7: Commit the scheduling UX**

```bash
git add src/components/LiveStageManager.tsx src/components/LiveStageManager.css src/components/LiveStageManager.browser.test.tsx src/components/LiveStageManager.browser.test.html src/components/StageRolloverBanner.tsx src/components/StageRolloverBanner.css src/components/StageRolloverBanner.browser.test.tsx src/components/StageRolloverBanner.browser.test.html src/components/LivePerformanceCycleControl.tsx src/views/Dashboard.tsx src/views/settings/DataSettingsPanel.tsx src/App.tsx
git rm src/components/LivePerformanceCycleManager.tsx src/components/LivePerformanceCycleManager.css
git commit -m "feat(live-stage): schedule complete stage rollover"
```

---

### Task 10: Add pending ownership repair

**Files:**
- Create: `src/lib/stageOwnershipRepair.ts`
- Create: `src/lib/stageOwnershipRepair.test.ts`
- Create: `src/views/StageOwnershipRepairView.tsx`
- Create: `src/views/StageOwnershipRepairView.css`
- Create: `src/views/StageOwnershipRepairView.browser.test.tsx`
- Create: `src/views/StageOwnershipRepairView.browser.test.html`
- Modify: `src/store/useStore.ts`
- Modify: `src/App.tsx`
- Modify: `src/views/settings/DataSettingsPanel.tsx`

**Interfaces:**
- Consumes: entities with `liveStageId === null` and valid stage list.
- Produces: `listPendingStageOwnership`, `assignPendingStageOwnership`.
- Produces: route `/settings/data/stage-ownership-repair`.

- [ ] **Step 1: Write failing pending-isolation and repair tests**

```ts
export function testPendingEntityIsExcludedUntilExplicitRepair(): void {
  const state = stateWithPendingTrade()
  assert(listPendingStageOwnership(state).map(item => item.entityId).includes('pending-trade'), 'pending item must be discoverable')
  const repaired = assignPendingStageOwnership(state, { entityType: 'trade', entityId: 'pending-trade', liveStageId: 'stage-old' })
  assert(repaired.trades.find(trade => trade.id === 'pending-trade')?.liveStageId === 'stage-old', 'repair must write selected stage')
}
```

- [ ] **Step 2: Run repair tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageOwnershipRepair.test.ts src/lib/stageArchive.test.ts`

Expected: FAIL because pending repair does not exist.

- [ ] **Step 3: Implement explicit, non-guessing repair**

List the entity type, reference, dates, source relationship and why migration could not assign it. Require the user to select an existing stage. Do not auto-select a suggested stage and do not add audit-reason requirements.

- [ ] **Step 4: Add the repair UI and data-health entry**

The page must show how assignment affects current/history visibility and statistics. After saving, the item immediately leaves pending and appears in the chosen stage. The ordinary editor must still preserve the repaired stage ID.

- [ ] **Step 5: Run unit, browser and type tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/stageOwnershipRepair.test.ts src/lib/stageArchive.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 6: Commit ownership repair**

```bash
git add src/lib/stageOwnershipRepair.ts src/lib/stageOwnershipRepair.test.ts src/views/StageOwnershipRepairView.tsx src/views/StageOwnershipRepairView.css src/views/StageOwnershipRepairView.browser.test.tsx src/views/StageOwnershipRepairView.browser.test.html src/store/useStore.ts src/App.tsx src/views/settings/DataSettingsPanel.tsx
git commit -m "feat(live-stage): repair unresolved stage ownership"
```

---

### Task 11: Expand random review across current and historical stages

**Files:**
- Modify: `src/lib/reviewSession.ts`
- Modify: `src/lib/reviewSession.test.ts`
- Modify: `src/views/ReviewSessionView.tsx`
- Modify: `src/views/ReviewSessionView.css`
- Modify: `src/views/ReviewSession.browser.test.tsx`
- Modify: `src/shortcuts/reviewSessionActions.test.ts`

**Interfaces:**
- Consumes: `liveStages`, `currentLiveStageId`, stage-owned trades/cases.
- Produces: `ReviewStageSource = 'current-and-history' | 'current' | 'all-history' | { stageIds: string[] }`.
- Produces: default filter `stageSource: 'current-and-history'`.

- [ ] **Step 1: Write failing pool and persistence tests**

```ts
export function testDefaultReviewPoolIncludesCurrentAndEveryHistoricalStage(): void {
  const pool = buildReviewSessionPool(reviewStageFixture(), {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    stageSource: 'current-and-history',
  }, new Set(), '2026-08-31', 0, stageContext())
  assert(new Set(pool.map(item => item.liveStageId)).size === 3, 'default pool must span current and all archives')
}

export function testHistoricalAssessmentUpdatesOriginalCase(): void {
  seedHistoricalCase('case-old', 'stage-old')
  assessReviewCase('case-old', 'mastered')
  assert(useStore.getState().getById('case-old')?.liveStageId === 'stage-old', 'assessment must not copy or move historical case')
}
```

- [ ] **Step 2: Run random-review tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts src/shortcuts/reviewSessionActions.test.ts`

Expected: FAIL because stage-source filters do not exist.

- [ ] **Step 3: Add stage-source filtering**

```ts
export type ReviewStageSource =
  | 'current-and-history'
  | 'current'
  | 'all-history'
  | { stageIds: string[] }
```

Exclude `liveStageId: null`. Continue to exclude deleted entities, mastered cases when timing is due, and account trades without completed review content. Paper inclusion remains an independent existing choice.

- [ ] **Step 4: Update session persistence and reconciliation**

Persist the selected stage source in the library-scoped session key. Missing archived stages remove only their IDs; they do not cancel the whole round. A successful rollover preserves an in-progress round as long as referenced entities still exist.

- [ ] **Step 5: Add source UI and origin labels**

Default to “当前阶段 + 全部历史”. Offer current only, all history and multi-stage selection. Each review item shows `当前阶段` or the archived stage name. Assessments mutate the original case in place.

- [ ] **Step 6: Run random-review browser and type tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts src/shortcuts/reviewSessionActions.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit stage-aware random review**

```bash
git add src/lib/reviewSession.ts src/lib/reviewSession.test.ts src/views/ReviewSessionView.tsx src/views/ReviewSessionView.css src/views/ReviewSession.browser.test.tsx src/shortcuts/reviewSessionActions.test.ts
git commit -m "feat(review): include current and historical stages"
```

---

### Task 12: Remove legacy runtime truth and close desktop release gates

**Files:**
- Modify: `src/lib/livePerformanceCycles.ts`
- Modify: `src/lib/liveStatisticsArchive.ts`
- Modify: `src/lib/livePerformanceCycleRoute.ts`
- Modify: `src/storage/types.ts`
- Modify: `src/storage/snapshotCodec.ts`
- Modify: `src/storage/persist.ts`
- Modify: `src/regression.test.ts`
- Modify: `src/lib/typographySystem.design.test.ts`
- Modify: `scripts/quality-scenarios.json`
- Modify: `docs/superpowers/specs/2026-08-22-complete-live-stage-reset-design.md`

**Interfaces:**
- Consumes: all Tasks 1-11.
- Produces: no runtime consumer of `livePerformanceCycles` or `liveStatsStartTradingDayKey`; v11 decode compatibility remains localized in migration code.
- Produces: complete Windows/macOS release evidence for schema v12 and stage rollover.

- [ ] **Step 1: Add static governance assertions**

```ts
export function testLegacyCycleFieldsAreDecodeOnly(): void {
  const runtimeFiles = projectFiles.filter(path => !path.includes('stageMigration') && !path.includes('snapshotCodec') && !path.includes('.test.'))
  assertNoText(runtimeFiles, 'liveStatsStartTradingDayKey')
  assertNoText(runtimeFiles, 'livePerformanceCycles')
}

export function testCompleteResetCopyReplacedOldResetCopy(): void {
  assertProjectTextIncludes('开启新实盘阶段')
  assertProjectTextExcludes('重置实盘统计')
}
```

- [ ] **Step 2: Run the static tests and scan consumers**

Run: `rg -n "livePerformanceCycles|liveStatsStartTradingDayKey|重置实盘统计|重置统计" src electron scripts`

Expected before cleanup: matches outside v11 migration/compatibility fixtures.

- [ ] **Step 3: Delete or quarantine legacy runtime paths**

Move any membership logic still needed for v11 decode behind `stageMigration.ts`. Remove legacy cycle routing, reset actions and date-derived archive selection from runtime exports. Persist only v12 stage truth; accept legacy fields only while decoding older manifests/imports.

- [ ] **Step 4: Run complete correctness gates**

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm build`

Run: `pnpm qa:design`

Run: `pnpm qa:desktop-visual --renderer`

Expected: all commands exit 0, with no unhandled rejection, console error, governance failure or bundle-budget regression.

- [ ] **Step 5: Run desktop durability gates**

Run: `pnpm benchmark:persistence`

Run: `pnpm test:forced-kill:electron`

Run: `pnpm test:asset-lifecycle:electron`

Run: `pnpm test:electron-safety:platform`

Expected: all evidence reports identify schema v12, the exact repository commit and a successful old-or-new atomic recovery state.

- [ ] **Step 6: Build and inspect the Windows installer**

Run: `pnpm dist:win`

Run: `Get-ChildItem release -File | Where-Object Name -Like 'Trader-Atlas-*-win-x64.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 Name,Length,LastWriteTime`

Expected: a non-empty installer newer than the build start time.

- [ ] **Step 7: Verify macOS in CI or a macOS host**

Run on macOS: `pnpm dist:mac`

Expected: non-empty x64 and arm64 DMG/ZIP artifacts, followed by the same migration, rollover, forced-kill and library-switch smoke checks.

- [ ] **Step 8: Update the design status and commit final acceptance**

Set the design status to “Implemented and verified” only after all required gates pass, then commit:

```bash
git add src/lib/livePerformanceCycles.ts src/lib/liveStatisticsArchive.ts src/lib/livePerformanceCycleRoute.ts src/storage/types.ts src/storage/snapshotCodec.ts src/storage/persist.ts src/regression.test.ts src/lib/typographySystem.design.test.ts scripts/quality-scenarios.json docs/superpowers/specs/2026-08-22-complete-live-stage-reset-design.md
git commit -m "test(live-stage): close complete reset rollout"
```

---

## Plan Acceptance Checklist

- [ ] Each stage-scoped entity has stable explicit ownership.
- [ ] v11 migration is deterministic, recoverable and non-guessing.
- [ ] Current workspace consumers share one current-stage scope.
- [ ] Historical navigation supports all history and independent stage archives.
- [ ] Historical editing changes live archive metrics but not completed weekly snapshots.
- [ ] Scheduling, blockers, automatic postponement and cancellation are durable.
- [ ] Backup verification precedes every successful rollover.
- [ ] New-stage first open is blocked until risk onboarding completes.
- [ ] Random review defaults to current plus all historical stages.
- [ ] Pending ownership has an explicit repair path.
- [ ] Legacy date-cycle fields are not runtime truth.
- [ ] Windows and macOS release gates pass with schema v12 evidence.
