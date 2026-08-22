# Task 10 报告 — 显式修复阶段待归属

## 结果

已实现所有 stage-owned 实体的 `liveStageId === null` 待归属发现、人工单项分配、数据健康入口、修复页面和正常耐久保存/失败恢复。

- 只发现显式 `null`；paper 与 `undefined` 不进入队列，也不能被分配。
- 不根据日期、周或月份猜测、推荐或预选阶段；这些字段只作为人工判断上下文。
- 分配只修改目标实体的 `liveStageId`，保留稳定 ID 与其他事实；普通编辑继续保留 repaired ID。
- 公共 domain/Store 命令强制携带 stale fingerprint；缺失或变化都会在写 Store 前以 typed error 拒绝。
- 风险/案例来源及其反向依赖必须与目标阶段一致；来源仍待归属时明确要求 dependency-first，不会生成跨阶段关系图。
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
- `assignPendingStageOwnership` 不可变更新一个实体，并拒绝：缺失 fingerprint、缺失实体、错误类型、已归属、paper、`undefined` ownership、缺失/无效目标阶段、stale 请求、重复身份、跨阶段/缺失/待归属依赖，以及目标阶段同周/同月周期冲突。
- `rollbackAssignedStageOwnership` 是目标实体级 CAS 反向 patch：仅当最新实体仍保持本命令写入的 stage 时把 ownership 恢复为 `null`；保留目标其他并发字段及所有无关 slice，删除/类型/ownership 变化会返回 `rollback-conflict`，绝不覆盖最新资料。
- 案例与风险覆盖的来源展示字段参与 stale fingerprint；无关 paper 与其他实体族同 ID 不会误拒。
- 合法 pending 快照中的 `weekly-risk-preparation:null:<week>` 与 `monthly-risk-limit:null:<month>` 稳定 ID 在分配后继续通过中央快照校验；风险建档按 ownership、月份与来源策略消费月限额，不解析 ID 猜归属。
- codec 与 JSON import 保留八类实体的 `null` ownership；native 创建/编辑路径仍写当前阶段或保留既有归属，不会新造 `null`。
- UI 保存前先通过正常 persistence controller 冲洗并耐久化已有草稿，再应用分配。分配写盘失败或 typed revision conflict 时，在最新 Store 上执行目标 ownership CAS 回滚并耐久写入；第二次保存期间出现的目标正文、无关交易和周复盘草稿均被保留。回滚写盘失败保持 `error/dirty` 供重试；CAS 冲突显示重新打开资料库核对的恢复指引且不覆盖并发归属。只有耐久成功才显示成功并移出队列。

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
- Fix Round 1 中，第二次保存被阻塞时写入目标正文、无关交易与周复盘草稿；旧整数组回滚断言失败，证明会覆盖并发编辑。
- 缺失 fingerprint 仍能提交、风险来源跨阶段/仍 pending 仍能提交，新增 typed rejection 断言先失败。
- 修复后的 `monthly-risk-limit:null:<month>` 通过快照规则但 `riskSetupStateForStage` 仍返回 `unconfigured`。
- ownership 在第二次保存期间并发变化时，原行级反馈随目标离队不可见，页面级恢复断言先失败。

### GREEN

- 八类实体发现、分配、不可变性、所有拒绝规则、scope 转移、编辑保留归属全部通过。
- pending 周复盘在路由、当前页、历史列表和年度趋势中均隔离。
- 草稿安全 pre-flush、普通失败、typed conflict、耐久回滚与重试全部通过。
- Fix Round 1 聚焦 GREEN：目标级 CAS 回滚、并发字段保留、rollback flush failure、Store/disk/dirty 一致性、relationship graph、required fingerprint、null-prefix risk consumer 与 open gate 全部通过。
- WeeklyReview、WeeklyRiskPreparation、RiskPolicyVersion、MonthlyRiskLimit、RiskOverrideEvent 均经真实 UI 单项分配、正常 persistence controller 耐久保存、逐步快照校验、最终重载及对应消费者验证。
- 最终独立复审：`PASS`，上次 1 Critical、2 Major、2 Minor 全部关闭，无 blocking/non-blocking finding；deferred TradeComposerBatch CAS / WebStorageConflict 未计入。

## 最终门禁

- 聚焦 repair + risk + store + persistence：退出码 `0`。
- 完整 unit：退出码 `0`。
- `pnpm test:identity` 与完整 quality node tests（143 项）：退出码 `0`。
- `pnpm typecheck`：退出码 `0`。
- `pnpm qa:design`：退出码 `0`。
- governance（60 个场景、870 个 UTF-8 文本文件）：通过。
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
- 失败路径不声称成功；rollback 写盘失败保留 pending 快照供重试，rollback CAS 冲突不覆盖最新 Store 并给出重新打开资料库核对的提示。
- relationship graph 同时检查待修复实体的 outgoing source 和被修复 source 的已归属 incoming dependents；pending dependent 允许 source-first，pending source 明确拒绝，周期唯一性仍在关系校验后执行。
- 数据健康入口显示实时精确数量；页面具备键盘标签、busy、`status`/`alert` 反馈和无横向溢出验证。
