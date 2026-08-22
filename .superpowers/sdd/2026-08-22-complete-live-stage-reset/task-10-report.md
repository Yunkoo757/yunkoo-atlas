# Task 10 报告 — 显式修复阶段待归属

## 结果

已实现所有 stage-owned 实体的 `liveStageId === null` 待归属发现、人工单项分配、数据健康入口、修复页面和正常耐久保存/失败恢复。

- 只发现显式 `null`；paper 与 `undefined` 不进入队列，也不能被分配。
- 不根据日期、周或月份猜测、推荐或预选阶段；这些字段只作为人工判断上下文。
- 分配只修改目标实体的 `liveStageId`，保留稳定 ID 与其他事实；普通编辑继续保留 repaired ID。
- 待归属实体不进入 current、单阶段 history、all-history 或 performance；保存成功后只进入用户选择的阶段。
- Windows/macOS 桌面页面覆盖默认、960、1280、1920 宽度。

## 实体覆盖矩阵

| 实体族 | 队列类型 | 关键上下文/来源 | 单项分配 | pending 隔离 |
| --- | --- | --- | --- | --- |
| Live Trade | `live-trade` | ref、symbol、开仓/记录/平仓日期 | 通过 | 通过 |
| Missed Trade | `missed-trade` | ref、symbol、记录日期、错过原因 | 通过 | 通过 |
| Case Trade | `case-trade` | ref、symbol、记录日期、来源交易 | 通过 | 通过 |
| WeeklyReview | `weekly-review` | weekStart/weekEnd、状态、更新时间 | 通过 | 通过；正常周复盘与路由也排除 pending |
| WeeklyRiskPreparation | `weekly-risk-preparation` | weekStart、更新时间、政策来源 | 通过 | 通过 |
| RiskPolicyVersion | `risk-policy-version` | 来源周、生效交易日、确认时间 | 通过 | 通过 |
| MonthlyRiskLimit | `monthly-risk-limit` | monthKey、锁定时间、政策来源 | 通过 | 通过 |
| RiskOverrideEvent | `risk-override-event` | 决策交易日、覆盖原因、关联交易 | 通过 | 通过 |

## 领域与持久化行为

- `listPendingStageOwnership` 返回稳定的复合身份、可读标题、原始上下文、来源关系、迁移原因与 stale fingerprint。
- `assignPendingStageOwnership` 不可变更新一个实体，并拒绝：缺失实体、错误类型、已归属、paper、`undefined` ownership、缺失/无效目标阶段、stale 请求、重复身份，以及目标阶段同周/同月周期冲突。
- 案例与风险覆盖的来源展示字段参与 stale fingerprint；无关 paper 与其他实体族同 ID 不会误拒。
- 合法 pending 快照中的 `weekly-risk-preparation:null:<week>` 与 `monthly-risk-limit:null:<month>` 稳定 ID 在分配后继续通过中央快照校验。
- codec 与 JSON import 保留八类实体的 `null` ownership；native 创建/编辑路径仍写当前阶段或保留既有归属，不会新造 `null`。
- UI 保存前先通过正常 persistence controller 冲洗并耐久化已有草稿，再捕获回滚边界并应用分配。分配写盘失败或 typed revision conflict 时，恢复待整理状态并耐久写入回滚；已冲洗的交易/周复盘正文不会被旧数组覆盖。失败后可显式重试，只有耐久成功才显示成功并移出队列。

## TDD 证据

### 初始 RED

- 纯领域测试因 `stageOwnershipRepair` 模块不存在失败。
- Store 集成测试因 repair action 不存在失败。
- UI 浏览器测试因修复页面/健康入口不存在失败。
- v12 快照验证对 WeeklyReview 与风险实体 `null` ownership 拒绝。
- 页面成功状态缺少可访问反馈时，新增断言先失败。

### 审查修复 RED

- stage-period 冲突未抛 `ownership-conflict`。
- paper 跨实体族同 ID 导致周复盘误报 `paper-trade`；来源变化未触发 stale。
- pending 周复盘深链仍被接受，浏览器历史列表出现 pending 项。
- `null` stable risk IDs 分配后被快照校验拒绝。
- 保存失败场景无法完成“草稿 pre-flush → 分配写盘失败 → 耐久回滚”三步，证明原回滚边界会丢草稿。

### GREEN

- 八类实体发现、分配、不可变性、所有拒绝规则、scope 转移、编辑保留归属全部通过。
- pending 周复盘在路由、当前页、历史列表和年度趋势中均隔离。
- 草稿安全 pre-flush、普通失败、typed conflict、耐久回滚与重试全部通过。
- 独立 Fix Round 1 复审：`PASS`，原 1 Critical、3 Major、2 Minor 全部 Closed，无新增 finding。

## 最终门禁

- 聚焦 repair + archive + weekly route + store + snapshot validation/codec + migration：退出码 `0`。
- 完整 unit：退出码 `0`。
- `pnpm typecheck`：退出码 `0`。
- `pnpm qa:design`：退出码 `0`。
- Task 10 修复页浏览器：默认、`960x640`、`1280x900`、`1920x1080` 全部 PASS。
- WeeklyReview 受影响浏览器：默认、`960x640`、`1280x900`、`1920x1080` 全部 PASS。
- 完整 browser：除以下两项计划明确 deferred 的既有失败外全部 PASS：
  - `TradeComposerBatch.browser.test.html`：Composer stale commit typed CAS conflict。
  - `WebStorageConflict.browser.test.html`：加载远端最新版后的完整远端边界恢复。
- `git diff --check`：通过。
- 所有变更文本：UTF-8、无 BOM。

## 自审

- 没有日期推断、默认目标阶段或 audit reason 要求。
- 没有修改 deferred CAS/WebStorage 生产代码或测试。
- 修复操作不改稳定 ID、业务日期、正文、金额、状态、来源关系或其他实体切片。
- 失败路径不声称成功；rollback 失败给出重新打开资料库核对的恢复提示。
- 数据健康入口显示实时精确数量；页面具备键盘标签、busy、`status`/`alert` 反馈和无横向溢出验证。
