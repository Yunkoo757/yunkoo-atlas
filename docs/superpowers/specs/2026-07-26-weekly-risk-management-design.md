# Trader Atlas 周度风控准备与风险预算设计 v3

> 日期：2026-07-26
> 状态：已实施并验证
> 基线：`main@043f6cb`
> 范围：周度风控准备、账户预算 R、日/周/月止损进度、开仓 Gate、周复盘证据
> 数据版本：`PersistedSnapshot` Schema v9

## 1. 结论

本功能采用“持续提醒、触线后软确认”的风控闭环：

1. 每周提醒用户复核资金基准、1R 金额、日/周止损线与纪律文本。
2. 账户风控统一使用 `budgetR = 可信 PnL / 对应规则版本的 riskAmount`。
3. 现有交易 `rMultiple` 继续表示单笔交易质量，不参与账户预算计算。
4. 日、周、月进度统计未删除且已平仓的实盘交易；盈利返还额度，无法归期或量化的已知亏损进入 `unknown`，不得先过滤为安全。
5. Gate 绑定实盘交易首次进入 `open`，与来源状态无关，也不绑定创建计划记录。
6. 触线或风险状态未知时，每笔首次开仓都必须填写继续交易原因。
7. 状态变化与确认事件在同一个持久化快照事务中提交。
8. 已确认规则不可原地覆盖；周规则版本化并向后生效，月止损线整月锁定。
9. 确认事件进入周复盘，并在完成复盘时与绩效事实一起冻结。

主入口仍位于“今日工作台”，不新增独立风控中心。

## 2. 审查问题与裁决

本 v3 吸收前期设计讨论与六轮独立审查，锁定以下裁决：

| 审查问题 | v3 裁决 |
|---|---|
| 交易 R 与账户预算 R 混用 | 拆分；只有 `budgetR` 进入止损进度 |
| 新建计划即可触发或绕过 Gate | Gate 改到首次进入 `open` |
| 缺失结果被当成安全 | 增加覆盖状态；未知亏损触发降级确认 |
| 冲突结果可能返还额度 | 必须复用现有 TradeTruth 合同 |
| 修改规则可追溯解除触线 | 已确认规则不可变；新版本只向后生效 |
| 月限额可被每周重写 | 当前月锁定；修改只影响下月 |
| 一次 Zustand set 被误称为原子 | 原子性定义为同一 Web/Electron 持久化提交 |
| 切库与恢复可能漏搬字段 | v9 明确枚举所有 hydrate/apply/reset/writer 通道 |
| Electron Snapshot 与 Manifest 版本分叉 | 定义带恢复点的 v8→v9 升级 |
| JSON 版本仍标 v8 | JSON 与 Schema 明确升级到 v9 |
| 周复盘可能冻结混合时点 | 从同一最新 Store state 原子生成事实快照 |
| Composer 不是所有开仓入口 | 使用全局 `TradeOpenRiskDialog` |
| 非 `planned` 状态或底层 `setStatus` 可绕过 Gate | 首次 `open` 成为领域层不变量，通用状态动作 fail-closed |
| 异常平仓日期让亏损消失 | 先扫描终态交易；缺失、非法或未来亏损日期进入 unknown |
| 交易日起始小时追溯改写历史 | 平仓事实提交时持久化 `closedTradingDayKey` |
| v9 缺字段被静默补空 | 仅旧版本迁移可补默认值；原生 v9 使用严格结构校验 |
| Electron 半迁移无法从强杀恢复 | 增加持久迁移标记、恢复副本和启动恢复协议 |
| 导入事件可能关联错误交易 | 定义稳定身份、完整引用图与保守 unresolved 规则 |

## 3. 目标与非目标

### 3.1 目标

- 每周低干扰地提醒用户复核风险规则。
- 按账户实际盈亏展示日、周、月止损预算。
- 在继续承担实盘风险前制造一次明确停顿。
- 让触线后的继续交易原因可关联、可复盘、可冻结。
- 在不完整数据下诚实表达“不确定”，不伪造安全结论。
- 复用现有交易日、TradeTruth、Zustand 快照、CAS、Electron 原子替换和周复盘能力。

### 3.2 非目标

- 不计算持仓中、挂单中或同时持仓的潜在风险。
- 不统计账户高点回撤。
- 不连接券商、交易所或实时账户净值。
- 不实现多账户、多币种、保证金或组合风险。
- 不建设通用事件账本或规则引擎。
- 不按 `rMultiple` 估算账户资金损失。
- 不阻止创建、复制或导入计划记录。
- 不对历史导入和备份恢复弹出逐笔 Gate。

## 4. 术语

| 术语 | 定义 |
|---|---|
| trade R | 现有 `rMultiple`；本笔结果相对本笔初始止损风险的倍数 |
| budget R | 本笔可信 PnL 相对生效账户 R 金额的倍数 |
| riskAmount | 某个不可变周规则版本锁定的账户 1R 金额 |
| active policy | 在指定业务日期生效的最新 `RiskPolicyVersion` |
| coverage | 周期统计的完整程度：`complete`、`partial` 或 `unknown` |
| Gate | 实盘交易首次进入 `open` 前的风险判定与必要确认 |
| override event | 用户在已触线或风险未知时仍继续开仓的审计证据 |

`trade R` 与 `budget R` 量纲不同，任何代码、文案和测试不得混用。

## 5. 用户流程

### 5.1 首次使用

系统为当前周创建准备草稿：

- R 百分比：1%；
- 日止损：2R；
- 周止损：5R；
- 月止损默认值：10R；
- 资金基准：空；
- 纪律文本：空。

未建立有效规则，且没有已实现亏损、结果冲突或其他未知风险时，状态为 `unconfigured-clean`：用户可正常创建计划和首次开仓，准备卡持续提醒设置基准。

若尚无有效规则但已经出现已平仓亏损，系统无法判断 budget R，状态变为 `unknown`；下一笔首次开仓需要降级确认。

### 5.2 新交易周

新周准备草稿从最新有效规则复制，但不会自动标记为本周已复核：

- 上一有效规则持续生效，因此忘记复核不会让风控失效；
- 准备卡一直显示，直到用户完成本周复核；
- 不复核不会阻止浏览、记录计划、复盘或设置操作。

### 5.3 确认与修改周规则

准备弹窗展示当前有效版本、新草稿和预计生效日期。用户可编辑：

- 资金基准；
- R 百分比；
- 自动计算的 R 金额；
- 日止损线；
- 周止损线；
- 本周纪律文本；
- 未来月份采用的月止损默认值。

一致性规则：

- `riskAmount = capitalBase * riskPercent / 100`；
- 金额沿用项目现有 USD 口径，`riskAmount` 按最小货币单位保留两位小数；第一版不新增币种设置；
- 修改资金或百分比时重算金额；直接修改金额时反算百分比；
- 确认后保存不可变版本；
- 新周首次确认且当天没有已平仓实盘交易时，可从当天生效；
- 其他周中修改一律从下一交易日生效；
- 历史交易继续使用其平仓业务日对应的旧版本；
- 当前月止损线只读，新的月默认值只能影响下一个尚未锁定的月份。

### 5.4 今日工作台

在现有“行动队列”下方、“今日战绩”上方依次展示：

1. 本周准备卡；
2. 日、周、月风险预算卡。

准备卡未复核时常驻，复核后折叠为规则摘要。预算卡展示：

- 周期净 budget R；
- 止损线与剩余额度；
- 进度与状态；
- 参与统计的交易数量；
- 未计入数据及原因；
- 当前纪律文本。

正收益时已用额度为 0。只有可信 PnL 才能返还额度。

### 5.5 首次进入持仓

所有无可信既往 open 证据的实盘首次 `→ open` 请求，无论来源状态，统一调用 `requestTradeOpen(tradeId)`：

- `below`：立即沿用现有普通状态变更；
- `triggered`：打开全局 `TradeOpenRiskDialog`；
- `unknown`：打开同一对话框，但明确显示“无法确认当前是否触线”；
- `unconfigured-clean`：允许进入 `open`，继续显示设置提醒。

纯计划创建、批量复制、CSV/Notion 导入和完整归档恢复不触发 Gate。模拟计划转换为实盘后，在首次进入 `open` 时正常经过 Gate。

已有通过领域命令生成且校验有效的 `open` 状态活动的交易再次改回 `open`，按数据修正处理，不重复生成 override event。

### 5.6 确认对话框

`TradeOpenRiskDialog` 复用现有全局 `TradeCloseDialog` 模式，由 Store 中的 pending request 驱动：

- 展示触线周期或未知原因；
- 展示日/周/月 budget R、限额和覆盖状态；
- 展示有效规则版本、生效日期和纪律文本；
- 原因去除首尾空白后必须为 1–500 字；
- Esc 取消请求，交易保持提交前状态；
- 关闭后焦点优先返回原操作入口；入口已卸载时使用稳定 fallback。

每一笔首次开仓独立确认，不提供“本日不再询问”。

### 5.7 周复盘

周复盘在“本周事实”之后增加“风控执行”：

- 本周生效过的规则版本；
- 各交易日最终 budget R；
- 本周最终 budget R；
- 完成复盘时的月度 budget R；
- 数据覆盖状态；
- 触线或未知状态下继续开仓的次数；
- 每次确认原因和关联交易状态。

风险摘要不声称还原日内高点回撤。短暂触线后来恢复时，只有实际产生的 override event 证明当时的决策状态。

## 6. 数据模型

### 6.1 基础类型

```ts
type RiskPeriodScope = 'day' | 'week' | 'month'
type RiskCoverage = 'complete' | 'partial' | 'unknown'
type RiskUnknownReason =
  | 'missing-loss-pnl'
  | 'result-conflict'
  | 'missing-policy'
  | 'missing-close-date'
  | 'invalid-close-date'
  | 'future-loss-close-date'

interface RiskPolicyDraft {
  capitalBase: number | null
  riskPercent: number
  riskAmount: number | null
  dailyLossLimitR: number
  weeklyLossLimitR: number
  monthlyLossLimitRDefault: number
  disciplineText: string
}

interface RiskPeriodOutcomeSnapshot {
  netBudgetR: number
  limitR: number
  consumedR: number
  remainingR: number
  progress: number
  coverage: RiskCoverage
  triggered: boolean
  includedTradeCount: number
  excludedTradeCount: number
  unknownReasons: RiskUnknownReason[]
}
```

`unknownReasons` 去重后使用稳定顺序，确保 fingerprint 和测试结果不受遍历顺序影响。

`Trade` 增加 `closedTradingDayKey?: string`。它不是显示设置，而是平仓事实的一部分：实盘交易提交 `win`、`loss` 或 `breakeven` 且 `closedAt` 有效时，在同一交易提交中按当时的 `tradingDayStartHour` 计算并持久化；以后修改显示设置不得重算。只有用户通过明确的平仓日期修正动作修改 `closedAt` 时，才在同一次提交中重算该字段。v8→v9 迁移对有效历史平仓日期按迁移时设置补写；无法补写的记录保留为空，并按覆盖状态处理。原生 v9 中，终态实盘交易若有合法 `closedAt` 却缺少或包含非法 `closedTradingDayKey`，快照校验失败；只有 `closedAt` 本身缺失或非法时才允许该字段为空并进入覆盖降级。

### 6.2 WeeklyRiskPreparation

```ts
interface WeeklyRiskPreparation {
  id: string
  weekStart: string
  draft: RiskPolicyDraft
  reviewedAt: string | null
  confirmedPolicyVersionId: string | null
  createdAt: string
  updatedAt: string
}
```

`id` 使用 `weekly-risk-preparation:<weekStart>`，每周最多一条。它只描述准备 UI 的草稿与复核状态，不充当实际计算规则。

### 6.3 RiskPolicyVersion

```ts
interface RiskPolicyVersion {
  id: string
  sourceWeekStart: string
  effectiveTradingDay: string
  capitalBase: number
  riskPercent: number
  riskAmount: number
  dailyLossLimitR: number
  weeklyLossLimitR: number
  monthlyLossLimitRDefault: number
  disciplineText: string
  confirmedAt: string
}
```

不变量：

- 资金和 PnL 的规范计算单位为整数美分，输入显示保留两位小数；
- `capitalBase`、限额 R 和百分比必须是有限正数，按产品允许精度规范化；
- `riskAmount` 使用 `capitalBase × riskPercent / 100` 后执行 round-half-away-from-zero 到整数美分，结果至少为 1 美分；
- `riskAmount` 一致性校验必须使用同一个 canonical 公式重算，不比较未舍入乘积；
- 已创建版本不可更新或删除；
- 多个版本可以共享同一未来生效日，以允许生效前再次修正；所有版本仍保留；
- 指定日期的 active policy 先取 `effectiveTradingDay <= date` 中生效日最晚者，同日再取 `confirmedAt` 最晚者；时间也相同时按 `id` 词典序决定，保证结果确定。

### 6.4 MonthlyRiskLimit

```ts
interface MonthlyRiskLimit {
  id: string
  monthKey: string
  limitR: number
  sourcePolicyVersionId: string
  lockedAt: string
}
```

`id` 使用 `monthly-risk-limit:<YYYY-MM>`。启动完成、跨入新交易月或确认首个有效 policy 时，由显式 `ensureRiskPeriodRecords()` 动作从 active policy 的月默认值创建。没有 active policy 时暂不创建，只在 UI 中显示产品默认 10R 的“待建立”提示；这允许首次设置时确定当前月上限。创建后不可修改。规则版本中的月默认值只影响尚未创建的未来月份。React selector 和纯计算函数不得在读取时隐式创建记录。

### 6.5 RiskOverrideEvent

```ts
type RiskDecisionType = 'triggered' | 'unknown'

interface RiskOverrideEvent {
  id: string
  tradeId: string
  tradeIdentityAtDecision: {
    ref: string
    symbol: string
    tradeKind: 'live'
  }
  linkState: 'resolved' | 'unresolved'
  decisionType: RiskDecisionType
  tradingDayKeyAtDecision: string
  policyVersionId: string | null
  createdAt: string
  reason: string
  fingerprint: string
  outcomesAtDecision: Record<RiskPeriodScope, RiskPeriodOutcomeSnapshot>
  unknownReasons: RiskUnknownReason[]
}
```

事件不因交易删除而删除。关联交易被删除时仍显示身份摘要；导入冲突时标记 `unresolved`，不得错误关联到同 ID 的另一笔交易。

### 6.6 WeeklyRiskReviewSnapshot

```ts
interface WeeklyRiskReviewSnapshot {
  policyVersions: RiskPolicyVersion[]
  dailyOutcomes: Array<RiskPeriodOutcomeSnapshot & { date: string }>
  weeklyOutcome: RiskPeriodOutcomeSnapshot
  monthlyOutcomeAtCompletion: RiskPeriodOutcomeSnapshot
  overrideEvents: RiskOverrideEvent[]
  frozenAt: string
}
```

该字段作为 `WeeklyReview` 的可选字段，仅在完成复盘时写入。

### 6.7 PersistedSnapshot v9

新增顶层字段：

```ts
weeklyRiskPreparations: WeeklyRiskPreparation[]
riskPolicyVersions: RiskPolicyVersion[]
monthlyRiskLimits: MonthlyRiskLimit[]
riskOverrideEvents: RiskOverrideEvent[]
```

解码合同必须区分 `RawLegacySnapshot` 与严格的 `PersistedSnapshotV9`：只有 `version <= 8` 的迁移输入允许缺少四个字段并补空数组；`version === 9` 时四个字段全部必填，缺失、类型错误或结构无效均拒绝加载，不得静默规范化为空。v9 writer 必须显式写出四个字段。

## 7. 账户预算计算合同

### 7.1 业务日期

新增唯一的共享 helper：

```text
closedTradingDayKey(trade)
```

- 优先读取交易上已持久化的 `closedTradingDayKey`；
- 新平仓记录在提交平仓事实时计算并固化该值；
- 日期字符串直接视为业务日期；含时间值只在首次固化或明确修正 `closedAt` 时按当时的交易日起始小时转换；
- 修改 `tradingDayStartHour` 不得重算已有交易的业务日；
- 今日工作台、Gate、周复盘交易集合和冻结快照全部复用；
- 当前周期上界始终为 `currentTradingDayKey`；
- 合法但晚于当前交易日的盈利不提前返还额度；未来亏损进入 `unknown`。

### 7.2 合格交易

统计不得先按日期过滤终态交易。第一步扫描满足以下条件的候选交易：

- `tradeKind === 'live'`；
- 未删除；
- 状态是 `win`、`loss` 或 `breakeven`。

第二步才解析结果、平仓业务日和周期归属。存在有效且不晚于统计上界的平仓业务日才可进入数值聚合；无法归期的亏损不能从候选集合消失，必须令当前 Gate 总状态为 `unknown`。缺失、非法或未来日期的盈利不返还额度并产生 `partial` 提示。结果冲突永不进入 budget R，并令 Gate 为 `unknown`。必须复用 `resolveTradeTruth` 和结果权威一致性校验。

### 7.3 可信 PnL

新增纯函数 `resolveTrustedBudgetPnl(trade)`：

- PnL 必须是有限数；
- `resultSource` 必须允许 PnL 作为权威结果；
- 交易状态、PnL 方向和其他权威结果不得冲突；
- `resultSource === 'r'` 时不得读取残留 PnL；
- 现有 `rMultiple` 永不作为 PnL 或 budget R 的替代。

### 7.4 单笔与周期计算

```text
tradeBudgetR = trustedPnl / activePolicy(closedTradingDay).riskAmount
netBudgetR = Σ tradeBudgetR
consumedR = max(0, -netBudgetR)
remainingR = max(0, limitR - consumedR)
progress = clamp(consumedR / limitR, 0, 1)
triggered = coverage != unknown && quantizeR(netBudgetR, 9) <= -quantizeR(limitR, 9)
```

日限额取目标业务日期的 active policy。当前周限额取当前交易日的 active policy；历史周复盘取冻结日的 active policy，因此周规则变更只影响其生效后的 Gate，不改写旧版本或旧确认事件。月限额取 `MonthlyRiskLimit`。月度净 R 允许跨多个周规则版本，每笔交易分别使用其平仓日版本换算后相加。

金额先规范化为整数美分，再参与除法。`quantizeR(value, 9)` 使用 round-half-away-from-zero 固定到 9 位小数；单笔 budget R、聚合结果、fingerprint 和触线比较均使用同一规范值，UI 再独立格式化显示。不得直接用未经规范化的 IEEE-754 中间值判断精确触线。

### 7.5 覆盖状态

| 状态 | 条件 | Gate 语义 |
|---|---|---|
| complete | 所有候选交易均有有效业务日、可信 PnL 和有效 policy | 正常判断 below/triggered |
| partial | 仅有缺失或无法归期的盈利，或未明确为亏损的保本数据；已知亏损均可量化和归期 | 不返还缺失正收益；允许正常判断并显示保守提示 |
| unknown | 存在无法量化或归期的亏损、结果冲突或亏损缺少 policy | 不声称 below；首次开仓进入未知确认 |

未来盈利不提前改变当前额度，但显示 partial；未来亏损、缺失亏损日期和非法亏损日期分别记录稳定的 unknown reason。

### 7.6 进度示例

本周 `riskAmount = $1,000`：

| PnL 序列 | budget R | 日限额 2R 已用 | 状态 |
|---|---:|---:|---|
| `-$1,000, +$2,000` | `+1R` | `0R` | below |
| `+$1,000, -$2,000` | `-1R` | `1R` | below |
| `+$3,000, -$4,000` | `-1R` | `1R` | below |
| `-$1,000, -$1,000` | `-2R` | `2R` | triggered |
| loss 且 PnL 缺失 | 不可计算 | 不显示安全结论 | unknown |

系统不计算期间高点回撤。

## 8. Gate 状态机与原子提交

### 8.1 统一入口

领域不变量：任何未删除的实盘交易，只要目标状态为 `open` 且没有可信既往 open 证据，就必须经过 Gate，与当前来源状态无关。`planned → open`、`missed → open`、终态修正为 `open`，以及 paper 转为 live 后首次进入 `open` 均适用。

“可信既往 open 证据”仅指该交易持久化 activities 中通过领域命令生成、结构有效且时间不晚于当前状态活动的 `status: open` 事件；导入数据必须先通过 activity 校验。不得仅凭当前状态、临时 UI 状态或调用者传入布尔值豁免。

通用公开 `setStatus` 对符合上述条件的转换必须 fail-closed，返回 `requires-risk-gate` 且不修改状态。底层无检查写入改为不导出的持久化 primitive，只能由 `requestTradeOpen` 的 below 分支或 `commitRiskGatedTradeOpen` 调用。导入、完整恢复和 fixture 通过命名明确的非交互批量应用入口写入，不能复用用户状态动作。

所有交互入口必须调用：

```text
requestTradeOpen(tradeId, returnFocus)
```

`transitionTradeStatus`、看板拖拽、详情操作、快捷动作和未来新增入口都必须路由到该入口。入口矩阵用于验证交互，不替代底层 fail-closed 保证。

### 8.2 Pending request

Store 保存单个 pending request：

- trade ID；
- 原始 opener 和稳定的 return-focus fallback；
- 目标交易存在性、`tradeKind`、`deletedAt`、稳定身份摘要和 trade revision；
- 是否存在可信 open 历史；
- Gate 状态；
- policy version；
- trading day；
- 三周期 outcome；
- fingerprint。

新的请求不得覆盖尚未处理的请求。

### 8.3 Fingerprint

fingerprint 至少覆盖：

- 目标交易 ID、当前状态、存在性、`tradeKind`、`deletedAt`；
- `ref`、`symbol`、可信 open 历史及目标交易自身 revision/稳定摘要；
- 当前业务日期；
- 业务日口径与目标交易固化的 `closedTradingDayKey`；
- active policy version ID；
- monthly limit ID；
- 参与周期计算的交易结果引用或稳定摘要；
- 三周期 net budget R、limit、coverage 和 unknown reasons。

对话框确认后必须从最新 state 重算。提交前先验证目标仍是未删除、live、需要首次 open Gate 的同一笔交易；不再符合时取消 pending，不执行状态变化。fingerprint 不同则废弃旧确认、更新内容并要求再次确认。

### 8.4 持久化原子性

`triggered/unknown` 的确认提交使用专用 `commitRiskGatedTradeOpen`：

1. flush 已有 pending persist；
2. 暂停普通 autosave；
3. 捕获最新 state/revision；
4. 重算并验证 fingerprint；
5. 在同一候选 state 中修改交易状态、追加状态活动和 RiskOverrideEvent；
6. 使用 Web `commitImport`/CAS 或 Electron 补偿式原子替换提交完整快照；
7. 持久化成功后一次发布到 Zustand；
8. 恢复 autosave。

磁盘失败、CAS 冲突、规则变化或用户取消时，交易保持提交前状态，事件不存在。不得只依赖一次 Zustand `set` 或后续去抖保存。

提交 UI 使用 `idle | committing | error` 生命周期。任何失败都必须在 `finally` 恢复 autosave、清除 `aria-busy`，保留 pending request 与用户原因，并显示可聚焦且可播报的错误。重试前从最新 state 重算；CAS 或 fingerprint 已变化时刷新内容并要求再次确认。取消则清空 pending 并按焦点合同返回。

### 8.5 Undo/Redo

任何首次 open 领域命令都不进入现有通用 Undo/Redo 栈，避免在风险状态变化后由 redo 重放。用户仍可通过显式状态修正离开 open；已经发生的 override event 和可信 open activity 作为审计事实保留，之后再改回 open 属于数据修正，不重复确认。普通 `setStatus`、undo/redo 和导入入口都不能直接调用无检查 primitive。

## 9. 周复盘冻结

复盘完成流程：

1. flush 编辑器正文与图片草稿；
2. 调用 `completeWeeklyReview(reviewId)`；
3. 在一次 `set(state => ...)` 中从同一最新 state 计算绩效与风险事实；
4. 深拷贝 policy versions、outcomes 和 events；
5. 同时写入完成状态、绩效快照、风险快照和完成时间。

重新打开复盘时同时清除绩效快照与风险快照。删除关联交易不会删除 override event；冻结摘要保留当时证据。

## 10. UI 与可访问性

### 10.1 风险卡

- 低于 60%：正常色；
- 60% 至低于 90%：橙色；
- 90% 至低于 100%：强化橙色；
- 达到 100%：红色；
- unknown：灰橙警示，不显示安全剩余额度；
- partial：保守数值加覆盖提示。

进度使用有名称的 `meter`/`progressbar` 或等价语义，并同时提供文字与数值。常驻卡不使用高频 `aria-live`。

隐私模式隐藏 capital、riskAmount、PnL 和金额换算，保留 budget R、限额、coverage 和进度。

### 10.2 对话框

- 准备弹窗复用 `ModalShell`；
- `TradeOpenRiskDialog` 是全局单层 Modal，不嵌套 Composer；
- 打开时焦点进入标题或原因输入；
- 错误说明通过 `aria-describedby` 关联；
- Esc 取消开仓请求；
- 关闭后优先恢复原始 opener；若命令面板、上下文菜单等临时触发器已卸载，则按 pending request 保存的语义目标恢复到对应交易行/卡片，其次回到命令入口按钮，最后回到主工作区容器；不得把焦点遗留在 `body`；
- 提交期间使用 `aria-busy` 并防止重复确认。

## 11. Schema v9、迁移与归档

### 11.1 字段合同

实现必须同时更新：

- Store 类型与初值；
- `PersistedSnapshot` 与 canonical snapshot；
- `PERSISTED_SNAPSHOT_FIELDS`；
- `pickPersisted`；
- bootstrap hydrate；
- `applySnapshotToStore`；
- 空库 reset；
- portable snapshot writer；
- JSON writer/reader；
- Web ZIP writer/reader；
- Electron ZIP writer/reader；
- snapshot validation 与完整非默认 fixture。

### 11.2 Electron v8→v9

打开 v8 Electron 库时：

1. 验证 v8 Manifest 与 Snapshot；
2. 在同库专用恢复目录复制原始 Snapshot 与 Manifest，校验内容和 checksum；
3. 原子写入并持久化 `v8-to-v9.migration` 标记，状态为 `prepared`，恢复副本与标记落盘后才允许替换正式文件；
4. 将 v8 Snapshot 规范化为严格 v9，在临时文件中完整编码并重读校验；
5. 先原子替换 Snapshot，更新并持久化标记为 `snapshot-replaced`；
6. 再原子替换 Manifest，Manifest 永远最后升级到 v9；
7. 从正式路径重开并验证 Snapshot 与 Manifest 均为 v9，再删除迁移标记和恢复目录；
8. 可捕获异常发生在验证完成前时，从恢复目录幂等恢复两个 v8 文件并重读确认。

应用启动必须在正常 Schema 解码前检查迁移标记。若标记存在：正式文件均为有效 v9 时完成清理；任一文件缺失、版本不一致或校验失败时，从已验证恢复副本幂等恢复两份 v8 文件。若没有标记但 Manifest/Snapshot 版本不一致，则拒绝猜测或补空，保留文件并进入明确的恢复错误流程。

保存 v9 Snapshot 时不得留下 v8 Manifest。测试除每个可捕获失败点外，还必须模拟进程在 Snapshot 替换前、Snapshot 替换后和 Manifest 替换后被强杀，再次启动均能得到“完整 v8”或“完整 v9”，不得出现混合版本。

### 11.3 Web 与 JSON

- IndexedDB 通过现有 revision CAS 提交 v9；
- 普通 JSON export version 升至 9，并在所有 reader/writer 中一致校验；
- `WEB_JOURNAL_EXPORT_VERSION` 在 ZIP 容器格式未变化时保持现值，ZIP Manifest 内的 `schemaVersion` 升至 9；两者不得再次混为同一个版本；
- v8 客户端不得把 v9 JSON 当作 v8 安全导入；
- Web/Electron 完整归档明确拒绝未知未来 Schema。

普通 JSON 不新增第二个版本字段；现有 `version` 直接从 8 升至 9。

### 11.4 合并导入

- `WeeklyRiskPreparation` 按稳定周 ID 合并，只有该可编辑草稿使用 `updatedAt` 较新者；
- 不可变 policy、monthly limit 和 override event 按 ID 合并；
- 相同 ID 且逐字段相等时去重；
- 相同 ID 但内容不同时拒绝该导入，不用 `updatedAt` 覆盖；
- 交易稳定身份由 `(id, ref, tradeKind, earliestCreateActivityId, earliestCreateActivityTimestamp)` 组成；只有全部存在且相等，才可自动判定为同一实体；旧数据缺少创建证据时，必须逐字段 canonical 相等才可视为相同，不得只因同 ID、同 kind 就覆盖或关联；
- 同 ID 但不能证明身份相同的导入交易生成稳定新 ID；ID 由导入 payload 内容摘要与原 trade ID 确定性派生，使同一文件重复导入得到同一映射，并在同一次纯转换中重写完整引用图；
- 引用图至少包含顶层 `RiskOverrideEvent.tradeId`、`WeeklyRiskReviewSnapshot.overrideEvents[*].tradeId`、周复盘保存的交易 ID 列表，以及 Schema 中其他所有 trade ID 字段；
- 重映射后必须重新生成受影响事件的 linkState 和身份摘要。任何引用无法完整重写时保留本地交易，并把相关导入 event 标记为 `unresolved`；不得链接到错误交易。

### 11.5 切库与恢复

增加 A→B→空库测试，逐项断言四个新字段：

- 正确切换或清零；
- 不跨库残留；
- 不被 finally flush 回写到目标库；
- 备份恢复后与源快照逐字段一致。

### 11.6 降级

v9 资料库、JSON 和归档不得由 v8 继续编辑。发布说明必须要求降级前保留最新 v9 归档；代码回滚不承诺自动转换 v9 为 v8。

## 12. 测试设计

### 12.1 纯逻辑

- trade R 与 budget R 不混用；
- trusted PnL 权威矩阵；
- complete/partial/unknown 状态矩阵；
- loss 的缺失、非法、未来 `closedAt` 均为 unknown；同类 win 只产生 partial 且不返还额度；
- 盈利返还额度与高点回撤反例；
- 多周 riskAmount 的月度聚合；
- 规则版本生效日与月限额锁定；
- 平仓业务日固化、修改交易日起始时间不追溯改写、明确修正 closedAt 才重算；
- 周一、月初和未来日期边界；
- 0.005 金额、循环小数、多 policy 分母、最小 1 美分和精确限额触线；
- 冲突、缺失、删除、模拟、案例和未平仓排除。

### 12.2 Gate 入口矩阵

- 列表状态操作；
- 看板拖拽；
- 详情页；
- 快捷键与命令操作；
- `planned/missed/terminal → open`；
- paper planned → live → open；
- 公开 `setStatus` 直接请求首次 open 必须 fail-closed；生产源码不得调用无检查 primitive；
- 批量复制只生成 planned；
- CSV、Notion、完整归档和备份恢复豁免交互 Gate；
- 已开仓交易再次 open 不重复事件。

### 12.3 竞态与故障

- 对话框打开后新增平仓结果；
- 规则版本、交易日、目标交易 kind/deletedAt/identity/open 历史变化；
- fingerprint 变化要求重新确认；
- Web CAS 冲突；
- Electron 提交失败；
- 持久化最终状态只能是“状态+事件都有”或“二者都无”；
- 失败后原因仍保留、busy/autosave 恢复，并覆盖“失败→重试成功”“失败→取消”；
- pending request 不被第二个请求覆盖；
- 首次 open 不进入通用 Undo/Redo 栈；风险变化后 redo 不得重放该转换；显式状态修正离开再回 open 保留既有审计事实。

### 12.4 UI 与复盘

- 未复核准备卡持续存在；
- triggered、unknown、partial 和隐私模式；
- 焦点、Esc、ARIA、重复提交和移动布局；
- 命令面板、上下文菜单等 opener 卸载后恢复到稳定 fallback，焦点不得落到 body；
- 周复盘完成时同 state 冻结；
- 完成后修改交易/规则、删除关联交易、重载和重新打开；
- unresolved event 明确展示。

### 12.5 持久化与兼容

- v8→v9 Web 与 Electron；
- 原生 v9 分别缺少四个顶层字段时必须拒绝，legacy v8 才补默认值；
- Electron Manifest/Snapshot 一致性、迁移标记、强杀重启与失败恢复；
- JSON v9、Web ZIP、Electron ZIP；
- A→B→空库切换；
- 合并导入覆盖同 kind 不同身份、缺失创建证据、同文件重复导入的稳定 ID、顶层事件、冻结事件及周复盘交易 ID 重映射；
- 备份恢复与降级拒绝；
- 完整 v9 fixture 在所有支持路径逐字段保真。

## 13. 成功标准

1. 风险卡只使用账户 budget R，不把交易 rMultiple 当作资金损失。
2. 盈利正确返还额度；任何无法量化或归期的已知亏损都进入 unknown，永不显示为安全。
3. 未复核准备卡持续提醒，上一有效规则不会因忘记复核而失效。
4. 周规则版本只向后生效，当前月限额不可改写。
5. 每笔实盘首次进入 open 均经过领域层统一 Gate，与来源状态和 UI 入口无关；计划创建和历史导入不误触发。
6. triggered/unknown 时必须逐笔填写原因。
7. 交易状态与确认事件在同一持久化事务中都有或都无。
8. 周复盘冻结同一时点的绩效与风险事实。
9. 原生 v9 数据严格校验，在 Web/Electron 保存、导入、导出、切库和备份恢复中保真；Electron 半迁移可在重启时确定恢复。
10. 第一版没有持仓风险、完整账本、多账户或规则引擎等范围膨胀。

## 14. 实施约束

- 先写失败测试，再修改领域逻辑和持久化路径。
- 优先扩展现有 TradeTruth、BusinessDateAnchor、快照合同和事务提交，不建立平行体系。
- 不顺带重构整个 Store、今日工作台或周复盘。
- 所有文件保持 UTF-8 无 BOM，并保留中文字符。
- 在本设计再次通过用户复核前，不创建实施计划或修改功能代码。
