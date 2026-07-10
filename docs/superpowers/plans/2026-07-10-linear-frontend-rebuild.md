# Linear Frontend Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current page-specific frontend with one Linear-style application shell, dense trade list, independent trade detail, unified review-case views, and flattened secondary pages without changing existing storage or trading semantics.

**Architecture:** Keep Zustand, routing data, storage adapters, image asset resolution, Tiptap, and trade-domain helpers intact. Introduce a small shared UI layer and migrate one complete route slice at a time: shell, list/filter, detail, quick capture/case views, then dashboard/settings/case-law pages. Each migration ends with regression tests, build verification, and fixed-viewport Playwright screenshots before the old structure is removed.

**Tech Stack:** React 18, TypeScript 5.6, React Router 6, Zustand 4, Vite 5, Tiptap 2, Recharts 2, Lucide React, Playwright, existing Node regression runner.

## Global Constraints

- Read and write every source file as UTF-8 without BOM; preserve all Chinese text.
- Use `docs/linear-frontend-design-system-analysis.md` and `docs/superpowers/specs/2026-07-10-linear-frontend-rebuild-design.md` as the visual and product sources of truth.
- Preserve existing storage, image asset, import/export, autosave, trade-statistics, and Electron behavior.
- `tradeKind === 'case'` must remain excluded from account statistics.
- Desktop constants: `244px` sidebar, `8px` main inset, `12px` main radius, `28px` controls, `44px` rows, `20px/24px` chips.
- Do not add a second icon library, styling framework, state library, or component framework.
- Do not remove an old route or stylesheet until its replacement passes functional and visual verification.

---

## File Structure

Create focused shared UI modules:

- `src/components/ui/AppFrame.tsx` and `.css`: application frame and responsive pane behavior.
- `src/components/ui/Toolbar.tsx` and `.css`: page toolbar, breadcrumbs, actions, and view controls.
- `src/components/ui/FilterBar.tsx` and `.css`: active filter summary and filter trigger.
- `src/components/ui/PropertyList.tsx` and `.css`: flat property sections and editable rows.
- `src/components/trades/TradeList.tsx` and `.css`: canonical grouped trade list.
- `src/components/trades/TradeRow.tsx`: canonical 44px trade row.
- `src/components/trades/TradeFilters.tsx`: trade filter panel and URL-state adapter.
- `src/components/trades/TradeDetailLayout.tsx` and `.css`: detail content and properties layout.
- `src/lib/tradeView.ts`: pure list grouping, visible metadata, and responsive priority helpers.
- `scripts/qa-linear-rebuild.mjs`: fixed-route Playwright functional and screenshot QA.

Existing files remain responsible for their current domain behavior. `src/views/DetailView.tsx` may be split only after its existing autosave and image-resolution logic is covered by tests.

---

### Task 1: Freeze Baseline and Add Design Contract Checks

**Files:**
- Create: `scripts/qa-design-contract.mjs`
- Modify: `package.json`
- Modify: `scripts/qa-workbench.mjs`

**Interfaces:**
- Produces: `npm run qa:design`, a static contract check for forbidden legacy entry points and required token values.
- Produces: baseline screenshots under `.gstack/qa-reports/linear-rebuild-baseline/`.

- [ ] **Step 1: Add the failing design-contract script**

Create a Node script that reads UTF-8 source files and asserts the approved constants:

```js
import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const tokens = read('src/styles/tokens.css')
const app = read('src/App.tsx')

const checks = [
  ['sidebar width', tokens.includes('--sidebar-width: 244px')],
  ['control height', tokens.includes('--control-height: 28px')],
  ['trade row height', tokens.includes('--trade-row-height: 44px')],
  ['legacy workbench removed from default route', !/listPath === '\/list'[\s\S]+ReviewCaseWorkbench/.test(app)],
]

const failed = checks.filter(([, ok]) => !ok)
if (failed.length) {
  for (const [name] of failed) console.error(`FAIL: ${name}`)
  process.exit(1)
}
console.log('PASS: Linear design contract')
```

- [ ] **Step 2: Register and run the check to confirm failure**

Add to `package.json`:

```json
"qa:design": "node scripts/qa-design-contract.mjs"
```

Run: `npm run qa:design`

Expected: FAIL because the canonical token names and default-route contract do not yet exist.

- [ ] **Step 3: Capture current functional baselines**

Extend the existing Playwright QA to capture `/list`, `/today-record`, `/review-cases`, one valid trade detail, `/dashboard`, and `/settings/profile` at `1440x900` and `1920x1080`.

Run: `npm run qa:workbench`

Expected: screenshots are written; no page error or console exception is accepted.

- [ ] **Step 4: Run the existing regression suite**

Run: `npm test`

Expected: PASS before structural edits begin.

- [ ] **Step 5: Commit the baseline harness**

```powershell
git add package.json scripts/qa-design-contract.mjs scripts/qa-workbench.mjs
git commit -m "test: 固化前端重构基线"
```

---

### Task 2: Normalize Tokens and Shared UI Primitives

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`
- Modify: `src/App.css`
- Create: `src/components/ui/AppFrame.tsx`
- Create: `src/components/ui/AppFrame.css`
- Create: `src/components/ui/Toolbar.tsx`
- Create: `src/components/ui/Toolbar.css`
- Create: `src/components/ui/PropertyList.tsx`
- Create: `src/components/ui/PropertyList.css`
- Modify: `src/main.tsx`

**Interfaces:**
- Produces: CSS tokens `--sidebar-width`, `--main-inset`, `--main-radius`, `--control-height`, `--trade-row-height`, `--chip-height-sm`, `--chip-height-md`.
- Produces: `AppFrame`, `Toolbar`, `PropertySection`, and `PropertyRow` components.

- [ ] **Step 1: Add exact structural tokens**

Define the approved aliases without removing still-used legacy aliases:

```css
:root {
  --sidebar-width: 244px;
  --main-inset: 8px;
  --main-radius: 12px;
  --control-height: 28px;
  --trade-row-height: 44px;
  --chip-height-sm: 20px;
  --chip-height-md: 24px;
  --motion-fast: 100ms;
  --motion-ui: 150ms;
  --motion-panel: 250ms;
  --motion-page: 350ms;
}
```

- [ ] **Step 2: Implement the shared frame interface**

Use this public API:

```tsx
type AppFrameProps = {
  sidebar: React.ReactNode
  children: React.ReactNode
}

export function AppFrame({ sidebar, children }: AppFrameProps) {
  return (
    <div className="ui-app-frame">
      {sidebar}
      <main className="ui-main-frame">{children}</main>
    </div>
  )
}
```

The CSS must consume the structural tokens and include a reduced-motion rule.

- [ ] **Step 3: Implement the toolbar interface**

```tsx
type ToolbarProps = {
  title: string
  context?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}
```

Render one fixed-height header with title/context on the left and actions on the right. Do not wrap title or icon buttons in cards.

- [ ] **Step 4: Implement flat property primitives**

```tsx
export function PropertySection(props: {
  title: string
  children: React.ReactNode
})

export function PropertyRow(props: {
  label: React.ReactNode
  value: React.ReactNode
  onClick?: () => void
})
```

Rows use a stable grid and hover surface; sections use spacing or a single divider, never nested card backgrounds.

- [ ] **Step 5: Verify tokens and build**

Run:

```powershell
npm run qa:design
npm run build
```

Expected: token checks pass; the legacy-route assertion may remain the only failing contract until Task 4. Build passes.

- [ ] **Step 6: Commit the foundation**

```powershell
git add src/styles src/components/ui src/main.tsx src/App.css
git commit -m "refactor: 建立 Linear 前端基础组件"
```

---

### Task 3: Replace Sidebar and Application Shell

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Sidebar.css`
- Modify: `src/components/Topbar.tsx`
- Modify: `src/components/Topbar.css`
- Modify: `src/lib/sidebarNav.ts`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes: `AppFrame` and `Toolbar` from Task 2.
- Produces: one sidebar navigation model with no module switch, time list, or strategy list.

- [ ] **Step 1: Add navigation regression assertions**

Add pure assertions for the canonical primary destinations:

```ts
const expectedPrimaryRoutes = [
  '/today-record',
  '/list',
  '/review-cases',
  '/dashboard',
  '/cases',
]
assert.deepEqual(PRIMARY_NAV.map((item) => item.to), expectedPrimaryRoutes)
```

Also assert that no primary item points to `/period/*` or `/strategy/*`.

- [ ] **Step 2: Replace the sidebar navigation model**

Export a single `PRIMARY_NAV` from `src/lib/sidebarNav.ts`. Keep case-record subviews collapsible and place trash/settings at the bottom. Remove `activeModule`, `setModule`, `sb-module-switch`, time rendering, and strategy rendering from `Sidebar` only; do not remove their Store fields in this task.

- [ ] **Step 3: Move the shell to AppFrame**

Replace the raw `.app-shell` wrapper with:

```tsx
<AppFrame sidebar={<Sidebar onOpenSearch={() => setCmdkOpen(true)} />}>
  <Routes>{/* existing routes */}</Routes>
</AppFrame>
```

- [ ] **Step 4: Flatten sidebar selection styling**

Use a neutral selected background and remove the accent inset stripe and decorative avatar gradient. Keep icon size at `16px`, item height at `28px`, and count text aligned right.

- [ ] **Step 5: Verify navigation and responsive shell**

Run:

```powershell
npm test
npm run build
```

Expected: PASS. Manually verify all five primary routes and settings/trash remain reachable.

- [ ] **Step 6: Commit the shell migration**

```powershell
git add src/App.tsx src/components/Sidebar.* src/components/Topbar.* src/lib/sidebarNav.ts src/regression.test.ts
git commit -m "refactor: 统一应用壳层与侧栏导航"
```

---

### Task 4: Build the Canonical Trade List and Filters

**Files:**
- Create: `src/lib/tradeView.ts`
- Create: `src/components/trades/TradeRow.tsx`
- Create: `src/components/trades/TradeList.tsx`
- Create: `src/components/trades/TradeList.css`
- Create: `src/components/trades/TradeFilters.tsx`
- Create: `src/components/ui/FilterBar.tsx`
- Create: `src/components/ui/FilterBar.css`
- Modify: `src/views/ListView.tsx`
- Modify: `src/views/ListView.css`
- Modify: `src/App.tsx`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Produces: `groupTradesByMonth(trades: Trade[]): TradeMonthGroup[]`.
- Produces: `TradeRow` with stable selection, focus, open, and star callbacks.
- Produces: `TradeFilters` that maps approved filter controls to the existing `ListFilter` behavior.

- [ ] **Step 1: Add failing pure grouping tests**

```ts
const groups = groupTradesByMonth([
  trade({ id: '2', openedAt: '2026-07-02T00:00:00.000Z' }),
  trade({ id: '1', openedAt: '2026-06-30T00:00:00.000Z' }),
])
assert.deepEqual(groups.map((group) => group.key), ['2026-07', '2026-06'])
assert.equal(groups[0].items[0].id, '2')
```

Add tests that today's view returns one ungrouped sequence and case scope filtering does not change row data.

- [ ] **Step 2: Implement `tradeView.ts`**

Define:

```ts
export type TradeMonthGroup = {
  key: string
  label: string
  items: Trade[]
}

export function groupTradesByMonth(trades: Trade[]): TradeMonthGroup[]
export function getVisibleTradeTags(trade: Trade, limit?: number): {
  visible: string[]
  hiddenCount: number
}
```

Use date parsing and array sorting, not string slicing for ordering.

- [ ] **Step 3: Implement the canonical 44px row**

Use this callback contract:

```tsx
type TradeRowProps = {
  trade: Trade
  selected: boolean
  focused: boolean
  onOpen: (trade: Trade) => void
  onSelect: (trade: Trade) => void
  onToggleStar: (trade: Trade) => void
}
```

The row grid must reserve stable columns for status, symbol/side, strategy, tags, PnL, R, date, and star. Render at most two tags plus `+N`.

- [ ] **Step 4: Implement the filter bar and panel**

Expose controls for time, strategy, status, symbol, side, kind, tags, mistake tags, and review category. Reuse existing `ListFilter`, `tradeInPeriod`, strategy definitions, and tag collectors. Add an explicit built-in “本月交易” action that applies `period: 'this-month'`.

- [ ] **Step 5: Replace ListView internals**

Keep existing keyboard selection, batch actions, context menus, star behavior, and route navigation. Replace only the page composition and row rendering with `Toolbar`, `FilterBar`, and `TradeList`.

- [ ] **Step 6: Stop routing default trade pages to ReviewCaseWorkbench**

Change `TradesPage` so `/list`, `/today-record`, and `/review-cases*` render the canonical list. Do not delete `ReviewCaseWorkbench` yet.

- [ ] **Step 7: Verify the complete list slice**

Run:

```powershell
npm test
npm run qa:design
npm run build
```

Expected: all pass, including the default-route contract.

- [ ] **Step 8: Commit the list slice**

```powershell
git add src/lib/tradeView.ts src/components/trades src/components/ui/FilterBar.* src/views/ListView.* src/App.tsx src/regression.test.ts
git commit -m "refactor: 统一交易列表与筛选体验"
```

---

### Task 5: Recompose the Independent Trade Detail

**Files:**
- Create: `src/components/trades/TradeDetailLayout.tsx`
- Create: `src/components/trades/TradeDetailLayout.css`
- Create: `src/components/trades/TradeMedia.tsx`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/views/DetailView.css`
- Modify: `src/editor/Editor.css`
- Modify: `src/components/ImageLightbox.tsx`
- Modify: `scripts/qa-phase1-image.mjs`
- Modify: `src/lib/importExportAssets.test.ts`

**Interfaces:**
- Consumes: `Toolbar`, `PropertySection`, and `PropertyRow`.
- Produces: `TradeDetailLayout` with `header`, `content`, and `properties` slots.
- Preserves: existing note autosave callbacks and asset URL resolution.

- [ ] **Step 1: Extend image regression coverage before layout changes**

Add assertions that two trades with different stored assets resolve to their own image URLs after export/import normalization. Extend Playwright QA to open each trade and compare the visible `data-trade-id` and image asset source owner.

Run:

```powershell
npm test
npm run qa:image
```

Expected: PASS before the refactor.

- [ ] **Step 2: Implement the detail layout contract**

```tsx
type TradeDetailLayoutProps = {
  header: React.ReactNode
  content: React.ReactNode
  properties: React.ReactNode
}
```

Desktop uses a flexible main column and `440px` properties column. Narrow layouts render properties in an accessible drawer controlled by an icon button.

- [ ] **Step 3: Extract visual media rendering only**

`TradeMedia` receives already-resolved image sources:

```tsx
type TradeMediaProps = {
  tradeId: string
  images: string[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  onOpenLightbox: (index: number) => void
}
```

Use `object-fit: contain`; include explicit loading, empty, and error states. Do not infer symbol ownership from filenames or array position.

- [ ] **Step 4: Recompose DetailView without rewriting behavior**

Keep state, Store actions, autosave effects, import asset normalization, comments, activity and menus in `DetailView.tsx`. Replace the rendered structure with the new layout and flat property sections.

- [ ] **Step 5: Flatten editor and properties styling**

Remove nested card backgrounds from the editor, activity, tags and property groups. Preserve separators, hover states and keyboard focus.

- [ ] **Step 6: Verify notes, images, and editing**

Run:

```powershell
npm test
npm run qa:image
npm run build
```

Expected: PASS. QA must open at least two trades with different symbols and confirm the displayed image belongs to the selected trade.

- [ ] **Step 7: Commit the detail slice**

```powershell
git add src/components/trades src/views/DetailView.* src/editor/Editor.css src/components/ImageLightbox.tsx scripts/qa-phase1-image.mjs src/lib/importExportAssets.test.ts
git commit -m "refactor: 重构交易详情与属性面板"
```

---

### Task 6: Align Quick Capture and Review-Case Workflows

**Files:**
- Modify: `src/components/TradeComposer.tsx`
- Modify: `src/components/TradeComposer.css`
- Modify: `src/App.tsx`
- Modify: `src/lib/tradeFilters.ts`
- Modify: `src/lib/reviewAnalytics.ts`
- Modify: `src/regression.test.ts`
- Delete after verification: `src/views/ReviewCaseWorkbench.tsx`
- Delete after verification: `src/views/ReviewCaseWorkbench.css`

**Interfaces:**
- Consumes: canonical trade list and detail from Tasks 4 and 5.
- Preserves: `TradeKind`, review category, review status, and dashboard exclusion behavior.

- [ ] **Step 1: Add workflow tests**

Assert:

```ts
assert.equal(defaultTradeKindForPath('/today-record'), 'live')
assert.equal(defaultTradeKindForPath('/review-cases'), 'case')
assert.equal(isAccountTrade(caseTrade), false)
assert.equal(matchesReviewScope(mistakeCase, 'mistakes'), true)
```

- [ ] **Step 2: Simplify composer defaults**

Keep the existing composer data model and image input. Make route context determine only defaults; do not duplicate fields for cases. The initial quick-create surface emphasizes symbol, side, date, strategy and image, with advanced fields progressively disclosed.

- [ ] **Step 3: Make all review-case scopes reuse the same list**

Ensure `/review-cases`, `/review-cases/focus`, `/review-cases/mistakes`, `/review-cases/unreviewed`, and `/review-cases/reviewed` only alter filters and title. They must render the same `TradeList` and open the same detail route.

- [ ] **Step 4: Remove the verified legacy workbench**

After the routes and QA pass, delete `ReviewCaseWorkbench.tsx` and `.css`, then remove imports and all `rcw-*` references.

- [ ] **Step 5: Verify quick capture and statistical boundaries**

Run:

```powershell
npm test
npm run qa:workbench
npm run build
```

Expected: today capture creates live trades; case capture creates case records; case records remain absent from dashboard totals.

- [ ] **Step 6: Commit the workflow migration**

```powershell
git add -A src/components/TradeComposer.* src/App.tsx src/lib src/regression.test.ts src/views/ReviewCaseWorkbench.*
git commit -m "refactor: 统一快速记录与案例复盘流程"
```

---

### Task 7: Flatten Dashboard, Settings, and Case-Law Pages

**Files:**
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/Dashboard.css`
- Modify: `src/views/settings/SettingsLayout.tsx`
- Modify: `src/views/settings/SettingsLayout.css`
- Modify: `src/views/settings/DisplaySettingsPanel.css`
- Modify: `src/views/settings/TagPresetsPanel.css`
- Modify: `src/views/settings/DisputeTypesPanel.css`
- Modify: `src/views/CaseList.tsx`
- Modify: `src/views/CaseList.css`
- Modify: `src/views/CaseDetail.tsx`
- Modify: `src/views/CaseDetail.css`

**Interfaces:**
- Consumes: shared `Toolbar`, property primitives, shell, spacing and surface tokens.
- Preserves: Recharts calculations, settings Store actions, and case-law data model.

- [ ] **Step 1: Convert dashboard KPI cards into one metric strip**

Render the four metrics inside one unframed grid band. Keep type and time segmented controls. Preserve `buildStats`, range behavior and chart click navigation.

- [ ] **Step 2: Convert chart cards into continuous sections**

Use section headers and horizontal dividers. Remove per-panel radius, full background, hover transform and large empty card surfaces. Keep chart dimensions stable.

- [ ] **Step 3: Flatten settings layout**

Keep the settings sub-navigation and nested routes. Place navigation and form on one surface; convert panel cards to section headings and rows. Keep destructive actions and confirmations unchanged.

- [ ] **Step 4: Migrate case-law routes to the shared shell language**

Use the canonical toolbar, compact rows and flat properties while retaining separate case-law fields, comparison tools and lifecycle semantics.

- [ ] **Step 5: Verify secondary pages**

Run:

```powershell
npm test
npm run build
```

Expected: PASS. Manually verify charts render nonblank, all settings persist, and case-law navigation remains reachable from the primary sidebar.

- [ ] **Step 6: Commit secondary page migration**

```powershell
git add src/views/Dashboard.* src/views/settings src/views/CaseList.* src/views/CaseDetail.*
git commit -m "refactor: 统一仪表盘设置与判例页面"
```

---

### Task 8: Responsive, Accessibility, Cleanup, and Final QA

**Files:**
- Create: `scripts/qa-linear-rebuild.mjs`
- Modify: `package.json`
- Modify: `src/styles/global.css`
- Modify: all migrated CSS files only where QA finds a reproducible issue.
- Delete: unused legacy selectors and stylesheets proven unreferenced by `rg`.

**Interfaces:**
- Produces: `npm run qa:linear`, the final route, interaction, console, screenshot, and responsive verification command.

- [ ] **Step 1: Implement final Playwright QA**

The script must:

```js
const routes = [
  '/list',
  '/today-record',
  '/review-cases',
  '/dashboard',
  '/cases',
  '/settings/profile',
]
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
  { name: 'narrow', width: 900, height: 800 },
]
```

For each route and viewport, fail on page errors, console errors, horizontal document overflow, missing main frame, or overlapping toolbar actions. Capture screenshots under `.gstack/qa-reports/linear-rebuild/`.

- [ ] **Step 2: Register final QA**

Add:

```json
"qa:linear": "node scripts/qa-linear-rebuild.mjs"
```

- [ ] **Step 3: Verify keyboard and reduced motion behavior**

Check Tab focus, list arrow navigation, Enter to open, Escape to close drawers/menus, icon-button accessible names, and `prefers-reduced-motion: reduce`.

- [ ] **Step 4: Scan and remove obsolete styling**

Run:

```powershell
rg -n "ReviewCaseWorkbench|rcw-|sb-module-switch|db-card|settings-panel" src
```

Expected: no legacy workbench/module-switch references; remaining dashboard/settings names must correspond to the new flat structures. Remove only selectors proven unused.

- [ ] **Step 5: Run complete verification**

```powershell
npm test
npm run qa:design
npm run qa:image
npm run qa:linear
npm run build
```

Expected: every command exits `0`; screenshots exist for every route and viewport; no image-owner mismatch, page error, console error, text overlap, or document overflow is reported.

- [ ] **Step 6: Verify Electron build**

Run: `npm run build:app`

Expected: Vite and Electron renderer/main builds succeed and `sql-wasm.wasm` is copied.

- [ ] **Step 7: Commit final cleanup**

```powershell
git add -A
git commit -m "test: 完成 Linear 前端重构验收"
```

---

## Self-Review Result

- Spec coverage: shell, information architecture, list, filters, detail, images, quick capture, review cases, dashboard, settings, case law, responsive behavior, accessibility and QA all map to explicit tasks.
- Placeholder scan: no `TBD`, deferred implementation step, or unspecified “write tests” instruction remains.
- Type consistency: shared component names and interfaces are introduced before they are consumed; trade-domain interfaces remain existing project types.
- Scope control: storage, Store semantics, import/export, image protocol, statistics and case-law data remain outside the visual rewrite except for regression coverage and presentation composition.
