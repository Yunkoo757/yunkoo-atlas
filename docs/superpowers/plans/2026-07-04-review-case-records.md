# Review Case Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a review-case record lane under the review module, while keeping those records out of account trading statistics.

**Architecture:** Extend `TradeKind` with `case`, centralize trade-kind predicates in `src/lib/tradeKind.ts`, and reuse the existing trade list/detail/composer surfaces through a dedicated `/review-cases` route. Dashboard and strategy statistics consume account-trade predicates so case records never enter PnL, win-rate, or strategy KPI calculations.

**Tech Stack:** React, TypeScript, Zustand, Vite, existing local regression runner.

---

### Task 1: Trade Kind Foundation

**Files:**
- Modify: `src/data/trades.ts`
- Modify: `src/lib/tradeKind.ts`
- Modify: `src/lib/importExport.ts`
- Modify: `src/regression.test.ts`

- [ ] **Step 1: Add failing regression tests**

Add tests asserting that `case` survives normalization/import validation and that account-trade predicates exclude it.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node scripts/run-regression-tests.mjs`

Expected: failure because `case` is currently normalized to `paper` and rejected by import validation.

- [ ] **Step 3: Implement minimal trade-kind support**

Change `TradeKind` to include `'case'`, add `TRADE_KIND_META.case`, allow `case` in import validation, and add helpers:

```ts
export function isReviewCaseTrade(trade: Trade): boolean {
  return trade.tradeKind === 'case'
}

export function isAccountTrade(trade: Trade): boolean {
  return trade.tradeKind === 'live' || trade.tradeKind === 'paper'
}
```

- [ ] **Step 4: Re-run regression tests**

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS.

### Task 2: Filtering, Counts, and Month Entries

**Files:**
- Modify: `src/lib/tradeFilters.ts`
- Modify: `src/lib/pageCopy.ts`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/App.tsx`
- Modify: `src/regression.test.ts`

- [ ] **Step 1: Add tests for default list filtering and month filtering**

Add tests that default live views exclude `case`, `/review-cases` includes only `case`, and `this-month` uses opened date.

- [ ] **Step 2: Implement route and side-nav entries**

Add `/review-cases` and `/review-cases/board` routes using `filter={{ type: 'all', tradeKind: 'case' }}`. Add `this-month`, `last-week`, and `last-month` to the sidebar time list.

- [ ] **Step 3: Update page copy**

Return `不进入仪表盘统计 · 用于沉淀错题、重点案例和经典形态` for `tradeKind === 'case'`.

- [ ] **Step 4: Re-run regression tests**

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS.

### Task 3: Dashboard and Strategy Statistics Boundary

**Files:**
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/lib/strategies.ts`
- Modify: `src/lib/reviewAnalytics.ts`
- Modify: `src/components/StrategyHeader.tsx`
- Modify: `src/views/settings/StrategiesPanel.tsx`
- Modify: `src/regression.test.ts`

- [ ] **Step 1: Add tests for statistic exclusion**

Add tests proving dashboard-like filtering and strategy stats ignore `tradeKind === 'case'`.

- [ ] **Step 2: Add Dashboard this-month range**

Add `this-month` to `TimeRange`, with bounds from the local calendar month and the existing closed-date behavior.

- [ ] **Step 3: Centralize account-trade filtering**

Use `isAccountTrade` in dashboard and strategy stats before computing count, win rate, total PnL, and review summaries.

- [ ] **Step 4: Re-run regression tests and typecheck**

Run:

```powershell
node scripts/run-regression-tests.mjs
node_modules\.bin\tsc.cmd -b
```

Expected: both PASS.

### Task 4: Create and Convert Case Records

**Files:**
- Modify: `src/components/TradeComposer.tsx`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/lib/tradeMenu.tsx`
- Modify: `src/views/ListView.tsx`
- Modify: `src/views/BoardView.tsx`
- Modify: `src/store/useStore.ts`
- Modify: `src/regression.test.ts`

- [ ] **Step 1: Add tests for converting a trade to a case record**

Add a pure helper test for copying key fields, assigning `tradeKind: 'case'`, generating a new id/ref, and leaving the original untouched.

- [ ] **Step 2: Add helper to create review case copy**

Create a focused helper in `src/lib/tradeKind.ts` or a new small file if needed. It copies trade fields, clears delete metadata, gives a new id/ref, and prefixes the note with source information.

- [ ] **Step 3: Route composer defaults**

`TradeComposer` should default to `case` on `/review-cases`.

- [ ] **Step 4: Add UI actions**

Add “沉淀为案例记录” to detail menu and row context menu. It creates a `case` copy and navigates to the new detail page.

- [ ] **Step 5: Re-run tests**

Run:

```powershell
node scripts/run-regression-tests.mjs
node_modules\.bin\tsc.cmd -b
```

Expected: both PASS.

### Task 5: Final Verification

**Files:**
- No new feature files unless earlier tasks require them.

- [ ] **Step 1: Build**

Run: `node_modules\.bin\vite.cmd build`

Expected: build succeeds. Existing bundle-size warnings are acceptable.

- [ ] **Step 2: Smoke test UI**

Start Vite on a free local port and check:

- `/review-cases` opens.
- New record from that page creates `tradeKind: 'case'`.
- Dashboard does not show case PnL.
- Sidebar shows 本月.

- [ ] **Step 3: Commit**

Commit all implementation changes with:

```powershell
git add -A
git commit -m "feat: 添加复盘案例记录"
```
