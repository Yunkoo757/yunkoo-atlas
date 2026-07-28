# Today Workspace Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“今日工作台”从仪表盘式叠卡改为行动优先、风险按状态升级、统计按需出现的每日工作界面，并消除小字号、低对比和窄窗口首屏不可达问题。

**Architecture:** 保留现有交易工作流、风险计算和持久化模型，只重新组合 `TodayWorkspace` 的呈现顺序。未复核时由周规则卡占据首要位置；已复核时真实行动队列立即出现，正常风险预算收为原生 `details` 护栏，异常风险继续完整展开。视觉优化局限于今日工作台及审查中明确发现的侧栏/主按钮对比度问题。

**Tech Stack:** React 18、TypeScript、原生 CSS、Zustand、Playwright 浏览器契约、Node 测试。

## Global Constraints

- 始终以 UTF-8 无 BOM 读写，保留全部简体中文。
- 不新增依赖，不更换 Inter Atlas UI 字体栈，不改全局数据模型、风险算法或持久化格式。
- 未复核状态的唯一主操作是“确认本周规则”；已复核零待办状态的唯一主操作是“新建交易”；有待办时真实交易必须紧跟状态标题。
- 1024×768、规则已复核且存在一项待办时，首条真实交易无需滚动即可完整可见，底部 y≤680。
- 正常风险状态默认压缩；未配置、覆盖未知、部分覆盖、达到 60% 预算或已触线时保持完整展开。
- 同一待办计数不再由独立 KPI 条、分组标题和页面标题反复表达；队列切换必须使用明确的 tab 语义和选中态。
- 核心内容与操作文字≥13px，辅助中文≥12px；今日工作台普通控件≥32px、主操作≥36px。
- 修复审查发现的 3 个 Axe WCAG AA 对比度问题，不破坏现有深色配色与导航状态色。
- 保留现有键盘快捷键、返回锚点、上下文菜单、星标、交易打开和隐私模式行为。

---

### Task 1: 行动优先的信息架构

**Files:**
- Modify: `src/views/TodayWorkspace.tsx`
- Modify: `src/views/TodayWorkspace.css`
- Modify: `src/components/RiskManagement.browser.test.tsx`

**Interfaces:**
- Consumes: `getTodayWorkflowBuckets()` 的 `active`、`resultPending`、`reviewPending`、`completedToday` 和 `actionCount`。
- Produces: `QueueFilter = 'all' | 'active' | 'resultPending' | 'reviewPending'`；`.today-action-queue`；`[role="tablist"]`；`[role="tab"][aria-selected]`；`.today-queue-empty`。

- [ ] **Step 1: 写入失败的浏览器契约**

在 `RiskManagement.browser.test.tsx` 的工作台初始断言中加入：

```ts
const queue = document.querySelector<HTMLElement>('[data-today-action-queue]')
assert(queue, '今日工作台缺少真实行动队列')
assert(
  preparation.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING,
  '未复核时准备卡必须位于行动队列之前',
)
assert(!document.querySelector('.today-focus .empty-btn'), '未复核时不得同时突出新建交易')
assert(!document.querySelector('.today-stats'), '没有平仓结果时不得渲染空战绩卡')
```

确认规则后加入：

```ts
const reviewedQueue = document.querySelector<HTMLElement>('[data-today-action-queue]')
const reviewedCard = document.querySelector<HTMLElement>('[data-risk-preparation]')
assert(reviewedQueue && reviewedCard, '复核后工作台结构不完整')
assert(
  reviewedQueue.compareDocumentPosition(reviewedCard) & Node.DOCUMENT_POSITION_FOLLOWING,
  '复核后真实行动队列必须位于风险摘要之前',
)
assert(document.querySelector('.today-focus .empty-btn'), '复核后必须恢复新建交易主操作')
const tabs = [...reviewedQueue.querySelectorAll<HTMLElement>('[role="tab"]')]
assert(tabs.length === 4, '行动队列必须提供全部与三类状态筛选')
assert(tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length === 1, '行动队列必须只有一个选中筛选')
```

- [ ] **Step 2: 运行浏览器契约确认失败**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`
Expected: FAIL，缺少 `data-today-action-queue` 或未复核状态仍显示“新建交易”。

- [ ] **Step 3: 实现状态感知的工作台顺序**

在 `TodayWorkspace.tsx` 中引入 `weekStartFor` 与 `parseLocalDate`，从 `weeklyRiskPreparations` 计算：

```ts
const currentWeekStart = weekStartFor(parseLocalDate(today))
const currentPreparation = weeklyRiskPreparations.find((item) => item.weekStart === currentWeekStart)
const riskReviewed = Boolean(currentPreparation?.reviewedAt && currentPreparation.confirmedPolicyVersionId)
```

新增：

```ts
type QueueFilter = 'all' | (typeof WORKFLOW_GROUPS)[number]['key']
const [queueFilter, setQueueFilter] = useState<QueueFilter>('all')
const visibleWorkflowGroups = WORKFLOW_GROUPS.filter(({ key }) =>
  queueFilter === 'all' || queueFilter === key,
)
```

渲染顺序必须为：

```tsx
<section className="today-focus">...</section>
{!riskReviewed ? <WeeklyRiskPreparationCard currentTradingDayKey={today} /> : null}
<section className="today-action-queue" data-today-action-queue>...</section>
{riskReviewed ? <WeeklyRiskPreparationCard currentTradingDayKey={today} /> : null}
<RiskBudgetCard currentTradingDayKey={today} compactWhenNormal />
{!todayStatsEmpty ? <section className="today-stats">...</section> : null}
{buckets.completedToday.length > 0 ? <section className="today-completed">...</section> : null}
```

未复核时标题改为“先完成本周风险准备”，不渲染“新建交易”；其余状态保持“还有 N 项需要处理 / 今日交易已完成闭环”。行动队列内部使用一个 tablist：全部、进行中、待结果、待复盘；选中 tab 过滤当前列表。分组标题不再重复显示数量，零待办使用紧凑 `.today-queue-empty`，不再使用通用大空状态。

- [ ] **Step 4: 收敛队列 CSS**

在 `TodayWorkspace.css` 中让 `.today-action-queue` 成为连续列表区域；tab 高度 32px、字号 13px；交易分组间距≤18px；移除旧 `.today-queue-overview` 的三列 KPI 卡样式；零态高度≤72px。

- [ ] **Step 5: 运行覆盖测试**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`
Expected: PASS。
Run: `node scripts/run-regression-tests.mjs`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/views/TodayWorkspace.tsx src/views/TodayWorkspace.css src/components/RiskManagement.browser.test.tsx
git commit -m "feat: prioritize today action queue"
```

---

### Task 2: 风险护栏的渐进披露

**Files:**
- Modify: `src/components/RiskBudgetCard.tsx`
- Modify: `src/components/RiskBudgetCard.css`
- Modify: `src/components/WeeklyRiskPreparationCard.tsx`
- Modify: `src/components/WeeklyRiskPreparationCard.css`
- Modify: `src/components/RiskManagement.browser.test.tsx`

**Interfaces:**
- Consumes: Task 1 传入的 `compactWhenNormal`。
- Produces: `data-risk-display="compact" | "attention"`；`.risk-budget-summary`；原生 `<details>`；保留既有三个 `role="progressbar"`。

- [ ] **Step 1: 写入失败的风险呈现契约**

在浏览器测试中把风险状态恢复为仅有计划中交易、有效规则和月度上限，断言：

```ts
useStore.setState({ trades: [trade('target', 'planned')], riskPolicyVersions: [policy], monthlyRiskLimits: [monthlyLimit] })
await waitFor(() => budget.getAttribute('data-risk-display') === 'compact', '正常风险没有压缩')
const details = budget.querySelector<HTMLDetailsElement>('details')
assert(details && !details.open, '正常风险详情必须默认收起')
assert(budget.textContent?.includes('今日剩余 2.0R'), '风险护栏必须直接显示今日剩余')
```

恢复 unknown 交易后断言 `data-risk-display="attention"` 且三个进度条直接可见。

- [ ] **Step 2: 运行浏览器契约确认失败**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`
Expected: FAIL，组件尚无 `compactWhenNormal` 与 `data-risk-display`。

- [ ] **Step 3: 实现自动呈现模式**

在 `RiskBudgetCard` 增加：

```ts
compactWhenNormal?: boolean
```

定义：

```ts
const needsAttention = !policy || ROWS.some(({ scope }) => {
  const outcome = outcomes[scope]
  return outcome.coverage !== 'complete' || outcome.limitR <= 0 || outcome.triggered || outcome.progress >= 0.6
})
const compact = Boolean(compactWhenNormal && !needsAttention)
```

`compact` 时使用默认关闭的原生 `<details>`；`summary` 直接显示“风险护栏”“今日剩余 xR”“本周 xR”“本月 xR”“查看详情”。展开体继续复用现有 `RiskMeter` 与纪律说明。`attention` 时保持现有完整内容，不能把未知、部分覆盖或接近限额折叠掉。

- [ ] **Step 4: 压缩已复核周规则**

已复核摘要只保留一行标题和一行：

```tsx
<p>日 {daily} · 周 {weekly} · 本月 {currentMonth}</p>
```

未来生效规则仍单独显示；“修改规则”保留。卡片正常高度≤58px，编辑态不变。

- [ ] **Step 5: 完成风险 CSS**

`.risk-budget-card.is-compact` 不使用嵌套指标卡；summary 高度≥44px，核心数字 13px、辅助文本 12px；展开后才渲染三列详细表面。移动端紧凑 summary 允许换行但不得把三张完整预算卡默认纵向堆叠。

- [ ] **Step 6: 运行覆盖测试**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`
Expected: PASS。
Run: `pnpm qa:risk-management-mobile`
Expected: PASS。
Run: `node scripts/run-regression-tests.mjs`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/components/RiskBudgetCard.tsx src/components/RiskBudgetCard.css src/components/WeeklyRiskPreparationCard.tsx src/components/WeeklyRiskPreparationCard.css src/components/RiskManagement.browser.test.tsx
git commit -m "feat: collapse normal risk context"
```

---

### Task 3: 视觉舒适度、对比度与响应式收尾

**Files:**
- Modify: `src/views/TodayWorkspace.css`
- Modify: `src/components/RiskBudgetCard.css`
- Modify: `src/components/WeeklyRiskPreparationCard.css`
- Modify: `src/components/Sidebar.css`
- Modify: `src/components/ui/Button.css`
- Modify: `src/styles/tokens.css`
- Create: `src/views/TodayWorkspace.design.test.ts`

**Interfaces:**
- Consumes: Task 1 的队列类名与 Task 2 的 compact/attention 类名。
- Produces: 今日工作台字号、控件高度、窄窗口排序与对比度的静态设计契约。

- [ ] **Step 1: 写入失败的设计契约**

创建 `TodayWorkspace.design.test.ts`，读取相关 CSS 并断言：

```ts
assert(todayCss.includes('min-height: 32px'), '今日筛选控件不得低于 32px')
assert(todayCss.includes('min-height: 36px'), '今日主操作不得低于 36px')
assert(!/\.today-[^{]+\{[^}]*font-size:\s*var\(--type-caption-size\)/s.test(todayCss), '今日核心界面不得使用 11px caption')
assert(sidebarCss.includes('color: var(--sb-text);'), '侧栏分组标题必须达到正文级对比度')
assert(tokensCss.includes('--accent-text: #fff;'), '主按钮文字必须使用可通过 AA 的纯白')
assert(buttonCss.includes('var(--accent-hover)'), '主按钮悬停必须继续消费可访问的 accent hover token')
```

- [ ] **Step 2: 运行设计契约确认失败**

Run: `node scripts/run-regression-tests.mjs`
Expected: FAIL，当前主操作仍为 28px、caption 仍为 11px、accent text 不是纯白。

- [ ] **Step 3: 调整今日工作台排版与交互尺寸**

- 主操作最小高度 36px；tab、详情、修改按钮最小高度 32px；移动端主操作 44px。
- 标题保持 21–24px；核心交易/风险/操作文字 13px；辅助中文 12px；不在今日工作台消费 11px caption。
- 使用 `font-variant-numeric: tabular-nums` 保持风险和计数对齐。
- 减少外层卡片与内层卡片同时存在的边界；行动列表通过分区线而非圆角卡堆叠。

- [ ] **Step 4: 修复对比度**

在 `Sidebar.css` 将 `.sb-section-label` 的透明混色替换为 `color: var(--sb-text)`；在 `tokens.css` 使用：

```css
--accent-text: #fff;
--accent-hover: color-mix(in srgb, var(--accent) 90%, black 10%);
```

保留 `--accent: #5e6ad2`，避免改变品牌基色。

- [ ] **Step 5: 完成响应式保护**

- 1280 与 1024 下行动列表仍紧跟标题；正常风险 summary 不变成三张纵向卡。
- 899px 以下 tablist 可横向滚动或 2×2 排列，不能形成三张 KPI 纵向长卡。
- 768px 以下保留现有底部导航与 44px 主操作，不产生横向溢出。

- [ ] **Step 6: 运行验证**

Run: `node scripts/run-regression-tests.mjs`
Expected: PASS。
Run: `pnpm qa:risk-management-mobile`
Expected: PASS。
Run: `pnpm build`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/views/TodayWorkspace.css src/components/RiskBudgetCard.css src/components/WeeklyRiskPreparationCard.css src/components/Sidebar.css src/components/ui/Button.css src/styles/tokens.css src/views/TodayWorkspace.design.test.ts
git commit -m "style: refine today workspace hierarchy"
```

---

## Final Verification

- Run: `pnpm test` — 所有基线、浏览器、移动端和治理测试通过。
- Run: `pnpm build` — 类型检查、Vite 构建和 bundle budget 通过。
- 用真实页面分别采集 1440×1000、1280×800、1024×768、800×700 的已复核有待办态截图。
- Axe WCAG 2 A/AA：对比度 violations=0。
- 1024×768：首条真实交易完整可见，底部 y≤680。
- 800×700：正常风险默认紧凑，不再把真实交易标题推到 y=985。
