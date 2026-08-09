# 当前实盘统计与历史归档 Implementation Plan

> 2026-08-09 执行说明：本计划的业务目标继续有效，但 Web、移动端、375/768 视口和 Web/Electron 产品一致性任务已被最新 Windows/macOS-only 要求覆盖，不得原样执行。`codex/live-statistics-archive` 已完成本计划的大部分工作；剩余任务应在 `2026-08-09-desktop-ux-optimization-design.md` 审批后，从现有分支继续收口。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不复制、移动或删除交易与案例实体的前提下，让用户可以一键重新开始当前实盘统计，并通过独立的历史归档入口回看旧记录。

**Architecture:** 保留现有 `livePerformanceCycles` 边界集合和 v10 快照形状，用一个共享的归属内核把记录解析为当前、历史归档或待整理；日志范围解析和绩效范围解析保持两个明确接口。Dashboard、策略、曲线和当前日志只消费当前范围，归档页面消费固定边界，风险 `liveCycle` 与 `liveStatsStartTradingDayKey` 不进入表现归属。所有边界变更继续走 Store 的单一提交、持久化刷新、失败回滚和 revision 冲突保护路径。

**Tech Stack:** TypeScript 5.6、React 18、Zustand 4、React Router 6、Vite/Electron、IndexedDB、项目 Node 单元测试、Playwright 浏览器夹具。

## Global Constraints

- 始终以 UTF-8 无 BOM 读取和写入文件，保留全部中文及其他非 ASCII 字符。
- 重新开始统计不复制、移动或删除历史交易和案例；归档是基于边界的派生视图。
- 不在 `Trade` 上新增持久化归档 ID；归属必须由可靠的业务平仓日和边界推导。
- 内部 `LivePerformanceCycle.name` 继续满足 v10 快照必填约束；新边界自动生成稳定日期名称，用户界面不要求输入名称，不升级 schema。
- `livePerformanceCycles` 必须与风险字段 `liveStatsStartTradingDayKey`、URL 参数 `liveCycle` 解耦。
- 已结束实盘按可靠平仓业务日归属；跨边界交易归入平仓日所在范围，不能按开仓日归属。
- 计划中、持仓中实盘永远留在当前工作区；错过机会不进入绩效 KPI，但可进入日志范围或待整理入口。
- 案例、模拟盘、未执行交易和软删除交易不得进入实盘绩效聚合；案例关联只按 `sourceTradeId` 反向计算。
- 现有周复盘快照、风险核算、风险开仓门禁和正常回收站行为必须保持不变。
- 没有边界的旧资料库保持“全部历史属于当前”的行为；首次重新开始才建立第一条边界。
- 不新增第三方依赖、云服务或需要复制交易实体的数据迁移。
- 严格按 TDD 执行：先写可归因 RED，再写最小生产代码得到 GREEN，然后做差异审查和提交。
- 执行阶段必须在 `using-git-worktrees` 创建的隔离 worktree 中进行。

## File Map

先按职责锁定文件边界，后续任务只在这些边界内扩展：

| 职责 | 文件 | 变化 |
| --- | --- | --- |
| 归属与结果完整度 | `src/lib/livePerformanceCycles.ts`、新建 `src/lib/liveStatisticsArchive.ts` | 修改/新增纯函数，不写 Store |
| 路由与保存视图 | `src/lib/livePerformanceCycleRoute.ts`、`src/lib/analysisScope.ts`、`src/lib/workbenchTrades.ts`、`src/lib/savedTradeViews.ts`、`src/lib/sidebarWorkspace.ts` | 统一当前/归档/待整理契约 |
| Store 与边界事务 | `src/store/useStore.ts`、`src/components/LivePerformanceCycleManager.tsx`、对应 CSS | 创建、撤销、失败回滚、确认摘要 |
| Dashboard 与术语 | `src/views/Dashboard.tsx`、`src/views/Dashboard.css`、`src/components/LivePerformanceCycleControl.tsx`、`src/components/trades/TradeFilters.tsx`、`src/components/LiveCycleSettings.tsx`、`src/lib/importExport.ts` | 当前实盘默认、移除实现术语、风险文案 |
| 历史归档页面 | 新建 `src/views/LiveArchiveView.tsx`、`src/views/LiveArchiveView.css`、`src/views/LiveArchiveView.browser.test.html`、`src/views/LiveArchiveView.browser.test.tsx`、`src/App.tsx`、`src/components/Sidebar.tsx` | 归档首页/详情/返回路径 |
| 交易与案例事实修正 | `src/views/DetailView.tsx`、`src/store/useStore.ts`、`src/views/ListView.tsx`、`src/views/BoardView.tsx` | 归属变化提示、来源案例、待整理修复 |
| 持久化与兼容 | `src/storage/bootstrap.ts`、`src/storage/snapshotCodec.ts`、`src/storage/snapshotValidation.ts`、`src/storage/indexedDbAdapter.ts`、`src/lib/importMerge.ts`、`src/data/weeklyReviews.ts`（仅在测试需要时） | v10、本地边界优先、快照不重算 |
| 验收证据 | 对应 `*.test.ts`、`*.browser.test.tsx`、`scripts` 门禁 | 四档视口、Web/Electron、强杀、性能 |

## Baseline Before Task 1

- [ ] 创建隔离 worktree，并确认 worktree 基于包含本计划和已确认规格的提交。
- [ ] 运行 `pnpm typecheck`，记录 exit code 0。
- [ ] 运行 `pnpm test`，记录 exit code 0；若质量治理要求工作区外日志，按现有脚本约定将临时产物放到工作区外。
- [ ] 运行 `git status --short`，记录已有删除文档、审阅报告和 `ux-audit/` 等用户变更，不在本计划中清理。

---

### Task 1: 建立统一的实盘归属与结果完整度内核

**Files:**
- Modify: `src/lib/livePerformanceCycles.ts`
- Create: `src/lib/liveStatisticsArchive.ts`
- Modify: `src/lib/livePerformanceCycles.test.ts`
- Create: `src/lib/liveStatisticsArchive.test.ts`
- Modify: `src/lib/missedOpportunities.ts`
- Modify: `src/lib/missedOpportunities.test.ts`

**Interfaces:**
- Consumes: `Trade`、`LivePerformanceCycle`、`isExecutedClosed()`、`closedTradingDayKeyFromClosedAt()`、现有 `isValidLiveCycleDayKey()`。
- Produces:

```ts
export type LiveRecordBucket = 'current' | 'archive' | 'pending' | 'excluded'

export type LiveArchiveScope = {
  kind: 'current' | 'archive' | 'all-archives' | 'pending'
  archiveId: string | null
  bounds: LivePerformanceCycleBounds | null
  label: string
  missingRequestedKey?: string | null
}

export type LiveArchiveResultCompleteness = {
  closedCount: number
  validResultCount: number
  conflictCount: number
  missingResultCount: number
  missingCloseDayCount: number
}

export type LiveArchiveSummary = {
  archiveId: string
  startTradingDayKey: string | null
  endExclusiveTradingDayKey: string | null
  trades: Trade[]
  resultCompleteness: LiveArchiveResultCompleteness
  associatedCaseCount: number
}

export function resolveLiveArchiveScope(
  cycles: readonly LivePerformanceCycle[],
  requestedKey: string | null | undefined,
): LiveArchiveScope

export function resolveLiveRecordBucket(
  trade: Trade,
  cycles: readonly LivePerformanceCycle[],
  tradingDayStartHour: number,
): LiveRecordBucket

export function filterLiveLogRecords(
  trades: readonly Trade[],
  scope: LiveArchiveScope,
  tradingDayStartHour: number,
): Trade[]

export function filterLivePerformanceRecords(
  trades: readonly Trade[],
  scope: LiveArchiveScope,
  tradingDayStartHour: number,
): Trade[]

export function buildLiveArchiveSummary(
  trades: readonly Trade[],
  cases: readonly Trade[],
  cycle: LivePerformanceCycle,
  cycles: readonly LivePerformanceCycle[],
  tradingDayStartHour: number,
): LiveArchiveSummary
```

- [ ] **Step 1: 写归属 RED 测试**

在 `src/lib/liveStatisticsArchive.test.ts` 构造三条边界、边界前/边界日/边界后的实盘、进行中交易、错过机会、案例和软删除交易，先写以下断言：

```ts
export function testDefaultScopeIsCurrentAndUnknownScopeNeverDriftsCurrent(): void {
  const current = resolveLiveArchiveScope(cycles, null)
  const unknown = resolveLiveArchiveScope(cycles, 'missing-id')
  assert(current.kind === 'current', '没有请求参数必须得到当前实盘')
  assert(unknown.kind === 'all-archives', '失效范围必须回到历史归档首页')
  assert(unknown.missingRequestedKey === 'missing-id', '回退必须保留可理解提示所需的原始 ID')
}

export function testLogAndPerformanceResolversHaveDifferentSets(): void {
  const pending = trade({ tradeKind: 'live', status: 'missed', closedAt: null })
  const open = trade({ tradeKind: 'live', status: 'open' })
  const performance = filterLivePerformanceRecords([pending, open], currentScope, 0)
  const log = filterLiveLogRecords([pending, open], currentScope, 0)
  assert(performance.length === 0, '绩效范围不得包含错过或进行中记录')
  assert(log.map((item) => item.id).sort().join(',') === 'open,pending', '日志范围必须保留进行中和待整理')
}
```

同时覆盖：左闭右开、跨边界按 `closedTradingDayKey`、合法 `closedAt` 仅用于旧记录补算、没有可靠日期不回退 `openedAt`、错过机会进入日志但不进入 KPI、当前工作区没有边界时包含全部历史、空成员边界不生成卡片、案例只按 `sourceTradeId` 计数、结果冲突和缺结果独立于风险完整度。

- [ ] **Step 2: 运行聚焦测试确认 RED**

运行：

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/liveStatisticsArchive.test.ts src/lib/livePerformanceCycles.test.ts src/lib/missedOpportunities.test.ts
```

预期：新增模块或导出接口尚不存在，测试以 exit 1 失败；不得通过跳过测试或把失效范围回退到当前来制造假绿。

- [ ] **Step 3: 实现最小归属内核**

在现有周期函数之上增加单一业务日解析器：优先使用合法的 `closedTradingDayKey`，旧数据才从合法 `closedAt` 计算；绝不使用 `openedAt` 猜测归档。`planned/open` 只在日志解析中归入当前，`missed` 有可靠日期时进入当前/归档，没有日期时进入 `pending`，`win/loss/breakeven` 才允许进入绩效范围。

范围判断必须使用字符串化 `YYYY-MM-DD` 的左闭右开比较：

```ts
function inBounds(day: string, bounds: LivePerformanceCycleBounds): boolean {
  return (bounds.startInclusive === null || day >= bounds.startInclusive)
    && (bounds.endExclusive === null || day < bounds.endExclusive)
}
```

`buildLiveArchiveSummary()` 使用同一归属结果计算交易列表、结果完整度、日期范围和 `sourceTradeId` 案例数量；不要复制或给交易写入归档字段。空成员边界返回可用的摘要但由页面隐藏卡片。

- [ ] **Step 4: 运行 GREEN 与类型检查**

运行：

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/liveStatisticsArchive.test.ts src/lib/livePerformanceCycles.test.ts src/lib/missedOpportunities.test.ts
pnpm typecheck
```

预期：所有新增归属、日期缺失、结果完整度测试 PASS，类型检查 exit 0。

- [ ] **Step 5: 提交 Task 1**

```powershell
git add src/lib/livePerformanceCycles.ts src/lib/liveStatisticsArchive.ts src/lib/livePerformanceCycles.test.ts src/lib/liveStatisticsArchive.test.ts src/lib/missedOpportunities.ts src/lib/missedOpportunities.test.ts
git commit -m "feat: add live archive scope kernel"
```

---

### Task 2: 统一当前日志、分析路由和保存视图契约

**Files:**
- Modify: `src/lib/livePerformanceCycleRoute.ts`
- Modify: `src/lib/analysisScope.ts`
- Modify: `src/lib/workbenchTrades.ts`
- Modify: `src/lib/savedTradeViews.ts`
- Modify: `src/lib/sidebarWorkspace.ts`
- Modify: `src/components/StrategyHeader.tsx`
- Modify: `src/components/trades/TradeFilters.tsx`
- Modify: `src/lib/livePerformanceCycleRoute.test.ts`
- Modify: `src/lib/analysisScope.test.ts`
- Modify: `src/lib/savedTradeViews.test.ts`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `resolveLiveArchiveScope()`、`filterLiveLogRecords()`、`filterLivePerformanceRecords()`。
- Produces:

```ts
export type LiveRouteTarget =
  | { kind: 'current'; scope: LiveArchiveScope }
  | { kind: 'archive'; scope: LiveArchiveScope }
  | { kind: 'archive-home'; reason: 'all' | 'pre-cycle' | 'missing'; requestedKey: string | null }

export type LiveRouteState = {
  target: LiveRouteTarget
  canonicalSearch: string
  needsReplace: boolean
}

export function resolveLiveRoute(
  input: string | URLSearchParams,
  cycles: readonly LivePerformanceCycle[],
  context: 'dashboard' | 'trade-list' | 'strategy' | 'archive',
): LiveRouteState

export function intersectLiveScopeWithNaturalRange(
  scope: LiveArchiveScope,
  range: AnalysisRange,
  anchor: BusinessDateAnchor,
): LivePerformanceCycleBounds | null
```

- [ ] **Step 1: 写路由 RED 测试**

补充现有 route/saved-view 测试，明确以下行为：

```ts
const current = resolveLiveRoute('?symbol=BTCUSDT', cycles, 'trade-list')
assert(current.target.kind === 'current', '普通实盘日志缺省必须是当前')
assert(current.canonicalSearch === '?symbol=BTCUSDT', '当前默认不得把 statsCycle 暴露到 URL')

const archive = resolveLiveRoute('?statsCycle=cycle-one', cycles, 'strategy')
assert(archive.target.kind === 'archive', '有效真实 ID 必须固定到历史归档')

const invalid = resolveLiveRoute('?statsCycle=missing', cycles, 'trade-list')
assert(invalid.target.kind === 'archive-home', '失效范围必须回到归档首页')
```

增加 `this-week`、`this-month` 与当前实盘交集测试；`kind=all` 明确只对实盘部分使用当前范围，模拟盘保留全部历史；当前保存视图不固定边界，归档保存视图固定 archive ID；旧 `liveCycle` 只从普通日志 URL 清除。

- [ ] **Step 2: 运行聚焦测试确认 RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/livePerformanceCycleRoute.test.ts src/lib/analysisScope.test.ts src/lib/savedTradeViews.test.ts src/regression.test.ts
```

预期：现有缺省日志仍返回全历史、失效 ID 仍静默清除或漂移，新增断言失败。

- [ ] **Step 3: 实现路由和筛选契约**

把 `resolveTradeListPerformanceCycleRoute()` 的缺省行为改为当前实盘；把 `all`、`pre-cycle`、失效 ID 和不可用 archive ID 交给 `archive-home` 目标，不能在交易列表中静默变成当前。`filterTradesByAnalysisScope()` 在 `kind === 'all'` 时拆分 live/paper：live 与当前范围取交集，paper 不应用表现边界。普通日志使用日志解析器，Dashboard/策略使用绩效解析器。

保存视图 canonicalization 必须按上下文执行：当前视图移除 statsCycle 并动态跟随最新边界，归档视图保留真实 archive ID；任何失效视图保留 `symbol` 等安全筛选但回到归档首页并返回可理解提示。`StrategyHeader`、`workbenchTrades` 和 `TradeFilters` 只显示“当前实盘/历史归档”文案。

- [ ] **Step 4: 运行 GREEN、回归和类型检查**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/livePerformanceCycleRoute.test.ts src/lib/analysisScope.test.ts src/lib/savedTradeViews.test.ts src/regression.test.ts
pnpm typecheck
```

预期：路由、自然范围交集、混合模式、保存视图和旧 `liveCycle` 断言全部 PASS。

- [ ] **Step 5: 提交 Task 2**

```powershell
git add src/lib/livePerformanceCycleRoute.ts src/lib/analysisScope.ts src/lib/workbenchTrades.ts src/lib/savedTradeViews.ts src/lib/sidebarWorkspace.ts src/components/StrategyHeader.tsx src/components/trades/TradeFilters.tsx src/lib/livePerformanceCycleRoute.test.ts src/lib/analysisScope.test.ts src/lib/savedTradeViews.test.ts src/regression.test.ts
git commit -m "feat: scope live routes by current archive"
```

---

### Task 3: 实现无名称输入的重新开始事务

**Files:**
- Modify: `src/store/useStore.ts`
- Modify: `src/store/livePerformanceCycles.test.ts`
- Modify: `src/components/LivePerformanceCycleManager.tsx`
- Modify: `src/components/LivePerformanceCycleManager.css`
- Modify: `src/components/LivePerformanceCycleManager.browser.test.tsx`
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/DashboardScope.browser.test.tsx`

**Interfaces:**
- Consumes: Task 1 的归属/摘要函数、Task 2 的当前范围路由、现有 `replaceLivePerformanceCycles()` 和 `flushPersistNow()`。
- Produces:

```ts
export type LivePerformanceRestartPreview = {
  startTradingDayKey: string
  archivedClosedCount: number
  currentClosedCount: number
  activeCount: number
  pendingCount: number
  associatedCaseCount: number
}

export function buildLivePerformanceRestartPreview(
  trades: readonly Trade[],
  cycles: readonly LivePerformanceCycle[],
  startTradingDayKey: string,
  tradingDayStartHour: number,
): LivePerformanceRestartPreview
```

- [ ] **Step 1: 写确认摘要和事务 RED 测试**

在 `src/store/livePerformanceCycles.test.ts` 加入：

```ts
export function testRestartPreviewCountsSameDayClosedTradesAsCurrent(): void {
  const preview = buildLivePerformanceRestartPreview(trades, cycles, '2026-08-08', 0)
  assert(preview.currentClosedCount === 2, '起点当天已结束交易必须计入新当前统计')
  assert(preview.archivedClosedCount === 3, '起点前已结束交易必须进入旧归档摘要')
}
```

浏览器夹具先断言首页进入重新开始后只出现日期选择和影响摘要，不再出现“名称”输入、重命名入口或周期选择器；确认失败时 Store 和持久化快照保持旧边界。

- [ ] **Step 2: 运行聚焦测试确认 RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/store/livePerformanceCycles.test.ts
```

浏览器聚焦运行使用项目发现器执行 `LivePerformanceCycleManager.browser.test.html`，预期先因名称输入/旧管理流程存在而失败。

- [ ] **Step 3: 实现最小事务和低成本界面**

创建流程默认 `currentTradingDayKey`，高级日期选择器只能选择严格晚于最新边界且不晚于当前业务日的日期。内部边界名称由 `startTradingDayKey` 生成，例如 `实盘-2026-08-08`，若同日冲突则由唯一 ID 保证内部唯一；界面不显示名称输入。

保留现有 `commitCycles(next, successMessage)` 的失败回滚结构，但把创建、撤销都收敛到同一个事务入口：先保存旧数组和 revision，临时替换 Store，等待 `flushPersistNow()` 成功后再显示成功；失败则恢复内存和持久化，revision 冲突放弃提交并重新读取最新边界。无成员边界允许创建，但 Dashboard 不渲染空归档卡片；撤销唯一边界后恢复全历史当前。

确认摘要必须显示“将归档 N 笔已结束实盘、N 笔进行中继续保留、N 个案例继续留在案例库、风险设置不会改变”，并在起点当天有交易时显示当天计数。Modal 保持已有 focus restore、Escape 取消和 `aria-describedby`；成功/失败状态不在 flush 前提前宣称。

- [ ] **Step 4: 运行 GREEN、浏览器和类型检查**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/store/livePerformanceCycles.test.ts src/lib/liveStatisticsArchive.test.ts
pnpm typecheck
```

浏览器聚焦运行应覆盖默认、创建、日期选择、取消、撤销、持久化失败和焦点恢复；全部 PASS。

- [ ] **Step 5: 提交 Task 3**

```powershell
git add src/store/useStore.ts src/store/livePerformanceCycles.test.ts src/components/LivePerformanceCycleManager.tsx src/components/LivePerformanceCycleManager.css src/components/LivePerformanceCycleManager.browser.test.tsx src/views/Dashboard.tsx src/views/DashboardScope.browser.test.tsx
git commit -m "feat: restart current live statistics without naming"
```

---

### Task 4: 收敛 Dashboard、交易日志和风险术语

**Files:**
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/Dashboard.css`
- Modify: `src/components/LivePerformanceCycleControl.tsx`
- Modify: `src/components/LivePerformanceCycleControl.css`
- Modify: `src/components/trades/TradeFilters.tsx`
- Modify: `src/components/LiveCycleSettings.tsx`
- Modify: `src/components/LiveCycleSettings.css`
- Modify: `src/lib/importExport.ts`
- Modify: `src/views/LivePerformanceCycleDashboard.browser.test.tsx`
- Modify: `src/views/DashboardScope.browser.test.tsx`
- Modify: `src/components/LiveCycleSettings.browser.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `resolveLiveRoute()` 与范围交集、Task 3 的 `buildLivePerformanceRestartPreview()`。
- Produces: Dashboard 的当前指标、待整理入口、历史归档入口和风险术语清理；不引入新的用户可见周期选择器。

- [ ] **Step 1: 写 Dashboard 口径 RED 测试**

在现有 Dashboard 夹具中准备一笔旧归档本周交易和一笔当前本周交易，先断言主统计、周卡片、策略行和“查看当前实盘”链接都只包含当前交易；再断言 `kind=all` 显示“实盘当前范围 + 模拟盘全部历史”。增加断言：

```ts
assert(document.body.textContent?.includes('当前实盘统计'), 'Dashboard 标题必须使用当前实盘')
assert(!document.body.textContent?.includes('绩效阶段'), '用户界面不得暴露绩效阶段')
assert(document.body.textContent?.includes('历史归档'), 'Dashboard 必须提供历史归档入口')
```

- [ ] **Step 2: 运行浏览器聚焦测试确认 RED**

运行：

```powershell
node scripts/run-regression-tests.mjs --unit-only src/views/DashboardScope.browser.test.tsx src/views/LivePerformanceCycleDashboard.browser.test.tsx
```

并用浏览器发现器执行对应 HTML；预期周卡片仍未传 performance bounds，旧周期控制和风险术语断言失败。

- [ ] **Step 3: 实现统一 Dashboard 视图**

Dashboard 只从同一 `LiveArchiveScope` 计算 `stats`、`weekMetrics`、curve、strategy rows 和 trade href；给本周 `filterTradesByAnalysisScope()` 传入与主统计相同的性能边界。当前标题使用“当前实盘统计”，摘要显示起始日期或“包含全部实盘历史”，次入口为 `/live-archive`。

把旧 `LivePerformanceCycleControl` 改成无实现参数的轻量状态入口，移除 Dashboard 统计周期选择器；`TradeFilters` 删除实盘周期/当前周期/规则前/统计起点前下拉，风险筛选不再出现在普通日志。`LiveCycleSettings` 将“风险核算范围”改为“风险数据起算日”，并保留风险预览。导入摘要改为“保留当前统计与历史归档设置”。

当前日志标题区和 Dashboard 数据健康区共用待整理计数；存在记录时显示“待整理 N”，点击进入待整理过滤列表。周复盘链接继续使用独立自然周，不带表现边界。

- [ ] **Step 4: 运行 GREEN、类型检查和差异审查**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/views/DashboardScope.browser.test.tsx src/views/LivePerformanceCycleDashboard.browser.test.tsx src/components/LiveCycleSettings.browser.test.tsx
pnpm typecheck
rg -n "绩效阶段|统计周期|统计起点前|规则前|当前统计周期" src/views src/components src/lib/importExport.ts
```

预期：聚焦夹具和类型检查 PASS；最后一条命令只允许保留代码注释、兼容测试和内部字段，不得有新的用户可见文案。

- [ ] **Step 5: 提交 Task 4**

```powershell
git add src/views/Dashboard.tsx src/views/Dashboard.css src/components/LivePerformanceCycleControl.tsx src/components/LivePerformanceCycleControl.css src/components/trades/TradeFilters.tsx src/components/LiveCycleSettings.tsx src/components/LiveCycleSettings.css src/lib/importExport.ts src/views/LivePerformanceCycleDashboard.browser.test.tsx src/views/DashboardScope.browser.test.tsx src/components/LiveCycleSettings.browser.test.tsx
git commit -m "feat: simplify current live statistics dashboard"
```

---

### Task 5: 新建历史归档首页与详情页

**Files:**
- Create: `src/views/LiveArchiveView.tsx`
- Create: `src/views/LiveArchiveView.css`
- Create: `src/views/LiveArchiveView.browser.test.html`
- Create: `src/views/LiveArchiveView.browser.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Sidebar.css`
- Modify: `src/views/ListView.tsx`
- Modify: `src/views/DetailView.tsx`

**Interfaces:**
- Consumes: Task 1 的 `buildLiveArchiveSummary()`、Task 2 的 `resolveLiveRoute()`、现有 `tradeDetailPath()` 和 ListView 筛选组件。
- Produces:

```ts
export function LiveArchiveView(): JSX.Element

// App routes
<Route path="/live-archive" element={<LiveArchiveView />} />
<Route path="/live-archive/:archiveId" element={<LiveArchiveView />} />
```

- [ ] **Step 1: 写归档页面 RED 夹具**

新建 HTML 和 TSX 夹具，注入两条边界、旧归档交易、当前交易、错过机会、待整理记录和两个来源案例。先断言：

```ts
assert(document.body.textContent?.includes('历史归档'), '归档首页必须可达')
assert(document.body.textContent?.includes('126 笔已平仓') === true, '卡片必须展示已平仓数量')
assert(document.body.textContent?.includes('结果完整度') === true, '卡片必须展示结果完整度')
assert(document.body.textContent?.includes('关联案例 1 个') === true, '案例计数只能按 sourceTradeId')
```

在 375、768、1280、1920 四档夹具元数据中验证卡片、详情、返回和待整理入口均存在。

- [ ] **Step 2: 运行浏览器 RED**

运行完整浏览器发现器，预期新页面尚不存在，新增夹具失败而既有夹具保持通过。记录失败必须归因于缺少页面/路由，不允许删掉新断言。

- [ ] **Step 3: 实现归档首页/详情**

首页按边界倒序显示非空归档卡片：日期范围、已平仓数、胜率、净盈亏、平均 R、结果完整度、关联案例数和“查看归档交易”。顶部显示全局“待整理 N”入口；没有成员的边界不渲染空卡片。

详情页只读展示固定边界下的交易列表，不提供移动成员按钮；搜索和筛选按平仓业务日解释，控件文案写“平仓日期”。交易详情、案例详情和返回链接保留 `archiveId` 语境。来源交易删除时案例显示“来源已删除”，案例本身仍可打开。

将 `/live-archive` 入口加入 Sidebar 低频导航或 Dashboard 次入口，不改变主导航顺序。页面不显示 `statsCycle`、`pre-cycle`、`规则前`、`统计周期` 等实现术语。

- [ ] **Step 4: 运行 GREEN、聚焦单元和类型检查**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/liveStatisticsArchive.test.ts
pnpm typecheck
```

浏览器发现器应在四档视口全部 PASS；重点检查归档统计、列表数量和关联案例数量来自同一个 `buildLiveArchiveSummary()` 结果。

- [ ] **Step 5: 提交 Task 5**

```powershell
git add src/views/LiveArchiveView.tsx src/views/LiveArchiveView.css src/views/LiveArchiveView.browser.test.html src/views/LiveArchiveView.browser.test.tsx src/App.tsx src/components/Sidebar.tsx src/components/Sidebar.css src/views/ListView.tsx src/views/DetailView.tsx
git commit -m "feat: add live statistics archive views"
```

---

### Task 6: 接入案例来源、事实修正、待整理和兼容导入

**Files:**
- Modify: `src/views/DetailView.tsx`
- Modify: `src/views/ListView.tsx`
- Modify: `src/views/BoardView.tsx`
- Modify: `src/store/useStore.ts`
- Modify: `src/lib/savedTradeViews.ts`
- Modify: `src/lib/savedTradeViews.test.ts`
- Modify: `src/lib/importMerge.ts`
- Modify: `src/lib/importConcurrency.test.ts`
- Modify: `src/lib/importExport.ts`
- Modify: `src/storage/bootstrap.ts`
- Modify: `src/storage/snapshotCodec.ts`
- Modify: `src/storage/snapshotValidation.ts`
- Modify: `src/storage/indexedDbAdapter.ts`
- Modify: `src/storage/snapshotCodec.test.ts`
- Modify: `src/storage/snapshotValidation.test.ts`
- Modify: `src/views/LiveArchiveView.browser.test.tsx`
- Modify: `src/views/LivePerformanceCycleNavigation.browser.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `resolveLiveRecordBucket()` 和 `buildLiveArchiveSummary()`、Task 2 的 `LiveRouteTarget`。
- Produces: 事实修正后的归属提示、来源案例可发现性、动态/固定保存视图、本地边界优先导入和旧链接稳定回退。

- [ ] **Step 1: 写兼容和事实修正 RED 测试**

先加入以下断言：

```ts
export function testImportedTradesUseLocalBoundaries(): void {
  const merged = mergeSnapshots(localWithCycle, importedWithDifferentCycle)
  assert(merged.livePerformanceCycles === localWithCycle.livePerformanceCycles, '本地边界优先')
  assert(classify(merged.trades.find((trade) => trade.id === 'imported')!) === 'archive', '导入交易必须按本地边界重新投影')
}

export function testCurrentSavedViewFollowsNewBoundary(): void {
  const canonical = canonicalizeTradeViewSearch('?statsCycle=old-id&symbol=BTCUSDT', cycles, { mode: 'current' })
  assert(!canonical.has('statsCycle'), '当前保存视图不得固定旧边界')
  assert(canonical.get('symbol') === 'BTCUSDT', '安全筛选必须保留')
}
```

浏览器夹具补充：打开归档交易详情修改 `closedAt` 导致交易离开当前归档时出现确认提示；删除源交易后案例仍在案例库并显示来源不可用；点击旧 `all`、`current`、`pre-cycle`、无效 ID 和带 `liveCycle` 的链接均得到规定目标。

- [ ] **Step 2: 运行聚焦测试确认 RED**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/savedTradeViews.test.ts src/lib/importConcurrency.test.ts src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts
```

浏览器聚焦运行 `LivePerformanceCycleNavigation.browser.test.tsx` 和 `LiveArchiveView.browser.test.tsx`，预期旧保存视图仍静默清除、事实修正没有归属确认、导入边界行为未覆盖新增契约。

- [ ] **Step 3: 实现事实修正和兼容投影**

在交易更新提交前计算旧/新 `LiveRecordBucket`；若从当前或某个归档移到另一范围，弹出明确的“保存后将离开当前归档”确认，取消不写 Store。删除仍走原有回收站逻辑，归档页没有专门删除按钮。待整理记录修复 `closedTradingDayKey`/合法 `closedAt` 后立即从待整理入口移出并按本地边界归属。

保存视图增加显式 `mode: 'current' | 'archive'` canonicalization；旧 `statsCycle` 真实 ID 转归档固定视图，`current` 转动态当前，`all`/`pre-cycle`/失效 ID 转归档首页；旧 `liveCycle` 只清除风险筛选。导入合并继续使用本地周期集合，导入交易按本地边界重算，导入摘要使用“保留当前统计与历史归档设置”。v10 快照缺省 `livePerformanceCycles` 仍按空数组读取，不复制交易/案例；周复盘快照字段不重写。

- [ ] **Step 4: 运行 GREEN、类型检查和兼容门禁**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/savedTradeViews.test.ts src/lib/importConcurrency.test.ts src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts
pnpm typecheck
```

浏览器夹具必须验证：当前保存视图跟随新边界、归档视图不跟随、所有旧目标不漂移当前、案例来源删除不丢、事实修正提示可取消、周复盘快照前后字节语义不变。

- [ ] **Step 5: 提交 Task 6**

```powershell
git add src/views/DetailView.tsx src/views/ListView.tsx src/views/BoardView.tsx src/store/useStore.ts src/lib/savedTradeViews.ts src/lib/savedTradeViews.test.ts src/lib/importMerge.ts src/lib/importConcurrency.test.ts src/lib/importExport.ts src/storage/bootstrap.ts src/storage/snapshotCodec.ts src/storage/snapshotValidation.ts src/storage/indexedDbAdapter.ts src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts src/views/LiveArchiveView.browser.test.tsx src/views/LivePerformanceCycleNavigation.browser.test.tsx
git commit -m "feat: preserve archive links and source cases"
```

---

### Task 7: 完成 Web/Electron、响应式和发布门禁

**Files:**
- Modify: `src/storage/persist.test.ts`
- Modify: `src/components/WebStorageConflict.browser.test.tsx`
- Modify: `src/views/LiveArchiveView.browser.test.tsx`
- Create: `src/views/LiveArchiveView.design.test.ts`
- Modify: `src/lib/remainingResponsiveAudit.test.ts`
- Modify: `src/lib/remainingAccessibilityAudit.test.ts`
- Modify: `docs/superpowers/specs/2026-08-08-live-statistics-archive-design.md`
- Create: `.superpowers/sdd/2026-08-08-live-statistics-archive/task-1-report.md`
- Create: `.superpowers/sdd/2026-08-08-live-statistics-archive/task-2-report.md`
- Create: `.superpowers/sdd/2026-08-08-live-statistics-archive/task-3-report.md`
- Create: `.superpowers/sdd/2026-08-08-live-statistics-archive/task-4-report.md`
- Create: `.superpowers/sdd/2026-08-08-live-statistics-archive/task-5-report.md`
- Create: `.superpowers/sdd/2026-08-08-live-statistics-archive/task-6-report.md`
- Create: `.superpowers/sdd/2026-08-08-live-statistics-archive/task-7-report.md`

**Interfaces:**
- Consumes: Tasks 1–6 的所有公共接口和页面入口。
- Produces: 可复现的发布证据，不改变业务范围语义。

- [ ] **Step 1: 写发布门禁 RED 夹具**

新增浏览器场景覆盖四档视口：

1. 旧历史 → Dashboard 重新开始 → 当前日志只显示当前 → 历史归档显示旧记录；
2. 起点当天已平仓记录显示在新当前摘要；
3. 进行中交易跨重启后仍在当前；
4. 缺少平仓日记录通过待整理入口可达；
5. 案例、图片、正文和源交易链接未被复制或隐藏；
6. 风险数据起算日改变不改变表现统计；
7. Web flush 失败、Electron 写入失败和强杀恢复只留下完整旧边界或完整新边界；
8. 2 万笔交易下归档首页不在首屏同步遍历多次实体集合。

- [ ] **Step 2: 运行完整 RED/基线证据**

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/liveStatisticsArchive.test.ts src/lib/livePerformanceCycleRoute.test.ts src/lib/analysisScope.test.ts src/lib/savedTradeViews.test.ts src/storage/persist.test.ts
node scripts/run-regression-tests.mjs
pnpm test:release
```

新增断言在实现完整前应至少有一个稳定失败；完整测试若因治理指纹失败，必须把报告输出放在工作区外后重跑，不改放宽规则。

- [ ] **Step 3: 实现响应式、无障碍和性能细节**

归档卡片和详情列表在 375px 不横向溢出，键盘可从 Dashboard 进入归档、打开详情并返回；归档范围状态使用可读文本和 `aria-live`，待整理数量不依赖颜色。摘要与列表共享 `useMemo` 得到的归属结果，20,000 笔交易下同一渲染周期不重复构造边界 Map。

Electron 与 Web 都调用同一个 `commitCycles` 事务，不添加平台分支改变归属；强杀测试验证重启后 snapshot revision 与边界集合一致。

- [ ] **Step 4: 运行最终完整门禁**

```powershell
pnpm typecheck
pnpm test
pnpm build
node scripts/run-regression-tests.mjs
pnpm test:release
node scripts/check-governance.mjs --require-execution
git diff --check
```

另执行：

```powershell
node scripts/run-forced-kill-evidence.mjs
pnpm benchmark:analytics
pnpm benchmark:persistence:release
```

预期所有命令 exit 0；浏览器报告必须明确列出 375、768、1280、1920 四档；性能报告必须记录 20,000 笔交易下归档首页、详情和重新开始确认的耗时。

- [ ] **Step 5: 更新规格状态并提交发布证据**

将设计规格状态更新为“实施完成，待发布验收”，只提交规格状态和任务报告，不把工作区已有删除文档、审阅报告或 `ux-audit/` 混入提交。

```powershell
git add docs/superpowers/specs/2026-08-08-live-statistics-archive-design.md .superpowers/sdd/2026-08-08-live-statistics-archive
git commit -m "test: close live statistics archive release gates"
```

## Spec Coverage Self-Review

- 规格第 2–5 节的心智模型、非目标和风险解耦由 Tasks 1、3、4 覆盖；没有任务会删除或复制实体。
- 规格第 6 节的左闭右开、进行中、错过机会、日期缺失和日志/绩效双解析由 Task 1 覆盖。
- 规格第 7 节的无名称创建、起点当天计数、原子保存、撤销和焦点由 Task 3 覆盖。
- 规格第 8 节的 Dashboard、日志、归档、案例和风险文案由 Tasks 4–6 覆盖；周卡片明确在 Task 4 修复边界透传。
- 规格第 9 节的 `/live-archive`、旧 `all/current/pre-cycle`、失效链接和 `liveCycle` 由 Tasks 2、5、6 覆盖。
- 规格第 10–11 节的 v10、导入本地边界优先、快照独立、事实修正、保存视图和事务安全由 Tasks 3、6、7 覆盖。
- 规格第 12–14 节的领域、页面、持久化、四档视口、分批执行和发布门禁由每个任务末尾的聚焦测试与 Task 7 覆盖。

计划文本已通过自审扫描；每个任务都给出了文件、接口、RED、GREEN、命令和提交边界。
