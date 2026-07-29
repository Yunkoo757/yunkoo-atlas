# Missed Opportunity Aggregate Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将侧栏“错过的机会”改为固定 `/missed` 的跨来源聚合模块，允许用户长期选择交易日志、模拟盘和案例记录的包含范围，并提供明确去重、来源标识、回源跳转和详情返回现场恢复。

**Architecture:** 保留 `Trade`、`TradeKind` 和三个来源工作区的数据所有权；新增纯派生层 `missedOpportunities.ts` 负责命中、排序、明确关系合并和临时筛选，`MissedOpportunitiesView` 只消费派生结果。侧栏继续用 `system:missed.workspaces` 持久化包含范围，但 `missed` 路由固定为 `/missed`，来源工作区本地快捷视图与其解耦。聚合列表复用现有虚拟列表容器，通过可选行渲染器呈现来源感知的只读导航行，不在聚合模块内编辑或改变来源记录。

**Tech Stack:** React 18、TypeScript、React Router 6、Zustand、原生 CSS、TanStack Virtual、Node/Vite 测试、Playwright 浏览器契约。

## Global Constraints

- 始终以 UTF-8 无 BOM 读写，保留全部简体中文。
- 不新增依赖，不新增第四种 `TradeKind`，不迁移、复制或改写来源记录。
- `/missed` 是唯一聚合入口；`/missed/board` 只重定向，不实现跨来源看板。
- `system:missed.workspaces` 仅表示聚合包含范围；`active` 能力仍保持当前按工作区解析的行为。
- 三个来源至少保留一个；旧配置没有 `workspaces` 时默认 `trade`、`paper`、`case` 全开。
- 只按明确 `sourceTradeId` 合并，不按品种、方向、时间、截图或文本相似度推断关系。
- 页面主数和侧栏计数是去重后的聚合项数；来源数是未去重命中数；存在差异时必须显示文字说明。
- 聚合模块只读导航：不提供新建、批量选择、星标、右键编辑、删除或恢复。
- 临时筛选只写 URL 的 `period`、`symbol`、`side`、`missReason`，不得写入 `DisplayPrefs`；全局导航进入 `/missed` 时没有 search，详情返回则保留原 search。
- 普通项整行进入唯一来源；合并项禁止整行猜测跳转，必须提供“打开原始记录”和“打开案例”两个明确动作。
- 375px 下不得横向溢出；合并项更多按钮至少 44×44px；来源始终同时使用文字而非只靠颜色。
- 现有交易日志、模拟盘、案例记录、统计、周复盘、保存视图和策略视图行为不得回归。

## File Map

- `src/lib/missedOpportunities.ts`：新增纯派生领域层，定义来源、聚合项、计数、排序、失效关系和临时筛选。
- `src/lib/missedOpportunities.test.ts`：覆盖七种来源组合、明确关系合并、删除/恢复、稳定排序、过滤和计数。
- `src/lib/sidebarWorkspace.ts`：固定 `missed` 导航、约束至少一个来源、计算去重侧栏数量；保留 `active` 旧行为。
- `src/lib/workspaceViews.ts`：让来源工作区本地“错过机会”快捷视图不再受聚合范围控制。
- `src/components/Sidebar.tsx`、`src/components/sidebar/SidebarTargetPicker.tsx`：把 `missed` 的“可见工作区”文案和交互改为“包含范围”，反馈最后一项不能关闭。
- `src/views/MissedOpportunitiesView.tsx`：聚合页面编排、来源范围、数量说明、临时筛选、空状态、回源导航和 live region。
- `src/views/MissedOpportunitiesView.css`：聚合头部、范围条、列表行、桌面/移动响应式和状态样式。
- `src/components/trades/MissedOpportunityFilters.tsx`：复用 `FilterBar`、`Select` 和现有筛选视觉，管理四个 URL 临时条件。
- `src/components/trades/MissedOpportunityRow.tsx`：来源文字标签、普通/合并项动作、失效来源提示和移动端菜单。
- `src/components/trades/TradeList.tsx`：仅增加向后兼容的 `renderRow` 与 `selectionEnabled` 扩展，继续提供虚拟化和返回锚点注册。
- `src/hooks/useTradeReturnAnchor.ts`：在滚动恢复后恢复焦点，并为目标消失提供安全回退回调。
- `src/lib/tradeRoute.ts`、`src/views/DetailView.tsx`：允许三种记录从 `/missed` 返回，并显示“返回错过的机会”的明确上下文。
- `src/App.tsx`：接入聚合页并重定向旧看板路径。
- `src/regression.test.ts`、`src/lib/workspaceFacetConsistency.test.ts`：更新静态/纯函数回归契约。
- `src/views/MissedOpportunitiesView.browser.test.tsx`、`src/views/MissedOpportunitiesView.browser.test.html`：覆盖真实交互、导航返回、响应式和可访问性。

---

### Task 1: 建立跨来源聚合与筛选的纯领域契约

**Files:**
- Create: `src/lib/missedOpportunities.ts`
- Create: `src/lib/missedOpportunities.test.ts`

**Interfaces:**
- Consumes: `Trade[]`、`BusinessDateAnchor`、`CalendarPeriod`、`Trade.sourceTradeId`、`Trade.deletedAt`。
- Produces: `MissedOpportunitySource`、`MissedOpportunityFilters`、`MissedOpportunityItem`、`MissedOpportunitySummary`、`buildMissedOpportunitySummary()`、`filterMissedOpportunityItems()`、`parseMissedOpportunityFilters()`。

- [ ] **Step 1: 写入七种来源组合和命中条件的失败测试**

在 `src/lib/missedOpportunities.test.ts` 创建最小 `trade()` fixture，分别构造 live missed、paper missed、case missed，以及不应命中的 live win、普通 case 和已删除记录。用所有七种非空来源组合断言 item 来源和 raw count：

```ts
const combinations: MissedOpportunitySource[][] = [
  ['trade'], ['paper'], ['case'],
  ['trade', 'paper'], ['trade', 'case'], ['paper', 'case'],
  ['trade', 'paper', 'case'],
]

for (const sources of combinations) {
  const summary = buildMissedOpportunitySummary(records, sources)
  const expected = sources.filter((source) => source !== 'case' || true).length
  assert(summary.items.length === expected, `${sources.join('+')} 聚合数量错误`)
  assert(summary.rawTotal === expected, `${sources.join('+')} 原始数量错误`)
}
```

测试还必须断言 live/paper 使用 `status === 'missed'`，case 使用 `caseType === 'missed'`，任何 `deletedAt` 记录都不计入结果。

- [ ] **Step 2: 运行领域测试确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/missedOpportunities.test.ts`
Expected: FAIL，测试入口无法解析 `@/lib/missedOpportunities`。

- [ ] **Step 3: 实现来源命中、业务时间和稳定排序**

新增以下公开类型：

```ts
export const MISSED_OPPORTUNITY_SOURCES = ['trade', 'paper', 'case'] as const
export type MissedOpportunitySource = (typeof MISSED_OPPORTUNITY_SOURCES)[number]

export type MissedOpportunityItem = {
  key: string
  source: MissedOpportunitySource
  primary: Trade
  linkedCases: Trade[]
  occurredAt: string
  missingSourceId?: string
}

export type MissedOpportunitySummary = {
  items: MissedOpportunityItem[]
  rawCounts: Record<MissedOpportunitySource, number>
  rawTotal: number
  aggregateTotal: number
}
```

实现严格命中和业务时间：

```ts
export function missedOpportunitySourceOf(trade: Trade): MissedOpportunitySource | null {
  if (trade.deletedAt) return null
  if (trade.tradeKind === 'live' && trade.status === 'missed') return 'trade'
  if (trade.tradeKind === 'paper' && trade.status === 'missed') return 'paper'
  if (trade.tradeKind === 'case' && trade.caseType === 'missed') return 'case'
  return null
}

export function missedOpportunityOccurredAt(trade: Trade): string {
  return trade.tradeKind === 'case'
    ? trade.recordedAt ?? trade.openedAt
    : trade.closedAt ?? trade.openedAt
}
```

排序必须按 `occurredAt` 倒序，时间相同时调用 `left.key.localeCompare(right.key, 'en')`，不得依赖输入数组顺序。

- [ ] **Step 4: 写入明确关系合并、非模糊合并和失效关系的失败测试**

覆盖：

```ts
assert(merged.items.length === 1, '明确来源关系应合并成一个聚合项')
assert(merged.items[0]?.linkedCases[0]?.id === linkedCase.id, '合并项必须保留案例入口')
assert(unrelated.items.length === 2, '同品种同方向同时间但无 sourceTradeId 时不得合并')
assert(excludedOrigin.items.some((item) => item.primary.id === linkedCase.id), '未包含来源不得被后台拉入')
assert(deletedOrigin.items[0]?.missingSourceId === deletedSource.id, '来源删除后案例必须显示失效追溯')
assert(caseDeleted.items[0]?.linkedCases.length === 0, '案例删除后根项必须退化为普通项')
```

同一来源存在多个关联案例时，全部收进按 `recordedAt ?? openedAt` 倒序的 `linkedCases`，不得静默丢弃。

- [ ] **Step 5: 实现只按 `sourceTradeId` 的合并**

先构造所选范围内未删除 live/paper missed 根记录 Map，再处理 case：

```ts
const rootsById = new Map(
  sourceRecords
    .filter((trade) => trade.tradeKind !== 'case')
    .map((trade) => [trade.id, createRootItem(trade)]),
)

for (const reviewCase of sourceRecords.filter((trade) => trade.tradeKind === 'case')) {
  const root = reviewCase.sourceTradeId ? rootsById.get(reviewCase.sourceTradeId) : undefined
  if (root) root.linkedCases.push(reviewCase)
  else items.push(createStandaloneCase(reviewCase, allById.get(reviewCase.sourceTradeId ?? '')?.deletedAt))
}
```

`aggregateTotal` 等于合并后 items 数；`rawCounts` 和 `rawTotal` 在合并前计算。来源未包含但仍存在时，案例独立显示且不标“来源记录已删除”；只有能在全量数据中找到 `deletedAt` 来源时才写 `missingSourceId`。

- [ ] **Step 6: 写入并实现四类临时筛选测试**

新增：

```ts
export type MissedOpportunityFilters = {
  period?: CalendarPeriod
  symbol?: string
  side?: TradeSide
  missReason?: MissReason
}
```

`parseMissedOpportunityFilters()` 只接受合法 `period`、`side`、`missReason`，忽略未知值。`filterMissedOpportunityItems()` 对聚合项 `primary` 的品种、方向、错过原因和 `occurredAt` 过滤；日期使用 `getPeriodBounds()` 与 `isDateInRange()`，并接受 `BusinessDateAnchor`，确保“今日”遵循现有交易日起始小时。

- [ ] **Step 7: 运行领域测试并提交**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/missedOpportunities.test.ts`
Expected: PASS。

```bash
git add src/lib/missedOpportunities.ts src/lib/missedOpportunities.test.ts
git commit -m "feat: derive missed opportunity aggregate"
```

---

### Task 2: 固定侧栏入口并将配置语义改为包含范围

**Files:**
- Modify: `src/lib/sidebarWorkspace.ts`
- Modify: `src/lib/workspaceViews.ts`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/sidebar/SidebarTargetPicker.tsx`
- Modify: `src/regression.test.ts`
- Modify: `src/lib/workspaceFacetConsistency.test.ts`

**Interfaces:**
- Consumes: `system:missed.workspaces`、`SidebarCountContext.trades`、`setCapabilityWorkspaceEnabled()`。
- Produces: 固定 `{ pathname: '/missed', search: '', icon: 'missed' }`；去重侧栏计数；“包含范围”交互；最后一个来源保护。

- [ ] **Step 1: 将旧动态导航断言改成固定路由失败契约**

更新 `testCapabilityPinsStaySingleWithWorkspaceVisibility()`：

```ts
for (const currentPathname of ['/list', '/sim', '/review-cases', '/settings', '/dashboard']) {
  const resolved = resolveSidebarWorkspaceItem(missedItem, sources, currentPathname)
  assert(resolved.pathname === '/missed' && resolved.search === '', `${currentPathname} 必须固定进入聚合页`)
}

const kept = setCapabilityWorkspaceEnabled([missedItem], 'missed', 'trade', false)
assert(kept === keptAfterRemovingPaperAndCase, '关闭最后一个 missed 来源必须保持原状态')
```

同时保留一条 `active` 从 `/sim` 解析到 `/sim?status=open` 的断言，防止误把另一能力也固定化。

- [ ] **Step 2: 写入本地快捷视图不受包含范围影响的失败测试**

在 `workspaceFacetConsistency.test.ts` 中以只包含 `trade` 的 `system:missed` 配置调用 `getWorkspacePrimaryViews('paper', items)` 和 `getWorkspacePrimaryViews('case', items)`，断言两者仍包含 `id === 'missed'`；`active` 的现有可见范围过滤保持不变。

- [ ] **Step 3: 运行两个测试入口确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts src/lib/workspaceFacetConsistency.test.ts`
Expected: FAIL，`missed` 仍随当前工作区跳转且本地快捷视图被隐藏。

- [ ] **Step 4: 固定 missed 路由并保护最后一个来源**

在 `sidebarWorkspace.ts` 集中定义：

```ts
const MISSED_AGGREGATE_ROUTE = { pathname: '/missed', search: '', icon: 'missed' } as const

export function resolveCapabilityNavRoute(capability, workspaces, currentPathname = '/list') {
  if (capability === 'missed') return MISSED_AGGREGATE_ROUTE
  // active 保留当前 workspace 优先与首个已启用 workspace 回退逻辑
}
```

`capabilityNavRoutes('missed', workspaces)` 始终只返回一次 `/missed`。`setCapabilityWorkspaceEnabled()` 在 `capability === 'missed' && nextWorkspaces.length === 0` 时直接返回原数组；`active` 全部关闭仍沿用移除侧栏项的旧行为。

`resolveSidebarSelection()` 因候选路由只剩 `/missed`，在 `/sim?status=missed` 和 `/review-cases?caseType=missed` 不得高亮聚合入口。

- [ ] **Step 5: 解耦来源工作区本地错过快捷视图**

在 `filterViewsBySidebarCapabilities()` 中仅跳过 `missed` 的侧栏范围过滤：

```ts
const capability = capabilityForWorkspaceViewId(view.id)
if (!capability || capability === 'missed') return true
return isCapabilityEnabledForWorkspace(sidebarItems, capability, workspace)
```

不得删除 paper/case 的 `PRIMARY_VIEWS.missed`。

- [ ] **Step 6: 接入去重侧栏计数**

在 `countSidebarTarget()` 中仅对 `system:missed` 特判：

```ts
if (target.item.target.kind === 'system' && target.item.target.id === 'missed') {
  return buildMissedOpportunitySummary(
    context.trades,
    systemCapabilityWorkspaces(target.item.target),
  ).aggregateTotal
}
```

删除 `/missed` 作为 live-only `ListFilter` 的计数依赖；其他系统项继续走 `countSidebarRoute()`。

- [ ] **Step 7: 把 missed 配置文案改为“包含范围”并反馈最后一项**

`SidebarTargetPicker` 与侧栏三点菜单根据 capability 分支：

```ts
const scopeLabel = capability.id === 'missed' ? '包含范围' : '可见工作区'
const scopeAriaLabel = `${capability.label}${scopeLabel}`
```

尝试关闭最后一个 missed 来源且 `setCapabilityWorkspaceEnabled()` 返回同一数组时，显示/Toast：“至少保留一个包含来源”。侧栏按钮 aria-label 改为“错过的机会包含范围”；`active` 仍使用“进行中可见工作区”。

- [ ] **Step 8: 运行侧栏回归和 QA 并提交**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts src/lib/workspaceFacetConsistency.test.ts`
Expected: PASS。
Run: `pnpm qa:sidebar`
Expected: PASS；若脚本包含旧“可见工作区”选择器，同步改成 missed“包含范围”、active“可见工作区”的精确断言。

```bash
git add src/lib/sidebarWorkspace.ts src/lib/workspaceViews.ts src/components/Sidebar.tsx src/components/sidebar/SidebarTargetPicker.tsx src/regression.test.ts src/lib/workspaceFacetConsistency.test.ts scripts/qa-sidebar-navigation.mjs
git commit -m "fix: stabilize missed opportunity navigation"
```

---

### Task 3: 接入独立聚合页面、范围摘要与临时筛选

**Files:**
- Create: `src/views/MissedOpportunitiesView.tsx`
- Create: `src/views/MissedOpportunitiesView.css`
- Create: `src/components/trades/MissedOpportunityFilters.tsx`
- Modify: `src/App.tsx`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes: `useStore(state => state.trades)`、`display.sidebarWorkspaceItems`、`replaceSidebarWorkspaceItems()`、`useBusinessDateAnchor()`、URL search。
- Produces: `/missed` 页面；`/missed/board → /missed`；`data-missed-scope`、`data-missed-total`、`data-missed-results`；四类 URL 筛选。

- [ ] **Step 1: 写入路由和页面结构失败契约**

在 `regression.test.ts` 替换 live-only 路由断言：

```ts
assert(app.includes('<MissedOpportunitiesView />'), '/missed 必须接入独立聚合页')
assert(app.includes('path="/missed/board"') && app.includes('to="/missed"'), '旧看板路径必须重定向')
assert(!missedRouteBlock.includes("filter={{ type: 'missed', tradeKind: 'live' }}"), '聚合入口不得再伪装成实盘列表')
assert(missedView.includes('showDisplay={false}'), '聚合页不得显示交易列表展示设置')
assert(!missedView.includes('onView='), '聚合页不得暗示存在列表/看板切换')
```

为新 view 源码加静态契约：标题、副标题、“管理包含范围”、去重总数、来源原始计数、差异说明和 live region 均存在。

- [ ] **Step 2: 运行回归确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts`
Expected: FAIL，`/missed` 仍渲染 `TradesPage`。

- [ ] **Step 3: 接入固定路由和基础页面**

在 `App.tsx` lazy-load：

```tsx
const MissedOpportunitiesView = lazy(() =>
  import('./views/MissedOpportunitiesView').then((module) => ({ default: module.MissedOpportunitiesView })),
)

<Route path="/missed" element={<MissedOpportunitiesView />} />
<Route path="/missed/board" element={<Navigate to="/missed" replace />} />
```

`MissedOpportunitiesView` 从 `system:missed` 项读取 `systemCapabilityWorkspaces()`；找不到项时使用 `MISSED_OPPORTUNITY_SOURCES`，但不静默创建侧栏项。页面使用 `<Topbar title="错过的机会" subtitle="来自你选择的工作区" showDisplay={false} />`，不传 `view` 或 `onView`，因此不会显示展示设置或列表/看板切换。页面顶部结构固定为：标题/副标题、管理入口、三个范围按钮与原始数量、主总数、差异说明、筛选条、列表或空状态。

- [ ] **Step 4: 实现范围按钮与持久化**

范围按钮直接复用 `setCapabilityWorkspaceEnabled()` 和 `replaceSidebarWorkspaceItems()`：

```ts
const toggleSource = (source: MissedOpportunitySource) => {
  const previous = useStore.getState().display.sidebarWorkspaceItems
  const next = setCapabilityWorkspaceEnabled(previous, 'missed', source, !sources.includes(source))
  if (next === previous) {
    toast('至少保留一个包含来源')
    return
  }
  replaceSidebarWorkspaceItems(next)
}
```

每个按钮使用 `aria-pressed`，可见文案为“交易日志 N”“模拟盘 N”“案例记录 N”；入口文字为“管理包含范围”。来源切换是长期范围变更，不清除当前临时筛选。

- [ ] **Step 5: 实现四类 URL 临时筛选**

`MissedOpportunityFilters` 只读写 `period`、`symbol`、`side`、`missReason`，复用 `FilterBar`、`Select`、`PERIOD_LABELS`、`MISS_REASON_META` 和 `collectSymbolOptions()`。清除操作必须保留 pathname 并删除全部四个键：

```ts
const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true })
const setParam = (key: keyof MissedOpportunityFilters, value: string) => {
  const next = new URLSearchParams(searchParams)
  value ? next.set(key, value) : next.delete(key)
  setSearchParams(next, { replace: true })
}
```

未知 query 参数不参与筛选，并显示“未支持的筛选条件，可移除”，与现有筛选器保持一致。

- [ ] **Step 6: 实现数量与两类空状态**

- 主数显示 `visibleItems.length`；无临时筛选时等于 `summary.aggregateTotal`。
- 来源 chip 显示 `summary.rawCounts[source]`，不因临时筛选改变，避免把范围基数和结果数混为一谈。
- `summary.rawTotal > summary.aggregateTotal` 时显示“跨工作区关联项已合并”。
- 有范围数据但筛选后为零：显示“当前筛选下没有记录”与“清除筛选”。
- 所选来源原始总数为零：逐项说明所含来源，并提供到 `/list`、`/sim`、`/review-cases` 的链接，不提供聚合页新建按钮。
- 筛选或范围改变时 `<span aria-live="polite">当前显示 N 条错过机会</span>`。

- [ ] **Step 7: 运行回归和类型检查并提交**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts src/lib/missedOpportunities.test.ts`
Expected: PASS。
Run: `pnpm typecheck`
Expected: PASS。

```bash
git add src/App.tsx src/views/MissedOpportunitiesView.tsx src/views/MissedOpportunitiesView.css src/components/trades/MissedOpportunityFilters.tsx src/regression.test.ts
git commit -m "feat: add missed opportunity workspace"
```

---

### Task 4: 复用虚拟列表并实现来源感知的回源行

**Files:**
- Create: `src/components/trades/MissedOpportunityRow.tsx`
- Modify: `src/components/trades/TradeList.tsx`
- Modify: `src/components/trades/TradeList.css`
- Modify: `src/views/MissedOpportunitiesView.tsx`
- Modify: `src/views/MissedOpportunitiesView.css`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes: `MissedOpportunityItem`、`TradeListGroup`、现有 `registerTradeScrollTarget()`。
- Produces: `TradeListRowRenderContext`、`renderRow?`、`selectionEnabled?`；普通项唯一回源；合并项显式双动作；来源删除状态。

- [ ] **Step 1: 写入 TradeList 向后兼容和聚合行失败契约**

在 `regression.test.ts` 断言：

```ts
assert(tradeList.includes('renderRow?:'), '虚拟列表必须支持聚合自定义行')
assert(tradeList.includes('selectionEnabled = true'), '现有列表默认仍允许选择')
assert(missedRow.includes('data-missed-source'), '聚合行必须显示文字来源')
assert(missedRow.includes('打开原始记录'), '合并项缺少原始记录动作')
assert(missedRow.includes('打开案例'), '合并项缺少案例动作')
assert(missedRow.includes('来源记录已删除'), '失效来源没有可见状态')
```

- [ ] **Step 2: 运行回归确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts`
Expected: FAIL，缺少自定义行渲染和来源行。

- [ ] **Step 3: 为 TradeList 增加最小向后兼容扩展**

新增：

```ts
export type TradeListRowRenderContext = {
  focused: boolean
  strategyStats: StrategyPreviewStats | null
  symbolIcons: SymbolIconsMap
}

renderRow?: (trade: Trade, context: TradeListRowRenderContext) => ReactNode
selectionEnabled?: boolean
```

`selectionEnabled` 默认 `true`；为 `false` 时不渲染移动端“选择”按钮。虚拟行分支优先调用 `renderRow`，否则原样渲染 `TradeRow`。不得改变 `ROW_HEIGHT`、overscan、sticky header、滚动目标注册和现有调用方默认行为。

- [ ] **Step 4: 实现普通、合并和失效三类行**

`MissedOpportunityRow` props：

```ts
type MissedOpportunityRowProps = {
  item: MissedOpportunityItem
  strategies: Strategy[]
  focused: boolean
  symbolIcons: SymbolIconsMap
  onOpen: (target: Trade, anchorId: string) => void
}
```

普通项渲染 `data-trade-id={item.key}` 和覆盖整行的按钮，aria-label 使用“打开 XAUUSD 交易记录/模拟记录/案例记录”。合并项不渲染整行覆盖按钮，桌面端依次渲染“打开原始记录”“打开案例”；`linkedCases.length > 1` 时第二动作显示“打开案例（N）”并在现有 `Menu` 中列出每个案例编号，防止重复来源关系导致数据不可达。`missingSourceId` 存在时显示“来源记录已删除”，且只允许打开当前案例。

来源标签文本固定为“交易日志”“模拟盘”“案例记录”；miss reason 显示 `MISS_REASON_META[item.primary.missReason ?? 'other'].label`。摘要优先显示 `symbol + side + strategy`，时间显示 `occurredAt`。

- [ ] **Step 5: 把聚合项接入虚拟列表**

在 view 中建立 `itemByPrimaryId`，传入单一无标题 group：

```tsx
<TradeList
  groups={[{ key: 'missed-opportunities', items: visibleItems.map((item) => item.primary) }]}
  strategies={strategies}
  focusedId={null}
  selectedIds={EMPTY_SELECTION}
  starredIds={[]}
  scrollParentRef={listScrollRef}
  selectionEnabled={false}
  renderRow={(trade, context) => (
    <MissedOpportunityRow
      item={itemByPrimaryId.get(trade.id)!}
      strategies={strategies}
      focused={context.focused}
      symbolIcons={context.symbolIcons}
      onOpen={openSourceDetail}
    />
  )}
  onOpen={() => undefined}
  onSelect={() => undefined}
  onClearSelection={() => undefined}
  onToggleStar={() => undefined}
  onContextMenu={() => undefined}
  onCreate={() => undefined}
/>
```

`openSourceDetail(target, anchorId)` 的返回锚点必须使用聚合 item key，而不是案例 id：

```ts
const from = { pathname: location.pathname, search: location.search, anchorTradeId: anchorId }
rememberTradeReturnAnchor(from)
navigate(tradeDetailPath(target), { state: tradeDetailNavState(from) })
```

- [ ] **Step 6: 完成桌面与移动布局 CSS**

- 桌面行高保持 44px；来源标签最小宽度 64px；操作区不挤压品种；摘要使用 `min-width: 0` 与省略号。
- 低于 720px 时行高改为自动、最小 76px；首行显示来源/品种/方向/时间，摘要第二行最多两行。
- 合并项在低于 720px 时隐藏两个桌面动作，显示至少 44×44px 的“更多”菜单按钮；普通项整行仍可点击。
- 使用 `overflow-wrap: anywhere` 保护超长 symbol/ref，不给页面增加横向滚动。

- [ ] **Step 7: 运行回归、类型检查并提交**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts`
Expected: PASS。
Run: `pnpm typecheck`
Expected: PASS。

```bash
git add src/components/trades/MissedOpportunityRow.tsx src/components/trades/TradeList.tsx src/components/trades/TradeList.css src/views/MissedOpportunitiesView.tsx src/views/MissedOpportunitiesView.css src/regression.test.ts
git commit -m "feat: add source aware missed rows"
```

---

### Task 5: 恢复详情返回筛选、滚动与焦点

**Files:**
- Modify: `src/lib/tradeRoute.ts`
- Modify: `src/hooks/useTradeReturnAnchor.ts`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/views/MissedOpportunitiesView.tsx`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes: `TradeDetailFrom`、`tradeDetailNavState()`、`tradeReturnLocationState()`、`data-trade-id`。
- Produces: `/missed` 对所有 `tradeKind` 的合法返回；`UseTradeReturnAnchorOptions`；焦点恢复与安全回退；详情面包屑“错过的机会”。

- [ ] **Step 1: 写入三种来源返回与外链兜底失败测试**

为 `resolveTradeDetailReturn()` 增加：

```ts
for (const tradeKind of ['live', 'paper', 'case'] as const) {
  const target = resolveTradeDetailReturn({
    from: { pathname: '/missed', search: '?symbol=XAUUSD&side=long', anchorTradeId: 'root-1' },
    tradeKind,
  })
  assert(target.pathname === '/missed', `${tradeKind} 必须能返回聚合页`)
  assert(target.search === '?symbol=XAUUSD&side=long', `${tradeKind} 必须保留聚合筛选`)
}
assert(
  resolveTradeDetailReturn({ tradeKind: 'case' }).pathname === '/review-cases',
  '无 from 的外链案例不得伪造聚合返回路径',
)
```

再增加源码契约，要求详情在 `from.pathname === '/missed'` 时显示“错过的机会”，并要求返回锚点逻辑执行 `.focus()`。

- [ ] **Step 2: 运行回归确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts`
Expected: FAIL，case 来源会拒绝 `/missed`，现有恢复只滚动不聚焦。

- [ ] **Step 3: 允许聚合来源并修正详情上下文**

在 `isValidDetailSource()` 最前面加入：

```ts
if (pathname === '/missed') return true
```

在 `DetailView` 中根据 `from?.pathname` 派生：

```ts
const fromMissedOpportunities = from?.pathname === '/missed'
const detailCrumb = fromMissedOpportunities
  ? '错过的机会'
  : trade.tradeKind === 'case'
    ? '案例记录'
    : trade.tradeKind === 'paper'
      ? '模拟'
      : '交易日志'
```

返回链接 aria-label 同步为 `fromMissedOpportunities ? '返回错过的机会' : '返回列表'`。

- [ ] **Step 4: 扩展返回锚点恢复焦点和目标消失回退**

新增向后兼容接口：

```ts
export type UseTradeReturnAnchorOptions = {
  onMissing?: (tradeId: string) => void
}

export function useTradeReturnAnchor(options: UseTradeReturnAnchorOptions = {}): void
```

找到 `[data-trade-id]` 后滚动，并优先聚焦 `[data-trade-primary-action]`，否则聚焦行内第一个 button：

```ts
const focusTarget = target.querySelector<HTMLElement>('[data-trade-primary-action], button, a')
focusTarget?.focus({ preventScroll: true })
target.scrollIntoView({ block: 'center' })
```

超过 `MAX_RESTORE_FRAMES` 仍找不到时调用 `options.onMissing?.(pending.tradeId)` 后清理 state。普通 ListView 无参调用行为保持兼容。

- [ ] **Step 5: 在聚合页实现安全焦点回退**

标题使用 `ref`、`tabIndex={-1}`。`onMissing` 聚焦标题并把 live region 文案改为“原记录已变化，已返回错过的机会列表”。普通项覆盖按钮、合并项首个动作均加 `data-trade-primary-action`。

- [ ] **Step 6: 运行回归和类型检查并提交**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts`
Expected: PASS。
Run: `pnpm typecheck`
Expected: PASS。

```bash
git add src/lib/tradeRoute.ts src/hooks/useTradeReturnAnchor.ts src/views/DetailView.tsx src/views/MissedOpportunitiesView.tsx src/regression.test.ts
git commit -m "fix: restore missed opportunity browsing context"
```

---

### Task 6: 用浏览器契约覆盖完整心流、响应式和可访问性

**Files:**
- Create: `src/views/MissedOpportunitiesView.browser.test.tsx`
- Create: `src/views/MissedOpportunitiesView.browser.test.html`
- Modify: `src/views/MissedOpportunitiesView.tsx`
- Modify: `src/views/MissedOpportunitiesView.css`
- Modify: `src/components/trades/MissedOpportunityRow.tsx`

**Interfaces:**
- Consumes: `MemoryRouter`、Zustand 测试状态、`window.__missedOpportunitiesBrowserTest`、375px viewport。
- Produces: 范围切换、筛选、普通/合并跳转、返回、空状态、键盘与无溢出的浏览器证据。

- [ ] **Step 1: 创建浏览器 fixture 和失败契约**

HTML 入口使用标准 discoverable contract：

```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
  <body><div id="root"></div><script type="module" src="/src/views/MissedOpportunitiesView.browser.test.tsx"></script></body>
</html>
```

TSX 中写入 live missed、paper missed、linked case、unlinked case、deleted origin + surviving case，挂载包含 `/missed` 与 `/trade/:id` 的 MemoryRouter，并暴露：

```ts
declare global {
  interface Window { __missedOpportunitiesBrowserTest: Promise<void> }
}
```

- [ ] **Step 2: 覆盖范围、计数、合并与临时筛选**

浏览器断言必须包含：

- 初始标题和副标题准确，三个来源按钮带 `aria-pressed="true"`。
- raw 来源和大于主数时出现“跨工作区关联项已合并”。
- 明确关联只渲染一个聚合行，并同时存在两个动作；未关联 case 独立。
- 关闭 paper 后 paper 行消失但 `/sim` 本地数据未被修改。
- 尝试关闭最后一个来源后仍有一个 `aria-pressed="true"`，状态反馈包含“至少保留一个包含来源”。
- 选择品种、方向、日期、原因后 URL 只出现四个允许键，live region 报告可见数量；清除筛选恢复结果。

- [ ] **Step 3: 覆盖回源与返回现场**

点击普通模拟项应进入该 `/trade/:ref`；点击合并项本身不得导航；依次验证“打开原始记录”和“打开案例”。详情返回后断言：

```ts
assert(location.search.includes('symbol=XAUUSD'), '详情返回必须恢复临时筛选')
assert(document.activeElement?.closest('[data-trade-id]')?.getAttribute('data-trade-id') === root.id, '返回后必须恢复原聚合项焦点')
```

测试中删除锚点对应记录再返回，断言标题获得焦点且 live region 说明结果变化。

- [ ] **Step 4: 覆盖 375px 响应式与键盘操作**

在 fixture 支持 `?visual=mobile`，浏览器测试设置 `document.documentElement.style.width = '375px'` 后断言：

```ts
assert(document.documentElement.scrollWidth <= document.documentElement.clientWidth, '375px 不得横向溢出')
const menuButton = getByRole('button', { name: /更多.*案例/ })
assert(menuButton.getBoundingClientRect().width >= 44, '合并项菜单命中区宽度不足 44px')
assert(menuButton.getBoundingClientRect().height >= 44, '合并项菜单命中区高度不足 44px')
```

通过 Tab/Enter 完成筛选器开启、普通项打开、合并项菜单打开和两个来源动作；来源标签可见文本不得被 `aria-hidden`。

- [ ] **Step 5: 运行浏览器契约并修正样式/语义**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`
Expected: PASS，包括 `src/views/MissedOpportunitiesView.browser.test.html`；控制台无未允许错误。

- [ ] **Step 6: 提交浏览器覆盖**

```bash
git add src/views/MissedOpportunitiesView.browser.test.tsx src/views/MissedOpportunitiesView.browser.test.html src/views/MissedOpportunitiesView.tsx src/views/MissedOpportunitiesView.css src/components/trades/MissedOpportunityRow.tsx
git commit -m "test: cover missed opportunity workspace flow"
```

---

### Task 7: 全量验证、真实页面视觉复核与文档一致性

**Files:**
- Modify only if verification exposes a defect: files already listed in Tasks 1–6
- Review: `docs/superpowers/specs/2026-07-29-missed-opportunity-aggregate-workspace-design.md`
- Review: `docs/superpowers/plans/2026-07-29-missed-opportunity-aggregate-workspace.md`

**Interfaces:**
- Consumes: 全部测试发现器、设计 QA、侧栏 QA、生产构建、真实 Vite 页面。
- Produces: 无失败测试、无构建错误、无移动端溢出、与已通过规格逐条对应的最终证据。

- [ ] **Step 1: 运行完整自动化基线**

Run: `pnpm test`
Expected: PASS；包括质量测试、全部 unit/browser 回归、侧栏相关治理与移动端风险页面基线。

- [ ] **Step 2: 运行生产构建和设计契约**

Run: `pnpm build`
Expected: PASS，类型检查、Vite build 和 bundle budget 全部通过。
Run: `pnpm qa:design`
Expected: PASS。
Run: `pnpm qa:sidebar`
Expected: PASS。

- [ ] **Step 3: 启动真实项目并完成视觉复核**

Run: `pnpm dev -- --host 127.0.0.1`
Expected: Vite 提供本地 URL。

使用真实页面分别检查 1440×1000、1024×768、768×1024、375×812：

- 任意来源页面点击侧栏“错过的机会”都落在 `/missed`。
- 第一眼焦点是页面标题、聚合总数和来源范围，不出现“交易日志/模拟/案例”工作区壳层跳变。
- 关闭来源只改变聚合内容，不移除来源工作区本地错过快捷视图。
- 普通项一键回源；合并项动作无歧义；返回后筛选、位置和焦点恢复。
- 超长 symbol、长策略名、零数据、零筛选结果、删除来源、多个关联案例都不破坏布局。
- 375px 无水平滚动，底部最后一项不被固定导航遮挡。

- [ ] **Step 4: 对照规格逐条自查并扫描占位符**

Run: `rg -n "TODO|TBD|placeholder|待补|稍后实现" src/lib/missedOpportunities.ts src/views/MissedOpportunitiesView.tsx src/components/trades/MissedOpportunityFilters.tsx src/components/trades/MissedOpportunityRow.tsx`
Expected: 无输出。

逐条核对设计规格第 14、15 节，尤其确认七种来源组合、删除/恢复、失效关系、主数/来源数差异、全局重进筛选重置与详情返回保留均有测试证据。

- [ ] **Step 5: 检查差异范围并提交验证修正**

Run: `git diff --check`
Expected: 无空白错误。
Run: `git status --short`
Expected: 只有本计划范围内的文件。

若 Step 1–4 没有产生修正，不创建空提交；若产生修正：

```bash
git add src/App.tsx src/lib/missedOpportunities.ts src/lib/missedOpportunities.test.ts src/lib/sidebarWorkspace.ts src/lib/workspaceViews.ts src/lib/tradeRoute.ts src/hooks/useTradeReturnAnchor.ts src/components/Sidebar.tsx src/components/sidebar/SidebarTargetPicker.tsx src/components/trades/TradeList.tsx src/components/trades/TradeList.css src/components/trades/MissedOpportunityFilters.tsx src/components/trades/MissedOpportunityRow.tsx src/views/MissedOpportunitiesView.tsx src/views/MissedOpportunitiesView.css src/views/DetailView.tsx src/views/MissedOpportunitiesView.browser.test.tsx src/views/MissedOpportunitiesView.browser.test.html src/regression.test.ts src/lib/workspaceFacetConsistency.test.ts scripts/qa-sidebar-navigation.mjs
git commit -m "fix: complete missed opportunity acceptance"
```

---

## Final Verification

- `node scripts/run-regression-tests.mjs --unit-only src/lib/missedOpportunities.test.ts src/lib/workspaceFacetConsistency.test.ts src/regression.test.ts` — 聚合、导航、计数与来源工作区隔离全部通过。
- `node scripts/run-browser-tests.mjs . vite.config.ts` — 聚合页交互、返回现场、375px 与键盘契约通过。
- `pnpm test` — 全量质量与回归基线通过。
- `pnpm build` — 类型、生产构建和 bundle budget 通过。
- `pnpm qa:design`、`pnpm qa:sidebar` — 设计和侧栏契约通过。
- 真实页面四个 viewport 视觉复核完成，控制台无错误，无水平溢出，无来源入口跳变。
- `git diff --check` 无输出，所有中文文件均保持 UTF-8 无 BOM。
