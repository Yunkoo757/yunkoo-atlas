# 复盘可信度首批优化实施计划

> **执行方式：** 在 `codex/review-trust-first-batch` 分支内按 TDD 顺序直接实施；不改变产品定位，不迁移数据模型。

**目标：** 消除随机复盘对正式复盘状态的污染，确保案例原始复盘可见，让 Today 统一使用交易日口径，并阻止周复盘在正文保存失败时完成冻结。

**原则：** 正式复盘完成状态与随机记忆评估分离；所有“今日”统计共享交易日边界；任何冻结动作都必须以草稿成功落库为前提。

**技术栈：** React 18、TypeScript、Zustand、Electron、项目自定义 Vite 回归测试器。

---

## 任务 1：随机复盘仅纳入可信的账户交易

**文件：**
- 修改：`src/lib/reviewSession.test.ts`
- 修改：`src/lib/reviewSession.ts`

1. 先增加失败测试：账户交易只有在“已结束/错过 + 正式复盘已完成 + 存在有效复盘内容”时才能进入随机池；案例仍遵守案例范围。
2. 运行：`node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts`，确认新测试按预期失败。
3. 在 `buildReviewSessionPool` 中实现账户交易资格判断，复用 `resolveTradeTruth`、`isReviewCompleted` 与有效内容判断。
4. 重跑目标测试并确认通过。

## 任务 2：随机掌握度不再修改正式复盘状态，案例展示完整来源

**文件：**
- 修改：`src/lib/reviewSession.test.ts`
- 修改：`src/lib/reviewSession.ts`
- 修改：`src/views/ReviewSessionView.tsx`

1. 先增加失败测试：账户交易的评估 patch 只更新 `masteryState` 与 `nextReviewAt`，不得更新 `reviewStatus`/`reviewCategory`；案例继续同步案例分类。
2. 先增加失败测试：`getReviewSessionContent` 会合并案例自有笔记与 `sourceNoteHtml`，且账户交易仍返回 `note`。
3. 运行目标单测，确认失败原因分别为状态字段仍存在和来源内容缺失。
4. 最小实现 `buildReviewAssessmentPatch` 的交易类型分支及 `getReviewSessionContent`。
5. 将随机池内容过滤、资源解析及展示依赖统一切换到有效内容函数。
6. 重跑目标单测并运行 `node scripts/run-regression-tests.mjs --unit-only src/views/ReviewSessionView.test.ts`（若该入口存在）。

## 任务 3：Today 统一交易日边界

**文件：**
- 修改：`src/lib/tradeWorkflow.test.ts`
- 修改：`src/lib/tradeWorkflow.ts`
- 修改 Today 工作流调用处（通过搜索确定）

1. 先增加失败测试：交易日从 06:00 开始时，凌晨 04:00 的平仓和复盘归属于前一交易日；已冻结的 `closedTradingDayKey` 优先于时间戳。
2. 运行：`node scripts/run-regression-tests.mjs --unit-only src/lib/tradeWorkflow.test.ts`，确认边界测试失败。
3. 为 Today 指标和队列增加 `tradingDayStartHour` 参数（默认 0 兼容旧调用），使用 `closedTradingDayKey` 与 `getTradingDayKey`。
4. 在 Today 页面传入 store 中的 `display.tradingDayStartHour`。
5. 重跑目标单测并执行 TypeScript 类型检查。

## 任务 4：周复盘完成前强制确认正文已保存

**文件：**
- 修改：`src/views/WeeklyReviewView.tsx`
- 修改：适合该行为的周复盘测试入口

1. 先增加失败测试，证明草稿 flush 返回 `false` 时完成动作被阻止并保留编辑态。
2. 运行目标测试确认失败。
3. 捕获 `flushNoteDraftToStore` 的布尔结果；失败时提示“正文或图片尚未保存，请重试”并立即返回。
4. 重跑目标测试确认通过。

## 任务 5：回归与交付检查

1. 运行受影响单测。
2. 运行：`npm run typecheck`（若脚本名称不同，使用项目实际等价命令）。
3. 运行：`node scripts/run-regression-tests.mjs`，记录全部通过项与任何已知基线失败；不得把基线失败误报为本次通过。
4. 运行 UTF-8/BOM 与 `git diff --check` 检查，确认中文和格式未损坏。
5. 检查 `git diff`，确保无越界改动、无调试代码、无静默吞错。
