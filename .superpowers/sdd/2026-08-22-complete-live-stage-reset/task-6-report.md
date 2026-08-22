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

---

## 修复轮次 1/5（2026-08-22）

### 修复结果

- `riskSetupStateForStage` 现在以当前业务日的合法 active policy 与同阶段、同月、合法且能解析来源策略的锁定月限额共同判定；future/非法 policy、非法/月限额缺失均为 `unconfigured`。
- 移除 `unconfigured-clean` 开仓分支。首开在风险建档不完整时只能返回 `requires-risk-setup`，且此判断仍早于 pending、limit、unknown 与 override。
- 首次风险确认的“当日已有平仓”仅统计 `currentLiveStageId`；旧阶段同日平仓不再推迟新阶段 policy，首次当日生效确认会同步锁定当月限额。
- 周草稿与月限额持久化判重改为 `(liveStageId, weekStart/monthKey)`；跨阶段同周/同月允许，同阶段重复继续拒绝。
- 交互开仓、`setStatus`、单笔/批量 `upsert` 与原子 override 重算均拒绝历史/null 阶段交易；新增稳定结果 `not-current-stage`，UI 明确说明历史交易不可在当前阶段开仓，不展示 override 原因或风险设置误导链接。
- merge 导入不再把外部或 legacy preparation/policy/monthly limit/override 映射到当前阶段：缺失、未知或声称属于当前阶段的风险配置会被跳过并记录只含条数的非敏感警告；显式属于本地已知历史阶段的风险资料保留原归属。
- 修复全部 12 个 unit 归档 fixture 与 2 个 archive browser fixture，使 live/case 记录引用各自快照的 `currentLiveStageId`；生产 validator 未放宽。

### RED 证据

命令：

`node scripts/run-regression-tests.mjs --unit-only src/lib/stageRisk.test.ts src/lib/tradeOpenRiskGate.test.ts src/store/liveStageOwnership.test.ts src/store/riskGateIntegration.test.ts src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts src/lib/importMerge.test.ts src/lib/riskGatedTradeOpenCommit.test.ts`

结果：exit 1，新增回归逐项命中旧行为：future policy 提前 configured、缺月限额仍进入普通 unknown、历史/null planned 未明确拒绝、旧阶段同日平仓推迟首版、跨阶段同周期键被全局拒绝、导入风险被映射 current、atomic override 未按阶段取消。

补充月限额合同 RED：

`node scripts/run-regression-tests.mjs --unit-only src/lib/stageRisk.test.ts`

结果：exit 1；非法月限额曾被视为已建档。修复后合法性与来源策略均纳入合同。

### GREEN 与实际门禁输出

简报四文件：

`node scripts/run-regression-tests.mjs --unit-only src/lib/stageRisk.test.ts src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.test.ts src/store/riskGateIntegration.test.ts`

结果：exit 0，全部 PASS。

风险、validation/codec、import、atomic Store 直接相关测试：

`node scripts/run-regression-tests.mjs --unit-only src/lib/riskPolicy.test.ts src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts src/lib/importMerge.test.ts src/lib/riskImportMerge.test.ts src/lib/riskGatedTradeOpenCommit.test.ts src/store/liveStageOwnership.test.ts src/lib/importConcurrency.test.ts src/lib/importExportAssets.test.ts`

结果：exit 0，全部 PASS；导入用例输出的“已跳过 N 条风险配置”是本轮新增且仅含条数的安全警告合同。

归档 unit：

`node scripts/run-regression-tests.mjs --unit-only electron/library/importCommit.test.ts electron/library/journalZip.test.ts src/lib/webJournalArchive.test.ts`

结果：exit 0，原 12 个 fixture 失败全部恢复。

完整 unit-only：

`node scripts/run-regression-tests.mjs --unit-only`

结果：`UNIT_EXIT=0 FAIL_COUNT=0`。

归档与风险 UI 浏览器聚焦：

`runBrowserRegressionTests(... requestedTestIds: RiskManagement + IndexedDbArchiveReplace + DataIOWebArchive)`

结果：三项全部 PASS，`FOCUSED_BROWSER_FAILED=0`。

完整 browser：

`node scripts/run-browser-tests.mjs . vite.config.ts`

结果：本轮风险与归档浏览器测试全部 PASS；完整门仅剩：

- `TradeComposerBatch.browser.test.html`：`Composer stale commit 必须返回 typed CAS conflict`
- `WebStorageConflict.browser.test.html`：`加载远端最新版后必须恢复完整远端边界集合`

隔离复验命令使用上述两个 `requestedTestIds`，结果 `ISOLATED_FAILED=2`，两项稳定复现。失败断言分别位于 `TradeComposerBatch.browser.test.ts:109` 与 `WebStorageConflict.browser.test.tsx:133`；本轮 diff 未修改这两个测试，也未修改 `indexedDbAdapter.ts`、`webWriteGuard.ts` 或 `persistedSnapshotCoordinator.ts`，与本轮风险/归档修复无代码交集。未出现 Windows 临时端口耗尽。

类型与 whitespace：

- `pnpm typecheck`：exit 0。
- `git diff --check`：exit 0；仅显示 Git 的 LF→CRLF 工作树提示，无 whitespace error。

### 必要直接消费者与测试扩展

除原 Task 6 文件外，本轮最小扩展：

- `src/lib/activeRiskPolicy.ts`：合法 policy selector。
- `src/lib/importMerge.ts`、`src/lib/importMerge.test.ts`、`src/lib/importConcurrency.test.ts`、`src/lib/importExportAssets.test.ts`：外部风险配置隔离、历史风险保留与既有冲突/并发合同。
- `src/storage/snapshotValidation.ts`、`src/storage/snapshotValidation.test.ts`、`src/storage/snapshotCodec.test.ts`：阶段复合周期键。
- `electron/library/importCommit.test.ts`、`electron/library/journalZip.test.ts`、`src/lib/webJournalArchive.test.ts`、`src/storage/IndexedDbArchiveReplace.browser.test.ts`、`src/components/DataIOWebArchive.browser.test.tsx`：schema v12 归档 fixture。
- `src/lib/tradeCloseStore.test.ts`：可信历史 open activity 测试补当前阶段归属，避免误测新的阶段拒绝合同。
- `src/components/RiskManagement.browser.test.tsx`：历史/null 开仓 UI 拒绝与无 override 入口。

### 自审

- 第一开仓顺序：目标必须先是 current-stage live；随后检查 active/合法 policy + 当前月锁定限额；未建档立即返回 setup，普通 pending/预算/override 均不可到达。源码与结果 union 已不存在 `unconfigured-clean`。
- 历史隔离：同日平仓、policy、月限额、planned target、pending 重算、override 新建和 import merge 均使用明确阶段；历史/null target 从四条公开路径都不会被迁移或开仓。
- 首确认：当前阶段无 policy 且本阶段当日无平仓时，policy 当日生效并在同一 Store 更新中物化当前月限额；旧阶段同日平仓回归已覆盖。
- 导入：本地当前阶段已有配置保持不变；外部配置不能建立/覆盖当前阶段建档。只有显式匹配本地已知 archived stage 的风险实体可作为历史资料合并。
- 持久化：跨阶段同周期键可保存，同阶段重复仍 fail-closed；production validator 没有降级。

### Concerns

- 完整 browser 门仍有两个既存、可独立复现的 CAS/WebStorage 失败；按本轮授权未扩张到无关存储并发修复。
- 风险配置被导入跳过时当前返回渠道没有结构化 warnings 字段，因此采用一次只含跳过条数的 `console.warn`；不包含交易、账户或策略内容。

### 修复轮次 1 短状态合同

Task 6 修复轮次 1 完成：完整 unit-only、聚焦风险/归档 browser、typecheck 通过；完整 browser 仅剩两项已隔离复现且与本轮无代码交集的既存 CAS/WebStorage 失败。
