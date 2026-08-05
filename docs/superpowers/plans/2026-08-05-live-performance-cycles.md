# Live Performance Cycles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named, repeatable live-performance cycles so users can restart default performance statistics without deleting trades, cases, notes, screenshots, weekly reviews, or risk settings.

**Architecture:** Persist only ordered cycle boundaries and names. Resolve a selected cycle to half-open trading-day bounds, then apply those bounds to the existing closed-live analysis pipeline; never write a cycle ID onto a trade. Keep Dashboard/strategy URL defaults separate from the transaction-list default, and keep the existing risk `liveCycle`/`liveStatsStartTradingDayKey` contract independent.

**Tech Stack:** TypeScript 5.6, React 18, Zustand 4, React Router 6, Electron/Vite, project Node test runner, Playwright browser fixtures, IndexedDB/Electron snapshot persistence.

## Global Constraints

- Always read and write project files as UTF-8 without BOM; preserve all Chinese and non-ASCII text.
- Do not delete, archive, copy, or batch-modify trades when creating or changing a cycle.
- Do not add a persisted cycle ID to `Trade`; attribution is derived from the normalized close trading day.
- Keep `livePerformanceCycles` separate from the existing risk field `liveStatsStartTradingDayKey` and URL parameter `liveCycle`.
- A cross-boundary trade belongs to the cycle containing its close trading day, not its open trading day.
- Cases, paper trades, open trades, missed opportunities, and soft-deleted trades never enter live-performance aggregates.
- Existing weekly-review snapshots, Today statistics, the Dashboard natural-week card, and risk calculations must remain unchanged.
- An empty cycle collection preserves the pre-feature all-history Dashboard behavior.
- Do not add dependencies, cloud services, or schema migrations that rewrite trade records.
- Use strict TDD: demonstrate RED before production edits, then GREEN, then review and commit.
- Run commands from a worktree created with `using-git-worktrees` when execution begins.

## Baseline Before Task 1

- [ ] Create an isolated worktree and confirm it starts from the commit containing this plan.
- [ ] Run `pnpm typecheck` and record exit code 0.
- [ ] Run `pnpm test` and record exit code 0.
- [ ] Confirm `git status --short` is empty before dispatching Task 1.

---

### Task 1: Build the cycle domain and attribution engine

**Files:**
- Create: `src/lib/livePerformanceCycles.ts`
- Create: `src/lib/livePerformanceCycles.test.ts`

**Interfaces:**
- Consumes: `Trade`, `isExecutedClosed()`, `closedTradingDayKeyFromClosedAt()`, and strict local-day validation from existing date utilities.
- Produces:

```ts
export type LivePerformanceCycle = {
  id: string
  name: string
  startTradingDayKey: string
  createdAt: string
}

export type LivePerformanceCycleBounds = {
  startInclusive: string | null
  endExclusive: string | null
}

export type ResolvedLivePerformanceCycle = {
  key: 'all' | 'pre-cycle' | string
  cycleId: string | null
  label: string
  bounds: LivePerformanceCycleBounds | null
  isCurrent: boolean
  requestedKey: string | null
  wasFallback: boolean
}

export function assertValidLivePerformanceCycles(value: unknown): asserts value is LivePerformanceCycle[]
export function cloneLivePerformanceCycles(value?: readonly LivePerformanceCycle[]): LivePerformanceCycle[]
export function resolveLivePerformanceCycle(
  cycles: readonly LivePerformanceCycle[],
  requested: string | null,
): ResolvedLivePerformanceCycle
export function filterTradesByLivePerformanceCycle(
  trades: readonly Trade[],
  resolved: ResolvedLivePerformanceCycle,
  tradingDayStartHour: number,
): Trade[]
export function countLiveTradesMissingCloseDay(
  trades: readonly Trade[],
  tradingDayStartHour: number,
): number
export function appendLivePerformanceCycle(
  cycles: readonly LivePerformanceCycle[],
  cycle: LivePerformanceCycle,
  currentTradingDayKey: string,
): LivePerformanceCycle[]
export function renameLivePerformanceCycle(
  cycles: readonly LivePerformanceCycle[],
  id: string,
  name: string,
): LivePerformanceCycle[]
export function undoLatestLivePerformanceCycle(
  cycles: readonly LivePerformanceCycle[],
): LivePerformanceCycle[]
```

- [ ] **Step 1: Write failing validation and interval tests**

Create deterministic fixtures with three boundaries and closed live trades on the day before, on, and after each boundary. Export tests similar to:

```ts
export function testPerformanceCyclesUseHalfOpenCloseDayIntervals(): void {
  const cycles = [
    cycle('one', '第一期', '2026-01-01'),
    cycle('two', '第二期', '2026-04-01'),
  ]
  const current = resolveLivePerformanceCycle(cycles, null)
  const previous = resolveLivePerformanceCycle(cycles, 'one')
  assert(ids(filterTradesByLivePerformanceCycle(trades, current, 0)) === 'on-second,after-second')
  assert(ids(filterTradesByLivePerformanceCycle(trades, previous, 0)) === 'on-first,before-second')
}

export function testCrossBoundaryTradeBelongsToCloseDayCycle(): void {
  const trade = closedLive('cross', { openedAt: '2026-03-30', closedAt: '2026-04-02' })
  const result = filterTradesByLivePerformanceCycle(
    [trade],
    resolveLivePerformanceCycle(cycles, 'two'),
    0,
  )
  assert(result[0]?.id === 'cross', '跨周期交易必须按平仓交易日进入新周期')
}
```

Also assert all of the following explicitly:

- empty cycles resolve to `all`;
- `pre-cycle` is unbounded before the first start;
- invalid/unknown requested IDs resolve to current without mutating input;
- current is the newest start and does not require a stored current ID;
- case, paper, open, missed, and soft-deleted trades are excluded;
- `closedTradingDayKey` wins over `closedAt` fallback;
- malformed close dates increase the missing-day count and enter no cycle;
- duplicate IDs, names, start days, invalid dates, invalid ISO `createdAt`, unsorted starts, empty names, and names over 40 characters are rejected;
- append rejects a future start and a start not later than the newest boundary;
- rename rejects blank/duplicate names;
- undo removes only the newest boundary and never touches trade fixtures.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/livePerformanceCycles.test.ts
```

Expected: exit 1 because `src/lib/livePerformanceCycles.ts` and its exported functions do not exist.

- [ ] **Step 3: Implement the minimal pure domain module**

Use a single internal close-day resolver and compare canonical `YYYY-MM-DD` strings only after strict validation. Never sort invalid persisted input silently; `assertValidLivePerformanceCycles()` must reject unordered arrays. Return cloned arrays from append/rename/undo so Zustand reference checks detect changes.

Use half-open bounds:

```ts
const inBounds =
  (bounds.startInclusive === null || day >= bounds.startInclusive) &&
  (bounds.endExclusive === null || day < bounds.endExclusive)
```

Do not call `new Date('YYYY-MM-DD')` to determine membership. Use the stored/fallback trading-day key so timezone changes cannot shift a trade between cycles.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/livePerformanceCycles.test.ts
pnpm typecheck
```

Expected: both exit 0; the focused runner reports every exported cycle test PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/lib/livePerformanceCycles.ts src/lib/livePerformanceCycles.test.ts
git commit -m "feat: add live performance cycle domain"
```

---

### Task 2: Add the v10 snapshot and archive contract

**Files:**
- Modify: `src/storage/types.ts`
- Modify: `src/storage/persistedKeys.ts`
- Modify: `src/storage/emptySnapshot.ts`
- Modify: `src/storage/snapshotValidation.ts`
- Modify: `src/storage/snapshotValidation.test.ts`
- Modify: `src/storage/snapshotCodec.ts`
- Modify: `src/storage/snapshotCodec.test.ts`
- Modify: `src/storage/fixtures/fullPersistedSnapshot.ts`
- Modify: `src/storage/persist.ts`
- Modify: `src/storage/bootstrap.ts`
- Modify: `src/lib/webJournalArchiveContract.ts`
- Modify: `src/lib/webJournalArchive.test.ts`

**Interfaces:**
- Consumes: `LivePerformanceCycle`, `assertValidLivePerformanceCycles()`, and `cloneLivePerformanceCycles()` from Task 1.
- Produces: `PersistedSnapshot.livePerformanceCycles?: LivePerformanceCycle[]`; canonical snapshots and Zustand persistence always expose a non-optional array.

- [ ] **Step 1: Write failing snapshot-contract tests**

Update the full sentinel fixture with a non-default cycle:

```ts
livePerformanceCycles: [{
  id: 'performance-cycle-contract',
  name: '合同统计周期',
  startTradingDayKey: '2026-07-14',
  createdAt: '2026-07-14T00:00:00.000Z',
}],
```

Add tests proving:

```ts
export function testV10RequiresCyclesAndV9DefaultsThem(): void {
  const full = createFullPersistedSnapshotFixture()
  const missing = { ...full } as Record<string, unknown>
  delete missing.livePerformanceCycles
  assertThrows(() => decodeCanonicalSnapshot(missing, { version: 10 }), 'v10 必须要求周期字段')
  const legacy = decodeCanonicalSnapshot(missing, { version: 9 })
  assert(legacy.livePerformanceCycles.length === 0, 'v9 必须迁移为空周期且保持全部历史')
}
```

In `snapshotValidation.test.ts`, reject duplicate ID/name/start, unordered starts, invalid day keys, invalid ISO timestamps, and unknown object shapes. Verify a valid nonempty collection survives validation unchanged.

- [ ] **Step 2: Run contract tests and verify RED**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts src/lib/webJournalArchive.test.ts
```

Expected: exit 1 because the current schema is 9 and the snapshot contract has no cycle field.

- [ ] **Step 3: Implement schema v10 and Web archive v9**

Make these exact version changes:

```ts
export const SCHEMA_VERSION = 10
export const WEB_JOURNAL_EXPORT_VERSION = 9
```

Add `livePerformanceCycles` to `PERSISTED_SNAPSHOT_FIELDS`, `createEmptyPersistedSnapshot()`, `pickPersisted()`, bootstrap hydration, and the full sentinel fixture. In `decodeCanonicalSnapshot()`:

- require the field for version 10;
- default it to `[]` for versions 1–9;
- validate before cloning;
- include it in the final `CanonicalSnapshot`.

Do not derive cycles from `liveStatsStartTradingDayKey`; verify both fields coexist in the sentinel fixture with different dates.

- [ ] **Step 4: Run snapshot tests, full contract writers, and typecheck**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts src/lib/webJournalArchive.test.ts src/lib/importExportAssets.test.ts
pnpm typecheck
```

Expected: exit 0. The writer contract must report no missing active persisted key; v9 input must decode to an empty cycle collection.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/storage/types.ts src/storage/persistedKeys.ts src/storage/emptySnapshot.ts src/storage/snapshotValidation.ts src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.ts src/storage/snapshotCodec.test.ts src/storage/fixtures/fullPersistedSnapshot.ts src/storage/persist.ts src/storage/bootstrap.ts src/lib/webJournalArchiveContract.ts src/lib/webJournalArchive.test.ts src/lib/importExportAssets.test.ts
git commit -m "feat: persist live performance cycles"
```

---

### Task 3: Add Store mutations and import precedence

**Files:**
- Modify: `src/store/useStore.ts`
- Create: `src/store/livePerformanceCycles.test.ts`
- Modify: `src/lib/importTypes.ts`
- Modify: `src/lib/importMerge.ts`
- Modify: `src/lib/importExport.ts`
- Modify: `src/lib/importExportAssets.test.ts`
- Modify: `src/lib/importConcurrency.test.ts`

**Interfaces:**
- Consumes: Task 1 append/rename/undo functions and Task 2 persisted field.
- Produces Store state/actions:

```ts
livePerformanceCycles: LivePerformanceCycle[]
replaceLivePerformanceCycles: (cycles: readonly LivePerformanceCycle[]) => void
createLivePerformanceCycle: (
  cycle: LivePerformanceCycle,
  currentTradingDayKey: string,
) => void
renameLivePerformanceCycle: (id: string, name: string) => void
undoLatestLivePerformanceCycle: () => void
```

- [ ] **Step 1: Write failing Store and merge tests**

Add deterministic Store tests that preserve and restore the previous Zustand state. Assert:

```ts
useStore.getState().createLivePerformanceCycle(first, '2026-08-05')
assert(useStore.getState().livePerformanceCycles[0]?.id === first.id)
useStore.getState().renameLivePerformanceCycle(first.id, '新名称')
assert(useStore.getState().livePerformanceCycles[0]?.name === '新名称')
useStore.getState().undoLatestLivePerformanceCycle()
assert(useStore.getState().livePerformanceCycles.length === 0)
assert(JSON.stringify(useStore.getState().trades) === beforeTrades)
```

In import tests, use different local/imported sentinels and prove:

- nonempty local cycles win;
- empty local cycles adopt validated imported cycles;
- trade/risk merge behavior is unchanged;
- concurrent local cycle changes during `commitImport()` trigger a retry and the latest local configuration still wins;
- `applyImport()` summary includes `保留当前统计周期设置` when both sides are nonempty and includes the adopted cycle count when local is empty.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/store/livePerformanceCycles.test.ts src/lib/importExportAssets.test.ts src/lib/importConcurrency.test.ts
```

Expected: exit 1 because Store state/actions and merge precedence do not exist.

- [ ] **Step 3: Implement Store state and import behavior**

Initialize `livePerformanceCycles: []`. `replaceLivePerformanceCycles()` must validate and clone before publishing. Other actions delegate to Task 1 pure functions and publish only when a new array is returned.

Extend every portable snapshot state, reset, restore, and `applySnapshotToStore()` path. In `mergeImportPayload()` implement exactly:

```ts
livePerformanceCycles:
  current.livePerformanceCycles.length > 0
    ? cloneLivePerformanceCycles(current.livePerformanceCycles)
    : cloneLivePerformanceCycles(payload.livePerformanceCycles),
```

Include the field in the persisted revision identity so a concurrent cycle edit is never overwritten by an awaited JSON import. Build the user-facing import summary from the initial/final decision without exposing IDs.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/store/livePerformanceCycles.test.ts src/lib/importExportAssets.test.ts src/lib/importConcurrency.test.ts
pnpm typecheck
```

Expected: exit 0; cases and trades in the Store test remain byte-for-byte equal after all cycle actions.

- [ ] **Step 5: Commit Task 3**

```powershell
git add src/store/useStore.ts src/store/livePerformanceCycles.test.ts src/lib/importTypes.ts src/lib/importMerge.ts src/lib/importExport.ts src/lib/importExportAssets.test.ts src/lib/importConcurrency.test.ts
git commit -m "feat: manage live performance cycle state"
```

---

### Task 4: Define route state and integrate the shared analysis scope

**Files:**
- Create: `src/lib/livePerformanceCycleRoute.ts`
- Create: `src/lib/livePerformanceCycleRoute.test.ts`
- Modify: `src/lib/analysisScope.ts`
- Modify: `src/lib/analysisScope.test.ts`

**Interfaces:**
- Consumes: `resolveLivePerformanceCycle()` and `LivePerformanceCycleBounds` from Task 1.
- Produces:

```ts
export type LivePerformanceCycleRouteState = {
  resolved: ResolvedLivePerformanceCycle
  canonicalSearch: string
  needsReplace: boolean
}

export function resolvePerformanceAnalysisRoute(
  input: string | URLSearchParams,
  kind: AnalysisKind,
  cycles: readonly LivePerformanceCycle[],
): LivePerformanceCycleRouteState

export function writePerformanceAnalysisCycle(
  input: string | URLSearchParams,
  selected: 'current' | 'pre-cycle' | 'all' | string,
  cycles: readonly LivePerformanceCycle[],
): URLSearchParams

export function writeTradeListPerformanceCycle(
  input: string | URLSearchParams,
  cycleId: string | 'pre-cycle' | null,
): URLSearchParams
```

Extend the existing analysis function without breaking call sites:

```ts
export function filterTradesByAnalysisScope(
  trades: readonly Trade[],
  scope: AnalysisScope,
  now?: Date | BusinessDateAnchor,
  tradingDayStartHour?: number,
  performanceBounds?: LivePerformanceCycleBounds | null,
): Trade[]
```

- [ ] **Step 1: Write failing route and composition tests**

Test exact canonical behavior:

```ts
const current = resolvePerformanceAnalysisRoute('?kind=live&statsCycle=current-id&visual=x', 'live', cycles)
assert(current.canonicalSearch === '?kind=live&visual=x', '分析页当前周期 ID 必须压缩')

const historical = resolvePerformanceAnalysisRoute('?kind=live&statsCycle=old-id&range=30d', 'live', cycles)
assert(historical.resolved.cycleId === 'old-id')

const paper = resolvePerformanceAnalysisRoute('?kind=paper&statsCycle=old-id&visual=x', 'paper', cycles)
assert(!paper.canonicalSearch.includes('statsCycle') && paper.canonicalSearch.includes('visual=x'))
```

Also prove:

- selecting any cycle resets `range=all`;
- invalid Dashboard/strategy IDs normalize to current with `replace` semantics;
- current explicit ID is retained by `writeTradeListPerformanceCycle()` because the list default is unfiltered;
- an invalid list ID can be removed without selecting current;
- `statsCycle` takes precedence over and removes `liveCycle`;
- unrelated parameters and stable parameter ordering survive;
- cycle bounds apply only when `scope.kind === 'live'`;
- existing paper/all and relative-date analysis results remain unchanged;
- cycle bounds and relative range intersect rather than replace one another.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/livePerformanceCycleRoute.test.ts src/lib/analysisScope.test.ts
```

Expected: exit 1 because the route module and fifth analysis argument do not exist.

- [ ] **Step 3: Implement route ownership and shared filtering**

Keep Dashboard/strategy canonicalization in the new route module; do not scatter `URLSearchParams.get('statsCycle')` comparisons across components. Apply cycle bounds in `filterTradesByAnalysisScope()` after the existing account/closed/kind filter and before relative ranges. When no cycle exists, pass `null` and preserve the old all-history result.

Extend `strategyAnalysisHref()` with an optional canonical `statsCycle` value and keep its existing callers source-compatible.

- [ ] **Step 4: Run route/analysis tests, regression tests, and typecheck**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/livePerformanceCycleRoute.test.ts src/lib/analysisScope.test.ts src/regression.test.ts
pnpm typecheck
```

Expected: exit 0; existing analysisScope tests require no expectation changes except new explicit cycle cases.

- [ ] **Step 5: Commit Task 4**

```powershell
git add src/lib/livePerformanceCycleRoute.ts src/lib/livePerformanceCycleRoute.test.ts src/lib/analysisScope.ts src/lib/analysisScope.test.ts src/regression.test.ts
git commit -m "feat: add performance cycle route scope"
```

---

### Task 5: Add the Dashboard selector and consistent aggregates

**Files:**
- Create: `src/components/LivePerformanceCycleControl.tsx`
- Create: `src/components/LivePerformanceCycleControl.css`
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/Dashboard.css`
- Create: `src/views/LivePerformanceCycleDashboard.browser.test.tsx`
- Create: `src/views/LivePerformanceCycleDashboard.browser.test.html`

**Interfaces:**
- Consumes: Task 3 Store state, Task 4 route resolver/writer, existing `Select`, and `filterTradesByAnalysisScope(..., bounds)`.
- Produces: a reusable Dashboard cycle selector with props `{ selected, cycles, onSelect, onManage }` and a stable “查看本周期交易” href.

- [ ] **Step 1: Write a failing production-path browser fixture**

Mount the real `Dashboard` under a Memory/Data Router with:

- two closed live trades in different cycles;
- one cross-boundary trade;
- one paper trade;
- one case copied from an old live trade;
- a current-week missed opportunity;
- two strategies.

Assert through visible UI and links:

```ts
assert(text().includes('当前统计周期 · 第二期'))
assert(text().includes('+$250'))
selectCycle('第一期')
assert(router.state.location.search.includes('statsCycle=cycle-one'))
assert(router.state.location.search.includes('range=all'))
assert(text().includes('+$100'))
assert(document.querySelector('[data-cycle-trade-link]')?.getAttribute('href')?.includes('statsCycle=cycle-one'))
```

Also assert the natural-week card still shows the current-week missed opportunity after selecting a historical cycle; paper/all modes hide the cycle selector and preserve their previous totals; invalid IDs canonicalize with a single replace; no cycle collection keeps all-history totals and shows the create entry.

- [ ] **Step 2: Run browser tests and verify RED**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
```

Expected: exit 1 in the new fixture because the Dashboard lacks the cycle selector and still aggregates all live history.

- [ ] **Step 3: Implement selector and Dashboard scope**

Use `resolvePerformanceAnalysisRoute()` once per render. Canonicalize invalid URL state in a guarded effect with `replace`; do not maintain a second selected-cycle state. Feed the resolved bounds to the main aggregate `trades` calculation only.

Leave these calculations untouched by the cycle:

- `activeTrades` and its navigation;
- current natural-week `weekMetrics` and missed opportunities;
- Today and weekly-review links.

The selector order is current, historical newest-first, `统计起点前`, `全部历史`. If cycles are empty, render only `开始新统计周期`, and keep all-history metrics. Build strategy links and the trade-list href from the same resolved route state.

- [ ] **Step 4: Run browser matrix, focused unit tests, and typecheck**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
node scripts/run-regression-tests.mjs --unit-only src/lib/livePerformanceCycles.test.ts src/lib/livePerformanceCycleRoute.test.ts src/lib/analysisScope.test.ts
pnpm typecheck
```

Expected: all commands exit 0; WeeklyReview and existing Dashboard browser fixtures remain PASS at every registered viewport.

- [ ] **Step 5: Commit Task 5**

```powershell
git add src/components/LivePerformanceCycleControl.tsx src/components/LivePerformanceCycleControl.css src/views/Dashboard.tsx src/views/Dashboard.css src/views/LivePerformanceCycleDashboard.browser.test.tsx src/views/LivePerformanceCycleDashboard.browser.test.html
git commit -m "feat: scope dashboard by performance cycle"
```

---

### Task 6: Implement create, rename, and latest-cycle undo with durable rollback

**Files:**
- Create: `src/components/LivePerformanceCycleManager.tsx`
- Create: `src/components/LivePerformanceCycleManager.css`
- Create: `src/components/LivePerformanceCycleManager.browser.test.tsx`
- Create: `src/components/LivePerformanceCycleManager.browser.test.html`
- Modify: `src/components/LivePerformanceCycleControl.tsx`
- Modify: `src/views/Dashboard.tsx`

**Interfaces:**
- Consumes: Task 1 validation/mutation rules, Task 3 Store actions, `flushPersistNow()`, `DatePicker`, `ModalShell`, and `toast()`.
- Produces: `LivePerformanceCycleManager` with create, rename, and undo modes; it commits a complete next array or restores the previous reference on failure.

- [ ] **Step 1: Write failing browser tests for the complete management flow**

Drive real buttons and inputs. Cover:

1. Empty library → create first cycle → current Dashboard scope changes only after persistence succeeds.
2. Existing cycles → create next → previous end preview is the day before the new start.
3. Backdated first cycle preview counts closed live trades by close day, including a cross-boundary trade.
4. Duplicate name, duplicate/same-day boundary, start before/equal current start, future date, blank name, and over-40 name keep Confirm disabled and show a stable reason.
5. Rename changes only the cycle name; serialized `trades`, cases, weekly reviews, and risk start remain identical.
6. Undo removes only the newest boundary; undoing the sole boundary restores empty-cycle/all-history behavior.
7. Injected `flushPersistNow()` failure restores the exact previous cycle array and shows `统计周期保存失败，原设置已保留`.
8. Injected save plus rollback failure shows `统计周期保存与回滚均失败，请重新打开应用核对当前设置`.
9. Repeated submit is disabled while busy; Escape/backdrop cannot close a busy modal.

- [ ] **Step 2: Run browser tests and verify RED**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
```

Expected: exit 1 because the manager and durable mutation flow do not exist.

- [ ] **Step 3: Implement one transactional commit path**

All modes must call one local helper shaped as:

```ts
async function commitCycles(next: LivePerformanceCycle[], successMessage: string) {
  const previous = useStore.getState().livePerformanceCycles
  replaceLivePerformanceCycles(next)
  try {
    await flushPersistNow()
    toast(successMessage)
  } catch {
    replaceLivePerformanceCycles(previous)
    try {
      await flushPersistNow()
      toast('统计周期保存失败，原设置已保留')
    } catch {
      toast('统计周期保存与回滚均失败，请重新打开应用核对当前设置')
    }
  }
}
```

Generate ID and `createdAt` only when Confirm is pressed, not during render. After successful creation, navigate to the canonical current Dashboard scope with `range=all`. Rename any real cycle; never expose rename for the virtual pre-cycle. Undo targets only the newest array element and requires a destructive-looking confirmation without using delete-record language.

- [ ] **Step 4: Run browser tests, Store tests, and typecheck**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
node scripts/run-regression-tests.mjs --unit-only src/store/livePerformanceCycles.test.ts src/lib/livePerformanceCycles.test.ts
pnpm typecheck
```

Expected: exit 0; failure fixtures produce expected toasts without leaving changed cycles or records.

- [ ] **Step 5: Commit Task 6**

```powershell
git add src/components/LivePerformanceCycleManager.tsx src/components/LivePerformanceCycleManager.css src/components/LivePerformanceCycleManager.browser.test.tsx src/components/LivePerformanceCycleManager.browser.test.html src/components/LivePerformanceCycleControl.tsx src/views/Dashboard.tsx
git commit -m "feat: manage performance cycle boundaries"
```

---

### Task 7: Preserve cycle scope through strategy and transaction-list drill-down

**Files:**
- Modify: `src/components/StrategyHeader.tsx`
- Modify: `src/lib/workbenchTrades.ts`
- Modify: `src/components/trades/TradeFilters.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/lib/sidebarWorkspace.ts`
- Modify: `src/lib/savedTradeViews.ts`
- Create: `src/lib/savedTradeViews.test.ts`
- Modify: `src/lib/livePerformanceCycleRoute.ts`
- Create: `src/views/LivePerformanceCycleNavigation.browser.test.tsx`
- Create: `src/views/LivePerformanceCycleNavigation.browser.test.html`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes: explicit list route writer from Task 4 and Store cycles from Task 3.
- Produces: strategy stats and transaction-list visible sets derived from the same resolved bounds as Dashboard; list filter label `统计周期：<name>` with a clear action.

- [ ] **Step 1: Write failing cross-page browser tests**

From the real Dashboard:

- choose a historical cycle;
- open a real strategy row and assert the strategy header total/PNL match the Dashboard subset;
- navigate back and click `查看本周期交易`;
- assert only exact cycle members are visible and the filter label shows the cycle name;
- clear the filter and assert the existing unfiltered list returns;
- repeat for current cycle and assert the list URL contains its explicit real ID even though Dashboard omitted it;
- create a newer cycle in Store and assert the existing list URL remains on the original ID;
- remove that ID and assert list canonicalization clears only `statsCycle` rather than switching to current.

Also test URL conflict `?statsCycle=<id>&liveCycle=pre-cycle`: statistics scope wins, `liveCycle` is removed with replace, and the sidebar count matches the visible list.

- [ ] **Step 2: Run the browser suite and verify RED**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
```

Expected: exit 1 because strategy/list consumers do not yet resolve `statsCycle`.

- [ ] **Step 3: Wire all drill-down consumers to one resolver**

Add cycles to `useWorkbenchVisibleTrades()`/sidebar context inputs, resolve explicit list IDs without Dashboard-style current-ID compression, and filter the list by close-day bounds only when `tradeKind=live` and a valid explicit cycle exists.

In `TradeFilters`:

- own and preserve `statsCycle`;
- display a `Select`/chip only when an explicit cycle filter is active or selectable from a Dashboard deep link;
- selecting `statsCycle` deletes `liveCycle`;
- selecting `liveCycle` deletes `statsCycle`;
- clearing removes only `statsCycle` and keeps unrelated filters.

Saved-view canonicalization may preserve a valid `statsCycle` query, but its human label must be resolved from current Store cycle names at render time; never display a raw UUID. If a saved view refers to a removed cycle, canonicalize it as an inactive/cleared filter instead of silently selecting current.

- [ ] **Step 4: Run navigation, sidebar, saved-view, and regression gates**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts src/lib/livePerformanceCycleRoute.test.ts src/lib/savedTradeViews.test.ts
pnpm typecheck
```

Expected: all exit 0; Dashboard, strategy, visible rows, and sidebar count agree for each explicit cycle.

- [ ] **Step 5: Commit Task 7**

```powershell
git add src/components/StrategyHeader.tsx src/lib/workbenchTrades.ts src/components/trades/TradeFilters.tsx src/components/Sidebar.tsx src/lib/sidebarWorkspace.ts src/lib/savedTradeViews.ts src/lib/savedTradeViews.test.ts src/lib/livePerformanceCycleRoute.ts src/views/LivePerformanceCycleNavigation.browser.test.tsx src/views/LivePerformanceCycleNavigation.browser.test.html src/regression.test.ts
git commit -m "feat: preserve performance cycle drill-down"
```

---

### Task 8: Close compatibility, copy, accessibility, and release-quality gates

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-live-performance-cycles-design.md`
- Modify: `src/views/LivePerformanceCycleDashboard.browser.test.tsx`
- Modify: `src/components/LivePerformanceCycleManager.browser.test.tsx`
- Modify: `src/views/LivePerformanceCycleNavigation.browser.test.tsx`
- Test all files changed in Tasks 1–7.

**Interfaces:**
- Consumes: complete feature from Tasks 1–7.
- Produces: a release-ready implementation with the design status marked implemented and an evidence-backed final report. No EXE is built unless the user asks after implementation.

- [ ] **Step 1: Add final negative and accessibility assertions**

Before touching production code again, ensure tests directly assert:

- selector has an accessible label and keyboard-operable options;
- modal focus enters the first invalid/primary field, Escape works only when idle, and focus returns to the trigger;
- current/historical/all labels never use the risk term “风险核算周期”;
- the natural-week card explicitly remains “本周交易分析” while a historical performance cycle is selected;
- empty cycle, empty selected cycle, missing close day, result conflict, and persistence failure copies are distinct;
- 375×812 has no horizontal overflow and keeps Confirm/Cancel reachable;
- cycle operations do not change serialized trades, case-owned fields, weekly-review snapshots, `liveStatsStartTradingDayKey`, or asset references.

- [ ] **Step 2: Run focused RED if any acceptance assertion exposes a gap**

Run the narrowest command containing the new assertion first. Expected: if it fails, the failure names the exact missing copy/accessibility/compatibility behavior. Do not loosen the assertion to fit current output.

- [ ] **Step 3: Make only acceptance-gap fixes and update design status**

Fix only issues demonstrated by Step 2. Change the design header to:

```md
状态：已实施并通过完整回归
```

Do not add cycle comparisons, charts, arbitrary middle-boundary deletion, cloud sync, or risk-period coupling.

- [ ] **Step 4: Run the complete final gate from a clean test process**

Run:

```powershell
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected:

- every command exits 0;
- browser fixtures pass at registered desktop/tablet/mobile viewports;
- mobile risk QA remains PASS;
- governance reports every UTF-8 text file valid and without BOM;
- bundle budgets remain within their existing limits;
- `git status --short` contains only intentional Task 8 documentation/test changes before commit.

- [ ] **Step 5: Review the whole branch against its fork point**

Run:

```powershell
$baseCommit = git merge-base HEAD main
git diff --stat "$baseCommit..HEAD"
git diff --check "$baseCommit..HEAD"
git log --oneline "$baseCommit..HEAD"
```

Verify `$baseCommit` equals the baseline recorded when the execution worktree was created. Review specifically for trade mutation, case mutation, risk coupling, duplicated date logic, URL replace loops, import overwrite races, and missing persisted fields.

- [ ] **Step 6: Commit Task 8**

```powershell
git add docs/superpowers/specs/2026-08-05-live-performance-cycles-design.md src/views/LivePerformanceCycleDashboard.browser.test.tsx src/components/LivePerformanceCycleManager.browser.test.tsx src/views/LivePerformanceCycleNavigation.browser.test.tsx
git commit -m "docs: complete live performance cycle rollout"
```

Inspect `git diff --cached --name-only` before committing; it must contain exactly the four Task 8 files listed in the command.

## Final Review Checklist

- [ ] No trade or case receives a persisted cycle ID.
- [ ] Existing users see all-history metrics until they explicitly create a first cycle.
- [ ] Current Dashboard defaults to latest cycle; list defaults remain unchanged.
- [ ] Cross-boundary trades use close trading day.
- [ ] Historical and pre-cycle scopes are stable and URL-restorable.
- [ ] Dashboard, strategy, list, and sidebar use one shared attribution engine.
- [ ] Natural-week, weekly-review, Today, and risk results remain unchanged.
- [ ] Store/persistence/import/export cover nonempty cycle sentinels.
- [ ] Create/rename/undo are durable, rollback-safe, and do not change records.
- [ ] Full tests, build, diff, and UTF-8/no-BOM gates pass on the final branch.
