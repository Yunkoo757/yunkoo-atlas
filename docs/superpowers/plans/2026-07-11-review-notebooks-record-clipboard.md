# Review Notebooks and Record Clipboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build fully user-defined review notebooks and Notion-like row-level copy/paste between the trade log, case list, and notebooks without breaking statistics, images, or native editor clipboard behavior.

**Architecture:** Keep `Trade` as the canonical record shape and add a separate `ReviewNotebook` entity plus optional notebook/source fields on case records. Implement record duplication as pure conversion functions, wrap browser clipboard access behind a versioned `RecordClipboardBundle`, and let list surfaces explicitly provide paste targets. Notebook pages reuse the existing Linear-style toolbar, editor, trade rows, filters, and asset storage.

**Tech Stack:** React 18, TypeScript, Zustand, React Router, Tiptap, IndexedDB/Electron storage adapters, Playwright QA, existing CSS design tokens.

## Global Constraints

- Save every source and documentation file as UTF-8 without BOM and preserve all Chinese text.
- Do not add runtime dependencies.
- Do not create predefined notebooks, templates, AI classification, nested notebooks, sharing, or notebook analytics.
- A case can belong to multiple notebooks; membership and duplication must remain distinct operations.
- Pasting into a notebook creates a new `case`; pasting into the trade log creates a new `live` record only after confirmation.
- New copies preserve trade fields, note HTML, image asset references, tags, and direct provenance; they reset comments, activities, deletion metadata, IDs, refs, and recorded time.
- Notebook and case copies remain excluded from account/dashboard statistics.
- Editable controls and Tiptap editors must retain native text/image `Ctrl+C` and `Ctrl+V` behavior.
- Reuse existing design tokens, `TradeList`, `TradeRow`, `Editor`, `Select`, `Tooltip`, and modal patterns.
- Continue in the existing `codex/review-notebooks` worktree; preserve its uncommitted changes, never revert unrelated work, and stage only paths explicitly touched by the active task.

---

## File Map

**New files**

- `src/data/reviewNotebooks.ts`: notebook type, normalization, sorting, and merge rules.
- `src/lib/recordClipboard.ts`: versioned clipboard bundle, snapshot conversion, target materialization, summaries, and duplicate-paste key.
- `src/store/recordClipboardStore.ts`: non-persisted clipboard bundle and recent-paste guard.
- `src/components/review/NotebookPicker.tsx`: reusable multi-select notebook assignment popover.
- `src/components/review/NotebookPicker.css`: picker visuals.
- `src/components/review/CasePickerDialog.tsx`: searchable multi-select dialog for adding existing cases to a notebook.
- `src/components/review/CasePickerDialog.css`: case picker visuals.
- `src/components/review/LivePasteConfirmModal.tsx`: explicit confirmation before copied records become live trades.
- `src/components/review/LivePasteConfirmModal.css`: confirmation visuals.
- `src/views/ReviewNotebookList.tsx`: notebook index.
- `src/views/ReviewNotebookList.css`: notebook row layout.
- `src/views/ReviewNotebookDetail.tsx`: notebook document and related case rows.
- `src/views/ReviewNotebookDetail.css`: notebook detail layout.
- `src/editor/usePersistedDocument.ts`: reusable asset-aware editor load/debounce/flush hook.
- `src/lib/reviewNotebooks.test.ts`: notebook normalization and merge tests.
- `src/lib/recordClipboard.test.ts`: record conversion and paste-guard tests.
- `scripts/qa-review-notebooks.mjs`: end-to-end notebook and record clipboard QA.

**Modified files**

- `src/data/trades.ts`: optional notebook and provenance fields.
- `src/store/useStore.ts`: notebook CRUD, membership, batch insert, and delete cleanup.
- `src/storage/types.ts`: snapshot schema.
- `src/storage/persist.ts`: persisted notebook selection.
- `src/storage/bootstrap.ts`: notebook hydration and legacy fallback.
- `src/lib/importExport.ts`: export/import version 7 and notebook merge/assets.
- `src/lib/importExportAssets.test.ts`: notebook and copied-image backup coverage.
- `src/lib/activities.ts`: continue creating only fresh activity entries for copied records.
- `src/lib/workspaceViews.ts`: add the notebook route as a visually separated case-module entry.
- `src/App.tsx`: notebook routes and modal host.
- `src/views/DetailView.tsx`: shared persisted editor hook, provenance link, and notebook membership property.
- `src/views/ListView.tsx`: record-copy semantics, paste target, and batch notebook action.
- `src/components/trades/QuickViewBar.tsx`: notebook entry treatment.
- `src/shortcuts/ShortcutHost.ts`: page-level record copy/paste dispatch without intercepting editable elements.
- `src/regression.test.ts`: route, statistics, and copy behavior regression coverage.
- `scripts/run-regression-tests.mjs`: include the two new test modules.
- `scripts/qa-workbench.mjs`: primary navigation and notebook-view assertions.
- `package.json`: `qa:notebooks` script and aggregate QA inclusion.

---

### Task 1: Notebook Domain Model and Trade Membership

**Files:**
- Create: `src/data/reviewNotebooks.ts`
- Create: `src/lib/reviewNotebooks.test.ts`
- Modify: `src/data/trades.ts`
- Modify: `scripts/run-regression-tests.mjs`

**Interfaces:**
- Produces: `ReviewNotebook`, `normalizeReviewNotebooks(value)`, `sortReviewNotebooks(items)`, `mergeReviewNotebooks(current, imported)`.
- Produces on `Trade`: `notebookIds?: string[]`, `sourceRecordId?: string`, `sourceRecordRef?: string`.

- [ ] **Step 1: Write failing notebook normalization and sorting tests**

```ts
import {
  mergeReviewNotebooks,
  normalizeReviewNotebooks,
  sortReviewNotebooks,
} from '@/data/reviewNotebooks'

export function testReviewNotebooksNormalizeSortAndMerge(): void {
  const normalized = normalizeReviewNotebooks([
    { id: 'a', name: '  心流专题  ', description: '', content: '', pinned: false,
      createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z' },
    { id: 'a', name: '重复', description: '', content: '', pinned: false,
      createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z' },
  ])
  assert(normalized.length === 1, '重复 notebook id 必须去重')
  assert(normalized[0].name === '心流专题', '笔记本名称必须清理空白')

  const sorted = sortReviewNotebooks([
    { ...normalized[0], id: 'recent', updatedAt: '2026-07-10T00:00:00.000Z' },
    { ...normalized[0], id: 'pinned', pinned: true, updatedAt: '2026-07-01T00:00:00.000Z' },
  ])
  assert(sorted[0].id === 'pinned', '置顶笔记本必须优先')

  const merged = mergeReviewNotebooks(
    [{ ...normalized[0], updatedAt: '2026-07-02T00:00:00.000Z' }],
    [{ ...normalized[0], name: '更新名称', updatedAt: '2026-07-03T00:00:00.000Z' }],
  )
  assert(merged[0].name === '更新名称', '导入合并必须保留 updatedAt 较新的版本')
}
```

- [ ] **Step 2: Register the test module and verify failure**

Modify `scripts/run-regression-tests.mjs`:

```js
const entries = [
  'src/regression.test.ts',
  'src/lib/reviewAnalytics.test.ts',
  'src/lib/importExportAssets.test.ts',
  'src/lib/reviewNotebooks.test.ts',
]
```

Run: `pnpm test`
Expected: FAIL because `@/data/reviewNotebooks` does not exist.

- [ ] **Step 3: Add the notebook model and pure helpers**

Create `src/data/reviewNotebooks.ts` with this public shape:

```ts
export interface ReviewNotebook {
  id: string
  name: string
  description: string
  content: string
  pinned: boolean
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export function normalizeReviewNotebooks(value: unknown): ReviewNotebook[]
export function sortReviewNotebooks(items: ReviewNotebook[]): ReviewNotebook[]
export function mergeReviewNotebooks(
  current: ReviewNotebook[],
  imported: ReviewNotebook[],
): ReviewNotebook[]
```

Normalization must reject missing IDs/names, trim names to 80 characters, default text fields to `''`, default `pinned` to `false`, retain only valid ISO-like timestamps, de-duplicate IDs, and return pinned-first/recently-updated order.

Modify `Trade` in `src/data/trades.ts`:

```ts
notebookIds?: string[]
sourceRecordId?: string
sourceRecordRef?: string
```

- [ ] **Step 4: Run domain tests**

Run: `pnpm test`
Expected: all tests PASS, including `testReviewNotebooksNormalizeSortAndMerge`.

- [ ] **Step 5: Commit the domain slice**

```powershell
git add src/data/reviewNotebooks.ts src/data/trades.ts src/lib/reviewNotebooks.test.ts scripts/run-regression-tests.mjs
git commit -m "feat: add review notebook domain model"
```

---

### Task 2: Persistence, Store Operations, and Backup Version 7

**Files:**
- Modify: `src/store/useStore.ts`
- Modify: `src/storage/types.ts`
- Modify: `src/storage/persist.ts`
- Modify: `src/storage/bootstrap.ts`
- Modify: `src/lib/importExport.ts`
- Modify: `src/lib/importExportAssets.test.ts`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes: `ReviewNotebook`, `normalizeReviewNotebooks`, `mergeReviewNotebooks`.
- Produces store state: `reviewNotebooks: ReviewNotebook[]`.
- Produces actions: `upsertReviewNotebook`, `archiveReviewNotebook`, `removeReviewNotebook`, `setCaseNotebookIds`, `addCasesToNotebook`, `removeCasesFromNotebook`, `insertTrades`.

- [ ] **Step 1: Write failing store-independent persistence tests**

Add to `src/lib/importExportAssets.test.ts`:

```ts
export async function testNotebookBackupIncludesMetadataAndAssets(): Promise<void> {
  const notebookAsset = 'notebook-image'
  const payload = await buildExportPayloadFromState(
    {
      ...baseState,
      reviewNotebooks: [{
        id: 'nb-1', name: '七月复盘', description: '', pinned: false,
        content: `<p>总结</p><img src="journal-asset://${notebookAsset}" data-asset-id="${notebookAsset}">`,
        createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-11T00:00:00.000Z',
      }],
    },
    async (id) => id === notebookAsset ? { id, mime: 'image/png', data: 'AA==' } : null,
  )
  assert(payload.version === 7, '笔记本备份必须使用版本 7')
  assert(payload.reviewNotebooks?.length === 1, '备份必须包含笔记本')
  assert(payload.assets?.some((asset) => asset.id === notebookAsset), '必须导出笔记本正文图片')
}
```

Add to `src/regression.test.ts`:

```ts
export function testRemovingNotebookOnlyRemovesMembership(): void {
  const trades = [{ ...trade, id: 'case-1', tradeKind: 'case' as const, notebookIds: ['nb-1', 'nb-2'] }]
  const cleaned = removeNotebookFromAllTrades(trades, 'nb-1')
  assert(cleaned.length === 1, '删除笔记本不得删除案例')
  assert(JSON.stringify(cleaned[0].notebookIds) === JSON.stringify(['nb-2']), '只移除目标关联')
}
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test`
Expected: FAIL on missing `reviewNotebooks`, version 7, asset collection, and `removeNotebookFromAllTrades`.

- [ ] **Step 3: Implement persistence and pure membership cleanup**

Update `PersistedSnapshot`, `ExportPayload`, `PersistedSlice`, and `ExportState` with:

```ts
reviewNotebooks?: ReviewNotebook[]
```

Set:

```ts
export const SCHEMA_VERSION = 7
export const EXPORT_VERSION = 7
```

Add a pure helper in `src/data/reviewNotebooks.ts`:

```ts
export function removeNotebookFromAllTrades(trades: Trade[], notebookId: string): Trade[] {
  return trades.map((trade) => ({
    ...trade,
    notebookIds: trade.notebookIds?.filter((id) => id !== notebookId),
  }))
}
```

Update `pickPersisted`, `bootstrapStorage`, JSON parsing, import merge, web ZIP metadata, and export asset collection. Collect notebook asset IDs by parsing each notebook `content` with the same `data-asset-id`/`journal-asset://` rules used for trade notes.

- [ ] **Step 4: Add atomic notebook and membership store actions**

Extend the Zustand state contract:

```ts
reviewNotebooks: ReviewNotebook[]
upsertReviewNotebook: (notebook: ReviewNotebook) => void
archiveReviewNotebook: (id: string, archived: boolean) => void
removeReviewNotebook: (id: string) => void
setCaseNotebookIds: (tradeId: string, notebookIds: string[]) => void
addCasesToNotebook: (tradeIds: string[], notebookId: string) => void
removeCasesFromNotebook: (tradeIds: string[], notebookId: string) => void
insertTrades: (trades: Trade[]) => void
```

`insertTrades` must normalize every record and prepend the complete array in one `set` call. Membership actions must only affect active `case` records and de-duplicate IDs.

- [ ] **Step 5: Run tests and build**

Run: `pnpm test && pnpm run build`
Expected: all tests PASS and TypeScript build succeeds.

- [ ] **Step 6: Commit persistence slice**

```powershell
git add src/store/useStore.ts src/storage/types.ts src/storage/persist.ts src/storage/bootstrap.ts src/lib/importExport.ts src/lib/importExportAssets.test.ts src/data/reviewNotebooks.ts src/regression.test.ts
git commit -m "feat: persist review notebooks"
```

---

### Task 3: Pure Record Clipboard and Copy Materialization

**Files:**
- Create: `src/lib/recordClipboard.ts`
- Create: `src/lib/recordClipboard.test.ts`
- Create: `src/store/recordClipboardStore.ts`
- Modify: `scripts/run-regression-tests.mjs`

**Interfaces:**
- Produces: `RecordClipboardBundle`, `RecordPasteTarget`, `buildRecordClipboardBundle`, `materializeRecordCopies`, `recordClipboardSummary`, `pasteGuardKey`.
- Produces store: `useRecordClipboardStore` with `bundle`, `setBundle`, `wasRecentlyPasted`, `markPasted`, `clear`.

- [ ] **Step 1: Write failing conversion tests**

Create `src/lib/recordClipboard.test.ts` covering all target combinations:

```ts
export function testTradeClipboardMaterializesNotebookCases(): void {
  const source = { ...trade, id: 'live-1', ref: 'TRD-1', comments: [{ id: 'c', text: 'x', createdAt: now }],
    activities: [{ id: 'a', kind: 'create', timestamp: now }], deletedAt: now }
  const bundle = buildRecordClipboardBundle([source], 'trade-log', now, () => 'bundle-1')
  const copies = materializeRecordCopies(bundle, { kind: 'notebook', notebookId: 'nb-1' }, [], {
    now, createId: () => 'case-copy', nextRef: () => 'CAS-1',
  })
  assert(copies[0].tradeKind === 'case', '笔记本目标必须创建案例')
  assert(copies[0].notebookIds?.[0] === 'nb-1', '副本只关联目标笔记本')
  assert(copies[0].sourceRecordId === 'live-1', '副本必须记录来源')
  assert(copies[0].comments?.length === 0, '不得复制评论')
  assert(copies[0].activities?.length === 1 && copies[0].activities?.[0].kind === 'create', '只生成创建活动')
  assert(!copies[0].deletedAt, '不得复制删除状态')
}

export function testCaseClipboardMaterializesConfirmedLiveCopies(): void {
  const source = { ...trade, id: 'case-1', ref: 'CAS-1', tradeKind: 'case' as const, notebookIds: ['old'] }
  const bundle = buildRecordClipboardBundle([source], 'notebook', now, () => 'bundle-2', 'old')
  const copies = materializeRecordCopies(bundle, { kind: 'trade-log' }, [], {
    now, createId: () => 'live-copy', nextRef: () => 'TRD-2',
  })
  assert(copies[0].tradeKind === 'live', '交易日志目标必须创建实盘交易')
  assert(!copies[0].notebookIds?.length, '实盘副本不得继承笔记本关系')
  assert(copies[0].status === source.status && copies[0].pnl === source.pnl, '必须保留统计字段')
}
```

Also test multiple unique refs, unchanged source snapshots, direct provenance, plain-text summaries, and paste-guard key differences across notebook targets.

- [ ] **Step 2: Register tests and verify failure**

Add `'src/lib/recordClipboard.test.ts'` to `scripts/run-regression-tests.mjs`.

Run: `pnpm test`
Expected: FAIL because clipboard module and functions do not exist.

- [ ] **Step 3: Implement versioned clipboard types and pure conversion**

Use these signatures:

```ts
export type RecordClipboardSource = 'trade-log' | 'case-list' | 'notebook'
export type RecordPasteTarget =
  | { kind: 'notebook'; notebookId: string }
  | { kind: 'case-list' }
  | { kind: 'trade-log' }

export interface RecordClipboardBundle {
  version: 1
  bundleId: string
  copiedAt: string
  sourceContext: RecordClipboardSource
  sourceNotebookId?: string
  records: Array<{ sourceId: string; sourceRef: string; snapshot: Trade }>
}

export function buildRecordClipboardBundle(
  records: Trade[], source: RecordClipboardSource, copiedAt: string,
  createBundleId: () => string, sourceNotebookId?: string,
): RecordClipboardBundle

export function materializeRecordCopies(
  bundle: RecordClipboardBundle,
  target: RecordPasteTarget,
  existing: Trade[],
  deps: { now: string; createId: () => string; nextRef: (kind: TradeKind, existing: Trade[]) => string },
): Trade[]
```

The function must strip `deletedAt`, `deletedBy`, old notebook IDs, comments, activities, and IDs/refs before applying target-specific fields. Generate one fresh create activity per output.

- [ ] **Step 4: Add the non-persisted clipboard store and paste guard**

Create `src/store/recordClipboardStore.ts` with a two-second duplicate window:

```ts
interface RecordClipboardState {
  bundle: RecordClipboardBundle | null
  recentPaste: { key: string; at: number } | null
  setBundle: (bundle: RecordClipboardBundle) => void
  wasRecentlyPasted: (key: string, now?: number) => boolean
  markPasted: (key: string, now?: number) => void
  clear: () => void
}
```

- [ ] **Step 5: Run clipboard tests**

Run: `pnpm test`
Expected: all record clipboard conversion and guard tests PASS.

- [ ] **Step 6: Commit clipboard core**

```powershell
git add src/lib/recordClipboard.ts src/lib/recordClipboard.test.ts src/store/recordClipboardStore.ts scripts/run-regression-tests.mjs
git commit -m "feat: add structured record clipboard"
```

---

### Task 4: Notebook Routes, Index, Detail, and Persisted Editor

**Files:**
- Create: `src/views/ReviewNotebookList.tsx`
- Create: `src/views/ReviewNotebookList.css`
- Create: `src/views/ReviewNotebookDetail.tsx`
- Create: `src/views/ReviewNotebookDetail.css`
- Create: `src/editor/usePersistedDocument.ts`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/lib/workspaceViews.ts`
- Modify: `src/components/trades/QuickViewBar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes notebook CRUD/store state from Task 2.
- Produces routes `/review-cases/notebooks` and `/review-cases/notebooks/:id`.
- Produces `usePersistedDocument({ storedHtml, ownerId, onSave })` for trade and notebook editors.

- [ ] **Step 1: Write failing route/view tests**

Add to `src/regression.test.ts`:

```ts
export function testNotebookViewBelongsOnlyToCaseWorkspace(): void {
  const caseViews = getWorkspacePrimaryViews('case')
  assert(caseViews.some((view) => view.id === 'notebooks' && view.pathname === '/review-cases/notebooks'),
    '案例模块必须提供笔记本入口')
  assert(!getWorkspacePrimaryViews('trade').some((view) => view.id === 'notebooks'),
    '交易日志不得出现笔记本入口')
}
```

Run: `pnpm test`
Expected: FAIL because the notebook view target is missing.

- [ ] **Step 2: Add route configuration and visual separation**

Append the case view target in `workspaceViews.ts`:

```ts
{ id: 'notebooks', label: '笔记本', pathname: '/review-cases/notebooks', separated: true }
```

Extend `WorkspaceViewTarget` with `separated?: boolean` and render a divider class before separated targets in `QuickViewBar`.

Register specific routes before the generic scope route in `App.tsx`:

```tsx
<Route path="/review-cases/notebooks" element={<ReviewNotebookList />} />
<Route path="/review-cases/notebooks/:id" element={<ReviewNotebookDetail />} />
```

- [ ] **Step 3: Build the compact notebook index**

`ReviewNotebookList` must render:

- Stable top toolbar titled `笔记本` with `案例记录` context.
- A 40px action row containing search, archived toggle, and icon+text `新建笔记本` command.
- Flat notebook rows with name, description, case count, updated time, pin icon, and overflow menu.
- Empty state with one `新建笔记本` action.
- Inline or compact modal creation requiring only a non-empty name.

Use `sortReviewNotebooks` and derive case counts from active `case` records containing the notebook ID.

- [ ] **Step 4: Extract the persisted editor hook and migrate trade detail**

Create `usePersistedDocument` around existing `resolveNoteForDisplay`, `normalizeNoteForStorage`, 400ms debounce, save-status updates, unmount flush, and `setPreFlushCallback` behavior. Its contract:

```ts
export function usePersistedDocument({
  ownerId,
  storedHtml,
  onSave,
}: {
  ownerId: string
  storedHtml: string
  onSave: (html: string) => void
}): { html: string; onChange: (html: string) => void; ready: boolean }
```

Replace the duplicated note loading/debounce block in `DetailView` with this hook without changing visible behavior.

- [ ] **Step 5: Build notebook detail**

`ReviewNotebookDetail` must:

- Resolve notebook by route ID and show a not-found state when absent.
- Auto-save name, description, and editor content while updating `updatedAt`.
- Render notebook content through `Editor` and `usePersistedDocument`.
- Render active related cases using `TradeList` below the document.
- Sort cases via `sortReviewCasesByRecentActivity`.
- Render the related case list and a working `新建案例` command. Do not render disabled or placeholder membership/copy controls; Tasks 5 and 6 add those commands with their complete behavior.

- [ ] **Step 6: Run tests, build, and visual smoke test**

Run: `pnpm test && pnpm run build`
Expected: PASS.

Open `/review-cases/notebooks` and `/review-cases/notebooks/:id` at 1440x900 and 900x800. Verify no horizontal overflow, no cards inside cards, and the notebook editor/list remains one continuous page surface.

- [ ] **Step 7: Commit notebook surfaces**

```powershell
git add src/views/ReviewNotebookList.tsx src/views/ReviewNotebookList.css src/views/ReviewNotebookDetail.tsx src/views/ReviewNotebookDetail.css src/editor/usePersistedDocument.ts src/views/DetailView.tsx src/lib/workspaceViews.ts src/components/trades/QuickViewBar.tsx src/App.tsx src/regression.test.ts
git commit -m "feat: add custom review notebook views"
```

---

### Task 5: Notebook Membership and Existing-Case Assignment

**Files:**
- Create: `src/components/review/NotebookPicker.tsx`
- Create: `src/components/review/NotebookPicker.css`
- Create: `src/components/review/CasePickerDialog.tsx`
- Create: `src/components/review/CasePickerDialog.css`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/views/ListView.tsx`
- Modify: `src/views/ReviewNotebookDetail.tsx`
- Modify: `src/store/useStore.ts`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes store membership actions from Task 2.
- Produces reusable `NotebookPicker({ selectedIds, onChange, multiple })`.

- [ ] **Step 1: Add failing membership regression tests**

```ts
export function testNotebookMembershipIsManyToManyAndDeduplicated(): void {
  const next = addNotebookMembership(
    [{ ...trade, id: 'case-1', tradeKind: 'case' as const, notebookIds: ['nb-1'] }],
    ['case-1'],
    'nb-1',
  )
  assert(JSON.stringify(next[0].notebookIds) === JSON.stringify(['nb-1']), '重复加入不得产生重复 ID')
  const two = addNotebookMembership(next, ['case-1'], 'nb-2')
  assert(two[0].notebookIds?.includes('nb-1') && two[0].notebookIds?.includes('nb-2'), '案例可属于多个笔记本')
}
```

Run: `pnpm test`
Expected: FAIL because membership helper is missing.

- [ ] **Step 2: Implement pure membership helpers and store wrappers**

Add `addNotebookMembership` and `removeNotebookMembershipForTrades` to `reviewNotebooks.ts`. Both must ignore live/paper records, inactive IDs, duplicate notebook IDs, and unrelated records. Store actions call these helpers in one `set`.

- [ ] **Step 3: Build the notebook picker**

The picker must use existing `Select`/popover tokens and support:

- Search by notebook name.
- Checkbox-style multi-selection.
- Create-new command when no notebook matches.
- Selected notebook chips with remove actions.
- Archived notebooks hidden by default.
- Escape close and focus return.

Build `CasePickerDialog` for notebook detail. It must search active case records by ref, symbol, strategy, tags, and mistake tags; support multi-selection; exclude cases already in the target notebook; and call `addCasesToNotebook` once with all confirmed IDs.

- [ ] **Step 4: Add notebook membership to case detail**

Only when `trade.tradeKind === 'case'`, add a `笔记本` section to the detail property panel. Changes call `setCaseNotebookIds` and do not duplicate the case.

When `sourceRecordId` exists, show a separate `来源` property linking to `tradeDetailPath` when the source still exists; otherwise show the preserved source ref as text.

- [ ] **Step 5: Add batch association actions**

On case list and notebook detail batch bars:

- `加入笔记本` opens `NotebookPicker` and applies the selected notebook to every selected case.
- Notebook detail additionally provides `从当前笔记本移除`.
- Notebook detail `加入已有案例` opens `CasePickerDialog` and links selected existing cases without creating copies.
- The existing delete action remains separate.

- [ ] **Step 6: Run tests and browser checks**

Run: `pnpm test && pnpm run build`
Expected: PASS.

Browser checks: assign one case to two notebooks, remove it from one, verify it remains in the other and in `案例记录 > 全部`.

- [ ] **Step 7: Commit membership slice**

```powershell
git add src/components/review/NotebookPicker.tsx src/components/review/NotebookPicker.css src/components/review/CasePickerDialog.tsx src/components/review/CasePickerDialog.css src/views/DetailView.tsx src/views/ListView.tsx src/views/ReviewNotebookDetail.tsx src/store/useStore.ts src/data/reviewNotebooks.ts src/regression.test.ts
git commit -m "feat: support case notebook membership"
```

---

### Task 6: Browser Clipboard Bridge, Keyboard Dispatch, and Live Confirmation

**Files:**
- Create: `src/components/review/LivePasteConfirmModal.tsx`
- Create: `src/components/review/LivePasteConfirmModal.css`
- Modify: `src/lib/recordClipboard.ts`
- Modify: `src/store/recordClipboardStore.ts`
- Modify: `src/views/ListView.tsx`
- Modify: `src/views/ReviewNotebookDetail.tsx`
- Modify: `src/shortcuts/ShortcutHost.ts`
- Modify: `src/App.tsx`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes clipboard conversion/store from Task 3 and atomic `insertTrades` from Task 2.
- Produces `writeRecordClipboard(bundle)`, `readRecordClipboard(event?)`, and UI commands `copySelectedRecords` / `pasteRecordsIntoTarget`.

- [ ] **Step 1: Write failing serialization and editable-target tests**

Add tests for:

```ts
export function testRecordClipboardHtmlRoundTripsWithoutExposingJsonAsText(): void {
  const bundle = buildRecordClipboardBundle([trade], 'trade-log', now, () => 'bundle')
  const serialized = serializeRecordClipboard(bundle)
  assert(serialized.plainText.includes('BTCUSDT'), '外部纯文本必须可读')
  assert(!serialized.plainText.includes('sourceContext'), '外部纯文本不得暴露内部 JSON')
  assert(parseRecordClipboardHtml(serialized.html)?.bundleId === 'bundle', '内部 HTML 标记必须可还原')
}

export function testEditableClipboardElementsAreNeverIntercepted(): void {
  const input = { closest: (selector: string) => selector.includes('input') ? {} : null }
  const editor = { closest: (selector: string) => selector.includes('.ProseMirror') ? {} : null }
  assert(isEditableClipboardElement(input), '输入框必须保留原生剪贴板')
  assert(isEditableClipboardElement(editor), '编辑器必须保留原生剪贴板')
}
```

Run: `pnpm test`
Expected: FAIL on missing serializers and target guard.

- [ ] **Step 2: Implement system clipboard serialization with in-memory fallback**

`serializeRecordClipboard` returns:

```ts
{ html: string; plainText: string }
```

HTML must contain one encoded, escaped `data-yunkoo-record-bundle` marker plus a visible summary. `writeRecordClipboard` attempts `navigator.clipboard.write` with both `text/html` and `text/plain`, always stores the bundle in `useRecordClipboardStore`, and returns `{ systemWritten: boolean }`.

`readRecordClipboard` checks paste-event HTML first, then the in-memory bundle. Invalid version or shape returns `null`.

- [ ] **Step 3: Replace ListView's current immediate batch duplication**

The existing batch `复制` action must no longer call `upsertTrade` immediately. It must build and write a clipboard bundle from selected records, preserve the selection until navigation, and toast `已复制 N 条记录`.

Expose the active list selection and target context to a small list-level handler rather than adding global mutable selection to the main store.

- [ ] **Step 4: Dispatch keyboard copy/paste without breaking editors**

Add shared guards:

```ts
export function isEditableClipboardElement(
  element: { closest: (selector: string) => unknown } | null,
): boolean {
  return Boolean(element?.closest(
    'input, textarea, [contenteditable="true"], .ProseMirror, [role="dialog"]',
  ))
}
```

Handle `Ctrl+C` only when a list has selected rows. Handle `Ctrl+V` only when a list/notebook paste target is active and the event target is not editable. Leave all other clipboard events untouched.

- [ ] **Step 5: Add notebook and case-list paste behavior**

Notebook paste calls `materializeRecordCopies` with `{ kind: 'notebook', notebookId }`; case-list paste uses `{ kind: 'case-list' }`. Insert all copies atomically, mark the paste guard, clear selection, and toast the created count.

- [ ] **Step 6: Add live-target confirmation**

`LivePasteConfirmModal` must display:

```text
将 N 条记录创建为实盘交易？
副本会保留状态、盈亏与 R 倍数，并进入仪表盘统计。
```

Actions: `取消` and `创建实盘副本`. Confirm materializes and inserts live records; cancel does not mark the paste guard and does not mutate state. Escape cancels and focus returns to the list.

- [ ] **Step 7: Add duplicate-paste feedback**

Before materialization, compute `pasteGuardKey(bundle, target)`. If `wasRecentlyPasted` is true, do not insert records and toast `该批记录已粘贴`. Mark only after successful insertion.

- [ ] **Step 8: Run tests and keyboard smoke checks**

Run: `pnpm test && pnpm run build`
Expected: PASS.

Manual/browser checks:

1. Select two trade rows, press `Ctrl+C`, open a notebook, press `Ctrl+V`, and see two new cases.
2. Press `Ctrl+V` again immediately and see no duplicates.
3. Copy notebook rows, paste into trade log, cancel, and verify no live rows were added.
4. Repeat and confirm, then verify live rows and dashboard totals.
5. Focus the Tiptap editor and verify text/image copy/paste remains native.

- [ ] **Step 9: Commit clipboard UI slice**

```powershell
git add src/components/review/LivePasteConfirmModal.tsx src/components/review/LivePasteConfirmModal.css src/lib/recordClipboard.ts src/store/recordClipboardStore.ts src/views/ListView.tsx src/views/ReviewNotebookDetail.tsx src/shortcuts/ShortcutHost.ts src/App.tsx src/regression.test.ts
git commit -m "feat: enable record copy paste across workspaces"
```

---

### Task 7: End-to-End QA, Responsive Polish, and Final Contract

**Files:**
- Create: `scripts/qa-review-notebooks.mjs`
- Modify: `scripts/qa-workbench.mjs`
- Modify: `scripts/qa-design-contract.mjs`
- Modify: `package.json`
- Modify: `src/views/ReviewNotebookList.css`
- Modify: `src/views/ReviewNotebookDetail.css`
- Modify: `src/components/review/NotebookPicker.css`
- Modify: `src/components/review/LivePasteConfirmModal.css`

**Interfaces:**
- Consumes all previous tasks.
- Produces repeatable `pnpm run qa:notebooks` coverage and baseline screenshots.

- [ ] **Step 1: Add the notebook QA script before final polish**

The Playwright script must create two custom notebooks and three source trades, then assert:

```js
record('用户可创建完全自定义笔记本', createdNamesMatch && noPresetNotebooks)
record('同一案例可关联多个笔记本且不重复', membershipCount === 2)
record('交易日志批量复制到笔记本创建案例副本', copiedCases === 2 && dashboardCountUnchanged)
record('笔记本复制到笔记本只关联目标笔记本', targetCopies === 2)
record('重复粘贴受到保护', countAfterSecondPaste === countAfterFirstPaste)
record('取消实盘粘贴不写入数据', liveCountAfterCancel === liveCountBefore)
record('确认实盘粘贴创建新交易', liveCountAfterConfirm === liveCountBefore + 2)
record('删除笔记本不删除案例', remainingCases === caseCountBeforeDelete)
record('刷新后笔记本、正文、关联和图片仍在', persistedAfterReload)
```

Capture 1440x900 screenshots for notebook index, notebook detail, notebook picker, populated batch bar, and live-paste confirmation.

- [ ] **Step 2: Register QA commands**

Update `package.json`:

```json
"qa:notebooks": "node scripts/qa-review-notebooks.mjs",
"qa": "node scripts/qa-phase1.mjs && node scripts/qa-phase1-image.mjs && node scripts/qa-workbench.mjs && node scripts/qa-review-notebooks.mjs"
```

- [ ] **Step 3: Extend design contract assertions**

Assert notebook rows use the standard control/row tokens, the page has no card nesting, notebook detail does not overflow at 900px, and the batch bar remains inside the viewport at 375px.

- [ ] **Step 4: Run focused QA and fix only observed failures**

Run: `pnpm run qa:notebooks`
Expected: every notebook and clipboard assertion passes with no console/page errors.

Use screenshots to correct only concrete spacing, focus, truncation, or overflow issues. Do not add decorative cards or unrelated redesigns.

- [ ] **Step 5: Run the complete verification matrix**

Run:

```powershell
pnpm test
pnpm run qa:image
pnpm run qa:workbench
pnpm run qa:notebooks
pnpm run qa:linear
pnpm run qa:design
pnpm run build
git diff --check
```

Expected: all commands exit 0; no console errors; image ownership and stable media geometry remain passing.

- [ ] **Step 6: Final review against the specification**

Confirm every acceptance item in `docs/superpowers/specs/2026-07-11-review-notebooks-record-clipboard-design.md` has either an automated assertion or a documented visual check. Verify no predefined notebook names exist in source or seeded data.

- [ ] **Step 7: Commit final QA and polish**

```powershell
git add scripts/qa-review-notebooks.mjs scripts/qa-workbench.mjs scripts/qa-design-contract.mjs package.json src/views/ReviewNotebookList.css src/views/ReviewNotebookDetail.css src/components/review/NotebookPicker.css src/components/review/LivePasteConfirmModal.css
git commit -m "test: cover review notebook workflows"
```

---

## Final Acceptance Checklist

- [ ] No system-created or predefined notebooks exist.
- [ ] Notebook index and detail routes are accessible from case records only.
- [ ] Notebook body, metadata, membership, and images persist and export/import correctly.
- [ ] A case can belong to multiple notebooks without duplication.
- [ ] Joining/removing membership never creates or deletes a case.
- [ ] Copy/paste creates independent target-typed records with direct provenance.
- [ ] Live paste requires explicit confirmation and affects statistics only after confirm.
- [ ] Comments, old activities, delete metadata, and source notebook IDs do not copy.
- [ ] Image assets remain visible after source deletion, refresh, and backup restore.
- [ ] Immediate duplicate paste is blocked per target.
- [ ] Native editor/input clipboard behavior remains intact.
- [ ] Desktop and narrow viewports have no overflow or incoherent overlap.
- [ ] Unit tests, full QA, design contract, image QA, and production build pass.
