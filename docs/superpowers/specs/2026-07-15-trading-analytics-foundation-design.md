# 交易分析可信度与长期进步系统设计

日期：2026-07-15  
状态：已梳理，待实施

## 1. 目标

把当前“交易日志 + 基础仪表盘”升级为可信的职业交易反馈底座。首轮不承诺自动给出职业交易结论，而是建立能够在 1,000 / 10,000 笔后可靠回答下列问题的数据与统计基础：

1. 当前净优势是否为正，证据有多强；
2. 优势和劣势分别出现在哪些可在交易前识别的条件中；
3. 亏损来自正常方差、策略问题、执行偏差还是成本；
4. 最近一次规则调整是否真的改善了表现；
5. 下一周期应该继续、停止或验证什么。

本设计先落地 P0“统计可信度”与 P1“最小职业统计层”。P2 优势探索器、P3 改进实验只预留接口，不在首轮扩张范围。

## 2. 已验证的当前状态

| 领域 | 当前实现 | 影响 |
|---|---|---|
| 样本范围 | 仪表盘默认实盘；策略统计默认实盘+模拟 | 同一策略在不同页面可能得到不同结论 |
| 删除数据 | 仪表盘排除回收站；部分策略统计未统一排除 | 软删除记录可能继续污染局部统计 |
| R 分布 | 桶从 `-3R` 开始 | `< -3R` 极端亏损完全漏出图表 |
| 周期缺失 | 复盘规范化时空值回退为 `4H` | 缺失数据会伪造成 4H 样本 |
| 结果一致性 | 金额和 R 同时填写时主要验证方向 | `+$100 / +100R` 仍可被视为有效组合 |
| 未填写语义 | 新建交易把 entry、size 初始化为 `0` | “未知”和真实零值混在一起 |
| 策略定义 | Trade 只保存 `strategyId`，无版本 | 规则修改前后的交易被混合统计 |
| 复盘过程 | 可一键完成复盘；错误标签按次数统计 | “已复盘”不等于产生洞察，错误成本不可见 |
| 图表性能 | 累计曲线为每笔交易渲染 SVG dot | 10,000 笔时可读性与交互性能下降 |

主要代码证据：

- `src/views/Dashboard.tsx:50-150`
- `src/lib/reviewAnalytics.ts:122-163`
- `src/lib/tradeTruth.ts:48-149`
- `src/data/trades.ts:65-109,181-229`
- `src/components/TradeComposer.tsx:251-278`
- `src/storage/snapshotValidation.ts:20-75`

## 3. 不改动的部分

- 保留现有交易、模拟、案例三类业务结构；
- 保留当前列表、看板、表格和详情页核心操作；
- 保留金额与 R 同时显示，不要求二选一；
- 保留“正常交易可一键完成复盘”的低打断体验；
- 保留当前本地优先、完整快照、附件分离与自动备份机制；
- 不在首轮引入外部行情服务、AI 诊断、复杂回测模型或新 npm 依赖。

## 4. 核心产品原则

### 4.1 未知不是零

- `null` / `undefined` 表示未记录；
- `0` 只表示真实保本或已确认的零费用；`entry` 与 `size` 不存在有效零值；
- 任何缺失字段都不能被默认业务值写入分析维度；
- 所有指标同时展示分子、分母或覆盖率。

### 4.2 结果与过程分开

盈利不自动代表正确，亏损不自动代表错误。交易复盘必须能落入四象限：

| 过程 | 结果 | 解释 |
|---|---|---|
| 遵守计划 | 盈利 | 可复制 |
| 遵守计划 | 亏损 | 正常方差 |
| 偏离计划 | 盈利 | 幸运结果，仍需修正 |
| 偏离计划 | 亏损 | 明确改进项 |

### 4.3 描述、证据、结论分层

- 描述：当前样本的均值和分布；
- 证据：样本数、覆盖率、置信区间、滚动稳定性；
- 结论：未知、候选、待前向验证、已有证据、可能衰减；
- 首轮只实现描述与基础证据，不生成自动“最佳策略”结论。

### 4.4 不增加日常填写负担

- 新建交易不新增必填字段；
- 平仓主流程仍只要求金额或 R 至少一个；
- 费用、初始风险、退出原因放入可选“结果细节”；
- 正常交易可一键标记“按计划”；只有异常交易才提示补充原因与下一步动作；
- MAE/MFE、精确行情状态等必须由未来导入或行情数据自动生成，不做手填。

## 5. 目标数据模型

### 5.1 Trade 的兼容扩展

```ts
export type RuleAdherence = 'followed' | 'deviated' | 'unknown'

export type MetricOrigin = 'manual' | 'calculated' | 'imported' | 'legacy'
export type PnlBasis = 'unknown' | 'net'
export type PnlCurrencySource = 'manual' | 'imported' | 'inferred' | 'legacy'

export type ExitReason =
  | 'target'
  | 'stop'
  | 'manual'
  | 'time'
  | 'rule'
  | 'other'

export interface TradeCosts {
  /** 所有成本均为非负数，单位与 pnlCurrency 相同；null 表示未知，0 表示确认未发生 */
  commission: number | null
  exchange: number | null
  financing: number | null
  tax: number | null
  other: number | null
  completeness: 'partial' | 'complete'
  source?: 'manual' | 'imported'
}

export interface Trade {
  // 现有字段保留
  entry: number | null
  size: number | null
  pnl: number | null              // 主展示盈亏；pnlBasis 说明是否已经确认净额
  rMultiple: number | null

  // 新增，全部可选
  grossPnl?: number | null        // 成本前盈亏
  pnlBasis?: PnlBasis             // 旧数据迁移为 unknown
  pnlCurrency?: string | null     // ISO 4217 大写三字符，如 USD
  pnlCurrencySource?: PnlCurrencySource | null
  costs?: TradeCosts
  /** 相对计划成交价的执行损耗；已反映在实际成交产生的 grossPnl 中，不重复扣减 */
  slippageCost?: number | null
  initialRiskAmount?: number | null
  initialRiskPct?: number | null
  accountEquityAtEntry?: number | null
  openedAtTimestamp?: string | null
  closedAtTimestamp?: string | null
  ruleAdherence?: RuleAdherence
  exitReason?: ExitReason
  strategyVersionId?: string | null // 兼容迁移阶段；v7 序列化时必须显式写版本 ID 或 null
  pnlSource?: MetricOrigin | null
  rSource?: MetricOrigin | null
  /** @deprecated 仅迁移旧记录时读取，新数据改用 pnlSource/rSource 与 ResultEvidence */
  resultSource?: TradeResultSource
}

export interface PersistedSnapshot {
  schemaVersion: 7
  /** 新导入/新精确时间的报表日期归属；IANA 名称。旧库迁移为 null，不猜设备时区 */
  reportingTimeZone: string | null
  strategyVersions: StrategyVersion[]
}
```

约束：

- `initialRiskAmount > 0`；
- `initialRiskPct > 0`，采用百分比点：`1` 表示 `1%`，不强制与权益同时存在；
- 同时存在初始风险金额、风险百分比与入场权益时，满足
  `initialRiskPct ≈ initialRiskAmount / accountEquityAtEntry * 100`，相对误差上限 1%；
- 成本与 `slippageCost` 字段不得为负数；
- `costs.completeness === 'complete'` 时所有成本项都必须序列化为有限数字，未发生项显式写 `0`；
- `costs.completeness === 'partial'` 时未知项写 `null`，不得用于完整的 gross → net 校验；
- 同时具有 `grossPnl` 与完整成本时：`pnl = grossPnl - totalExplicitCosts`；
- gross 只保存到 `grossPnl`；`pnl` 只保存未知 basis 的旧金额或已确认/派生的净额，不允许 `pnlBasis='gross'` 形成双重权威；
- `slippageCost` 不从 `grossPnl` 再扣一次，避免重复计算；
- R 始终对应成本后 PnL；只有 `pnlBasis === 'net'`，或可由 `grossPnl + 完整 costs` 推导净额时，才做金额/R 数值校验；
- 同时具有净 `pnl`、`rMultiple` 与 `initialRiskAmount` 时：
  `abs(rMultiple - pnl / initialRiskAmount) <= max(0.01, abs(rMultiple) * 0.01)`；basis 未知时只检查符号，不做数值冲突判定；
- `pnlBasis === 'net'` 或 `grossPnl + 完整 costs` 才可进入“净盈亏”；其他金额只能称“累计盈亏”；
- 金额聚合不做汇率换算：同一 scope 出现多个币种时禁止金额合计；推断币种可显示“累计盈亏（推断 USD）”，但不能升级为可信净盈亏；
- 旧数据缺少初始风险时仍可进入描述统计，但结果可信等级只能是 `confirmed`，不能升级为 `verified`。

### 5.2 结果可信等级

```ts
export type ResultEvidence =
  | 'missing'    // 无可用结果
  | 'conflict'   // 状态、金额、R 或风险关系冲突
  | 'confirmed'  // 用户确认或导入，但无法交叉验证
  | 'verified'   // 金额/R/初始风险或价格/冻结止损可交叉验证
```

结果检查返回可解释问题，而不是只返回 boolean：

```ts
export type ResultIssueCode =
  | 'missing-result'
  | 'status-sign-conflict'
  | 'pnl-r-sign-conflict'
  | 'pnl-r-value-conflict'
  | 'net-gross-cost-conflict'
  | 'invalid-risk'
  | 'invalid-cost'
```

统计规则：

- `missing` 不进入绩效指标，只进入覆盖率；
- `conflict` 不进入绩效指标，并显示待修复入口；
- `confirmed` 与 `verified` 都进入描述统计；
- 任何结论都必须可查看 `verified / usable / closed` 三个样本数；卡面只显示当前指标有效 `n / coverage`，完整分层放在 Tooltip 或质量抽屉。

### 5.3 策略版本

```ts
export interface StrategyVersion {
  id: string                    // 旧策略迁移为 `${strategyId}:v1`
  strategyId: string
  version: number
  label: string                 // 例如 v2 · 收紧纽约盘过滤
  rulesHtml?: string
  reviewTemplateHtml?: string
  changeNote?: string
  createdAt: string | null        // 旧 v1 无可靠创建时间，保持 null
  retiredAt?: string | null
}

// Strategy 的目标 v7 扩展
export interface Strategy {
  currentVersionId: string
  archivedAt?: string | null
}
```

- v7 `PersistedSnapshot` 必须包含 `strategyVersions: StrategyVersion[]`；
- 旧策略自动生成 v1；有 `strategyId` 的旧交易绑定所属策略 v1，无策略交易显式保存 `strategyVersionId = null`；
- v1 固定复制 `reviewTemplateHtml = strategy.reviewTemplateHtml ?? ''`，`rulesHtml = ''`；v7 后版本对象是模板权威来源，`Strategy.reviewTemplateHtml` 仅作为 deprecated 兼容镜像，写入时先更新当前版本再同步镜像，Task 9 完成后移除镜像写入口；
- 新建交易自动绑定当前版本；
- 修改名称、图标、颜色不创建版本；
- 只有用户明确点击“创建新版本”才冻结新规则；
- 历史交易不自动改绑。
- `currentVersionId` 必须属于当前策略；`Trade.strategyVersionId` 必须属于该交易的 `strategyId`；同一策略的 `version` 唯一。

### 5.4 标签分析边界

首轮不重构现有字符串标签：

- 位于 `tagPresets` / `mistakeTagPresets` 中的值视为长期可聚合标签；
- 其他导入或临时输入值继续仅属于当前记录；
- 分析器默认只展开预置标签；临时标签统一归入“临时标签”，需要用户显式展开；
- 标签稳定 ID、别名和重命名迁移属于 P2，不阻塞 P0/P1。

## 6. 统一分析样本层

新增 `src/lib/analyticsScope.ts`，禁止页面自行复制过滤逻辑。

```ts
export type AnalyticsTradeKind = 'live' | 'paper' | 'all'
export type AnalyticsRange = 'all' | 'this-month' | '30d' | '90d' | 'ytd'

export interface AnalyticsScope {
  tradeKind: AnalyticsTradeKind
  range: AnalyticsRange
  strategyId?: string
  strategyVersionId?: string
  symbol?: string
  side?: TradeSide
  timeframe?: string
  session?: string
  tag?: string
  mistakeTag?: string
  currency?: string
}

export interface AnalyticsUniverse {
  allClosed: Trade[]
  usable: Trade[]
  temporal: Trade[]
  conflicts: Trade[]
  missingResults: Trade[]
  missingClosedAt: Trade[]
}

export interface AnalyticsCandidates {
  included: Trade[]
  temporalCandidates: Trade[]
  missingClosedAt: Trade[]
  excludedCounts: Record<string, number>
}
```

`selectAnalyticsCandidates` 只负责静态范围；`selectAnalyticsUniverse` 再用 `tradeTruth` 将 candidates 分成 usable/conflicts/missing。这样 migration 与证据模型变更不会迫使页面重写范围逻辑。

固定规则：

1. 永久排除 `deletedAt`；
2. 永久排除案例记录；
3. 默认只看实盘；
4. 绩效日期只使用 `closedAtTimestamp ?? closedAt`，绝不回退到开仓时间；有限时间范围排除无平仓日期记录并归入 `missingClosedAt`；
5. “全部时间”的横截面指标可包含无平仓日期但结果可用的交易；趋势、回撤、连亏和滚动指标只能使用有平仓日期的 `temporal`；
6. 未平仓和错过机会不进入实盘绩效；
7. 仪表盘、策略页、策略详情必须复用同一个 universe；
8. 模拟与实盘不能静默合并，切换到“全部类型”时显示明确提醒；
9. 不同维度可组合筛选，但首轮每个维度只允许一个值，不支持同维度 OR / 多选。

## 7. 首轮指标合同

新增 `src/lib/tradeAnalytics.ts`，所有指标保持纯函数、无 React 依赖。

| 指标 | 明确定义 | 缺失时 |
|---|---|---|
| 累计/净盈亏 | usable 中有限 `pnl`，按下述金额聚合状态处理 | `—`，不是 `$0` |
| 总 R | usable 中有限 `rMultiple` 之和 | `—` |
| 期望 R | `sum(R) / rCount` | `—` |
| 中位 R | R 排序后的 50% 分位 | `—` |
| 胜率 | `wins / evaluatedCount`，保本计入分母 | `—` |
| 胜率区间 | 95% Wilson interval | `—` |
| 盈亏比 | `avg(positive R) / abs(avg(negative R))` | 无双侧样本时 `—` |
| Profit Factor | `sum(positive R) / abs(sum(negative R))` | 返回显式状态；无亏损且有盈利由 UI 显示 `∞ · 暂无亏损样本` |
| 交易序列最大回撤 R | 累计 R 峰值到后续谷值的最大差 | 无 R 显示 `—` |
| 最大连亏 | 连续 `loss` 笔数；保本中断连亏 | 无有效结果显示 `—` |
| 滚动期望 | 最近 20 / 50 / 100 个有效 R 的均值 | 样本不足不补零 |

金额聚合返回结构化状态，禁止用 `NaN`、JavaScript `Infinity` 或默认为零表达边界：

```ts
interface MoneyAggregate {
  value: number | null
  currency: string | null
  label: '累计盈亏' | '净盈亏'
  state: 'ok' | 'inferred-currency' | 'mixed-currency' | 'unknown-currency' | 'no-data'
}

interface ProfitFactorResult {
  value: number | null
  state: 'finite' | 'no-losses' | 'no-wins' | 'no-data'
}
```

币种按以下真值表处理：

| scope 内有金额记录 | 聚合状态 | 金额 |
|---|---|---|
| 同一币种，来源均为 manual / imported / 显式 legacy | `ok` | 可合计 |
| 同一币种，但至少一笔来源为 inferred | `inferred-currency` | 可显示推断合计，不可称可信净盈亏 |
| 出现两个及以上非空币种 | `mixed-currency` | `value = null`，显示“多币种，无法合计” |
| 任一金额记录币种为 null | `unknown-currency` | `value = null`，显示“币种未确认” |
| 无金额记录 | `no-data` | `value = null` |

明确 USD 与 inferred USD 同时出现属于 `inferred-currency`，不是 mixed；币种筛选后重新按筛选样本计算状态。
- 费用覆盖率分母只计算 `usable` 中有金额的交易，金额覆盖率另行计算；
- 只有这些金额交易全部为显式/可推导净额，且币种全部明确并一致时，标签才可称“净盈亏”。

明确不做：

- 没有每日账户权益序列前，不显示 Sharpe、Sortino、年化收益或账户最大回撤；
- 没有费用完整度前，不宣称“成本后优势已确认”；
- 没有策略版本前，不做跨版本自动优劣判断。

## 8. 仪表盘信息架构

首轮保持单路由 `/dashboard`，避免导航膨胀。信息架构预留四个页签，但未实现的页签不得提前渲染为空壳：

1. 概览：P0/P1 实现；
2. 优势：P2；
3. 执行：P2；
4. 风险：P2。

### 8.1 概览页

- 顶部：实盘 / 模拟 / 全部类型；时间范围；单维度筛选；指标定义入口；
- 第一行只保留四张主卡：累计/净盈亏、期望 R、胜率及区间、最大序列回撤 R；
- 第二行使用紧凑次级指标：总 R、Profit Factor、中位 R、最大连亏；
- 常驻数据质量条只显示可用结果覆盖率、R 覆盖率和当前最严重问题；金额、风险、费用、周期、时段等完整覆盖率放入抽屉；规则遵守字段未实施前不显示其覆盖率；
- 趋势面板：累计 R / 累计或净盈亏 / 滚动 20 笔期望切换；金额标题必须复用主卡的同一 label helper；
- 策略表现：总 R、期望 R、胜率区间、样本数；默认保持用户配置顺序，可手动按总 R、期望 R 或样本数排序，不以名义金额决定策略优劣；
- R 分布：增加 `< -3R` 与 `≥ 10R` 尾桶，点击尾桶下钻交易；
- 所有空值显示 `—`，真实零值显示 `0`；
- 卡面副文案只显示该指标的有效 `n / coverage`；`verified / usable / closed` 三层样本明细放入 Tooltip 与质量抽屉，避免卡面重新变重。

费用完整度不足、币种为推断或存在多币种时，第一张卡不得称“净盈亏”；仅在金额样本全部为显式/可推导净额且币种明确一致时显示“净盈亏”。

分析条件写入 URL，例如：

```text
/dashboard?kind=live&range=90d&strategyId=...&side=long&currency=USD
```

- 支持策略、品种、方向、周期、时段、普通标签、错误标签、币种各一个值；不同维度可以同时组合；
- 首轮不做任意布尔组合或同维度多选；
- “全部”必须清空当前分析条件，不继承交易日志上次筛选；
- 刷新、前进、后退后必须复原相同分析范围；
- 筛选后无数据时保留条件并提供“清除筛选”，不显示“新建交易”误导入口。

### 8.2 数据质量下钻

点击覆盖率可进入交易日志并应用现有筛选状态：

- 待补结果；
- 结果冲突；
- 缺少 R；
- 缺少金额；
- 缺少初始风险；
- 缺少周期 / 时段；
- 费用未确认。

下钻必须保留当前 Dashboard scope，例如：

```text
/list?kind=live&range=90d&strategyId=...&dataIssue=missing-r
```

问题分三级：结果冲突/非法风险为阻塞修复；缺费用/风险/时段为非阻塞覆盖提示；推断币种为信息提示。默认只突出阻塞问题，不把所有旧记录渲染成红色。不新增第二套交易表格。

每项使用自己的合法分母：结果覆盖率以 scope 内 closed 为分母；R 覆盖率以 usable 为分母；金额覆盖率以 usable 为分母；费用和币种覆盖率以 usable 且有金额的交易为分母。`missingClosedAt` 在有限区间不计算百分比，而显示“全库 X 笔无法归属时间范围”；该项下钻保留 kind/strategy 等非时间条件但移除 range，其余下钻保留完整 scope。Dashboard 与列表统一使用 `range` 参数，由共享 helper 映射为日期边界；跳转后的列表数量必须与抽屉 count 一致。

## 9. 输入流程

### 9.1 新建交易

- 不新增必填字段；
- `entry`、`size` 未填写时保存为 `null`；
- timeframe 默认是“未设置”；只有用户明确选择 4H（或明确应用某个策略默认值）时才保存 4H；
- 绑定当前 `strategyVersionId`；
- 有精确导入时间时保存 timestamp，手动新建仍可只保存日期。

### 9.2 平仓

- 手动结果模式中金额与 R 并排同时可见；
- 仍允许只填一个；
- 存在初始风险时，另一个值自动计算并显示来源；
- 价格模式显示出场价与派生 R，金额未提供时明确显示“未记录”，不强迫用户填写无意义金额；
- 用户同时填写金额与 R 且已知净额基础时，不一致则阻止保存并给出预期值；基础未知时只检查方向；
- 可选“结果细节”：费用、初始风险、退出原因；默认折叠；
- 保本必须显式选择，避免把空值解释为 0。

### 9.3 轻复盘

- “按计划并完成”和“暂不判断并完成”均为一步操作；
- “有偏差”才展开错误标签和下一次行动；
- 下一次行动是可选短文本，不恢复强制长文；
- 复盘完成率与规则遵守率分开统计。

## 10. 迁移与兼容

迁移框架与正式升版分开交付：先建立 raw load、版本识别、纯迁移器和恢复点，但继续写 v6；只有目标字段转换、策略 v1 绑定和语义诊断全部就绪后，才在同一发布中把 `SCHEMA_VERSION` 从 6 一次性升为 7。不存在“部分 v7”。

```ts
interface MigrationContext {
  source: 'library' | 'json' | 'journal-zip' | 'backup'
  manifestSchemaVersion?: number
  exportVersion?: number
}

migrateSnapshot(
  raw: unknown,
  context: MigrationContext,
  targetVersion: number = SCHEMA_VERSION,
): unknown

migrateSnapshotToCurrent(raw: unknown, context: MigrationContext): PersistedSnapshot
```

正常加载永远调用 `migrateSnapshotToCurrent`，只迁移到活动 `SCHEMA_VERSION`；Task 3 可直接测试未注册的 `migrateV6ToV7` 纯函数，但只有 Task 4 注册该 step 并把活动版本切到 7。Task 2 的正式运行路径因此只会得到 v6。

- v7 `PersistedSnapshot` 自身必须包含 `schemaVersion: 7`，不再只依赖库目录 manifest；来源版本按“快照自身 schemaVersion → manifestSchemaVersion → 已知导出格式映射”识别，冲突或未来版本一律拒绝静默覆盖；
- v6 → v7：所有 `entry === 0`、`size === 0` 转为 `null`；`pnl/r === 0` 仅在状态明确为保本时保留，否则转为缺失并进入质量队列；
- 空 timeframe 保持 `undefined`，不再补 `4H`；已有明确 `4H` 不改变；
- v7 新增快照级 `reportingTimeZone: string | null`。旧库迁移为 null：已有独立日期键时原样保留；旧字段本身含 ISO 时间时，原串保存到 timestamp，日期键取原字符串 `YYYY-MM-DD` 前缀，不按当前设备时区换算。只有 v7 后明确设置 IANA 时区的新导入才按该时区生成日期键；
- 每个策略生成确定性的 `${strategyId}:v1`，`createdAt = null`，并设置 `currentVersionId`；有策略的旧交易绑定所属策略 v1，无策略交易显式写 null。首轮只完成数据绑定，版本管理 UI 后置；
- 旧 `pnl` 原值保留且 `pnlBasis = 'unknown'`。旧记录显式带币种时保留并设 `pnlCurrencySource='legacy'`；无币种但来自当前固定美元旧格式时写 `pnlCurrency='USD'`、source=`inferred`；来源无法证明美元时币种和 source 均为 null。推断值不得升级为已确认币种或净盈亏；
- 不伪造费用、初始风险、精确时间、策略创建时间或规则遵守数据；
- 加载顺序固定为“raw load → 最低结构检查 → 识别来源版本 → 逐版本纯迁移 → v7 严格结构校验 → 单笔结果语义诊断 → hydrate → 事务/恢复协议提交”；
- 结构损坏仍拒绝加载；单笔结果语义冲突不得阻止整库打开，而是隔离到数据质量队列；
- 导入旧 `.journal.zip` / JSON 时先迁移再校验；导出保持向后说明但不保证旧客户端读取 v7；
- Electron 升级前创建独立 `pre-v7` 恢复点，验证可读后才迁移；该恢复点不参与最多 7 份自动备份轮转，用户确认稳定后才清理；
- 迁移提交前持久化 upgrade journal：`targetVersion: 7`、`phase: 'pending-v7' | 'committed-v7'`、`sourceChecksumSha256`、`rollbackLocation`。启动发现 pending 时重新严格校验并试 hydrate 活动库；通过则补齐 manifest/meta 并标记 committed，失败则从记录位置恢复 v6；
- Electron 在临时 DB 副本上完成迁移、校验与落盘，再记录 pending 并替换活动 DB；manifest 版本错位时执行上述 journal 状态机，而不是要求两个文件字节级原子写；
- IndexedDB 在同一 transaction 中写入 v7 snapshot、meta、pending 状态，并在专用 rollback key 保留验证过的 v6 raw snapshot；下一次 hydrate 成功后再标记 committed；
- 任一步失败的验收是“自动恢复原资料库且重启可读、交易与附件引用不变”，不是无法保证的跨文件字节完全不变。

## 11. 10,000 笔性能边界

- 指标计算保持 O(n) 或 O(n log n)，禁止循环内数组扩展复制；
- 基准固定使用 production build、同一台参考机；每组 5 次预热、30 次计时，冷启动与 warm 计算分开报告；
- 10,000 笔 fixture 的同步完整概览计算 warm p95 < 40ms，避免产生 50ms 主线程长任务；
- 10,000 笔 scope 切换至下一帧可交互 p95 < 180ms；不含附件的 cold hydrate p95 < 1.5s，warm hydrate p95 < 600ms，完整快照保存 p95 < 1.2s；
- 若 Task 0 实测基线已优于上述预算，后续不得回退超过 10%；若当前架构无法达到，发布前记录设备与瓶颈并单独评审，不静默放宽；
- Recharts 显示点不超过 `min(600, chartWidth)`，计算仍使用全量；
- 降采样必须保留首尾、局部极值和全局最大回撤点；
- 默认不渲染每个点的 dot，仅 active dot；
- 分析结果用 `useMemo`，依赖限定为 trades、strategies、scope；
- 首轮优先保持同步纯函数；10,000 笔仍超过 40ms 时，在 Preview B 发布门前评估 Web Worker。不得在性能收口任务中顺手改为增量持久化；存储架构变化必须单独评审。

## 12. 验收标准

1. 同一 scope 下，仪表盘、策略列表和策略详情的 closed/evaluated/win/R/PnL 完全一致；
2. 回收站、案例、未平仓记录不会进入绩效；
3. `< -3R` 交易必定进入尾桶并可下钻；
4. 未填写 timeframe 不会显示或统计为 4H；
5. 未填写 entry/size 保存为 null，真实保本结果仍保存为 0；
6. 金额、R、初始风险不一致时不能保存为 verified；
7. 所有指标区分无数据与真实 0；
8. 胜率展示 n 与 95% Wilson 区间；
9. 数据质量条能定位具体待修复交易；
10. 10,000 笔完整指标计算和图表点数达到性能边界；
11. v6 库迁移前后交易数量、附件引用、策略关联不丢失；
12. 新建、平仓与正常复盘的必填步骤不比当前更多；
13. 多币种不会产生虚假的金额总计，推断币种不会显示为已确认净盈亏；
14. Windows 125% / 150% 缩放、浏览器 100% / 125%、1366 宽、2K、4K 与中文长标签下无截断或布局跳动；
15. UTC+8、UTC-8 与 DST 边界下，同一平仓事实不会因 Windows/Mac 设备时区不同落入不同日期范围；
16. v7 迁移失败可自动恢复验证过的 v6 恢复点，重启后仍可读取。

## 13. 明确不在首轮处理

- 多账户权益、出入金和组合级时间加权收益；
- 自动 MAE/MFE；
- 自动行情 regime / 新闻状态富化；
- 多维 Edge Explorer；
- 多重检验、Deflated Sharpe、区块 Bootstrap；
- AI 复盘摘要与行为诊断；
- 实验前后对照与自动结论；
- 标签实体化和历史别名迁移。

这些能力依赖本设计提供的可信样本、版本和指标底座，不能倒序建设。
