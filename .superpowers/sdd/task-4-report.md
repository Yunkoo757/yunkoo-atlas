# Task 4：统一实盘统计周期范围

## 状态

完成。基线为 `b88aaaa8626f4bd069fd0cf3aa4c51f7473a034a`。

## 实现

- 今日工作台、仪表盘、策略统计预览、策略页统计、设置策略统计、侧栏与交易日志计数均先使用 `filterTradesForLiveCycle(..., 'current', ...)`；模拟盘、案例和无法判定开仓日的实盘保持中央模型的既有保守行为。
- `filterTradesByAnalysisScope()` 在所有分析类型中先按当前实盘周期过滤，因此 `all` 仍保留模拟盘。
- 周复盘实时事实、错过机会、完成时绩效快照与风险快照均接收周期起点；风险 override 事件也不能早于起点。已完成周复盘再次完成时原样返回，不会改写冻结快照。
- 周复盘跨周期首周在标题说明当前周期起点；没有实现设置 UI 或历史筛选。

## TDD 记录

### RED

命令：

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/analysisScope.test.ts src/data/weeklyReviews.test.ts src/lib/weeklyReviewSnapshot.test.ts
```

关键原始输出：

```text
FAIL src/lib/analysisScope.test.ts :: testLiveAnalysisUsesCurrentCycleButKeepsPaper
Error: 实盘分析必须使用当前周期
FAIL src/data/weeklyReviews.test.ts :: testWeeklyReviewExcludesPreCycleOpenTrades
Error: 跨起点旧仓不得进入新周事实
```

命令：

```powershell
node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts
```

关键原始输出：

```text
FAIL src/regression.test.ts :: testLiveWorkbenchAndSidebarCountsUseCurrentCycle
Error: 交易日志实盘范围必须只显示当前周期
```

命令：

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyReviewSnapshot.test.ts
```

关键原始输出：

```text
FAIL src/lib/weeklyReviewSnapshot.test.ts :: testCompletedWeeklyReviewCannotBeRewritten
Error: 已冻结周复盘不得被后续交易数据改写
FAIL src/lib/weeklyReviewSnapshot.test.ts :: testWeeklyReviewSnapshotUsesCurrentLiveCycle
Error: 周复盘冻结不得纳入规则前实盘
```

### GREEN / 验证

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/analysisScope.test.ts src/data/weeklyReviews.test.ts src/lib/weeklyReviewSnapshot.test.ts src/regression.test.ts
pnpm typecheck
node scripts/run-browser-tests.mjs . vite.config.ts
git diff --check
```

关键原始输出：

```text
PASS src/lib/analysisScope.test.ts :: testLiveAnalysisUsesCurrentCycleButKeepsPaper
PASS src/data/weeklyReviews.test.ts :: testWeeklyReviewExcludesPreCycleOpenTrades
PASS src/lib/weeklyReviewSnapshot.test.ts :: testWeeklyReviewSnapshotUsesCurrentLiveCycle
PASS src/lib/weeklyReviewSnapshot.test.ts :: testCompletedWeeklyReviewCannotBeRewritten
PASS src/regression.test.ts :: testLiveWorkbenchAndSidebarCountsUseCurrentCycle
PASS src/views/DashboardScope.browser.test.html
```

全部定向单测、完整浏览器回归、`pnpm typecheck` 和 `git diff --check` 均以退出码 0 通过。

## 文件

- 生产代码：`TodayWorkspace.tsx`、`Dashboard.tsx`、`StrategyHeader.tsx`、`TradeList.tsx`、`StrategiesPanel.tsx`、`Sidebar.tsx`、`sidebarWorkspace.ts`、`workbenchTrades.ts`、`analysisScope.ts`、`weeklyReviews.ts`、`WeeklyReviewView.tsx`。
- 测试：`analysisScope.test.ts`、`weeklyReviews.test.ts`、`weeklyReviewSnapshot.test.ts`、`regression.test.ts`、`DashboardScope.browser.test.tsx`。

## 自查与风险

- 未启用周期时起点为 `null`，中央过滤器保持原始集合，旧产品行为不变。
- unresolved 实盘沿用中央过滤器的当前范围保守保留；规则前实盘按开仓交易日排除。
- 已冻结周复盘的渲染继续读取快照；完成接口也拒绝改写已完成记录。
- 交易数据本身未被写入、迁移或重分类。浏览器回归中项目已有的预期错误日志被测试框架允许，所有浏览器用例通过。

## 审查修复：冻结关键交易证据

审查指出已完成周复盘的“关键交易证据”仍从实时 `weekTrades` / `weekMissedTrades` 渲染，周期起点变更、删除或补录交易会使证据列表与已冻结指标不一致。

- 在 `WeeklyReview` 增加可选 `evidenceSnapshot`，完成复盘时同一批当前周期事实深拷贝进快照，重开时清除。
- 已完成复盘只读取 `evidenceSnapshot`；旧完成记录没有该字段时显示空证据而不回退实时交易，避免以变化中的数据伪造冻结历史。
- 此字段为可选扩展，现有快照验证接受未知向后兼容字段，不需要数据迁移。

### 本次 RED

命令（完整浏览器回归）：

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
```

关键原始输出（退出码 `1`）：

```text
FAIL src/views/WeeklyReviewView.browser.test.html
Error: 调整统计周期后冻结证据内容必须保持完成时快照
```

此前报告的 RED 均只保留了关键输出摘录；原始失败的命令、用例与错误文本仍如上文 TDD 记录所载，无法补录已结束进程的完整 stdout。

### 本次 GREEN / 当前可审计复跑

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/analysisScope.test.ts src/data/weeklyReviews.test.ts src/lib/weeklyReviewSnapshot.test.ts src/regression.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
git diff --check
```

关键输出（全部退出码 `0`）：

```text
PASS src/views/WeeklyReviewView.browser.test.html
PASS src/data/weeklyReviews.test.ts :: testWeeklyReviewExcludesPreCycleOpenTrades
PASS src/lib/weeklyReviewSnapshot.test.ts :: testCompletedWeeklyReviewCannotBeRewritten
PASS src/regression.test.ts :: testLiveWorkbenchAndSidebarCountsUseCurrentCycle
```

## 二次复审修复：证据快照导入校验

`evidenceSnapshot` 是 v9 内的可选、向后兼容字段；不增加 Schema 版本，也不迁移存量数据。为避免损坏导入在周复盘 UI 的 `.length` / `.map` 处崩溃，快照校验现在要求：字段若存在，必须是对象，且 `trades`、`missedTrades` 都是由既有 `isValidPersistedTrade()` 校验通过的数组。

### 本次 RED

```powershell
node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotValidation.test.ts
```

关键原始输出（退出码 `1`）：

```text
FAIL src/storage/snapshotValidation.test.ts :: testSnapshotValidationRejectsMalformedWeeklyEvidenceSnapshots
Error: 损坏的周复盘证据快照不得进入资料库
```

用例覆盖字段为数组、内部数组不是数组、以及交易条目非法三种最小边界，并先确认带有效证据快照的周复盘可被接受。

### 本次 GREEN

```powershell
node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotValidation.test.ts src/data/weeklyReviews.test.ts src/lib/weeklyReviewSnapshot.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
git diff --check
```

关键原始输出（全部退出码 `0`）：

```text
PASS src/storage/snapshotValidation.test.ts :: testSnapshotValidationRejectsMalformedWeeklyEvidenceSnapshots
PASS src/data/weeklyReviews.test.ts :: testWeeklyReviewExcludesPreCycleOpenTrades
PASS src/lib/weeklyReviewSnapshot.test.ts :: testCompletedWeeklyReviewCannotBeRewritten
PASS src/views/WeeklyReviewView.browser.test.html
```
