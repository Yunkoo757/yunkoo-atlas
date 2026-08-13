# Review Flow, Focus Visibility, and Date Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把交易详情复盘正文收敛为连续的克制文档流，提供默认关闭且可持久化的键盘焦点高光偏好，并为交易日志列标题与月份分组条建立稳定的 `8px` 间距。

**Architecture:** 保留现有编辑器 HTML、焦点管理和虚拟列表数据模型。显示偏好沿 `DisplayPrefs → normalizeDisplay → Zustand → AppFrame data attribute` 单向传播；正文只调整 DetailView 外层结构和编辑器表面样式；日期间距由 header 虚拟行自身承担并计入测量。每项先用真实消费者行为写失败测试，再做最小实现并运行桌面浏览器几何验证。

**Tech Stack:** React 18、TypeScript 5.6、Zustand、TipTap、TanStack Virtual、原生 CSS、Vite 8 browser regression runner、Node regression runner、Electron 43。

## Global Constraints

- 仅支持 Windows 与 macOS 桌面客户端；不增加手机、iPad、浏览器产品或触摸优先适配。
- 所有文件用 UTF-8 无 BOM 读写，保留中文与全部非 ASCII 字符。
- 严格按红—绿—重构执行：每个生产改动前必须先观察对应测试因缺少该行为而失败。
- 测试必须验证真实状态、DOM、计算样式或几何结果；不得用源码字符串检索代替用户可观察行为。
- 不移除 `tabIndex`、Tab 导航、程序聚焦、焦点陷阱、Escape 返回或焦点恢复。
- 不改写历史正文 HTML，不改变 `data-review-context`、交易排序、分组 key、折叠状态或完成复盘业务逻辑。
- 每个任务只暂存列出的文件；先检查 `git diff --check`，再独立提交。

---

## File and Responsibility Map

### Display preference and persistence

- Modify `src/lib/tradeFilters.ts`: 在 `DisplayPrefs`、`DEFAULT_DISPLAY` 和 `normalizeDisplay` 中加入 `showKeyboardFocusRings`。
- Modify `src/storage/snapshotValidation.ts`: 允许快照显示偏好包含新布尔字段。
- Modify `src/regression.test.ts`: 验证新资料、旧快照和非法值的规范化合同。

### Settings and application focus surface

- Modify `src/views/settings/DisplaySettingsPanel.tsx`: 新增“交互反馈”分区和设置开关。
- Modify `src/components/ui/AppFrame.tsx`: 从 store 订阅偏好并在应用根节点输出 `data-keyboard-focus-rings`。
- Modify `src/styles/global.css`: 仅在偏好关闭时抑制非输入型 focus-visible outline/ring，保留输入编辑反馈。
- Create `src/views/settings/DisplayFocusPreference.browser.test.tsx` and `.html`: 覆盖开关、持久状态、真实焦点移动和开/关计算样式。

### Review document flow

- Modify `src/views/DetailView.tsx`: 移除普通已复盘交易的重复视觉标题；待复盘交易只保留轻量状态/动作工具行。
- Modify `src/views/DetailView.css`: 删除标题分隔语法，建立工具行和 `16px` 图片节奏。
- Modify `src/editor/Editor.css`: 把盘面摘要呈现为弱导语并保证到首个文档块的 `16px` 节奏。
- Modify `src/views/DetailVisualHierarchy.design.test.ts`: 验证结构分支，不用源码禁词替代运行时行为。
- Modify `src/editor/ReviewContext.browser.test.tsx`: 验证摘要节点、图片顺序、计算样式及保存 HTML 不变。

### Virtualized month spacing

- Modify `src/components/trades/TradeList.tsx`: 给 header 虚拟行暴露稳定类型 class，并使其估算/测量高度包含间距。
- Modify `src/components/trades/TradeList.css`: header 虚拟行承担 `8px` 顶部 padding，内部月份条尺寸不变。
- Create `src/components/trades/TradeListGroupSpacing.browser.test.tsx` and `.html`: 挂载真实 TradeList，验证首组、后续组和吸顶几何。
- Modify `src/components/trades/TradeList.design.test.ts`: 仅保留虚拟测量/定位结构合同；实际间距交给浏览器测试。

### Integrated verification

- Modify `scripts/qa-workbench.mjs`: 在既有交易日志与详情旅程中记录 focus 开/关、正文层级和日期间距证据。
- Modify `scripts/test-discovery.test.mjs`: 验证 workbench QA 实际执行新场景而非仅声明名称。
- Evidence only `.gstack/qa-reports/`: Windows 多缩放截图、指标和控制台报告，不作为产品源码提交。

---

## Task 1: Add the persisted focus-visibility preference

**Files:**
- Modify: `src/regression.test.ts`
- Modify: `src/lib/tradeFilters.ts`
- Modify: `src/storage/snapshotValidation.ts`

**Break this test catches:** 新资料错误开启高光、旧快照缺字段产生 `undefined`、导入非布尔值被错误转成 truthy。

- [ ] **Step 1: Add literal normalization assertions before production code**

在 `src/regression.test.ts` 的显示偏好合同附近增加：

```ts
assert(
  DEFAULT_DISPLAY.showKeyboardFocusRings === false,
  '新资料库必须默认关闭键盘焦点高光',
)
assert(
  normalizeDisplay({}).showKeyboardFocusRings === false,
  '旧资料库缺少键盘焦点高光字段时必须默认关闭',
)
assert(
  normalizeDisplay({ showKeyboardFocusRings: true }).showKeyboardFocusRings === true,
  '显式开启的键盘焦点高光必须持久化保留',
)
assert(
  normalizeDisplay({ showKeyboardFocusRings: 'yes' }).showKeyboardFocusRings === false,
  '非法键盘焦点高光值必须回退为关闭',
)
```

- [ ] **Step 2: Run the focused test and observe RED**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts
```

Expected: TypeScript/断言因 `showKeyboardFocusRings` 尚未存在而失败；若失败原因不是缺少合同，先修正测试环境。

- [ ] **Step 3: Implement the smallest data contract**

在 `src/lib/tradeFilters.ts` 中：

```ts
export type DisplayPrefs = {
  // existing fields
  showKeyboardFocusRings: boolean
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  // existing defaults
  showKeyboardFocusRings: false,
}
```

在 `normalizeDisplay` 中只接受真实布尔值：

```ts
showKeyboardFocusRings:
  typeof raw.showKeyboardFocusRings === 'boolean'
    ? raw.showKeyboardFocusRings
    : DEFAULT_DISPLAY.showKeyboardFocusRings,
```

在 `src/storage/snapshotValidation.ts` 的显示布尔字段白名单加入 `showKeyboardFocusRings`，不做 schema 迁移。

- [ ] **Step 4: Re-run focused persistence tests and type checks**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS；所有 `DisplayPrefs` fixture 通过 `DEFAULT_DISPLAY` 展开或显式补齐字段。

- [ ] **Step 5: Commit the preference contract**

```powershell
git add src/lib/tradeFilters.ts src/storage/snapshotValidation.ts src/regression.test.ts
git diff --cached --check
git commit -m "feat: persist keyboard focus visibility"
```

---

## Task 2: Add the default-off setting and real focus presentation

**Files:**
- Create: `src/views/settings/DisplayFocusPreference.browser.test.tsx`
- Create: `src/views/settings/DisplayFocusPreference.browser.test.html`
- Modify: `src/views/settings/DisplaySettingsPanel.tsx`
- Modify: `src/components/ui/AppFrame.tsx`
- Modify: `src/styles/global.css`

**Break this test catches:** 设置没有真正写入 store、根节点状态不跟随偏好、关闭时紫色大框仍出现、开启时焦点反馈无法恢复，或为了隐藏样式而破坏真实焦点移动。

- [ ] **Step 1: Create a real browser fixture**

测试挂载真实 `DisplaySettingsPanel` 与 `AppFrame`，保存并在 `finally` 恢复原始 `display`。测试必须：

```ts
const switchControl = [...document.querySelectorAll<HTMLElement>('[role="switch"]')]
  .find((node) => node.textContent?.includes('显示键盘焦点高光'))
assert(switchControl?.getAttribute('aria-checked') === 'false', '默认必须关闭')

const main = document.querySelector<HTMLElement>('.ui-main-frame')
main?.focus()
assert(document.activeElement === main, '关闭高光不得阻止主工作区获得焦点')
assert(getComputedStyle(main!).outlineStyle === 'none', '关闭时不得显示工作区焦点轮廓')

switchControl?.click()
await waitFor(() => useStore.getState().display.showKeyboardFocusRings, '开关未写入 store')
assert(rootFrame?.dataset.keyboardFocusRings === 'on', '根节点必须同步开启状态')

main?.blur()
main?.focus()
const enabledStyle = getComputedStyle(main!)
assert(
  enabledStyle.outlineStyle !== 'none' && parseFloat(enabledStyle.outlineWidth) >= 2,
  '开启后必须恢复清晰的焦点轮廓',
)
```

另聚焦一个文本输入框，断言关闭时仍保留输入组件自己的 border/background 编辑反馈。

- [ ] **Step 2: Run only the new browser fixture and observe RED**

Run:

```powershell
@'
import path from 'node:path'
import { runBrowserRegressionTests } from './scripts/run-browser-tests.mjs'
const result = await runBrowserRegressionTests(process.cwd(), {
  configFile: path.resolve('vite.config.ts'),
  requestedTestIds: ['src/views/settings/DisplayFocusPreference.browser.test.html#promise'],
})
if (result.failed) process.exit(1)
'@ | node --input-type=module -
```

Expected: 找不到设置开关或关闭状态仍呈现 focus outline。

- [ ] **Step 3: Render the setting and app-level state**

在 `DisplaySettingsPanel.tsx` 新增独立分区：

```tsx
<section className="display-settings-section">
  <div className="display-settings-section-heading">
    <h2>交互反馈</h2>
  </div>
  <ToggleRow
    label="显示键盘焦点高光"
    description="使用 Tab 或键盘导航时，以轮廓标出当前控件。关闭后仍可使用全部键盘操作。"
    checked={display.showKeyboardFocusRings}
    onChange={(checked) => updateDisplay({ showKeyboardFocusRings: checked })}
  />
</section>
```

在 `AppFrame.tsx` 订阅偏好并暴露单一状态：

```tsx
const showKeyboardFocusRings = useStore((state) => state.display.showKeyboardFocusRings)

return (
  <div
    className="ui-app-frame"
    data-keyboard-focus-rings={showKeyboardFocusRings ? 'on' : 'off'}
  >
```

- [ ] **Step 4: Scope focus CSS without changing focus mechanics**

保持现有 `:focus-visible` 为开启态基线；在 `global.css` 追加根节点关闭覆盖。覆盖应同时消除 outline 与只表达焦点的 ring shadow，但不能清除 `input`、`textarea`、`select` 和 `[contenteditable="true"]` 的编辑态反馈：

```css
.ui-app-frame[data-keyboard-focus-rings='off']
  :focus-visible:not(input):not(textarea):not(select):not([contenteditable='true']) {
  outline: none;
  box-shadow: none;
}
```

如组件把 focus ring 和业务 shadow 合并，先改为 `--focus-ring-shadow` token 再只关闭该层；不得用广泛 `box-shadow: none` 覆盖 error、selected 或 popover elevation。

- [ ] **Step 5: Re-run browser test in both states**

Run the Step 2 command again.

Expected: PASS；`document.activeElement` 在开关两种状态相同，只是计算样式不同。

- [ ] **Step 6: Run existing focus-sensitive shell and modal tests**

```powershell
@'
import path from 'node:path'
import { runBrowserRegressionTests } from './scripts/run-browser-tests.mjs'
const result = await runBrowserRegressionTests(process.cwd(), {
  configFile: path.resolve('vite.config.ts'),
  requestedTestIds: [
    'src/components/DesktopShell.browser.test.html#promise',
    'src/views/settings/DisplayFocusPreference.browser.test.html#promise',
  ],
})
if (result.failed) process.exit(1)
'@ | node --input-type=module -
```

Expected: 960、1440、1920 桌面视口全部 PASS；菜单首项聚焦行为不回退。

- [ ] **Step 7: Commit the focus UI**

```powershell
git add src/views/settings/DisplaySettingsPanel.tsx src/components/ui/AppFrame.tsx src/styles/global.css src/views/settings/DisplayFocusPreference.browser.test.tsx src/views/settings/DisplayFocusPreference.browser.test.html
git diff --cached --check
git commit -m "feat: make keyboard focus rings optional"
```

---

## Task 3: Convert review content to a restrained document flow

**Files:**
- Modify: `src/views/DetailVisualHierarchy.design.test.ts`
- Modify: `src/editor/ReviewContext.browser.test.tsx`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/views/DetailView.css`
- Modify: `src/editor/Editor.css`

**Break this test catches:** 已复盘交易继续显示重复强标题、待复盘动作被误删、摘要被卡片化或移出原 HTML、摘要到首图不足 `16px`、图片顺序被改写。

- [ ] **Step 1: Extend the real detail hierarchy browser behavior**

在现有 detail fixture 中分别渲染已复盘与待复盘普通交易，断言：

```ts
assert(!reviewedHost.querySelector('.dv-review-toolbar'), '已复盘正文不得保留空工具行')
assert(!reviewedHost.textContent?.includes('复盘正文'), '普通已复盘交易不得显示重复视觉标题')
assert(
  reviewedHost.querySelector('[aria-label="复盘正文"]'),
  '去除视觉标题后必须保留编辑器可访问名称',
)
assert(pendingHost.querySelector('.dv-review-toolbar'), '待复盘交易必须保留状态/动作工具行')
assert(pendingHost.querySelector('button')?.textContent?.includes('完成复盘'), '完成动作不得丢失')
```

若 `DetailVisualHierarchy.design.test.ts` 当前只做静态合同，保留它对 `620px/336px` 和编辑器最小高度的检查；新增运行时断言放入最邻近的真实 DetailView browser fixture，避免源码禁词测试。

- [ ] **Step 2: Extend ReviewContext geometry and serialization assertions**

给 `ReviewContext.browser.test.tsx` 的 HTML fixture 加一张紧随摘要的 data URL 图片，并记录传给 `onChange` 的最新 HTML：

```ts
const context = host.querySelector<HTMLElement>('section[data-review-context]')
const image = context?.nextElementSibling as HTMLImageElement | null
assert(context && image?.tagName === 'IMG', '首图必须保持在摘要之后')
const gap = image.getBoundingClientRect().top - context.getBoundingClientRect().bottom
assert(Math.abs(gap - 16) <= 1, `摘要到首图应为 16px，实际 ${gap}px`)
assert(latestHtml.includes('data-review-context="true"'), '保存 HTML 必须保留摘要数据节点')
assert(latestHtml.indexOf('data-review-context') < latestHtml.indexOf('<img'), '保存 HTML 不得改变摘要与图片顺序')
```

- [ ] **Step 3: Run focused tests and observe RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/views/DetailVisualHierarchy.design.test.ts
@'
import path from 'node:path'
import { runBrowserRegressionTests } from './scripts/run-browser-tests.mjs'
const result = await runBrowserRegressionTests(process.cwd(), {
  configFile: path.resolve('vite.config.ts'),
  requestedTestIds: ['src/editor/ReviewContext.browser.test.html#promise'],
})
if (result.failed) process.exit(1)
'@ | node --input-type=module -
```

Expected: 旧标题/分隔线结构或 `12px` 摘要节奏导致失败。

- [ ] **Step 4: Simplify DetailView structure**

把无条件 `.dv-review-content-head` 改为仅待复盘时渲染的工具行：

```tsx
{needsReview && !needsResult ? (
  <div className="dv-review-toolbar" aria-label="复盘状态与操作">
    <span className="dv-review-state">待复盘</span>
    <Button type="button" onClick={handleCompleteReview}>完成复盘</Button>
  </div>
) : null}
```

普通已复盘交易直接进入 `.dv-document`。案例详情继续使用现有 `.dv-case-note-heading`，不得因普通交易去标题而丢失“案例沉淀”语义。编辑器的 `ariaLabel={isCase ? '案例沉淀正文' : '复盘正文'}` 保持不变。

- [ ] **Step 5: Establish document-flow styling**

在 `DetailView.css`：

```css
.dv-review-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  margin: 0 0 var(--sp-4);
}

.dv-document .editor img {
  margin: var(--sp-4) 0;
}
```

删除旧 `.dv-review-content-head` 的全宽 `border-bottom` 和强标题声明。`Editor.css` 中 `section[data-review-context]` 保留 transparent surface、弱标签和可选 sticky，只把下方节奏统一为 `var(--sp-4)`；不得新增背景、边框、阴影或 HTML 包装。

- [ ] **Step 6: Re-run focused review tests**

Run the Step 3 commands again.

Expected: PASS；已复盘普通交易无视觉“复盘正文”，待复盘动作仍可操作，摘要/图片间距为 `16±1px`，HTML 节点和顺序不变。

- [ ] **Step 7: Commit the document flow**

```powershell
git add src/views/DetailView.tsx src/views/DetailView.css src/editor/Editor.css src/views/DetailVisualHierarchy.design.test.ts src/editor/ReviewContext.browser.test.tsx
git diff --cached --check
git commit -m "refactor: streamline review document flow"
```

---

## Task 4: Give virtualized month groups a measured 8px gap

**Files:**
- Create: `src/components/trades/TradeListGroupSpacing.browser.test.tsx`
- Create: `src/components/trades/TradeListGroupSpacing.browser.test.html`
- Modify: `src/components/trades/TradeList.tsx`
- Modify: `src/components/trades/TradeList.css`
- Modify: `src/components/trades/TradeList.design.test.ts`

**Break this test catches:** 列标题与首个月份条零间距、只靠内部 margin 导致 virtualizer 高度错误、滚动吸顶遮住列标题、后续分组几何与首组不一致。

- [ ] **Step 1: Create a real TradeList geometry fixture**

挂载真实 `TradeList`，使用两个月份组、每组两条完整 Trade fixture，并把外层 `.list-scroll` 固定为 `520×240px`。断言首组：

```ts
const columns = host.querySelector<HTMLElement>('.trade-list-columns')
const firstHeader = host.querySelector<HTMLElement>('.trade-list-group-header')
assert(columns && firstHeader, '必须渲染列标题与月份分组')
const initialGap = firstHeader.getBoundingClientRect().top - columns.getBoundingClientRect().bottom
assert(Math.abs(initialGap - 8) <= 1, `列标题与月份条应相距 8px，实际 ${initialGap}px`)
```

滚动到第二组并等待两帧后断言：

```ts
assert(stickyHeader.getBoundingClientRect().top >= columns.getBoundingClientRect().bottom + 7,
  '吸顶月份条不得遮挡列标题')
assert(scrollHost.scrollHeight > scrollHost.clientHeight, 'fixture 必须真实触发虚拟滚动')
```

同时点击分组条和折叠按钮，验证间距层没有形成透明点击空洞，折叠状态仍变化。

- [ ] **Step 2: Run the new browser fixture and observe RED**

```powershell
@'
import path from 'node:path'
import { runBrowserRegressionTests } from './scripts/run-browser-tests.mjs'
const result = await runBrowserRegressionTests(process.cwd(), {
  configFile: path.resolve('vite.config.ts'),
  requestedTestIds: ['src/components/trades/TradeListGroupSpacing.browser.test.html#promise'],
})
if (result.failed) process.exit(1)
'@ | node --input-type=module -
```

Expected: initial gap 为 `0px` 或 sticky header 紧贴列标题而失败。

- [ ] **Step 3: Put spacing ownership on the virtual header row**

在虚拟项上输出稳定类型 class：

```tsx
className={`trade-list-virtual-item${item.kind === 'header' ? ' is-header' : ' is-row'}`}
```

将 header 基础高度拆成内容高度加 gap，并让 virtualizer 的估算值与浏览器实测一致：

```ts
const HEADER_CONTENT_HEIGHT = 36
const HEADER_TOP_GAP = 8
const HEADER_HEIGHT = HEADER_CONTENT_HEIGHT + HEADER_TOP_GAP
```

CSS：

```css
.trade-list-virtual-item.is-header {
  box-sizing: border-box;
  padding-top: var(--sp-2);
}
```

内部 `.trade-list-group-header` 仍使用原 `36px` 高度、左右 margin、圆角与按钮位置；不得给它 `margin-top`。sticky 虚拟项的 `top` 仍为 `var(--trade-list-columns-height)`，由自身 padding 产生可测的 `8px` 视觉间距。

- [ ] **Step 4: Update the structural contract without duplicating CSS behavior**

`TradeList.design.test.ts` 只验证：header estimate 为 `44px`、虚拟项带 `is-header`、sticky top 仍锚定列标题高度；实际 `8px` 用浏览器几何断言负责。

- [ ] **Step 5: Re-run group tests**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/components/trades/TradeList.design.test.ts
@'
import path from 'node:path'
import { runBrowserRegressionTests } from './scripts/run-browser-tests.mjs'
const result = await runBrowserRegressionTests(process.cwd(), {
  configFile: path.resolve('vite.config.ts'),
  requestedTestIds: ['src/components/trades/TradeListGroupSpacing.browser.test.html#promise'],
})
if (result.failed) process.exit(1)
'@ | node --input-type=module -
```

Expected: PASS at browser fixture viewports 900、1280、1440、1920；首组和吸顶组均为 `8±1px`，折叠无跳位。

- [ ] **Step 6: Commit the measured spacing**

```powershell
git add src/components/trades/TradeList.tsx src/components/trades/TradeList.css src/components/trades/TradeList.design.test.ts src/components/trades/TradeListGroupSpacing.browser.test.tsx src/components/trades/TradeListGroupSpacing.browser.test.html
git diff --cached --check
git commit -m "fix: space virtual trade date groups"
```

---

## Task 5: Integrate QA evidence and run the desktop release gate

**Files:**
- Modify: `scripts/qa-workbench.mjs`
- Modify: `scripts/test-discovery.test.mjs`
- Evidence only: `.gstack/qa-reports/`

**Break this test catches:** 定向组件测试通过但实际 workbench 路由仍出现主框架紫框、详情重复标题或月份条贴顶；QA 脚本声明新场景却没有真正执行。

- [ ] **Step 1: Add failing QA-script behavior tests**

扩展 `scripts/test-discovery.test.mjs`，通过受控 workbench probe 验证以下实际指标进入 report：

```js
{
  focusPreference: 'off',
  activeElement: 'main-content',
  focusOutlineWidth: 0,
  reviewVisualHeadingCount: 0,
  reviewContextImageGap: 16,
  tradeGroupTopGap: 8,
}
```

再覆盖 focusPreference `on`，要求相同 activeElement 且 outlineWidth `>= 2`。

- [ ] **Step 2: Observe RED**

```powershell
node --test scripts/test-discovery.test.mjs
```

Expected: workbench 尚未产出新的行为指标。

- [ ] **Step 3: Extend the actual workbench journey**

在隔离资料上：

1. 打开设置，将焦点高光置为关闭，返回交易日志并程序聚焦主内容；记录 active element 与计算 outline。
2. 开启高光后重复同一步，记录 outline 恢复而 active element 不变。
3. 打开带摘要和图片的已复盘交易，记录视觉标题数量、摘要/图片 bounding rect gap 和 HTML 顺序 hash。
4. 返回交易日志，记录列标题与首组/吸顶组 bounding rect gap，并执行一次折叠、展开和滚动回顶。
5. 每一步收集 console error、page error、横向溢出和截图路径。

- [ ] **Step 4: Re-run QA script contract**

```powershell
node --test scripts/test-discovery.test.mjs
```

Expected: PASS；测试证明这些路径在 workbench 中被执行并校验结果。

- [ ] **Step 5: Run all focused suites**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts src/views/DetailVisualHierarchy.design.test.ts src/components/trades/TradeList.design.test.ts
@'
import path from 'node:path'
import { runBrowserRegressionTests } from './scripts/run-browser-tests.mjs'
const result = await runBrowserRegressionTests(process.cwd(), {
  configFile: path.resolve('vite.config.ts'),
  requestedTestIds: [
    'src/views/settings/DisplayFocusPreference.browser.test.html#promise',
    'src/components/DesktopShell.browser.test.html#promise',
    'src/editor/ReviewContext.browser.test.html#promise',
    'src/components/trades/TradeListGroupSpacing.browser.test.html#promise',
  ],
})
if (result.failed) process.exit(1)
'@ | node --input-type=module -
```

- [ ] **Step 6: Run the full quality and build gates**

```powershell
pnpm test
pnpm build:app
pnpm qa:workbench
```

Expected: 全部退出码为 `0`；console errors、page errors、horizontal overflow 均为 `0`。

- [ ] **Step 7: Inspect Windows evidence at desktop scales**

在 Windows 100%、125%、150% 缩放检查 900、1280、1440、1920 宽度：

- 焦点高光默认关闭，程序恢复焦点不会出现主框架紫色大框；开启后键盘轮廓清楚但不刺眼。
- 已复盘普通交易不显示独立“复盘正文”，盘面摘要、文字和图片是连续文档流。
- 待复盘交易仍有状态与完成动作，且没有贯穿正文的重分隔线。
- 月份条与列标题稳定相距 `8px`；滚动吸顶、折叠和展开不跳动。
- 设置页没有横向溢出，开关说明在桌面窄窗仍完整可读。

macOS 由现有 arm64/x64 构建与平台证据门验证；不得声称当前 Windows 主机完成了 macOS 实机视觉检查。

- [ ] **Step 8: Commit QA coverage**

```powershell
git add scripts/qa-workbench.mjs scripts/test-discovery.test.mjs
git diff --cached --check
git commit -m "test: verify review and focus presentation"
```

- [ ] **Step 9: Final verification and clean-tree audit**

```powershell
git status --short
git diff --check HEAD~4..HEAD
git log -6 --oneline
```

Expected: 无未说明源码改动；四个实现提交和 QA 提交边界清晰。发布、推送、合并主干和打版本仅在用户明确授权并完成发布前复核后执行。

---

## Spec Coverage Self-Review

- `FOC-01/02`: Task 1 覆盖默认值、缺字段、非法类型。
- `FOC-03/04`: Task 2 用同一真实控件验证焦点仍移动，仅计算样式开关。
- `FOC-05`: Task 2 复跑既有 shell/menu 焦点路径，Task 5 用实际 workbench 补证。
- `DOC-01/02`: Task 3 覆盖已复盘无空标题行与待复盘动作保留。
- `DOC-03/04`: Task 3 用真实 DOM 几何和保存 HTML 顺序验证 `16px` 与零改写。
- `DATE-01/02`: Task 4 用真实虚拟列表验证首组、后续组、吸顶和折叠。
- `DATE-03`: Task 4 浏览器视口矩阵与 Task 5 Windows 缩放证据覆盖。
- Windows/macOS 桌面范围、UTF-8、无移动端适配和无业务模型改动均已列为全局约束。
- 计划无占位文件名、伪测试命令或待定接口；所有新增 fixture 都有明确入口与消费行为。
