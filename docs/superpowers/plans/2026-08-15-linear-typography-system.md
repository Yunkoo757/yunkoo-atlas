# Linear Typography System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Trader Atlas 全部可见文字恢复为接近 Linear 的统一排版系统，同时保持月份分组栏、组件几何和页面布局不变。

**Architecture:** 以 `tokens.css` 建立唯一 canonical typography layer，由 Inter Variable 承担拉丁与数字、`system-ui` 承担 Windows/macOS 中文回退；各页面只消费语义字号、字重、行高、字距和数字令牌。静态合同限制第二套字体体系，Electron QA 通过 CDP 平台字体、computed style、几何与截图验证实际结果，打包门禁分别覆盖 Windows 与 macOS。

**Tech Stack:** React 18、TypeScript 5.6、原生 CSS、Inter Variable、JetBrains Mono、Vite 8、Playwright 1.60、Electron 43、Node test runner、CDP `CSS.getPlatformFontsForNode`。

## Global Constraints

- 仅支持 Windows 与 macOS 桌面客户端；不增加手机、iPad、浏览器产品或其他平台适配。
- 所有文件使用 UTF-8 无 BOM，保留中文和全部非 ASCII 字符。
- 严格执行红—绿—重构；每项生产改动先由真实失败测试证明缺口。
- UI 拉丁与数字使用本地打包的 Inter Variable；中文必须落到平台系统 UI 无衬线字体，不能落到 serif。
- 核心字号固定为 11 / 12 / 13 / 15 / 20px；规范字重固定为 400 / 500 / 600。
- 普通业务数字使用 UI 字体与 tabular nums；JetBrains Mono 只用于诊断、哈希、代码、原始数据预览和键位。
- 不修改月份分组栏的结构、背景、圆角、图标、内边距、高度、虚拟测量或吸顶行为。
- 不修改列表行高、列宽、按钮尺寸、标签尺寸、侧栏宽度、页面内容轨道、组件 DOM、数据流或业务行为。
- 不增加远程字体、运行时下载、字体选择设置或第三方私有字体资产。
- 每个任务只暂存列出的文件；提交前运行 `git diff --cached --check`。
- 浏览器模式只用于快速回归；完成证据必须来自 Windows/macOS Electron 客户端。

---

## File and Responsibility Map

### Canonical font and token layer

- Modify `src/main.tsx`: 恢复 Inter Variable 本地导入，移除 Geist 静态字重导入。
- Modify `src/App.tsx`: 把字体就绪注释和降级语义恢复为 Inter。
- Modify `src/styles/tokens.css`: 定义唯一字体栈、五级核心字号、三级字重、行高、文字灰阶与数字角色。
- Modify `src/styles/global.css`: 设定 Row 基准、字体渲染、继承和富文本外来字体隔离。
- Modify `package.json` and `pnpm-lock.yaml`: 移除不再使用的 `@fontsource/geist-sans`。
- Modify `src/lib/desktopVisualTokens.test.ts`: 锁定 Inter、字号、字重和文本灰阶合同。
- Modify `src/lib/productFlowPolish.test.ts`: 更新字体顺序合同。
- Create `src/lib/typographySystem.design.test.ts`: 扫描字体、数字、字距和例外边界。

### Shell and workbench mapping

- Modify `src/components/Sidebar.css`: 工作区、导航、分区和计数映射到 Row/Metadata。
- Modify `src/components/sidebar/SidebarWorkspace.css`: 清除第二套 11px/1px/0.04em 字距语法。
- Modify `src/components/Topbar.css`: 面包屑主次层级统一。
- Modify `src/components/trades/TradeList.css`: 列头、月份、交易行、标的、标签和日期映射语义角色，不改变几何。
- Modify `src/components/trades/QuickViewBar.css`: 快速筛选文字使用规范权重变量。
- Modify `src/components/RowPreviews.css`: 移除无语义 700。
- Modify `src/views/TodayWorkspace.css`: 主标题、队列与元数据使用规范字号和字距。
- Modify `src/views/BoardView.css` and `src/views/ListView.css`: 视图切换后仍使用相同排版角色。
- Modify `src/views/WorkbenchPerformance.design.test.ts`: 冻结月份分组 36px 内容 + 8px 顶部间距 = 44px 虚拟高度。

### Business numerals and financial surfaces

- Modify `src/components/LiveCycleSettings.css`, `LivePerformanceCycleControl.css`, `LivePerformanceCycleManager.css`: 周期和统计改用 UI 字体 + tabular nums。
- Modify `src/components/RiskStatusStrip.css`, `TradeOpenRiskDialog.css`, `WeeklyRiskPreparationCard.css`: 风险数字改用 UI 字体。
- Modify `src/components/ui/DatePicker.css`: 日期改用 UI 字体并把 620 收敛为 600。
- Modify `src/views/Dashboard.css`, `ReviewSessionView.css`, `TrashView.css`, `WeeklyReviewView.css`: KPI、日期、盈亏、R 倍数与复盘结果统一数字角色。

### Narrative, editor, and overlay mapping

- Modify `src/editor/Editor.css`: 正文、标题、占位与代码块角色分离；代码块保留 mono。
- Modify `src/views/DetailView.css`: 盘面摘要、正文、图片日期和属性栏共享全局角色。
- Modify `src/components/CsvImportModal.css`, `NotionImportModal.css`, `DisplayMenu.css`, `ImageLightbox.css`, `SymbolIcon.css`, `WelcomeScreen.css`: 清理 0.04/0.05/-0.02em 等局部漂移；原始数据预览保留 mono。
- Modify `src/components/ContextMenu.css`, `Menu.css`, `CommandPalette.css`, `Toast.css`, `EmptyState.css`: 浮层、菜单和反馈状态映射语义角色。
- Modify `src/components/RouteState.css`: 错误码保留 mono，但字距收敛到批准范围。

### Native typography evidence

- Modify `scripts/qa-desktop-visual.mjs`: 采集 Inter 加载、computed roles、平台字体和月份几何。
- Modify `scripts/qa-packaged-desktop-visual.mjs`: 在打包客户端记录原生字体证据。
- Modify `scripts/packaged-desktop-visual-contract.mjs`: fail-closed 要求平台字体和月份几何检查。
- Modify `scripts/fixtures/desktop-visual-matrix.test.mjs`: 覆盖 renderer/Electron 报告失败条件。
- Modify `scripts/fixtures/packaged-desktop-visual.test.mjs`: 覆盖 Windows/macOS 必需 typography checks。

### Verification record

- Create `docs/superpowers/reports/2026-08-15-linear-typography-verification.md`: 记录测试、构建、Windows 三档缩放、macOS Retina、截图与产物哈希。

---

## Task 1: Restore the canonical Inter typography foundation

**Files:**
- Modify: `src/lib/desktopVisualTokens.test.ts`
- Modify: `src/lib/productFlowPolish.test.ts`
- Create: `src/lib/typographySystem.design.test.ts`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/global.css`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: 现有 `--font-ui`、`--font-mono`、`--fs-*`、`--type-*` 令牌和 `document.fonts.ready` 启动门。
- Produces: `--font-ui-base`、`--type-caption-*`、`--type-metadata-*`、`--type-row-*`、`--type-body-*`、`--type-page-title-*`、`--numeric-tabular`，供后续所有 CSS 任务使用。

- [ ] **Step 1: Rewrite the font and token tests to the approved contract**

在 `src/lib/desktopVisualTokens.test.ts` 将 Geist 合同替换为：

```ts
export async function testUiFontUsesBundledInterAndPlatformCjkFallbacks(): Promise<void> {
  const [main, tokens, global] = await Promise.all([
    fs.readFile('src/main.tsx', 'utf8'),
    fs.readFile('src/styles/tokens.css', 'utf8'),
    fs.readFile('src/styles/global.css', 'utf8'),
  ])
  assert(main.includes("@fontsource-variable/inter"))
  assert(!main.includes('@fontsource/geist-sans'))
  assert(tokens.includes('"Inter Variable"'))
  assert(tokens.includes('system-ui'))
  assert(tokens.includes('"PingFang SC"'))
  assert(tokens.includes('"Microsoft YaHei UI"'))
  for (const contract of [
    '--font-size-micro: 11px',
    '--font-size-mini: 12px',
    '--font-size-small: 13px',
    '--font-size-regular: 15px',
    '--font-size-title3: 20px',
    '--font-weight-normal: 400',
    '--font-weight-medium: 500',
    '--font-weight-semibold: 600',
  ]) assert(tokens.includes(contract), `missing ${contract}`)
  assert(global.includes('font-optical-sizing: auto'))
}
```

在 `src/lib/productFlowPolish.test.ts` 验证顺序为 Inter → system-ui → macOS/Windows 显式后备。在新建的 `src/lib/typographySystem.design.test.ts` 读取 `package.json`、`main.tsx`、`tokens.css` 与 `global.css`，断言没有 Geist 依赖、远程字体 URL、serif 回退或 700 canonical token。

该测试使用 Node 22 的 `fs.glob` 建立全量 CSS 输入，避免只扫描人工清单：

```ts
async function readAllProductCss(): Promise<string> {
  const files: string[] = []
  for await (const path of fs.glob('src/**/*.css')) files.push(path)
  return (await Promise.all(files.sort().map((path) => fs.readFile(path, 'utf8')))).join('\n')
}
```

- [ ] **Step 2: Run the focused tests and observe RED**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/desktopVisualTokens.test.ts src/lib/productFlowPolish.test.ts src/lib/typographySystem.design.test.ts
```

Expected: FAIL，原因必须包含仍导入 Geist、缺少 Inter/系统 UI 栈或字号令牌仍为 rem；若测试本身不可发现，先修复命名和导出。

- [ ] **Step 3: Implement the canonical font stack and roles**

在 `src/main.tsx` 使用：

```ts
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
```

在 `tokens.css` 建立：

```css
--font-ui-base: "Inter Variable", Inter, system-ui, -apple-system,
  BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC",
  "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei",
  "Noto Sans SC", sans-serif;

--font-size-micro: 11px;
--font-size-mini: 12px;
--font-size-small: 13px;
--font-size-regular: 15px;
--font-size-title3: 20px;
--type-ui-base-size: var(--font-size-small);

--font-weight-normal: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
--font-weight-bold: var(--font-weight-semibold);

--type-caption-size: var(--font-size-micro);
--type-caption-line-height: 16px;
--type-metadata-size: var(--font-size-mini);
--type-metadata-line-height: 16px;
--type-row-size: var(--font-size-small);
--type-row-line-height: 20px;
--type-body-size: var(--font-size-regular);
--type-body-line-height: 23px;
--type-page-title-size: var(--font-size-title3);
--type-page-title-line-height: 28px;
--editor-letter-spacing: 0;
--numeric-tabular: tabular-nums;
```

把五级文字灰阶写成规格中的确切 LCH 值。`global.css` 的 `body` 使用 Row 13px/20px，增加 `font-optical-sizing: auto`；输入、按钮和 Portal 继续继承 `--font-ui`。富文本外来字体隔离由 Task 4 在编辑器可见层处理，不改写保存 HTML。

- [ ] **Step 4: Remove Geist and update the dependency graph**

Run:

```powershell
pnpm remove @fontsource/geist-sans
```

Expected: `package.json` 与 `pnpm-lock.yaml` 只移除 Geist，保留 `@fontsource-variable/inter@5.2.8` 和 JetBrains Mono。

- [ ] **Step 5: Re-run foundation tests, typecheck, and bundle inspection**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/desktopVisualTokens.test.ts src/lib/productFlowPolish.test.ts src/lib/typographySystem.design.test.ts
pnpm typecheck
pnpm build:app
rg -n "Geist Sans|geist-sans" src package.json pnpm-lock.yaml dist
```

Expected: tests、typecheck、build PASS；最后 `rg` 无匹配；构建产物包含 Inter Variable 字体资源。

- [ ] **Step 6: Commit the typography foundation**

```powershell
git add src/main.tsx src/App.tsx src/styles/tokens.css src/styles/global.css src/lib/desktopVisualTokens.test.ts src/lib/productFlowPolish.test.ts src/lib/typographySystem.design.test.ts package.json pnpm-lock.yaml
git diff --cached --check
git commit -m "style: restore Linear typography foundation"
```

---

## Task 2: Map the desktop shell and trade workbench without geometry drift

**Files:**
- Modify: `src/lib/typographySystem.design.test.ts`
- Modify: `src/components/Sidebar.css`
- Modify: `src/components/sidebar/SidebarWorkspace.css`
- Modify: `src/components/Topbar.css`
- Modify: `src/components/trades/TradeList.css`
- Modify: `src/components/trades/QuickViewBar.css`
- Modify: `src/components/RowPreviews.css`
- Modify: `src/views/TodayWorkspace.css`
- Modify: `src/views/BoardView.css`
- Modify: `src/views/ListView.css`
- Modify: `src/views/WorkbenchPerformance.design.test.ts`

**Interfaces:**
- Consumes: Task 1 的 canonical typography tokens。
- Produces: 稳定的 shell/list 角色映射；Task 5 的 Electron selectors 使用 `.ui-sidebar`、`.topbar`、`.trade-list-columns`、`.trade-list-group-header`、`.trade-row`。

- [ ] **Step 1: Add shell role and frozen-geometry assertions**

在 `typographySystem.design.test.ts` 增加源文件合同：

```ts
const shellSources = await Promise.all([
  'src/components/Sidebar.css',
  'src/components/sidebar/SidebarWorkspace.css',
  'src/components/Topbar.css',
  'src/components/trades/TradeList.css',
  'src/components/trades/QuickViewBar.css',
  'src/components/RowPreviews.css',
  'src/views/TodayWorkspace.css',
  'src/views/BoardView.css',
  'src/views/ListView.css',
].map((path) => fs.readFile(path, 'utf8')))
for (const source of shellSources) {
  assert(!source.includes('font-weight: 700'))
  assert(!source.includes('font-weight: 620'))
  assert(!source.includes('letter-spacing: 1px'))
  assert(!source.includes('letter-spacing: 0.04em'))
}
```

在 `WorkbenchPerformance.design.test.ts` 保留并强化：

```ts
assert(list.includes('--trade-group-height: 36px'))
assert(source.includes('HEADER_CONTENT_HEIGHT = 36'))
assert(source.includes('HEADER_TOP_GAP = 8'))
assert(source.includes('HEADER_HEIGHT = HEADER_CONTENT_HEIGHT + HEADER_TOP_GAP'))
```

- [ ] **Step 2: Run focused contracts and observe RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts src/views/WorkbenchPerformance.design.test.ts
```

Expected: FAIL 于 SidebarWorkspace 的 1px/0.04em、RowPreviews 的 700 或 TradeList 的旧字距，而不是月份几何合同。

- [ ] **Step 3: Apply semantic roles without touching box metrics**

执行以下映射：

```css
/* navigation and rows */
font-size: var(--type-row-size);
line-height: var(--type-row-line-height);
font-weight: var(--font-weight-normal);

/* active navigation / symbol / group title */
font-weight: var(--font-weight-medium); /* group and symbol may use semibold */

/* section labels / columns / counts */
font-size: var(--type-metadata-size);
line-height: var(--type-metadata-line-height);
font-variant-numeric: var(--numeric-tabular);
```

把硬编码 500/600 改为相应变量；RowPreviews 的 700 改为 semibold；普通中文和数据行 `letter-spacing: 0`，仅全大写微标签保留 `0.02em`。Sidebar 的 `-0.1px`、TradeList 的 `-0.26px`、Today 的 `-0.02/-0.03em` 全部移除或归一为批准的标题 `-0.012em`。不得改动 `height`、`min-height`、`padding`、`grid-template-columns`、`top`、`transform` 或虚拟列表常量。

- [ ] **Step 4: Re-run contracts and inspect geometry-only diff**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts src/views/WorkbenchPerformance.design.test.ts
git diff --word-diff=porcelain -- src/components/trades/TradeList.css src/views/WorkbenchPerformance.design.test.ts
```

Expected: PASS；TradeList 生产 diff 只包含 font/text 声明，不包含月份栏与虚拟测量几何。

- [ ] **Step 5: Run workbench browser regressions and commit**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/views/WorkbenchPerformance.design.test.ts src/lib/typographySystem.design.test.ts
pnpm typecheck
git add src/lib/typographySystem.design.test.ts src/components/Sidebar.css src/components/sidebar/SidebarWorkspace.css src/components/Topbar.css src/components/trades/TradeList.css src/components/trades/QuickViewBar.css src/components/RowPreviews.css src/views/TodayWorkspace.css src/views/BoardView.css src/views/ListView.css src/views/WorkbenchPerformance.design.test.ts
git diff --cached --check
git commit -m "style: align shell and trade typography"
```

---

## Task 3: Remove code-font styling from business numerals

**Files:**
- Modify: `src/lib/typographySystem.design.test.ts`
- Modify: `src/components/LiveCycleSettings.css`
- Modify: `src/components/LivePerformanceCycleControl.css`
- Modify: `src/components/LivePerformanceCycleManager.css`
- Modify: `src/components/RiskStatusStrip.css`
- Modify: `src/components/TradeOpenRiskDialog.css`
- Modify: `src/components/WeeklyRiskPreparationCard.css`
- Modify: `src/components/ui/DatePicker.css`
- Modify: `src/views/Dashboard.css`
- Modify: `src/views/ReviewSessionView.css`
- Modify: `src/views/TrashView.css`
- Modify: `src/views/WeeklyReviewView.css`

**Interfaces:**
- Consumes: `--font-ui` 与 `--numeric-tabular`。
- Produces: `.is-tabular` 等效声明 `font-family: var(--font-ui); font-variant-numeric: var(--numeric-tabular);`，供所有业务数值表面一致使用。

- [ ] **Step 1: Add a strict business-mono allowlist test**

在 `typographySystem.design.test.ts` 增加：

```ts
const businessNumericFiles = [
  'src/components/LiveCycleSettings.css',
  'src/components/LivePerformanceCycleControl.css',
  'src/components/LivePerformanceCycleManager.css',
  'src/components/RiskStatusStrip.css',
  'src/components/TradeOpenRiskDialog.css',
  'src/components/WeeklyRiskPreparationCard.css',
  'src/components/ui/DatePicker.css',
  'src/views/Dashboard.css',
  'src/views/ReviewSessionView.css',
  'src/views/TrashView.css',
  'src/views/WeeklyReviewView.css',
]
for (const path of businessNumericFiles) {
  const css = await fs.readFile(path, 'utf8')
  assert(!css.includes('font-family: var(--font-mono)'), `${path} uses mono for business data`)
}
```

另断言技术文件 `Kbd.css`、`Editor.css` 的 `code/pre`、`RouteState.css`、DataIO/Notion 原始预览仍保留 mono，避免全局误删。

- [ ] **Step 2: Run the audit and observe RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
```

Expected: FAIL 并逐一报告风险、周期、日期、复盘结果和周复盘的 mono 使用。

- [ ] **Step 3: Migrate each business value to UI tabular numerals**

对清单中的业务值使用：

```css
font-family: var(--font-ui);
font-variant-numeric: var(--numeric-tabular);
font-feature-settings: "tnum" 1, "kern" 1;
```

DatePicker 的选中日权重从 620 改为 `var(--font-weight-semibold)`；ReviewSession、WeeklyReview 与 Dashboard 的大数字只保留既有字号和色彩，不改变卡片尺寸。本任务文件中的 `-0.03em`、`-0.025em`、`-0.01em` 标题字距统一为 `-0.012em`。RouteState 错误码、Kbd、原始 JSON/导入预览和 Editor code/pre 不迁移。

- [ ] **Step 4: Run focused tests and screenshot-safe typecheck**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
pnpm typecheck
```

Expected: PASS；`rg -n "font-family: var\(--font-mono\)"` 只命中明确技术内容。

- [ ] **Step 5: Commit business numeric typography**

```powershell
git add src/lib/typographySystem.design.test.ts src/components/LiveCycleSettings.css src/components/LivePerformanceCycleControl.css src/components/LivePerformanceCycleManager.css src/components/RiskStatusStrip.css src/components/TradeOpenRiskDialog.css src/components/WeeklyRiskPreparationCard.css src/components/ui/DatePicker.css src/views/Dashboard.css src/views/ReviewSessionView.css src/views/TrashView.css src/views/WeeklyReviewView.css
git diff --cached --check
git commit -m "style: unify business number typography"
```

---

## Task 4: Align narrative, editor, menus, and feedback surfaces

**Files:**
- Modify: `src/lib/typographySystem.design.test.ts`
- Modify: `src/editor/Editor.css`
- Modify: `src/views/DetailView.css`
- Modify: `src/components/CsvImportModal.css`
- Modify: `src/components/NotionImportModal.css`
- Modify: `src/components/DisplayMenu.css`
- Modify: `src/components/ImageLightbox.css`
- Modify: `src/components/SymbolIcon.css`
- Modify: `src/components/WelcomeScreen.css`
- Modify: `src/components/ContextMenu.css`
- Modify: `src/components/Menu.css`
- Modify: `src/components/CommandPalette.css`
- Modify: `src/components/Toast.css`
- Modify: `src/components/EmptyState.css`
- Modify: `src/components/RouteState.css`

**Interfaces:**
- Consumes: Task 1 的 Body、Section title、Dialog title、Metadata、Caption 角色。
- Produces: 编辑/只读一致的正文度量，以及不携带第二套字体语法的浮层与反馈表面。

- [ ] **Step 1: Add exact letter-spacing and editor inheritance contracts**

在 `typographySystem.design.test.ts` 扫描全部产品 CSS：

```ts
const forbiddenTracking = [
  'letter-spacing: -0.26px',
  'letter-spacing: -0.1px',
  'letter-spacing: -0.00666667em',
  'letter-spacing: -0.01em',
  'letter-spacing: 1px',
  'letter-spacing: 0.04em',
  'letter-spacing: 0.05em',
  'letter-spacing: 0.06em',
  'letter-spacing: -0.02em',
  'letter-spacing: -0.025em',
  'letter-spacing: -0.03em',
]
for (const token of forbiddenTracking) {
  assert(!allProductCss.includes(token), `unapproved tracking remains: ${token}`)
}
assert(editor.includes('font-family: var(--font-ui)'))
assert(editor.includes('font-size: var(--type-body-size)'))
assert(editor.includes('line-height: var(--type-body-line-height)'))
assert(editor.includes('code') && editor.includes('font-family: var(--font-mono)'))
```

允许值只包括 `0`、标题 `-0.012em`、全大写微标签 `0.02em` 和 CSS 关键字 `normal`。

- [ ] **Step 2: Run the audit and observe RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts
```

Expected: FAIL，列出 Csv/Notion import、DisplayMenu、ImageLightbox、SidebarWorkspace、ReviewSession、Today、Weekly 等陈旧 tracking。

- [ ] **Step 3: Normalize editor and narrative roles**

`Editor.css` 的普通 `.ProseMirror` 使用：

```css
font-family: var(--font-ui);
font-size: var(--type-body-size);
font-weight: var(--font-weight-normal);
line-height: var(--type-body-line-height);
letter-spacing: 0;
```

可见富文本节点使用受限覆盖，忽略粘贴内容携带的外部字体家族：

```css
.ProseMirror :where(p, li, blockquote, h1, h2, h3, span):not(pre *) {
  font-family: var(--font-ui) !important;
}

.ProseMirror :where(code, pre, pre *) {
  font-family: var(--font-mono) !important;
}
```

标题使用 semibold 和 `-0.012em`；中文段落保持 0。`code`、`pre` 继续使用 `--font-mono`。DetailView 的盘面摘要标签使用 Metadata，关键句使用 Body/500，图片说明与日期使用 Metadata；不改变已批准的非 sticky 摘要表面和图片间距。

- [ ] **Step 4: Normalize overlay and feedback roles**

Menu/ContextMenu/Button 行使用 Row；Tooltip/微提示使用 Caption；Toast 标题使用 Row/600，正文使用 Metadata；EmptyState 标题使用 Body/600。导入弹窗中只有原始文件内容、字段映射源码和诊断保留 mono；标题与说明回到 UI 字体。所有陈旧 tracking 按允许值替换，不改控件尺寸。

- [ ] **Step 5: Run focused and editor regression tests**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/typographySystem.design.test.ts src/views/DetailVisualHierarchy.design.test.ts
@'
import path from 'node:path'
import { runBrowserRegressionTests } from './scripts/run-browser-tests.mjs'
const result = await runBrowserRegressionTests(process.cwd(), {
  configFile: path.resolve('vite.config.ts'),
  requestedTestIds: ['src/editor/ReviewContext.browser.test.html#__reviewContextInteractionTest'],
})
if (result.failed) process.exit(1)
'@ | node --input-type=module -
pnpm typecheck
```

Expected: PASS；真实 TipTap 编辑器的摘要、正文和图片节奏正确，保存 HTML 不因字体样式变化而改写。

- [ ] **Step 6: Commit narrative and overlay typography**

```powershell
git add src/lib/typographySystem.design.test.ts src/editor/Editor.css src/views/DetailView.css src/components/CsvImportModal.css src/components/NotionImportModal.css src/components/DisplayMenu.css src/components/ImageLightbox.css src/components/SymbolIcon.css src/components/WelcomeScreen.css src/components/ContextMenu.css src/components/Menu.css src/components/CommandPalette.css src/components/Toast.css src/components/EmptyState.css src/components/RouteState.css
git diff --cached --check
git commit -m "style: align narrative and overlay typography"
```

---

## Task 5: Make native typography evidence fail closed

**Files:**
- Modify: `scripts/fixtures/desktop-visual-matrix.test.mjs`
- Modify: `scripts/fixtures/packaged-desktop-visual.test.mjs`
- Modify: `scripts/qa-desktop-visual.mjs`
- Modify: `scripts/qa-packaged-desktop-visual.mjs`
- Modify: `scripts/packaged-desktop-visual-contract.mjs`

**Interfaces:**
- Consumes: 现有七个 desktop visual scenarios 与五档窗口矩阵。
- Produces: 每份报告中的 `typography` 对象，以及 `typography-inter-loaded`、`typography-latin-inter`、`typography-cjk-sans`、`typography-role-metrics`、`month-group-geometry` 五项 fail-closed checks。

- [ ] **Step 1: Add failing report-contract fixtures**

在 `desktop-visual-matrix.test.mjs` 的 clean report 增加：

```js
typography: { failureCount: 0 },
```

并断言 `failureCount: 1` 时 `desktopVisualReportHasFailures()` 返回 true。

在 `packaged-desktop-visual.test.mjs` 把以下 ID 加入 Windows 与 macOS 的必需检查：

```js
'typography-inter-loaded',
'typography-latin-inter',
'typography-cjk-sans',
'typography-role-metrics',
'month-group-geometry',
```

再分别删除一项，断言 `validatePackagedVisualReport()` 抛错。

- [ ] **Step 2: Run Node fixtures and observe RED**

```powershell
node --test scripts/fixtures/desktop-visual-matrix.test.mjs scripts/fixtures/packaged-desktop-visual.test.mjs
```

Expected: FAIL，因为报告函数尚不读取 typography，required platform checks 尚未包含新 ID。

- [ ] **Step 3: Collect computed typography and geometry**

在两个 QA 脚本中，在交易日志场景稳定后注入只用于测试的四个屏外渲染 probe：Latin、中文、混排、数字。probe 不能使用 `display:none`，否则 CDP 无法返回真实 glyph font：

```js
await page.evaluate(() => {
  document.querySelector('#atlas-typography-probes')?.remove()
  const root = document.createElement('div')
  root.id = 'atlas-typography-probes'
  root.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none;'
  root.innerHTML = [
    '<span class="qa-type-latin">Trader Atlas EURUSD 123</span>',
    '<span class="qa-type-cjk">交易日志盘面摘要</span>',
    '<span class="qa-type-mixed">XAUUSD 多 15M 8月13日</span>',
    '<span class="qa-type-numeric">+2.4R 2,346.80 21:45</span>',
  ].join('')
  document.body.append(root)
})
```

记录：

```js
const computed = await page.evaluate(() => {
  const pickStyle = (element) => {
    if (!(element instanceof HTMLElement)) throw new Error('typography probe is missing')
    const style = getComputedStyle(element)
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      fontVariantNumeric: style.fontVariantNumeric,
    }
  }
  const group = document.querySelector('.trade-list-group-header')
  const headerItem = document.querySelector('.trade-list-virtual-item.is-header')
  if (!(group instanceof HTMLElement) || !(headerItem instanceof HTMLElement)) {
    throw new Error('month group geometry probe is missing')
  }
  return {
    interLoaded: document.fonts.check('13px "Inter Variable"', 'Trader Atlas 123'),
    body: pickStyle(document.body),
    row: pickStyle(document.querySelector('.trade-row')),
    metadata: pickStyle(document.querySelector('.trade-list-column')),
    group: pickStyle(group.querySelector('strong')),
    monthGroupHeight: group.getBoundingClientRect().height,
    monthTopGap: getComputedStyle(headerItem).paddingTop,
  }
})
```

通过 Playwright CDP session 调用：

```js
await session.send('DOM.enable')
await session.send('CSS.enable')
const { root } = await session.send('DOM.getDocument')
const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector })
const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId })
```

Latin 必须命中 custom `Inter Variable`；Windows 中文必须匹配 `Microsoft YaHei`，macOS 中文必须匹配 `PingFang SC` 或 `Hiragino Sans GB`；任何 `SimSun`、`Songti`、`serif` 立即失败。角色度量必须分别为 Row 13/20、Metadata 12/16、月份标题 13/20/600；月份条实际高度 36px，虚拟总高度仍为 44px。

- [ ] **Step 4: Implement fail-closed report validation**

`desktopVisualReportHasFailures` 增加：

```js
report.typography?.failureCount !== 0
```

缺失 `typography` 也视为失败。`buildRequiredPlatformChecks` 为 Windows/macOS 都返回五项新检查；`validatePackagedVisualReport` 要求它们存在且 `pass === true`。

- [ ] **Step 5: Re-run contracts and real Electron QA**

```powershell
node --test scripts/fixtures/desktop-visual-matrix.test.mjs scripts/fixtures/packaged-desktop-visual.test.mjs
pnpm qa:desktop-visual:electron
```

Expected: Node fixtures PASS；Electron 35/35 screenshots，五项字体/几何检查 PASS，console error、page error、水平溢出均为 0。

- [ ] **Step 6: Commit native typography evidence**

```powershell
git add scripts/fixtures/desktop-visual-matrix.test.mjs scripts/fixtures/packaged-desktop-visual.test.mjs scripts/qa-desktop-visual.mjs scripts/qa-packaged-desktop-visual.mjs scripts/packaged-desktop-visual-contract.mjs
git diff --cached --check
git commit -m "test: verify native typography and geometry"
```

---

## Task 6: Complete visual iteration, platform gates, and Windows build

**Files:**
- Create: `docs/superpowers/reports/2026-08-15-linear-typography-verification.md`
- Evidence only: `.gstack/qa-reports/desktop-visual-convergence/**`
- Evidence only: `test-results/desktop-visual-packaged/**`
- Build artifacts only: `release/**`

**Interfaces:**
- Consumes: Tasks 1–5 and the existing isolated desktop visual seed.
- Produces: committed verification report, clean source commit, Windows installer/unpacked executable hashes, and separate Windows/macOS typography evidence.

- [ ] **Step 1: Run the complete local gates from a clean candidate commit**

```powershell
git status --short
pnpm typecheck
pnpm test
pnpm build:app
pnpm qa:desktop-visual:electron
```

Expected: clean source before evidence; all commands exit 0; Electron produces 35 captures with no runtime error or overflow.

- [ ] **Step 2: Perform first Windows visual review**

检查交易日志、今日、详情、仪表盘、周复盘、随机复盘、设置七个场景，逐项记录：

```text
字体：无宋体/serif 回退
层级：主/次/辅助文字可扫读
混排：中文、英文、数字基线协调
密度：没有因字体切换产生拥挤或松散
几何：月份分组、列表行、按钮、标签无漂移
状态：hover/focus/disabled/toast/modal 字体一致
```

任何 P0/P1 先回到对应任务补失败测试和最小修复；不得在本任务直接写无测试 CSS。

- [ ] **Step 3: Build the Windows installer and collect 100/125/150 evidence**

```powershell
pnpm dist:win
$env:ATLAS_PACKAGED_SCALE_FACTOR='1'; pnpm qa:desktop-visual:packaged
$env:ATLAS_PACKAGED_SCALE_FACTOR='1.25'; pnpm qa:desktop-visual:packaged
$env:ATLAS_PACKAGED_SCALE_FACTOR='1.5'; pnpm qa:desktop-visual:packaged
Remove-Item Env:ATLAS_PACKAGED_SCALE_FACTOR
```

Expected: installer 与 unpacked executable 生成；三档各 35 captures；Inter、中文无衬线、角色度量、月份几何、缩放、console/page/overflow 全部 PASS。

- [ ] **Step 4: Produce macOS Retina evidence on macOS**

从已推送的 clean source commit 运行现有工作流：

```powershell
$candidateBranch = git branch --show-current
git push -u origin $candidateBranch
gh workflow run desktop-visual-evidence.yml --ref $candidateBranch
$runId = gh run list --workflow desktop-visual-evidence.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $runId --exit-status
```

Expected: macOS x64/arm64 构建与 Retina packaged visual gate PASS；报告中的 Latin font 为 Inter Variable、中文为 PingFang SC/Hiragino Sans GB、五项 typography checks 全部 PASS。没有 macOS 直接证据时，完成状态保持未达成，不能用 Windows 结果代替。

- [ ] **Step 5: Perform the second visual review and write the verification report**

第二轮再次审查七个场景，确认没有新增 P0/P1。先采集报告所需的真实值：

```powershell
$sourceCommit = git rev-parse HEAD
$installer = Get-Item 'release\Trader-Atlas-1.4.0-win-x64.exe'
$unpacked = Get-Item 'release\win-unpacked\Trader Atlas.exe'
$installerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer.FullName).Hash
$unpackedHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $unpacked.FullName).Hash
$sourceCommit
$installer | Select-Object FullName,Length
$installerHash
$unpacked | Select-Object FullName,Length
$unpackedHash
```

`2026-08-15-linear-typography-verification.md` 必须包含 Source、Gates、Typography、Frozen Geometry、Artifacts 五节，并写入上述命令及 Windows/macOS QA 报告产生的真实值。固定内容为：Inter loaded PASS；角色 11/12/13/15/20 与 400/500/600 PASS；月份条 36px、顶部间距 8px、虚拟总高度 44px、布局漂移 0px。不得留下示例值或未执行状态。

- [ ] **Step 6: Commit the verification record and audit the tree**

```powershell
git add docs/superpowers/reports/2026-08-15-linear-typography-verification.md
git diff --cached --check
git commit -m "docs: verify Linear typography system"
git status --short
git log -6 --oneline
```

Expected: 工作树 clean；报告绑定 clean commit 与真实产物哈希；没有提交 `.gstack`、`test-results` 或 `release` 二进制。

---

## Final Acceptance Checklist

- [ ] `TYPE-01` 到 `TYPE-10` 均能指向源码、自动化或 Electron 证据。
- [ ] `rg -n "Geist Sans|geist-sans" src package.json pnpm-lock.yaml dist` 无匹配。
- [ ] 可见业务表面没有 `font-family: var(--font-mono)`。
- [ ] 技术表面仍保留 JetBrains Mono，不发生全局误删。
- [ ] Windows 100/125/150 与 macOS Retina 的实际 CJK 字体均为 sans。
- [ ] 月份分组栏 36px、顶部 8px、虚拟总高度 44px，结构和视觉不变。
- [ ] 七个核心桌面场景连续两轮为 0 个 P0、0 个 P1。
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm build:app`、`pnpm dist:win` 全部退出 0。
- [ ] Windows 安装包与 unpacked executable 的 SHA-256 已写入验证报告。
- [ ] 工作树 clean，UTF-8 无 BOM，未提交 QA 临时证据或构建二进制。
