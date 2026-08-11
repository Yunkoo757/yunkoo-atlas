# Case Compare and Weekly Rule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a trader compare exactly two chosen cases, carry those sources into the existing single weekly commitment without overwriting it, and replay only the currently effective completed commitment on Today.

**Architecture:** Add a transient comparison Sheet over the existing case list rather than a route or persistent comparison entity. Present both records through a pure aligned comparison model, then pass their IDs through the existing review-flow session to the current business week. Persist only `WeeklyReview.commitmentSourceRecordIds` when the user actually edits or explicitly confirms the source relationship; freeze it with the existing weekly completion snapshot and derive Today’s effective commitment from completed weekly reviews.

**Tech Stack:** TypeScript 5.6, React 18, Zustand 4, React Router 6, TipTap 2, Electron/Vite, project SSR unit runner, Playwright browser fixtures.

## Global Constraints

- Read and write files as UTF-8 without BOM; preserve Chinese and all non-ASCII content.
- Target only Windows and macOS desktop clients. Support the approved desktop viewports 960×640, 1280×860, and 1440×900; do not add mobile/tablet branches.
- Batch 1 and schema 12 must already be installed. This plan does not raise the schema again.
- Use strict TDD for every task.
- Compare only cases, exactly two at a time. Do not create a comparison route, record, history, recommendation engine, AI summary, or third column.
- The Sheet is transient. Closing it or actively navigating away writes no comparison state into the journal.
- Comparison source failures never clear selection or close the Sheet. Missing fields render `未记录`; a deleted source renders its retained snapshot.
- The only downstream action is `带这两条进入周复盘`.
- Weekly review retains exactly one `commitmentText` and one `commitmentCriteria`. Do not add rule candidates, rule status, or a risk-discipline conversion.
- Source IDs are case-only, stable-order unique, and can remain dangling after permanent case deletion.
- Entering weekly review never overwrites existing commitment text or criteria. Cancelling writes nothing.
- Today displays only a completed commitment from immediately preceding week W when current week is W+1.
- Do not package installers or bump version.

## File Map

### Create

- `src/lib/reviewCaseComparison.ts` and `src/lib/reviewCaseComparison.test.ts` — aligned sections, differences, missing states, and stable A/B order.
- `src/components/reviewCases/ReviewCaseComparisonSheet.tsx` and `.css` — transient focus-trapped workspace layer.
- `src/components/reviewCases/ReviewCaseComparisonSheet.browser.test.tsx` and `.html` — three-size layout, focus, failure, close, and handoff contracts.
- `src/lib/weeklyCommitmentSources.ts` and `src/lib/weeklyCommitmentSources.test.ts` — case-only stable merge, staging, freeze, and effective-week selector.

### Modify

- `src/views/ListView.tsx`, `src/views/ListView.css`, `src/components/ui/BatchActionBar.tsx`, and list browser tests — compare entry and selection/scroll restoration.
- `src/store/reviewFlowSessionStore.ts` and tests — comparison return snapshot and weekly handoff.
- `src/views/WeeklyReviewView.tsx`, `src/views/WeeklyReviewView.css`, `src/views/WeeklyReviewView.browser.test.tsx` — staged sources, explicit confirmation, locked-state reopen, and return.
- `src/data/weeklyReviews.ts`, `src/data/weeklyReviews.test.ts`, `src/lib/weeklyReviewCompletion.ts`, and tests — stable normalization/freeze of schema-12 source IDs.
- `src/store/useStore.ts`, `src/lib/riskImportMerge.ts`, and tests — atomic source patch and existing import rewrite verification.
- `src/views/TodayWorkspace.tsx`, `src/views/TodayWorkspace.css`, `src/views/TodayWorkspaceReviewCase.browser.test.tsx`, and `src/views/TodayWorkspace.design.test.ts` — current effective commitment card.
- `src/lib/weeklyReviewRouteState.ts` and tests — current-week handoff and source return.

## Interfaces

```ts
export interface ReviewCaseComparisonSection {
  key: 'identity' | 'classification' | 'source' | 'insight'
  label: string
  fields: Array<{
    key: string
    label: string
    left: ReviewComparisonValue
    right: ReviewComparisonValue
    differs: boolean
  }>
}

export type ReviewComparisonValue =
  | { status: 'ready'; text: string; html?: string }
  | { status: 'empty'; text: '未记录' }
  | { status: 'loading'; text: '正在载入' }
  | { status: 'missing-source'; text: '来源已删除'; html?: string }
  | { status: 'error'; text: string; retryable: boolean }

export function buildReviewCaseComparison(
  left: Trade,
  right: Trade,
  dependencies: { strategyName(id: string): string },
): ReviewCaseComparisonSection[]

export function mergeCommitmentSourceIds(
  existing: readonly string[] | undefined,
  incoming: readonly [string, string],
  trades: readonly Trade[],
): string[]

export function effectiveWeeklyCommitment(
  reviews: readonly WeeklyReview[],
  currentWeekStart: string,
): WeeklyReview | null
```

---

### Task 1: Build the aligned two-case comparison model

**Files:**
- Create: `src/lib/reviewCaseComparison.ts`
- Create: `src/lib/reviewCaseComparison.test.ts`

- [ ] **Step 1: Add RED model contracts**

Assert stable A/B order and four sections: identity facts; case type/mastery/mistake tags; source identity/evidence; case insight. Test equal-value weakening, differing-value flags, empty text, deleted source with retained snapshot, and one-side error independence. Reject non-case or duplicate IDs.

- [ ] **Step 2: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseComparison.test.ts
```

Expected: the module does not exist.

- [ ] **Step 3: Implement the pure presenter**

Use current metadata helpers for side, status, case type, mastery, timeframe, and date. Treat sanitized HTML as display content, not a comparison key; its plain text determines equality. Preserve missing-source snapshot HTML in the value.

- [ ] **Step 4: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseComparison.test.ts
pnpm typecheck
git add src/lib/reviewCaseComparison.ts src/lib/reviewCaseComparison.test.ts
git commit -m "feat: model aligned review case comparison"
```

### Task 2: Add the transient comparison Sheet to the case list

**Files:**
- Create: `src/components/reviewCases/ReviewCaseComparisonSheet.tsx`
- Create: `src/components/reviewCases/ReviewCaseComparisonSheet.css`
- Create: `src/components/reviewCases/ReviewCaseComparisonSheet.browser.test.tsx`
- Create: `src/components/reviewCases/ReviewCaseComparisonSheet.browser.test.html`
- Modify: `src/views/ListView.tsx`
- Modify: `src/views/ListView.css`
- Modify: `src/components/ui/BatchActionBar.tsx`
- Modify: `src/store/reviewFlowSessionStore.ts`

- [ ] **Step 1: Add RED entry, layout, and focus contracts**

At each target viewport, select zero, one, two, and three cases. Assert the batch bar explains `请选择 2 条案例` unless exactly two; one visible click opens when exactly two. While open, background is inert and `aria-hidden`, initial focus is the visible close button, Tab/Shift+Tab remain inside, and Escape returns focus to the compare action without changing selection or scroll.

- [ ] **Step 2: Add RED partial-failure contracts**

Delay both source loads independently; assert stable skeleton geometry. Fail left image and delete right source while open; assert the other side remains usable, retry is local, footer stays reachable, and selection remains two.

- [ ] **Step 3: Run RED**

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
```

- [ ] **Step 4: Implement list entry and Sheet state**

Store `comparisonIds:[string,string] | null` locally in `ListView`. The action is enabled only if both selected visible records are cases. Capture `scrollTop`, selected IDs, query, saved view, and compare-button focus key into `ReviewReturnContext` before opening.

- [ ] **Step 5: Implement responsive desktop presentation**

At ≥1280 px render aligned left/right columns. At 960–1279 px render each section with A then B blocks and no horizontal scrolling. Keep header/close sticky, one main scroll container, and footer action sticky. Apply `inert` to the workspace sibling and a document-level focus trap only while mounted.

- [ ] **Step 6: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseComparison.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
git add src/components/reviewCases src/views/ListView.tsx src/views/ListView.css src/components/ui/BatchActionBar.tsx src/store/reviewFlowSessionStore.ts src/store/reviewFlowSessionStore.test.ts
git commit -m "feat: compare two cases in the workspace"
```

### Task 3: Stage comparison sources into the single weekly commitment

**Files:**
- Create: `src/lib/weeklyCommitmentSources.ts`
- Create: `src/lib/weeklyCommitmentSources.test.ts`
- Modify: `src/data/weeklyReviews.ts`
- Modify: `src/data/weeklyReviews.test.ts`
- Modify: `src/lib/weeklyReviewCompletion.ts`
- Modify: `src/lib/weeklyReviewCompletion.test.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/views/WeeklyReviewView.tsx`
- Modify: `src/views/WeeklyReviewView.css`
- Modify: `src/views/WeeklyReviewView.browser.test.tsx`
- Modify: `src/lib/weeklyReviewRouteState.ts`
- Modify: `src/lib/weeklyReviewRouteState.test.ts`

- [ ] **Step 1: Add RED source-domain contracts**

Assert stable merge order `existing + left + right`, duplicate removal, present non-case rejection, dangling ID preservation, removable staged IDs, completed-review freeze, and reopened-review editability. Repeating another comparison appends rather than replaces.

- [ ] **Step 2: Add RED journey contracts**

From the Sheet action, assert current business week opens and commitment input focuses. Empty and existing text are both unchanged. Returning without edits creates no weekly record and writes no IDs. First commitment/criteria edit atomically saves staged IDs. `确认加入来源` saves IDs without text mutation. A completed week stays locked; explicit reopen retains staged IDs in memory.

- [ ] **Step 3: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyCommitmentSources.test.ts src/data/weeklyReviews.test.ts src/lib/weeklyReviewCompletion.test.ts src/lib/weeklyReviewRouteState.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
```

- [ ] **Step 4: Implement transient staging**

The Sheet calls `reviewFlowSessionStore.begin({ origin:'compare', compareRecordIds, returnContext })` and navigates to the current week. `WeeklyReviewView` reads but does not consume staged IDs until a real edit or explicit confirmation. If no stored review exists, render `createWeeklyReview()` only in memory until that event.

- [ ] **Step 5: Implement atomic persistence and frozen display**

Extend the existing `commitPatch` path so the first real commitment/criteria mutation includes `commitmentSourceRecordIds` in the same `updateWeeklyReview` call. Render removable source chips only while draft; completed display is read-only. Missing source chips say `来源已删除`.

- [ ] **Step 6: Restore comparison on return**

On ordinary return, reopen the Sheet if both cases still exist, restoring query, selection, scroll, and focus. If one is gone, restore list state and announce why comparison cannot reopen. Main-navigation leave clears the transient return request.

- [ ] **Step 7: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyCommitmentSources.test.ts src/data/weeklyReviews.test.ts src/lib/weeklyReviewCompletion.test.ts src/lib/weeklyReviewRouteState.test.ts src/lib/riskImportMerge.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
git add src/lib/weeklyCommitmentSources.ts src/lib/weeklyCommitmentSources.test.ts src/data/weeklyReviews.ts src/data/weeklyReviews.test.ts src/lib/weeklyReviewCompletion.ts src/lib/weeklyReviewCompletion.test.ts src/store/useStore.ts src/views/WeeklyReviewView.tsx src/views/WeeklyReviewView.css src/views/WeeklyReviewView.browser.test.tsx src/lib/weeklyReviewRouteState.ts src/lib/weeklyReviewRouteState.test.ts src/lib/riskImportMerge.ts src/lib/riskImportMerge.test.ts
git commit -m "feat: carry comparison sources into weekly commitment"
```

### Task 4: Replay only the currently effective commitment on Today

**Files:**
- Modify: `src/lib/weeklyCommitmentSources.ts`
- Modify: `src/lib/weeklyCommitmentSources.test.ts`
- Modify: `src/views/TodayWorkspace.tsx`
- Modify: `src/views/TodayWorkspace.css`
- Modify: `src/views/TodayWorkspaceReviewCase.browser.test.tsx`
- Modify: `src/views/TodayWorkspace.design.test.ts`

- [ ] **Step 1: Add RED effective-week contracts**

Fixtures include prior completed, prior draft, current completed, future completed, and two-weeks-old completed records. Assert only the immediately preceding completed week with nonempty commitment is returned for current week. Crossing a year boundary must work.

- [ ] **Step 2: Add RED Today contracts**

Assert the nonblocking card contains one-line commitment, one-line criterion, source count, and `查看来源周复盘`; it does not replace or cover the risk-status primary action and renders nothing for draft/stale/future records.

- [ ] **Step 3: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyCommitmentSources.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
```

- [ ] **Step 4: Implement the selector and card**

Place the card after the action queue and before the risk strip, using the existing page surface/divider vocabulary. Link to `/weekly-review?week=<sourceWeek>` with a return anchor to the card. Do not add confirmation, dismissal, risk-policy mutation, or daily state.

- [ ] **Step 5: Run the full Batch 2 gate and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewCaseComparison.test.ts src/lib/weeklyCommitmentSources.test.ts src/data/weeklyReviews.test.ts src/lib/weeklyReviewCompletion.test.ts src/lib/weeklyReviewRouteState.test.ts src/lib/riskImportMerge.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
pnpm test
git add src/lib/weeklyCommitmentSources.ts src/lib/weeklyCommitmentSources.test.ts src/views/TodayWorkspace.tsx src/views/TodayWorkspace.css src/views/TodayWorkspaceReviewCase.browser.test.tsx src/views/TodayWorkspace.design.test.ts
git commit -m "feat: replay effective weekly commitment on today"
```

## Batch 2 Acceptance

- `CMP-01`: exactly two selected cases open one transient Sheet action and create no persistent comparison object.
- `CMP-02`: aligned facts/evidence/insight remain usable at all three desktop sizes through empty, deleted, loading, and attachment-error states.
- `CMP-03`: background is inert; focus, filter, selection, and scroll restore after close and weekly-review return.
- `RULE-01`: comparison sources stage without overwriting text; cancel writes nothing.
- `RULE-02`: completion freezes source IDs with the existing weekly truth snapshots.
- `RULE-03`: Today shows only the immediately effective completed commitment and opens its source week in one action.
