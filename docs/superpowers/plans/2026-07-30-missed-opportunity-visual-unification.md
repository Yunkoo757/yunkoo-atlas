# Missed Opportunity Visual Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“错过的机会”从独立设置页式布局改造成与交易日志、模拟盘一致的紧凑跨工作区工作台，同时保持现有聚合、筛选、计数、回源和返回现场行为不变。

**Architecture:** 保留 `MissedOpportunitiesView` 的数据派生与导航职责，把范围选择拆成独立的受控浮层组件，并为共享 `FilterBar` 增加标准右侧动作槽。聚合行继续通过 `TradeList.renderRow` 渲染，但统一成单套响应式行结构和单个行尾菜单，所有页面级视觉规则集中在 `MissedOpportunitiesView.css`。

**Tech Stack:** React 19、TypeScript、React Router、Zustand、CSS design tokens、Vite、Playwright browser fixtures、Node regression tests、pnpm。

## Global Constraints

- 所有文件必须保存为 UTF-8 without BOM，保留全部中文字符。
- 不修改跨工作区聚合、排序、合并与去重规则。
- 不修改侧栏计数及其口径。
- 不修改临时筛选 URL、详情回源、滚动位置和焦点恢复行为。
- 不修改交易日志、模拟盘、案例记录的详情路由与编辑职责。
- 页面首屏不得保留常驻“管理包含范围”大区块。
- 桌面范围与筛选按钮使用现有 `--field-height-md`（32px），激活筛选标签使用 `--toolbar-chip-height`（28px）；触屏有效命中区不得小于 44×44px。
- 桌面列表行高 44px，移动列表行高 64–72px；桌面横向内边距 16px，移动端 12px。
- 375px、768px、1280px 和 1920px 宽度不得出现水平溢出、工具栏换行、操作遮挡或不可达操作。
- 先写失败测试，再写最小实现；每个任务独立验证并提交。

---

## File Structure

### Create

- `src/components/trades/MissedOpportunityScopeMenu.tsx`：仅负责范围触发器、三来源复选菜单、最后来源约束、关闭与焦点恢复。

### Modify

- `src/components/ui/FilterBar.tsx`：增加可选 `actions` 槽，把范围按钮和筛选按钮放入同一个标准动作组。
- `src/components/ui/FilterBar.css`：定义动作组布局，不改变交易日志默认外观。
- `src/components/trades/MissedOpportunityFilters.tsx`：接收结果数和范围动作，向 `FilterBar` 提供 `全部机会 N` 与范围入口。
- `src/views/MissedOpportunitiesView.tsx`：移除常驻范围区，接入范围菜单、统一 live 状态、标准空状态及新副标题。
- `src/components/trades/MissedOpportunityRow.tsx`：合并项改用一个标准行尾菜单，增加安静的关联信息并统一可访问名称。
- `src/views/MissedOpportunitiesView.css`：删除旧范围卡片与自建按钮样式，建立紧凑工具栏、行、状态和响应式规则。
- `src/views/MissedOpportunitiesView.browser.test.tsx`：覆盖工具栏、范围菜单、列表动作、空状态、筛选和返回现场。
- `src/regression.test.ts`：把旧页面结构契约更新为新工作台结构契约。
- `scripts/qa-missed-opportunities.mjs`：补充桌面/平板/手机的尺寸、溢出、行高、工具栏和范围菜单断言。

### Keep Unchanged

- `src/lib/missedOpportunities.ts`：聚合、合并、排序和筛选派生不变。
- `src/lib/sidebarWorkspace.ts`：范围持久化和至少一个来源约束不变。
- `src/components/trades/TradeList.tsx`：继续提供虚拟列表和自定义行，不为单页改写通用虚拟化逻辑。

---

### Task 1: Add a standard action group to FilterBar

**Files:**
- Modify: `src/components/ui/FilterBar.tsx:12-86`
- Modify: `src/components/ui/FilterBar.css:6-49`
- Modify: `src/regression.test.ts:660-710`

**Interfaces:**
- Consumes: existing `FilterBar` props and `ReactNode`.
- Produces: optional `actions?: ReactNode`; `.ui-filter-actions` containing caller actions followed by the existing filter trigger; active filters render visible `筛选 · N` text and `.has-filters` state.
- Compatibility: callers without `actions` render the same quick views, active filters and trigger content as before.

- [ ] **Step 1: Add a failing source contract for the action slot**

Update `testMissedOpportunityAggregateRouteAndViewContract` to load `FilterBar.tsx` and assert the new API and wrapper:

```ts
const filterBar = await fs.readFile('src/components/ui/FilterBar.tsx', 'utf8')
assert(filterBar.includes('actions?: ReactNode'), 'FilterBar 必须提供标准右侧动作槽')
assert(filterBar.includes('className="ui-filter-actions"'), 'FilterBar 必须把并列动作收进统一动作组')
assert(filterBar.includes("' has-filters'") && filterBar.includes('筛选 ·'), 'FilterBar 必须在入口显示激活筛选数量')
```

- [ ] **Step 2: Run the regression suite and confirm the contract fails**

Run: `node scripts/run-regression-tests.mjs`

Expected: FAIL with `FilterBar 必须提供标准右侧动作槽`.

- [ ] **Step 3: Implement the minimal FilterBar action API**

Extend the props and group the caller action with the existing trigger:

```tsx
export function FilterBar({
  activeFilters,
  open,
  onToggle,
  children,
  rootRef,
  triggerRef,
  panelId,
  quickViews,
  label = '筛选交易',
  shortcutActionId,
  actions,
}: {
  activeFilters: ActiveFilter[]
  open: boolean
  onToggle: () => void
  children?: ReactNode
  rootRef?: RefObject<HTMLDivElement>
  triggerRef?: RefObject<HTMLButtonElement>
  panelId?: string
  quickViews?: ReactNode
  label?: string
  shortcutActionId?: string
  actions?: ReactNode
}) {
}
```

Replace the existing standalone trigger render at the end of `.ui-filter-bar` with this exact group:

```tsx
<div className="ui-filter-actions">
  {actions}
  {shortcutActionId ? (
    <ShortcutTooltip actionId={shortcutActionId} label={label} mode="shortcut">
      {trigger}
    </ShortcutTooltip>
  ) : trigger}
</div>
```

Update the trigger class and visible label without changing its `aria-label`:

```tsx
className={
  'ui-filter-trigger' +
  (open ? ' is-open' : '') +
  (activeFilters.length > 0 ? ' has-filters' : '')
}

<span>{activeFilters.length > 0 ? `筛选 · ${activeFilters.length}` : '筛选'}</span>
```

Use this CSS so the action group occupies the right edge without changing control metrics:

```css
.ui-filter-actions {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 6px;
  margin-left: auto;
}

.ui-filter-actions .ui-filter-trigger {
  margin-left: 0;
}

.ui-filter-trigger.has-filters {
  color: var(--list-text-strong);
  border-color: var(--surface-control-border-active);
  background: var(--surface-control-active);
}
```

- [ ] **Step 4: Verify shared FilterBar callers and types**

Run: `pnpm typecheck && node scripts/run-regression-tests.mjs`

Expected: PASS; `TradeFilters` compiles without passing `actions`, and the new source contract passes.

- [ ] **Step 5: Commit the shared primitive change**

```bash
git add src/components/ui/FilterBar.tsx src/components/ui/FilterBar.css src/regression.test.ts
git commit -m "feat: add filter bar action group"
```

---

### Task 2: Replace the persistent scope panel with a compact toolbar menu

**Files:**
- Create: `src/components/trades/MissedOpportunityScopeMenu.tsx`
- Modify: `src/components/trades/MissedOpportunityFilters.tsx:1-154`
- Modify: `src/views/MissedOpportunitiesView.tsx:1-209`
- Modify: `src/views/MissedOpportunitiesView.css:1-130,274-351`
- Modify: `src/views/MissedOpportunitiesView.browser.test.tsx:39-51,316-506,598-659`
- Modify: `src/regression.test.ts:660-710,1719-1743`

**Interfaces:**
- Consumes: `MissedOpportunitySource`, `summary.rawCounts`, selected `sources`, existing `toggleSource`, and `FilterBar.actions` from Task 1.
- Produces:

```ts
export type MissedOpportunityScopeMenuProps = {
  sources: readonly MissedOpportunitySource[]
  rawCounts: Record<MissedOpportunitySource, number>
  onToggle: (source: MissedOpportunitySource) => boolean
}
```

- Produces updated filter API:

```ts
type MissedOpportunityFiltersProps = {
  trades: Trade[]
  symbolCatalog: string[]
  resultCount: number
  actions: ReactNode
  headingRef: RefObject<HTMLHeadingElement | null>
}
```

- `onToggle` returns `false` only when the last enabled source cannot be removed; the menu then displays `至少保留一个工作区` without closing.

- [ ] **Step 1: Rewrite browser expectations to the approved toolbar structure**

Replace helpers targeting `.missed-scope-actions` with role-based scope helpers:

```ts
function scopeTrigger(): HTMLButtonElement {
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="管理包含范围"]')
  assert(trigger, '找不到包含范围入口')
  return trigger
}

async function ensureScopeOpen(): Promise<void> {
  if (document.querySelector('[role="menu"][aria-label="包含范围"]')) return
  keyboardActivate(scopeTrigger())
  await waitFor(
    () => document.querySelector('[role="menu"][aria-label="包含范围"]') !== null,
    '键盘 Enter 未打开包含范围',
  )
}

function scopeOption(label: string): HTMLButtonElement {
  const option = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')]
    .find((candidate) => candidate.textContent?.trim().startsWith(label))
  assert(option, `找不到范围选项：${label}`)
  return option
}
```

Add assertions for the new title, toolbar and absence of the old panel:

```ts
assert(document.querySelector('.ui-toolbar-context')?.textContent?.trim() === '跨工作区汇总', '页面副标题不准确')
assert(document.querySelector('.missed-scope') === null, '不得保留常驻范围配置区')
assert(document.querySelector('[data-missed-total]')?.textContent?.includes('全部机会 4'), '工具栏结果数不准确')
assert(scopeTrigger().textContent?.trim() === '范围 · 3', '范围入口必须显示已启用来源数')
```

Update range interaction tests to open the menu, assert three `menuitemcheckbox` options and raw counts, toggle paper twice, reject the last source with inline text, close by `Escape`, and verify focus returns to `scopeTrigger()`.

- [ ] **Step 2: Update regression contracts and confirm both test layers fail**

Replace obsolete assertions for `来自你选择的工作区`, `管理包含范围`, `.missed-scope-actions`, and the standalone total with:

```ts
assert(missedView.includes('subtitle="跨工作区汇总"'), '聚合页必须使用工作台上下文副标题')
assert(missedView.includes('showSaveStatus={false}'), '聚合页不得常驻显示无关保存状态')
assert(!missedView.includes('className="missed-scope"'), '聚合页不得保留常驻范围设置区')
assert(missedView.includes('<MissedOpportunityScopeMenu'), '聚合页必须提供工具栏范围菜单')
assert(missedFilters.includes('resultCount') && missedFilters.includes('actions={actions}'), '结果数和范围入口必须进入同一工具栏')
assert(missedFilters.includes('id="missed-results-heading"'), '筛选工具栏必须提供结果标题')
assert(missedView.includes('headingRef={returnHeadingRef}'), '返回目标消失时必须聚焦结果标题')
```

Run: `node scripts/run-regression-tests.mjs && node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: regression and browser fixture FAIL because the new toolbar/menu DOM is not implemented.

- [ ] **Step 3: Implement the accessible scope menu**

Create `MissedOpportunityScopeMenu.tsx` with this state and DOM contract:

```tsx
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check } from '@/icons/appIcons'
import {
  MISSED_OPPORTUNITY_SOURCES,
  type MissedOpportunitySource,
} from '@/lib/missedOpportunities'

const SOURCE_LABELS: Record<MissedOpportunitySource, string> = {
  trade: '交易日志',
  paper: '模拟盘',
  case: '案例记录',
}

export function MissedOpportunityScopeMenu({
  sources,
  rawCounts,
  onToggle,
}: MissedOpportunityScopeMenuProps) {
  const [open, setOpen] = useState(false)
  const [constraint, setConstraint] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const close = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!open) return
    firstOptionRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [close, open])

  return (
    <div className="missed-scope-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={'missed-scope-trigger' + (open ? ' is-open' : '')}
        aria-label="管理包含范围"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        范围 · {sources.length}
      </button>
      {open ? (
        <div id={panelId} className="missed-scope-popover" role="menu" aria-label="包含范围">
          {MISSED_OPPORTUNITY_SOURCES.map((source, index) => (
            <button
              ref={index === 0 ? firstOptionRef : undefined}
              key={source}
              type="button"
              role="menuitemcheckbox"
              aria-checked={sources.includes(source)}
              onClick={() => {
                const changed = onToggle(source)
                setConstraint(changed ? null : '至少保留一个工作区')
              }}
            >
              <span className="missed-scope-check" aria-hidden="true">
                {sources.includes(source) ? <Check size={11} /> : null}
              </span>
              <span>{SOURCE_LABELS[source]}</span>
              <span className="missed-scope-count">{rawCounts[source]}</span>
            </button>
          ))}
          {constraint ? <p role="status">{constraint}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
```

Use this page-scoped CSS; do not extend the generic `Menu` because its select-and-close behavior conflicts with continuous multi-selection:

```css
.missed-scope-menu {
  position: relative;
  display: inline-flex;
}

.missed-scope-trigger {
  height: var(--field-height-md);
  padding: 0 var(--sp-2);
  color: var(--list-text-secondary);
  font-family: var(--font-ui);
  font-size: var(--fs-mini);
  font-weight: var(--font-weight-medium);
  border: 1px solid var(--surface-control-border);
  border-radius: var(--radius-full);
  background: var(--surface-control);
}

.missed-scope-popover {
  position: absolute;
  z-index: var(--z-popover);
  top: calc(100% + 4px);
  right: 0;
  width: clamp(240px, 22vw, 280px);
  padding: var(--sp-2);
  background: var(--popover-bg);
  border: 1px solid var(--popover-border);
  border-radius: var(--popover-radius);
  box-shadow: var(--popover-shadow);
}

.missed-scope-popover [role='menuitemcheckbox'] {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 36px;
  padding: 0 var(--sp-2);
  color: var(--text-secondary);
  border-radius: var(--radius-6);
  text-align: left;
}

.missed-scope-check {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-4);
}

[role='menuitemcheckbox'][aria-checked='true'] .missed-scope-check {
  color: var(--accent-text);
  background: var(--accent);
  border-color: var(--accent);
}
```

- [ ] **Step 4: Integrate result summary and range menu into FilterBar**

Change `MissedOpportunityFilters` to pass a quiet count through `quickViews` and the range menu through `actions`:

```tsx
<FilterBar
  activeFilters={activeFilters}
  open={open}
  onToggle={() => setOpen((current) => !current)}
  panelId="missed-opportunity-filter-panel"
  label="筛选错过机会"
quickViews={(
  <h2
    id="missed-results-heading"
    ref={headingRef}
    className="missed-results-heading"
    data-missed-total={resultCount}
    tabIndex={-1}
  >
    全部机会 <span>{resultCount}</span>
  </h2>
)}
actions={actions}
```

In `MissedOpportunitiesView`, remove the entire `missed-scope` section, change the topbar context, and mount the menu inside the filter toolbar:

```tsx
<Topbar
  title="错过的机会"
  subtitle="跨工作区汇总"
  showDisplay={false}
  showSaveStatus={false}
/>
<main className="missed-view">
  <MissedOpportunityFilters
    trades={trades}
    symbolCatalog={symbolCatalog}
    resultCount={visibleItems.length}
    headingRef={returnHeadingRef}
    actions={(
      <MissedOpportunityScopeMenu
        sources={sources}
        rawCounts={summary.rawCounts}
        onToggle={toggleSource}
      />
    )}
  />
  <span className="missed-live" aria-live="polite">
    {returnStatus ?? `当前显示 ${visibleItems.length} 条错过机会`}
  </span>
```

Make `toggleSource` return `boolean`. When it succeeds, preserve the existing persisted workspace update and set a live announcement based on the next selected sources and current URL filters. When it fails, keep the existing toast for visible global feedback and return `false` for the inline menu message.

- [ ] **Step 5: Replace the two empty-state copies and fallback focus target**

Use the exact approved copy and move `returnHeadingRef` to `#missed-results-heading`:

```tsx
const emptyContent = summary.rawTotal === 0 ? (
  <div className="missed-empty">
    <h2>所选工作区暂无错过记录</h2>
    <p>可以前往已包含的工作区查看或补充原始记录。</p>
    <div className="missed-empty-actions">
      {sources.includes('trade') ? <Link to="/list">前往交易日志</Link> : null}
      {sources.includes('paper') ? <Link to="/sim">前往模拟盘</Link> : null}
      {sources.includes('case') ? <Link to="/review-cases">前往案例记录</Link> : null}
    </div>
  </div>
) : visibleItems.length === 0 ? (
  <div className="missed-empty">
    <h2>没有符合当前筛选的机会</h2>
    <button type="button" onClick={clearFilters}>清除筛选</button>
  </div>
) : null
```

Render `emptyContent` when it is non-null; otherwise render the current `missed-results` + `TradeList` branch without changing its groups, virtualization or callbacks. The empty state is centered in the scrollable work area and uses existing secondary button/link tokens; it must not recreate three bordered cards.

- [ ] **Step 6: Run the focused browser and regression tests**

Run: `pnpm typecheck && node scripts/run-regression-tests.mjs && node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: PASS; the browser fixture verifies immediate scope updates, last-source protection, `Escape` focus return, URL filters, empty states and missing-anchor fallback.

- [ ] **Step 7: Commit the toolbar and scope flow**

```bash
git add src/components/trades/MissedOpportunityScopeMenu.tsx src/components/trades/MissedOpportunityFilters.tsx src/views/MissedOpportunitiesView.tsx src/views/MissedOpportunitiesView.css src/views/MissedOpportunitiesView.browser.test.tsx src/regression.test.ts
git commit -m "feat: move missed opportunity scope into toolbar"
```

---

### Task 3: Unify aggregated rows and row-end actions

**Files:**
- Modify: `src/components/trades/MissedOpportunityRow.tsx:1-172`
- Modify: `src/views/MissedOpportunitiesView.css:131-273,353-426`
- Modify: `src/views/MissedOpportunitiesView.browser.test.tsx:352-428,508-557`
- Modify: `src/regression.test.ts:706-710,1746-1753`

**Interfaces:**
- Consumes: existing `MissedOpportunityItem`, `SymbolIconsMap`, `onOpen(target, anchorId)`, and generic `Menu`.
- Produces: one DOM structure for all viewports; ordinary rows expose an overlay primary action, merged rows expose one `missed-row-menu` trigger marked `data-trade-primary-action` and menu options for the original record plus every linked case.
- Return focus contract: ordinary records restore to the overlay action; merged records restore to the visible row-end menu trigger on desktop and mobile.

- [ ] **Step 1: Change browser expectations to one merged-action menu**

Replace assertions for `.missed-row-actions`, `.missed-row-mobile-menu`, `打开原始记录`, and `打开案例（2）` visible buttons with:

```ts
const mergedRow = resultRow(rootTrade.id)
assert(mergedRow.textContent?.includes('关联 2 个案例'), '合并项缺少安静的关联数量')
const mergedMenu = mergedRow.querySelector<HTMLButtonElement>('.missed-row-menu [data-trade-primary-action]')
assert(mergedMenu?.getAttribute('aria-label') === '更多操作：XAUUSD', '合并项必须使用上下文化行尾菜单')
mergedMenu.click()
await waitFor(() => document.querySelector('[role="menu"]') !== null, '合并项菜单未打开')
const labels = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  .map((button) => button.textContent?.trim())
assert(labels.includes('打开 XAUUSD 原始交易记录'), '菜单缺少原始记录入口')
assert(labels.includes('打开案例 CAS-LINK-1'), '菜单缺少关联案例入口')
```

Retain the test proving merged-row background clicks do not guess a target, and drive all merged navigation through the same menu.

- [ ] **Step 2: Update the static return-focus contract and verify failure**

Replace the exact-count assertion with semantic markers:

```ts
assert(missedRow.includes('className="missed-row-menu"'), '合并项必须统一使用行尾菜单')
assert(missedRow.includes('data-trade-primary-action'), '普通项和合并项必须暴露返回焦点')
assert(!missedRow.includes('missed-row-mobile-menu'), '不得维护独立移动操作树')
assert(!missedRow.includes('missed-row-actions'), '不得在桌面行内堆叠多个动作按钮')
```

Run: `node scripts/run-regression-tests.mjs && node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: FAIL because the current row still renders separate desktop actions and mobile menu.

- [ ] **Step 3: Implement a single row-end menu and quiet merge metadata**

Append missing-source and merge metadata to the summary so it remains visible at every viewport, then replace both current merged-action branches with one menu:

```tsx
<span className="missed-row-summary">
  {item.missingSourceId ? (
    <>
      <span className="missed-row-missing">来源记录已删除</span>
      <span aria-hidden="true"> · </span>
    </>
  ) : null}
  <span>{strategyName}</span>
  <span aria-hidden="true"> · </span>
  <span>{missReason}</span>
  <span aria-hidden="true"> · </span>
  <span>{primary.ref}</span>
  {merged ? (
    <>
      <span aria-hidden="true"> · </span>
      <span className="missed-row-relation">关联 {caseCount} 个案例</span>
    </>
  ) : null}
</span>

{merged ? (
  <span className="missed-row-menu">
    <Menu
      align="right"
      trigger={(
        <button
          type="button"
          data-trade-primary-action
          aria-label={`更多操作：${primary.symbol}`}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      )}
      options={menuOptions}
      onSelect={openMenuTarget}
    />
  </span>
) : null}
```

Keep the ordinary full-row overlay. Give the row itself `aria-label={`${primary.symbol}，${sideLabel}，${SOURCE_LABELS[item.source]}，${fmtDate(item.occurredAt)}`}`; visible source text remains in the row.

- [ ] **Step 4: Replace row CSS with workbench-aligned metrics**

Implement these exact structural rules while using existing color and spacing tokens:

```css
.missed-row {
  position: relative;
  display: grid;
  grid-template-areas: 'source symbol side summary time actions';
  grid-template-columns: 72px minmax(108px, 0.8fr) 48px minmax(180px, 1.7fr) 76px 32px;
  align-items: center;
  column-gap: var(--sp-2);
  min-width: 0;
  height: 44px;
  padding: 0 16px;
  color: var(--list-text-secondary);
  font-family: var(--font-ui);
  font-size: var(--fs-mini);
  border-bottom: 1px solid var(--border-subtle);
  isolation: isolate;
}

.missed-row:hover,
.missed-row.is-focused {
  background: var(--bg-hover);
}

.missed-row:has(.missed-row-open:focus-visible),
.missed-row:has(.missed-row-menu button:focus-visible) {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 44%, transparent);
}

.missed-row-menu button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: var(--text-tertiary);
  border-radius: var(--radius-6);
}

.missed-row-symbol strong {
  color: var(--text-primary);
  font-size: var(--fs-sm);
  font-weight: var(--font-weight-medium);
}

.missed-row-side.is-long {
  color: color-mix(in srgb, var(--pos) 82%, var(--text-secondary));
}

.missed-row-side.is-short {
  color: color-mix(in srgb, var(--neg) 82%, var(--text-secondary));
}
```

Remove purple outline/border styling, separate `.missed-row-actions` and `.missed-row-mobile-menu` blocks, and all page-specific large bordered row buttons.

- [ ] **Step 5: Implement the single mobile row layout**

Use one two-row grid at `max-width: 768px`:

```css
@media (max-width: 768px) {
  .missed-row {
    grid-template-areas:
      'symbol side time actions'
      'source summary summary actions';
    grid-template-columns: minmax(0, 1fr) 42px minmax(64px, auto) 44px;
    grid-template-rows: 28px 28px;
    min-height: 68px;
    height: 68px;
    padding: 6px 12px;
  }

  .missed-row-menu button {
    width: 44px;
    height: 44px;
  }
}
```

Keep summary single-line ellipsis, including `来源记录已删除` and `关联 N 个案例`; do not use a two-line clamp that expands row height.

- [ ] **Step 6: Run focused tests and build**

Run: `pnpm typecheck && node scripts/run-regression-tests.mjs && node scripts/run-browser-tests.mjs . vite.config.ts && pnpm build`

Expected: PASS; ordinary rows remain full-row clickable, merged rows navigate only through one visible menu, and the build has no type or bundle-budget regression.

- [ ] **Step 7: Commit the row unification**

```bash
git add src/components/trades/MissedOpportunityRow.tsx src/views/MissedOpportunitiesView.css src/views/MissedOpportunitiesView.browser.test.tsx src/regression.test.ts
git commit -m "fix: unify missed opportunity row interactions"
```

---

### Task 4: Lock responsive layout, states, and accessibility in automated QA

**Files:**
- Modify: `src/views/MissedOpportunitiesView.css:1-426`
- Modify: `src/views/MissedOpportunitiesView.browser.test.tsx:316-670`
- Modify: `scripts/qa-missed-opportunities.mjs:1-215`

**Interfaces:**
- Consumes: final toolbar/menu/row DOM from Tasks 2–3 and the existing visual fixture query `?visual=mobile`.
- Produces: Playwright QA for 375×812, 768×1024, 1280×800 and 1920×1080; no production API changes.

- [ ] **Step 1: Add failing QA helpers for all approved viewports**

Replace the single viewport constant with:

```js
const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'wide', width: 1920, height: 1080 },
]

async function assertNoHorizontalOverflow(page, viewport) {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
  }))
  assert.ok(metrics.documentWidth <= metrics.documentClientWidth, `${viewport.name} document 不得横向溢出`)
  assert.ok(metrics.bodyWidth <= metrics.bodyClientWidth, `${viewport.name} body 不得横向溢出`)
}
```

For every viewport, assert one toolbar row, visible scope/filter triggers, stable list area and no browser diagnostics. At 1280/1920 assert row height is 44px; at 375 assert 64–72px and both tool buttons are at least 44px high.

- [ ] **Step 2: Add state and focus assertions before final CSS adjustments**

Add browser assertions that:

```ts
assert(document.querySelector('.missed-empty h2')?.textContent?.trim() === '所选工作区暂无错过记录', '来源空状态标题不准确')
assert(document.body.textContent?.includes('没有符合当前筛选的机会') ?? false, '筛选零结果文案不准确')
assert(scopeOption('交易日志').getAttribute('aria-checked') === 'true', '范围选中态缺少 aria-checked')
assert(scopeTrigger().getAttribute('aria-expanded') === 'true', '范围打开态缺少 aria-expanded')
```

Also assert that the scope panel receives focus on open, `Escape` closes it, focus returns to the trigger, and every visible row menu has a non-empty accessible name.

- [ ] **Step 3: Run mobile QA and confirm new multi-viewport checks expose remaining layout defects**

Run: `pnpm qa:missed-opportunities`

Expected: FAIL on at least one newly introduced toolbar, row-height or touch-target assertion until final responsive CSS is applied.

- [ ] **Step 4: Finish toolbar, empty-state, panel and reduced-motion CSS**

Apply the final page-level rules:

```css
.missed-view > .ui-filter-shell .ui-filter-bar {
  padding-right: 16px;
  padding-left: 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.missed-scope-trigger,
.missed-view > .ui-filter-shell .ui-filter-trigger {
  height: var(--field-height-md);
}

.missed-results-heading {
  flex: 0 0 auto;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--fs-mini);
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
}

.missed-empty {
  display: grid;
  align-content: center;
  justify-items: center;
  min-height: 100%;
  padding: 32px 16px;
  text-align: center;
}

@media (max-width: 768px) {
  .missed-view > .ui-filter-shell .ui-filter-bar {
    min-height: 56px;
    padding-right: 12px;
    padding-left: 12px;
    flex-wrap: nowrap;
  }

  .missed-scope-trigger,
  .missed-view > .ui-filter-shell .ui-filter-trigger {
    min-width: 44px;
    height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .missed-scope-popover,
  .missed-row,
  .missed-scope-trigger {
    animation: none;
    transition: none;
  }
}
```

Ensure `.ui-active-filters` is the only horizontally scrollable toolbar subsection and never forces `.ui-filter-actions` off screen. Use the existing design tokens for all colors, borders, radii and shadows.

- [ ] **Step 5: Run focused QA at all target widths**

Run: `pnpm qa:missed-opportunities && node scripts/run-browser-tests.mjs . vite.config.ts && pnpm typecheck`

Expected: PASS at all four viewports with zero console/page errors, no horizontal overflow, correct row heights and complete keyboard coverage.

- [ ] **Step 6: Commit the responsive and accessibility lock**

```bash
git add src/views/MissedOpportunitiesView.css src/views/MissedOpportunitiesView.browser.test.tsx scripts/qa-missed-opportunities.mjs
git commit -m "test: lock missed opportunity responsive design"
```

---

### Task 5: Perform full regression and rendered design review

**Files:**
- Modify only if evidence exposes a defect: files already listed in Tasks 1–4.
- Evidence: `%TEMP%/missed-opportunity-visual-unification/`
- Report: `C:/Users/Yunko/.gstack/projects/Trader-Atlas/designs/2026-07-30-missed-opportunity-visual-unification.md`

**Interfaces:**
- Consumes: final implementation and the visual matrix from the approved design spec.
- Produces: green full test/build evidence, before/after screenshots, design-review report and a clean worktree.

- [ ] **Step 1: Run the complete automated gate**

Run: `pnpm test && pnpm build && pnpm qa:missed-opportunities`

Expected: all commands exit 0; no regression in aggregation, sidebar count, source persistence, filtering, navigation, return focus or mobile safe area.

- [ ] **Step 2: Start an isolated production preview**

Run:

```powershell
$env:ATLAS_VISUAL_PORT='4174'
pnpm preview --host 127.0.0.1 --port $env:ATLAS_VISUAL_PORT
```

Expected: preview serves the built application at `http://127.0.0.1:4174` without changing the existing 4173 audit server.

- [ ] **Step 3: Capture the approved visual matrix from real rendering**

Capture and inspect:

```text
1920×1080 — populated page, range menu closed and open
1280×800  — populated page with long summary and three-digit count
768×1024  — active filters and range menu
375×812   — top rows, bottom row above mobile navigation, merged row menu
1280×800  — selected sources contain no records
1280×800  — temporary filters return no result
```

Save PNGs under `%TEMP%/missed-opportunity-visual-unification/` with names such as `desktop-populated-after.png`, `desktop-scope-after.png`, `tablet-filters-after.png`, and `mobile-after.png`.

- [ ] **Step 4: Compare against adjacent workbench pages and fix only evidenced defects**

At the same 1920×1080 and 1280×800 viewports, compare `/missed` against `/list` and `/sim` for:

```text
Topbar height and typography
16px desktop page inset / 12px mobile inset
Toolbar control height and border/radius
44px desktop row rhythm
Hover and focus-visible treatment
Secondary text and direction semantic colors
Centered empty-state composition
WCAG AA contrast: body text ≥ 4.5:1; focus indicators and control boundaries ≥ 3:1
```

If a mismatch is found, write a failing regression/browser assertion first, apply the smallest CSS or component fix, rerun the focused test, and commit one finding per commit with `fix: ...`.

- [ ] **Step 5: Write the rendered design-review report**

Create the external report with:

```markdown
# Missed Opportunity Visual Unification Review

## Status
Use `DONE` only when every automated and rendered check passes. Otherwise use `DONE_WITH_CONCERNS` and list each unresolved item with severity and screenshot evidence.

## Evidence
- before screenshot paths
- after screenshot paths
- inspected viewport matrix

## Verified
- topbar and toolbar consistency
- scope menu flow
- row hierarchy and action flow
- empty/filter states
- keyboard, focus and touch targets
- responsive overflow and safe area

## Remaining concerns
- Write `None` when all approved checks pass; otherwise record exact severity and evidence for every concern.
```

- [ ] **Step 6: Verify UTF-8, diff hygiene and worktree state**

Run:

```powershell
git diff --check
rg -n "FIXME|XXX" src docs/superpowers/plans/2026-07-30-missed-opportunity-visual-unification.md
git status --short
```

Expected: `git diff --check` is clean; placeholder scan has no implementation placeholders; only intentional report/evidence metadata or no files remain uncommitted.

- [ ] **Step 7: Commit final evidence-linked corrections if needed**

```bash
git add src/components/ui/FilterBar.tsx src/components/ui/FilterBar.css src/components/trades/MissedOpportunityScopeMenu.tsx src/components/trades/MissedOpportunityFilters.tsx src/components/trades/MissedOpportunityRow.tsx src/views/MissedOpportunitiesView.tsx src/views/MissedOpportunitiesView.css src/views/MissedOpportunitiesView.browser.test.tsx src/regression.test.ts scripts/qa-missed-opportunities.mjs
git commit -m "fix: align missed opportunity visual details"
```

Skip this commit when the rendered review finds no additional defects. Do not combine unrelated changes from the primary worktree.

---

## Completion Criteria

- The page starts with the shared Topbar and one compact toolbar, not a settings panel.
- `全部机会 N`, active filters, `范围 · N`, and `筛选` remain on one line at all required widths.
- The range menu supports immediate multi-selection, raw source counts, last-source protection, outside click, `Escape`, and focus restoration.
- Desktop rows are 44px; mobile rows are 64–72px with 44px actions.
- Symbol is the primary row focus; source, summary, relationship and date are visually secondary.
- Ordinary rows open their unique source; merged rows use one predictable menu for original and case targets.
- Empty data, filter-zero, hover, focus-visible, pressed and disabled states use existing tokens and copy. The page derives synchronously from the already-hydrated local store and exposes no page-level loading/error channel, so the implementation must not invent false loading or error UI; any future real loading/error signal must use the same workbench state container.
- Existing aggregation, count, URL filter, sidebar, navigation and return-anchor tests remain green.
- Full test, build, focused QA and real-rendered design review pass with a clean worktree.
