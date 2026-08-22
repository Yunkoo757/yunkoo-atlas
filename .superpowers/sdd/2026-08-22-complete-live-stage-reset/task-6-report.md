# Task 6 报告：新阶段风险重置与首次开仓建档

## 结果

- 新增纯函数 `riskSetupStateForStage(state, stageId)`，只以目标阶段的已确认风险策略判断 `configured/unconfigured`。
- 风险策略、草稿、月限额、预算计算、风险修复、风险状态卡、周复盘冻结证据、开仓 Gate 和 override 提交复核均显式携带并过滤 `liveStageId`。
- 运行时风险起点改为所选 `LiveStage.startsOn`；`liveStatsStartTradingDayKey` 不再参与预算、Gate 指纹、风险卡或风险修复的运行时口径。
- 新阶段允许保存 planned trade；首次 planned→open 在限额、unknown 与历史 pending/override 之前返回 `requires-risk-setup`。
- UI 使用独立风险建档引导，只提供“前往风险设置”，不渲染“继续开仓原因”，不能绕过建档。
- 新草稿、确认策略与月限额使用阶段化 ID；同周/同月旧阶段实体不会被复用，也不会阻止新阶段创建。
- rollover 发布会清空旧的 pending 风险确认与风险建档引导。

## TDD RED

### 首轮四文件 RED

命令：

`node scripts/run-regression-tests.mjs --unit-only src/lib/stageRisk.test.ts src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.test.ts src/store/riskGateIntegration.test.ts`

结果：exit 1，符合预期：

- `stageRisk.test.ts`：缺少 `src/lib/stageRisk`。
- `riskBudget.test.ts`：旧阶段策略、月限额与交易仍进入新阶段预算。
- `tradeOpenRiskGate.test.ts`：未返回 `risk-setup-required`。
- `riskGateIntegration.test.ts`：Store 未返回 `requires-risk-setup`。

### 写入隔离 RED

命令：

`node scripts/run-regression-tests.mjs --unit-only src/lib/riskPolicy.test.ts src/store/liveStageOwnership.test.ts`

结果：exit 1；复现旧阶段策略使新阶段首版延后生效、旧同月限额阻止新限额，以及 Store 写入阶段隔离问题。

### 顺序 RED

命令：

`node scripts/run-regression-tests.mjs --unit-only src/lib/tradeOpenRiskGate.test.ts`

结果：exit 1；`testRiskSetupRequirementWinsOverArchivedPendingConfirmation` 证明旧 pending 曾早于新阶段建档判断返回。

### UI RED

命令：完整浏览器门 `node scripts/run-browser-tests.mjs . vite.config.ts`。

结果：`RiskManagement.browser.test.html` 以“未建档开仓没有显示风险设置引导”失败，确认 UI 闭环缺失。

## GREEN 与验证

### 简报四文件最终聚焦

命令：

`node scripts/run-regression-tests.mjs --unit-only src/lib/stageRisk.test.ts src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.test.ts src/store/riskGateIntegration.test.ts`

结果：exit 0；四文件全部 PASS，包括归档风险隔离、新阶段起点、首次开仓顺序、Store 返回值与无原因绕过。

### 直接相关风险、Store、持久化与周复盘

命令：

`node scripts/run-regression-tests.mjs --unit-only src/lib/stageRisk.test.ts src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.test.ts src/store/riskGateIntegration.test.ts src/lib/riskPolicy.test.ts src/store/liveStageOwnership.test.ts src/lib/weeklyReviewSnapshot.test.ts src/lib/riskGatedTradeOpenCommit.test.ts src/storage/snapshotValidation.test.ts`

结果：exit 0；全部 PASS。

### 直接相关浏览器隔离复验

使用浏览器 runner 的 `requestedTestIds` 分别复验：

- `RiskManagement.browser.test.html`
- `LiveCycleSettings.browser.test.html`
- `RiskManagementSettings.browser.test.html`
- `TodayWorkspacePrimaryAction.browser.test.html`
- `WeeklyReviewView.browser.test.html`（默认及 1920×1080、1280×900、960×640）
- `RiskDataRepairView.browser.test.html`

结果：全部 PASS。LiveCycleSettings 中的持久化失败日志是测试显式允许并验证的故障注入。

### 类型与 diff

- `pnpm typecheck`：exit 0。
- `git diff --check`：exit 0；仅 Git 提示工作树行尾将按配置转换，无 whitespace error。

### 完整 unit-only 门

命令：`node scripts/run-regression-tests.mjs --unit-only`

结果：exit 1；本任务所有风险/Store/周复盘用例 PASS。剩余 12 项均为既有导入/归档附件 fixture 的 `unknown liveStageId`，集中在：

- `electron/library/importCommit.test.ts`：3 项
- `electron/library/journalZip.test.ts`：8 项
- `src/lib/webJournalArchive.test.ts`：1 项

未扩张到导入归档 fixture 修复。

### 完整浏览器门

命令：`node scripts/run-browser-tests.mjs . vite.config.ts`

最终结果：exit 1；所有本任务直接相关浏览器测试 PASS。剩余 4 项非风险失败：

- `src/components/DataIOWebArchive.browser.test.html`：归档影响预览未出现
- `src/components/TradeComposerBatch.browser.test.html`：stale commit 未返回 typed CAS conflict
- `src/components/WebStorageConflict.browser.test.html`：远端边界集合恢复不一致
- `src/storage/IndexedDbArchiveReplace.browser.test.html`：fixture 的 trade 引用了未知 `liveStageId`

没有遇到 Windows 端口耗尽；因此无需端口隔离复验。

## 必要直接消费者扩展

简报清单外，为完成显式阶段契约与验证，最小扩展了：

- `src/components/LiveCycleSettings.tsx` 及浏览器测试：当前阶段策略提示。
- `src/components/RiskManagement.browser.test.tsx`：无原因绕过的设置引导与阶段起点展示。
- `src/components/WeeklyRiskPreparationCard.tsx`：当前阶段草稿/策略/月限额，阶段切换强制重置表单源。
- `src/data/weeklyReviews.ts`、`src/lib/weeklyReviewSnapshot.test.ts`、`src/views/WeeklyReviewView.browser.test.tsx`：历史周复盘按其所属阶段冻结风险证据。
- `src/hooks/useRiskDataIssues.ts`、风险设置/修复浏览器测试：修复清单固定使用当前阶段。
- `src/lib/riskGatedTradeOpenCommit.ts` 及测试：重算 Gate 时使用当前阶段 ID/起点，override 继续原子写当前阶段。
- `src/lib/riskPolicy.test.ts`、`src/store/liveStageOwnership.test.ts`：新阶段草稿、首版策略与同月限额隔离。
- `src/storage/snapshotValidation.ts`：兼容旧 ID，并接受新阶段化草稿/月限额 ID。
- `src/views/TodayWorkspacePrimaryAction.browser.test.tsx`：当前风险卡阶段 fixture。

## 自审

- 第一开仓顺序：trade 存在/资格检查后，`riskSetupStateForStage` 先于 existing pending、预算触线、unknown 与 override；回归测试覆盖旧 pending 不能抢先。
- 历史隔离：policy、preparation、monthly limit、trade、override、风险状态与修复问题均按明确阶段 ID；旧阶段同周/同月记录保留但不会命中新阶段。
- 当前风险卡：直接读取 Store `currentLiveStageId` 与对应 `startsOn`，不消费 Dashboard 历史选择状态。
- 新阶段表单：只查当前阶段 preparation/active policy；阶段 ID 加入重置 effect 依赖，不复制旧阶段 draft。
- Windows/macOS 桌面范围：未新增移动端、浏览器产品适配或其他平台分支。

## Concerns

- 全量 unit/browser 门仍受前序阶段迁移后的导入/归档 fixture 不一致影响；本任务的聚焦与直接消费者验证均通过，剩余失败已在上文列明。
- `liveStatsStartTradingDayKey` 仍作为旧绩效周期设置/持久化字段存在，但风险运行时已不再读取它；后续若移除旧绩效周期功能，应由独立任务清理该字段。

## 短状态合同

Task 6 实现完成；聚焦风险、直接消费者、相关浏览器与 typecheck 全部通过。完整 unit/browser 门仅剩已记录的非本任务导入/归档/CAS fixture 失败。
