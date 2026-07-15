# 交易分析可信度与长期进步系统 Implementation Plan

> 本计划只覆盖 P0“统计可信”与 P1“最小职业统计层”。完成每个预览波次后用真实资料库验证，再决定是否继续。禁止在执行中顺手加入 AI 诊断、行情模型或新的强制填写项。

**Goal:** 统一全产品统计口径，修复会让大样本产生错误结论的数据语义，建立可复用的职业交易指标引擎，并以低打断方式接入仪表盘、平仓和复盘。

**Architecture:** 原始 Trade 事实先经过 v7 迁移和结果诊断，再进入唯一的 `analyticsScope` 样本层；所有页面只消费纯函数 `tradeAnalytics` 的派生结果。UI 不自行过滤或计算指标。图表显示数据可降采样，指标永远使用完整样本。

**Tech Stack:** React 18、TypeScript、Zustand、Recharts、现有 Electron / IndexedDB 双存储、Node 导出函数测试、Playwright 浏览器回归。首轮不新增 npm 依赖。

**Spec:** `docs/superpowers/specs/2026-07-15-trading-analytics-foundation-design.md`

---

## Global Constraints

- 所有文件 UTF-8 无 BOM，保留中文；
- 每个任务独立提交，禁止一次性混合数据迁移、UI 重排和性能重构；
- 先写失败测试，再改实现；
- `null` 表示未知，`0` 只表示真实零值；
- 迁移不得伪造费用、时间、风险、周期、策略创建日期；
- 业务结果冲突只隔离单笔交易，不得阻止整个资料库打开；
- 新建交易不增加必填字段；
- 手动结果模式的金额与 R 始终并排可见；价格模式显示出场价和派生 R，未记录金额时明确显示“未记录”；
- 每个预览波次完成后执行 `pnpm typecheck && pnpm test && pnpm build`；
- 真实资料库迁移前必须生成并验证恢复点。

## Dependency Graph

```text
Task 0 基准与 fixture
  ↓
Task 1 统一静态样本范围与现有口径修复
  ↓
Task 2 迁移框架与恢复协议（仍写 v6）
  ↓
Task 3 纯 v6 → v7 转换器（不接入运行时）
  ↓
Task 4 金额、R、风险、费用证据 + 策略 v1 绑定 + 一次性提交 v7
  ↓
Preview A：真实数据验证 1 周
  ↓
Task 5 职业指标引擎
  ├──→ Task 6 仪表盘总览与 URL 条件
  └──→ Task 7 数据质量下钻
              ↓
Task 10 10k 性能收口（仅基准失败时）
              ↓
Preview B：真实数据验证 2–4 周
  ↓
Task 8 轻复盘执行字段
Task 9 策略版本管理 UI
```

Task 8 与 Task 9 可分别开发；Task 9 只开放 v7 已具备的版本管理能力，不再次改变存储结构。两者都触及详情/策略配置 UI，仍应串行合并。

## 交付波次与停止线

| 波次 | 预计工程量 | 必须交付 | 继续条件 | 停止/回退条件 |
|---|---:|---|---|---|
| Preview A | 15–21 工程日 + 1 周真实使用 | 唯一样本范围、完整 v7、结果证据、可验证恢复 | 迁移零丢失；日常录入未增加必填；统计差异均可解释 | 恢复失败、旧库打不开、平仓误阻断或关键字段丢失，立即恢复 v6，不进入 Preview B |
| Preview B | 10–16 工程日 + 2–4 周真实使用 | 指标引擎、克制总览、质量下钻、10k 门槛 | 真实 200+ 笔使用稳定；KPI 口径可追溯；性能达标 | 数据质量 UI 形成噪音、同 scope 仍不一致或任一基准不达标，不发布 Preview B，也不继续优势探索器 |
| 第二阶段 | 每项单独批准 | 轻复盘、版本管理 UI | 用户在预览期确认确有决策价值 | 不因“规划中”自动实施，不扩张到 AI/行情/高级模型 |

每个波次结束都先停下评审；没有满足继续条件时，不用新增功能掩盖基础问题。

## File Responsibility Map

| 文件 | 责任 |
|---|---|
| `src/storage/upgrade.ts` | 原始快照最低检查、逐版本迁移、迁移结果 |
| `src/storage/snapshotValidation.ts` | 当前版本结构校验，不承载业务结果判断 |
| `src/lib/analyticsScope.ts` | 唯一统计样本范围与排除原因 |
| `src/lib/tradeTruth.ts` | 单笔结果证据、问题码、可用性判断 |
| `src/lib/tradeAnalytics.ts` | 指标、覆盖率、策略聚合、R 分桶 |
| `src/lib/analyticsSeries.ts` | 累计序列、回撤、连亏、滚动窗口、图表降采样 |
| `src/views/Dashboard.tsx` | 只负责查询参数、编排与下钻，不写指标公式 |
| `src/views/dashboard/*` | 范围栏、指标卡、质量摘要、趋势和策略表 |
| `src/components/TradeCloseDialog.tsx` | 金额/R 主流程和可选结果细节 |
| `src/views/DetailView.tsx` | 轻复盘执行标记与问题修复入口 |
| `scripts/benchmark-analytics.mjs` | 1k/10k 可重复性能报告 |

---

## Preview A：先解决“结论是否可信”

### Task 0: 固定样本与性能基线

**Effort:** 1 天

**Files:**

- Create: `scripts/fixtures/analytics-trades.mjs`
- Create: `scripts/benchmark-analytics.mjs`
- Create: `scripts/qa-dashboard-10k.mjs`
- Modify: `package.json`

**Steps:**

- [ ] 用固定 seed 生成 1k / 10k 两类 fixture：短笔记、每笔约 2KB 笔记；图片仍为附件引用。
- [ ] fixture 必须覆盖 live / paper / case / missed / deleted、null、保本、结果冲突、`<-3R`、`>10R`。
- [ ] 使用 production build，在固定参考机记录当前 buildStats 计算、cold/warm hydrate、仪表盘进入、范围切换、完整快照保存和内存增量的 median / p95。
- [ ] 每组固定 5 次预热和 30 次计时；输出 JSON 报告，包含版本、机器、缩放、样本数、字节数、计时边界与原始数据；不连接真实资料库。
- [ ] 增加 `pnpm benchmark:analytics` 和 `pnpm qa:dashboard-10k`。

**Verify:**

- 同一机器连续两次运行，结果数量和校验和完全一致；
- 性能波动允许存在，但报告格式固定；
- 记录并冻结 Preview B 的绝对预算与“不回退超过 10%”预算，后续门槛不得凭感觉修改；
- 脚本结束后工作区不残留临时资料库。

**Commit:** `test(analytics): add deterministic 10k baseline`

---

### Task 1: 统一静态样本范围并修复现有口径

**Effort:** 1–2 天

**Files:**

- Create: `src/lib/analyticsScope.ts`
- Create: `src/lib/analyticsScope.test.ts`
- Modify: `scripts/run-regression-tests.mjs`
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/lib/reviewAnalytics.ts`
- Modify: `src/lib/strategies.ts`
- Modify: `src/components/StrategyHeader.tsx`
- Modify: `src/views/settings/StrategiesPanel.tsx`

**Contract:**

```ts
export function selectAnalyticsCandidates(
  trades: readonly Trade[],
  scope: AnalyticsScope,
): AnalyticsCandidates
```

本任务只返回 `included / temporalCandidates / missingClosedAt / excludedCounts`，统一不依赖新结果证据模型的交易类型、删除、案例、状态、日期和 URL 条件。`selectAnalyticsUniverse` 及 `usable / conflicts / missingResults` 的最终证据分区在 Task 4 完成，禁止 Task 1 复制一套临时判断器。

**Steps:**

- [ ] 先增加同一 fixture 在仪表盘、策略统计、策略头部得到不同结果的失败测试。
- [ ] 固定排除回收站、案例、错过机会和未平仓；默认仅实盘。
- [ ] 有限时间范围只使用 `closedAtTimestamp ?? closedAt`；无平仓日期交易排除并计入 `missingClosedAt`，不得回退到 `openedAt`。
- [ ] “全部时间”的横截面可保留无平仓日期但有结果的记录；任何趋势、回撤、连亏或滚动序列都排除这些记录。
- [ ] 策略统计不再把 `null` 胜率/均 R 转为 0。
- [ ] 策略分组改为 Map 内 `push`，移除循环中的数组展开复制。
- [ ] 提取可复用纯函数修复 R 分桶，保证 `<-3R`、`0R`、`>=10R` 均有独立桶；Task 5 直接扩展，不重复实现。
- [ ] 现阶段卡片“净盈亏”改为“累计盈亏”，直到费用口径落地。

**Acceptance:**

1. 同一 scope 在三个入口得到完全相同的静态 included/excluded 集合和当前 closed/evaluated/win/pnl/r 数；
2. 每笔有效 R 恰好进入一个桶，分桶总数等于有效 R 数；
3. 空样本返回 null，UI 显示 `—`；
4. all 模式明确显示“实盘 + 模拟”，不静默混算；
5. finite range 的无平仓日期记录不会被错误放入开仓日期所在区间。

**Commit:** `fix(analytics): unify performance sample scope`

---

### Task 2: 建立迁移框架与可验证恢复协议（暂不升 v7）

**Effort:** 4–6 天，拆为“纯迁移器与校验”2 天、“双适配器与恢复协议”2 天、“导入/备份/E2E”1–2 天

**Files:**

- Create: `src/storage/upgrade.ts`
- Create: `src/storage/upgrade.test.ts`
- Modify: `src/storage/types.ts`
- Modify: `src/storage/snapshotValidation.ts`
- Modify: `src/storage/bootstrap.ts`
- Modify: `src/storage/persist.ts`
- Modify: `src/storage/migrate.ts`
- Modify: `src/storage/indexedDbAdapter.ts`
- Modify: `src/storage/electronAdapter.ts`
- Modify: `src/storage/adapter.ts`
- Modify: `electron/library/storage.ts`
- Modify: `electron/library/libraryActivation.ts`
- Modify: `electron/library/journalZip.ts`
- Modify: `electron/library/backup.ts`
- Modify: `electron/library/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/qa.ts`
- Modify: `src/types/journal-bridge.d.ts`
- Modify: `src/lib/importExport.ts`
- Modify: `scripts/run-regression-tests.mjs`

**Target API:**

```ts
export interface SnapshotMigrationResult<TSnapshot = unknown> {
  snapshot: TSnapshot
  fromVersion: number
  toVersion: number
  didChange: boolean
}

export interface MigrationContext {
  source: 'library' | 'json' | 'journal-zip' | 'backup'
  manifestSchemaVersion?: number
  exportVersion?: number
}

export function migrateSnapshot(
  raw: unknown,
  context: MigrationContext,
  targetVersion?: number, // 默认 SCHEMA_VERSION
): SnapshotMigrationResult

export function migrateSnapshotToCurrent(
  raw: unknown,
  context: MigrationContext,
): SnapshotMigrationResult<PersistedSnapshot>
```

存储接口新增只供升级入口使用的 `loadRawSnapshot(): Promise<unknown | null>`；现有 `loadSnapshot()` 继续只返回已经迁移并通过当前结构校验的 `PersistedSnapshot`。bootstrap、候选库激活、JSON/zip/备份恢复必须先走 raw → migration，普通业务读取不得绕过校验。

**Steps:**

- [ ] 建立来源版本识别：快照内嵌版本优先，其次 manifest，再次为已知导出格式映射；来源冲突和未来版本显式拒绝。
- [ ] 建立可注册的逐版本纯迁移链、来源版本识别和当前 v6 validator；`SCHEMA_VERSION` 保持 6。本任务不实现、不识别、不保存 v7，避免生成“半完成 v7”。
- [ ] 正式运行路径只调用 `migrateSnapshotToCurrent`，因此只执行 v6 identity/current migration；任意非当前目标只允许显式调用 `migrateSnapshot(..., targetVersion)`，且没有注册 step 时必须失败。
- [ ] 加载顺序改为：raw load → 最低结构检查 → 版本识别 → 纯迁移 → 当前结构校验；结果诊断由 Task 4 接入。
- [ ] Electron/IndexedDB 实现 `loadRawSnapshot`；`loadSnapshot` 仅用于当前版本已验证数据。
- [ ] 结构校验只拒绝损坏结构、非有限数字、非法枚举和断裂引用；不再因一笔业务结果冲突拒绝整库。
- [ ] Electron、IndexedDB、JSON、journal.zip、备份恢复共用同一迁移器。
- [ ] Electron 新增不参与 7 份自动轮转的 `pre-v7` 恢复点；创建、读取和校验任一步失败都阻止升级。
- [ ] 增加 upgrade journal：targetVersion、`phase: pending-v7 | committed-v7`、sourceChecksumSha256、rollbackLocation；启动发现 pending 时严格校验并试 hydrate 活动库，成功补齐 manifest/meta 与 committed，失败恢复 v6。
- [ ] Electron 在临时 DB 副本迁移、校验和落盘后写 pending，再切换活动 DB；manifest 错位时走 journal 恢复，不声称跨文件字节级原子性。
- [ ] IndexedDB 在同一 `snapshot + meta + pending` transaction 中提交，并在专用 rollback key 保留验证过的 v6 raw snapshot；下次 hydrate 成功后再标记 committed。
- [ ] 迁移函数必须纯函数、确定性、幂等；禁止迁移中使用 `Date.now()` 或随机 ID。

**Acceptance:**

1. v6 fixture 在 Electron 和 IndexedDB 路径均为确定性 identity load/save，不改变版本或数据；
2. 使用隔离的迁移链测试夹具验证逐版本、幂等、未来版本拒绝和来源冲突，不把测试目标版本写入生产常量；
3. 任意一步失败时自动恢复原资料库且重启可读，交易与附件引用不变；
4. manifest、快照内嵌版本或导出格式冲突时不覆盖现有库；
5. 当前客户端拒绝未来版本并保留现有提示；
6. `pre-v7` 恢复点在一周高频自动备份后仍存在，用户确认稳定前不会被轮转删除；
7. 注入“替换 DB 前/后、manifest 前/后、IDB transaction 后/hydrate 前”崩溃，下一次启动均能确定地继续提交或恢复，不进入循环。

**Commit:** `feat(storage): add versioned migrations and verified recovery`

---

### Task 3: 完成纯 v6 → v7 转换器（不接入运行时）

**Effort:** 2–3 天

**Files:**

- Create: `src/storage/schemaV7.ts`
- Create: `src/storage/migrations/v6ToV7.ts`
- Create: `src/storage/migrations/v6ToV7.test.ts`
- Modify: `scripts/run-regression-tests.mjs`

**Steps:**

- [ ] 目标 v7 schema 覆盖 nullable entry/size、timestamp、reportingTimeZone、PnL basis/currency、风险、成本和策略版本，但不修改当前 `Trade` / `PersistedSnapshot` 运行时类型。
- [ ] 转换所有 entry/size 的 0 为 null；pnl/r 的 0 只有明确 breakeven 才保留，其余转缺失并产生迁移诊断。
- [ ] 空 timeframe 保持未知，已有 4H 不改变。
- [ ] 旧库 `reportingTimeZone=null`；已有日期键原样保留，ISO 原串写 timestamp，日期前缀不按设备时区重算。
- [ ] 旧 PnL 保留原值且 basis unknown；显式旧币种保留为 legacy，无币种的固定美元旧格式推断 USD，无法证明时保持 null。
- [ ] 每个策略生成确定性 v1：复制现有 reviewTemplateHtml、rulesHtml 置空、createdAt=null；有策略交易绑定 v1，无策略交易版本为 null。
- [ ] 直接测试 `migrateV6ToV7` 和 v7 draft validator；不把 step 注册进正式 migration registry，不改变 `SCHEMA_VERSION=6`，不让普通加载拿到 v7。

**Acceptance:**

1. 同一 v6 fixture 两次转换的 v7 JSON 与诊断完全一致；
2. `pnl=0/r=0/status=breakeven` 原样保留，entry/size 0 均为 null；
3. 缺失 timeframe 保持未知，已有 4H 原样保留；
4. 旧日期/ISO、币种四种状态、策略模板与无策略交易均有边界测试；
5. 当前应用仍只读取、写入 v6；本提交可独立回滚，不产生用户数据变化。

**Commit:** `feat(storage): define deterministic v7 trade migration`

---

### Task 4: 完成结果证据、策略 v1 绑定并一次性提交完整 v7

**Effort:** 7–9 天，拆为“nullable 消费者/导入链路”2 天、“证据纯函数”1–2 天、“平仓输入 UI”1–2 天、“策略兼容与正式升版”2–3 天

**Files:**

- Modify: `src/data/trades.ts`
- Modify: `src/data/strategies.ts`
- Modify: `src/components/TradeComposer.tsx`
- Modify: `src/lib/tradeTruth.ts`
- Modify: `src/lib/tradeTruth.test.ts`
- Create: `src/lib/moneyAggregate.ts`
- Create: `src/lib/moneyAggregate.test.ts`
- Modify: `src/lib/tradeClose.ts`
- Modify: `src/lib/tradeClose.test.ts`
- Modify: `src/lib/tradeResult.ts`
- Modify: `src/lib/tradeCalc.ts`
- Modify: `src/lib/reviewAnalytics.ts`
- Modify: `src/lib/tradeKind.ts`
- Modify: `src/lib/csvImport.ts`
- Modify: `src/lib/notionImport.ts`
- Modify: `src/lib/importExport.ts`
- Modify: `src/components/TradeCloseDialog.tsx`
- Modify: `src/components/TradeCloseDialog.browser.test.tsx`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/store/useStore.ts`
- Modify: strategy types and persistence helpers
- Modify: `src/storage/types.ts`
- Modify: `src/storage/upgrade.ts`
- Modify: `src/storage/persist.ts`
- Modify: `src/storage/snapshotValidation.ts`
- Modify: `electron/library/backup.ts`
- Modify: import/export and validation tests

**Steps:**

- [ ] 把 runtime `entry/size` 改为 nullable，所有计算/导入/导出/详情消费者显式处理 null；Composer 未填时写 null。
- [ ] timeframe 默认“未设置”，不再通过 `resolveTimeframe` 静默补 4H；精确 timestamp 与日期键遵循 v7 时区规则。
- [ ] 添加 `initialRiskAmount`、`initialRiskPct`、`accountEquityAtEntry`、`grossPnl`、`pnlBasis`、`pnlCurrency`、`pnlCurrencySource`、`costs`、`slippageCost`、`pnlSource`、`rSource`。
- [ ] `initialRiskPct` 使用百分比点，`1 = 1%`；三项风险信息同时存在时校验金额/权益/百分比关系。
- [ ] complete costs 必须把所有项序列化为有限非负数字，未发生写 0；partial 的未知项写 null，不能用于 gross → net 完整验证。
- [ ] 用 `TradeResultValidation` 返回 evidence 和问题码，替代单一业务 boolean。
- [ ] 历史 resultSource 只迁移为 origin，不再把手填金额+R 冒充 imported。
- [ ] R 始终对应净 PnL：basis 已知净额时做数值校验，basis 未知时只校验符号，不能产生虚假的 `pnl-r-value-conflict`。
- [ ] 手动结果模式金额/R 并排，仍允许只填一个；价格模式显示出场价和派生 R，金额缺失显示“未记录”。
- [ ] 比率容差：`max(0.01R, abs(calculatedR) * 1%)`；金额容差：`max(0.01, abs(expectedNet) * 0.0001)`。
- [ ] 同时填写但不一致时阻止保存，并提示“按初始风险应为 X R”。
- [ ] “结果细节”默认折叠；费用和风险缺失只降低覆盖率，不阻断平仓。
- [ ] 旧金额没有 basis 时称“累计盈亏”；明确 net 后才称“净盈亏”。
- [ ] 旧金额保留原值并设 `pnlBasis='unknown'`；显式旧币种 source=legacy，固定美元旧格式 source=inferred，无法推断则币种为 null；多个币种/未知币种禁止合计。
- [ ] 将 Task 3 的币种真值表实现为最小 `aggregateMoney` 并替换当前 Dashboard/策略累计金额；Preview A 即禁止混合币种相加，Task 5 再扩展职业指标。
- [ ] 为每个策略生成确定性 v1（`createdAt=null`），复制现有 reviewTemplateHtml、设置 `currentVersionId` 并绑定所有旧交易；版本对象为模板权威来源，Strategy 字段仅作兼容镜像，不开放管理 UI。
- [ ] 接入最终 `AnalyticsUniverse` 证据分区：`usable / temporal / conflicts / missingResults / missingClosedAt`。
- [ ] 注册 Task 3 的 v6→v7 step；所有目标字段、引用校验、结果诊断和恢复状态机通过后，才将 `PersistedSnapshot.schemaVersion` 与 `SCHEMA_VERSION` 一次性升为 7；不存在中间 v7。

**Acceptance:**

1. 金额与 R 同时保存和显示能力不回归；
2. `+$100 / +100R / risk $100` 在 PnL 已知为 net 时被识别为数值冲突；basis unknown 时只检查方向；
3. 只有方向一致但无风险的旧数据为 confirmed，不是 verified，旧金额只称累计盈亏；
4. gross + 完整显式费用可确定 net；slippage 不重复扣减；
5. 混合币种返回不可合计状态，单一推断币种明确标注推断；
6. 所有策略、有策略的旧交易都有有效版本引用；无策略交易显式为 null；旧 v1 不伪造创建时间且模板内容不丢失；
7. 冲突记录不进入 KPI，并可在交易详情看到具体问题原因；Preview B 的质量抽屉不是本任务依赖；
8. v6 → v7 在 Electron/IndexedDB、JSON/zip、备份恢复路径可重复、幂等，失败自动恢复 v6 并可重启读取；
9. 未填 entry/size round-trip 仍为 null，未知 timeframe 不显示为 4H，日期/ISO fixture 不因设备时区变化。

**Commit:** `feat(results): make cash R and risk evidence explicit`

---

## Preview A 发布门槛

- `pnpm typecheck`、`pnpm test`、`pnpm build` 全通过；
- 用复制的真实资料库完成 v6 → v7 升级、重启、再次保存、导出和恢复；
- 对比升级前后交易数、策略数、附件引用、R/PnL 非空数；
- 验证每个策略 currentVersionId、每笔旧交易 strategyVersionId 及 v1 归属；
- 手工验证新建、平仓、结果冲突、保本、无周期五条路径；
- 验证 `pre-v7` 恢复点不参与 7 份自动轮转，迁移失败后可恢复并重启；
- 发布 preview，不合并 main；
- 实际使用 1 周，记录：待修复数据数量、平仓耗时、是否出现错误阻断、统计差异是否可解释。

---

## Preview B：建立“可以做决策”的最小统计层

### Task 5: 纯函数职业指标引擎

**Effort:** 4–5 天，拆为“横截面指标”2 天和“序列指标/降采样”2–3 天

**Files:**

- Create: `src/lib/tradeAnalytics.ts`
- Create: `src/lib/tradeAnalytics.test.ts`
- Create: `src/lib/analyticsSeries.ts`
- Create: `src/lib/analyticsSeries.test.ts`
- Modify: `scripts/run-regression-tests.mjs`
- Modify: `src/lib/reviewAnalytics.ts`
- Modify: `src/lib/strategies.ts`

**Metrics:**

- 期望 R、中位 R、平均盈利 R、平均亏损 R；
- 盈亏比、Profit Factor；
- 胜率和 95% Wilson 区间；
- 总 R、累计盈亏、覆盖率；
- 交易序列最大回撤 R、当前回撤、最长连亏；
- 最近 20 / 50 / 100 笔滚动期望；
- 金额聚合状态：明确单币种、推断币种、混合币种、无数据。

**Boundary Tests:**

- [ ] empty / one / all-win / all-loss / all-breakeven；
- [ ] null 与真实 0；
- [ ] JavaScript `Infinity` 不进入返回对象或 JSON；无亏损样本通过独立状态让 UI 显示 `∞ · 暂无亏损样本`；
- [ ] 同日多笔以 timestamp、日期、ref 形成确定顺序；
- [ ] 无平仓日期交易只进入 all-time 横截面，不进入趋势、回撤、连亏和滚动序列；
- [ ] 多币种不求和；费用覆盖率分母仅为 usable 中有金额的交易，金额覆盖率独立计算；
- [ ] 分桶总数等于有效 R 数；
- [ ] 各指标使用各自分母，不能共用 closedCount 冒充覆盖率。

**Commit:** `feat(analytics): add professional performance metrics`

---

### Task 6: 改造仪表盘总览和 URL 分析条件

**Effort:** 4–6 天，拆为“URL/范围”“指标/趋势”“策略表/响应式”三个工作包

**Files:**

- Create: `src/views/dashboard/DashboardScopeBar.tsx`
- Create: `src/views/dashboard/MetricCard.tsx`
- Create: `src/views/dashboard/PerformanceTrend.tsx`
- Create: `src/views/dashboard/StrategyEvidenceTable.tsx`
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/Dashboard.css`
- Reuse: existing `FilterBar`, `Select`, trade filter option builders where suitable

**Steps:**

- [ ] 分析条件写入 URL：kind、range、strategyId、symbol、side、timeframe、session、tag、mistakeTag、currency；currency 提供单选筛选，使多币种状态可收敛到单币种样本。
- [ ] 不同维度可同时组合，但每个维度只接受一个值；首轮不实现同维度多选/OR。
- [ ] “全部”清空 URL 条件，不继承交易日志筛选。
- [ ] 四张主 KPI：累计/净盈亏、期望 R、胜率区间、最大序列回撤；紧凑次级行：总 R、PF、中位 R、最大连亏。
- [ ] 金额主卡与趋势复用同一个 label/state helper；混合币种显示“多币种，无法合计”，推断币种不得显示为确认净额。
- [ ] 趋势支持累计 R / 累计或净盈亏 / 滚动 20 笔切换。
- [ ] 策略表显示 n、期望 R、胜率区间、总 R、金额覆盖；默认用户配置顺序，手动可按总 R/期望 R/样本数排序。“总 R 贡献”Tooltip 明确它不是单笔优势；少样本不使用强结论色。
- [ ] 所有指标 Tooltip 写清公式、排除规则和分母。
- [ ] 筛选后无数据保留条件并提供“清除筛选”，不出现新建 CTA。

**Acceptance:**

1. URL 刷新、前进、后退可还原相同统计；
2. 卡片、曲线、策略表共用同一 universe；
3. 1366、2K、4K，Windows 125%/150%、浏览器 100%/125% 与中文长标签下不截断关键指标；
4. 无数据、零值、覆盖不足、冲突四种状态视觉不同且不只依赖颜色。

**Commit:** `feat(dashboard): present evidence-based performance overview`

---

### Task 7: 数据质量摘要与下钻

**Effort:** 1–2 天

**Files:**

- Create: `src/views/dashboard/DataQualitySummary.tsx`
- Create: `src/views/dashboard/DataQualityDrawer.tsx`
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/lib/tradeFilters.ts`
- Modify: `src/components/trades/TradeFilters.tsx`
- Modify: `src/lib/tradeView.ts`、`src/lib/workbenchTrades.ts`、`src/views/ListView.tsx`、`src/lib/routeContext.ts`、`src/lib/savedTradeViews.ts`
- Add: HTML/browser regression harness and register in `scripts/run-regression-tests.mjs`

**Data Issues:**

`missing-result | conflict | invalid-risk | missing-r | missing-pnl | missing-closed-at | missing-risk | missing-costs | missing-timeframe | missing-session | inferred-currency | unknown-currency | mixed-currency`

**Steps:**

- [ ] 常驻摘要只显示可用结果覆盖率、R 覆盖率、最严重问题；其余覆盖率进入抽屉。
- [ ] 结果冲突/非法风险为阻塞，缺费用/风险/时段为非阻塞覆盖提示，推断币种为信息；只有阻塞项使用警示色。
- [ ] 每项使用合法分母：结果/closed，R/usable，金额/usable，费用与币种/usable 且有金额；不展示笼统健康分数。
- [ ] finite range 的 missingClosedAt 显示“全库 X 笔无法归属时间范围”，不伪装成当前范围百分比；该项下钻移除 range、保留其余 scope。
- [ ] “查看交易”跳转既有交易列表并应用 `dataIssue`，同时保留 kind/range/strategy 等 Dashboard scope，不新建第二套列表。
- [ ] Dashboard 与列表统一使用 `range` 参数和共享日期映射 helper；跳转后的列表 count 必须等于抽屉 count。
- [ ] 列表顶部明确显示这是数据修复范围，点击“全部”清除该条件。

**Commit:** `feat(analytics): add actionable data quality drilldown`

---

### Task 10: 10k 性能收口（条件任务）

**Effort:** 1–3 天，位于 Preview B 发布门前；Task 5/6/7 完整 production build 任一基准未达门槛时执行

按以下顺序处理：

1. 单次扫描和 Map 聚合；
2. memo 复用；
3. 图表显示降采样；
4. 10k 同步纯计算 p95 仍超过 40ms 才评估 Web Worker 或分片计算；
5. 保存超限只记录瓶颈并发起独立存储设计评审，不在本任务改增量持久化或重写 SQLite。

---

## Preview B 发布门槛

- 所有 Preview A 门槛继续通过；
- production build、固定参考机、5 次预热/30 次测量：10k 总览同步纯计算 warm p95 < 40ms，不产生 50ms 主线程长任务；
- 10k scope 切换到下一帧可交互 p95 < 180ms，cold hydrate p95 < 1.5s、warm hydrate p95 < 600ms、完整快照保存 p95 < 1.2s，且不比 Task 0 基线回退超过 10%；
- 上述计算、交互、hydrate 或保存任一门槛未达标都不得发布 Preview B；若需要存储架构评审，先停止本波次，不以“后续再优化”放行；
- 图表可见点不超过 600，指标仍使用全量；
- 仪表盘、策略页、设置策略页同 scope 数值一致；
- 至少用真实 200+ 笔资料验证：无数据、零值、少样本、冲突、金额/R 覆盖不足；
- 发布 preview 后实际使用 2–4 周，再判断是否做优势探索器。

---

## 第二阶段保留任务：不随 Preview B 自动执行

### Task 8: 轻复盘执行标记

**Effort:** 2 天

- `ruleAdherence: followed | deviated | unknown`；
- 放在完成复盘附近，不放进新建；
- “按计划并完成”“暂不判断并完成”均为一步操作；“有偏差”才展开错误标签后完成；
- 分别统计复盘完成率和规则遵守覆盖率；
- UI 使用“关联损耗”，不把观察差异宣传为因果“错误税”。

### Task 9: 开放策略版本管理 UI

**Effort:** 3 天

- 复用 v7 已存在的 `StrategyVersion[]`、`currentVersionId` 与 `Trade.strategyVersionId`，本任务不再迁移 schema；
- 提供“创建新版本”、版本说明、当前版本切换与历史只读查看；
- 名称/图标/颜色变化不创建版本；规则或复盘模板变化由用户明确创建新版本；
- 已有交易引用的版本不可原地改规则；
- 历史交易永不自动改绑；
- 删除策略改为归档，不再重写历史 strategyId。

## Testing Pyramid

| 层级 | 比例 | 覆盖 |
|---|---:|---|
| 纯函数单元 | 70% | scope、迁移、结果证据、公式、分桶、回撤、滚动、置信区间 |
| 存储/导入集成 | 20% | v6→v7、幂等、Electron/IDB、JSON/zip、失败回滚、round-trip |
| 浏览器组件 | 8% | URL 条件、空态、冲突、金额/R 同显、质量下钻、DPI/缩放、中文长标签 |
| Electron E2E | 2% | 打开旧库、升级、编辑、重启、导出、pre-v7 恢复、10k 打开与保存 |

## Rollback Strategy

### P0 数据迁移

- Electron 使用验证过且不参与轮转的 `pre-v7` 恢复点；IndexedDB 使用 transaction 内专用 v6 rollback key；
- v7 写入前不更新 manifest；临时 DB 完成迁移和校验后才切换活动快照；manifest 错位按活动 DB 内嵌版本恢复；
- 回滚旧客户端时必须同时恢复 v6 备份，不能直接用旧客户端打开 v7 库；
- migration commit 可代码回滚，但已经升级的用户数据必须通过对应平台的验证恢复点回滚；
- 用户确认升级稳定前不得清理恢复点；恢复点创建/验证失败必须阻止升级。

### P1 派生分析和 UI

- 不持久化分析结果；
- 可按任务直接 revert；
- URL 参数未知时忽略并回退默认 live/all；
- 新卡片或面板失败时不影响交易增删改和自动保存。

## Final Definition of Done

1. 当前设计规格全部验收项通过；
2. Preview A 与 Preview B 均保留真实使用记录和基准报告；
3. 用户无需多填必填字段即可继续原有新建、平仓、复盘流程；
4. 任一 KPI 都能回答“用了哪些交易、排除了哪些交易、覆盖率是多少”；
5. 1,000 / 10,000 笔时不再因缺失值、混合口径或策略现金排名产生明显误导；
6. 项目停在可信 P1 底座，未擅自继续发散到 AI 或高级模型。
