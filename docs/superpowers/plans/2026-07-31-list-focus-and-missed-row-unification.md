# List Focus and Missed Row Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 彻底取消工作台列表的整行焦点/选中高亮，并让“错过的机会”聚合行与标准 TradeRow 共享结构、列位、密度和响应式规则。

**Architecture:** 抽出无 Store 依赖的 `TradeRowLayout` 展示壳层，标准 `TradeRow` 与 `MissedOpportunityRow` 分别负责准备业务内容并交给同一组插槽。焦点、选中和返回恢复逻辑继续存在，但共享壳层只为鼠标 hover 绘制整行背景；整行覆盖按钮局部压制全局 focus outline。

**Tech Stack:** React 18、TypeScript、原生 CSS、TanStack Virtual、Playwright 浏览器契约、Vite、Electron Builder。

## Global Constraints

- 始终以 UTF-8 无 BOM 读写，保留全部简体中文。
- 不取消按钮、菜单、输入框、选择框等独立控件的键盘焦点反馈。
- 不删除键盘导航、滚动跟随、详情返回焦点恢复或无障碍语义。
- 不改变错过机会的聚合、去重、来源范围、临时筛选、详情返回或回源规则。
- 多选状态只由复选框表达；整行不因 `.is-selected` 或 `.is-focused` 改变视觉。
- 聚合页普通项整行进入唯一来源；合并项仍禁止整行猜测目标。
- 375px 下不得横向溢出，移动端菜单命中区至少 44×44px。
- 保留当前工作树中尚未提交的范围/筛选按钮统一修正，不覆盖或回退这些改动。

## File Map

- `src/components/trades/TradeRowLayout.tsx`：新增纯展示共享壳层，拥有标准行 DOM、插槽和整行入口。
- `src/components/trades/TradeRow.tsx`：改为准备标准交易内容并组合 `TradeRowLayout`。
- `src/components/trades/MissedOpportunityRow.tsx`：改为准备来源/原因/关联内容并组合 `TradeRowLayout`。
- `src/components/trades/TradeList.css`：成为标准行与聚合行共享的唯一几何、状态和响应式来源。
- `src/views/MissedOpportunitiesView.css`：删除独立 `.missed-row` 网格，只保留聚合页工具栏、弹层和聚合专属标签/菜单样式。
- `src/components/trades/TradeRowPresentation.browser.test.tsx`、`.html`：新增标准行焦点、选中、hover 与共享布局浏览器契约。
- `src/views/MissedOpportunitiesView.browser.test.tsx`：更新聚合行结构、焦点、几何、来源标签与响应式契约。
- `src/components/trades/TradeList.design.test.ts`：增加快速静态边界，防止整行焦点/选中高亮规则回流。
- `src/views/MissedOpportunitiesContrast.design.test.ts`：保留当前按钮共享样式契约，不混入行几何断言。

---

### Task 1: 锁定“整行无焦点、无选中高亮”契约

**Files:**
- Create: `src/components/trades/TradeRowPresentation.browser.test.tsx`
- Create: `src/components/trades/TradeRowPresentation.browser.test.html`
- Modify: `src/components/trades/TradeList.design.test.ts`
- Modify: `src/views/MissedOpportunitiesView.browser.test.tsx`

**Interfaces:**
- Consumes: 当前 `TradeRow`、`MissedOpportunityRow`、`tokens.css`、`global.css`。
- Produces: 浏览器可观测的行状态契约，后续 Task 2–4 必须满足。

- [ ] **Step 1: 新增标准行真实样式失败测试**

创建最小浏览器 fixture，渲染默认、`focused`、`selected` 三条 `TradeRow`，并聚焦整行覆盖按钮：

```tsx
const focusedRow = document.querySelector<HTMLElement>('[data-trade-id="focused"]')!
const selectedRow = document.querySelector<HTMLElement>('[data-trade-id="selected"]')!
const overlay = focusedRow.querySelector<HTMLButtonElement>('.trade-row-open')!
overlay.focus()

assert(overlay.matches(':focus-visible'), 'fixture 必须进入可见焦点态')
assert(getComputedStyle(overlay).outlineStyle === 'none', '整行入口不得绘制焦点外框')
assert(getComputedStyle(focusedRow).boxShadow === 'none', '焦点行不得绘制亮边')
assert(getComputedStyle(focusedRow, '::after').backgroundColor === 'rgba(0, 0, 0, 0)', '程序焦点不得改变整行底色')
assert(getComputedStyle(selectedRow, '::after').backgroundColor === 'rgba(0, 0, 0, 0)', '多选不得改变整行底色')
assert(selectedRow.querySelector('.selection-box.is-selected'), '多选仍必须由复选框表达')
```

fixture 还要用 Playwright `hover()` 验证默认行 `::after` 变为与 `--bg-hover` 相同的计算色。

- [ ] **Step 2: 更新聚合行失败断言**

将现有 `assertFocusedRowUsesEdgeMarkerInsteadOfGlow()` 改为：

```tsx
function assertFocusedAggregateRowHasNoVisualHighlight(): void {
  const row = resultRow(paperTrade.id)
  const overlay = row.querySelector<HTMLButtonElement>('[data-trade-primary-action]')!
  overlay.focus()
  assert(getComputedStyle(overlay).outlineStyle === 'none', '聚合整行入口不得绘制外框')
  assert(getComputedStyle(row).boxShadow === 'none', '聚合行不得绘制焦点亮边')
  assert(getComputedStyle(row, '::before').content === 'none', '聚合行不得保留焦点边缘标记')
  assert(getComputedStyle(row).backgroundColor === 'rgba(0, 0, 0, 0)', '聚合焦点行不得改变底色')
}
```

- [ ] **Step 3: 增加快速设计契约**

在 `TradeList.design.test.ts` 读取 `TradeList.css`，断言不存在以下整行状态规则：

```ts
for (const forbidden of [
  '.trade-row.is-selected::after',
  '.trade-row.is-focused::after',
  '.trade-row:has(.trade-row-open:focus-visible)',
]) {
  if (source.includes(forbidden)) throw new Error(`不得恢复整行高亮：${forbidden}`)
}
```

- [ ] **Step 4: 运行测试确认失败**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: FAIL；标准行仍存在 accent inset shadow 与 selected/focused 底色，聚合行仍存在左侧 2px 标记。

- [ ] **Step 5: 提交失败测试**

```bash
git add src/components/trades/TradeRowPresentation.browser.test.tsx src/components/trades/TradeRowPresentation.browser.test.html src/components/trades/TradeList.design.test.ts src/views/MissedOpportunitiesView.browser.test.tsx
git commit -m "test: forbid full-row focus highlights"
```

---

### Task 2: 抽取标准共享行布局并迁移 TradeRow

**Files:**
- Create: `src/components/trades/TradeRowLayout.tsx`
- Modify: `src/components/trades/TradeRow.tsx`
- Modify: `src/components/trades/TradeList.css`
- Test: `src/components/trades/TradeRowPresentation.browser.test.tsx`

**Interfaces:**
- Consumes: `ReactNode` 插槽、标准行打开/右键行为。
- Produces: `TradeRowLayout`、`TradeRowOpenAction`，供 `TradeRow` 与 Task 3 的 `MissedOpportunityRow` 使用。

- [ ] **Step 1: 定义共享壳层公开接口**

```tsx
export type TradeRowOpenAction = {
  ariaLabel: string
  onClick: () => void
  primary?: boolean
}

export type TradeRowLayoutProps = {
  tradeId: string
  className?: string
  ariaLabel?: string
  role?: 'listitem'
  focused?: boolean
  selected?: boolean
  openAction?: TradeRowOpenAction
  check: ReactNode
  status: ReactNode
  reference: ReactNode
  symbol: ReactNode
  tags: ReactNode
  timeframe: ReactNode
  pnl: ReactNode
  r: ReactNode
  date: ReactNode
  end: ReactNode
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void
}
```

`TradeRowLayout` 固定输出 `.trade-row` 与现有标准子类：`.trade-row-check-slot`、`.trade-row-status`、`.trade-row-ref`、`.trade-row-symbol`、`.trade-row-tags`、`.trade-row-timeframe-slot`、`.trade-row-pnl`、`.trade-row-r`、`.trade-row-date`、`.trade-row-end`。`openAction` 缺省时不渲染透明覆盖按钮。

- [ ] **Step 2: 用共享壳层重写 TradeRow 外层**

保留现有 `TradeRow` 的数据推导和内部控件，把 JSX 替换为：

```tsx
<TradeRowLayout
  tradeId={trade.id}
  focused={focused}
  selected={selected}
  openAction={{ ariaLabel: `打开 ${trade.symbol} ${trade.ref}`, onClick: () => onOpen(trade) }}
  check={selectable ? (
    <SelectionBox
      checked={selected}
      label={selected ? '取消选择' : '选择交易'}
      onToggle={() => onSelect(trade)}
      className="trade-row-check"
    />
  ) : <span className="trade-row-check-placeholder" aria-hidden />}
  status={<StatusIcon status={trade.status} />}
  reference={trade.ref}
  symbol={(
    <>
      <span className="trade-row-symbol-main">
        <SymbolIcon symbol={trade.symbol} overrides={symbolIcons} size={14} />
        <strong>{trade.symbol}</strong>
      </span>
      <SideTag side={trade.side} quiet />
    </>
  )}
  tags={<>{strategyButton}{sessionTag}{mistakeTags}{regularTags}{reviewLabel}</>}
  timeframe={<span className="trade-row-timeframe">{timeframe}</span>}
  pnl={resultNode}
  r={rNode}
  date={fmtDate(trade.openedAt)}
  end={starButton}
  onContextMenu={(event) => onContextMenu?.(event, trade)}
/>
```

- [ ] **Step 3: 移除所有整行焦点与选中视觉**

在 `TradeList.css`：

```css
.trade-row.is-selected,
.trade-row.is-focused {
  background: transparent;
}

.trade-row-open:focus-visible {
  outline: none;
}
```

删除 `.trade-row.is-selected::after`、`.trade-row.is-focused::after` 和 `.trade-row:has(.trade-row-open:focus-visible)`。保留 `.trade-row:hover::after { background: var(--bg-hover); }`，不修改星标、菜单、策略按钮和选择框自己的 `:focus-visible`。

- [ ] **Step 4: 运行标准行浏览器测试**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: 新标准行 fixture PASS；其他浏览器测试不因 DOM 迁移失败。

- [ ] **Step 5: 运行类型和单元契约**

Run: `pnpm typecheck`

Expected: PASS。

Run: `node scripts/run-regression-tests.mjs --unit-only`

Expected: PASS。

- [ ] **Step 6: 提交共享布局**

```bash
git add src/components/trades/TradeRowLayout.tsx src/components/trades/TradeRow.tsx src/components/trades/TradeList.css
git commit -m "refactor: share the standard trade row layout"
```

---

### Task 3: 将错过机会迁移到标准行结构

**Files:**
- Modify: `src/components/trades/MissedOpportunityRow.tsx`
- Modify: `src/views/MissedOpportunitiesView.css`
- Modify: `src/views/MissedOpportunitiesView.browser.test.tsx`
- Test: `src/components/trades/TradeRowPresentation.browser.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `TradeRowLayout`、`TradeRowOpenAction`，现有 `MissedOpportunityItem`。
- Produces: 标准行同构的聚合行；来源/原因标签；普通与合并项导航行为。

- [ ] **Step 1: 写入共享几何失败断言**

在聚合浏览器 fixture 同时渲染一条标准 `TradeRow` 作为几何参照，比较：

```tsx
for (const selector of [
  '.trade-row-ref',
  '.trade-row-symbol',
  '.trade-row-timeframe-slot',
  '.trade-row-pnl',
  '.trade-row-r',
  '.trade-row-date',
]) {
  const standardRect = standardRow.querySelector<HTMLElement>(selector)!.getBoundingClientRect()
  const aggregateRect = aggregateRow.querySelector<HTMLElement>(selector)!.getBoundingClientRect()
  assert(Math.abs(standardRect.left - aggregateRect.left) < 1, `${selector} 左边界必须一致`)
}
assert(aggregateRow.getBoundingClientRect().height === 44, '聚合行必须使用标准 44px 行高')
assert(!aggregateRow.querySelector('.missed-row-source'), '来源不得保留独立首列')
assert(aggregateRow.querySelector('[data-missed-source="paper"]')?.closest('.trade-row-tags'), '来源必须进入标准标签区')
```

- [ ] **Step 2: 以共享壳层重写 MissedOpportunityRow**

聚合行传入：

```tsx
<TradeRowLayout
  tradeId={item.key}
  className={'missed-opportunity-row' + (merged ? ' is-merged' : '')}
  role="listitem"
  ariaLabel={`${primary.symbol}，${sideLabel}，${SOURCE_LABELS[item.source]}，${fmtDate(item.occurredAt)}`}
  focused={focused}
  openAction={merged ? undefined : {
    ariaLabel: openLabel,
    onClick: () => onOpen(primary, item.key),
    primary: true,
  }}
  check={<span className="trade-row-check-placeholder" aria-hidden />}
  status={<StatusIcon status="missed" />}
  reference={primary.ref}
  symbol={(
    <>
      <span className="trade-row-symbol-main">
        <SymbolIcon symbol={primary.symbol} overrides={symbolIcons} size={14} />
        <strong>{primary.symbol}</strong>
      </span>
      <SideTag side={primary.side} quiet />
    </>
  )}
  tags={<MissedOpportunityTags item={item} strategies={strategies} />}
  timeframe={<span className="trade-row-timeframe">{resolveTimeframe(primary.timeframe)}</span>}
  pnl={<span className="trade-row-pnl is-missed">未成交</span>}
  r={<span className={rClass}>{fmtR(primary.rMultiple)}</span>}
  date={<time dateTime={item.occurredAt}>{fmtDate(item.occurredAt)}</time>}
  end={merged ? mergedMenu : <span aria-hidden />}
/>
```

`MissedOpportunityTags` 依次渲染标准策略 chip、来源中性标签、错过原因标签、失效来源标签和“关联 N 个案例”。不得再拼接 `策略 · 原因 · 编号` 摘要句。

- [ ] **Step 3: 删除聚合页独立行网格**

从 `MissedOpportunitiesView.css` 删除 `.missed-row`、`.missed-row-open`、`.missed-row-source`、`.missed-row-symbol`、`.missed-row-side`、`.missed-row-summary`、`.missed-row-time` 及对应 768/700/480px 网格规则。

只保留聚合专属规则：

```css
.missed-opportunity-row .missed-source-tag {
  color: var(--text-tertiary);
}

.missed-opportunity-row .missed-reason-tag,
.missed-opportunity-row .missed-relation-tag {
  color: var(--list-text-secondary);
}

.missed-opportunity-row .missed-missing-source-tag {
  color: color-mix(in srgb, var(--warn) 72%, var(--text-secondary));
}

.missed-opportunity-row .missed-row-menu button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: var(--text-tertiary);
  border-radius: var(--radius-6);
}
```

这些标签必须消费标准 `.trade-row-tag` / `.trade-row-more` 的基础样式，只添加必要 tone。

- [ ] **Step 4: 运行聚合浏览器测试**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: PASS；来源位于标签区、标准列几何一致、普通与合并项导航保持准确。

- [ ] **Step 5: 提交聚合行迁移**

```bash
git add src/components/trades/MissedOpportunityRow.tsx src/views/MissedOpportunitiesView.css src/views/MissedOpportunitiesView.browser.test.tsx
git commit -m "style: align missed opportunities with trade rows"
```

---

### Task 4: 响应式、焦点返回与工具栏联合回归

**Files:**
- Modify: `src/components/trades/TradeList.css`
- Modify: `src/views/MissedOpportunitiesView.browser.test.tsx`
- Modify only if exposed by tests: `src/components/trades/TradeRowLayout.tsx`
- Preserve: `src/components/trades/MissedOpportunityScopeMenu.tsx`
- Preserve: `src/styles/tokens.css`
- Preserve: `src/views/MissedOpportunitiesContrast.design.test.ts`

**Interfaces:**
- Consumes: Task 2–3 的共享行布局与现有返回锚点。
- Produces: 375–1440px 稳定布局、无焦点高亮的返回恢复、保留当前工具栏按钮修正。

- [ ] **Step 1: 扩展四档 viewport 断言**

在聚合浏览器测试依次设置 1440×900、1024×768、768×1024、375×812，断言：

```tsx
assert(document.documentElement.scrollWidth <= document.documentElement.clientWidth, `${width}px 不得横向溢出`)
assert(resultRow(rootTrade.id).querySelector('[data-missed-source]'), `${width}px 来源文字必须可见`)
if (width === 375) {
  const button = resultRow(rootTrade.id).querySelector<HTMLButtonElement>('.missed-row-menu button')!
  assert(button.getBoundingClientRect().width >= 44 && button.getBoundingClientRect().height >= 44, '移动端菜单命中区不足')
}
```

- [ ] **Step 2: 验证详情返回没有视觉焦点**

沿用现有详情返回场景，焦点恢复后增加：

```tsx
const restored = resultRow(rootTrade.id)
assert(restored.contains(document.activeElement), '详情返回仍必须恢复 DOM 焦点')
assert(getComputedStyle(restored).boxShadow === 'none', '详情返回不得恢复整行亮边')
assert(getComputedStyle(restored, '::after').backgroundColor === 'rgba(0, 0, 0, 0)', '详情返回不得恢复整行底色')
```

- [ ] **Step 3: 验证范围/筛选按钮未回归**

保留 `assertToolbarActionsUseSharedControlStyle()`，继续比较范围、筛选与共享 `.ui-filter-trigger` 的 height、padding、font、border 和 background 计算样式。

- [ ] **Step 4: 运行设计与浏览器回归**

Run: `node scripts/run-regression-tests.mjs --unit-only src/components/trades/TradeList.design.test.ts src/views/MissedOpportunitiesContrast.design.test.ts`

Expected: PASS。

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: 全部浏览器入口 PASS，控制台无未允许错误。

- [ ] **Step 5: 提交响应式修正**

```bash
git add src/components/trades/TradeList.css src/components/trades/TradeRowLayout.tsx src/views/MissedOpportunitiesView.browser.test.tsx src/components/trades/MissedOpportunityScopeMenu.tsx src/styles/tokens.css src/views/MissedOpportunitiesContrast.design.test.ts
git commit -m "fix: complete list row visual unification"
```

---

### Task 5: 全量验证、真实视觉复核与重新打包

**Files:**
- Modify only if verification exposes a defect: files listed in Tasks 1–4
- Review: `docs/superpowers/specs/2026-07-31-list-focus-and-missed-row-unification-design.md`
- Review: `docs/superpowers/plans/2026-07-31-list-focus-and-missed-row-unification.md`

**Interfaces:**
- Consumes: 完成后的共享列表行实现。
- Produces: 通过的自动化证据、视觉截图和 Windows x64 安装包。

- [ ] **Step 1: 运行完整单元与类型检查**

Run: `pnpm typecheck`

Expected: PASS。

Run: `node scripts/run-regression-tests.mjs --unit-only`

Expected: PASS，无失败测试。

- [ ] **Step 2: 运行完整浏览器与生产构建**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: 全部浏览器入口 PASS。

Run: `pnpm build`

Expected: TypeScript、Vite 与 bundle budget 全部 PASS。

- [ ] **Step 3: 真实页面视觉复核**

Run: `pnpm exec vite --host 127.0.0.1 --port 4173`

使用 Playwright 分别打开 `/src/components/trades/TradeRowPresentation.browser.test.html?visual=1` 与 `/src/views/MissedOpportunitiesView.browser.test.html?visual=mobile`，在 1440×900、1024×768、768×1024、375×812 截图检查：

- 标准交易行聚焦后无蓝框、亮边或底色。
- 选中行只有复选框变化。
- 聚合行字段顺序与标准行一致，来源在标签区。
- 聚合行 hover 与标准行 hover 相同。
- 普通项、合并项菜单和详情返回都可操作。

- [ ] **Step 4: 扫描占位符、差异和编码**

Run: `rg -n "TODO|TBD|placeholder|待补|稍后实现" src/components/trades/TradeRowLayout.tsx src/components/trades/TradeRow.tsx src/components/trades/MissedOpportunityRow.tsx src/views/MissedOpportunitiesView.css`

Expected: 无输出。

Run: `git diff --check`

Expected: 无输出；所有改动文件均为 UTF-8 无 BOM。

- [ ] **Step 5: 生成 Windows 安装包**

Run: `pnpm dist:win`

Expected: `release/Trader-Atlas-1.2.62-win-x64.exe` 成功生成，构建与 NSIS 阶段退出码为 0。

- [ ] **Step 6: 校验安装包**

```powershell
$installer = Resolve-Path 'release\Trader-Atlas-1.2.62-win-x64.exe'
Get-Item -LiteralPath $installer | Select-Object FullName, Length, LastWriteTime
Get-FileHash -Algorithm SHA256 -LiteralPath $installer
```

Expected: 修改时间晚于本次实现开始时间，文件非空，SHA-256 可读取。

- [ ] **Step 7: 提交验证修正（若存在）**

若 Step 1–6 没有产生额外修正，不创建空提交；若产生修正，只提交本计划范围内文件：

```bash
git add src/components/trades/TradeRowLayout.tsx src/components/trades/TradeRow.tsx src/components/trades/TradeList.css src/components/trades/TradeList.design.test.ts src/components/trades/TradeRowPresentation.browser.test.tsx src/components/trades/TradeRowPresentation.browser.test.html src/components/trades/MissedOpportunityRow.tsx src/components/trades/MissedOpportunityScopeMenu.tsx src/styles/tokens.css src/views/MissedOpportunitiesView.css src/views/MissedOpportunitiesView.browser.test.tsx src/views/MissedOpportunitiesContrast.design.test.ts
git commit -m "fix: verify unified list row presentation"
```

---

## Final Verification

- 标准行、聚合行、程序焦点、键盘焦点、详情返回和多选均无整行高亮。
- 聚合行与标准行共享相同 DOM 壳层、44px 行高、列几何和响应式规则。
- 来源、错过原因、失效关系和关联数量均位于标准标签区并使用可见文字。
- 范围/筛选按钮继续使用共享工具栏样式。
- 全量单元、浏览器、类型、构建与 bundle budget 通过。
- Windows x64 安装包重新生成并完成 SHA-256 校验。
