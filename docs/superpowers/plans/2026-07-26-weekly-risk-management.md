# Weekly Risk Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在今日工作台交付每周风险准备、账户预算 R 日/周/月进度、首次实盘开仓软确认，以及可持久化、可迁移、可冻结的复盘证据。

**Architecture:** 新增独立的风险领域类型与纯计算模块，Store 只负责命令编排和 UI 状态；所有首次实盘 `open` 通过同一领域入口，触线确认使用完整快照原子提交。持久化 Schema 升至 v9，Web 沿用 revision CAS，Electron 使用带迁移标记和恢复副本的双文件升级协议。

**Tech Stack:** React 18、TypeScript 5.6、Zustand 4、Vite 8、IndexedDB、Electron 43、sql.js、现有自定义单元测试与 Playwright 浏览器测试框架。

## Global Constraints

- 设计基线：`docs/superpowers/specs/2026-07-26-weekly-risk-management-design.md` v3。
- 所有文件保持 UTF-8 无 BOM，保留中文字符。
- 不新增完整风险账本、持仓风险、多账户或通用规则引擎。
- 不使用现有交易 `rMultiple` 计算账户预算 R。
- 资金与 PnL 先规范化为整数美分；R 统一量化至 9 位小数。
- 已确认 policy、月限额和 override event 不原地覆盖。
- 功能保持提醒和软确认，不把触线变成禁止交易。
- 每个任务先得到预期失败，再实现最小代码并运行定向测试。

---

## File Map

- `src/data/riskManagement.ts`：风险领域实体、覆盖状态、默认值和运行时类型。
- `src/lib/riskBudget.ts`：业务日固化、可信 PnL、policy 选择和日/周/月预算纯计算。
- `src/lib/riskPolicy.ts`：周准备、policy 版本和月限额的纯状态转换。
- `src/lib/tradeOpenRiskGate.ts`：首次 open 资格、可信 open 历史、fingerprint 和 Gate 决策。
- `src/lib/riskGatedTradeOpenCommit.ts`：状态与 override event 的候选快照及原子提交编排。
- `src/components/WeeklyRiskPreparationCard.tsx`：周准备提醒和摘要。
- `src/components/RiskBudgetCard.tsx`：日/周/月进度展示。
- `src/components/TradeOpenRiskDialog.tsx`：全局逐笔软确认。
- `src/storage/*`、`src/lib/importExport.ts`：v9 strict snapshot 与 Web/JSON/ZIP 链路。
- `electron/library/storage.ts`：Electron v8→v9 可恢复迁移。
- `src/lib/importMerge.ts`：风险实体合并、交易身份和引用重映射。
- `src/views/WeeklyReviewView.tsx`：完成时冻结风险事实。

---

### Task 1: 风险领域模型、金额精度与预算纯计算

**Files:**
- Create: `src/data/riskManagement.ts`
- Create: `src/lib/riskBudget.ts`
- Create: `src/lib/riskBudget.test.ts`
- Modify: `src/data/trades.ts:65-109`
- Modify: `src/lib/tradeTransition.ts`
- Modify: `src/lib/tradeTransition.test.ts`

**Interfaces:**
- Produces: `RiskPolicyVersion`, `MonthlyRiskLimit`, `RiskPeriodOutcomeSnapshot`, `RiskUnknownReason`。
- Produces: `toMoneyCents(value)`, `quantizeR(value, digits)`, `resolveRiskOutcomes(input)`。
- Produces: `Trade.closedTradingDayKey?: string`，供持久化、Gate 和周复盘复用。
- Test-local: `fixture(options: { pnls?: number[]; lossWithoutClosedAt?: boolean }): ResolveRiskOutcomesInput`，固定当前日为 `2026-07-27`、policy 为 `$1,000/R`、日限额为 `2R`。
- Private: `calculateCanonicalOutcomes(input: ResolveRiskOutcomesInput): ResolvedRiskOutcomes`，承载候选扫描和三周期聚合。

- [ ] **Step 1: 写预算与异常日期失败测试**

在 `src/lib/riskBudget.test.ts` 导出以下测试函数；fixture 只构造测试所需字段：

```ts
import { resolveRiskOutcomes, toMoneyCents } from '@/lib/riskBudget'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testRiskBudgetReturnsProfitCredit(): void {
  const result = resolveRiskOutcomes(fixture({ pnls: [-1000, 2000] }))
  assert(result.day.netBudgetR === 1, '净值应为 +1R')
  assert(result.day.consumedR === 0, '盈利后已用额度应返还到 0R')
}

export function testLossWithMissingCloseDateIsUnknown(): void {
  const result = resolveRiskOutcomes(fixture({ lossWithoutClosedAt: true }))
  assert(result.gateCoverage === 'unknown', '无法归期的亏损必须 unknown')
  assert(result.unknownReasons.includes('missing-close-date'), '必须保留具体原因')
}

export function testMoneyRoundsHalfAwayFromZero(): void {
  assert(toMoneyCents(1.005) === 101, '1.005 应规范化为 101 美分')
  assert(toMoneyCents(-1.005) === -101, '-1.005 应规范化为 -101 美分')
  assert(toMoneyCents(10.075) === 1008, '10.075 应规范化为 1008 美分')
  assert(toMoneyCents(-10.075) === -1008, '-10.075 应规范化为 -1008 美分')
  assert(toMoneyCents(123456789.125) === 12345678913, '大金额半分边界也必须确定')
  assert(quantizeR(-1.9999999999999998) === -2, '浮点边界应规范化为精确触线值')
}
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/riskBudget.test.ts`

Expected: FAIL，错误包含无法解析 `@/lib/riskBudget`。

- [ ] **Step 3: 建立类型和最小计算实现**

在 `src/data/riskManagement.ts` 定义设计 v3 第 6 节全部接口，并在 `src/lib/riskBudget.ts` 实现统一入口：

```ts
export const R_PRECISION = 9

function scaledIntegerFromDecimalNumber(value: number, digits: number): bigint {
  if (!Number.isFinite(value)) throw new Error('数值必须是有限数')
  const sign = value < 0 ? -1n : 1n
  const [coefficient, exponentText = '0'] = Math.abs(value).toString().toLowerCase().split('e')
  const [whole, fraction = ''] = coefficient.split('.')
  const source = BigInt(`${whole}${fraction}`)
  const sourceScale = fraction.length - Number(exponentText)
  if (sourceScale <= digits) return sign * source * (10n ** BigInt(digits - sourceScale))
  const divisor = 10n ** BigInt(sourceScale - digits)
  const quotient = source / divisor
  const remainder = source % divisor
  const rounded = quotient + (remainder * 2n >= divisor ? 1n : 0n)
  return sign * rounded
}

export function toMoneyCents(value: number): number {
  const cents = scaledIntegerFromDecimalNumber(value, 2)
  const result = Number(cents)
  if (!Number.isSafeInteger(result)) throw new Error('金额超出安全范围')
  return result
}

export function quantizeR(value: number, digits = R_PRECISION): number {
  const factor = 10 ** digits
  const scaled = Number(scaledIntegerFromDecimalNumber(value, digits))
  if (!Number.isSafeInteger(scaled)) throw new Error('R 数值超出安全范围')
  return scaled / factor
}

export interface ResolveRiskOutcomesInput {
  trades: Trade[]
  policies: RiskPolicyVersion[]
  monthlyLimits: MonthlyRiskLimit[]
  currentTradingDayKey: string
}

export interface ResolvedRiskOutcomes {
  day: RiskPeriodOutcomeSnapshot
  week: RiskPeriodOutcomeSnapshot
  month: RiskPeriodOutcomeSnapshot
  gateCoverage: RiskCoverage
  unknownReasons: RiskUnknownReason[]
}

export function resolveRiskOutcomes(input: ResolveRiskOutcomesInput): ResolvedRiskOutcomes {
  // 实现顺序必须是：候选终态实盘交易 → TradeTruth → 业务日 → policy → 数值聚合。
  // 对缺失/非法/未来亏损日期返回 unknown；同类盈利只形成 partial 且不计正收益。
  return calculateCanonicalOutcomes(input)
}
```

`calculateCanonicalOutcomes` 必须按稳定 trade ID 排序，所有 PnL 先转美分，单笔和聚合 budget R 均调用 `quantizeR`；触线使用规范化结果比较，不读取 `trade.rMultiple`。

- [ ] **Step 4: 在平仓命令中固化业务日**

给 `Trade` 增加：

```ts
closedTradingDayKey?: string
```

先在 `riskBudget.ts` 增加唯一共享 helper：

```ts
export function closedTradingDayKeyFromClosedAt(
  closedAt: string | null,
  tradingDayStartHour: number,
): string | null {
  if (!closedAt) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(closedAt)) {
    const parsed = parseLocalDate(closedAt)
    return formatYmd(parsed) === closedAt ? closedAt : null
  }
  const timestamp = new Date(closedAt)
  return Number.isNaN(timestamp.getTime()) ? null : getTradingDayKey(timestamp, tradingDayStartHour)
}
```

`completeTradeClose` 和进入终态的状态命令在写 `closedAt` 的同一候选交易上调用该 helper。`YYYY-MM-DD` 必须直接保留，只有含时间值才应用交易日起始小时。只有显式修正 `closedAt` 时重算；仅修改 `tradingDayStartHour` 不遍历历史交易。测试覆盖日期字符串、带时区时间戳、负时区、日界线前后和非法日期。

- [ ] **Step 5: 运行定向测试**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/riskBudget.test.ts src/lib/tradeTransition.test.ts`

Expected: 两个测试入口全部 PASS；覆盖盈利返还、异常亏损日期、冲突结果、未来盈利、跨 policy 聚合和交易日起始小时变化。

- [ ] **Step 6: 提交领域计算**

```bash
git add src/data/riskManagement.ts src/data/trades.ts src/lib/riskBudget.ts src/lib/riskBudget.test.ts src/lib/tradeTransition.ts src/lib/tradeTransition.test.ts
git commit -m "feat: add risk budget domain model"
```

---

### Task 2: 周准备、不可变 Policy 与月限额物化

**Files:**
- Create: `src/lib/riskPolicy.ts`
- Create: `src/lib/riskPolicy.test.ts`
- Modify: `src/store/useStore.ts`

**Interfaces:**
- Consumes: Task 1 的风险实体和 `toMoneyCents`。
- Produces: `confirmWeeklyRiskPreparation(state, input)`、`ensureRiskPeriodRecords(state, date)`、`activeRiskPolicy(policies, date)`。
- Produces Store actions: `saveWeeklyRiskDraft`, `confirmWeeklyRiskPreparation`, `ensureRiskPeriodRecords`。
- Private: `comparePolicyPrecedence(left, right): number` 和 `appendLockedMonthlyLimit(state, monthKey, policy): RiskPolicyState`。
- `ConfirmWeeklyRiskPreparationInput` 必须包含 `currentTradingDayKey`、canonical `hasClosedLiveTradeOnDay`、draft、`confirmedAt` 和 ID factory 输入。
- Test-local: `emptyState(): RiskPolicyState`、`stateWithPolicy(): RiskPolicyState`、`confirmation(day, patch?): ConfirmWeeklyRiskPreparationInput`。

- [ ] **Step 1: 写版本时序与月锁定失败测试**

```ts
export function testConfirmedPolicyIsImmutableAndEffectiveForward(): void {
  const first = confirmWeeklyRiskPreparation(emptyState(), confirmation('2026-07-27', {
    hasClosedLiveTradeOnDay: false,
  }))
  const second = confirmWeeklyRiskPreparation(first, confirmation('2026-07-27', {
    hasClosedLiveTradeOnDay: true,
    riskPercent: 2,
  }))
  assert(first.riskPolicyVersions[0].riskPercent === 1, '旧版本不可被覆盖')
  assert(first.riskPolicyVersions[0].effectiveTradingDay === '2026-07-27', '干净新周首次确认当天生效')
  assert(second.riskPolicyVersions[1].effectiveTradingDay === '2026-07-28', '周中修订次日生效')
}

export function testMonthlyLimitMaterializesOnce(): void {
  const once = ensureRiskPeriodRecords(stateWithPolicy(), '2026-07-27')
  const twice = ensureRiskPeriodRecords(once, '2026-07-28')
  assert(once.monthlyRiskLimits.length === 1, '首次显式动作创建月限额')
  assert(twice.monthlyRiskLimits[0].limitR === once.monthlyRiskLimits[0].limitR, '当月不得重写')
}
```

- [ ] **Step 2: 运行并确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/riskPolicy.test.ts`

Expected: FAIL，缺少 `riskPolicy` 导出。

- [ ] **Step 3: 实现纯状态转换**

```ts
export function activeRiskPolicy(
  policies: readonly RiskPolicyVersion[],
  tradingDay: string,
): RiskPolicyVersion | null {
  return [...policies]
    .filter((item) => item.effectiveTradingDay <= tradingDay)
    .sort(comparePolicyPrecedence)
    .at(-1) ?? null
}

export function ensureRiskPeriodRecords(
  state: RiskPolicyState,
  tradingDay: string,
): RiskPolicyState {
  const monthKey = tradingDay.slice(0, 7)
  if (state.monthlyRiskLimits.some((item) => item.monthKey === monthKey)) return state
  const policy = activeRiskPolicy(state.riskPolicyVersions, tradingDay)
  if (!policy) return state
  return appendLockedMonthlyLimit(state, monthKey, policy)
}
```

确认函数必须验证正数、按美分 canonical 公式生成 `riskAmount`、追加新版本而不更新旧版本，并实现设计 v3 第 5.3 节的生效日规则。Store action 从同一当前 state 使用 `closedTradingDayKeyFromClosedAt`/已固化 key 计算 `hasClosedLiveTradeOnDay` 后再调用纯函数。测试必须覆盖首次确认当日无平仓、当日已有平仓、非首次确认，以及同一生效日按 `confirmedAt/id` 决定优先级。

- [ ] **Step 4: 接入 Store，但保持 selector 纯读取**

在 `useStore.ts` 增加四个持久字段及三个 action。`ensureRiskPeriodRecords()` 仅从启动完成、跨交易日和确认首个 policy 的显式 effect/action 调用，禁止在 React selector 或 `resolveRiskOutcomes` 中写入。

- [ ] **Step 5: 运行测试和类型检查**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/riskPolicy.test.ts && pnpm typecheck`

Expected: 风险 policy 测试全部 PASS；两个 TypeScript project 均退出 0。

- [ ] **Step 6: 提交规则状态**

```bash
git add src/lib/riskPolicy.ts src/lib/riskPolicy.test.ts src/store/useStore.ts
git commit -m "feat: add weekly risk policy state"
```

---

### Task 3: PersistedSnapshot v9 严格合同与 Web/JSON/ZIP 链路

**Files:**
- Modify: `src/storage/types.ts`
- Modify: `src/storage/persistedKeys.ts`
- Modify: `src/storage/emptySnapshot.ts`
- Modify: `src/storage/fixtures/fullPersistedSnapshot.ts`
- Modify: `src/storage/snapshotCodec.ts`
- Modify: `src/storage/snapshotValidation.ts`
- Modify: `src/storage/bootstrap.ts`
- Modify: `src/storage/persist.ts`
- Modify: `src/lib/importExport.ts`
- Modify: `src/lib/importTypes.ts`
- Modify: `src/storage/snapshotCodec.test.ts`
- Modify: `src/storage/snapshotValidation.test.ts`
- Modify: `src/storage/IndexedDbArchiveReplace.browser.test.ts`
- Modify: `src/storage/Release0ArchiveCompatibility.browser.test.ts`
- Modify: `src/storage/indexedDbRevision.browser.test.ts`
- Modify: `src/lib/webJournalArchive.ts`
- Modify: `src/lib/webJournalArchive.test.ts`
- Modify: `src/lib/librarySwitchRace.test.ts`
- Modify: `src/lib/importConcurrency.test.ts`
- Modify: `electron/library/journalZip.ts`
- Modify: `electron/library/journalZip.test.ts`
- Modify: `electron/library/backup.test.ts`
- Modify: `electron/library/libraryActivation.test.ts`
- Modify: `electron/qa.ts`

**Interfaces:**
- Consumes: Tasks 1–2 的四个风险数组和 `Trade.closedTradingDayKey`。
- Produces: `SCHEMA_VERSION = 9`、严格 `PersistedSnapshot`、仅 legacy 使用的 `decodeCanonicalSnapshot(raw, { version })`。

- [ ] **Step 1: 写 v9 缺字段拒绝测试**

在 `snapshotCodec.test.ts` 增加四字段参数化负例：

```ts
function assertThrowsMatching(run: () => unknown, pattern: RegExp, message: string): void {
  try {
    run()
  } catch (error) {
    if (pattern.test(error instanceof Error ? error.message : String(error))) return
    throw new Error(`${message}：收到非预期错误 ${String(error)}`)
  }
  throw new Error(`${message}：函数没有抛错`)
}

export function testV9RequiresEveryRiskField(): void {
  const full = createFullPersistedSnapshotFixture()
  for (const field of ['weeklyRiskPreparations', 'riskPolicyVersions', 'monthlyRiskLimits', 'riskOverrideEvents'] as const) {
    const candidate = { ...full } as Record<string, unknown>
    delete candidate[field]
    assertThrowsMatching(
      () => decodeCanonicalSnapshot(candidate, { version: SCHEMA_VERSION }),
      new RegExp(`缺少必需字段.*${field}`),
      `当前 Schema 缺少 ${field} 必须因该字段拒绝`,
    )
  }
}

export function testV8BackfillsRiskFields(): void {
  const decoded = decodeCanonicalSnapshot(minimalHistoricalSnapshot(), { version: 8 })
  assert(decoded.riskPolicyVersions.length === 0, 'v8 应补空 policy 数组')
}

export function testV8BackfillsClosedTradingDayKey(): void {
  const decoded = decodeCanonicalSnapshot(legacyClosedTradesFixture({
    tradingDayStartHour: 6,
    closedAt: '2026-07-27',
  }), { version: 8 })
  assert(decoded.trades[0].closedTradingDayKey === '2026-07-27', '日期字符串不得二次换日')
}
```

- [ ] **Step 2: 运行并确认 v9 缺字段测试失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts`

Expected: FAIL，因为当前 Schema 对新增字段不抛错，`assertThrowsMatching` 收不到“缺少必需字段 + 字段名”的错误；不得因“未来版本”异常形成假红或假绿。

- [ ] **Step 3: 升级严格类型和所有手工字段通道**

```ts
export const SCHEMA_VERSION = 9

// 在现有 PersistedSnapshot interface 内新增以下四个必填属性：
weeklyRiskPreparations: WeeklyRiskPreparation[]
riskPolicyVersions: RiskPolicyVersion[]
monthlyRiskLimits: MonthlyRiskLimit[]
riskOverrideEvents: RiskOverrideEvent[]
```

将四字段加入 `PERSISTED_SNAPSHOT_FIELDS`、empty snapshot、完整 fixture、`pickPersisted`、bootstrap hydrate、`applySnapshotToStore`、reset、portable writer 以及 Web/Electron archive reader/writer。普通 JSON 的 `EXPORT_VERSION` 改为 9；`WEB_JOURNAL_EXPORT_VERSION` 保持 8，ZIP Manifest 的 `schemaVersion` 使用 9。

将所有直接构造 `PersistedSnapshot` 的 typed fixture 改为以 `createFullPersistedSnapshotFixture()` 或 `createEmptyPersistedSnapshot()` 为基底后覆盖测试字段，至少覆盖本任务 Files 中列出的 IndexedDB revision、Web ZIP、Electron ZIP、library switch、backup、activation 和 Electron QA 文件。完成本步骤立即运行 `pnpm typecheck`，不得把必填字段的编译错误推迟到 UI 任务。

- [ ] **Step 4: 分离 legacy 与 v9 解码**

```ts
if (options.version >= 9) {
  requireArray(raw, 'weeklyRiskPreparations')
  requireArray(raw, 'riskPolicyVersions')
  requireArray(raw, 'monthlyRiskLimits')
  requireArray(raw, 'riskOverrideEvents')
}

const candidate: PersistedSnapshot = {
  ...decodeExistingFields(raw, options),
  weeklyRiskPreparations: decodeLegacyArray(raw.weeklyRiskPreparations, options.version),
  riskPolicyVersions: decodeLegacyArray(raw.riskPolicyVersions, options.version),
  monthlyRiskLimits: decodeLegacyArray(raw.monthlyRiskLimits, options.version),
  riskOverrideEvents: decodeLegacyArray(raw.riskOverrideEvents, options.version),
}
```

legacy 解码在构造 candidate 前调用：

```ts
const trades = options.version <= 8
  ? backfillClosedTradingDayKeys(raw.trades, raw.display?.tradingDayStartHour)
  : decodeStrictV9Trades(raw.trades)
```

`backfillClosedTradingDayKeys` 必须复用 Task 1 的 `closedTradingDayKeyFromClosedAt`：有效日期字符串直接保留，时间戳按 v8 snapshot 自身的 `display.tradingDayStartHour` 固化，非法日期保持空并由风险计算降级。原生 v9 对“合法终态实盘交易缺 key”严格拒绝。snapshot validation 同时检查不可变实体字段、日期、有限正数、`closedTradingDayKey` 条件合同和 event 身份摘要。

- [ ] **Step 5: 运行持久化定向测试**

Run: `node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts src/storage/persist.test.ts src/lib/importExportAssets.test.ts src/lib/webJournalArchive.test.ts src/lib/librarySwitchRace.test.ts electron/library/journalZip.test.ts electron/library/backup.test.ts electron/library/libraryActivation.test.ts && pnpm typecheck`

Expected: 全部 PASS；v8 可迁移，v9 缺失字段拒绝，完整 v9 fixture 逐字段保真。

- [ ] **Step 6: 提交 Schema v9**

```bash
git add src/storage/types.ts src/storage/persistedKeys.ts src/storage/emptySnapshot.ts src/storage/fixtures/fullPersistedSnapshot.ts src/storage/snapshotCodec.ts src/storage/snapshotValidation.ts src/storage/bootstrap.ts src/storage/persist.ts src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts src/storage/IndexedDbArchiveReplace.browser.test.ts src/storage/Release0ArchiveCompatibility.browser.test.ts src/storage/indexedDbRevision.browser.test.ts src/lib/importExport.ts src/lib/importTypes.ts src/lib/webJournalArchive.ts src/lib/webJournalArchive.test.ts src/lib/librarySwitchRace.test.ts src/lib/importConcurrency.test.ts electron/library/journalZip.ts electron/library/journalZip.test.ts electron/library/backup.test.ts electron/library/libraryActivation.test.ts electron/qa.ts
git commit -m "feat: persist risk management schema v9"
```

---

### Task 4: Electron v8→v9 强杀可恢复迁移

**Files:**
- Create: `electron/library/schemaMigration.ts`
- Create: `electron/library/schemaMigration.test.ts`
- Modify: `electron/library/storage.ts`
- Modify: `scripts/run-forced-kill-evidence.mjs`

**Interfaces:**
- Consumes: Task 3 的 `SCHEMA_VERSION` 和 strict decoder。
- Produces: `recoverInterruptedSchemaMigrationFiles(paths): RecoveryResult`，仅同步恢复 `journal.db + manifest.json` 文件对；`migrateOpenedLibraryV8ToV9(input): void` 接收已经初始化的 sql.js `Database` 与路径。
- Private: marker reader/writer、DB/Manifest pair validator、verified recovery copy/restore 和受 library root 约束的 cleanup helpers。
- Test-local: `createV8LibraryFixture()`、异步 `assertInjectedCrash(library, boundary)`、异步 `readAndDecodePair(path)`。

- [ ] **Step 1: 写三个中断边界失败测试**

```ts
export async function testMigrationRecoversAfterDatabaseReplacement(): Promise<void> {
  const library = createV8LibraryFixture()
  await assertInjectedCrash(library, 'after-database-replace')
  const reopened = new LibraryStorage(library.path, { allowCreate: false })
  await reopened.open()
  const pair = await readAndDecodePair(library.path)
  assert(pair.manifest.schemaVersion === pair.decodedSchemaVersion, '恢复后版本必须一致')
  assert([8, 9].includes(pair.manifest.schemaVersion), '只能恢复成完整 v8 或完整 v9')
}
```

同文件增加 `before-database-replace` 与 `after-manifest-replace` 两个导出测试，并断言恢复对象是实际的 `journal.db` 和 `manifest.json`。

- [ ] **Step 2: 运行并确认迁移恢复 API 不存在**

Run: `node scripts/run-regression-tests.mjs --unit-only electron/library/schemaMigration.test.ts`

Expected: FAIL，缺少 `schemaMigration` 模块。

- [ ] **Step 3: 实现幂等迁移协议**

```ts
type LibraryPaths = ReturnType<typeof getLibraryPaths>
type RecoveryResult =
  | { kind: 'none' }
  | { kind: 'restored-v8' }
  | { kind: 'pending-v9-validation'; marker: SchemaMigrationMarker }

export function recoverInterruptedSchemaMigrationFiles(paths: LibraryPaths): RecoveryResult {
  const marker = readMigrationMarker(paths)
  if (!marker) {
    assertPairVersionsMatch(paths)
    return { kind: 'none' }
  }
  if (marker.phase === 'manifest-replaced' && readManifestFile(paths).schemaVersion === 9) {
    return { kind: 'pending-v9-validation', marker }
  }
  restoreVerifiedV8Pair(marker)
  assertValidV8Pair(paths)
  return { kind: 'restored-v8' }
}
```

`migrateOpenedLibraryV8ToV9` 严格执行：校验已打开 DB 中的 v8 `meta.snapshot` → 复制并校验 `journal.db + manifest.json` recovery → 原子写 marker → 使用 Task 3 canonical decoder 生成 v9 snapshot（含历史 `closedTradingDayKey` 回填）→ 写入候选 sql.js DB 并导出临时 `journal.db` → 重开临时 DB 校验 → 原子替换正式 `journal.db` → 更新 marker → 最后替换 Manifest → 从正式路径重开验证 → 清理。所有递归删除只作用于已解析且位于当前 library 内的专用 recovery 目录。

- [ ] **Step 4: 在正常加载前调用恢复**

`LibraryStorage.open()` 的固定顺序为：

```ts
const recovery = recoverInterruptedSchemaMigrationFiles(this.paths)
const SQL = await getSql()
this.db = openDatabase(SQL, this.paths.dbFile)
if (recovery.kind === 'pending-v9-validation') {
  try {
    assertOpenedPairVersion(this.db, this.readManifest(), 9)
    removeMigrationRecovery(recovery.marker)
  } catch {
    closeDatabase(this.db)
    restoreVerifiedV8Pair(recovery.marker)
    this.db = openDatabase(SQL, this.paths.dbFile)
  }
}
const manifest = this.readManifest()
if (manifest.schemaVersion === 8) {
  migrateOpenedLibraryV8ToV9({ db: this.db, paths: this.paths, manifest })
  this.db = reopenAndValidateDatabase(SQL, this.paths.dbFile, 9)
}
assertOpenedPairVersion(this.db, this.readManifest(), SCHEMA_VERSION)
```

文件恢复必须发生在读取 DB 前；Schema 迁移必须发生在 `await getSql()` 之后。无 marker 的混合版本直接抛出明确恢复错误，不猜测数据版本。

- [ ] **Step 5: 运行单元与强杀证据测试**

Run: `node scripts/run-regression-tests.mjs --unit-only electron/library/schemaMigration.test.ts && pnpm test:forced-kill:electron`

Expected: 三个边界均恢复为完整 v8 或完整 v9；普通 v8 open 自动完成 v9 迁移；日期字符串、时间戳、不同 start hour 和非法日期回填符合 Task 3；强杀证据脚本退出 0。

- [ ] **Step 6: 提交 Electron 迁移**

```bash
git add electron/library/schemaMigration.ts electron/library/schemaMigration.test.ts electron/library/storage.ts scripts/run-forced-kill-evidence.mjs
git commit -m "feat: recover interrupted schema v9 migration"
```

---

### Task 5: 首次 Open Gate、Fingerprint 与原子提交

**Files:**
- Create: `src/lib/tradeOpenRiskGate.ts`
- Create: `src/lib/tradeOpenRiskGate.test.ts`
- Create: `src/lib/riskGatedTradeOpenCommit.ts`
- Create: `src/lib/riskGatedTradeOpenCommit.test.ts`
- Modify: `src/storage/adapter.ts`

**Interfaces:**
- Consumes: Tasks 1–3 的 outcome、policy、snapshot，以及 `StorageAdapter`/`RevisionedStorageAdapter`。
- Produces: `requestTradeOpen(tradeId, returnFocus)`、`confirmPendingTradeOpen(reason)`、`cancelPendingTradeOpen()`。
- Produces: `TradeOpenRequestResult = 'opened' | 'pending-confirmation' | 'requires-risk-gate' | 'not-found'`。
- Private: `hasTrustedOpenActivity`、`selectTargetIdentity`、`canonicalJson`、`stableHash`、`revalidatePendingRequest` 和 `buildOpenedSnapshot`。
- Test-local: `triggeredState(source)`、`createRiskStore(state)`、`createPendingRequest(state)`、`changeTargetTrade(state, patch)`。
- Persistence mapping: 复用现有 `flushStorageBeforeCutover()`、`lockStorageCutoverInteraction()`、`suspendPersist()`、`resumePersist()` 和 `discardPendingAndResumePersist()`；不得建立第二套 cutover lock 或平行 persistence 方法。

- [ ] **Step 1: 写 Gate 绕过和竞态失败测试**

```ts
export function testEveryFirstLiveOpenRequiresDomainGate(): void {
  for (const source of ['planned', 'missed', 'loss'] as const) {
    const state = triggeredState(source)
    const result = requestTradeOpenCandidate(state, state.trades[0].id)
    assert(result.kind === 'confirmation-required', `${source} → open 必须进入 Gate`)
  }
}

export function testFingerprintRejectsChangedTradeIdentity(): void {
  const pending = createPendingRequest(triggeredState('planned'))
  const changed = changeTargetTrade(pending.state, { tradeKind: 'paper' })
  assert(validatePendingFingerprint(pending.request, changed).kind === 'cancelled', '目标资格变化应取消')
}
```

- [ ] **Step 2: 运行并确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/tradeOpenRiskGate.test.ts src/lib/riskGatedTradeOpenCommit.test.ts`

Expected: FAIL，两个新模块尚不存在。

- [ ] **Step 3: 实现首次 open 资格和 fingerprint**

```ts
export function requiresFirstOpenGate(trade: Trade): boolean {
  return trade.tradeKind === 'live'
    && !trade.deletedAt
    && trade.status !== 'open'
    && !hasTrustedOpenActivity(trade.activities)
}

export function buildRiskGateFingerprint(input: RiskGateFingerprintInput): string {
  return stableHash(canonicalJson({
    target: selectTargetIdentity(input.trade),
    tradingDay: input.currentTradingDayKey,
    policyVersionId: input.policy?.id ?? null,
    monthlyLimitId: input.monthlyLimit?.id ?? null,
    outcomes: input.outcomes,
    resultRefs: input.resultRefs,
  }))
}
```

可信 open activity 必须结构有效、属于同一交易活动序列，并且时间不晚于当前最新状态活动。本任务只完成纯领域判定和注入式提交能力，不改变现有生产 Store 或路由；公开 `setStatus` 的 fail-closed 接入与全部 UI 入口在 Task 6 同一提交完成。

- [ ] **Step 4: 实现原子候选快照提交**

```ts
export async function commitRiskGatedTradeOpen(input: CommitRiskGatedTradeOpenInput): Promise<CommitResult> {
  const unlockInteraction = lockStorageCutoverInteraction()
  let suspended = false
  let committed = false
  try {
    await flushStorageBeforeCutover()
    suspendPersist()
    suspended = true
    const storage = getStorage()
    const baseline = input.captureLatestState()
    const validation = revalidatePendingRequest(baseline.state, input.request)
    if (validation.kind !== 'valid') return validation
    const candidate = buildOpenedSnapshot(baseline.state, input.request, input.reason)
    if (isRevisionedStorageAdapter(storage)) {
      const envelope = await storage.loadSnapshotEnvelope()
      if (!sameCanonicalSnapshot(envelope.snapshot, baseline.snapshot)) {
        return { kind: 'needs-reconfirmation' }
      }
      await storage.commitLibraryMutation({
        expectedRevision: envelope.revision,
        snapshot: candidate.snapshot,
        reason: 'risk-gate',
      })
    } else {
      await storage.commitImport(candidate.snapshot, [])
    }
    input.publish(candidate.state)
    committed = true
    return { kind: 'committed' }
  } finally {
    if (suspended) {
      if (committed) discardPendingAndResumePersist()
      else resumePersist()
    }
    unlockInteraction()
  }
}
```

把 `RevisionedLibraryMutation.reason` 联合类型增加 `'risk-gate'`；在 `adapter.ts` 导出结构型 `isRevisionedStorageAdapter`，检查 `loadSnapshotEnvelope` 与 `commitLibraryMutation`。直接复用现有 `src/storage/cutover.ts` 的 flush 与全局交互锁。Web 从 envelope 获取真实 revision 并 CAS；Electron 继续使用现有补偿式 `commitImport`。交互锁覆盖所有可修改持久状态的入口，保证 Electron await 期间 Store 不变；状态活动与 event 在同一 candidate 中产生。失败保留 reason 和 pending request，恢复交互锁/autosave；fingerprint 或 canonical baseline 变化返回 `needs-reconfirmation`。

- [ ] **Step 5: 验证三个 Gate 分支和两类持久化适配器**

隔离 harness 分别验证 below 直接生成 open candidate、triggered/unknown 生成 pending；Web 使用 `commitLibraryMutation(expectedRevision)`，Electron 使用 `commitImport`；CAS/磁盘失败只留下原快照，成功只留下完整“状态活动 + event”。本任务不接管生产入口。

- [ ] **Step 6: 运行 Gate 与持久化故障测试**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/tradeOpenRiskGate.test.ts src/lib/riskGatedTradeOpenCommit.test.ts src/lib/tradeTransition.test.ts src/storage/persistenceController.test.ts`

Expected: 全部 PASS；Web CAS 与 Electron commitImport 路径均只能得到“状态+事件都有”或“二者都无”，第二个 pending request 不覆盖第一个。

- [ ] **Step 7: 提交 Gate**

```bash
git add src/lib/tradeOpenRiskGate.ts src/lib/tradeOpenRiskGate.test.ts src/lib/riskGatedTradeOpenCommit.ts src/lib/riskGatedTradeOpenCommit.test.ts src/storage/adapter.ts
git commit -m "feat: add atomic risk gate domain"
```

---

### Task 6: 今日工作台风险准备、预算卡与全局确认对话框

**Files:**
- Create: `src/components/WeeklyRiskPreparationCard.tsx`
- Create: `src/components/WeeklyRiskPreparationCard.css`
- Create: `src/components/RiskBudgetCard.tsx`
- Create: `src/components/RiskBudgetCard.css`
- Create: `src/components/TradeOpenRiskDialog.tsx`
- Create: `src/components/TradeOpenRiskDialog.css`
- Create: `src/components/RiskManagement.browser.test.tsx`
- Create: `src/components/RiskManagement.browser.test.html`
- Create: `src/store/riskGateIntegration.test.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/lib/tradeTransition.ts`
- Modify: `src/lib/tradeMenu.tsx`
- Modify: `src/views/TodayWorkspace.tsx`
- Modify: `src/views/TodayWorkspace.css`
- Modify: `src/views/ListView.tsx`
- Modify: `src/views/BoardView.tsx`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/shortcuts/ShortcutHost.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Store 周准备 actions、`resolveRiskOutcomes` 和 Gate pending actions。
- Produces: 常驻准备卡、风险进度卡和 App 根级 `TradeOpenRiskDialog`。

- [ ] **Step 1: 写浏览器验收失败测试**

浏览器测试至少断言：未复核卡常驻；确认后折叠；进度有可访问名称与文字；unknown 不显示安全剩余额度；triggered 必须输入 1–500 字原因；Esc 不开仓；临时 opener 卸载后焦点回稳定 fallback；提交失败保留原因且可重试。

```tsx
assert(document.querySelector('[data-risk-preparation]'), '未复核准备卡必须常驻')
const meter = document.querySelector('[role="progressbar"]')
assert(meter?.getAttribute('aria-label') === '今日止损预算', '进度必须有可访问名称')
assert(!screenText().includes('剩余 2R'), 'unknown 不得显示安全剩余额度')
```

`riskGateIntegration.test.ts` 增加结构性断言：公开 `setStatus(id, 'open')` 对任何首次实盘 open 都返回 `requires-risk-gate` 且不改状态；`requestTradeOpen` 的 below、triggered、unknown 三分支均不向 `undoStack`/`redoStack` 添加可重放首次 open 的 action；显式状态修正离开 open 后再回 open 保留既有审计事实。

- [ ] **Step 2: 运行浏览器框架并确认新测试失败**

Run: `node scripts/run-browser-tests.mjs`

Expected: FAIL `RiskManagement.browser.test.html`，组件尚不存在。

- [ ] **Step 3: 实现周准备和预算卡**

`WeeklyRiskPreparationCard` 只编辑 draft；确认时调用 Store action。`RiskBudgetCard` 使用纯 selector 取得 outcome，显示 day/week/month 三条进度、净 budget R、已用、限额、coverage、未计入数量和纪律文本；隐私模式隐藏金额但保留 R。

```tsx
<section data-risk-budget aria-labelledby="risk-budget-title">
  <h2 id="risk-budget-title">风险预算</h2>
  {rows.map((row) => (
    <RiskMeter key={row.scope} label={row.label} outcome={row.outcome} />
  ))}
</section>
```

- [ ] **Step 4: 实现全局单层对话框**

在 `App.tsx` 与 `TradeCloseDialog` 同级渲染 `TradeOpenRiskDialog`。复用 `ModalShell`，不嵌套 Composer；状态为 `idle | committing | error`，错误通过 `aria-describedby` 关联，提交时 `aria-busy=true`。关闭时依次尝试原 opener、交易行/卡片、命令入口按钮、主工作区容器。

- [ ] **Step 5: 同一提交接管 Store 与所有生产入口**

在 `useStore.ts` 增加 pending request 和 Task 5 的三个 action。公开 `setStatus` 对符合首次 open 条件的调用 fail-closed，返回 `requires-risk-gate`；below 分支也只调用不写历史栈的内部 primitive。`transitionTradeStatus`、`tradeMenu`、列表、看板、详情、今日工作台、命令面板和快捷键在目标为 open 时只调用 `requestTradeOpen`。批量复制只创建 planned；CSV、Notion、完整归档和备份恢复继续使用明确非交互入口。不得在 Task 5 与本步骤之间留下生产入口已接管但对话框缺失的提交。

- [ ] **Step 6: 将卡片放入今日工作台**

在行动队列下方、今日战绩上方依次渲染准备卡和预算卡。未复核准备卡不允许手动关闭；确认后折叠为摘要。沿用现有 spacing、surface token 和窄屏断点，不新增独立导航入口。

- [ ] **Step 7: 运行 Store、浏览器测试与类型检查**

Run: `node scripts/run-regression-tests.mjs --unit-only src/store/riskGateIntegration.test.ts src/lib/tradeTransition.test.ts && node scripts/run-browser-tests.mjs && pnpm typecheck`

Expected: 所有浏览器入口 PASS；TypeScript 退出 0；控制台无未允许错误。

- [ ] **Step 8: 提交 UI 与生产 Gate 接入**

```bash
git add src/components/WeeklyRiskPreparationCard.tsx src/components/WeeklyRiskPreparationCard.css src/components/RiskBudgetCard.tsx src/components/RiskBudgetCard.css src/components/TradeOpenRiskDialog.tsx src/components/TradeOpenRiskDialog.css src/components/RiskManagement.browser.test.tsx src/components/RiskManagement.browser.test.html src/store/riskGateIntegration.test.ts src/store/useStore.ts src/lib/tradeTransition.ts src/lib/tradeMenu.tsx src/views/TodayWorkspace.tsx src/views/TodayWorkspace.css src/views/ListView.tsx src/views/BoardView.tsx src/views/DetailView.tsx src/components/CommandPalette.tsx src/shortcuts/ShortcutHost.ts src/App.tsx
git commit -m "feat: add weekly risk workspace UI"
```

---

### Task 7: 周复盘同状态冻结风险证据

**Files:**
- Modify: `src/data/weeklyReviews.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/views/WeeklyReviewView.tsx`
- Modify: `src/views/WeeklyReviewView.browser.test.tsx`
- Create: `src/lib/weeklyReviewSnapshot.test.ts`

**Interfaces:**
- Consumes: 风险 outcome、policy versions、override events。
- Produces: `WeeklyReview.riskSnapshot?: WeeklyRiskReviewSnapshot` 和原子 `completeWeeklyReview(reviewId)`。
- Produces: `completeWeeklyReviewCandidate(state, reviewId)` 与 `reopenCompletedReview(review)` 纯转换，供 Store 和测试共用。
- Test-local: `stateAtRevision(revision)` 和 `completedFixture()`。

- [ ] **Step 1: 写混合时点和重开失败测试**

```ts
export function testCompleteReviewFreezesRiskFromOneState(): void {
  const completed = completeWeeklyReviewCandidate(stateAtRevision(7), 'review-1')
  assert(completed.review.completedAt === completed.review.riskSnapshot?.frozenAt, '完成时间与风险冻结时间必须一致')
  assert(completed.review.riskSnapshot?.overrideEvents.length === 1, '必须冻结当时事件')
}

export function testReopenClearsBothSnapshots(): void {
  const reopened = reopenCompletedReview(completedFixture())
  assert(!reopened.metricsSnapshot && !reopened.riskSnapshot, '重开必须同时清除两类快照')
}
```

- [ ] **Step 2: 运行并确认当前完成流程失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyReviewSnapshot.test.ts`

Expected: FAIL，尚无 `riskSnapshot` 或原子候选函数。

- [ ] **Step 3: 实现一次 Store state 冻结**

`completeWeeklyReview(reviewId)` 在单次 `set(state => ...)` 中读取最新交易、policy、monthly limit 和 event，使用同一个时间值写入现有 `completedAt` 与 `riskSnapshot.frozenAt`，深拷贝绩效与风险快照后同时完成复盘。保持现有 `WeeklyReviewMetrics` 结构，不为它增加设计外的 `frozenAt`。移除 `WeeklyReviewView` render 闭包中的 `liveMetrics` 作为完成输入。

- [ ] **Step 4: 展示冻结证据和 unresolved 事件**

已完成复盘始终读取 snapshot，不读取实时 outcome。展示当周规则版本、每日 outcome、完成时月度 outcome、确认原因、交易身份摘要和 linkState；关联交易删除时仍显示冻结信息。

- [ ] **Step 5: 运行周复盘测试**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyReviewSnapshot.test.ts && node scripts/run-browser-tests.mjs`

Expected: 完成、修改交易、删除交易、重载、重开场景全部 PASS。

- [ ] **Step 6: 提交周复盘证据**

```bash
git add src/data/weeklyReviews.ts src/store/useStore.ts src/views/WeeklyReviewView.tsx src/views/WeeklyReviewView.browser.test.tsx src/lib/weeklyReviewSnapshot.test.ts
git commit -m "feat: freeze risk evidence in weekly reviews"
```

---

### Task 8: 合并导入身份判定与完整引用重映射

**Files:**
- Create: `src/lib/riskImportMerge.ts`
- Create: `src/lib/riskImportMerge.test.ts`
- Modify: `src/lib/importMerge.ts`
- Modify: `src/lib/importTypes.ts`
- Modify: `src/lib/importExport.ts`
- Modify: `src/lib/importConcurrency.test.ts`

**Interfaces:**
- Consumes: v9 风险实体、Trade activities 和 WeeklyReview risk snapshot。
- Produces: `mergeRiskImport(current, imported, payloadDigest)`、`stableImportedTradeId(payloadDigest, tradeId)`。
- Private: `stableTradeIdentity`、`canonicalJson`、`stableHash` 和一次性 `rewriteTradeReferences`。
- Test-local: `localFixture()`、`importedCollisionFixture()`、`uniqueTradeIds(snapshot)`。

- [ ] **Step 1: 写同 ID 错链和重复导入失败测试**

```ts
export function testSameKindDifferentIdentityRemapsEveryReference(): void {
  const merged = mergeRiskImport(localFixture(), importedCollisionFixture(), 'sha256-a')
  const importedTrade = merged.trades.find((trade) => trade.ref === 'IMPORTED-1')
  assert(importedTrade?.id !== 'trade-1', '不同身份不得覆盖本地同 ID 交易')
  assert(merged.riskOverrideEvents[0].tradeId === importedTrade?.id, '顶层事件必须重映射')
  assert(merged.weeklyReviews[0].riskSnapshot?.overrideEvents[0].tradeId === importedTrade?.id, '冻结事件必须重映射')
}

export function testRepeatedImportUsesStableRemap(): void {
  const once = mergeRiskImport(localFixture(), importedCollisionFixture(), 'sha256-a')
  const twice = mergeRiskImport(once, importedCollisionFixture(), 'sha256-a')
  assert(uniqueTradeIds(twice).length === uniqueTradeIds(once).length, '重复导入不得重复克隆')
}
```

在 `importConcurrency.test.ts` 增加真实入口测试：对包含同 ID 冲突交易与附件的同一原始 payload 连续调用 `applyImport` 两次，断言第二次不会新增交易、override event 或 unresolved 引用。该测试不得直接向纯函数硬编码固定 digest。

- [ ] **Step 2: 运行并确认旧 comparator 失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/riskImportMerge.test.ts`

Expected: FAIL；当前 `importMerge.ts` 对同 kind、同 ID 交易直接覆盖。

- [ ] **Step 3: 实现稳定身份和纯引用转换**

```ts
export function stableImportedTradeId(payloadDigest: string, tradeId: string): string {
  return `imported:${stableHash(`${payloadDigest}:${tradeId}`)}`
}

export function isSameTradeIdentity(left: Trade, right: Trade): boolean {
  const leftIdentity = stableTradeIdentity(left)
  const rightIdentity = stableTradeIdentity(right)
  if (leftIdentity && rightIdentity) return canonicalJson(leftIdentity) === canonicalJson(rightIdentity)
  return canonicalJson(left) === canonicalJson(right)
}
```

先生成完整 `oldId → newId` 映射，再以一次纯转换重写 trades、顶层 events、冻结 events、周复盘交易 ID 列表和 Schema 内其他 trade ID 字段。无法完整重写的 event 设置 `linkState: 'unresolved'` 并保留身份摘要。

- [ ] **Step 4: 接入现有 mergeImportPayload**

保留既有 strategy、tag、view 合并逻辑；只把交易冲突与新增风险实体委托给 `mergeRiskImport`。不可变风险实体同 ID 同内容去重，同 ID 异内容拒绝整次导入并返回明确错误。

`applyImport(payload)` 必须在 `prepareImportPayloadForCommit(payload)` 随机重编号任何附件之前，对已经通过结构校验的原始 payload 计算 `canonicalImportDigest`，再把 `{ preparedPayload, payloadDigest }` 一起传给 `buildImportSnapshot`/`mergeRiskImport`：

```ts
const payloadDigest = await sha256CanonicalImportPayload(payload)
const prepared = prepareImportPayloadForCommit(payload)
const snapshot = buildImportSnapshot(revision, prepared.payload, payloadDigest)
```

digest 不读取导入时间、随机附件 ID 或本地 state，因此同一原始文件重复导入保持稳定。

- [ ] **Step 5: 运行导入与归档测试**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/riskImportMerge.test.ts src/lib/importConcurrency.test.ts src/storage/snapshotCodec.test.ts src/lib/importExportAssets.test.ts`

Expected: 同 kind 不同身份、缺失创建证据、重复导入、unresolved 和所有引用重映射场景 PASS。

- [ ] **Step 6: 提交导入合并**

```bash
git add src/lib/riskImportMerge.ts src/lib/riskImportMerge.test.ts src/lib/importMerge.ts src/lib/importTypes.ts src/lib/importExport.ts src/lib/importConcurrency.test.ts
git commit -m "feat: preserve risk references during import"
```

---

### Task 9: 全链路回归、可访问性与发布合同

**Files:**
- Modify: `docs/superpowers/specs/2026-07-26-weekly-risk-management-design.md`

**Interfaces:**
- Consumes: Tasks 1–8 的完整功能。
- Produces: 发布门禁和设计状态“已实施”。

- [ ] **Step 1: 运行全部单元与浏览器测试**

Run: `pnpm test`

Expected: 所有 Node、TypeScript 单元测试和浏览器测试 PASS，无 skip/todo，execution report 正常生成。

- [ ] **Step 2: 运行类型、Web 构建和 Electron 构建**

Run: `pnpm typecheck && pnpm build && pnpm build:app`

Expected: 三条命令均退出 0；bundle budget 通过。

- [ ] **Step 3: 运行持久化和 Electron 专项验证**

Run: `pnpm benchmark:persistence:release && pnpm test:electron-safety:platform && pnpm test:forced-kill:electron`

Expected: 持久化 benchmark 无回归门禁失败；Electron 安全与强杀证据均 PASS。

- [ ] **Step 4: 执行需求逐条验收**

逐条核对设计 v3 第 13 节十项成功标准，并在提交说明中记录对应测试文件：预算计算对应 `riskBudget.test.ts`，Gate 对应 `tradeOpenRiskGate.test.ts`，v9 对应 `snapshotCodec.test.ts`，Electron 恢复对应 `schemaMigration.test.ts`，UI 对应 `RiskManagement.browser.test.html`，周复盘对应 `weeklyReviewSnapshot.test.ts`。

- [ ] **Step 5: 更新设计状态并提交最终门禁**

全部验证通过后，将设计文档状态从“已批准，实施计划已就绪”改为“已实施并验证”。

```bash
git add docs/superpowers/specs/2026-07-26-weekly-risk-management-design.md
git commit -m "test: verify weekly risk management workflow"
```
