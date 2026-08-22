# Task 9 报告：用预约式阶段交接替代旧实盘重置界面

## 交付状态

- 状态：完成。
- 基线：`b3dd86c`。
- Fix Round 1 基线：`cea8627`；独立审查的 3 个 Major 与 1 个 Minor 已全部修复。
- Fix Round 2 基线：`8510119`；legacy v11→v12 归一化名称碰撞已在迁移层稳定消歧，native v12 仍严格拒绝。
- 平台范围：Windows / macOS 桌面客户端；新界面只验证 960、1280、1920 桌面宽度，没有新增 mobile、iPad 或浏览器产品分支。
- 用户入口：仪表盘阶段操作与“设置 → 数据 → 实盘阶段”统一为“开启新实盘阶段”。
- 调度真相：预约日期、到期检查、阻断、顺延和耐久提交继续由 Task 4/5 的 `stageRollover` / `stageRolloverCommit` / Store / persistence 链路负责；UI 没有另建日期或 rollover 真相。

## RED / GREEN 证据

### Fix Round 2：legacy v11 名称兼容

- RED 1：合法 v11 周期包含 NFKC、trim、case 归一化重名时，`migrateLegacyStageSnapshot` 在最终 v12 中央校验抛出“阶段名称必须唯一”，导致旧库、codec 和 import 无法打开。
- GREEN 1：仅在 `migrateLegacyStageSnapshot` 的阶段定义构建中运行稳定消歧。每个 normalized key 的首个显示名逐字保留；后续冲突以 trim 后的原名为基底追加 ` (2)`、` (3)` 等后缀。
- RED 2：若归一化冲突项先于合法 legacy 名 `alpha (2)` 出现，单纯按已处理名称探测会提前占用 `(2)`，迫使原本唯一的 suffix 名改成不稳定的 `alpha (2) (2)`。
- GREEN 2：命名器预留全部 legacy 原始 normalized key，再为冲突项探测候选；因此未来才出现的既有 suffix 也不会被抢占。测试同时锁定自动“更早记录”、既有“更早记录 (2)”、NFKC 全角字母、首尾空格、大小写以及连续 suffix 跳号。
- 不变量：消歧只改迁移产物的 `LiveStage.name`；ID、sequence/order、startsOn/endsOn、status、current pointer 及 trade/review/risk ownership 均不变。原生 v12 不经过此路径，中央 validator 与 JSON import 继续拒绝 normalized duplicate。
- 执行边界：direct migration、canonical snapshot codec、Electron v11 schema migration + `LibraryStorage.open()`、legacy JSON backup import 均有真实回归；另有 native v12 JSON 明确拒绝合同。

### Fix Round 1：独立审查修复

1. **离线多周后的权威顺延**
   - RED：`testPostponementUsesTheNextMondayAfterTheCurrentTradingDay` 在当前交易日为 `2026-09-07` 时得到陈旧的 `2026-09-07`，而不是严格未来的 `2026-09-14`；多周离线同样只给旧预约加七天。
   - GREEN：`postponeStageRollover` 复用同一 `followingMonday(currentTradingDayKey)`，从当前交易/显示日计算下一规范周一。Task 5 执行链集成测试把陈旧 `2026-08-31` 预约在 `2026-09-24` 权威顺延到 `2026-09-28`。
2. **case 永不构成 planned/open blocker**
   - RED：当前阶段的 planned/open case 使 `listStageRolloverBlockers` 返回实盘 blocker。
   - GREEN：新增唯一 live-only 选择器 `listCurrentStageLiveTrades`；authority、Manager 与 Banner 共同消费该选择器。case、paper、已删除和非当前阶段记录都不能进入 planned/open blocker 或展示计数，因此不会出现“有 blocker 但显示 0”的分叉。
3. **恢复 Manager 耐久交互测试强度**
   - RED：在旧 browser fixture 的 blanket `disablePersistWrites()` 下，重命名后保存状态仍为 idle，新增 saved 断言稳定失败。
   - GREEN：fixture 改为在真实 `PersistenceController` / `flushPersistNow` 路径下启用写入，仅在外部 adapter 边界注入可控 save 行为；捕获并检查实际规范快照。
   - 覆盖：rename 成功快照、schedule 保存中的 `aria-busy`/saving 与成功快照、cancel 首次失败后的内存恢复和回滚快照、cancel 成功、schedule typed `StorageRevisionConflictError` 加回滚失败及用户恢复提示、冲突后的显式重试、rename 首次失败后的内存/耐久回滚。测试结束才关闭写入，不再 blanket 绕过 Manager 持久化。
4. **阶段名称中心化唯一性**
   - RED：`assertValidLiveStageState` 接受 trim/case 归一化后重复的名称；Store 把当前阶段重命名为另一阶段名称并返回 true；v12 snapshot validation 也接受歧义阶段图；Manager 只显示笼统“无法保存”。
   - GREEN：`normalizeLiveStageName` 统一执行 NFKC、trim 与大小写归一化；中央 stage validator 拒绝重复，Store 返回 false 且不重建数组，Manager 明确提示“阶段名称已存在，请使用其他名称”，snapshot validation/codec/import 通过中央校验拒绝歧义图。
   - 为避免唯一性新约束阻断未来 rollover，自动阶段名若已被用户占用，会稳定生成 `实盘阶段 N (2)`、`(3)` 等唯一后缀；候选测试锁定该行为。

Fix Round 聚焦 unit 首轮准确得到 4 个预期失败：case blocker、离线一周顺延、中央名称唯一性、Store 重名拒绝；修正独立 snapshot fixture 的时间线后，snapshot validation 也按预期 RED。Manager browser RED 则准确证明 blanket-disabled persistence 无法到达 saved。上述测试均在最小实现后转绿。

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
- `postponeStageRollover` 只从 Task 5 捕获的 `currentTradingDayKey` 计算严格未来周一；不再从可能陈旧的预约日期推导。
- `listCurrentStageLiveTrades` 是 planned/open authority 与两处 UI 计数的共同 live-only 来源；case 不参与实际阻断。
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
- 名称唯一键由中央 `normalizeLiveStageName` 定义；Store、validator、Manager 和自动默认名共同使用，不存在 UI/导入两套归一化规则。
- legacy v11→v12 迁移复用同一 `normalizeLiveStageName`，只在旧周期投影成 v12 stage 时消歧；native v12 validator 不做修复或静默改名。

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
- Fix Round 2：`src/lib/stageMigration.ts/.test.ts`，以及 `snapshotCodec`、Electron schema/open、JSON import 的边界测试。
- 直接受影响的 Dashboard、Data Settings、archive copy、lifecycle、typography 与 QA 契约测试。

## 实际验证输出

### 聚焦 unit / browser

- `node scripts/run-regression-tests.mjs --unit-only src/lib/stageRollover.test.ts src/store/liveStageOwnership.test.ts`：`24 PASS / 0 FAIL`。
- Fix Round 最终命令：`node scripts/run-regression-tests.mjs --unit-only src/lib/stageRollover.test.ts src/lib/stageRolloverCommit.test.ts src/lib/liveStages.test.ts src/store/liveStageOwnership.test.ts src/storage/snapshotValidation.test.ts src/storage/snapshotCodec.test.ts`：全部通过。
- Fix Round 2 聚焦命令：`node scripts/run-regression-tests.mjs --unit-only src/lib/stageMigration.test.ts src/storage/snapshotCodec.test.ts electron/library/schemaMigration.test.ts src/lib/importExportAssets.test.ts`：direct/codec/Electron open/JSON import 全部通过。
- `node scripts/run-browser-tests.mjs . vite.config.ts` 的新组件 requested IDs：Manager/Banner 默认流程全部通过。
- 新组件桌面矩阵：默认、960×900、1280×900、1920×1080，共 `8 PASS / 0 FAIL`。
- Fix Round 的同一 `8 PASS / 0 FAIL` 矩阵包含 Manager 的真实 persistence success/busy/failure/rollback/conflict 路径，以及 Banner 的共享 live-only blocker/count 路径。
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
- 顺延 mutation check：若实现退回 `addDays(scheduled.effectiveWeekStart, 7)`，一周与多周离线用例及 Task 5 集成用例都会失败。
- blocker mutation check：若 live-only 选择器重新接受 case，领域用例失败；若 Manager/Banner 自行分叉计数，两者现已直接消费同一选择器，类型与 browser 数量合同同时失效。
- Manager persistence fixture 只替换最外层慢/故障 adapter，真实 controller、状态切换、snapshot capture、`flushPersistNow` 与组件回滚全部保留；断言面向保存快照、Store、busy/save status 与用户提示，不以 mock 调用本身充当成功证据。
- 名称 mutation check：移除中央 normalized-name set 会同时击穿 stage、Store 与 snapshot validation；移除 UX 判别会击穿 Manager browser；默认名碰撞也有候选回归。
- legacy migration mutation check：移除迁移消歧会在 direct test 重新触发中央 v12 唯一性失败；只检查已处理名称会击穿“suffix 出现在后方”的预留测试；若把消歧错误用于 native v12，JSON 严格拒绝测试会失败。
- Banner 是 App shell 直接消费者，不依赖 Dashboard/settings 生命周期；跨路由测试已验证持续存在。
- Banner 只展示状态，不设置禁用、inert 或 overlay；预约期间“新建交易”浏览器动作已实际执行。
- duplicate schedule 同时由 UI disabled 与既有 Store 单预约合同保护；cancel/rename 都在耐久失败时恢复旧状态。
- 重命名测试比较了目标 stage 的全部非名称字段、current pointer、schedule 与 trade reference，并执行 canonical v12 snapshot round-trip。
- 生产入口不再 import `LiveCycleSettings` 或旧 Manager；旧 Manager 及其正常 browser fixture 已删除。
- CSS 只包含桌面压缩断点 `max-width: 1099px`，没有 mobile/touch 专用实现；960/1280/1920 均无横向溢出。
- 未执行 Windows/macOS 打包产物的手工 Electron E2E；本轮以项目 browser harness、renderer/electron typecheck 和 design contract 验证桌面行为。
- 唯一未绿项是 brief 明确允许保留、且与本轮代码无交集的两项 CAS/WebStorage deferred 失败。

## 短状态合同

完成：所有标准入口改为预约开启新实盘阶段；下周一、离线多周后的顺延和提交复用 Task 4/5 当前日真相；只有当前 stage 的真实 live 计划/持仓可阻断，Manager/Banner 共用同一选择器；全局持久 banner 不锁正常工作；Manager 的真实写盘/忙碌/失败/回滚/conflict 边界有桌面矩阵覆盖；阶段名中央归一化唯一且默认名安全避碰；legacy v11 在迁移层稳定消歧并保留全部非名称边界，native v12 继续严格拒绝；旧 reset/date-picker 正常入口已移除；完整 unit/design/type 绿，完整 browser 仅保留两项已登记 deferred 红。
