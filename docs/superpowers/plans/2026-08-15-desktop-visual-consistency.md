# Trader Atlas Desktop Visual Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变业务逻辑和功能流程的前提下，统一 Trader Atlas 在 960–1920px Windows 与 macOS 桌面窗口中的页面轨道、紧凑布局、公共控件和交互状态视觉。

**Architecture:** 保留现有暗色交易工具方向，在 `tokens.css` 增加语义页面轨道和状态节奏，由现有页面 CSS 消费；只迁移低风险普通操作到既有 `Button`、`IconButton` 和状态组件。通过设计契约、浏览器交互测试和扩展后的桌面截图矩阵证明一致性，而不是大范围改写页面结构。

**Tech Stack:** React 18、TypeScript、Vite 8、Electron 43、Zustand、CSS Design Tokens、Playwright 1.60、Node 测试运行器。

## Global Constraints

- 始终以 UTF-8 无 BOM 读取和保存文件，完整保留中文字符。
- 仅适配 Windows 和 macOS 桌面客户端，窗口基线为 960–1920px。
- 不增加手机、iPad、浏览器产品形态或其他平台适配逻辑。
- 不修改业务逻辑、数据流、路由语义、快捷键、持久化或 Electron 桥接。
- 不调整字段顺序、核心文案含义和操作流程。
- 不新增页面私有颜色、裸字号、裸圆角或新的动效体系。
- 每个任务先写失败契约，再做最小实现并独立提交。

---

## File Structure

- `src/styles/tokens.css`：页面轨道、页面内边距和状态节奏的唯一语义变量来源。
- `src/views/DesktopPageRails.design.test.ts`：页面轨道消费与桌面平台边界契约。
- `src/lib/desktopVisualTokens.test.ts`：新增令牌存在性和语义别名契约。
- `src/views/Dashboard.css`：宽数据轨道。
- `src/views/TodayWorkspace.css`：标准工作台轨道。
- `src/views/WeeklyReviewView.css`：阅读轨道、样式分区和紧凑桌面规则。
- `src/views/ReviewSessionView.css`：保留经过验证的 1080px 活动复盘工作面，仅参与状态层级收敛。
- `src/views/DetailView.css`：标准详情轨道。
- `src/views/settings/SettingsLayout.css`：表单轨道和紧凑设置布局。
- `src/components/RiskStatusStrip.css`：紧凑桌面风险状态布局。
- `src/components/ui/Button.tsx`、`src/components/ui/IconButton.tsx`：既有共享操作组件，不扩张接口。
- `src/components/trades/WorkbenchEmptyState.tsx`、`src/views/TodayWorkspace.tsx`、`src/views/WeeklyReviewView.tsx`：低风险公共控件迁移。
- `src/lib/desktopControlReuse.test.ts`：公共控件复用边界契约。
- `src/components/EmptyState.css`、`src/components/ui/InlineStatus.css`、`src/components/RouteState.css`：page、section、inline 状态层级。
- `src/lib/desktopStateHierarchy.test.ts`：状态层级视觉契约。
- `scripts/desktop-visual-scenarios.mjs`：扩展核心页面视觉矩阵。
- `scripts/fixtures/desktop-visual-matrix.test.mjs`：继续使用场景常量验证精确矩阵，无业务改动。

---

### Task 1: Add Semantic Desktop Layout Tokens

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/lib/desktopVisualTokens.test.ts`

**Interfaces:**
- Consumes: 现有 `--sp-*`、`--space-page-inset-*`、`--surface-*` 令牌。
- Produces: `--page-rail-wide`、`--page-rail-standard`、`--page-rail-reading`、`--page-rail-form`、`--page-inset-compact`、`--page-inset-default`、`--page-inset-wide`。

- [ ] **Step 1: Write the failing token contract**

在 `testDesktopVisualTokensExposeCanonicalRoles` 的令牌列表中加入：

```ts
'--page-rail-wide: 1240px',
'--page-rail-standard: 1180px',
'--page-rail-reading: 920px',
'--page-rail-form: 680px',
'--page-inset-compact: var(--sp-5)',
'--page-inset-default: var(--sp-7)',
'--page-inset-wide: var(--sp-8)',
```

- [ ] **Step 2: Run the regression suite and verify the new contract fails**

Run: `node scripts/run-regression-tests.mjs`

Expected: FAIL，提示缺少首个 `--page-rail-*` 令牌。

- [ ] **Step 3: Add the semantic tokens**

在 `tokens.css` 的布局与语义间距区域加入：

```css
--page-rail-wide: 1240px;
--page-rail-standard: 1180px;
--page-rail-reading: 920px;
--page-rail-form: 680px;
--page-inset-compact: var(--sp-5);
--page-inset-default: var(--sp-7);
--page-inset-wide: var(--sp-8);
```

保留旧的 `--space-page-inset-*` 作为兼容别名，并改为指向新变量。

- [ ] **Step 4: Run token and design verification**

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS。

Run: `pnpm qa:design`

Expected: 所有设计契约 PASS。

- [ ] **Step 5: Commit**

```powershell
git add -- src/styles/tokens.css src/lib/desktopVisualTokens.test.ts
git commit -m "style: add semantic desktop layout tokens"
```

### Task 2: Migrate Core Pages to Semantic Rails

**Files:**
- Modify: `src/views/DesktopPageRails.design.test.ts`
- Modify: `src/views/Dashboard.css`
- Modify: `src/views/TodayWorkspace.css`
- Modify: `src/views/WeeklyReviewView.css`
- Modify: `src/views/DetailView.css`
- Modify: `src/views/settings/SettingsLayout.css`

**Interfaces:**
- Consumes: Task 1 的 `--page-rail-*` 与 `--page-inset-*`。
- Produces: 所有核心页面的语义轨道消费规则；不改变 React DOM 和滚动容器。

- [ ] **Step 1: Write failing page-rail contracts**

扩展 `DesktopPageRails.design.test.ts`：

```ts
export function testCoreDesktopPagesConsumeSemanticRails(): void {
  const contracts = [
    ['src/views/Dashboard.css', '--page-rail-wide'],
    ['src/views/TodayWorkspace.css', '--page-rail-standard'],
    ['src/views/WeeklyReviewView.css', '--page-rail-reading'],
    ['src/views/DetailView.css', '--page-rail-standard'],
    ['src/views/settings/SettingsLayout.css', '--page-rail-form'],
  ] as const
  for (const [file, token] of contracts) {
    const css = read(file)
    assert(css.includes(`var(${token})`), `${file} 必须消费 ${token}`)
  }
}
```

同时将设置页旧断言从裸 `680px` 攦为 `--settings-content-width: var(--page-rail-form)`。

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/run-regression-tests.mjs`

Expected: FAIL，指出 Dashboard 尚未消费 `--page-rail-wide`。

- [ ] **Step 3: Replace page-local rail values**

按以下映射替换，不改变原有效果：

```css
.db-analysis-rail { max-width: var(--page-rail-wide); }
.today-workspace-inner { max-width: var(--page-rail-standard); }
.wr-page-head-inner,
.wr-content,
.wr-year { width: min(var(--page-rail-reading), calc(100% - 2 * var(--page-inset-default))); }
.dv-main-inner { max-width: var(--page-rail-standard); }
.settings-panel { --settings-content-width: var(--page-rail-form); }
```

将页面横向 padding 改为 `--page-inset-*`，保持现有垂直节奏。

- [ ] **Step 4: Run regression and design checks**

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS。

Run: `pnpm qa:design`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add -- src/views/DesktopPageRails.design.test.ts src/views/Dashboard.css src/views/TodayWorkspace.css src/views/WeeklyReviewView.css src/views/DetailView.css src/views/settings/SettingsLayout.css
git commit -m "style: align core pages to semantic rails"
```

### Task 3: Stabilize the Compact Desktop Layout

**Files:**
- Create: `src/lib/desktopCompactLayout.test.ts`
- Modify: `src/components/RiskStatusStrip.css`
- Modify: `src/views/WeeklyReviewView.css`
- Modify: `src/views/settings/SettingsLayout.css`

**Interfaces:**
- Consumes: AppFrame 的 1099px 紧凑桌面边界及 Task 1 的 compact inset。
- Produces: 960–1099px 下无关键折行的风险、周复盘和设置布局。

- [ ] **Step 1: Write the failing compact-layout contract**

```ts
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

export async function testCompactDesktopLayoutsShareTheAppFrameBreakpoint(): Promise<void> {
  const files = [
    'src/components/RiskStatusStrip.css',
    'src/views/WeeklyReviewView.css',
    'src/views/settings/SettingsLayout.css',
  ]
  for (const file of files) {
    const css = await fs.readFile(file, 'utf8')
    assert(css.includes('@media (max-width: 1099px)'), `${file} 缺少紧凑桌面断点`)
  }
}

export async function testCompactWeeklyActionsNeverWrap(): Promise<void> {
  const css = await fs.readFile('src/views/WeeklyReviewView.css', 'utf8')
  assert(/\.wr-tab-switch button\s*\{[^}]*white-space:\s*nowrap/s.test(css))
}
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/run-regression-tests.mjs`

Expected: FAIL，RiskStatusStrip 缺少 1099px 断点。

- [ ] **Step 3: Implement compact desktop rules**

风险状态切换为纵向行并调整分隔线：

```css
@media (max-width: 1099px) {
  .risk-status-periods { grid-template-columns: 1fr; }
  .risk-status-period + .risk-status-period {
    border-top: 1px solid var(--border-subtle);
    border-left: 0;
  }
}
```

周复盘保持操作单行、收紧页面内边距，并让窄窗口页头从底部对齐改为居中对齐。设置导航缩至 164px，页面使用 compact inset。不要隐藏功能或改变文案。

- [ ] **Step 4: Run regression, type and renderer visual QA**

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS。

Run: `pnpm typecheck`

Expected: PASS。

Run: `pnpm qa:desktop-visual --renderer`

Expected: 35 captures，0 overflow，0 console/page errors；960px 周复盘操作不折行。

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/desktopCompactLayout.test.ts src/components/RiskStatusStrip.css src/views/WeeklyReviewView.css src/views/settings/SettingsLayout.css
git commit -m "style: stabilize compact desktop layouts"
```

### Task 4: Reuse Shared Controls for Generic Actions

**Files:**
- Create: `src/lib/desktopControlReuse.test.ts`
- Modify: `src/components/trades/WorkbenchEmptyState.tsx`
- Modify: `src/views/TodayWorkspace.tsx`
- Modify: `src/views/TodayWorkspace.css`
- Modify: `src/views/WeeklyReviewView.tsx`
- Modify: `src/views/WeeklyReviewView.css`

**Interfaces:**
- Consumes: 既有 `Button`、`IconButton` 接口，不新增 prop。
- Produces: 工作台空状态、今日新建交易、周复盘前后导航的统一 hover、focus、disabled 和尺寸行为。

- [ ] **Step 1: Write the failing reuse contract**

```ts
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

export async function testGenericDesktopActionsReuseSharedControls(): Promise<void> {
  const workbench = await fs.readFile('src/components/trades/WorkbenchEmptyState.tsx', 'utf8')
  const today = await fs.readFile('src/views/TodayWorkspace.tsx', 'utf8')
  const weekly = await fs.readFile('src/views/WeeklyReviewView.tsx', 'utf8')
  assert(workbench.includes('<Button'))
  assert(today.includes('<Button'))
  assert(weekly.includes('<IconButton'))
}
```

- [ ] **Step 2: Run and verify failure**

Run: `node scripts/run-regression-tests.mjs`

Expected: FAIL，WorkbenchEmptyState 尚未使用 `Button`。

- [ ] **Step 3: Migrate only semantically generic actions**

将工作台空状态主操作和今日“新建交易”改为：

```tsx
<Button variant={secondary ? 'bordered' : 'primary'} size="lg" onClick={onAction}>
  <Plus size={ICON_MD} />
  <span>新建交易</span>
</Button>
```

将周复盘前后导航改为 `IconButton`，保留原 `aria-label`、disabled 条件和点击处理。评分、标签、周列表和问题跳转按钮保持专用实现。

- [ ] **Step 4: Remove obsolete compatibility overrides and verify**

只删除上述三个位置不再消费的 `.empty-btn`、`.wr-week-nav` 通用外观声明；保留页面必要的位置规则和所有兼容其他消费者的样式。

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS。

Run: `pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/desktopControlReuse.test.ts src/components/trades/WorkbenchEmptyState.tsx src/views/TodayWorkspace.tsx src/views/TodayWorkspace.css src/views/WeeklyReviewView.tsx src/views/WeeklyReviewView.css
git commit -m "refactor: reuse shared desktop controls"
```

### Task 5: Align Page, Section, and Inline State Hierarchy

**Files:**
- Create: `src/lib/desktopStateHierarchy.test.ts`
- Modify: `src/components/EmptyState.css`
- Modify: `src/components/ui/InlineStatus.css`
- Modify: `src/components/RouteState.css`
- Modify: `src/views/ReviewSessionView.css`
- Modify: `src/views/DetailView.css`

**Interfaces:**
- Consumes: `--type-page-title-*`、`--type-section-title-*`、`--type-body-*`、`--type-metadata-*` 与语义表面。
- Produces: page、section、inline 三层状态的统一标题、说明、图标、间距和操作位置。

- [ ] **Step 1: Write the failing state hierarchy contract**

```ts
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

export async function testDesktopStatesUseCanonicalTypographyRoles(): Promise<void> {
  const [empty, inline, route, review, detail] = await Promise.all([
    fs.readFile('src/components/EmptyState.css', 'utf8'),
    fs.readFile('src/components/ui/InlineStatus.css', 'utf8'),
    fs.readFile('src/components/RouteState.css', 'utf8'),
    fs.readFile('src/views/ReviewSessionView.css', 'utf8'),
    fs.readFile('src/views/DetailView.css', 'utf8'),
  ])
  assert(empty.includes('font-size: var(--type-section-title-size)'))
  assert(inline.includes('font-size: var(--type-data-size)'))
  assert(route.includes('font-size: var(--type-page-title-size)'))
  assert(review.includes('font-size: var(--type-row-size)'))
  assert(detail.includes('font-size: var(--type-row-size)'))
}
```

- [ ] **Step 2: Run and verify the exact missing role**

Run: `node scripts/run-regression-tests.mjs`

Expected: FAIL，`EmptyState.css` 的 `.empty-title` 当前使用 `--type-body-size`，尚未使用 `--type-section-title-size`。

- [ ] **Step 3: Align state styles without changing rendering logic**

- page 状态：页面标题、正文和操作保持居中，使用 page title 与 body 角色。
- section 空状态：标题使用 section title，说明使用 metadata/body，最小高度保持紧凑。
- inline 状态：继续使用 data 与 metadata 角色，图标颜色承载状态语义。
- review/detail loading：统一为 row 正文和 metadata 辅助说明，不新增动画。

不修改组件 props、状态判断、ARIA live 级别或错误处理。

- [ ] **Step 4: Verify accessibility and interaction contracts**

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS。

Run: `pnpm qa:design`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/desktopStateHierarchy.test.ts src/components/EmptyState.css src/components/ui/InlineStatus.css src/components/RouteState.css src/views/ReviewSessionView.css src/views/DetailView.css
git commit -m "style: align desktop state hierarchy"
```

### Task 6: Expand Visual Coverage and Complete the Re-Audit

**Files:**
- Modify: `scripts/desktop-visual-scenarios.mjs`
- Modify: `scripts/fixtures/desktop-visual-matrix.test.mjs`
- Modify: `docs/superpowers/specs/2026-08-15-desktop-visual-consistency-design.md` only if final evidence reveals a material scope correction.

**Interfaces:**
- Consumes: 现有 `DESKTOP_VISUAL_SCENARIOS`、`DESKTOP_VISUAL_VIEWPORTS` 与隔离数据库种子。
- Produces: 核心工作区、辅助页面、设置入口在五种桌面窗口下的精确截图矩阵。

- [ ] **Step 1: Write the failing scenario coverage contract**

在 desktop visual matrix test 中要求场景集合包含：

```js
const requiredScenarioIds = [
  'today', 'trades', 'detail', 'dashboard', 'weekly', 'review-session',
  'notes', 'missed', 'review-cases', 'paper-trades', 'live-archive', 'trash',
  'settings-profile', 'settings-shortcuts', 'settings-strategies', 'settings-risk',
  'settings-tags', 'settings-symbols', 'settings-review-templates',
  'settings-display', 'settings-data', 'settings-updates',
]
```

- [ ] **Step 2: Run and verify failure**

Run: `node --test scripts/fixtures/desktop-visual-matrix.test.mjs`

Expected: FAIL，提示缺少 `notes` 等新场景。

- [ ] **Step 3: Add the routes with stable ready selectors**

扩展 `DESKTOP_VISUAL_SCENARIOS`，使用隔离种子和以下页面入口：`/notes`、`/missed`、`/review-cases`、`/sim`、`/live-archive`、`/trade-trash` 以及十个设置子路由。场景只导航和等待稳定选择器，不点击写入数据的操作。

- [ ] **Step 4: Run the full renderer matrix and inspect representative screenshots**

Run: `pnpm qa:desktop-visual --renderer`

Expected: 22 scenarios × 5 viewports = 110 captures，0 overflow，0 console errors，0 page errors，字体检查全部通过。

人工检查 960、1440、1920px 下全部 22 个场景；重点比较页面轨道、标题、按钮、表单、空状态、禁用状态和浮层入口。

- [ ] **Step 5: Run complete verification**

Run: `pnpm typecheck`

Expected: PASS。

Run: `pnpm test`

Expected: PASS，无 skip/todo。

Run: `pnpm build`

Expected: PASS，包体预算通过。

Run: `pnpm qa:design`

Expected: PASS。

Run: `git diff --check`

Expected: 无输出。

- [ ] **Step 6: Commit final QA coverage**

```powershell
git add -- scripts/desktop-visual-scenarios.mjs scripts/fixtures/desktop-visual-matrix.test.mjs
git commit -m "test: expand desktop visual coverage"
```

- [ ] **Step 7: Final completion audit**

逐项对照设计规格中的目标、问题清单、状态规范、数据边界和完成标准。只有 110 张截图、设计契约、类型检查、全部测试和构建均提供直接证据时，才报告目标完成。
