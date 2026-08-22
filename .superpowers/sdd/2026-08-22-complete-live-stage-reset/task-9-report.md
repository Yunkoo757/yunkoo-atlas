# Task 9 报告：用预约式阶段交接替代旧实盘重置界面

## 交付状态

- 状态：完成。
- 基线：`b3dd86c`。
- 平台范围：Windows / macOS 桌面客户端；新界面只验证 960、1280、1920 桌面宽度，没有新增 mobile、iPad 或浏览器产品分支。
- 用户入口：仪表盘阶段操作与“设置 → 数据 → 实盘阶段”统一为“开启新实盘阶段”。
- 调度真相：预约日期、到期检查、阻断、顺延和耐久提交继续由 Task 4/5 的 `stageRollover` / `stageRolloverCommit` / Store / persistence 链路负责；UI 没有另建日期或 rollover 真相。

## RED / GREEN 证据

### 领域与 Store

先在 `stageRollover.test.ts` 和 `liveStageOwnership.test.ts` 增加预约前阻断展示与“重命名只改 name、并通过 v12 规范快照往返”的合同测试。

- RED：聚焦 unit 首轮分别报缺少 `listStageRolloverBlockers` export，以及 `renameLiveStage is not a function`。
- GREEN：抽出原 `inspectDueStageRollover` 内的同一阻断算法供 UI 只读展示；Store 增加窄作用域 `renameLiveStage(id, name): boolean`，拒绝空白/无变化/未知 ID，只重建目标阶段名称并复用 canonical stage graph 校验。
- GREEN 结果：相关 stage/store 聚焦测试 `24 PASS / 0 FAIL`；完整 unit 随后退出码 0。

### 阶段管理与全局 banner

先创建 `LiveStageManager` / `StageRolloverBanner` 浏览器夹具，再接入生产入口。

- RED 1：完整 browser 首轮无法解析尚不存在的 `LiveStageManager`（同组 banner 也尚不存在）。
- RED 2：组件建立后，集成测试明确捕获 Dashboard 仍缺少“开启新实盘阶段”操作、Data Settings 仍缺少新入口。
- RED 3：增强 blocker 文案断言后，manager/banner 均因没有明确写出“当前阶段周复盘”而失败。
- GREEN：Manager 展示当前阶段、下周一、归档/保留范围、交易/案例/周复盘/风险计数与全部当前阻断项；允许带阻断预约、拒绝第二预约、在耐久交接前取消，并支持当前/历史阶段自由重命名。
- GREEN：Banner 位于 `AppFrame` 主内容顶部，只要 `scheduledStageRollover !== null` 就跨路由持续显示；顺延后显示新日期、计划中/持仓中数量、当前阶段周复盘阻断和“不自动取消”，同时不加 overlay/inert，不锁定正常工作。
- GREEN：四个默认聚焦流程全部通过；Manager 与 Banner 的默认、960×900、1280×900、1920×1080 共 `8 PASS / 0 FAIL`。

### 旧入口与设计契约

- RED：旧历史副标题仍出现“重置起点前”；先由 `LiveArchiveView.design.test.ts` 捕获，再统一改为“历史阶段”。
- RED：新的计数/banner 样式未满足业务数字 tabular 字体合同；补足既有 typography contract 后转绿。
- RED：`pnpm qa:design` 首轮发现新 CSS 使用未定义 `--radius-pill`，同时暴露基线 QA 仍只查找已迁出的内联 `TradesPage` 函数。
- GREEN：新 CSS 改用已有 `--radius-full`；QA 直接消费者同时验证 `App.tsx` 的 `TradesPage` import 和 `src/views/TradesPage.tsx` 内的 canonical `<ListView>`，最终全部通过。
- 生产源检索不再出现“重置实盘统计 / 重置统计 / 管理统计周期 / 确认重置 / 重置起点前”。阶段管理及入口源也没有 `DatePicker`、`type="date"`、“开始日期”或“起点”。
- `LiveCycleSettings.tsx` 仅保留为未连接的旧/修复组件，没有生产消费者；它的 DatePicker 没有被复用为标准阶段管理入口，也未越界改造成 Task 10 的 pending-data repair。

## 实现与接口决定

### 复用 Task 4/5 权威逻辑

- `listStageRolloverBlockers(state, effectiveWeekStart)` 是从既有 `inspectDueStageRollover` 原样抽出的纯函数；到期检查仍调用该函数，因此 dialog/banner 与耐久执行不会出现两套阻断规则。
- 预计下周一通过既有 `scheduleStageRollover(currentTradingDayKey, ...)` 生成；界面没有日期输入，也没有自行计算 Monday。
- 打开 Manager 调用既有 `notifyStageManagementOpened()`，继续触发 Task 5 的到期检查。
- Task 5 在 due 后使用全局 cutover inert 锁；耐久执行开始后取消交互会被统一拦截。UI 自身没有绕过或复制该锁。
- schedule/cancel/rename 均显式 `flushPersistNow()`；保存失败恢复调用前的预约或阶段数组，并再次尝试持久化回滚状态。

### 展示合同

- 当前阶段显示名称与开始日；预约显示 canonical 下周一/现有生效日。
- 归档范围：实盘交易、实盘案例、周复盘、四类风险记录；新阶段风险明确恢复为未建档。
- 全局保留：策略、标签、模板、随记和其他全局设置。
- 阻断项区分计划中、持仓中、当前阶段周复盘未完成；明确“阻断不影响预约、到期自动顺延”。
- 已有预约禁用确认按钮并显示取消入口；Store 的单预约合同继续防止直接重复调用覆盖。
- current/history 阶段均可改名；Store/快照回归锁定日期、序号、状态、指针、schedule 和实体 ownership 不变。

## 文件

新增：

- `src/components/LiveStageManager.tsx/.css/.browser.test.tsx/.browser.test.html`
- `src/components/StageRolloverBanner.tsx/.css/.browser.test.tsx/.browser.test.html`

删除：

- `src/components/LivePerformanceCycleManager.tsx/.css/.browser.test.tsx/.browser.test.html`

主要修改：

- `src/App.tsx`
- `src/components/LivePerformanceCycleControl.tsx/.css`
- `src/views/Dashboard.tsx`
- `src/views/settings/DataSettingsPanel.tsx`
- `src/lib/stageRollover.ts/.test.ts`
- `src/store/useStore.ts`
- `src/store/liveStageOwnership.test.ts`
- 直接受影响的 Dashboard、Data Settings、archive copy、lifecycle、typography 与 QA 契约测试。

## 实际验证输出

### 聚焦 unit / browser

- `node scripts/run-regression-tests.mjs --unit-only src/lib/stageRollover.test.ts src/store/liveStageOwnership.test.ts`：`24 PASS / 0 FAIL`。
- `node scripts/run-browser-tests.mjs . vite.config.ts` 的新组件 requested IDs：Manager/Banner 默认流程全部通过。
- 新组件桌面矩阵：默认、960×900、1280×900、1920×1080，共 `8 PASS / 0 FAIL`。
- `src/views/LivePerformanceCycleDashboard.browser.test.html#__livePerformanceCycleDashboardTest`：通过。
- `src/views/settings/DataSettingsAssetInventory.browser.test.html#__dataSettingsAssetInventoryTest`：通过。
- `src/views/LiveArchiveView.design.test.ts`：`3 PASS / 0 FAIL`。

### 完整 unit / design / type

- `node scripts/run-regression-tests.mjs --unit-only`：退出码 0，全部通过。
- `pnpm qa:design`：全部检查通过，最终输出 `PASS: Trader Atlas design contract`。
- `pnpm typecheck`：通过（renderer + electron TypeScript build）。
- `git diff --check`：通过；仅 Windows worktree 的 LF→CRLF 提示，无 whitespace error。

### 完整 browser

命令：`node scripts/run-browser-tests.mjs . vite.config.ts`

结果：Task 9 新增/受影响浏览器测试及其桌面矩阵全部通过；完整套件仅复现以下两项既有失败，没有新增失败：

1. `src/components/TradeComposerBatch.browser.test.html#__tradeComposerBatchTest`：`Composer stale commit 必须返回 typed CAS conflict`。
2. `src/components/WebStorageConflict.browser.test.html#__webStorageConflictGuardTest`：`加载远端最新版后必须恢复完整远端边界集合，不能留下本地/远端混合集合`。

这两个失败已在 Task 6、7、8 报告中以相同断言登记。本轮没有修改 `TradeComposerBatch`、`WebStorageConflict`、`indexedDbAdapter`、`webWriteGuard` 或 `persistedSnapshotCoordinator`，按 brief 记录为 deferred，没有越界修复。

### 源码与编码检查

- 标准生产 UI 旧文案检索：0 命中。
- 新阶段入口/manager/banner 的任意日期选择检索：0 命中。
- `LiveCycleSettings` 生产 import graph：0 个运行时消费者；仅自身 browser fixture 与 typography 测试引用。
- 所有新增/修改文本文件以严格 UTF-8 解码，且无 UTF-8 BOM。

## 自审与 concerns

- Manager 的 preview、dialog blocker、banner blocker、due inspection 分别只调用 Task 4 的 schedule/blocker API，没有复制日期计算、preceding-week 或周复盘完成判断。
- Banner 是 App shell 直接消费者，不依赖 Dashboard/settings 生命周期；跨路由测试已验证持续存在。
- Banner 只展示状态，不设置禁用、inert 或 overlay；预约期间“新建交易”浏览器动作已实际执行。
- duplicate schedule 同时由 UI disabled 与既有 Store 单预约合同保护；cancel/rename 都在耐久失败时恢复旧状态。
- 重命名测试比较了目标 stage 的全部非名称字段、current pointer、schedule 与 trade reference，并执行 canonical v12 snapshot round-trip。
- 生产入口不再 import `LiveCycleSettings` 或旧 Manager；旧 Manager 及其正常 browser fixture 已删除。
- CSS 只包含桌面压缩断点 `max-width: 1099px`，没有 mobile/touch 专用实现；960/1280/1920 均无横向溢出。
- 未执行 Windows/macOS 打包产物的手工 Electron E2E；本轮以项目 browser harness、renderer/electron typecheck 和 design contract 验证桌面行为。
- 唯一未绿项是 brief 明确允许保留、且与本轮代码无交集的两项 CAS/WebStorage deferred 失败。

## 短状态合同

完成：所有标准入口改为预约开启新实盘阶段；下周一、阻断、顺延和提交复用 Task 4/5 真相；全局持久 banner 跨路由展示且不锁正常工作；单预约可取消；当前/历史阶段名称只改 name 并可规范持久化；旧 reset/date-picker 正常入口已移除；完整 unit/design/type 绿，完整 browser 仅保留两项已登记 deferred 红。
