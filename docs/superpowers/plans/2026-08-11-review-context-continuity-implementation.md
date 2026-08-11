# Review Context Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry source, classification defaults, return position, and durable-save state across missed capture, trade close, trade/quick-note extraction, and continuous review without duplicate entry or silent guesses.

**Architecture:** Introduce one transient review-flow envelope owned by the current workspace session and a single extraction service shared by visible actions, More, Today, random review, and command search. Upgrade persisted data to schema 12 before writing quick-note or weekly-commitment references, with recoverable Electron migration and import ID rewriting. Extend the existing draft/persistence barriers so navigation happens only after assets, drafts, and the canonical snapshot are durably confirmed.

**Tech Stack:** TypeScript 5.6, React 18, Zustand 4, React Router 6, TipTap 2, Electron 43, sql.js journal storage, Vite, project SSR unit runner, Playwright browser fixtures.

## Global Constraints

- Read and write every file as UTF-8 without BOM; preserve all Chinese and non-ASCII text.
- Target only Windows and macOS desktop clients. Internal Chromium fixtures do not create browser support; add no phone/tablet UI or release checks.
- Use strict TDD: RED contract, smallest implementation, GREEN, then commit.
- `ReviewFlowContext` is transient workspace-session state. It is never exported, persisted in the journal, or restored on application restart.
- Inheritance priority is source record → explicit action context → unique structured list filter → safe creator default. Never inherit free-text search, date range, sort, mastery filter, or ambiguous multi-select filters.
- Missed status is fixed inside the missed-capture flow. Live/paper missed records remain execution evidence; independent missed cases never enter live performance statistics.
- Default extraction is idempotent per source. Explicit “另提炼一条” is the only operation allowed to create a second case.
- Quick-note extraction opens a confirmation form; it never silently guesses side, symbol, strategy, or case type and never copies source content into editable case insight.
- `sourceTradeId` and `sourceQuickNoteId` are mutually exclusive and valid only on cases. A deleted source leaves the last successful `sourceNoteHtml` snapshot readable.
- Raise the data schema once, from 11 to 12, and include codec/validation support for both `Trade.sourceQuickNoteId` and `WeeklyReview.commitmentSourceRecordIds` in this batch. Do not introduce a second migration in Batch 2.
- Navigation after “完成并下一条” requires asset drain, draft flush, and `flushPersistNow()` success. A store update alone is not success.
- Do not package installers or bump the application version in this plan.

## File Map

### Create

- `src/lib/reviewFlowContext.ts` and `src/lib/reviewFlowContext.test.ts` — transient envelope, inheritance, and return snapshot helpers.
- `src/store/reviewFlowSessionStore.ts` and `src/store/reviewFlowSessionStore.test.ts` — main-window-only workspace session.
- `src/lib/reviewCaseExtraction.ts` and `src/lib/reviewCaseExtraction.test.ts` — source lookup, idempotency, explicit duplicate, and result contracts.
- `src/lib/reviewCompletionCommit.ts` and `src/lib/reviewCompletionCommit.test.ts` — action-scoped durable completion and field-level rollback.
- `src/views/ReviewContextContinuity.browser.test.tsx` and `.html` — desktop journey fixture for capture, extraction, return, and complete-next.
- `src/hooks/useTradeReturnAnchor.test.ts` and `src/lib/tradeRoute.test.ts` — transient envelope precedence and route-state round trips.

### Modify

- `src/data/trades.ts`, `src/data/weeklyReviews.ts`, `src/data/weeklyReviews.test.ts` — schema-12 optional references and normalization.
- `src/storage/types.ts`, `src/storage/snapshotValidation.ts`, `src/storage/snapshotValidation.test.ts`, `src/storage/snapshotCodec.ts`, `src/storage/snapshotCodec.test.ts`, `src/storage/fixtures/fullPersistedSnapshot.ts` — v12 data contract.
- `src/lib/importMerge.ts`, `src/lib/riskImportMerge.ts`, `src/lib/riskImportMerge.test.ts`, `src/lib/importConcurrency.test.ts`, `src/lib/importExport.ts`, `src/lib/importExportAssets.test.ts`, `src/lib/webJournalArchive.ts`, `src/lib/webJournalArchive.test.ts` — reference remapping and format-version boundaries.
- `src/storage/assetInventory.ts`, `src/storage/assetInventory.test.ts`, `src/storage/tradeRichText.ts`, `src/storage/tradeRichText.test.ts` — source-snapshot asset retention.
- `electron/library/schemaMigration.ts`, `electron/library/schemaMigration.test.ts`, `electron/library/journalZip.ts`, `electron/library/journalZip.test.ts` — v11→v12 recoverable migration and container compatibility.
- `src/store/useStore.ts`, `src/lib/reviewCases.ts`, `src/lib/reviewCases.test.ts`, `src/lib/reviewCaseSourceSync.ts`, and source-sync tests — shared extraction and trade/quick-note snapshot cascade.
- `src/components/TradeComposer.tsx`, `src/components/TradeComposer.css`, and composer browser tests — context-aware explicit confirmation.
- `src/views/MissedOpportunitiesView.tsx`, `src/views/MissedOpportunitiesView.css`, `src/components/trades/MissedOpportunityFilters.tsx`, and missed browser/unit tests — in-place missed capture.
- `src/components/TradeCloseDialog.tsx`, `src/components/TradeCloseDialog.css`, and browser tests — start-review feedback alongside undo.
- `src/views/QuickNotesView.tsx`, `src/views/QuickNotesView.css`, and browser tests — flush-then-extract.
- `src/views/DetailView.tsx`, `src/hooks/useTradeReturnAnchor.ts`, `src/lib/tradeRoute.ts`, `src/shortcuts/actions.ts`, `src/shortcuts/engine.ts`, `src/config/default-profile.json`, and browser/unit tests — durable complete-next and configurable editor-local shortcut.

## Interfaces

```ts
export interface ReviewFlowContext {
  origin: 'today' | 'trade-close' | 'missed' | 'quick-note' | 'trade-detail'
    | 'case-list' | 'compare' | 'command-palette'
  sourceTradeId?: string
  sourceQuickNoteId?: string
  presetTradeKind?: 'live' | 'paper' | 'case'
  presetStatus?: 'missed'
  presetCaseType?: 'exemplar' | 'mistake' | 'ambiguous' | 'missed'
  compareRecordIds?: [string, string]
  returnContext?: ReviewReturnContext
}

export interface ReviewReturnContext {
  pathname: string
  search: string
  savedViewId?: string
  anchorRecordId?: string
  scrollTop?: number
  focusKey?: string
  commandPalette?: { query: string; activeResultKey?: string; scrollTop: number }
}

export type ReviewCaseSource =
  | { kind: 'trade'; id: string }
  | { kind: 'quick-note'; id: string }

export type ExtractReviewCaseResult =
  | { status: 'created'; reviewCase: Trade }
  | { status: 'existing'; reviewCases: Trade[] }
  | { status: 'missing-source' | 'source-is-case' | 'source-save-failed' }

export function extractReviewCase(
  source: ReviewCaseSource,
  options: { allowAdditional: boolean; now: Date; createId: () => string },
): Promise<ExtractReviewCaseResult>

export type CompleteReviewCommitResult =
  | { status: 'committed'; nextPendingId: string | null }
  | { status: 'not-ready' | 'asset-failed' | 'draft-failed' | 'persist-failed' }
  | { status: 'rollback-persist-failed'; actionId: string }
```

The store-facing extraction service may receive dependencies explicitly for unit tests, but its public UI wrapper must return the same discriminated result at every entry point.

---

### Task 1: Upgrade journal data safely from schema 11 to 12

**Files:**
- Modify all schema, codec, import, archive, and Electron migration files listed in the File Map.

- [ ] **Step 1: Add RED schema and reference contracts**

Add tests proving: v11 without new fields normalizes successfully; v12 round-trips both fields; dual trade/quick-note sources are rejected; duplicate commitment sources are rejected or normalized at the domain boundary; quick-note collision IDs and case commitment IDs are remapped; dangling commitment source IDs remain; a present commitment target must be a case.

- [ ] **Step 2: Add RED Electron recovery cases**

Extend `electron/library/schemaMigration.test.ts` with v11→v12 forced termination at `prepared`, `database-replaced`, `manifest-replaced`, and recovery-cleanup. On every reopen, assert manifest/database versions match and the canonical snapshot validates. Also prove an old `v8-to-v9` marker is still discovered.

- [ ] **Step 3: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts src/data/weeklyReviews.test.ts src/lib/riskImportMerge.test.ts src/lib/importConcurrency.test.ts src/storage/assetInventory.test.ts src/storage/tradeRichText.test.ts src/lib/webJournalArchive.test.ts
node scripts/run-regression-tests.mjs --unit-only electron/library/schemaMigration.test.ts electron/library/journalZip.test.ts
```

Expected: schema/version/reference assertions fail because version 12 and the new fields are not accepted.

- [ ] **Step 4: Add the domain and snapshot fields**

Add `sourceQuickNoteId?: string` to `Trade`; add `commitmentSourceRecordIds?: string[]` to `WeeklyReview`; normalize missing weekly values to `[]`. Raise `SCHEMA_VERSION` and therefore JSON `EXPORT_VERSION` to 12. Keep `WEB_JOURNAL_EXPORT_VERSION=9` and desktop zip container marker 1; write embedded `schemaVersion:12`.

- [ ] **Step 5: Implement import rewriting and invariant validation**

Build stable maps for both trade IDs and quick-note IDs before rewriting references. Rewrite `sourceTradeId`, `sourceQuickNoteId`, and `commitmentSourceRecordIds`. Validate target kind only when the target exists; preserve a truly absent commitment source so the UI can show `来源已删除`.

- [ ] **Step 6: Generalize Electron recovery names and versions**

Replace `8 | 9 | 10` with a migration-source type accepting 8–11. New recovery/candidate names use actual `fromVersion-toVersion`; discovery checks both generalized names and the legacy v8-to-v9 name. Delete the recovery pair only after runtime reopening of the active database+manifest and canonical snapshot/reference validation succeeds.

- [ ] **Step 7: Run GREEN and commit before any UI writes v12 data**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts src/data/weeklyReviews.test.ts src/lib/riskImportMerge.test.ts src/lib/importConcurrency.test.ts src/storage/assetInventory.test.ts src/storage/tradeRichText.test.ts src/lib/webJournalArchive.test.ts
node scripts/run-regression-tests.mjs --unit-only electron/library/schemaMigration.test.ts electron/library/journalZip.test.ts
pnpm typecheck
git add src/data/trades.ts src/data/weeklyReviews.ts src/data/weeklyReviews.test.ts src/storage src/lib/importMerge.ts src/lib/riskImportMerge.ts src/lib/riskImportMerge.test.ts src/lib/importConcurrency.test.ts src/lib/importExport.ts src/lib/importExportAssets.test.ts src/lib/webJournalArchive.ts src/lib/webJournalArchive.test.ts electron/library/schemaMigration.ts electron/library/schemaMigration.test.ts electron/library/journalZip.ts electron/library/journalZip.test.ts
git commit -m "feat: migrate review references to schema 12"
```

### Task 2: Add the transient flow envelope and return contract

**Files:**
- Create: `src/lib/reviewFlowContext.ts`
- Create: `src/lib/reviewFlowContext.test.ts`
- Create: `src/store/reviewFlowSessionStore.ts`
- Create: `src/store/reviewFlowSessionStore.test.ts`
- Modify: `src/hooks/useTradeReturnAnchor.ts`
- Create: `src/hooks/useTradeReturnAnchor.test.ts`
- Modify: `src/lib/tradeRoute.ts`
- Create: `src/lib/tradeRoute.test.ts`

- [ ] **Step 1: Add RED precedence and lifecycle tests**

Prove explicit source beats route preset; a unique symbol/strategy filter may fill only a missing field; search/date/sort/mastery never inherit; return snapshots round-trip selection anchor, scroll, focus, and command-palette fields; main navigation and window-session reset clear the envelope.

- [ ] **Step 2: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewFlowContext.test.ts src/store/reviewFlowSessionStore.test.ts src/hooks/useTradeReturnAnchor.test.ts src/lib/tradeRoute.test.ts
```

- [ ] **Step 3: Implement a non-persisted Zustand session store**

The store exposes only `begin(context)`, `peek()`, `consume()`, and `clear(reason)`. Do not include it in `pickPersisted()`. Route state carries a cloned immutable snapshot; mutable scroll/focus updates remain in this store until return.

- [ ] **Step 4: Extend the current return-anchor helper**

Prefer explicit route state, then the workspace-session return snapshot, then the existing sessionStorage anchor. Preserve current stale-anchor safety and missing-record fallback.

- [ ] **Step 5: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewFlowContext.test.ts src/store/reviewFlowSessionStore.test.ts src/hooks/useTradeReturnAnchor.test.ts src/lib/tradeRoute.test.ts
pnpm typecheck
git add src/lib/reviewFlowContext.ts src/lib/reviewFlowContext.test.ts src/store/reviewFlowSessionStore.ts src/store/reviewFlowSessionStore.test.ts src/hooks/useTradeReturnAnchor.ts src/lib/tradeRoute.ts
git commit -m "feat: carry review flow context across workspaces"
```

### Task 3: Make extraction idempotent and source-aware

**Files:**
- Create: `src/lib/reviewCaseExtraction.ts`
- Create: `src/lib/reviewCaseExtraction.test.ts`
- Modify: `src/lib/reviewCases.ts`
- Modify: `src/lib/reviewCases.test.ts`
- Modify: `src/lib/reviewCaseSourceSync.ts`
- Modify: `src/store/useStore.ts`
- Modify: source-sync tests.

- [ ] **Step 1: Add RED idempotency and synchronization tests**

Cover first creation, double call, concurrent call, one existing case, multiple existing cases sorted newest first, explicit additional creation, trade-source flush failure, quick-note-source flush failure, both source kinds syncing every linked snapshot, and source deletion retaining the last snapshot.

- [ ] **Step 2: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseExtraction.test.ts src/lib/reviewCases.test.ts src/lib/reviewCaseSourceSync.test.ts src/store/reviewCaseSourceSync.test.ts
```

- [ ] **Step 3: Implement one in-flight lock per source key**

Use `trade:<id>` or `quick-note:<id>` as the key. The default path checks existing cases after the source flush and again inside the atomic store update. `allowAdditional:true` bypasses only the existing-case return; it never bypasses source validation or flush.

- [ ] **Step 4: Generalize source snapshot cascade**

Replace the trade-only cascade with:

```ts
export function cascadeReviewCaseSourceSnapshot(
  state: Pick<AppState, 'trades' | 'quickNotes'>,
  source: ReviewCaseSource,
): Trade[]
```

It copies the normalized source HTML into `sourceNoteHtml` and never touches the case `note`.

- [ ] **Step 5: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseExtraction.test.ts src/lib/reviewCases.test.ts src/lib/reviewCaseSourceSync.test.ts src/store/reviewCaseSourceSync.test.ts
pnpm typecheck
git add src/lib/reviewCaseExtraction.ts src/lib/reviewCaseExtraction.test.ts src/lib/reviewCases.ts src/lib/reviewCases.test.ts src/lib/reviewCaseSourceSync.ts src/store/useStore.ts src/lib/reviewCaseSourceSync.test.ts src/store/reviewCaseSourceSync.test.ts
git commit -m "fix: make case extraction source aware and idempotent"
```

### Task 4: Connect missed capture, close feedback, and quick-note confirmation

**Files:**
- Modify missed, close-dialog, quick-note, composer, CSS, and browser-test files listed in the File Map.

- [ ] **Step 1: Add the cross-entry RED browser fixture**

At 960×640, 1280×860, and 1440×900 assert: missed page opens `记录错过` without route change; one-source scope hides source choice; mixed scope asks exactly once; saved kind/status semantics are correct; close toast offers both undo and start review; quick-note extraction flushes then opens a case form with symbol/side/strategy/case type empty and save disabled.

- [ ] **Step 2: Run RED**

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
```

- [ ] **Step 3: Add the in-place missed action**

Place the action in `MissedOpportunityFilters.actions` beside the scope menu. Open the existing composer with `presetStatus:'missed'`; derive a unique source from scope or show the compact live/paper/case segmented control. Saving stays on `/missed`, restores heading/filter/scroll, and offers extraction only for live/paper records.

- [ ] **Step 4: Extend close feedback without removing undo**

Use a toast/action representation that supports two named actions, or a compact follow-up toast if the existing toast contract is single-action. `开始复盘` navigates to the just-closed record with `origin:'trade-close'` and a focus key for the review editor. Undo remains independently executable.

- [ ] **Step 5: Add quick-note source mode to the composer**

Flush `${QUICK_NOTE_DRAFT_PREFIX}${id}` before opening. In this mode fix `tradeKind='case'`, prefill only business date from `createdAt`, require explicit symbol/side/strategy/case type, set status to missed only for missed type and otherwise planned, set `sourceQuickNoteId`, snapshot `contentHtml`, and start the editable case note empty.

- [ ] **Step 6: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/missedOpportunities.test.ts src/data/quickNoteCodec.test.ts src/lib/reviewCaseExtraction.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
git add src/views/MissedOpportunitiesView.tsx src/views/MissedOpportunitiesView.css src/components/trades/MissedOpportunityFilters.tsx src/components/TradeCloseDialog.tsx src/components/TradeCloseDialog.css src/views/QuickNotesView.tsx src/views/QuickNotesView.css src/components/TradeComposer.tsx src/components/TradeComposer.css src/views/MissedOpportunitiesView.browser.test.tsx src/views/QuickNotesView.browser.test.tsx src/components/TradeComposerBatch.browser.test.ts src/views/ReviewContextContinuity.browser.test.tsx src/views/ReviewContextContinuity.browser.test.html
git commit -m "feat: connect capture and extraction workflows"
```

### Task 5: Expose the same extraction command everywhere

**Files:**
- Modify: `src/views/DetailView.tsx`
- Modify: `src/views/TodayWorkspace.tsx`
- Modify: `src/views/ReviewSessionView.tsx`
- Modify: `src/components/CommandPalette.tsx`
- Modify related browser tests.

- [ ] **Step 1: Add RED entry-point parity tests**

Assert the visible detail action, More menu, Today context menu, account-record random review, and current-record command all return the same existing/created/error result. Repeated default activation creates zero extra cases; the explicit additional action creates exactly one.

- [ ] **Step 2: Run RED**

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
```

- [ ] **Step 3: Replace direct `createReviewCaseFromTrade` calls**

All entry points call `extractReviewCase()`. For one existing result, navigate directly; for several, show a compact newest-first selection with a secondary `另提炼一条`; for created, focus `案例洞见`; for a flush error, stay at the source.

- [ ] **Step 4: Run GREEN and commit**

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
git add src/views/DetailView.tsx src/views/TodayWorkspace.tsx src/views/ReviewSessionView.tsx src/components/CommandPalette.tsx src/views/DetailShortcutNavigation.browser.test.tsx src/views/TodayWorkspaceReviewCase.browser.test.tsx src/views/ReviewSession.browser.test.tsx src/components/CommandPalette.browser.test.tsx
git commit -m "feat: share one case extraction command"
```

### Task 6: Commit review completion durably before moving on

**Files:**
- Create: `src/lib/reviewCompletionCommit.ts`
- Create: `src/lib/reviewCompletionCommit.test.ts`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/storage/persist.ts`
- Modify: `src/storage/pendingOperations.ts`
- Modify: `src/shortcuts/actions.ts`
- Modify: `src/shortcuts/engine.ts`
- Modify: `src/config/default-profile.json`
- Modify: `src/views/DetailShortcutNavigation.browser.test.tsx`
- Modify: `src/views/ReviewContextContinuity.browser.test.tsx`

- [ ] **Step 1: Add RED transaction and rollback tests**

Inject success, asset rejection, draft rejection, primary persist rejection, rollback persist success, and rollback persist rejection. Mutate the note between primary failure and rollback; assert only `reviewStatus/reviewedAt` from the action are restored and the concurrent note survives. Assert no failure path navigates.

- [ ] **Step 2: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCompletionCommit.test.ts src/storage/persistenceController.test.ts
```

- [ ] **Step 3: Implement the ordered barrier**

The service sequence is: `waitForPendingStorageOperations()` → `flushNoteDraftToStore(id)` → latest readiness check → action-scoped store update → `flushPersistNow()` → compute next eligible ID. On primary persistence failure, apply a field-level conditional rollback using the action ID and await a second `flushPersistNow()`.

- [ ] **Step 4: Add `trade.completeAndNext` to the shortcut registry**

Default binding is `{ mod:true, shift:true, key:'enter' }`, scope `detail`. The editor boundary reads the resolved binding and invokes the same command locally because the global engine intentionally does not consume typing targets. Ignore IME composition, keyCode 229, repeats, conflicts, and submitting state. Preserve TipTap `Mod+Enter` hard-break behavior.

- [ ] **Step 5: Implement return/finish behavior**

From Today, the last record returns to Today and focuses the source queue. From a filtered list, the last record restores list query, saved view, scroll, selection anchor, and focus. Deep-link completion stays on the current detail. `仅完成` calls the same transaction but does not navigate.

- [ ] **Step 6: Run the complete Batch 1 gate and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCompletionCommit.test.ts src/lib/reviewFlowContext.test.ts src/store/reviewFlowSessionStore.test.ts src/lib/reviewCaseExtraction.test.ts src/lib/reviewCases.test.ts src/lib/reviewCaseSourceSync.test.ts src/store/reviewCaseSourceSync.test.ts src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts src/lib/riskImportMerge.test.ts src/lib/importConcurrency.test.ts
node scripts/run-regression-tests.mjs --unit-only electron/library/schemaMigration.test.ts electron/library/journalZip.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
pnpm test
git add src/lib/reviewCompletionCommit.ts src/lib/reviewCompletionCommit.test.ts src/views/DetailView.tsx src/storage/persist.ts src/storage/pendingOperations.ts src/shortcuts/actions.ts src/shortcuts/engine.ts src/config/default-profile.json src/views/DetailShortcutNavigation.browser.test.tsx src/views/ReviewContextContinuity.browser.test.tsx
git commit -m "feat: persist review completion before navigation"
```

## Batch 1 Acceptance

- `CAP-01`: missed capture stays in place, inherits a unique source, and asks at most one source question.
- `CAP-02`: live/paper missed records retain their statistics semantics; an independent missed case does not enter performance statistics.
- `CAP-03`: close feedback retains undo and opens the same record's review body in one action.
- `CAP-04`: trade extraction inherits known facts, and a failed source save creates no case.
- `CAP-05`: double, repeated, and concurrent default extraction create at most one case; explicit additional extraction remains available.
- `CAP-06`: quick-note structure is explicitly confirmed; the source remains, the insight starts empty, and snapshot/assets stay traceable.
- `EVD-01`: both source kinds sync one-way without duplicating the underlying image asset.
- `EVD-02`: loading, missing source, and missing asset states stay distinguishable and do not destroy other evidence.
- `FLOW-01`–`FLOW-02`: 20 sequential reviews lose no content/context; injected save and rollback failures never report false success.
- `KEY-01`: `Mod+Shift+Enter` works on Windows/macOS semantics without stealing TipTap or IME input.
- `MIG-01`: v11 upgrades directly to v12 and every recovery boundary reopens a consistent pair.
