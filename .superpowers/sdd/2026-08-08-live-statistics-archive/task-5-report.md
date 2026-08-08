# Task 5 实施报告：历史归档页面

## RED

先新增 `LiveArchiveView.browser.test.html/.tsx`，夹具注入两个边界、126 条旧实盘、当前实盘、缺少平仓日记录与两个来源案例，并断言首页、归档指标、关联案例、待整理入口、详情及返回路径。首次浏览器发现器启动后无输出，已主动中止；此时新增夹具因 `@/views/LiveArchiveView` 不存在而无法解析，失败可直接归因于页面模块缺失，未删除断言。

## GREEN

- 新建 `LiveArchiveView`：首页倒序渲染非空历史边界，卡片的已平仓数、完整度、案例数和 KPI 都使用 `buildLiveArchiveSummary()`；空边界不显示。
- 详情固定 `archiveId`，仅展示该摘要的绩效交易；入口标明“平仓日期”，不提供成员移动操作。
- 顶部待整理入口固定到共享 `/list?statsCycle=pending`；不混入归档 KPI。
- 新增 `/live-archive` 与 `/live-archive/:archiveId` 路由、低频 Sidebar 入口；交易详情返回语境允许保留归档地址。
- 小屏为单列卡片与纵向标题布局，无横向固定宽度。

验证：

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/liveStatisticsArchive.test.ts
pnpm typecheck
```

均通过。浏览器夹具使用项目 Vite 配置在 `375×812`、`768×900`、`1280×900`、`1920×1080` 四档均通过；覆盖首页、详情、返回、待整理和案例计数。

## 自审

- `git diff --check` 通过。
- 目标文件均为 UTF-8 无 BOM。
- 未改写交易、案例、图片或正文；未复制日期边界判断。
- `DetailView` 已有“原交易已不存在”展示；本任务只复用现有能力，未提前实现 Task 6 的事实修正或导入行为。

## 顾虑

归档详情当前只展示结果完整的已平仓交易，结果冲突/缺结果记录仍通过完整度提示可见而不进入 KPI；后续 Task 6 可在不改变摘要口径的前提下补充待整理修复与事实变更提示。

## Fix Round 1：归档日志成员、筛选与详情语境

### RED

浏览器夹具补充只有错过机会且关联案例的边界、缺结果已平仓记录、详情搜索与平仓日期范围操作。旧实现稳定失败于“仅含日志成员的归档不能被隐藏”：它按 `closedCount > 0` 判断卡片，证明该边界被错误隐藏。

### GREEN

- 首页的存在性改为同一 archive scope 的 `filterLiveLogRecords()` 成员数；仅日志成员的归档显示“暂无已平仓记录”，仍保留关联案例。
- 详情列表改用固定 archive scope 的完整日志成员集；KPI 保持 `buildLiveArchiveSummary().trades`，结果冲突、待补结果和错过机会行均有明确状态。
- 加入本地只读搜索、平仓业务日起止筛选；筛选只收窄固定归档成员，未改变任何归属边界。
- DetailView 在归档来源下显示“历史归档”并提供“返回历史归档”的无障碍文案。
- 归档 CSS 已整理为多行规则并使用间距 token。

验证：`src/lib/liveStatisticsArchive.test.ts`、`pnpm typecheck`、`git diff --check` 全部通过；归档浏览器夹具在 375×812、768×900、1280×900、1920×1080 均通过。目标文件已检查 UTF-8 无 BOM。

## Fix Round 2：保留最早边界前历史

### RED

最终整包审查补充单边界夹具：只有一条边界且存在边界前交易时，旧实现因 `cycles.slice(0, -1)` 没有任何卡片，浏览器断言“单边界前的旧交易必须生成归档卡片”稳定失败。

### GREEN

- 归属内核新增 `LIVE_ARCHIVE_PRE_CYCLE_ID`、`pre-cycle` 左闭右开范围（`[null, 第一条边界)`）和 `listLiveArchiveProjections()`，统一枚举最早边界前隐式归档与所有非当前边界；只保留有日志成员的投影。
- 首页改为消费共享投影列表，不再假定数组最后一项之外都是归档；单边界和多边界均可从首页进入稳定的 `/live-archive/pre-cycle` 详情。
- 补充单元断言与浏览器断言，验证最早边界前交易在卡片和详情可达。

验证：`node scripts/run-regression-tests.mjs --unit-only src/lib/liveStatisticsArchive.test.ts`、`pnpm typecheck`、`git diff --check`、UTF-8 无 BOM 检查通过；浏览器夹具四档 `375×812`、`768×900`、`1280×900`、`1920×1080` 全部 PASS。
