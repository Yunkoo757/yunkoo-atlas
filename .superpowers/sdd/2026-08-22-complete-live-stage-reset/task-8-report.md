# Task 8 报告：用显式 stage ID 统一当前与历史投影

## 交付状态

- 状态：完成
- 基线：`187835ed763c90c1e0fc7df351ba1c298e1a6f36`
- 平台范围：Windows / macOS 桌面客户端；未新增 mobile、iPad、浏览器产品分支。
- 投影真相：运行时只使用 `liveStageId`、`liveStages`、`currentLiveStageId`；日期与旧周期字段不再决定当前/历史归属。

## RED / GREEN

### Fix Round 3（全部类型双来源投影）

按 `task-8-fix-3-brief.md` 先复现 `kind=all` 的 paper 丢失，再分离绩效成员与 live-stage 完整性来源：

1. `stageArchive.test.ts` RED 显示全部类型的 `records`、`eligibleMetricIds`、`pnlIds` 均只剩 `current-live`，应参与的 `paper-valid` 被 Fix Round 2 的 live-only 输入删除。
2. `StatisticsTruthSurfaces.browser.test.tsx` RED 显示策略全部类型从应有 2 个样本、`+$150 / +3.0R` 退化为 1 个样本、`+$100 / +2.0R`。
3. 最小 GREEN：`buildStagePerformanceProjection` 按 kind 建立成员集合——live 使用 stage live、paper 使用所有 paper 且不套 stage、all 使用 stage live + paper；all 的 missing/invalid/future 三组完整性数组再由 live-only 选择结果覆盖。
4. GREEN 后全部类型 records/sample/pnl 同时包含 current live 与 paper、排除 archived live；missing/invalid/future paper 仍不污染 live-stage 完整性。

### Fix Round 2（paper 完整性污染）

按 `task-8-fix-2-brief.md` 建立 canonical paper 夹具（不含 `liveStageId`），先复现再修改实现：

1. `stageArchive.test.ts` RED 同时捕获所选归档 stage 外的 `paper-missing`、`paper-invalid`、`paper-future`，实际三组完整性数组分别泄漏对应 ID。
2. `LiveArchiveView.browser.test.tsx` RED 在所选 stage 的 live 记录日期均有效时，仍因三个外部 paper 记录错误显示 `data-archive-close-day-health` 警告。
3. 最小 GREEN：`buildStagePerformanceProjection` 在进入表现/完整性选择器前使用 `filterStageTrades` 建立 live-only stage 集合；其他继续使用 `filterStageOwnedRecords` 的 paper 工作区消费者不变。
4. GREEN 后 `missingCloseDayIds`、`invalidCloseDayIds`、`futureCloseDayIds` 均为空，归档 overview 不再显示外部 paper 导致的日期完整性警告。

### Fix Round 1（独立审查）

按 `task-8-fix-1-brief.md` 逐项先补回归再修改实现：

1. `stageArchive.test.ts` 先以“历史 stage 的新日期 + 当前 stage 的旧日期”复现 strategy membership 错误，并以 USD/CNY/unknown 数值样本复现跨币种相加；新增单一 `buildStagePerformanceProjection` / `buildStageArchiveOverview` 后转绿。
2. `TradeCloseDialog.browser.test.tsx` 先复现日期修改触发“归属将改变”二次确认；删除 Detail/CloseDialog 的日期周期归属检查后，编辑一次提交且 `liveStageId` 保持不变。
3. `regression.test.ts` 先复现 `/live-history/board` 被判为非法详情来源；修复后 live/case board 均返回原 stage/tab/filter/mode，并恢复锚点焦点。
4. `LiveArchiveView.browser.test.tsx` 先复现 overview 跨币种相加、硬编码 `$`、weekly 隐私泄漏、risk 只有计数；改用统一 USD 资格、隐私格式化、stage 策略拆分和实际风险实体后转绿。
5. `DashboardScope.browser.test.tsx` 恢复独立删除的 mixed/unknown currency、空状态/持仓入口、Dashboard 详情返回、Dashboard/List 一致性、YTD/非法 period、范围标题层级覆盖；成员资格只按 stage ID。
6. `LiveCycleHistory.browser.test.tsx` 先复现当前 stage 为空、历史有记录时 `totalCount=0`；修复为资料库 `totalCount=1`、stage `workspaceCount=0`。
7. 完整 browser 首轮额外捕获 `TradeList` 叶组件直接依赖 Router 的 5 个桌面 viewport 回归；改为工作台显式下传 `StageScope` 后，四个聚焦 viewport 与完整矩阵均转绿。
8. 提交前独立复核捕获四项遗漏：Board 空状态误用 stage 内数量、paper 策略预览缺省扩大到全部实盘、历史 board 详情来源文案未识别、跨 stage 空状态提示不准确。分别补 RED 后统一使用资料库 `totalCount`、把缺省/paper 策略投影限定当前 stage、识别 `/live-history/board`，并改为中性“其他阶段或类型”提示；聚焦及完整矩阵转绿。

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
- risk 除汇总外可浏览 stage 内周准备、策略版本、月度限额与覆盖事件的实际事实，且风险现金字段遵守隐私模式。
- overview 使用统一表现资格与 USD 合并口径，不相加不同币种；显示结果、现金覆盖、日期完整性和 stage 内策略拆分。

### Task 7 deferred weekly 歧义

- `WeeklyReviewTrendPoint` 增加稳定 `key`、`liveStageId`、`stageCount`。
- 选择单 stage 时按 `stageId + weekStart` 保留独立点。
- all-stage 时对同一 `weekStart` 的多个 stage 明确求平均，生成一个聚合点，并保留阶段数量。
- heatmap 使用同一聚合器，不再用 `.find()` 丢失同周其他 stage。

## 直接测试扩展

为迁移直接消费者，最小更新了：

- Dashboard、历史 archive/mode hierarchy、Today、Sidebar、missed、策略导航浏览器夹具。
- 独立 DashboardScope 重新覆盖 mixed/unknown currency、空状态入口、Dashboard 详情返回、Dashboard/List 集合、YTD/非法 period 与标题层级；没有恢复 legacy 周期成员路由。
- 历史页覆盖 live/case board 详情返回、USD 覆盖/排除、隐私 weekly snapshot、stage 策略拆分和四类风险实体。
- 历史 overview 增加 canonical paper 的 missing/invalid/future 平仓日污染回归，同时断言三组完整性数组与真实警告 UI。
- 策略全部类型增加 current live + paper 的样本、USD 盈亏与 R 合并回归，并排除 archived live；unit 同时锁定成员与 live-only 完整性双来源合同。
- TradeCloseDialog 与 store ownership 覆盖日期编辑一次提交并保持原 `liveStageId`；workbench 覆盖 current-empty/history-present 的双计数语义。
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

结果：`1333 PASS / 0 FAIL`。

### 类型检查

命令：`pnpm typecheck`

结果：通过（renderer + electron TypeScript build）。

### 重点浏览器矩阵

归档 375×812、768×900、1280×900、1920×1080；Dashboard 960×640、1440×900、1920×1080；另含 archive hierarchy、Sidebar Today、Today primary、Today review/detail return。

Fix Round 受影响矩阵：archive、Dashboard、LiveCycle history、TradeClose、strategy truth/navigation 与 TradeList 四个桌面 viewport，全部通过。

Fix Round 2 归档受影响矩阵：默认、375×812、768×900、1280×900、1920×1080，`5 PASS / 0 FAIL`。

Fix Round 3 策略/归档受影响矩阵：StatisticsTruthSurfaces + 归档默认及四个 viewport，`6 PASS / 0 FAIL`。

直接受影响的旧周期/导航/missed/weekly 六组复跑：`6 PASS / 0 FAIL`。Sidebar 三组复跑：`3 PASS / 0 FAIL`。

### 完整 browser

最终新鲜结果：`121 PASS / 2 已知 FAIL`。

已知、与 Task 8 无关且按 brief 隔离：

1. `src/components/TradeComposerBatch.browser.test.html#__tradeComposerBatchTest`：stale commit 未返回 typed CAS conflict。
2. `src/components/WebStorageConflict.browser.test.html#__webStorageConflictGuardTest`：加载远端最新版后边界集合仍混合。

Task 8 相关 browser 无新增失败。

## 自审与 concerns

- `git diff --check`：通过；仅 Windows 工作区行尾转换提示，无 whitespace error。
- Fix Round 对 `StrategyHeader`、`StrategiesPanel`、`TradeList`、历史页、workbench、Detail/CloseDialog 检索 `resolveLiveRoute`、`filterLiveLogRecords`、`resolveLiveArchiveScope`、`resolveLiveRecordBucket`、`livePerformanceCycles`、`liveStatsStartTradingDayKey`：无运行时归属依赖。
- `TradeList` 不在叶组件读取路由；由 workbench hook 显式传递 stage，paper/独立组件缺省都限定 current stage，避免策略统计扩大到全部实盘。
- 历史 overview/weekly/risk 所有现金均走 `fmtMoney(..., privacyMode)`；跨币种只展示覆盖与排除，不生成伪总数。
- 历史 overview（`kind=live`）的表现与日期完整性在选择器前先收窄为所选 stage 的 live 集合；外部 paper 不会进入 missing/invalid/future 任一数组，paper 工作区过滤语义未改变。
- `kind=all` 的绩效成员明确为所选/current stage live + paper；三组日期完整性数组独立来自 live-only stage 集合，避免用一个过宽或过窄输入同时承担两种语义。
- requesting-code-review 提交前复核只检查本 Fix Round 范围；发现的 Board 计数、paper 策略投影、历史 board 来源文案与跨 stage 提示四项均已补回归并修复；CAS/WebStorage 两项按 brief 保持 deferred，未越界修改。
- 对当前/历史消费者检索日期与旧周期依赖：stage resolver、workbench hook、Today、missed、Dashboard、历史页均无日期归属逻辑。
- `Sidebar` 运行时已停止订阅 `liveStatsStartTradingDayKey` / `livePerformanceCycles`；保存视图 helper 与 workbench options 仍保留兼容类型/旧 URL 清理能力，未参与任何 stage 投影，留待 Task 12 删除。
- Dashboard 仍保留统计周期管理 UI/兼容数据本体；它不再决定 Dashboard、下钻或任何当前/历史成员集合。
- 历史周复盘没有冻结快照时明确显示不可用，不回退到实时交易重算。
- 唯一未绿项为 brief 已登记的 CAS/WebStorage 两项；未在本任务越界修复。

## 短状态合同

完成：四种 stage 投影唯一化；strategy/current/history membership 只认 stage；日期编辑保持归属；绩效按 live/paper/all 分支且 all 合并 stage live + paper，live-stage 完整性独立排除 paper 污染；历史 overview 使用统一 USD/完整性/策略口径，weekly 冻结且隐私安全，risk 可浏览实体；live/case board 返回保留现场；Dashboard 独立回归恢复；完整 unit/typecheck 绿，full browser 仅保留两项已登记红。
