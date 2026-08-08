# Review Flow Friction Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make random review one-click by default, keep multi-image review layouts stable while assets decode, fix the Workbench navigation order, remove its repeated tooltips, and move case-reference copying entirely into the existing More menu.

**Architecture:** Keep existing review-session filters and snapshots, but separate transient settings from the primary start action. Add a small browser-image settling boundary that returns one atomic group result and let the view reject stale async completions. Render Workbench navigation from the canonical constant while retaining the legacy persisted order field only for snapshot compatibility; keep case copying on the existing `copyRef()` menu path.

**Tech Stack:** TypeScript 5.6, React 18, Zustand 4, React Router 6, Vite/Electron, project SSR unit runner, Playwright browser fixtures, CSS design tokens.

## Global Constraints

- Always read and write project files as UTF-8 without BOM; preserve all Chinese and non-ASCII text.
- Use strict TDD: add the narrow failing contract, run it and record the attributable RED, then make the smallest production change and rerun to GREEN.
- Default random-review filters are exactly `includeCases: true`, `includeAccountTrades: false`, `caseScope: 'all'`, and `requireContent: false`.
- Advanced review settings are transient to the current mounted review flow; do not add a Store field, local-storage preference, snapshot version, dependency, or schema migration.
- A saved in-progress `ReviewSessionSnapshot` continues to own its filter snapshot and remains restorable.
- Do not change randomization, assessment, mastery scheduling, undo, progress restoration, detail return, or object-URL cleanup semantics.
- Do not hide one decoded image while showing another; the current image group changes from fixed skeleton slots to settled slots in one state commit.
- Reject stale image-settling results after the active trade changes or the component unmounts.
- Workbench primary order is exactly Today, Quick Notes, Trades, Review Cases, Weekly Review, Random Review, Dashboard (`today,quickNotes,trades,reviewCases,weeklyReview,reviewSession,dashboard`).
- Preserve the legacy `display.sidebarPrimaryOrder` field and its normalization for import/snapshot compatibility, but do not read it for rendering or write it from Sidebar interactions.
- Remove Tooltip behavior only from the seven Workbench primary links. Keep visible labels, active state, focus, navigation shortcuts, Search/Create tooltips, and all “My Space” configuration and sorting.
- Keep `copyRef()` and “更多 → 复制编号”; remove only the duplicate case-body control and its now-unused styles.
- Reuse existing `Menu`, `ModalShell`, `Button`, `Select`, tokens, focus restoration, and error feedback patterns.
- Do not package an EXE or bump the application version in this plan.

## File Map

### Create

- `src/lib/reviewImageReadiness.ts` — browser-image decoding and all-settled group result, with an injectable loader for deterministic unit tests.
- `src/lib/reviewImageReadiness.test.ts` — atomic group, error-slot, and input-order contracts.
- `src/views/ReviewSessionImageReadiness.browser.test.tsx` — delayed decode, stable geometry, partial failure, and stale-completion browser flow.
- `src/views/ReviewSessionImageReadiness.browser.test.html` — Vite entry for the readiness fixture.

### Modify

- `src/lib/reviewSession.ts` — change only the default filter constant.
- `src/lib/reviewSession.test.ts` — prove the default pool is case-only while explicit account inclusion remains available.
- `src/views/ReviewSessionView.tsx` — one-click start, transient settings modal, finished-state settings entry, and atomic image readiness integration.
- `src/views/ReviewSessionView.css` — compact start/settings layout plus stable skeleton/error gallery slots.
- `src/views/ReviewSession.browser.test.tsx` — real one-click/settings/session-snapshot flow.
- `src/lib/sidebarNav.ts` — expose canonical fixed primary navigation without a reorder operation.
- `src/components/Sidebar.tsx` — remove primary-order Store subscription, primary pointer-drag state/handlers, and primary ShortcutTooltip wrappers; leave workspace behavior untouched.
- `src/components/SidebarCapabilityMenu.browser.test.tsx` — verify fixed ordering, absent primary tooltips/reordering, retained header tooltips, and retained workspace capability UI.
- `src/regression.test.ts` — replace the obsolete primary-drag contracts with fixed-order/no-write contracts while preserving workspace-sort checks.
- `src/views/DetailView.tsx` — remove the inline case-reference copy footer only.
- `src/views/DetailView.css` — remove `.dv-props-foot`/`.dv-copy-id` rules and the obsolete mobile selector.
- `src/views/DetailShortcutNavigation.browser.test.tsx` — verify body copy is absent and the More-menu copy still writes the current case ref.
- `docs/superpowers/specs/2026-08-08-review-flow-friction-reduction-design.md` — mark implementation verified only after all gates pass.

## Baseline Before Task 1

- [ ] Confirm the current isolated worktree and branch:

```powershell
git status --short --branch
git log -1 --oneline
```

Expected: branch `codex/live-performance-cycles`, clean tracked worktree, and this plan commit at `HEAD`.

- [ ] Run the inherited baseline before production edits:

```powershell
pnpm typecheck
pnpm test
```

Expected: both exit `0`. Store any diagnostic redirection outside the worktree so governance fingerprints are not changed by logs.

---

### Task 1: Make random review start with one click and transient settings

**Files:**
- Modify: `src/lib/reviewSession.test.ts:80-123`
- Modify: `src/views/ReviewSession.browser.test.tsx:54-255`
- Modify: `src/lib/reviewSession.ts:99-104`
- Modify: `src/views/ReviewSessionView.tsx:1-49,103-166,311-416,418-485,633-669`
- Modify: `src/views/ReviewSessionView.css:77-224,534-585`

**Interfaces:**
- Consumes: `ReviewSessionFilters`, `DEFAULT_REVIEW_SESSION_FILTERS`, `buildReviewSessionPool()`, `ReviewSessionSnapshot.filters`, `Menu`, `ModalShell`, `Button`, and `Select`.
- Produces:

```ts
function ReviewSessionSettingsModal(props: {
  filters: ReviewSessionFilters
  poolSize: number
  onChange: (filters: ReviewSessionFilters) => void
  onApply: () => void
  onClose: () => void
}): JSX.Element
```

- [ ] **Step 1: Change the default-pool unit contract before production code**

Replace the existing default-pool assertion with a case-only expectation, then add an explicit opt-in assertion:

```ts
export function testReviewSessionDefaultPoolIncludesCasesOnly(): void {
  const trades: Trade[] = [
    baseTrade,
    { ...baseTrade, id: 'paper-1', ref: 'TRD-2', tradeKind: 'paper' },
    { ...baseTrade, id: 'case-1', ref: 'CAS-1', tradeKind: 'case' },
  ]

  const defaultPool = buildReviewSessionPool(trades, DEFAULT_REVIEW_SESSION_FILTERS, new Set())
  assert(defaultPool.map((trade) => trade.id).join(',') === 'case-1',
    '默认随机复盘池只能包含案例')

  const expandedPool = buildReviewSessionPool(trades, {
    ...DEFAULT_REVIEW_SESSION_FILTERS,
    includeAccountTrades: true,
  }, new Set())
  assert(expandedPool.map((trade) => trade.id).join(',') === 'live-1,paper-1,case-1',
    '复盘设置仍应允许显式加入账户交易')
}
```

Update `testReviewSessionAccountTradesRequireClosedReviewedContent()` to pass `includeAccountTrades: true`; otherwise the new default would make that test stop exercising its stated rule.

- [ ] **Step 2: Add browser assertions for the lightweight start surface**

Seed one eligible live trade and one eligible case. Before starting, assert:

```ts
const accountTrade = trade
const reviewCase: Trade = {
  ...trade,
  id: 'review-session-case',
  ref: 'CAS-RANDOM-1',
  symbol: 'SOLUSDT',
  tradeKind: 'case',
  caseType: 'exemplar',
  masteryState: 'new',
  nextReviewAt: null,
  note: '<p>案例结论：等待结构确认。</p>',
}
useStore.setState({ trades: [accountTrade, reviewCase] })
```

Then assert:

```ts
assert(document.body.textContent?.includes('可随机复盘 1 条'), '默认数量必须只统计案例')
assert(!document.querySelector('.review-session-source-grid'), '开始页不得直接暴露来源表单')
assert(!document.querySelector('.review-session-options'), '开始页不得直接暴露高级选项')
assert(findButton('开启一轮新的复盘'), '开始页缺少单一主操作')
```

Open `更多 → 复盘设置`, verify the account checkbox starts unchecked, enable it and apply, verify the preview becomes two records, reopen settings and disable it again. Then start and verify the stored session is case-only:

```ts
assert(loadReviewSession(manifest.libraryId)?.filters.includeAccountTrades === false,
  '默认开始的轮次快照不得包含账户交易')
assert(loadReviewSession(manifest.libraryId)?.ids.join(',') === reviewCase.id,
  '默认一键开始只能建立案例队列')
```

After completing the round, verify “再随机一轮” keeps `session.filters`, and “重新设置” opens the same dialog with focus inside it. Keep the existing focus, detail return, shortcut, undo, and persistence assertions.

- [ ] **Step 3: Run the narrow tests to prove RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
```

Expected: the unit test fails because `includeAccountTrades` is still `true`; the browser fixture fails because the heavy controls and “随机开始” still render and no settings menu exists. Existing unrelated browser fixtures must remain green.

- [ ] **Step 4: Change the default constant and add transient draft state**

Change only the default value in `src/lib/reviewSession.ts`:

```ts
export const DEFAULT_REVIEW_SESSION_FILTERS: ReviewSessionFilters = {
  includeCases: true,
  includeAccountTrades: false,
  caseScope: 'all',
  requireContent: false,
}
```

In `ReviewSessionView`, keep `filters` as the applied start configuration and add a nullable draft:

```ts
const [settingsDraft, setSettingsDraft] = useState<ReviewSessionFilters | null>(null)
const settingsPoolSize = useMemo(
  () => settingsDraft ? buildReviewSessionPool(trades, settingsDraft, starred).length : 0,
  [settingsDraft, starred, trades],
)
const openSettings = (next = filters) => setSettingsDraft({ ...next })
```

Render `ReviewSessionSettingsModal` only while the draft exists. Apply by copying the draft into `filters`; cancel by clearing the draft. Do not save the draft to `sessionStorage` or Zustand.

- [ ] **Step 5: Replace the start form with a primary action and More menu**

Change `ReviewSessionStart` to accept `onOpenSettings` instead of `onChange`. Render the count, contextual empty copy, the main button, and a visible More menu:

```tsx
<div className="review-session-start-footer">
  <div>
    <strong>{poolSize > 0 ? `可随机复盘 ${poolSize} 条` : emptyMessage}</strong>
    <span>{poolSize > 0 ? '使用当前设置直接开始，本轮随机排序且不重复。' : emptyHint}</span>
  </div>
  <div className="review-session-start-actions">
    <Menu
      align="right"
      trigger={<Button type="button" variant="ghost"><MoreHorizontal size={16} aria-hidden />更多</Button>}
      options={[{ value: 'settings', label: '复盘设置', icon: <SlidersHorizontal size={16} /> }]}
      onSelect={(value) => { if (value === 'settings') onOpenSettings() }}
    />
    <Button type="button" variant="primary" size="lg" disabled={poolSize === 0} onClick={onStart}>
      开启一轮新的复盘
      <ChevronRight size={16} aria-hidden />
    </Button>
  </div>
</div>
```

The default empty message is exactly “还没有可复盘的案例，请先创建案例”。A non-default empty configuration says “当前复盘设置下没有可复盘内容，请调整复盘设置”。Do not automatically include account trades.

- [ ] **Step 6: Build the settings modal from the existing controls**

Move the two source checkboxes, case `Select`, and content checkbox into `ReviewSessionSettingsModal`. Use `ModalShell` so Escape, focus trap, outside click, and focus return follow project behavior:

```tsx
<ModalShell
  title="复盘设置"
  description="只影响接下来开启的这一轮复盘。"
  size="compact"
  onClose={onClose}
  footer={<>
    <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
    <Button type="button" variant="primary" disabled={noSources} onClick={onApply}>应用设置</Button>
  </>}
>
  <fieldset className="review-session-settings-sources">
    <legend>随机范围</legend>
    <label className={filters.includeCases ? 'is-selected' : undefined}>
      <input
        type="checkbox"
        checked={filters.includeCases}
        onChange={(event) => patchFilters({ includeCases: event.target.checked })}
      />
      <BookOpen size={19} aria-hidden />
      <span><strong>案例记录</strong><small>优秀范例、错题与待复看案例</small></span>
    </label>
    <label className={filters.includeAccountTrades ? 'is-selected' : undefined}>
      <input
        type="checkbox"
        checked={filters.includeAccountTrades}
        onChange={(event) => patchFilters({ includeAccountTrades: event.target.checked })}
      />
      <ListTodo size={19} aria-hidden />
      <span><strong>账户交易</strong><small>实盘与模拟盘记录</small></span>
    </label>
  </fieldset>
  <div className="review-session-settings-options">
    <label className="review-session-case-scope">
      <span>案例范围</span>
      <Select
        className="review-session-scope-select"
        value={filters.caseScope}
        disabled={!filters.includeCases}
        ariaLabel="案例范围"
        options={CASE_SCOPE_OPTIONS}
        onValueChange={(value) => patchFilters({ caseScope: value as ReviewCaseScope })}
      />
    </label>
    <label className="review-session-content-toggle">
      <input
        type="checkbox"
        checked={filters.requireContent}
        onChange={(event) => patchFilters({ requireContent: event.target.checked })}
      />
      <Image size={17} aria-hidden />
      <span>仅含有效图文</span>
    </label>
  </div>
  <p className="review-session-settings-count" role="status">
    {noSources ? '请选择至少一个来源' : `当前设置可复盘 ${poolSize} 条`}
  </p>
</ModalShell>
```

Do not disable “应用设置” merely because the pool is empty; an empty applied filter must return to the start surface with actionable copy. Disable it only when both sources are off.

- [ ] **Step 7: Keep finished-round semantics explicit**

Keep `reshuffle()` unchanged so “再随机一轮” uses `session.filters`. Rename “调整范围” to “重新设置” and implement its action as:

```ts
const adjustFinishedSession = () => {
  if (!session) return
  const previousFilters = { ...session.filters }
  clearActiveSession(previousFilters)
  setSettingsDraft(previousFilters)
}
```

This clears the finished queue, opens the same modal, and leaves cancellation on the start screen with the previous round’s filters. A fresh mount with no persisted active session still initializes from `DEFAULT_REVIEW_SESSION_FILTERS`.

- [ ] **Step 8: Restyle only the relocated controls**

Delete the start-page `.review-session-source-grid` and `.review-session-options` layout rules. Add scoped settings-modal classes and a compact action group using existing spacing/radius tokens:

```css
.review-session-start-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--sp-2);
}

.review-session-settings-sources {
  display: grid;
  margin: 0;
  padding: 0;
  border: 0;
  gap: var(--sp-2);
}

.review-session-settings-count {
  margin: var(--sp-3) 0 0;
  color: var(--text-tertiary);
  font-size: var(--fs-xs);
}
```

At `max-width: 640px`, stack `.review-session-start-actions` and make its primary button full width. Preserve 44px touch targets in the settings modal.

- [ ] **Step 9: Verify GREEN and commit the isolated flow change**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
git diff --check
git add src/lib/reviewSession.ts src/lib/reviewSession.test.ts src/views/ReviewSessionView.tsx src/views/ReviewSessionView.css src/views/ReviewSession.browser.test.tsx
git commit -m "feat: simplify random review start"
```

Expected: all commands exit `0`; the commit contains no image-readiness, Sidebar, or DetailView changes.

---

### Task 2: Settle each review image group atomically

**Files:**
- Create: `src/lib/reviewImageReadiness.ts`
- Create: `src/lib/reviewImageReadiness.test.ts`
- Create: `src/views/ReviewSessionImageReadiness.browser.test.tsx`
- Create: `src/views/ReviewSessionImageReadiness.browser.test.html`
- Modify: `src/views/ReviewSessionView.tsx:51-58,567-631`
- Modify: `src/views/ReviewSessionView.css:333-390,542-574`

**Interfaces:**
- Consumes: parsed `{ src, alt }` images from `splitReviewNoteHtml()`, the browser `Image` constructor, and `useShortcutStore.openLightbox()`.
- Produces:

```ts
export type ReviewImageCandidate = { src: string; alt: string }
export type ReviewImageSlot = ReviewImageCandidate & { status: 'ready' | 'error' }
export type ReviewImageLoader = (src: string) => Promise<void>

export function decodeReviewImage(src: string): Promise<void>
export function settleReviewImageGroup(
  images: readonly ReviewImageCandidate[],
  loader?: ReviewImageLoader,
): Promise<ReviewImageSlot[]>
```

- [ ] **Step 1: Write the pure atomic-settling tests**

Use deferred promises so the test proves that the group promise does not settle early and preserves a failed slot:

```ts
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export async function testReviewImageGroupWaitsForEveryCandidate(): Promise<void> {
  const pending = new Map<string, ReturnType<typeof deferred<void>>>()
  const images = [
    { src: 'first.png', alt: '第一张' },
    { src: 'second.png', alt: '第二张' },
  ]
  let settled = false
  const resultPromise = settleReviewImageGroup(images, (src) => {
    const gate = deferred<void>()
    pending.set(src, gate)
    return gate.promise
  }).then((result) => { settled = true; return result })

  pending.get('first.png')?.resolve()
  await Promise.resolve()
  assert(!settled, '任一图片未完成时整组不得提前提交')
  pending.get('second.png')?.resolve()
  assert((await resultPromise).every((slot) => slot.status === 'ready'), '全部成功后整组应就绪')
}

export async function testReviewImageGroupKeepsFailedSlotsInInputOrder(): Promise<void> {
  const result = await settleReviewImageGroup([
    { src: 'ok.png', alt: '成功图' },
    { src: 'bad.png', alt: '失败图' },
  ], async (src) => { if (src === 'bad.png') throw new Error('decode failed') })
  assert(result.map((slot) => `${slot.src}:${slot.status}`).join(',') === 'ok.png:ready,bad.png:error',
    '失败图片必须保留原槽位且不得拒绝整组')
}
```

- [ ] **Step 2: Add a delayed-decode browser fixture**

Create a real `ReviewSessionView` fixture with four restored case IDs in a known order. Override `HTMLImageElement.prototype.decode` only inside the fixture and restore it in `finally`:

```ts
const slowGate = deferred<void>()
const staleGate = deferred<void>()
const originalDecode = HTMLImageElement.prototype.decode
HTMLImageElement.prototype.decode = function () {
  if (this.src.includes('slow-second')) return slowGate.promise
  if (this.src.includes('stale-second')) return staleGate.promise
  if (this.src.includes('broken-image')) return Promise.reject(new Error('decode failed'))
  return Promise.resolve()
}
```

Assertions for the first case:

```ts
await waitFor(() => document.querySelectorAll('.review-session-gallery-slot.is-loading').length === 2,
  '延迟图片期间没有渲染最终数量的骨架槽位')
assert(document.querySelectorAll('.review-session-gallery img').length === 0,
  '整组完成前不得提前暴露第一张图片')
const before = galleryRects()
slowGate.resolve()
await waitFor(() => document.querySelectorAll('.review-session-gallery img').length === 2,
  '全部解码后没有原子显示整组图片')
assertRectsEqual(before, galleryRects(), '图片就绪前后画廊几何尺寸发生变化')
```

Advance to the second pending case, immediately advance to the third case, release `staleGate`, and assert the third case’s image/source/error state remains unchanged. Advance once more to a case containing `broken-image` and assert a stable `.is-error` slot with “图片暂时无法显示”.

The HTML file must use the existing fixture bootstrap form and point to `/src/views/ReviewSessionImageReadiness.browser.test.tsx`.

- [ ] **Step 3: Run the new tests to prove RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewImageReadiness.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
```

Expected: the unit entry cannot import the absent module; the browser fixture fails because images render directly and no stable loading/error slots exist.

- [ ] **Step 4: Implement the browser image loader and group settlement**

Implement `decodeReviewImage()` without fixed delays:

```ts
export function decodeReviewImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    let finished = false
    let decodeStarted = false
    const settle = (operation: () => void) => {
      if (finished) return
      finished = true
      image.onload = null
      image.onerror = null
      operation()
    }
    const fail = (error: unknown) => settle(() => reject(error))
    const decode = () => {
      if (finished || decodeStarted) return
      if (image.naturalWidth === 0) {
        fail(new Error(`Unable to load review image: ${src}`))
        return
      }
      decodeStarted = true
      const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve()
      void decoded.then(
        () => settle(resolve),
        fail,
      )
    }
    image.onerror = () => fail(new Error(`Unable to load review image: ${src}`))
    image.onload = decode
    image.src = src
    if (image.complete) queueMicrotask(decode)
  })
}

export async function settleReviewImageGroup(
  images: readonly ReviewImageCandidate[],
  loader: ReviewImageLoader = decodeReviewImage,
): Promise<ReviewImageSlot[]> {
  return Promise.all(images.map(async (image) => {
    try {
      await loader(image.src)
      return { ...image, status: 'ready' as const }
    } catch {
      return { ...image, status: 'error' as const }
    }
  }))
}
```

The queued `image.complete` branch covers already-cached images and accepts them only when `naturalWidth > 0`. Add a fake-image unit assertion for this branch; do not add timers.

- [ ] **Step 5: Add a per-trade readiness generation in `ReviewSessionNote`**

Use the parsed image list as the skeleton source and settled slots as the visible source:

```ts
const [settledImages, setSettledImages] = useState<{
  tradeId: string | null
  status: 'idle' | 'loading' | 'ready'
  slots: ReviewImageSlot[]
}>({ tradeId: null, status: 'idle', slots: [] })

useEffect(() => {
  if (note.status !== 'ready' || presentation.images.length === 0) {
    setSettledImages({ tradeId: note.tradeId, status: 'idle', slots: [] })
    return
  }
  let current = true
  setSettledImages({ tradeId: note.tradeId, status: 'loading', slots: [] })
  void settleReviewImageGroup(presentation.images).then((slots) => {
    if (current) setSettledImages({ tradeId: note.tradeId, status: 'ready', slots })
  })
  return () => { current = false }
}, [note.tradeId, note.status, presentation.images])
```

Keep `presentation.images` referentially stable through its existing `useMemo`. A result is visible only when `settledImages.tradeId === note.tradeId` and status is `ready`. Cleanup invalidates late results when the trade or note changes.

- [ ] **Step 6: Render fixed skeleton, ready buttons, and error slots**

Use one shared `.review-session-gallery-slot` geometry class for every state:

```tsx
{imagesReady ? settledImages.slots.map((slot, index) => (
  slot.status === 'ready' ? (
    <button
      className="review-session-gallery-slot is-ready"
      type="button"
      key={`${slot.src}-${index}`}
      onClick={(event) => {
        const readySources = settledImages.slots
          .filter((candidate) => candidate.status === 'ready')
          .map((candidate) => candidate.src)
        const lightboxIndex = settledImages.slots
          .slice(0, index + 1)
          .filter((candidate) => candidate.status === 'ready').length - 1
        const rect = event.currentTarget.querySelector('img')?.getBoundingClientRect()
        useShortcutStore.getState().openLightbox(
          readySources,
          lightboxIndex,
          undefined,
          rect ? {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            borderRadius: Number.parseFloat(getComputedStyle(event.currentTarget).borderRadius) || 0,
          } : undefined,
        )
      }}
      aria-label={`放大查看${slot.alt}`}
    >
      <img src={slot.src} alt={slot.alt} />
      <span>{index + 1} / {presentation.images.length}</span>
    </button>
  ) : (
    <div className="review-session-gallery-slot is-error" key={`${slot.src}-${index}`} role="img" aria-label={`${slot.alt}加载失败`}>
      <AlertCircle size={18} aria-hidden />
      <span>图片暂时无法显示</span>
    </div>
  )
)) : presentation.images.map((image, index) => (
  <div className="review-session-gallery-slot is-loading" key={`${image.src}-${index}`} aria-hidden="true" />
))}
```

Build the lightbox source list from ready slots only, and translate each visible successful slot to its ready-source index. Failed slots are not clickable and never pass a missing source to the lightbox.

- [ ] **Step 7: Unify gallery geometry in CSS**

Move the existing height, border, radius, overflow, and background rules from `button` to `.review-session-gallery-slot`. Limit hover/cursor rules to `button.is-ready`. Add token-based skeleton and error styles:

```css
.review-session-gallery-slot.is-loading {
  background: linear-gradient(90deg, var(--bg-hover), var(--bg-active), var(--bg-hover));
  background-size: 200% 100%;
  animation: reviewSessionSkeleton 1.2s ease-in-out infinite;
}

.review-session-gallery-slot.is-error {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--sp-2);
  color: var(--text-tertiary);
}
```

Use the same `.is-single` and `.is-multiple` height rules for all slot element types. Disable the skeleton animation under `prefers-reduced-motion: reduce`.

- [ ] **Step 8: Verify delayed, stale, failure, and viewport behavior**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewImageReadiness.test.ts src/lib/reviewSession.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
pnpm qa:design
git diff --check
```

Expected: all commands exit `0`; the readiness fixture passes in the browser runner’s configured viewports and no existing asset-lifecycle fixture regresses.

- [ ] **Step 9: Commit the isolated image fix**

```powershell
git add src/lib/reviewImageReadiness.ts src/lib/reviewImageReadiness.test.ts src/views/ReviewSessionImageReadiness.browser.test.tsx src/views/ReviewSessionImageReadiness.browser.test.html src/views/ReviewSessionView.tsx src/views/ReviewSessionView.css
git commit -m "fix: stabilize random review image groups"
```

---

### Task 3: Fix Workbench navigation order and remove repeated tooltips

**Files:**
- Modify: `src/components/SidebarCapabilityMenu.browser.test.tsx:47-104`
- Modify: `src/regression.test.ts:66,430-478,741-766`
- Modify: `src/lib/sidebarNav.ts:15-75`
- Modify: `src/components/Sidebar.tsx:1-30,62-68,143-305,422-488,635-748`

**Interfaces:**
- Consumes: canonical `PRIMARY_NAV`, legacy `normalizePrimarySidebarOrder()`, workspace drag handlers, Search/Create `ShortcutTooltip`, and route selection/count logic.
- Produces:

```ts
export function resolvePrimarySidebarNav(): PrimarySidebarNavItem[]
```

The function always returns the canonical seven-item order. It takes no persisted order argument and returns a new array so callers cannot mutate `PRIMARY_NAV`.

- [ ] **Step 1: Replace obsolete unit/source contracts**

Remove the import and test for `reorderPrimarySidebarNav()`. Keep the legacy normalizer test, then assert rendering resolution ignores that legacy order:

```ts
export function testPrimarySidebarKeepsLegacyOrderCompatibleButRendersCanonicalOrder(): void {
  assert(
    normalizePrimarySidebarOrder(['dashboard', 'trades', 'dashboard', 'unknown'])
      .join(',') === 'dashboard,trades,today,quickNotes,reviewCases,weeklyReview,reviewSession',
    '旧快照顺序仍应可规范化并保留兼容性',
  )
  assert(
    resolvePrimarySidebarNav().map((item) => item.id).join(',')
      === 'today,quickNotes,trades,reviewCases,weeklyReview,reviewSession,dashboard',
    '工作台主导航必须始终使用标准顺序',
  )
}
```

Change the source checks to require the absence of primary drag plumbing while preserving workspace sorting:

```ts
assert(!sidebarSource.includes('data-sidebar-primary-id'), '工作台主导航不得保留排序命中区')
assert(!sidebarSource.includes('primaryDragSession'), '工作台主导航不得保留指针拖拽会话')
assert(!sidebarSource.includes('sidebarPrimaryOrder'), 'Sidebar 不得读取或写入旧主导航顺序')
assert(sidebarSource.includes('reorderSidebarWorkspaceItem'), '我的空间仍应支持自定义排序')
```

- [ ] **Step 2: Add real Sidebar browser assertions**

In `SidebarCapabilityMenu.browser.test.tsx`, seed a reversed legacy `display.sidebarPrimaryOrder`, mount Sidebar, and assert the visible labels are canonical:

```ts
const primaryLabels = [...document.querySelectorAll<HTMLElement>('.sb-primary [data-primary-id] .sb-item-label')]
  .map((node) => node.textContent?.trim())
assert(primaryLabels.join(',') === '今日,随记,交易,案例,周复盘,随机复盘,仪表盘',
  '旧持久化顺序不得改变工作台标准顺序')
```

Focus and hover a primary link, wait longer than the default tooltip delay, and assert no `[role="tooltip"]`. Then focus the Search icon and assert its Tooltip still appears, proving the removal is scoped. Dispatch pointer down/move/up across two primary links and assert both DOM order and `useStore.getState().display.sidebarPrimaryOrder` remain unchanged. Retain all existing “我的空间” capability-menu assertions.

Use deterministic event helpers rather than relying on a real pointer device:

```ts
const wait = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds)
})
const primary = document.querySelector<HTMLAnchorElement>('[data-primary-id="dashboard"]')
assert(primary, '缺少仪表盘主导航')
primary.focus()
await frame()
assert(!document.querySelector('[role="tooltip"]'), '聚焦工作台主导航不得显示 Tooltip')
primary.blur()
primary.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
await wait(700)
assert(!document.querySelector('[role="tooltip"]'), '悬停工作台主导航不得显示 Tooltip')

const search = document.querySelector<HTMLButtonElement>('.sb-hbtn-search')
assert(search, '搜索按钮必须保留')
search.focus()
await waitFor(() => document.querySelector('[role="tooltip"]') !== null,
  '搜索纯图标按钮仍应显示 Tooltip')
```

Exercise the removed reorder gesture while forcing the old hit-test path to see Today:

```ts
const today = document.querySelector<HTMLAnchorElement>('[data-primary-id="today"]')
assert(today, '缺少今日主导航')
const persistedBefore = useStore.getState().display.sidebarPrimaryOrder.join(',')
const orderBefore = [...document.querySelectorAll<HTMLElement>('.sb-primary [data-primary-id]')]
  .map((node) => node.dataset.primaryId).join(',')
const originalElementFromPoint = document.elementFromPoint.bind(document)
document.elementFromPoint = () => today
try {
  primary.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 7,
    button: 0,
    clientX: 20,
    clientY: 20,
  }))
  primary.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    pointerId: 7,
    buttons: 1,
    clientX: 20,
    clientY: 80,
  }))
  primary.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    pointerId: 7,
    button: 0,
    clientX: 20,
    clientY: 80,
  }))
} finally {
  document.elementFromPoint = originalElementFromPoint
}
assert(useStore.getState().display.sidebarPrimaryOrder.join(',') === persistedBefore,
  '主导航手势不得写回旧顺序字段')
assert([...document.querySelectorAll<HTMLElement>('.sb-primary [data-primary-id]')]
  .map((node) => node.dataset.primaryId).join(',') === orderBefore,
  '主导航手势不得改变标准顺序')
```

- [ ] **Step 3: Run RED before changing Sidebar**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
```

Expected: regression fails because the reorder function and primary drag identifiers still exist; browser fails because legacy order is rendered and focusing a primary ShortcutTooltip opens a tooltip.

- [ ] **Step 4: Make the primary resolver canonical**

In `src/lib/sidebarNav.ts`, delete `reorderPrimarySidebarNav()` and replace the order-sensitive resolver:

```ts
export function resolvePrimarySidebarNav(): PrimarySidebarNavItem[] {
  return [...PRIMARY_NAV]
}
```

Continue exporting `DEFAULT_PRIMARY_SIDEBAR_ORDER` and `normalizePrimarySidebarOrder` from `sidebarNavContract`; persistence validation and old imports outside Sidebar remain compatible.

- [ ] **Step 5: Delete only primary drag/order state from Sidebar**

Remove:

- `PRIMARY_NAV_SHORTCUT` and `Fragment`;
- `reorderPrimarySidebarNav` import;
- the `display.sidebarPrimaryOrder` Store selector and returned model field;
- `setDisplay`, because its only Sidebar use is primary reorder;
- `primaryDrag`, `primaryDragSession`, and `suppressPrimaryClick`;
- `finishPrimaryDrag()` and all four primary pointer handlers;
- primary drag/drop classes and `data-sidebar-primary-id`;
- the `ShortcutTooltip` wrapper around primary links.

Keep `ReactPointerEvent`, `workspaceDrag`, workspace pointer handlers, `replaceSidebarWorkspaceItems`, and header `ShortcutTooltip` uses.

Render the fixed links directly:

```tsx
{resolvePrimarySidebarNav().map(({ id, to, label, icon: Icon }) => (
  <NavLink
    key={id}
    to={primaryHref(id, to)}
    draggable={false}
    onDragStart={(event) => event.preventDefault()}
    className={() => `sb-item${selection.activePrimaryId === id ? ' is-active' : ''}`}
    data-primary-id={id}
    aria-current={selection.activePrimaryId === id ? 'page' : undefined}
  >
    <Icon size={ICON_MD} />
    <span className="sb-item-label">{label}</span>
    <Count value={primaryCount(id)} />
  </NavLink>
))}
```

The outer Sidebar `is-reordering` class depends only on `workspaceDrag` after this change.

- [ ] **Step 6: Verify fixed order, tooltip scope, shortcuts, and workspace behavior**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm qa:sidebar
pnpm typecheck
git diff --check
```

Expected: all commands exit `0`; Search/Create tooltips and “我的空间” sorting remain green, and no primary reorder write occurs.

- [ ] **Step 7: Commit the Sidebar change**

```powershell
git add src/lib/sidebarNav.ts src/components/Sidebar.tsx src/components/SidebarCapabilityMenu.browser.test.tsx src/regression.test.ts
git commit -m "refactor: fix workbench navigation order"
```

---

### Task 4: Keep case-reference copying only in More

**Files:**
- Modify: `src/views/DetailShortcutNavigation.browser.test.tsx:103-236,372-380`
- Modify: `src/views/DetailView.tsx:1450-1500`
- Modify: `src/views/DetailView.css:1194-1214,1234-1240`

**Interfaces:**
- Consumes: existing `copyRef()`, `moreMenu`, `Menu`, `navigator.clipboard.writeText()`, and toast feedback.
- Produces: no new function or persisted state; the existing menu action becomes the only case-reference copy path.

- [ ] **Step 1: Add a browser contract for the single copy entry**

Stub the clipboard for the fixture and restore it in `finally`:

```ts
const copied: string[] = []
const ownClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async (value: string) => { copied.push(value) } },
})

function findButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === label)
}
```

After `CAS-2` loads, assert the inline entry is absent, open More, and exercise the existing menu item:

```ts
assert(!document.querySelector('.dv-copy-id'), '案例正文右侧不得显示复制编号按钮')
document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')?.click()
await waitFor(() => Boolean(findButton('复制编号')), '更多菜单缺少复制编号')
findButton('复制编号')?.click()
await waitFor(() => copied.at(-1) === 'CAS-2', '更多菜单没有复制当前案例编号')
```

Restore the clipboard descriptor even when an assertion fails:

```ts
if (ownClipboardDescriptor) {
  Object.defineProperty(navigator, 'clipboard', ownClipboardDescriptor)
} else {
  delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard
}
```

- [ ] **Step 2: Run the browser suite to prove RED**

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
```

Expected: the new assertion fails because `.dv-copy-id` still exists; existing More-menu copy behavior is already available.

- [ ] **Step 3: Remove the duplicate body entry and its exclusive CSS**

Delete this JSX only:

```tsx
<div className="dv-props-foot">
  <button className="dv-copy-id" onClick={copyRef}>
    <Copy size={13} />
    <span>复制 {trade.ref}</span>
  </button>
</div>
```

Do not remove the `Copy` icon import because `moreMenu` still uses it. Delete `.dv-props-foot`, `.dv-copy-id`, `.dv-copy-id:hover`, and `.dv-props .dv-copy-id` from the mobile 44px selector. Do not change trade detail or other copy controls.

- [ ] **Step 4: Verify More-menu copy and detail regressions**

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts
pnpm typecheck
pnpm qa:design
git diff --check
```

Expected: all commands exit `0`; navigation, image lightbox, case switching, source sync, and More-menu focus behavior remain green.

- [ ] **Step 5: Commit the isolated detail cleanup**

```powershell
git add src/views/DetailView.tsx src/views/DetailView.css src/views/DetailShortcutNavigation.browser.test.tsx
git commit -m "refactor: move case reference copy to more menu"
```

---

### Task 5: Run release gates and close the design record

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-review-flow-friction-reduction-design.md:1-4`

**Interfaces:**
- Consumes: the four independently committed deliverables and the repository’s quality execution report.
- Produces: a verified design status and a clean, buildable branch; no runtime API.

- [ ] **Step 1: Review the complete feature diff against the plan base**

```powershell
git log --oneline --decorate -6
git diff 596556b..HEAD --stat
git diff 596556b..HEAD -- src/lib/reviewSession.ts src/lib/reviewImageReadiness.ts src/views/ReviewSessionView.tsx src/components/Sidebar.tsx src/lib/sidebarNav.ts src/views/DetailView.tsx
git diff --check 596556b..HEAD
```

Expected: exactly the planned product/test files, no schema/version/dependency changes, no repeated primary Tooltip, no primary order write, and no inline `.dv-copy-id`.

- [ ] **Step 2: Run focused tests once more**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts src/lib/reviewImageReadiness.test.ts src/regression.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
```

Expected: both commands exit `0`; browser runner includes the new readiness fixture at all configured viewports.

- [ ] **Step 3: Run the complete repository gates**

```powershell
pnpm typecheck
pnpm test
pnpm build
```

Expected: all exit `0`; governance reports complete execution with no skipped critical scenario, bundle budget remains within limits, and mobile QA passes.

- [ ] **Step 4: Verify strict UTF-8 without BOM for every changed text file**

```powershell
$changed = git diff --name-only 596556b..HEAD
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
foreach ($file in $changed) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $file))
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  if ($hasBom) { throw "UTF-8 BOM detected: $file" }
  $null = $utf8.GetString($bytes)
}
```

Expected: no exception and all Chinese text remains intact.

- [ ] **Step 5: Mark the design implemented only after every gate passes**

Change the design header to:

```markdown
状态：已实施并通过完整回归
```

Append a short verification section listing the actual commands and exit codes from Steps 2–4. Do not claim an EXE was packaged.

Use this exact section once the stated commands have succeeded:

```markdown
## 13. 实施验证

- `node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts src/lib/reviewImageReadiness.test.ts src/regression.test.ts`：Exit 0。
- `node scripts/run-browser-tests.mjs . vite.config.ts`：Exit 0，包含随机复盘图片时序与侧栏/详情真实交互夹具。
- `pnpm typecheck`：Exit 0。
- `pnpm test`：Exit 0。
- `pnpm build`：Exit 0。
- 变更文本文件严格 UTF-8、无 BOM；`git diff --check` 通过。
```

- [ ] **Step 6: Commit the verified design status**

```powershell
git add docs/superpowers/specs/2026-08-08-review-flow-friction-reduction-design.md
git commit -m "docs: verify review flow friction reduction"
git status --short --branch
```

Expected: commit succeeds and the tracked worktree is clean.

## Final Acceptance Checklist

- [ ] A fresh random-review start defaults to all cases only and starts with one primary click.
- [ ] Advanced source/scope/content filters are reachable from More but are not persisted as global preferences.
- [ ] A restored in-progress round and “再随机一轮” retain their own filter snapshot.
- [ ] Empty default cases and empty advanced filters show distinct actionable messages.
- [ ] Multi-image slots have identical geometry before and after decode, appear atomically, retain failed slots, and ignore stale completions.
- [ ] Workbench navigation always renders Today → Quick Notes → Trades → Review Cases → Weekly Review → Random Review → Dashboard.
- [ ] Workbench links cannot be reordered and do not open tooltips; Search/Create tooltips and navigation shortcuts still work.
- [ ] “My Space” configuration and drag sorting remain unchanged.
- [ ] Case body has no “复制 CAS/TRD” control; “更多 → 复制编号” copies the current ref and retains feedback.
- [ ] Focus return, Escape, 44px mobile targets, 375/768/1280/1920 behavior, detail navigation, undo, and persistence regressions pass.
- [ ] Typecheck, full test, production build, design QA, Sidebar QA, governance, diff check, and UTF-8/no-BOM gates all pass.
