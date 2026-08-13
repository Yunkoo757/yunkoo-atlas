# Trader Atlas Desktop Visual System Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Trader Atlas 的 Windows/macOS 客户端收敛为一套极简、克制、专业且高密度的桌面视觉系统，并以真实 Electron 页面证据证明所有核心路由、状态和窗口档位的一致性。

**Architecture:** 先建立隔离资料库和固定视口的可重复视觉基线，再以 Primitive → Semantic → Component 三层令牌驱动共享原语，随后按页面原型重排信息层级。每一批保持现有领域数据和事件处理不变，使用静态契约、聚焦回归、同尺寸截图和 Electron 桌面旅程形成红绿闭环。

**Tech Stack:** React 18、TypeScript 5.6、Vite 8、Electron 43、原生 CSS、Zustand、Playwright、Node test runner、Lucide React、Geist Sans、JetBrains Mono。

## Global Constraints

- 只支持 Windows 客户端与 macOS 客户端；不新增手机、iPad、浏览器产品或触摸优先适配。
- 所有读写使用 UTF-8，保存为 UTF-8 无 BOM，保留全部中文和非 ASCII 字符。
- 保留 React、CSS、路由、Electron、Zustand 和资料库架构；不迁移框架，不新增纯装饰运行时依赖。
- 不改变交易统计口径、持久化 schema 或领域事实；页面只重排已有数据与动作。
- 保留盈亏、风险、警告、错过和收藏的业务语义色；强调色只表达焦点、选中和主动作。
- 支持窗口矩阵：960×640、1280×860、1440×900、1600×1000、1920×1080。
- 浏览器/Playwright 只用于 Electron 渲染层内部回归；最终产品结论必须分别有 Windows 与 macOS Electron 证据。
- 每个任务只暂存列出的文件；不得恢复、覆盖或提交工作区现有的文档删除改动。
- 所有实现遵循红—绿—重构；每个任务结束前运行所列聚焦验证并独立提交。

---

## File and responsibility map

### Baseline and governance

- Create `scripts/qa-desktop-visual.mjs`: 启动隔离开发客户端、播种固定资料、按矩阵采集截图与结构指标。
- Create `scripts/desktop-visual-scenarios.mjs`: 唯一路由、视口、状态和截图清单。
- Create `scripts/fixtures/desktop-visual-matrix.test.mjs`: 验证矩阵完整、只含桌面视口、报告字段稳定。
- Modify `package.json`: 暴露 `qa:desktop-visual` 与 `qa:desktop-visual:electron`。
- Modify `scripts/qa-design-contract.mjs`: 把旧的移动端契约替换为桌面视觉契约。

### Visual system

- Modify `src/styles/tokens.css`: Primitive、Semantic、Component 三层 canonical token。
- Modify `src/styles/global.css` and `src/main.tsx`: Geist Sans、本地 CJK 回退、正文/数据/元数据角色。
- Modify `src/icons/iconSize.ts`: 与 CSS 一致的 14/16/18/20/24px 图标阶梯。
- Create/modify UI primitives in `src/components/ui`: Button、IconButton、SegmentedControl、FieldTrigger、PopoverSurface、InlineStatus。
- Modify `src/components/Toast.tsx`, `src/components/Toast.css`, `src/lib/toast.ts`: 类型化队列与持久错误语义。

### Desktop shell and interaction

- Modify `src/components/ui/AppFrame.*`, `src/components/Sidebar.*`, `src/components/Topbar.*`, `src/components/ui/Toolbar.*`, `src/App.tsx`: 标准/紧凑桌面侧栏、稳定顶栏、移除产品路径中的 MobileNavigation。
- Modify `src/components/ContextMenu.*`, `src/components/ui/DatePicker.*`, custom modal files: 完整桌面键盘和焦点合同。
- Modify `src/lib/windowBounds.*`, `electron/windowPresence.*`, `electron/main.ts`: 可见窗口恢复与 Windows/macOS 原生关闭语义。

### Page prototypes

- Modify `src/views/Dashboard.*`: 当前范围优先的分析页。
- Modify `src/views/WeeklyReviewView.*`: 连续章节、完成度摘要、首错聚焦和 sticky action rail。
- Modify `src/views/DetailView.*`, `src/components/trades/TradeDetailLayout.*`: 正文优先、336px 属性栏和标准完成动作。
- Modify `src/views/TodayWorkspace.*`, `src/components/trades/TradeList.*`, workbench empty state files: 动态任务标题、列标题和单主动作空态。
- Modify `src/views/ReviewSessionView.*`: 内容自适应的专注复盘。
- Modify settings and system state files: 统一设置轨道、状态页和系统反馈。

### Verification

- Extend existing `*.design.test.ts`, `designAudit*.test.ts`, `*.browser.test.tsx` files with exact visual contracts.
- Create `.gstack/qa-reports/desktop-visual-convergence/` runtime evidence only through QA scripts; generated images/reports are evidence, not product source.

---

### Task 1: Establish the reproducible desktop visual baseline

**Files:**
- Create: `scripts/desktop-visual-scenarios.mjs`
- Create: `scripts/qa-desktop-visual.mjs`
- Create: `scripts/fixtures/desktop-visual-matrix.test.mjs`
- Modify: `package.json`
- Modify: `ux-audit/seed-data.mjs`

**Interfaces:**
- Produces: `DESKTOP_VISUAL_VIEWPORTS`, `DESKTOP_VISUAL_SCENARIOS`, `runDesktopVisualQa(options)`.
- Produces report: `.gstack/qa-reports/desktop-visual-convergence/report.json` with `build`, `runtime`, `viewport`, `scenario`, `screenshot`, `consoleErrors`, `pageErrors`, `metrics`.
- Consumes existing `createUxSeedSnapshot()` without touching the real Electron library.

- [ ] **Step 1: Write the matrix contract test**

```js
// scripts/fixtures/desktop-visual-matrix.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { DESKTOP_VISUAL_VIEWPORTS, DESKTOP_VISUAL_SCENARIOS } from '../desktop-visual-scenarios.mjs'

test('desktop visual matrix owns every supported window and core route', () => {
  assert.deepEqual(DESKTOP_VISUAL_VIEWPORTS, [
    { width: 960, height: 640 },
    { width: 1280, height: 860 },
    { width: 1440, height: 900 },
    { width: 1600, height: 1000 },
    { width: 1920, height: 1080 },
  ])
  assert.deepEqual(
    DESKTOP_VISUAL_SCENARIOS.map(({ id, path }) => [id, path]),
    [
      ['today', '/today-record'],
      ['trades', '/list'],
      ['detail', '/trade/TRD-131'],
      ['dashboard', '/dashboard'],
      ['weekly', '/weekly-review'],
      ['review-session', '/review-session'],
      ['settings-data', '/settings/data'],
    ],
  )
})

test('desktop visual matrix contains no mobile product viewport', () => {
  assert.equal(DESKTOP_VISUAL_VIEWPORTS.some(({ width }) => width < 960), false)
})
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `node --test scripts/fixtures/desktop-visual-matrix.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `desktop-visual-scenarios.mjs`.

- [ ] **Step 3: Implement the scenario manifest**

```js
// scripts/desktop-visual-scenarios.mjs
export const DESKTOP_VISUAL_VIEWPORTS = Object.freeze([
  { width: 960, height: 640 },
  { width: 1280, height: 860 },
  { width: 1440, height: 900 },
  { width: 1600, height: 1000 },
  { width: 1920, height: 1080 },
])

export const DESKTOP_VISUAL_SCENARIOS = Object.freeze([
  { id: 'today', path: '/today-record', ready: '.today-workspace-inner' },
  { id: 'trades', path: '/list', ready: '.trade-list' },
  { id: 'detail', path: '/trade/TRD-131', ready: '.dv-layout' },
  { id: 'dashboard', path: '/dashboard', ready: '.db-scroll' },
  { id: 'weekly', path: '/weekly-review', ready: '.wr-shell' },
  { id: 'review-session', path: '/review-session', ready: '.review-session-shell' },
  { id: 'settings-data', path: '/settings/data', ready: '.settings-layout' },
])
```

Implement `qa-desktop-visual.mjs` by reusing the isolated Vite/IndexedDB boot pattern from `ux-audit/run-ux-audit.mjs`: start on `127.0.0.1`, seed `createUxSeedSnapshot()`, wait for `data-ui-settled=1`, capture each scenario/viewport, collect `documentElement.scrollWidth`, visible primary actions, main bounds, console errors and page errors, then write UTF-8 JSON.

- [ ] **Step 4: Add explicit scripts**

```json
"qa:desktop-visual": "node scripts/qa-desktop-visual.mjs --renderer",
"qa:desktop-visual:electron": "node scripts/qa-desktop-visual.mjs --electron"
```

The Electron mode must use a temporary `userData` directory and temporary library fixture; it must reject startup if either path resolves inside the real application data directory.

- [ ] **Step 5: Run GREEN and collect the untouched baseline**

Run:

```powershell
node --test scripts/fixtures/desktop-visual-matrix.test.mjs
pnpm qa:desktop-visual
```

Expected: both exit 0; report contains 35 renderer screenshots, zero console/page errors, and records current overflow rather than treating expected pre-redesign imbalances as pass/fail.

- [ ] **Step 6: Commit**

```powershell
git add package.json scripts/desktop-visual-scenarios.mjs scripts/qa-desktop-visual.mjs scripts/fixtures/desktop-visual-matrix.test.mjs ux-audit/seed-data.mjs
git commit -m "test: establish desktop visual baseline"
```

---

### Task 2: Converge tokens, typography, icon sizes, and motion

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`
- Modify: `src/main.tsx`
- Modify: `src/icons/iconSize.ts`
- Create: `src/lib/desktopVisualTokens.test.ts`
- Modify: `src/lib/designAuditSystemCompletion.test.ts`
- Modify: `scripts/qa-design-contract.mjs`

**Interfaces:**
- Produces CSS tokens: `--font-ui`, `--type-body-*`, `--type-data-*`, `--type-metadata-*`, `--icon-sm/md/lg/xl/2xl`, `--control-height-sm/md/lg`, `--motion-state/menu/dialog-in/dialog-out/panel`, `--surface-app/pane/inset/floating`.
- Produces TS constants: `ICON_SM=14`, `ICON_MD=16`, `ICON_LG=18`, `ICON_XL=20`, `ICON_2XL=24`.

- [ ] **Step 1: Write failing token contracts**

```ts
// src/lib/desktopVisualTokens.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

export async function testDesktopVisualTokensExposeCanonicalRoles(): Promise<void> {
  const css = await fs.readFile('src/styles/tokens.css', 'utf8')
  for (const token of [
    '--type-body-size: 0.9375rem', '--type-data-size: 0.8125rem',
    '--type-metadata-size: 0.75rem', '--icon-sm: 14px', '--icon-md: 16px',
    '--icon-lg: 18px', '--icon-xl: 20px', '--icon-2xl: 24px',
    '--control-height-sm: 28px', '--control-height-md: 32px', '--control-height-lg: 36px',
    '--motion-state: 100ms', '--motion-dialog-in: 150ms', '--motion-panel: 220ms',
  ]) assert(css.includes(token), `missing ${token}`)
}

export async function testUiFontUsesBundledGeistAndCjkFallbacks(): Promise<void> {
  const [main, tokens] = await Promise.all([
    fs.readFile('src/main.tsx', 'utf8'),
    fs.readFile('src/styles/tokens.css', 'utf8'),
  ])
  assert(main.includes("@fontsource/geist-sans/400.css"))
  assert(main.includes("@fontsource/geist-sans/500.css"))
  assert(main.includes("@fontsource/geist-sans/600.css"))
  assert(tokens.includes('"Geist Sans"'))
  assert(tokens.includes('"PingFang SC"') && tokens.includes('"Microsoft YaHei"'))
}
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/desktopVisualTokens.test.ts`

Expected: FAIL for missing canonical roles and Geist imports.

- [ ] **Step 3: Implement canonical tokens and compatibility aliases**

In `tokens.css`, organize headings as Primitive, Semantic and Component. Add the exact values above, map existing names to canonical roles for one migration cycle, replace `--header-h: 43.5714px` with `--header-height: 44px`, and map `--header-h` to it temporarily. Define `--skeleton-highlight` and replace every `var(--bg-active)` use.

In `main.tsx`, replace `@fontsource-variable/inter` with Geist 400/500/600 imports. Do not remove the installed Inter package until Task 13 proves it is unused.

Update `iconSize.ts` to the five approved sizes; map `ICON_HERO` to `ICON_2XL` only where the visual result is still legible, otherwise use a named illustration constant outside the control icon scale.

- [ ] **Step 4: Replace obsolete tests instead of preserving mobile contracts**

Remove assertions that require `pointer: coarse`, 44px touch targets, safe-area insets, or MobileNavigation. Add assertions that reject new component-level raw colors, reject undefined custom properties, and require desktop token roles.

- [ ] **Step 5: Run GREEN and design contract**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/desktopVisualTokens.test.ts src/lib/designAuditSystemCompletion.test.ts
pnpm qa:design
pnpm typecheck
```

Expected: all exit 0; no `--bg-active`; no UTF-8 replacement characters.

- [ ] **Step 6: Capture typography delta at 1440×900**

Run: `pnpm qa:desktop-visual`

Inspect today, trades, detail and settings screenshots. Reject the task if Chinese text clips, the 44px trade row wraps, or a toolbar control overflows.

- [ ] **Step 7: Commit**

```powershell
git add src/styles/tokens.css src/styles/global.css src/main.tsx src/icons/iconSize.ts src/lib/desktopVisualTokens.test.ts src/lib/designAuditSystemCompletion.test.ts scripts/qa-design-contract.mjs
git commit -m "style: converge desktop visual tokens"
```

---

### Task 3: Complete Button, IconButton, and SegmentedControl primitives

**Files:**
- Modify: `src/components/ui/Button.tsx`
- Modify: `src/components/ui/Button.css`
- Move/Modify: `src/components/IconButton.tsx` → `src/components/ui/IconButton.tsx`
- Move/Modify: `src/components/IconButton.css` → `src/components/ui/IconButton.css`
- Create: `src/components/ui/SegmentedControl.tsx`
- Create: `src/components/ui/SegmentedControl.css`
- Create: `src/components/ui/DesktopControls.browser.test.tsx`
- Create: `src/components/ui/DesktopControls.browser.test.html`
- Modify imports in: `src/components/Topbar.tsx`, `src/views/DetailView.tsx`

**Interfaces:**
- Produces `Button({ variant, size: 'sm'|'md'|'lg', busy })`.
- Produces `IconButton({ label, tooltip, size: 'sm'|'md'|'lg', pressed, disabled })`.
- Produces `SegmentedControl<T>({ label, value, options, onChange, size })`.

- [ ] **Step 1: Write the browser contract**

```tsx
const root = createRoot(document.getElementById('root')!)
root.render(<>
  <Button size="sm">工具</Button><Button size="md">页面</Button><Button size="lg">完成</Button>
  <IconButton label="收藏" tooltip="收藏" pressed={false}><Star /></IconButton>
  <SegmentedControl label="视图" value="list" options={[
    { value: 'list', label: '列表' }, { value: 'board', label: '看板' },
  ]} onChange={() => undefined} />
</>)

window.__desktopControlsTest = (async () => {
  const buttons = [...document.querySelectorAll<HTMLElement>('.ui-btn')]
  const heights = buttons.map((node) => Math.round(node.getBoundingClientRect().height))
  if (heights.join(',') !== '28,32,36') throw new Error(`button heights ${heights}`)
  if (!document.querySelector('[role="group"][aria-label="视图"]')) throw new Error('missing segmented group')
})()
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: requested entry is not discoverable until the HTML fixture exists, then compilation fails for missing primitives/props.

- [ ] **Step 3: Implement the primitives**

```tsx
export type ButtonSize = 'sm' | 'md' | 'lg'
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { size = 'md', variant = 'ghost', busy = false, disabled, children, ...rest }, ref,
) {
  return <button ref={ref} className={`ui-btn ui-btn-${variant} ui-btn-${size}`}
    aria-busy={busy || undefined} disabled={disabled || busy} {...rest}>{children}</button>
})
```

`IconButton` uses a real button, `aria-pressed` only when `pressed` is boolean, visible focus, and 28/32/36px containers. `SegmentedControl` renders `role=group`, real buttons, `aria-pressed`, arrow-key movement, hover and pressed styles. Do not make it a tablist unless it actually changes panels with tab semantics.

- [ ] **Step 4: Migrate Topbar and DetailView sample consumers**

Replace local 24–28px buttons and manual segmented markup with the primitives. Preserve existing navigation handlers and labels exactly.

- [ ] **Step 5: Run GREEN**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
pnpm qa:design
```

Expected: 28/32/36 heights, visible keyboard focus, zero browser diagnostics.

- [ ] **Step 6: Commit**

```powershell
git add src/components/ui/Button.tsx src/components/ui/Button.css src/components/ui/IconButton.tsx src/components/ui/IconButton.css src/components/ui/SegmentedControl.tsx src/components/ui/SegmentedControl.css src/components/ui/DesktopControls.browser.test.tsx src/components/ui/DesktopControls.browser.test.html src/components/Topbar.tsx src/views/DetailView.tsx
git commit -m "feat: unify desktop action controls"
```

---

### Task 4: Unify fields, popovers, context menus, and date keyboard behavior

**Files:**
- Create: `src/components/ui/FieldTrigger.tsx`
- Create: `src/components/ui/FieldTrigger.css`
- Create: `src/components/ui/PopoverSurface.tsx`
- Create: `src/components/ui/PopoverSurface.css`
- Modify: `src/components/ui/Select.tsx`
- Modify: `src/components/ui/Select.css`
- Modify: `src/components/ui/DatePicker.tsx`
- Modify: `src/components/ui/DatePicker.css`
- Modify: `src/components/ContextMenu.tsx`
- Modify: `src/components/ContextMenu.css`
- Create: `src/components/ui/DesktopPopoverKeyboard.browser.test.tsx`
- Create: `src/components/ui/DesktopPopoverKeyboard.browser.test.html`

**Interfaces:**
- Produces `FieldTrigger` shared visual shell.
- Produces `PopoverSurface({ kind: 'menu'|'tooltip'|'modal', labelledBy })`.
- Context menu consumes `items`, `anchor`, `onClose`, `restoreFocusRef` and owns roving focus.

- [ ] **Step 1: Write failing keyboard journeys**

Test exact sequences:

```ts
trigger.focus(); await user.keyboard('{Enter}')
assert.equal(document.activeElement?.getAttribute('role'), 'menuitem')
await user.keyboard('{ArrowDown}{End}{Home}{Escape}')
assert.equal(document.activeElement, trigger)

dateTrigger.focus(); await user.keyboard('{Enter}{ArrowRight}{ArrowDown}{Home}{End}{PageDown}{Escape}')
assert.equal(document.activeElement, dateTrigger)
```

The date test must assert only one calendar day has `tabIndex=0` and month navigation keeps the same day when possible.

- [ ] **Step 2: Run RED**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: FAIL because ContextMenu does not focus the first item and DatePicker exposes 42 Tab stops.

- [ ] **Step 3: Implement shared surfaces and roving focus**

Use `FieldTrigger` from both Select and DatePicker. Use `PopoverSurface kind="menu"` for Select/DatePicker/ContextMenu. ContextMenu root gets `role="menu"`; disabled items are skipped; Home/End and ArrowUp/Down wrap; Escape and selection close and restore focus.

DatePicker stores `activeDayKey`, renders one `tabIndex=0`, and implements the WAI-ARIA grid key map without changing date formatting or min/max rules.

- [ ] **Step 4: Remove duplicated surface values**

Replace component-selected border/radius/shadow declarations with `--popover-menu-*`, `--popover-tooltip-*`, and `--popover-modal-*`. Keep Tooltip's delay behavior unchanged.

- [ ] **Step 5: Run GREEN**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
pnpm test
```

Expected: keyboard journeys pass and no existing selection/date behavior regresses.

- [ ] **Step 6: Commit**

```powershell
git add src/components/ui/FieldTrigger.tsx src/components/ui/FieldTrigger.css src/components/ui/PopoverSurface.tsx src/components/ui/PopoverSurface.css src/components/ui/Select.tsx src/components/ui/Select.css src/components/ui/DatePicker.tsx src/components/ui/DatePicker.css src/components/ContextMenu.tsx src/components/ContextMenu.css src/components/ui/DesktopPopoverKeyboard.browser.test.tsx src/components/ui/DesktopPopoverKeyboard.browser.test.html
git commit -m "feat: unify desktop popover interactions"
```

---

### Task 5: Introduce typed feedback, inline status, and system-state primitives

**Files:**
- Modify: `src/lib/toast.ts`
- Modify: `src/components/Toast.tsx`
- Modify: `src/components/Toast.css`
- Create: `src/components/ui/InlineStatus.tsx`
- Create: `src/components/ui/InlineStatus.css`
- Modify: `src/components/EmptyState.tsx`
- Modify: `src/components/EmptyState.css`
- Modify: `src/components/SaveStatusIndicator.tsx`
- Modify: `src/components/SaveStatusIndicator.css`
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Create: `src/lib/toastQueue.test.ts`

**Interfaces:**
- Produces `toast(message, { tone, actionLabel, onAction, persistent, dedupeKey })`.
- Produces FIFO state `{ items: ToastItem[] }`, max 3 visible/queued items, error persistent by default.
- Produces `createToastStore(): ToastStore`; `ToastStore` exposes `push`, `dismiss`, `getState` and `subscribe`. Unit tests instantiate this factory directly; no test-only global singleton is added.
- Produces `InlineStatus({ tone, title, detail, action })`.

- [ ] **Step 1: Write queue and severity tests**

```ts
export function testToastQueuePreservesErrorsAndDeduplicates(): void {
  const store = createToastStore()
  store.push('保存失败', { tone: 'error', dedupeKey: 'save' })
  store.push('链接已复制', { tone: 'success' })
  store.push('仍然失败', { tone: 'error', dedupeKey: 'save' })
  assert.deepEqual(store.getState().items.map((item) => [item.message, item.tone]), [
    ['仍然失败', 'error'], ['链接已复制', 'success'],
  ])
  assert.equal(store.getState().items[0].persistent, true)
}
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/toastQueue.test.ts`

Expected: FAIL because the current store owns a single message and no tone.

- [ ] **Step 3: Implement queue and accessible host**

Error items use `role=alert`/assertive; other tones use `role=status`/polite. Render semantic Lucide icons, close control for persistent messages, and action control using Button sm. Do not replace page-local validation with Toast.

- [ ] **Step 4: Replace system-level custom drawings**

Use `InlineStatus` and named status icons for storage error, close-save receipt and SaveStatus. Replace CSS-generated check/exclamation glyphs. Keep all existing retry, dismiss, safe-save and data-management callbacks.

- [ ] **Step 5: Refine empty-state variants**

Add `variant: 'first-use'|'filtered'|'missing'|'complete'`. Only `first-use` uses the large illustration; `filtered` is compact and places one primary action before text actions.

- [ ] **Step 6: Run GREEN**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/toastQueue.test.ts
pnpm typecheck
pnpm test
```

Expected: FIFO/dedupe/persistence pass, existing undo action still works, zero TypeScript errors.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/toast.ts src/components/Toast.tsx src/components/Toast.css src/components/ui/InlineStatus.tsx src/components/ui/InlineStatus.css src/components/EmptyState.tsx src/components/EmptyState.css src/components/SaveStatusIndicator.tsx src/components/SaveStatusIndicator.css src/App.tsx src/App.css src/lib/toastQueue.test.ts
git commit -m "feat: unify desktop feedback states"
```

---

### Task 6: Replace mobile product chrome with a compact desktop shell

**Files:**
- Modify: `src/components/ui/AppFrame.tsx`
- Modify: `src/components/ui/AppFrame.css`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Sidebar.css`
- Modify: `src/components/sidebar/SidebarWorkspace.css`
- Modify: `src/components/Topbar.tsx`
- Modify: `src/components/Topbar.css`
- Modify: `src/components/ui/Toolbar.tsx`
- Modify: `src/components/ui/Toolbar.css`
- Modify: `src/App.tsx`
- Delete: `src/components/MobileNavigation.tsx`
- Delete: `src/components/MobileNavigation.css`
- Create: `src/components/DesktopShell.browser.test.tsx`
- Create: `src/components/DesktopShell.browser.test.html`
- Modify affected fixtures: `src/components/CommandPalette.browser.test.tsx`, `src/views/MissedOpportunitiesView.browser.test.tsx`

**Interfaces:**
- `AppFrame({ sidebar, children })`; removes `mobileNavigation`.
- Sidebar exposes `data-density="standard|compact|collapsed"`; standard ≥1100 app width, compact 960–1099, collapsed only by explicit user action.
- Toolbar exposes one visible overflow trigger when actions do not fit.

- [ ] **Step 1: Write desktop shell contracts at 960 and 1440**

```tsx
window.__desktopShellTest = (async () => {
  const sidebar = document.querySelector<HTMLElement>('.sidebar')!
  const main = document.querySelector<HTMLElement>('.ui-main-frame')!
  if (innerWidth === 960 && sidebar.dataset.density !== 'compact') throw new Error('960 must be compact')
  if (innerWidth === 1440 && sidebar.dataset.density !== 'standard') throw new Error('1440 must be standard')
  if (getComputedStyle(document.querySelector('.ui-mobile-navigation') ?? document.body).display !== 'none') {
    throw new Error('mobile product chrome rendered')
  }
  if (main.scrollWidth > main.clientWidth) throw new Error('main shell overflows')
})()
```

HTML metadata: `<meta name="atlas-browser-viewports" content="960x640,1440x900,1920x1080">`.

- [ ] **Step 2: Run RED**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: FAIL because 960 hides the sidebar and renders MobileNavigation.

- [ ] **Step 3: Implement standard and compact density**

Use CSS container/application width rules: 244px standard, 208px compact, 56px explicit collapsed. Preserve nav labels in compact mode. Replace rainbow active icons with one accent treatment and fix `.sb-item:focus-visible` to use the global focus frame.

- [ ] **Step 4: Remove MobileNavigation from product and fixtures**

Remove import/prop/rendering from App and AppFrame, delete component files, and update browser fixtures to render the desktop shell. Remove safe-area padding and bottom-chrome offsets that only existed for the deleted navigation.

- [ ] **Step 5: Add toolbar overflow instead of hidden horizontal scroll**

Keep primary and current-context actions visible; move remaining actions into a labelled `更多操作` menu at 960px. The action must remain keyboard reachable and use ContextMenu/Menu keyboard behavior.

- [ ] **Step 6: Run GREEN and baseline matrix**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
pnpm qa:desktop-visual
```

Expected: 960/1440/1920 shell screenshots show desktop navigation, no main horizontal overflow, one visible focus indication.

- [ ] **Step 7: Commit**

```powershell
git add -A src/components/ui/AppFrame.tsx src/components/ui/AppFrame.css src/components/Sidebar.tsx src/components/Sidebar.css src/components/sidebar/SidebarWorkspace.css src/components/Topbar.tsx src/components/Topbar.css src/components/ui/Toolbar.tsx src/components/ui/Toolbar.css src/App.tsx src/components/MobileNavigation.tsx src/components/MobileNavigation.css src/components/DesktopShell.browser.test.tsx src/components/DesktopShell.browser.test.html src/components/CommandPalette.browser.test.tsx src/views/MissedOpportunitiesView.browser.test.tsx
git commit -m "feat: establish compact desktop shell"
```

---

### Task 7: Make window restoration and platform close behavior native

**Files:**
- Modify: `src/lib/windowBounds.ts`
- Modify: `src/lib/windowBounds.test.ts`
- Modify: `electron/windowPresence.ts`
- Modify: `electron/windowPresence.test.ts`
- Modify: `electron/main.ts`
- Modify: `src/views/settings/DisplaySettingsPanel.tsx`
- Modify: `src/views/settings/DisplaySettingsPanel.css`

**Interfaces:**
- Produces `fitBoundsToWorkArea(saved, workAreas, minimum): WindowBounds`.
- Windows close policy: first close explains background/tray and persists explicit choice.
- macOS close policy: close window, keep Dock; quit only through Cmd+Q/application menu.

- [ ] **Step 1: Add failing window fit tests**

```ts
export function testRestoredWindowFitsSmallerWorkAreaAndKeepsTitleBarVisible(): void {
  assert.deepEqual(
    fitBoundsToWorkArea(
      { x: 1600, y: 0, width: 1920, height: 1080 },
      [{ x: 0, y: 0, width: 1366, height: 768 }],
      { width: 960, height: 640 },
    ),
    { x: 0, y: 0, width: 1366, height: 768 },
  )
}
```

Add tests that macOS hide does not call `dock.hide()` and Windows first close emits a renderer explanation event.

- [ ] **Step 2: Run RED**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/windowBounds.test.ts electron/windowPresence.test.ts`

Expected: window remains oversized/partly offscreen and macOS dock behavior assertion fails.

- [ ] **Step 3: Implement workArea fitting and platform policy**

Clamp width/height to the selected workArea, clamp x/y so at least the full title bar is visible, retain minimum 960×640 only when the workArea permits it, and center as final fallback. Add a Windows first-close InlineStatus/dialog choice: “隐藏到托盘” and “彻底退出”, plus remember checkbox in display settings. Do not show this on macOS.

- [ ] **Step 4: Run GREEN and Electron safety tests**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/windowBounds.test.ts electron/windowPresence.test.ts electron/platformSafety.test.ts
pnpm typecheck
pnpm qa:electron
```

Expected: all pass; no real userData is accessed by QA.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/windowBounds.ts src/lib/windowBounds.test.ts electron/windowPresence.ts electron/windowPresence.test.ts electron/main.ts src/views/settings/DisplaySettingsPanel.tsx src/views/settings/DisplaySettingsPanel.css
git commit -m "fix: align desktop window presence"
```

---

### Task 8: Reorder Dashboard around the selected analysis scope

**Files:**
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/Dashboard.css`
- Create: `src/views/DashboardHierarchy.design.test.ts`
- Modify: `src/views/DashboardScope.browser.test.tsx`
- Modify: `src/views/DashboardScope.browser.test.html`

**Interfaces:**
- Current scope summary remains derived from existing `analysisScope`; no statistic formula changes.
- DOM order: controls → `.db-cards` → `.db-data-health` → main chart → `.db-week` → strategies.

- [ ] **Step 1: Write failing DOM-order and scope tests**

```ts
export async function testDashboardPresentsSelectedScopeBeforeWeekContext(): Promise<void> {
  const source = await fs.readFile('src/views/Dashboard.tsx', 'utf8')
  assert(source.indexOf('className="db-cards"') < source.indexOf("className={'db-week'"))
  const css = await fs.readFile('src/views/Dashboard.css', 'utf8')
  assert(!/\.db-week\s*\{[^}]*background:\s*color-mix\([^}]*accent/s.test(css))
}
```

Browser test sets `scope=all` and asserts the accessible current-range heading precedes “本周交易分析”.

- [ ] **Step 2: Run RED**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/DashboardHierarchy.design.test.ts`

Expected: FAIL because `.db-week` precedes `.db-cards` and has accent-tinted elevation.

- [ ] **Step 3: Reorder existing sections without changing calculations**

Split controls into labelled “数据范围” and “统计周期” groups using SegmentedControl/FieldTrigger. Render current scope KPI first, then completeness and curve, then a low-emphasis weekly context strip. Put cycle management in overflow; keep “查看交易” bordered/textual.

- [ ] **Step 4: Constrain wide-screen chart and KPI rhythm**

Use a 1240px analysis rail, 1200px chart cap, a single subtle emphasis on net P&L, aligned KPI baselines, and no four-card shadows.

- [ ] **Step 5: Run GREEN and screenshot matrix**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/views/DashboardHierarchy.design.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm qa:desktop-visual
```

Inspect dashboard at 960, 1440 and 1920. Reject if the selected-range result is not the first numeric conclusion or if the chart stretches beyond the capped rail.

- [ ] **Step 6: Commit**

```powershell
git add src/views/Dashboard.tsx src/views/Dashboard.css src/views/DashboardHierarchy.design.test.ts src/views/DashboardScope.browser.test.tsx src/views/DashboardScope.browser.test.html
git commit -m "style: prioritize dashboard scope"
```

---

### Task 9: Convert Weekly Review into a continuous, recoverable narrative

**Files:**
- Modify: `src/views/WeeklyReviewView.tsx`
- Modify: `src/views/WeeklyReviewView.css`
- Create: `src/lib/weeklyReviewVisualState.ts`
- Create: `src/lib/weeklyReviewVisualState.test.ts`
- Modify: `src/views/WeeklyReviewView.browser.test.tsx`
- Modify: `src/views/WeeklyReviewPresentation.browser.test.tsx`
- Modify: `src/views/WeeklyReviewRisk.design.test.ts`

**Interfaces:**
- Produces `getWeeklyVisualIssues(review): WeeklyVisualIssue[]` with `{ key, sectionId, fieldId, message }`.
- Produces `focusWeeklyIssue(issue)` via refs/data attributes.
- Sections expose `data-weekly-section` and `data-invalid`.

- [ ] **Step 1: Write failing visual-state unit tests**

```ts
export function testWeeklyIssuesReturnStableDocumentOrder(): void {
  const issues = getWeeklyVisualIssues({
    scoreExecution: null, scoreRisk: null, scoreEmotion: null,
    commitmentText: '', commitmentCriteria: '',
  } as WeeklyReview)
  assert.deepEqual(issues.map((issue) => issue.fieldId), [
    'score-execution', 'score-risk', 'score-emotion', 'commitment-text', 'commitment-criteria',
  ])
}
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyReviewVisualState.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement issue derivation and persistent summary**

Reuse the same business conditions currently passed to `toast(issue)`. On completion failure, set issues, render `InlineStatus tone="error"` near the top with linked items, mark all sections, call `scrollIntoView({ block: 'center' })`, then focus the first field. Clear an issue as its field becomes valid. Success still uses Toast.

- [ ] **Step 4: Replace equal cards with narrative sections**

Set page head and content to the same 920px rail. Facts, scores, patterns, evidence and judgment use border-top/spacing sections. Keep elevated containers only for risk exception, previous commitment and next commitment. Add a compact progress summary and a sticky bottom action rail inside `.wr-main`.

- [ ] **Step 5: Update browser tests**

Test: click completion with missing scores; assert error summary persists, all missing sections have `data-invalid=true`, first score owns focus, and no success Toast exists. Fill fields and assert completion succeeds and the rail remains visible at 960×640.

- [ ] **Step 6: Run GREEN and visual QA**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyReviewVisualState.test.ts src/views/WeeklyReviewRisk.design.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm qa:desktop-visual
```

Reject if page head/content rails differ, more than three sections retain card borders, or missing fields require scrolling without an index.

- [ ] **Step 7: Commit**

```powershell
git add src/views/WeeklyReviewView.tsx src/views/WeeklyReviewView.css src/lib/weeklyReviewVisualState.ts src/lib/weeklyReviewVisualState.test.ts src/views/WeeklyReviewView.browser.test.tsx src/views/WeeklyReviewPresentation.browser.test.tsx src/views/WeeklyReviewRisk.design.test.ts
git commit -m "style: clarify weekly review narrative"
```

---

### Task 10: Rebalance Trade Detail around review content

**Files:**
- Modify: `src/components/trades/TradeDetailLayout.tsx`
- Modify: `src/components/trades/TradeDetailLayout.css`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/views/DetailView.css`
- Create: `src/views/DetailVisualHierarchy.design.test.ts`
- Modify: `src/views/DetailShortcutNavigation.browser.test.tsx`
- Modify: `src/views/ReviewCompletion.browser.test.tsx`

**Interfaces:**
- Layout columns: `minmax(620px, 1fr) 336px`, 1px divider.
- Review state label and completion command are separate nodes.
- Editors expose `aria-label="复盘正文"` and `aria-label="补充追记"`.

- [ ] **Step 1: Write failing hierarchy contracts**

```ts
export async function testDetailUsesDesktopReviewHierarchy(): Promise<void> {
  const [layout, css, source] = await Promise.all([
    fs.readFile('src/components/trades/TradeDetailLayout.css', 'utf8'),
    fs.readFile('src/views/DetailView.css', 'utf8'),
    fs.readFile('src/views/DetailView.tsx', 'utf8'),
  ])
  assert(layout.includes('minmax(620px, 1fr) 336px'))
  assert(/\.dv-props\s*\{[^}]*border-left:\s*1px solid var\(--border-subtle\)/s.test(layout))
  assert(!/\.dv-editor[^}]*min-height:\s*240px/s.test(css))
  assert(source.includes('aria-label="复盘正文"') && source.includes('aria-label="补充追记"'))
}
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/DetailVisualHierarchy.design.test.ts`

Expected: FAIL on 360px column, missing divider, 240px minimum and missing labels.

- [ ] **Step 3: Implement layout and action hierarchy**

Use the 336px property rail, stable two-column property rows and collapsible low-priority groups. Replace the 26px completion pill with Button md/lg in the review content header/footer. Keep “已复盘” as InlineStatus/chip separate from the command. Use IconButton for star/more/previous/next without changing shortcuts or route state.

- [ ] **Step 4: Make short content compact and long content usable**

Use a modest 96px editable minimum, content-driven growth, clear section labels, and retain scrolling/asset behavior. At 960px compact shell, allow the property rail to become an in-pane drawer only if both 620px main and 336px rail cannot coexist; do not use mobile bottom sheets.

- [ ] **Step 5: Run GREEN**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/views/DetailVisualHierarchy.design.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm qa:desktop-visual
```

Inspect short and normal detail at 960/1440/1920; reject if properties dominate the first glance or completion is less visible than star/more.

- [ ] **Step 6: Commit**

```powershell
git add src/components/trades/TradeDetailLayout.tsx src/components/trades/TradeDetailLayout.css src/views/DetailView.tsx src/views/DetailView.css src/views/DetailVisualHierarchy.design.test.ts src/views/DetailShortcutNavigation.browser.test.tsx src/views/ReviewCompletion.browser.test.tsx
git commit -m "style: prioritize trade review content"
```

---

### Task 11: Add explainable columns and task-aware hierarchy to Today and Trade Log

**Files:**
- Modify: `src/views/TodayWorkspace.tsx`
- Modify: `src/views/TodayWorkspace.css`
- Modify: `src/views/TodayWorkspace.design.test.ts`
- Modify: `src/components/trades/TradeList.tsx`
- Modify: `src/components/trades/TradeList.css`
- Modify: `src/components/trades/WorkbenchEmptyState.tsx`
- Modify: `src/components/trades/WorkbenchEmptyState.css`
- Modify: `src/lib/workbenchEmptyState.ts`
- Modify: `src/lib/workbenchEmptyState.test.ts`
- Modify: `src/views/WorkbenchEmptyState.design.test.ts`

**Interfaces:**
- Produces `todayHeadingForTab(tab, counts)` with exact labels.
- Trade list exposes `.trade-list-columns` matching row grid columns.
- Empty-state model adds `primaryAction` and ordered `secondaryActions`.

- [ ] **Step 1: Write failing heading and empty-state tests**

```ts
export function testTodayHeadingFollowsActiveQueue(): void {
  assert.equal(todayHeadingForTab('all', { all: 10, open: 3, results: 1, review: 6 }), '还有 10 项需要处理')
  assert.equal(todayHeadingForTab('review', { all: 10, open: 3, results: 1, review: 6 }), '6 项待复盘')
  assert.equal(todayHeadingForTab('results', { all: 10, open: 3, results: 1, review: 6 }), '1 项等待结果')
}

export function testFirstUseHasOnePrimaryAction(): void {
  const state = resolveWorkbenchEmptyState({ libraryEmpty: true })
  assert.equal(state.primaryAction.id, 'create-trade')
  assert.deepEqual(state.secondaryActions.map((item) => item.id), ['import-backup', 'configure-strategy'])
}
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/workbenchEmptyState.test.ts src/views/TodayWorkspace.design.test.ts`

Expected: active-tab heading contract and one-primary-action model fail.

- [ ] **Step 3: Implement task-aware Today hierarchy**

Derive heading from the selected tab, move triggered risk summary before queue tabs, shorten repeated group explanations, and add a shared grid header labelled “周期 / 盈亏 / R / 日期”. Hide a column only at compact desktop width with an explicit remaining label, never by leaving unlabeled values.

- [ ] **Step 4: Implement sticky Trade Log columns**

Render `role="row"`/columnheader semantics with the same CSS grid variables as `.trade-row`. Keep month headers sticky below toolbar. Make starred state low-opacity visible; reveal selection on hover, focus-within or selection mode. Do not change virtualization math or row IDs.

- [ ] **Step 5: Implement single-primary empty states**

First use: one primary “新建第一笔交易”, two text/bordered secondary actions. Filtered empty: compact, no illustration, primary “清除筛选”. Workspace empty: context-specific create/navigate action without three equal buttons.

- [ ] **Step 6: Run GREEN and 10K guard**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/workbenchEmptyState.test.ts src/views/TodayWorkspace.design.test.ts src/views/WorkbenchEmptyState.design.test.ts
pnpm qa:dashboard-10k
pnpm qa:desktop-visual
```

Expected: headings/columns/empty states pass; virtualization performance stays within existing budget.

- [ ] **Step 7: Commit**

```powershell
git add src/views/TodayWorkspace.tsx src/views/TodayWorkspace.css src/views/TodayWorkspace.design.test.ts src/components/trades/TradeList.tsx src/components/trades/TradeList.css src/components/trades/WorkbenchEmptyState.tsx src/components/trades/WorkbenchEmptyState.css src/lib/workbenchEmptyState.ts src/lib/workbenchEmptyState.test.ts src/views/WorkbenchEmptyState.design.test.ts
git commit -m "style: clarify desktop trade queues"
```

---

### Task 12: Tighten Random Review and Settings page prototypes

**Files:**
- Modify: `src/views/ReviewSessionView.tsx`
- Modify: `src/views/ReviewSessionView.css`
- Modify: `src/views/ReviewSession.browser.test.tsx`
- Modify: `src/views/settings/SettingsLayout.tsx`
- Modify: `src/views/settings/SettingsLayout.css`
- Modify: `src/views/settings/DisplaySettingsPanel.css`
- Modify: `src/components/DataIOContent.css`
- Create: `src/views/DesktopPageRails.design.test.ts`

**Interfaces:**
- Review item owns `.review-session-reading` with content-driven height and `.review-session-assessment` within 240px of short content.
- Settings uses `--settings-content-width: 680px` and optional `.settings-aside`.

- [ ] **Step 1: Write failing rail and distance contracts**

Browser test seeds a two-paragraph review item and asserts:

```ts
const reading = document.querySelector('.review-session-reading')!.getBoundingClientRect()
const assessment = document.querySelector('.review-session-assessment')!.getBoundingClientRect()
if (assessment.top - reading.bottom > 240) throw new Error('assessment detached from short content')
```

Static test asserts settings content width 680px and no phone-only bottom safe-area padding.

- [ ] **Step 2: Run RED**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: short review content leaves more than 240px before assessment.

- [ ] **Step 3: Implement focused review layout**

Place intro copy, due count and primary start action in one block. Limit active workspace to 1080px. Remove forced full-height short-content behavior; for long content use a scrollable reading region with assessment sticky inside the same surface. Reduce top metadata to type, symbol and one status; move the remainder to compact summary.

- [ ] **Step 4: Converge settings rails and operation rows**

Use 680px content width, align all page heads/sections, and allow a right explanatory/preview aside only when present. Convert Data/Updates/Risk operation rows to shared spacing/button/status primitives; remove decorative per-option cards.

- [ ] **Step 5: Run GREEN and screenshots**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/views/DesktopPageRails.design.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm qa:desktop-visual
```

Inspect review/session and settings at 960/1440/1920. Reject if start copy and CTA separate into distant columns, or settings content is stranded at the far left of wide screens.

- [ ] **Step 6: Commit**

```powershell
git add src/views/ReviewSessionView.tsx src/views/ReviewSessionView.css src/views/ReviewSession.browser.test.tsx src/views/settings/SettingsLayout.tsx src/views/settings/SettingsLayout.css src/views/settings/DisplaySettingsPanel.css src/components/DataIOContent.css src/views/DesktopPageRails.design.test.ts
git commit -m "style: tighten focused desktop pages"
```

---

### Task 13: Complete modal convergence, full-route cleanup, and governance

**Files:**
- Modify: `src/components/TradeComposer.tsx`
- Modify: `src/components/TradeComposer.css`
- Modify: `src/components/TradeCloseDialog.tsx`
- Modify: `src/components/TradeCloseDialog.css`
- Modify: `src/components/StrategyFormModal.tsx`
- Modify: `src/components/StrategyFormModal.css`
- Modify: `src/components/ui/ModalShell.tsx`
- Modify: `src/components/ui/ModalShell.css`
- Modify: all remaining CSS/TSX files reported by governance scans
- Modify: `src/lib/designAuditSystemCompletion.test.ts`
- Modify: `src/lib/designAuditPresentationCompletion.test.ts`
- Modify: `src/lib/designAuditInteractionCompletion.test.ts`
- Create: `scripts/check-desktop-visual-governance.mjs`
- Modify: `package.json`

**Interfaces:**
- Custom modals consume ModalShell focus/busy/escape/restore behavior.
- Governance command `pnpm check:desktop-visual` returns non-zero for forbidden new mobile/product or raw visual patterns.

- [ ] **Step 1: Write the governance checker before cleanup**

```js
const forbidden = [
  ['mobile product chrome', /MobileNavigation/],
  ['coarse pointer product rule', /pointer:\s*coarse/],
  ['safe area product rule', /safe-area-inset/],
  ['raw z-index', /z-index:\s*-?\d+/],
  ['transition all', /transition:\s*all\b/],
]
```

Scan `src` UTF-8 text. Also detect CSS custom-property uses not defined in `tokens.css` or locally in the same file, raw component colors outside approved mask-image black, and JSX icon sizes outside named TS constants. Print file:line and pattern.

- [ ] **Step 2: Run RED and save the exact inventory**

Run: `node scripts/check-desktop-visual-governance.mjs`

Expected: FAIL with the remaining mobile rules, raw visual values, character icons, legacy controls and local modal contracts. Save the console inventory to the task report; do not weaken the checker to make it green.

- [ ] **Step 3: Migrate custom modal behavior to ModalShell**

TradeComposer, TradeCloseDialog and StrategyFormModal keep their content and callbacks but use ModalShell for overlay, initial focus, focus loop, busy Escape prevention, exit animation and trigger focus restore. Use Button and IconButton primitives; validation errors render InlineStatus and focus the first invalid field.

- [ ] **Step 4: Remove remaining unsupported mobile product branches**

For each 480/640/768/899 rule, either delete it or replace it with an explicit desktop compact rule whose lower bound is 960 application width and whose purpose is documented. Remove touch-target compensation, bottom sheets, safe-area offsets, hover-none/coarse-pointer behavior and mobile-only tests. Preserve `prefers-reduced-motion` and desktop narrow-column behavior.

- [ ] **Step 5: Migrate remaining visual drift**

Across strategies, cases, missed opportunities, archive, trash, notes and settings:

- replace legacy button classes with Button/IconButton;
- replace `···`, full-width `＋`, CSS check/exclamation with named icons;
- replace raw LCH/hex component values with semantic tokens;
- replace arbitrary icon sizes with constants;
- remove obsolete compatibility aliases only after `rg` proves zero consumers;
- remove Inter dependency/import only if `rg -n "Inter" src public package.json` proves no required use.

- [ ] **Step 6: Run GREEN governance and full regression**

Add package script:

```json
"check:desktop-visual": "node scripts/check-desktop-visual-governance.mjs"
```

Run:

```powershell
pnpm check:desktop-visual
pnpm qa:design
pnpm typecheck
pnpm test
pnpm build:app
```

Expected: all exit 0; zero forbidden pattern findings; test discovery contains no required mobile product fixture.

- [ ] **Step 7: Commit**

Stage only the inventory files actually changed plus the files listed above, verify with `git diff --cached --name-status`, then:

```powershell
git commit -m "refactor: complete desktop visual convergence"
```

---

### Task 14: Run two visual audit rounds and complete Windows/macOS evidence

**Files:**
- Create: `docs/superpowers/reports/2026-08-12-desktop-visual-convergence-round-1.md`
- Create: `docs/superpowers/reports/2026-08-12-desktop-visual-convergence-round-2.md`
- Create: `docs/superpowers/reports/2026-08-12-desktop-visual-convergence-completion-audit.md`
- Generate ignored runtime screenshots and machine-readable output under `.gstack/qa-reports/desktop-visual-convergence/`.
- Modify source/tests only for issues found during the rounds.

**Interfaces:**
- Consumes `qa:desktop-visual`, `qa:desktop-visual:electron`, VIS-01…VIS-18 and the fixed scenario manifest.
- Produces per-issue `{ id, severity, route, viewport, platform, evidence, fixCommit, retestEvidence }`.

- [ ] **Step 1: Run fresh full functional verification**

Run:

```powershell
pnpm check:desktop-visual
pnpm typecheck
pnpm test
pnpm build:app
pnpm qa:electron
pnpm qa:desktop-visual
```

Record command, timestamp, commit, exit code, passed/failed counts and artifact paths. Any failure blocks visual sign-off and must be fixed with a focused regression test and separate commit.

- [ ] **Step 2: Perform visual round 1**

For all 35 scenario/viewport pairs inspect layout, hierarchy, typography, colors, controls, icons, default/hover/focus/disabled/busy, loading/empty/error/success, and short/normal/long content. Record every P0/P1/P2 with screenshot path and exact source owner. Fix all P0/P1 and any systematic P2; rerun affected focused tests and screenshots after each commit.

- [ ] **Step 3: Verify Windows packaged Electron**

Run `pnpm dist:win` or use the current signed/approved Windows artifact policy, install/use isolated userData, and repeat core scenarios at 100%, 125%, 150% scaling. Include close-to-tray first explanation, restore from 1920×1080 to smaller workArea, menu/keyboard, file picker, save error and recovery. Report exact artifact SHA-256 and machine configuration.

- [ ] **Step 4: Verify macOS packaged Electron**

On macOS arm64 and x64 artifact as available, repeat core scenarios at Retina/default scaling. Verify red close keeps Dock, Cmd+Q quits, menu/keyboard labels use Cmd, window restore is visible, and no Windows tray copy appears. Report artifact SHA-256 and machine configuration. If macOS hardware or artifact is unavailable, the overall goal remains active; do not substitute Windows or renderer evidence.

- [ ] **Step 5: Perform visual round 2 from a fresh build**

After round-1 fixes, rebuild and capture the entire matrix again. Round 2 passes only when there are zero P0, zero P1 and no new cross-page inconsistency. Document remaining P2 and either fix it or prove it is an intentional optical exception already represented by a named token.

- [ ] **Step 6: Audit VIS-01 through VIS-18 one by one**

Create a table with columns: requirement, authoritative source/test, Windows evidence, macOS evidence, verdict. `PASS` requires direct evidence; `UNKNOWN`, missing, renderer-only or one-platform evidence is not pass.

- [ ] **Step 7: Run the final fresh verification**

Run again, after the final source change:

```powershell
pnpm check:desktop-visual
pnpm typecheck
pnpm test
pnpm build:app
pnpm qa:electron
```

Read full output. Confirm `git diff --check`, UTF-8 without BOM on changed text files, and that the working tree contains only the user's pre-existing unrelated changes plus intentional visual evidence.

- [ ] **Step 8: Commit evidence and completion audit**

```powershell
git add docs/superpowers/reports/2026-08-12-desktop-visual-convergence-round-1.md docs/superpowers/reports/2026-08-12-desktop-visual-convergence-round-2.md docs/superpowers/reports/2026-08-12-desktop-visual-convergence-completion-audit.md
git commit -m "docs: verify desktop visual convergence"
```

Only after every completion-definition item and VIS-01…VIS-18 is directly proven may the persistent goal be marked complete.

---

## Requirement-to-task traceability

Every acceptance requirement has an implementation owner before the final evidence pass. Task 14 validates the result; it does not become the sole owner of any product requirement.

| Requirement | Primary task ownership | Final evidence |
|---|---|---|
| VIS-01 typography roles | Tasks 2, 8–12 | Task 14 typography matrix and screenshots |
| VIS-02 color discipline | Tasks 2, 13 | Task 14 source scan and screenshots |
| VIS-03 surface recipes | Tasks 2, 4, 13 | Task 14 surface inventory and screenshots |
| VIS-04 spacing tokens | Tasks 2, 13 | Task 14 token scan and optical-exception review |
| VIS-05 named icons | Tasks 2, 3–5, 13 | Task 14 icon scan and state screenshots |
| VIS-06 control geometry and states | Tasks 3, 4 | Task 14 control-state matrix |
| VIS-07 focus visibility and restoration | Tasks 3, 4, 6, 7, 10–12 | Task 14 keyboard journeys on Windows/macOS |
| VIS-08 typed feedback hierarchy | Tasks 5, 11, 12 | Task 14 error/success/recovery scenarios |
| VIS-09 dashboard scope hierarchy | Task 8 | Task 14 dashboard matrix |
| VIS-10 weekly-review hierarchy | Task 9 | Task 14 weekly matrix and first-error journey |
| VIS-11 detail content priority | Task 10 | Task 14 short/normal/long detail matrix |
| VIS-12 today risk priority | Task 11 | Task 14 today tab and queue matrix |
| VIS-13 log semantics and discovery | Task 11 | Task 14 log selection/favorite/empty journeys |
| VIS-14 random-review content reachability | Task 12 | Task 14 short/long review journeys |
| VIS-15 desktop density and width | Tasks 1, 6, 8–12 | Task 14 960×640, 1366×768 and 1920×1080 evidence |
| VIS-16 native platform behavior | Tasks 7, 14 | Task 14 packaged Windows/macOS reports |
| VIS-17 noise reduction | Tasks 2, 8–13 | Task 14 cross-page competition audit |
| VIS-18 regression safety | Tasks 1–14 | Task 14 fresh type/test/build/Electron verification |

---

## Execution order and review gates

1. Tasks 1–2 establish evidence and canonical visual language; no page redesign begins before both pass.
2. Tasks 3–5 produce shared controls and feedback; later page tasks must consume them rather than add local copies.
3. Tasks 6–7 establish supported desktop shell and native platform behavior.
4. Tasks 8–12 may execute one at a time; each must pass its focused functional and visual gate before the next page.
5. Task 13 is the only broad mechanical cleanup; its inventory is fixed by the checker before edits so the checker cannot be weakened to match implementation.
6. Task 14 is an evidence phase, not a documentation shortcut. Any discovered P0/P1 returns to the owning task and requires fresh verification.

## Self-review checklist

- Spec sections 1–20 map to Tasks 1–14; VIS-01 through VIS-18 each have a primary implementation owner and Task 14 evidence gate.
- Platform scope is Windows/macOS only; 960px compact desktop replaces mobile product chrome.
- No task changes domain schema or statistic formulas.
- All newly named interfaces are defined before later tasks consume them.
- Every implementation task contains a failing test, red command, implementation contract, green command and commit.
- Generated screenshots are not treated as proof without route, viewport, commit and platform metadata.
- Existing unrelated deleted documents are never staged by broad `git add .` or `git add -A` at repository root.
