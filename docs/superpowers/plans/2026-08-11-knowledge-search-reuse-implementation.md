# Review Knowledge Search and Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cases, trade reviews, quick notes, and completed weekly commitments findable and reusable from the existing command palette with correct type labels, fair group visibility, restored search context, and reproducible desktop performance.

**Architecture:** Build an in-memory local index of normalized knowledge documents keyed by entity and update only changed documents when Zustand source arrays change. Keep commands, navigation, strategies, tags, and saved views on their existing paths; query knowledge through a pure ranked search function with fixed group quotas, then compose both streams in CommandPalette. Store the transient palette return snapshot in the current workspace session. Benchmark the production Electron renderer with a deterministic 20,000-record journal and fixed input-to-DOM timing protocol; introduce no worker or external search service unless the recorded Windows or macOS baseline fails.

**Tech Stack:** TypeScript 5.6, React 18, Zustand 4, React Router 6, Electron 43, Vite production build, Playwright Electron automation, project SSR unit runner.

## Global Constraints

- Read and write every file as UTF-8 without BOM; preserve Chinese and non-ASCII text.
- Product support and performance acceptance cover Windows and macOS desktop clients only. Browser fixtures are internal regression tools; remove obsolete mobile assertions encountered in touched command-palette tests.
- Use strict TDD for each task.
- Keep Cmd/Ctrl+K and the existing command palette. Do not add a search route, remote service, database table, fuzzy semantic engine, OCR, or AI ranking.
- Index only committed store state. Editor drafts, image bytes, and OCR text are excluded.
- Strip rich-text tags, decode entities, normalize whitespace/case, and cap each body field at 4,000 plain-text characters.
- Knowledge groups are `case`, `trade`, `quick-note`, and `weekly-commitment`. Draft weekly reviews never enter the commitment group.
- Sort inside a group by exact identity, exact metadata, prefix, body substring, then recent business update, then stable identity.
- Return at most 24 knowledge results and at most 8 from one group. Every nonempty matching group receives at least one slot.
- Case results must never be labeled as trades. Every result shows type, primary title, matched field, and a short snippet; weekly commitments show their week.
- Index updates must be incremental by entity signature, not rebuilt on each keypress.
- Do not introduce a Worker until a measured target platform fails the approved production benchmark. If it fails, stop and record evidence before changing architecture.
- Do not package release installers or bump application version in this plan; production unpacked Electron builds are sufficient for the benchmark.

## File Map

### Create

- `src/lib/knowledgeSearch.ts` and `src/lib/knowledgeSearch.test.ts` — document extraction, normalization, ranking, quotas, snippets, and stable ordering.
- `src/lib/knowledgeSearchIndex.ts` and `src/lib/knowledgeSearchIndex.test.ts` — incremental keyed index and entity signatures.
- `src/hooks/useKnowledgeSearchIndex.ts` and `src/hooks/useKnowledgeSearchIndex.test.ts` — one app-level index lifecycle over Zustand sources.
- `src/components/CommandPaletteKnowledge.browser.test.tsx` and `.html` — grouped results, accessibility, return-state, and stale-result UI.
- `scripts/fixtures/knowledge-search-20000.mjs` and `scripts/fixtures/knowledge-search-20000.test.mjs` — deterministic benchmark journal.
- `scripts/benchmark-knowledge-search.mjs` — production Electron measurement and JSON report.
- `scripts/knowledge-search-benchmark.html` — production benchmark driver entry when the automation needs an isolated renderer harness.

### Modify

- `src/components/CommandPalette.tsx`, `src/components/CommandPalette.css`, and `src/components/CommandPalette.browser.test.tsx` — compose grouped knowledge results and restore palette state.
- `src/App.tsx` — own a stable index instance and transient palette session across detail navigation.
- `src/store/reviewFlowSessionStore.ts` and tests — command palette query/active key/scroll return snapshot.
- `src/data/quickNoteCodec.ts` and tests — reuse the canonical HTML-to-text decoder if gaps are found.
- `src/lib/reviewFlowContext.ts` and tests — command-palette return context validation.
- `package.json` — `benchmark:knowledge-search` command.
- `scripts/test-discovery.test.mjs` — discover the new unit/browser/fixture contracts.

## Interfaces

```ts
export type KnowledgeDocumentKind = 'case' | 'trade' | 'quick-note' | 'weekly-commitment'

export interface KnowledgeSearchDocument {
  key: string
  kind: KnowledgeDocumentKind
  entityId: string
  primary: string
  secondary: string
  stableIdentity: string
  updatedAtMs: number
  fields: Array<{
    name: 'ref' | 'symbol' | 'title' | 'strategy' | 'tag' | 'mistake-tag'
      | 'case-type' | 'mastery' | 'insight' | 'source' | 'review'
      | 'comment' | 'commitment' | 'criteria' | 'source-ref'
    text: string
    tier: 'identity' | 'metadata' | 'body'
  }>
}

export interface KnowledgeSearchHit {
  key: string
  kind: KnowledgeDocumentKind
  entityId: string
  primary: string
  secondary: string
  matchedField: KnowledgeSearchDocument['fields'][number]['name']
  snippet: string
  scoreTier: 0 | 1 | 2 | 3
  updatedAtMs: number
}

export class KnowledgeSearchIndex {
  reconcile(input: {
    trades: readonly Trade[]
    quickNotes: readonly QuickNote[]
    weeklyReviews: readonly WeeklyReview[]
    strategies: readonly Strategy[]
  }): { added: number; updated: number; removed: number }
  query(query: string): KnowledgeSearchHit[]
  size(): number
}

export function allocateKnowledgeGroupQuota(
  grouped: ReadonlyMap<KnowledgeDocumentKind, readonly KnowledgeSearchHit[]>,
  options?: { totalLimit?: number; groupLimit?: number },
): KnowledgeSearchHit[]
```

Ranking tier values are fixed: 0 exact ref/symbol; 1 exact title/strategy/tag/mistake tag/case type/mastery; 2 prefix; 3 body substring. Earlier tier wins; then newer `updatedAtMs`; then locale-stable identity.

---

### Task 1: Build canonical knowledge documents and deterministic ranking

**Files:**
- Create: `src/lib/knowledgeSearch.ts`
- Create: `src/lib/knowledgeSearch.test.ts`
- Modify: `src/data/quickNoteCodec.ts`
- Modify: `src/data/quickNoteCodec.test.ts`

- [ ] **Step 1: Add RED extraction contracts**

Build one live trade, paper trade, case with source snapshot, quick note, completed weekly review, and draft weekly review. Assert the approved fields enter the correct group; draft commitment is absent; HTML entities decode; tags disappear; each body is capped at 4,000 characters; deleted entities are absent.

- [ ] **Step 2: Add RED update-time contracts**

For trade/case, choose the maximum valid timestamp from activities, reviewedAt, recordedAt, closedAt, openedAt. Quick note uses `updatedAt`; weekly commitment uses `completedAt`, then `updatedAt`. Invalid values are ignored and stable identity breaks final ties.

- [ ] **Step 3: Add RED ranking/quota contracts**

Prove exact ref beats metadata exact, metadata exact beats prefix, prefix beats body substring, and newer wins only within the same tier. With more than 60 matching trades plus one match in every smaller group, assert all four groups receive at least one result, none exceed 8, and total does not exceed 24.

- [ ] **Step 4: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/knowledgeSearch.test.ts src/data/quickNoteCodec.test.ts
```

- [ ] **Step 5: Implement extraction and pure query**

Reuse `textFromQuickNoteHtml` as the canonical decoder; extend it only if tests reveal entity/whitespace gaps. Precompute normalized field strings at document-build time. Build snippets around the first normalized match while displaying original plain text and staying below 120 visible characters.

- [ ] **Step 6: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/knowledgeSearch.test.ts src/data/quickNoteCodec.test.ts
pnpm typecheck
git add src/lib/knowledgeSearch.ts src/lib/knowledgeSearch.test.ts src/data/quickNoteCodec.ts src/data/quickNoteCodec.test.ts
git commit -m "feat: index review knowledge documents"
```

### Task 2: Maintain one incremental in-memory index

**Files:**
- Create: `src/lib/knowledgeSearchIndex.ts`
- Create: `src/lib/knowledgeSearchIndex.test.ts`
- Create: `src/hooks/useKnowledgeSearchIndex.ts`
- Create: `src/hooks/useKnowledgeSearchIndex.test.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add RED incremental contracts**

Reconcile an initial dataset, then change one case note, add one quick note, delete one trade, rename one referenced strategy, and change an unrelated display preference. Assert only affected document keys report add/update/remove; the display-only change performs zero document work. Repeated identical reconcile returns all zeros.

- [ ] **Step 2: Add RED stale-query contract**

Start a query, update one matched entity before rendering, and assert the subsequent query cannot return the removed/stale document. The index exposes `ready` only after initial reconciliation.

- [ ] **Step 3: Run RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/knowledgeSearchIndex.test.ts src/hooks/useKnowledgeSearchIndex.test.ts
```

- [ ] **Step 4: Implement signature-keyed reconciliation**

Keep maps for entity signature, document, and strategy-to-document dependencies. A signature includes only indexed fields/timestamps/source snapshot. Strategy rename invalidates documents that reference its ID. Remove deleted IDs before adding/updating. `query()` reads prebuilt normalized fields and never reconstructs documents.

- [ ] **Step 5: Mount one stable instance at app level**

Create the index once with `useRef`. Reconcile in an effect subscribed only to `trades`, `quickNotes`, `weeklyReviews`, and `strategies`. Pass the index/ready state to CommandPalette through a narrow context or props; do not put the index into the persisted store.

- [ ] **Step 6: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/knowledgeSearch.test.ts src/lib/knowledgeSearchIndex.test.ts src/hooks/useKnowledgeSearchIndex.test.ts
pnpm typecheck
git add src/lib/knowledgeSearchIndex.ts src/lib/knowledgeSearchIndex.test.ts src/hooks/useKnowledgeSearchIndex.ts src/hooks/useKnowledgeSearchIndex.test.ts src/App.tsx
git commit -m "perf: update knowledge search index incrementally"
```

### Task 3: Compose grouped knowledge into CommandPalette and restore context

**Files:**
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/components/CommandPalette.css`
- Modify: `src/components/CommandPalette.browser.test.tsx`
- Create: `src/components/CommandPaletteKnowledge.browser.test.tsx`
- Create: `src/components/CommandPaletteKnowledge.browser.test.html`
- Modify: `src/store/reviewFlowSessionStore.ts`
- Modify: `src/store/reviewFlowSessionStore.test.ts`
- Modify: `src/lib/reviewFlowContext.ts`
- Modify: `src/lib/reviewFlowContext.test.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add RED search-coverage contracts**

Seed unique tokens in a case mistake tag, case insight, case source, trade review, trade comment, quick-note body, completed commitment, criterion, and commitment source ref. Assert each finds the expected type. Assert the draft commitment token finds nothing. Keep existing commands, strategies, ordinary tags, and saved views findable.

- [ ] **Step 2: Add RED rendering and accessibility contracts**

Assert group headings `案例/交易/随记/周承诺`, type badge, matched-field label, snippet, case-vs-trade distinction, week label, `aria-busy` during deferred query, active descendant, keyboard navigation, Escape focus return, and no obsolete mobile drawer assertions in the touched test.

- [ ] **Step 3: Add RED return-state contract**

Search for a token, move active selection, scroll the list, open a result, and return. Assert query, active result key, scrollTop, input focus, and list result order restore. If the active entity was deleted, restore the query and focus the nearest surviving result with an announcement.

- [ ] **Step 4: Run RED**

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
```

- [ ] **Step 5: Compose rather than replace current commands**

Keep the no-query command layout. For a nonempty query, build current fixed command/strategy/tag results as before, then append knowledge hits grouped by kind with stable keys. Cap only the knowledge stream at 24; preserve existing overall “还有更多结果” feedback using the combined total.

- [ ] **Step 6: Persist only transient palette state**

Before opening a knowledge result, call:

```ts
reviewFlowSessionStore.begin({
  origin: 'command-palette',
  returnContext: {
    pathname: location.pathname,
    search: location.search,
    focusKey: 'command-palette-input',
    commandPalette: { query, activeResultKey, scrollTop },
  },
})
```

On return, CommandPalette initializes from this session snapshot exactly once; closing by Escape without navigation keeps current focus behavior and does not create a return request. Main navigation clears it.

- [ ] **Step 7: Run GREEN and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/knowledgeSearch.test.ts src/lib/knowledgeSearchIndex.test.ts src/store/reviewFlowSessionStore.test.ts src/lib/reviewFlowContext.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
git add src/components/CommandPalette.tsx src/components/CommandPalette.css src/components/CommandPalette.browser.test.tsx src/components/CommandPaletteKnowledge.browser.test.tsx src/components/CommandPaletteKnowledge.browser.test.html src/store/reviewFlowSessionStore.ts src/store/reviewFlowSessionStore.test.ts src/lib/reviewFlowContext.ts src/lib/reviewFlowContext.test.ts src/App.tsx
git commit -m "feat: search and restore review knowledge"
```

### Task 4: Build a reproducible 20,000-record production benchmark

**Files:**
- Create: `scripts/fixtures/knowledge-search-20000.mjs`
- Create: `scripts/fixtures/knowledge-search-20000.test.mjs`
- Create: `scripts/benchmark-knowledge-search.mjs`
- Create: `scripts/knowledge-search-benchmark.html`
- Modify: `package.json`
- Modify: `scripts/test-discovery.test.mjs`

- [ ] **Step 1: Add RED deterministic-fixture contracts**

With seed `atlas-search-20000-v1`, assert exact counts: 10,000 live, 2,000 paper, 6,000 cases, 1,800 quick notes, and 200 completed weekly reviews. Assert 70% bodies are 600 chars, 25% 2,000, 5% 4,000; every trade/case has three tags; every case has one mistake tag; every weekly review has commitment and criterion. Generate the fixed nine positive query classes plus one no-result query.

- [ ] **Step 2: Run RED**

```powershell
node --test scripts/fixtures/knowledge-search-20000.test.mjs
```

- [ ] **Step 3: Implement deterministic generation**

Use a local seeded PRNG and fixed UTC timestamps; do not depend on current date, locale randomness, crypto UUID, or network. Export both a canonical snapshot and expected top result/group for every query.

- [ ] **Step 4: Implement the production Electron measurement driver**

The script runs `pnpm build:app`, launches the unpacked Electron app with an isolated temporary userData/library, imports the deterministic snapshot, waits for storage hydration and `data-knowledge-index-ready`, closes DevTools, and enforces zoom 100%. It warms the query set twice, runs 50 fixed pseudo-random rounds (450 positive samples), and records input event → results DOM commit → next animation frame with `aria-busy=false`. It warms palette opening five times, measures shortcut event → focused input 50 times, and records p50/p95/max by query class and overall.

- [ ] **Step 5: Emit auditable platform metadata and fail thresholds**

Write a UTF-8 JSON report containing OS, CPU, memory, Electron version, build hash, power mode, fixture seed/hash, samples, and statistics. Fail if query p95 >100 ms or open p95 >200 ms. The script refuses an unrecorded platform and supports only `win32` and `darwin`.

- [ ] **Step 6: Add the package command and run contract GREEN**

```powershell
node --test scripts/fixtures/knowledge-search-20000.test.mjs scripts/test-discovery.test.mjs
pnpm typecheck
git add scripts/fixtures/knowledge-search-20000.mjs scripts/fixtures/knowledge-search-20000.test.mjs scripts/benchmark-knowledge-search.mjs scripts/knowledge-search-benchmark.html package.json scripts/test-discovery.test.mjs
git commit -m "test: benchmark desktop knowledge search"
```

- [ ] **Step 7: Run and record both platform baselines**

On Windows 11 x64 i5-1135G7/16 GB/NVMe or slower recorded hardware:

```powershell
pnpm benchmark:knowledge-search -- --platform-label windows-reference
```

On macOS 15 M1 8-core/16 GB or slower recorded hardware:

```bash
pnpm benchmark:knowledge-search -- --platform-label macos-reference
```

Expected on both: overall query p95 ≤100 ms, every query class reports samples, palette-open p95 ≤200 ms, expected top result/group correctness is 100%, and the JSON evidence identifies the exact build. If either fails, stop this plan and attach the report; do not silently add a Worker.

### Task 5: Run the final knowledge-loop regression and desktop journey

**Files:**
- Modify only test/evidence documentation if the verified command list changes.

- [ ] **Step 1: Run focused unit and rendering gates**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/knowledgeSearch.test.ts src/lib/knowledgeSearchIndex.test.ts src/hooks/useKnowledgeSearchIndex.test.ts src/lib/reviewFlowContext.test.ts src/store/reviewFlowSessionStore.test.ts src/data/quickNoteCodec.test.ts src/data/weeklyReviews.test.ts
node --test scripts/fixtures/knowledge-search-20000.test.mjs scripts/test-discovery.test.mjs
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
pnpm test
```

- [ ] **Step 2: Run the seven-stage production Electron acceptance**

On Windows and macOS, with a real local journal: discover a missed problem; capture it; attach/source evidence; classify it; compare two cases; carry them into and complete the weekly commitment; reopen the effective rule from Today and find all knowledge types through Cmd/Ctrl+K. Restart, export, import into an isolated library, and repeat source opening/search.

- [ ] **Step 3: Verify diagnostics and repository state**

For every Electron journey record console/pageerror count, screenshot the compare/weekly/Today/search checkpoints, and verify no unexpected files or uncommitted business changes remain:

```powershell
git status --short
git log --oneline -5
```

- [ ] **Step 4: Commit only final test-document adjustments if present**

```powershell
git add docs/superpowers/specs/2026-08-11-review-knowledge-closed-loop-design.md
git commit -m "docs: record review knowledge loop verification"
```

Skip this commit when the spec needs no evidence-path update; never create an empty commit.

## Batch 3 Acceptance

- `RET-01`: mistake tag, case insight/source, trade review/comment, quick note, and completed commitment all resolve from Cmd/Ctrl+K.
- `RET-02`: all four knowledge types are labeled correctly and a nonempty small group cannot be crowded out.
- `RET-03`: query, active item, scroll, and input focus survive result navigation and return.
- `PERF-01`: both approved desktop baselines meet query p95 ≤100 ms and palette-open p95 ≤200 ms with the fixed 20,000-record protocol.
- `PLAT-01`: Windows and macOS production Electron clients complete the full seven-stage journey after restart/export/import.
