# Task 8 报告：用显式 stage ID 统一当前与历史投影

## 交付状态

- 状态：完成
- 基线：`187835ed763c90c1e0fc7df351ba1c298e1a6f36`
- 平台范围：Windows / macOS 桌面客户端；未新增 mobile、iPad、浏览器产品分支。
- 投影真相：运行时只使用 `liveStageId`、`liveStages`、`currentLiveStageId`；日期与旧周期字段不再决定当前/历史归属。

## RED / GREEN

### 第一组四文件 RED

先建立以下四个聚焦测试，再写实现：

1. `src/lib/stageArchive.test.ts`
2. `src/lib/workbenchTrades.test.ts`
3. `src/lib/analysisScope.test.ts`
4. `src/lib/sidebarWorkspace.test.ts`

RED 结果覆盖：单一 stage resolver 尚不存在、工作台仍按旧范围取数、日期编辑可跨归属、Sidebar 计数未限定当前 stage。

GREEN 后覆盖：

- all-history 排除 current/null；pending 仅接受显式 `null`。
- 当前、单历史、全部历史、pending 四种投影只按 stage ID 判定。
- 日期编辑不会改变投影归属。
- workbench、分析、Sidebar 均使用同一 stage scope。

### 后续 RED / GREEN

- 历史 overview 实时重算与 weekly 冻结快照。
- 历史案例按案例自身 stage 归属。
- Dashboard/策略链接携带规范 `liveStage=current`。
- missed 聚合保留 paper 原语义，同时把 live/case 限定当前 stage。
- pending 排除 `undefined`，只接纳迁移后显式 `null`。
- all-stage weekly 同周多 stage：先复现重复周被 `.find()` 丢失，再改为明确同周聚合并记录 `stageCount`。
- 策略 paper 深链残留 `liveStage`：浏览器 RED 后修复为清除实盘参数，保持 paper 原语义。

## 唯一 scope 表

| scope | URL / 入口 | 成员规则 | 明确排除 |
| --- | --- | --- | --- |
| current | `liveStage=current` 或普通实盘入口 | `liveStageId === currentLiveStageId` | 归档 stage、`null`、未迁移 `undefined` |
| 单历史 stage | `liveStage=<archived-id>` | `liveStageId === <archived-id>` 且 ID 必须是 archived stage | current、其他 archived stage、`null` |
| all-history | `liveStage=all-history` | `liveStageId` 属于 archived stage ID 集合 | current、`null`、非法 ID |
| pending | 数据健康入口 | `liveStageId === null` | current、archived、`undefined` |

历史页收到非法 ID、当前 stage ID 或缺失 ID 时，安全规范为 `all-history`。普通工作台即使 URL 带旧周期或历史 stage 参数，也始终使用当前 stage；paper 不套用实盘 stage 投影。

## 实现结果

### 单一 resolver / filter / summary

- 新增 `src/lib/stageArchive.ts`，集中提供 scope 解析、实体匹配、live/case/混合记录过滤和历史 summary。
- 历史 summary 读取当前已编辑交易事实实时重算；不使用日期边界推断归属。
- `workbenchTrades` 保留旧字段类型兼容至 Task 12，但实现不再消费这些字段决定投影。

### 当前工作区消费者

- List / Board / current cases / favorites 通过 `useWorkbenchVisibleTrades` 统一当前 stage。
- Today、missed、Sidebar 数量、策略 performance、默认 Dashboard 统一使用 `currentLiveStageId`。
- Dashboard 规范 URL 为 `liveStage=current`，清除 `statsCycle` / `liveCycle`，下钻链接继续携带 current。
- paper 维持原工作区与统计语义；策略 paper URL 会移除无关 `liveStage`。
- 待归属入口改到数据健康页，计数严格只看 `liveStageId === null`。

### 独立历史阶段导航

- 阶段 rail：全部历史 + archived stage 按 `sequence` 倒序。
- stage 内独立 tab：overview / live / cases / weekly / risk。
- stage/tab 切换保留现有 query；list/board 模式切换保留 stage、tab 和筛选。
- live/cases 复用原 `TradesPage`、详情和 store 编辑链路；浏览器测试覆盖详情返回后的 stage/filter/mode/scroll anchor 恢复。
- overview 使用当前事实实时重算；weekly card 只显示 `metricsSnapshot`，并标记 snapshot/unavailable 来源。
- risk 按同一 stage scope 汇总周准备、策略版本、月度限额与覆盖事件。

### Task 7 deferred weekly 歧义

- `WeeklyReviewTrendPoint` 增加稳定 `key`、`liveStageId`、`stageCount`。
- 选择单 stage 时按 `stageId + weekStart` 保留独立点。
- all-stage 时对同一 `weekStart` 的多个 stage 明确求平均，生成一个聚合点，并保留阶段数量。
- heatmap 使用同一聚合器，不再用 `.find()` 丢失同周其他 stage。

## 直接测试扩展

为迁移直接消费者，最小更新了：

- Dashboard、历史 archive/mode hierarchy、Today、Sidebar、missed、策略导航浏览器夹具。
- 旧 LiveCycle history/dashboard/navigation 测试改为验证显式 stage 合同及旧字段不影响投影。
- workspace facet / regression 的旧周期断言改为 current stage 断言。
- weekly presentation 增加同周跨 stage 聚合展示断言。

未扩展产品平台范围，未做无关视觉重构。

## 实际验证输出

### 聚焦 unit

命令：

`node scripts/run-regression-tests.mjs --unit-only src/lib/stageArchive.test.ts src/lib/workbenchTrades.test.ts src/lib/analysisScope.test.ts src/lib/sidebarWorkspace.test.ts src/lib/workspaceFacetConsistency.test.ts src/data/weeklyReviewTrend.test.ts`

结果：全部通过。

### 完整 unit

命令：`node scripts/run-regression-tests.mjs --unit-only`

结果：`1328 PASS / 0 FAIL`。

### 类型检查

命令：`pnpm typecheck`

结果：通过（renderer + electron TypeScript build）。

### 重点浏览器矩阵

归档 375×812、768×900、1280×900、1920×1080；Dashboard 960×640、1440×900、1920×1080；另含 archive hierarchy、Sidebar Today、Today primary、Today review/detail return。

结果：`11 PASS / 0 FAIL`。

直接受影响的旧周期/导航/missed/weekly 六组复跑：`6 PASS / 0 FAIL`。Sidebar 三组复跑：`3 PASS / 0 FAIL`。

### 完整 browser

结果：`121 PASS / 2 已知 FAIL`。

已知、与 Task 8 无关且按 brief 隔离：

1. `src/components/TradeComposerBatch.browser.test.html#__tradeComposerBatchTest`：stale commit 未返回 typed CAS conflict。
2. `src/components/WebStorageConflict.browser.test.html#__webStorageConflictGuardTest`：加载远端最新版后边界集合仍混合。

Task 8 相关 browser 无新增失败。

## 自审与 concerns

- `git diff --check`：通过；仅 Windows 工作区行尾转换提示，无 whitespace error。
- 对当前/历史消费者检索日期与旧周期依赖：stage resolver、workbench hook、Today、missed、Dashboard、历史页均无日期归属逻辑。
- `Sidebar` 运行时已停止订阅 `liveStatsStartTradingDayKey` / `livePerformanceCycles`；保存视图 helper 与 workbench options 仍保留兼容类型/旧 URL 清理能力，未参与任何 stage 投影，留待 Task 12 删除。
- Dashboard 仍保留统计周期管理 UI/兼容数据本体；它不再决定 Dashboard、下钻或任何当前/历史成员集合。
- 历史周复盘没有冻结快照时明确显示不可用，不回退到实时交易重算。
- 唯一未绿项为 brief 已登记的 CAS/WebStorage 两项；未在本任务越界修复。

## 短状态合同

完成：四种 stage 投影唯一化；全部当前消费者统一 `currentLiveStageId`；历史 stage 导航与五 tab 独立；overview 实时、weekly 冻结；详情返回保留现场；weekly 同周跨 stage 明确聚合；完整 unit/typecheck 绿，full browser 仅保留两项已知红。
