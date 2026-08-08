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
- 归档夹具增加 20,000 笔交易的首页和详情实测；摘要和日志成员继续复用同一个 `archiveEntries` memoized 投影，未新增循环周期映射。
- 持久化单测证明公共快照写入会一次携带完整的旧归档边界与新当前边界集合，不能写出半集合；Web 冲突夹具既有“禁止覆盖写入 / 丢锁冻结写入”路径复测通过。Electron 强杀证据由最终门禁执行。

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
