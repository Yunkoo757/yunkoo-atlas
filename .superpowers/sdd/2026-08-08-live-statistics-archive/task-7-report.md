# Task 7 实施报告：发布门禁与跨端体验

## RED

新增 `LiveArchiveView.design.test.ts` 后先只断言历史归档范围和待整理数量必须具备 `aria-live="polite"`。在未改生产代码时运行：

```powershell
node scripts/run-regression-tests.mjs --unit-only src/views/LiveArchiveView.design.test.ts
```

稳定以 exit 1 失败，错误为“历史归档范围和待整理数量必须向辅助技术发布可读状态”。这证明页面在视觉上可用但读屏用户无法得知当前归档范围，未通过删除断言或放宽门禁获得结果。

## GREEN

- `LiveArchiveView` 在首页与详情均增加 `role="status" aria-live="polite"` 的范围状态；待整理入口增加带数量的文字标签，计数不再只依赖颜色或位置。
- 归档卡片网格在窄容器将最小列宽限制为容器宽度，卡片/摘要可收缩，长交易编号与链接可断行；375px 下卡片底部操作改为纵向排列，避免横向溢出。
- 浏览器夹具新增实际 `scrollWidth <= innerWidth`、live region、待整理可读名称与详情链接键盘焦点断言。
- 归档夹具增加 20,000 笔交易的首页和详情实测。
- `LiveArchiveView.design.test.ts` 是静态设计补充检查；发布行为门禁以真实浏览器 DOM 的 live region、无溢出、路由和键盘焦点断言为准。

## 浏览器与性能证据

使用项目 Vite 配置与 Playwright 直接执行归档夹具，四档视口全部通过（React Router v7 future warning 为现有允许 warning，未出现 error）：

| 视口 | 首页 20k | 详情 20k |
| --- | ---: | ---: |
| 375×812 | 60.0ms | 1694.0ms |
| 768×900 | 57.0ms | 1679.5ms |
| 1280×900 | 57.7ms | 1663.4ms |
| 1920×1080 | 56.2ms | 1688.8ms |

同一夹具验证：首页、详情、返回、待整理入口、案例关联、来源删除可发现性、事实修正和当前日志迁移；`WebStorageConflict.browser.test.html` 在 1280×900 通过，覆盖 CAS 冲突阻塞、救援导出、只读锁和丢锁冻结。

完整 `node scripts/run-browser-tests.mjs` 实际运行 124 秒后无输出并被超时中止，**未记为通过**；因此采用上述项目 Vite/Playwright 的聚焦夹具作为可复现替代证据。

## 发布门禁

已通过：

```powershell
pnpm typecheck
node scripts/run-regression-tests.mjs --unit-only src/lib/liveStatisticsArchive.test.ts src/lib/livePerformanceCycleRoute.test.ts src/lib/analysisScope.test.ts src/lib/savedTradeViews.test.ts src/storage/persist.test.ts
pnpm build
pnpm test:release
pnpm build:app
node scripts/run-forced-kill-evidence.mjs --output $env:TEMP\atlas-task7-forced-kill.json
node scripts/benchmark-analytics.mjs --smoke --stdout-only
git diff --check
```

强杀报告为 `pass`：真实 `SIGKILL` 发生在原子临时文件阶段，恢复值为最后确认的 `confirmed-revision-1`；三处 schema migration 强杀边界均恢复至 schema v10，未出现未确认新 revision。

以下完整门禁没有通过，均如实保留：

- `node scripts/run-browser-tests.mjs`：124 秒无输出超时；使用项目 Vite/Playwright 对本任务归档四档和 Web 冲突夹具替代验证。
- `pnpm test`：同样在 124 秒无输出超时，因其包含完整浏览器发现器；不记 PASS。
- `node scripts/run-regression-tests.mjs`：完整浏览器部分在 124 秒无输出超时；不记 PASS。
- `node scripts/check-governance.mjs --require-execution`：因完整场景执行指纹未生成而失败，未改治理规则；失败条目均是完整浏览器/跨端场景证据而非本任务断言放宽。
- `pnpm benchmark:analytics; pnpm benchmark:persistence:release` 的组合命令在 124 秒无输出超时；analytics 使用同脚本 smoke 替代验证通过（10k dashboard p95 23.591ms），持久化 release gate 未记 PASS。

## 范围与状态

- 设计规格状态已更新为“实施完成，待发布验收”。
- 不复制、移动或删除交易、案例、图片、正文或周复盘快照；未改变已确认的归属、风险或路由口径。
- 修改文件均为 UTF-8 无 BOM；未把用户已有的文档删除、DeepSeek 材料或 `ux-audit/` 纳入本任务。

## Fix Round 1：单次投影、完整键盘路由与真实 Web 冲突恢复

### RED

审查发现归档页虽然把外层数组包在 `useMemo`，但每份归档仍先调用摘要（内部两次全量筛选）再单独构造详情 members；同时原夹具只验证卡片链接 focus/click，并未从 Dashboard 进入，也没有真实 Web 远端边界恢复断言。这些问题不能用放宽 20k 阈值处理。

### GREEN

- 新增 `buildLiveArchiveProjection()`：每个 scope 先且只生成一次日志成员，再把同一成员数组传给摘要派生 KPI、完整度和案例数；`LiveArchiveView` 只消费该 projection。领域单测断言预计算成员与摘要结果一致，浏览器 20k 场景继续实际验证首页与详情。
- 浏览器夹具从真实 `Dashboard` 的“历史归档”链接进入 `/live-archive`，对 Dashboard→首页、卡片→详情、详情→首页的原生链接逐一做可聚焦和 Enter/Space 激活路径断言；详情返回后再继续原有事实修正流程。
- Web 冲突夹具保存完整远端 `livePerformanceCycles`，将本地未确认边界置入 Store 后触发 revision conflict：断言写入口冻结，点击“加载资料库最新版”后 Store 仅恢复远端完整集合，且本地 cycle ID 不残留。该行为验证替代了先前仅 mock `saveSnapshot` 数组的跨端表述；Electron 原子恢复仍只由强杀报告单独证明。

### Fix Round 1 验证

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/liveStatisticsArchive.test.ts src/storage/persist.test.ts src/views/LiveArchiveView.design.test.ts
pnpm typecheck
git diff --check
```

均通过。项目 Vite + Playwright 聚焦夹具通过：

| 视口 | 首页 20k | 详情 20k |
| --- | ---: | ---: |
| 375×812 | 48.6ms | 1680.1ms |
| 768×900 | 43.5ms | 1680.9ms |
| 1280×900 | 41.0ms | 1675.6ms |
| 1920×1080 | 42.7ms | 1674.9ms |

`WebStorageConflict.browser.test.html` 也通过上述完整远端边界恢复和冲突冻结场景。完整 browser/regression/`pnpm test` 的 124 秒无输出超时状态保持不变，未记为通过。

## Fix Round 2：可信键盘事件验收

审查指出浏览器夹具中的合成 `KeyboardEvent` 后接无条件 `.click()` 不会生成浏览器可信键盘事件，且页面文本可能让路由断言假绿。已移除该伪键盘 helper；原夹具只保留链接可聚焦与常规点击流程。

新增不参与通用 browser discovery 的最小 HashRouter 夹具和 `scripts/qa-live-archive-keyboard.mjs`。脚本通过 Playwright 的 `page.keyboard.press('Enter')` 生成可信事件，并同时检查地址栏 hash 与 `useLocation()` 路由探针，依次验证：

```text
Dashboard → #/live-archive → #/live-archive/keyboard-archive → #/live-archive
```

在 1280×900 下运行 `node scripts/qa-live-archive-keyboard.mjs` 通过。其余聚焦 unit、`pnpm typecheck`、`git diff --check` 也通过；完整 browser/regression/`pnpm test` 的 124 秒无输出超时状态不变，仍未记为通过。

## Fix Round 3：迁移旧 LiveCycleHistory 浏览器合同

### RED

旧 `src/views/LiveCycleHistory.browser.test.tsx` 仍把 `liveStatsStartTradingDayKey` 与 `liveCycle=current/pre-cycle/all` 当成日志范围入口。用项目 Vite + Playwright 运行该夹具时真实失败于“显式当前周期范围必须只显示周期内交易”，说明旧 fixture 已与 `livePerformanceCycles`、`statsCycle=current/archive/pending` 新合同不兼容；未删除失败断言。

### GREEN

- 将夹具数据改为两条 `livePerformanceCycles` 边界、可靠 `closedTradingDayKey`、一条缺平仓日的待整理记录。
- 缺省日志断言改为当前实盘；显式 `statsCycle=current` 保持动态当前；真实 archive ID 仅显示旧归档；`statsCycle=pending` 仅显示待整理；移除 `liveCycle`、`pre-cycle`、`all` 和 `liveStatsStartTradingDayKey` 依赖。
- 保留无边界资料库回退断言：全部历史属于当前，并继续验证交易筛选面板不出现旧实盘周期控件；案例分类计数回归保持不变。

### Fix Round 3 验证

```powershell
# Vite + Playwright，1280×900
LiveCycleHistory.browser.test.html        PASS
LivePerformanceCycleNavigation.browser.test.html PASS
node scripts/run-regression-tests.mjs --unit-only src/lib/liveStatisticsArchive.test.ts src/storage/persist.test.ts src/views/LiveArchiveView.design.test.ts PASS
pnpm typecheck                            PASS
git diff --check                          PASS
```

该修复只修改旧浏览器夹具与本报告；共享工作树中其他代理的 ListView/LiveArchive 改动未纳入本轮提交。
