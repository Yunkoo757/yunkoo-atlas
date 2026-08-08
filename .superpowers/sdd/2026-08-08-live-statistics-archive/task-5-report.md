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

## Fix Round 3：范围文案、结果完整度与多边界性能证据

### RED

补充浏览器断言后，旧实现稳定失败于右开边界直接显示 `1月1日 – 2月1日`，而用户需要看到边界前一日；同时夹具加入结果冲突记录，要求“冲突 1”和“待补 1”分别可见，旧实现只显示笼统的“待补”。

### GREEN

- `rangeLabel()` 使用本地业务日计算右边界前一日，避免把下一轮起点误显示成当前归档日期。
- `summaryText()` 分开呈现 `conflictCount` 与 `missingResultCount`，保留完整结果分母。
- 浏览器性能夹具升级为 20,000 条交易、8 条边界（7 个非空历史归档），首页断言列出 7 张卡片，详情固定到 19,993 条成员；1280px 实测首页约 94.5ms、详情约 1,689ms，均在现有门槛内。

验证：archive 单测通过；归档浏览器夹具四档全部 PASS。该轮执行时共享 worktree 的 `pnpm typecheck` 曾被父任务未提交的 `LivePerformanceCycleNavigation.browser.test.tsx` 类型错误阻塞（与本轮 Task5 文件无关），本轮已在父任务修复后重新通过；自身 diff/no-BOM 检查通过。

## Fix Round 4：失效归档请求提示

### RED

核对 Task2 的 `resolveLiveRouteNavigation()` 后确认，失效历史链接会导航到 `/live-archive?archiveReason=missing&requestedKey=gone-cycle`。新增浏览器断言后，旧归档页稳定失败于“失效归档提示必须保留原请求 ID”，证明页面丢失了路由原因与原始请求。

### GREEN

- `LiveArchiveView` 读取 `archiveReason` 与 `requestedKey`，在首页和未找到详情状态显示“找不到历史归档……已返回历史归档首页”的可读提示。
- 提示使用 alert 语义并保留可见原始 ID；没有改变 Task2 的路由归一化，也没有把实现字段暴露到普通归档卡片。
- 增加对应警示样式，沿用现有间距与颜色 token。

验证：归档单测 PASS，`pnpm typecheck` PASS；浏览器夹具 `375×812`、`768×900`、`1280×900`、`1920×1080` 全部 PASS；diff/no-BOM PASS。

## Fix Round 5：空的最早归档回退首页

### RED

补充非空周期但没有边界前成员的浏览器场景：直接访问 `/live-archive/pre-cycle`。旧页面因投影被过滤后找不到 summary，稳定停留在“未找到这个归档”，没有回到首页。

### GREEN

- `LiveArchiveView` 将空 `pre-cycle` 视为保留导航入口，使用 `navigate('/live-archive', { replace: true })` 回退首页。
- 真实无效 ID 仍保留 Fix Round 4 的 `archiveReason/requestedKey` 提示，不与空 pre-cycle 混淆。
- 增加内核单测，确认没有前置成员时不生成空投影；浏览器夹具断言 URL 已 replace 到首页且不显示错误。

验证：archive 单测、`pnpm typecheck`、`git diff --check`、UTF-8 无 BOM 和四档浏览器夹具全部通过。

## Fix Round 6：陈旧书签统一回退与特殊 ID 链接

### RED

新增直接访问 `/live-archive/stale-cycle` 的浏览器场景。旧页面只显示“未找到这个归档”，URL 仍停留在详情路径，且没有统一的“原历史范围不存在”提示。

### GREEN

- 真实未知 `archiveId` 现在 replace 到 `/live-archive?archiveReason=missing&requestedKey=<原 ID>`，复用统一的原历史范围提示；带已有 `archiveReason` 的失效查询仍保留原请求 ID。
- 归档卡片详情链接使用 `encodeURIComponent(item.archiveId)`，避免合法 ID 含 `/` 或 `?` 时路径被拆解；夹具覆盖 `archive/2026?one`。

验证：`pnpm typecheck`、归档单测、diff/no-BOM 及浏览器四档全部通过。

## Fix Round 7：响应式断点治理

### RED

设计治理单测 `testResponsiveBreakpointsUseTheSharedViewportSet` 稳定失败，指出 `LiveArchiveView.css` 使用未治理的 `600px` 断点。

### GREEN

将归档页窄屏媒体查询统一到项目允许的 `640px` 断点；布局规则和四档视口行为保持不变。

验证：设计治理单测、`pnpm typecheck`、diff/no-BOM 通过；浏览器夹具 `375×812`、`768×900`、`1280×900`、`1920×1080` 全部 PASS。
