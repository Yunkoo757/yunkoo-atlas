# Task 11 报告：随机复盘覆盖当前与历史实盘阶段

## 交付状态

- 状态：完成。
- 基线：`d4928ac`。
- 平台范围：Windows / macOS 桌面客户端；仅验证 960、1280、1920 三档桌面宽度，没有新增 mobile、iPad 或浏览器产品适配。
- 默认范围：每个新建/默认轮次使用 `current-and-history`，覆盖当前阶段与全部仍存在的归档阶段。
- 阶段归属：`null`、`undefined` 与未知 `liveStageId` 不进入正常复盘池；历史案例评估只更新原实体，不复制、不移动、不改写 `liveStageId`。

## 阶段来源矩阵

| `stageSource` | 实盘 / 案例候选 | 模拟盘 |
| --- | --- | --- |
| `current-and-history` | 当前阶段与全部仍存在归档阶段 | 不套阶段条件，继续由 `includeAccountTrades` 独立控制 |
| `current` | 仅 `currentLiveStageId` | 同上 |
| `all-history` | 全部 archived，明确排除 current | 同上 |
| `{ stageIds }` | 精确选择仍存在的阶段；去重并按 `sequence`、`id` 稳定排序 | 同上 |
| `{ stageIds: [] }` | 保持空，不自动扩大 | 若独立启用模拟盘，模拟盘仍可进入 |

所有来源继续复用原有资格判断：删除实体排除；due 模式下已掌握案例排除；到期判断不变；账户交易仍要求 closed/missed、复盘完成且有有效内容；Fisher–Yates 随机与轮内不重复语义不变。编辑日期不参与阶段成员资格。

## 会话迁移、持久化与 reconciliation

- `stageSource` 写入既有 library-scoped `yunkoo-atlas:review-session:v2:<libraryId>`，未新增全局或跨资料库 key。
- v2 旧会话缺少字段时确定性迁移为 `current-and-history`；codec 接受三个固定字符串或 `{ stageIds: string[] }`，拒绝其他形状。
- 显式阶段集合在恢复时按当前 `liveStages` 归一化：只删除已不存在的 stage ID，保留 surviving IDs、原轮次顺序、游标与评估。
- 若显式阶段全部消失，恢复为空会话并展示清晰空筛选状态，不静默扩到默认范围。
- rollover 后，活动轮次按“当前 + 历史仍存在实体”的资格重新校验，不因 current/archived 状态互换取消；来源快照仍保持原选择。
- 恢复继续删除已删除、已不存在或不再满足既有内容/到期资格的实体，不修改任何实体归属。

## UI 与交互

- 复盘设置新增“当前阶段 + 全部历史 / 仅当前阶段 / 全部历史阶段 / 自选阶段”。
- 自选列表按稳定阶段顺序显示当前/已归档状态与日期，使用原生 checkbox，可键盘聚焦；切换到自选时从空集合开始，绝不自动选择。
- 开始页显示当前来源摘要；每个条目显示“来源 · 当前阶段”、归档阶段名或独立的“模拟盘”。
- 活动轮次可“调整范围”；实际改变筛选时先使用现有确认语义，取消保留原会话，确认后重建队列。
- 空自选会话可持久恢复，并可重新选择有效来源回到可开始状态。
- 详情路由往返、评估快捷键、会话恢复与图片就绪合同保持可用。

## TDD 证据

### RED

1. 先增加默认/current/history/explicit/null/paper 池测试；首跑准确得到 3 个 stage-source 失败，证明旧池没有阶段来源合同。
2. 再增加 storage round-trip、缺字段迁移、missing-stage pruning、显式空集合与 rollover 测试；首跑准确得到 4 个会话生命周期失败。
3. 新建 stage-source 浏览器 fixture 后，首跑因默认来源控件不存在失败；实现 UI 后继续覆盖活动轮次确认、原地历史评估、来源标签与路由恢复。
4. 空集合恢复用例曾准确捕获“改选有效来源后仍停留空态”，生产修正后转绿。

### GREEN

- 聚焦 review + shortcut：`node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts src/shortcuts/reviewSessionActions.test.ts`，`29 PASS / 0 FAIL`。
- 完整 unit：`node scripts/run-regression-tests.mjs --unit-only`，`1369 PASS / 0 FAIL`。
- 受影响 browser：ReviewSession、ReviewSessionImageReadiness、ReviewSessionStageSource 的默认、960×640、1280×860、1920×1080，`12 PASS / 0 FAIL`。
- `pnpm typecheck`：退出码 0。
- `pnpm qa:design`：退出码 0，设计合同通过。
- `git diff --check`：通过；仅 Windows worktree 的 LF→CRLF 提示，无 whitespace error。

### 完整 browser

`node scripts/run-browser-tests.mjs . vite.config.ts` 退出码 1；Task 11 新增/受影响 fixture 与其全部桌面矩阵均通过，其后其他 fixture 也全部通过。仅复现 brief 明确允许保留的两项既有失败：

1. `TradeComposerBatch.browser.test.html`：`Composer stale commit 必须返回 typed CAS conflict`。
2. `WebStorageConflict.browser.test.html`：`加载远端最新版后必须恢复完整远端边界集合，不能留下本地/远端混合集合`。

本任务没有修改 `TradeComposerBatch`、`WebStorageConflict` 或其 CAS/WebStorage 生产边界，未越界修复。

## 测试时序根因记录

stage-source 浏览器测试最初用 `[aria-label="阶段来源"]` 查询 Select。关闭选项后，选择器会同时命中当前 trigger 与仍处于 exit 动画的 listbox clone，等待条件可能在旧节点上提前满足，继而误判 sessionStorage 没有更新。测试收窄到 `button[aria-label="阶段来源"]` 并等待真实 trigger 文案提交后，持久化断言稳定通过；生产会话写入时序无需规避或延迟。

## 自审

- 成员边界：live/case 只认显式 stage ID；paper 不受阶段选择污染；pending 无入口。
- mutation 边界：历史评估通过原 ID 调用 `updateTradeData`，测试同时断言实体总数、ID 与 `liveStageId` 不变。
- session 边界：沿用 library-scoped v2 key；缺字段迁移、显式空集合与 rollover 均有直接单测，详情往返有浏览器回归。
- UI 边界：多选是原生键盘控件；三档桌面宽度无横向溢出；没有触摸/mobile 分支。
- 延后边界：CAS/WebStorage 两项相关文件 diff 为零。

## 短状态合同

`默认当前+全部历史；stage ID 决定成员；pending 永不进入；paper 独立；显式空不扩容；缺失阶段只剪枝；rollover 保活；历史评估原地写回；会话按资料库持久化。`
