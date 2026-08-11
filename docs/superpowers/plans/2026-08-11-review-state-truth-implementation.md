# Review State Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make case classification, due scheduling, account-trade review semantics, and keyboard navigation tell one consistent truth before adding any new workflow UI.

**Architecture:** Add one pure case-classification boundary and route only classification mutations through it; preserve legacy fields on unrelated writes. Extend the existing session snapshot with a timing discriminator, normalize old in-progress sessions to their former all-record behavior, and move review keys into the configurable shortcut registry. Keep legacy URL and saved-view predicates readable while hiding the obsolete case classification control from normal creation and filtering.

**Tech Stack:** TypeScript 5.6, React 18, Zustand 4, React Router 6, Electron/Vite, project SSR unit runner, Playwright browser fixtures.

## Global Constraints

- Read and write every file as UTF-8 without BOM; preserve all Chinese and non-ASCII text.
- Product and release acceptance cover Windows and macOS desktop clients only. Browser fixtures are internal rendering contracts, not browser support; do not add mobile breakpoints or mobile release gates.
- Follow strict TDD for every task: add the narrow failing contract, run it to an attributable RED, make the smallest production change, and rerun to GREEN.
- Do not delete `reviewCategory`, `reviewStatus`, old query parameters, or saved-view fields. They remain import/query compatibility data.
- Only case creation or a mutation containing `caseType`, `masteryState`, or `nextReviewAt` may derive compatibility fields. Note, comment, image, tag, source-sync, and unrelated trade mutations must preserve legacy compatibility values byte-for-byte.
- A legacy focus case is starred atomically on its first classification mutation. The focus scope continues matching `starredIds` or an untouched legacy focus value.
- New random-review rounds default to due cases; saved pre-upgrade rounds missing `reviewTiming` normalize to `all`.
- Account trades explicitly added to random review never display or persist mastery assessment fields.
- Do not package installers or bump the application version in this plan.

## File Map

### Create

- `src/lib/reviewCaseClassification.ts` — canonical case classification mutation and legacy-focus preservation.
- `src/lib/reviewCaseClassification.test.ts` — exhaustive truth-table and mutation-boundary tests.

### Modify

- `src/data/trades.ts` — keep existing types; document the two legacy compatibility fields.
- `src/lib/reviewCases.ts` and `src/lib/reviewCases.test.ts` — build new cases through the canonical classifier.
- `src/store/useStore.ts` and `src/store/reviewCaseSourceSync.test.ts` — atomically apply classification and focus-star changes while preserving nonclassification writes.
- `src/components/TradeComposer.tsx` and `src/components/TradeComposerBatch.browser.test.ts` — stop deriving compatibility values locally.
- `src/views/DetailView.tsx` — route mastery/type/date changes through the store boundary.
- `src/components/trades/TradeFilters.tsx` — hide the ordinary case `reviewCategory` selector while retaining active legacy chips.
- `src/lib/reviewCaseScope.ts`, `src/lib/tradeView.ts`, `src/lib/workbenchTrades.ts`, `src/lib/savedTradeViews.ts` and their focused tests — preserve legacy focus URLs/saved views through an adapter.
- `src/lib/reviewSession.ts` and `src/lib/reviewSession.test.ts` — due/all timing, legacy session normalization, and non-case no-op assessment patch.
- `src/views/ReviewSessionView.tsx`, `src/views/ReviewSessionView.css`, and `src/views/ReviewSession.browser.test.tsx` — due selector and account-trade branch.
- `src/shortcuts/types.ts`, `src/shortcuts/actions.ts`, `src/shortcuts/engine.ts`, `src/shortcuts/ShortcutHost.ts`, `src/config/default-profile.json`, and shortcut tests — configurable session keys and consistent Q/E.
- `package.json` and `scripts/test-discovery.test.mjs` — remove mobile QA from the default desktop product gate while leaving its explicit script callable.

## Interfaces

```ts
export type CaseClassificationMutation = Partial<Pick<
  Trade,
  'caseType' | 'masteryState' | 'nextReviewAt'
>>

export interface CaseClassificationResult {
  trade: Trade
  promoteLegacyFocusToStar: boolean
}

export function containsCaseClassificationMutation(
  patch: Record<string, unknown>,
): boolean

export function applyCaseClassificationMutation(
  trade: Trade,
  patch: CaseClassificationMutation,
): CaseClassificationResult

export type ReviewTiming = 'due' | 'all'

export type ReviewSessionFilters = {
  includeCases: boolean
  includeAccountTrades: boolean
  caseScope: ReviewCaseScope
  requireContent: boolean
  reviewTiming: ReviewTiming
}

export function buildReviewSessionPool(
  trades: readonly Trade[],
  filters: ReviewSessionFilters,
  starredIds: ReadonlySet<string>,
  currentTradingDayKey: string,
  tradingDayStartHour: number,
): Trade[]
```

`applyCaseClassificationMutation()` rejects non-case input, never changes `mistakeTags`, and derives compatibility fields by this fixed table: mastered → `mastered/reviewed`; recheck → `recheck/unreviewed`; new+mistake → `mistake/unreviewed`; new+ambiguous → `ambiguous/unreviewed`; otherwise `normal/unreviewed`. It does not schedule dates by itself; callers pass the intended date in the same patch.

---

### Task 1: Establish the canonical case-classification boundary

**Files:**
- Create: `src/lib/reviewCaseClassification.ts`
- Create: `src/lib/reviewCaseClassification.test.ts`
- Modify: `src/data/trades.ts`

- [ ] **Step 1: Add the complete RED truth table**

Cover all `masteryState × caseType` outcomes, isolated case-type changes, isolated date changes, mistake-tag non-effects, rejection of account trades, and legacy focus promotion:

```ts
export function testCaseClassificationTruthTable(): void {
  const cases = [
    ['mastered', 'mistake', 'mastered', 'reviewed'],
    ['recheck', 'exemplar', 'recheck', 'unreviewed'],
    ['new', 'mistake', 'mistake', 'unreviewed'],
    ['new', 'ambiguous', 'ambiguous', 'unreviewed'],
    ['new', 'exemplar', 'normal', 'unreviewed'],
    ['new', 'missed', 'normal', 'unreviewed'],
  ] as const
  for (const [masteryState, caseType, reviewCategory, reviewStatus] of cases) {
    const result = applyCaseClassificationMutation(caseTrade, { masteryState, caseType })
    assert(result.trade.reviewCategory === reviewCategory, `${masteryState}/${caseType} 分类镜像错误`)
    assert(result.trade.reviewStatus === reviewStatus, `${masteryState}/${caseType} 状态镜像错误`)
  }
}
```

- [ ] **Step 2: Run the narrow test and record RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseClassification.test.ts
```

Expected: module resolution fails because the new classification module does not yet exist.

- [ ] **Step 3: Implement the pure boundary**

Use own-property checks so `{ nextReviewAt: undefined }` is still recognized as an explicit classification mutation. Return a new trade and `promoteLegacyFocusToStar=true` only when the original case has `reviewCategory === 'focus'` or `reviewStatus === 'focus'`.

- [ ] **Step 4: Run GREEN and typecheck**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseClassification.test.ts
pnpm typecheck
```

- [ ] **Step 5: Commit the boundary**

```powershell
git add src/data/trades.ts src/lib/reviewCaseClassification.ts src/lib/reviewCaseClassification.test.ts
git commit -m "feat: centralize review case classification"
```

### Task 2: Route every classification write through the boundary

**Files:**
- Modify: `src/lib/reviewCases.ts`
- Modify: `src/lib/reviewCases.test.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/store/reviewCaseSourceSync.test.ts`
- Modify: `src/components/TradeComposer.tsx`
- Modify: `src/components/TradeComposerBatch.browser.test.ts`
- Modify: `src/views/DetailView.tsx`

- [ ] **Step 1: Add RED integration contracts**

Prove: creation from missed source produces `status=missed/caseType=missed`; changing case type does not alter mastery/date; changing mastery and date writes one compatible object; a legacy focus mutation adds its ID to `starredIds`; `updateNote`, source snapshot cascade, comment, and mistake-tag changes preserve legacy focus; the composer no longer guesses an independent compatibility value.

- [ ] **Step 2: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCases.test.ts src/store/reviewCaseSourceSync.test.ts src/lib/reviewCaseClassification.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
```

Expected: store and composer assertions fail because compatibility values are still derived at each caller.

- [ ] **Step 3: Integrate atomically in `updateTradeData`**

Build the regular merged candidate first. When `previous.tradeKind === 'case'` and `containsCaseClassificationMutation(patch)`, call the classifier, write its trade into the same undo action, and append the ID to `starredIds` in the same Zustand `set`. For all other patches keep the current merge path unchanged.

- [ ] **Step 4: Reuse the boundary during case construction and composer creation**

Construct a base case with `masteryState:'new'` and the intended `nextReviewAt`, then classify once. Keep `status=missed/caseType=missed` as the missed-flow invariant. Remove `legacyReviewCategory` from the composer.

- [ ] **Step 5: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseClassification.test.ts src/lib/reviewCases.test.ts src/store/reviewCaseSourceSync.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
git add src/lib/reviewCases.ts src/lib/reviewCases.test.ts src/store/useStore.ts src/store/reviewCaseSourceSync.test.ts src/components/TradeComposer.tsx src/components/TradeComposerBatch.browser.test.ts src/views/DetailView.tsx
git commit -m "fix: keep case classification writes atomic"
```

### Task 3: Preserve legacy filters without exposing a fourth case axis

**Files:**
- Modify: `src/components/trades/TradeFilters.tsx`
- Modify: `src/lib/reviewCaseScope.ts`
- Modify: `src/lib/tradeView.ts`
- Modify: `src/lib/workbenchTrades.ts`
- Modify: `src/lib/savedTradeViews.ts`
- Create: `src/lib/reviewCaseCompatibility.test.ts`

- [ ] **Step 1: Add RED compatibility cases**

Open a legacy `?reviewCategory=focus` case view with: one starred normalized case, one untouched legacy-focus case, and one ordinary case. Assert the first two match. Assert a legacy active chip is labeled `旧分类：重点` and removable, while a clean case filter dialog contains only case type, mastery, and mistake tags.

- [ ] **Step 2: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseCompatibility.test.ts
```

- [ ] **Step 3: Add a query compatibility adapter**

Expose a pure helper:

```ts
export function matchesLegacyCaseReviewCategory(
  trade: Trade,
  category: ReviewCategory,
  starredIds: ReadonlySet<string>,
): boolean
```

For `focus`, use the shared focus scope predicate. For other values preserve exact matching unless an already-approved unambiguous mapping exists. Thread `starredIds` into the list facet call site; do not globally reinterpret account-trade categories.

- [ ] **Step 4: Remove only the ordinary selector**

Delete the `复盘分类` select from the case dialog. Keep parsing, serialization, saved-view naming, and active-chip removal. Prefix only a currently active legacy query chip with `旧分类：`.

- [ ] **Step 5: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseCompatibility.test.ts src/lib/savedTradeViews.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
git add src/components/trades/TradeFilters.tsx src/lib/reviewCaseScope.ts src/lib/tradeView.ts src/lib/workbenchTrades.ts src/lib/savedTradeViews.ts src/lib/reviewCaseCompatibility.test.ts
git commit -m "fix: preserve legacy case filters without duplicate controls"
```

### Task 4: Make random review honor due dates and record type

**Files:**
- Modify: `src/lib/reviewSession.ts`
- Modify: `src/lib/reviewSession.test.ts`
- Modify: `src/views/ReviewSessionView.tsx`
- Modify: `src/views/ReviewSessionView.css`
- Modify: `src/views/ReviewSession.browser.test.tsx`

- [ ] **Step 1: Add RED pool and session-compatibility contracts**

Use a fixed business day and fixtures for today, overdue, future, mastered-with-date, missing-date, invalid ISO, deleted, and account records. Assert due membership exactly; `all` includes future/mastered cases; old JSON without timing loads as `all`; a new saved session writes `due`; `buildReviewAssessmentPatch(accountTrade, 'mastered', fixedNow)` returns `{}`.

- [ ] **Step 2: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts
```

- [ ] **Step 3: Implement deterministic timing normalization**

Add `reviewTiming:'due'` to `DEFAULT_REVIEW_SESSION_FILTERS`. Parse `YYYY-MM-DD` directly; convert legacy ISO values using `getTradingDayKey(value, tradingDayStartHour)`; treat invalid/missing unmastered dates as due. Normalize loaded session filters before returning them, setting missing timing to `all`.

- [ ] **Step 4: Branch the review UI by record type**

Add the explicit `到期案例 / 全部案例（含未到期与已掌握）` setting. For account trades replace the mastery prompt with two actions: `提炼为案例` and `下一条`. The former uses the existing deduplicated extraction command once Batch 1 is present; until then it calls the current extraction path, while no assessment button is rendered or persisted.

- [ ] **Step 5: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
git add src/lib/reviewSession.ts src/lib/reviewSession.test.ts src/views/ReviewSessionView.tsx src/views/ReviewSessionView.css src/views/ReviewSession.browser.test.tsx
git commit -m "fix: honor due dates in random review"
```

### Task 5: Register review keys and align Q/E across desktop workspaces

**Files:**
- Modify: `src/shortcuts/types.ts`
- Modify: `src/shortcuts/actions.ts`
- Modify: `src/shortcuts/engine.ts`
- Modify: `src/views/ReviewSessionView.tsx`
- Modify: `src/config/default-profile.json`
- Modify: `src/shortcuts/listActions.test.ts`
- Modify: `src/shortcuts/workspaceActions.test.ts`
- Create: `src/shortcuts/reviewSessionActions.test.ts`
- Modify: `package.json`
- Modify: `scripts/test-discovery.test.mjs`

- [ ] **Step 1: Add RED registry contracts**

Add action IDs `reviewSession.unfamiliar`, `reviewSession.recheck`, `reviewSession.mastered`, `reviewSession.skip`, and `reviewSession.back`. Assert their defaults remain `1/2/3/N/P`, their scope is `reviewSession`, and they are active only on `/review-session`. Assert list and detail both resolve Q to previous and E to next. Assert `pnpm test` no longer expands `qa:risk-management-mobile` while the explicit script still exists.

- [ ] **Step 2: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/shortcuts/reviewSessionActions.test.ts src/shortcuts/listActions.test.ts src/shortcuts/workspaceActions.test.ts
node --test scripts/test-discovery.test.mjs
```

- [ ] **Step 3: Extend the registry and engine**

Add `reviewSession` to `ShortcutScope` with priority 50 and activate it for `/review-session`. Register view-local handlers with `registerShortcutHandlers()`. Remove the hardcoded capture listener and `reviewSessionKeyAction()` from `reviewSession.ts`. Mastery handlers must no-op when the current record is not a case.

- [ ] **Step 4: Correct defaults and desktop gate**

Set `list.focusPrev={key:'q'}` and `list.focusNext={key:'e'}` in `default-profile.json`; do not overwrite user custom bindings. Remove only `pnpm qa:risk-management-mobile` from `scripts.test`; keep `qa:risk-management-mobile` available for historical diagnostics.

- [ ] **Step 5: Run the full batch gate and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseClassification.test.ts src/lib/reviewCaseCompatibility.test.ts src/lib/reviewCases.test.ts src/lib/reviewSession.test.ts src/store/reviewCaseSourceSync.test.ts src/shortcuts/reviewSessionActions.test.ts src/shortcuts/listActions.test.ts src/shortcuts/workspaceActions.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
pnpm test
git add src/shortcuts/types.ts src/shortcuts/actions.ts src/shortcuts/engine.ts src/views/ReviewSessionView.tsx src/config/default-profile.json src/shortcuts/listActions.test.ts src/shortcuts/workspaceActions.test.ts src/shortcuts/reviewSessionActions.test.ts package.json scripts/test-discovery.test.mjs
git commit -m "fix: align desktop review shortcuts"
```

## Batch 0 Acceptance

- `CLS-01`: all classification entry points produce the same case state and compatibility mirrors.
- `CLS-02`: ordinary case filters expose no independent review-category decision.
- `DUE-01`: future, mastered, and deleted cases enter the default pool zero times.
- `DUE-02`: reviewing account trades writes zero case classification fields.
- `KEY-01` partial: Q/E and existing random-review keys are consistent and configurable.
- Existing legacy focus URLs, saved views, and pre-upgrade in-progress sessions remain readable.
