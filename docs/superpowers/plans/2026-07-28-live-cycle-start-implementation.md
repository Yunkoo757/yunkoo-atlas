# 实盘新周期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改历史交易事实的前提下，以开仓交易日建立可撤销的实盘统计起点，并让风险、工作台、分析、周复盘与历史筛选共享一致口径。

**Architecture:** 在 `src/lib/liveCycle.ts` 建立唯一的周期归属领域函数，Store 只持久化一个可选日期。所有日常统计在各自既有计算入口前调用该领域函数；完整历史、导出与已冻结周复盘保持不变。设置界面与风险卡复用同一个预览/确认组件，交易历史通过 URL 参数显式切换当前周期、规则前与全部实盘。

**Tech Stack:** TypeScript 5.6、React 18、Zustand 4、Vite 8、Playwright、Electron 43、项目自有 SSR 单元测试运行器。

## Global Constraints

- 所有读写文件必须使用 UTF-8 without BOM，禁止 GBK / GB2312 / ANSI，保留全部中文字符。
- 保持 `PersistedSnapshot` Schema v9；`liveStatsStartTradingDayKey` 是缺失即 `null` 的向后兼容可选字段，不启动 Electron 文件级 Schema 迁移。
- 不修改任何历史交易的 `tradeKind`、ID、金额、截图、笔记、标签、复盘或活动记录。
- 周期归属只按开仓交易日判断，起点日包含在当前周期；默认建议起点为 `2026-07-27`。
- 当前周期内的未知风险与真实触线继续使用现有 Gate，不得因统计起点而放宽。
- 已冻结周复盘不得重算；普通合并导入保留当前资料库的统计起点，完整恢复采用目标资料库自己的起点。
- 不新增第三方依赖，不创建多账户或多命名周期抽象。
- 每个任务先写失败测试，再写最小实现；每个任务单独提交。

---

## File Structure

### 新建

- `src/lib/liveCycle.ts`：日期解析、周期分类、范围过滤、影响预览与建议起点。
- `src/lib/liveCycle.test.ts`：边界日、交易日起始小时、非法日期、混合交易类型和建议规则测试。
- `src/components/LiveCycleSettings.tsx`：风险卡提示、设置卡、预览确认和清除操作。
- `src/components/LiveCycleSettings.css`：紧凑提示、设置卡、预览列表和移动端样式。
- `src/components/LiveCycleSettings.browser.test.tsx`：真实 React/Store 设置流程测试。
- `src/components/LiveCycleSettings.browser.test.html`：浏览器测试入口。
- `src/views/LiveCycleHistory.browser.test.tsx`：历史范围路由与规则前标签测试。
- `src/views/LiveCycleHistory.browser.test.html`：浏览器测试入口。

### 修改

- `src/storage/types.ts`、`src/storage/persistedKeys.ts`、`src/storage/emptySnapshot.ts`、`src/storage/snapshotCodec.ts`、`src/storage/snapshotValidation.ts`、`src/storage/fixtures/fullPersistedSnapshot.ts`：v9 可选字段合同与规范化。
- `src/storage/persist.ts`、`src/storage/bootstrap.ts`、`src/lib/importTypes.ts`、`src/lib/importMerge.ts`、`src/lib/importExport.ts`：保存、加载、完整恢复、导出和合并导入口径。
- `src/store/useStore.ts`：运行时字段、设置动作、风险 Gate 恢复与空库重置。
- `src/lib/riskBudget.ts`、`src/lib/tradeOpenRiskGate.ts`、`src/components/RiskBudgetCard.tsx`：当前周期风险候选、指纹与截断文案。
- `src/views/TodayWorkspace.tsx`、`src/views/Dashboard.tsx`、`src/components/StrategyHeader.tsx`、`src/components/trades/TradeList.tsx`、`src/views/settings/StrategiesPanel.tsx`：当前周期日常统计。
- `src/lib/analysisScope.ts`、`src/data/weeklyReviews.ts`、`src/views/WeeklyReviewView.tsx`：分析范围与新周复盘事实。
- `src/lib/workbenchTrades.ts`、`src/hooks/useWorkbenchVisibleTrades.ts`、`src/components/trades/TradeFilters.tsx`、`src/lib/savedTradeViews.ts`：历史周期 URL 筛选。
- `src/components/trades/TradeRow.tsx`、`src/components/trades/TradeList.css`、`src/views/DetailView.tsx`、`src/views/DetailView.css`：规则前派生标签。
- 对应 `*.test.ts`、`*.browser.test.tsx`：合同、风险、分析、复盘和浏览器回归。

---

### Task 1: 建立唯一的实盘周期领域模型

**Files:**
- Create: `src/lib/liveCycle.ts`
- Create: `src/lib/liveCycle.test.ts`

**Interfaces:**
- Produces: `LiveCycleScope`、`LiveCycleClassification`、`openedTradingDayKey()`、`classifyLiveCycleTrade()`、`filterTradesForLiveCycle()`、`buildLiveCyclePreview()`、`suggestLiveCycleStartTradingDayKey()`。
- Consumes: `Trade.openedAt`、`RiskPolicyVersion.effectiveTradingDay`、`getTradingDayKey()`、`parseLocalDate()`、`formatYmd()`。

- [ ] **Step 1: 写周期归属失败测试**

```ts
// src/lib/liveCycle.test.ts
import type { Trade } from '@/data/trades'
import type { RiskPolicyVersion } from '@/data/riskManagement'
import {
  buildLiveCyclePreview,
  classifyLiveCycleTrade,
  filterTradesForLiveCycle,
  suggestLiveCycleStartTradingDayKey,
} from '@/lib/liveCycle'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function trade(id: string, openedAt: string, tradeKind: Trade['tradeKind'] = 'live'): Trade {
  return {
    id, ref: `TRD-${id}`, symbol: 'GBPUSD', side: 'short', status: 'loss',
    conviction: 'medium', strategyId: 'strategy-1', tradeKind,
    tags: [], mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal',
    entry: 1.3, exit: 1.31, size: 1, pnl: -80, rMultiple: -1,
    resultSource: 'pnl', openedAt, closedAt: '2026-07-27', note: '',
  }
}

export function testLiveCycleIncludesBoundaryAndUsesTradingDayStartHour(): void {
  assert(classifyLiveCycleTrade(trade('boundary', '2026-07-27'), '2026-07-27', 6) === 'current', '起点日必须进入当前周期')
  assert(classifyLiveCycleTrade(trade('before-hour', '2026-07-27T05:30:00+08:00'), '2026-07-27', 6) === 'pre-cycle', '交易日起点前的时间戳必须归入前一交易日')
  assert(classifyLiveCycleTrade(trade('after-hour', '2026-07-27T06:30:00+08:00'), '2026-07-27', 6) === 'current', '交易日起点后的时间戳必须进入当前周期')
}

export function testLiveCyclePreviewDoesNotHideUnresolvedOrRewritePaper(): void {
  const trades = [
    trade('old', '2026-07-26'),
    trade('new', '2026-07-27'),
    trade('bad', 'not-a-date'),
    trade('paper', '2026-07-20', 'paper'),
  ]
  const preview = buildLiveCyclePreview(trades, '2026-07-27', 0)
  assert(preview.preCycle.map((item) => item.id).join() === 'old', '只应预览规则前实盘')
  assert(preview.current.map((item) => item.id).join() === 'new', '边界日实盘必须保留')
  assert(preview.unresolved.map((item) => item.id).join() === 'bad', '非法开仓日必须阻止静默归类')
  assert(filterTradesForLiveCycle(trades, 'current', '2026-07-27', 0).some((item) => item.id === 'bad'), '当前范围必须保守保留无法判断记录')
  assert(filterTradesForLiveCycle(trades, 'current', '2026-07-27', 0).some((item) => item.id === 'paper'), '混合分析不得误删模拟盘')
}

export function testLiveCycleSuggestsEarliestEffectivePolicy(): void {
  const policies = [
    { id: 'later', effectiveTradingDay: '2026-08-03' },
    { id: 'first', effectiveTradingDay: '2026-07-27' },
  ] as RiskPolicyVersion[]
  assert(suggestLiveCycleStartTradingDayKey(policies) === '2026-07-27', '必须建议最早有效规则日')
}
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveCycle.test.ts`

Expected: FAIL，错误包含 `Could not resolve "@/lib/liveCycle"`。

- [ ] **Step 3: 实现最小领域模型**

```ts
// src/lib/liveCycle.ts
import type { RiskPolicyVersion } from '@/data/riskManagement'
import type { Trade } from '@/data/trades'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'

export type LiveCycleScope = 'current' | 'pre-cycle' | 'all'
export type LiveCycleClassification = 'current' | 'pre-cycle' | 'unresolved' | 'not-live'

export interface LiveCyclePreview {
  current: Trade[]
  preCycle: Trade[]
  unresolved: Trade[]
}

export function isValidLiveCycleDayKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    formatYmd(parseLocalDate(value)) === value
}

export function openedTradingDayKey(trade: Pick<Trade, 'openedAt'>, tradingDayStartHour: number): string | null {
  if (isValidLiveCycleDayKey(trade.openedAt)) return trade.openedAt
  const timestamp = new Date(trade.openedAt)
  return Number.isNaN(timestamp.getTime()) ? null : getTradingDayKey(timestamp, tradingDayStartHour)
}

export function classifyLiveCycleTrade(
  trade: Pick<Trade, 'tradeKind' | 'openedAt'>,
  startTradingDayKey: string | null,
  tradingDayStartHour: number,
): LiveCycleClassification {
  if (trade.tradeKind !== 'live') return 'not-live'
  if (startTradingDayKey === null) return 'current'
  const opened = openedTradingDayKey(trade, tradingDayStartHour)
  if (opened === null) return 'unresolved'
  return opened < startTradingDayKey ? 'pre-cycle' : 'current'
}

export function filterTradesForLiveCycle(
  trades: readonly Trade[],
  scope: LiveCycleScope,
  startTradingDayKey: string | null,
  tradingDayStartHour: number,
): Trade[] {
  if (scope === 'all') return [...trades]
  return trades.filter((trade) => {
    const classification = classifyLiveCycleTrade(trade, startTradingDayKey, tradingDayStartHour)
    if (classification === 'not-live') return scope !== 'pre-cycle'
    if (scope === 'pre-cycle') return classification === 'pre-cycle'
    return classification === 'current' || classification === 'unresolved'
  })
}

export function buildLiveCyclePreview(
  trades: readonly Trade[],
  startTradingDayKey: string,
  tradingDayStartHour: number,
): LiveCyclePreview {
  const preview: LiveCyclePreview = { current: [], preCycle: [], unresolved: [] }
  for (const trade of trades) {
    if (trade.deletedAt || trade.tradeKind !== 'live') continue
    const classification = classifyLiveCycleTrade(trade, startTradingDayKey, tradingDayStartHour)
    if (classification === 'current') preview.current.push(trade)
    if (classification === 'pre-cycle') preview.preCycle.push(trade)
    if (classification === 'unresolved') preview.unresolved.push(trade)
  }
  return preview
}

export function suggestLiveCycleStartTradingDayKey(
  policies: readonly RiskPolicyVersion[],
): string | null {
  return policies
    .map((policy) => policy.effectiveTradingDay)
    .filter(isValidLiveCycleDayKey)
    .sort((left, right) => left.localeCompare(right))[0] ?? null
}
```

- [ ] **Step 4: 运行周期领域测试**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveCycle.test.ts`

Expected: 三个导出测试全部显示 `PASS`。

- [ ] **Step 5: 提交领域模型**

```powershell
git add -- src/lib/liveCycle.ts src/lib/liveCycle.test.ts
git commit -m "feat: add live cycle classification"
```

---

### Task 2: 持久化统计起点并保证导入恢复语义

**Files:**
- Modify: `src/storage/types.ts`
- Modify: `src/storage/persistedKeys.ts`
- Modify: `src/storage/emptySnapshot.ts`
- Modify: `src/storage/snapshotCodec.ts`
- Modify: `src/storage/snapshotValidation.ts`
- Modify: `src/storage/fixtures/fullPersistedSnapshot.ts`
- Modify: `src/storage/persist.ts`
- Modify: `src/storage/bootstrap.ts`
- Modify: `src/lib/importTypes.ts`
- Modify: `src/lib/importMerge.ts`
- Modify: `src/lib/importExport.ts`
- Modify: `src/store/useStore.ts`
- Test: `src/storage/snapshotCodec.test.ts`
- Test: `src/storage/snapshotValidation.test.ts`
- Test: `src/storage/migrateDefaults.test.ts`
- Test: `src/lib/importExportAssets.test.ts`

**Interfaces:**
- Consumes: `isValidLiveCycleDayKey()` from Task 1。
- Produces: Store 字段 `liveStatsStartTradingDayKey: string | null` 与动作 `setLiveStatsStartTradingDayKey(value)`。

- [ ] **Step 1: 增加失败的 codec、校验与合并导入测试**

```ts
// 追加到 src/storage/snapshotCodec.test.ts
export function testV9DefaultsMissingLiveCycleStartAndPreservesValidValue(): void {
  const fixture = createFullPersistedSnapshotFixture()
  const missing = { ...fixture } as Record<string, unknown>
  delete missing.liveStatsStartTradingDayKey
  assert(decodeCanonicalSnapshot(missing, { version: 9 }).liveStatsStartTradingDayKey === null, '缺失起点必须规范化为 null')
  assert(decodeCanonicalSnapshot({ ...fixture, liveStatsStartTradingDayKey: '2026-07-27' }, { version: 9 }).liveStatsStartTradingDayKey === '2026-07-27', '合法起点必须往返')
}

// 追加到 src/storage/snapshotValidation.test.ts
export function testSnapshotValidationRejectsMalformedLiveCycleStart(): void {
  for (const value of ['2026-02-30', '27-07-2026', 20260727]) {
    let rejected = false
    try { assertValidPersistedSnapshot({ ...valid, liveStatsStartTradingDayKey: value }) } catch { rejected = true }
    assert(rejected, `非法实盘统计起点 ${value} 必须拒绝`)
  }
}

// 追加到 src/lib/importExportAssets.test.ts
export function testMergeImportKeepsCurrentLibraryLiveCycleStart(): void {
  const current = createFullPersistedSnapshotFixture()
  current.liveStatsStartTradingDayKey = '2026-07-27'
  const imported = { ...createFullPersistedSnapshotFixture(), liveStatsStartTradingDayKey: '2026-06-01', version: 9 }
  const merged = mergeImportPayload(current, imported)
  assert(merged.liveStatsStartTradingDayKey === '2026-07-27', '普通合并导入不得改变当前资料库统计起点')
}
```

- [ ] **Step 2: 运行持久化定向测试并确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts src/lib/importExportAssets.test.ts`

Expected: FAIL，类型或断言指出 `liveStatsStartTradingDayKey` 尚未进入合同。

- [ ] **Step 3: 扩展 v9 快照合同与 codec**

```ts
// src/storage/types.ts，PersistedSnapshot 内
liveStatsStartTradingDayKey?: string | null

// src/storage/persistedKeys.ts，PERSISTED_SNAPSHOT_FIELDS 内 riskOverrideEvents 后
'liveStatsStartTradingDayKey',

// src/storage/emptySnapshot.ts 与 fullPersistedSnapshot.ts
liveStatsStartTradingDayKey: null,
// full fixture 使用非默认哨兵：
liveStatsStartTradingDayKey: '2026-07-13',

// src/storage/snapshotCodec.ts
function decodeLiveCycleStart(raw: Record<string, unknown>): string | null {
  const value = raw.liveStatsStartTradingDayKey
  if (value === undefined || value === null) return null
  if (isValidLiveCycleDayKey(value)) return value
  throw new Error('liveStatsStartTradingDayKey 必须是有效交易日或 null')
}

// candidate 与 normalized 都显式携带
liveStatsStartTradingDayKey: decodeLiveCycleStart(raw),
```

在 `assertValidPersistedSnapshot()` 中加入：字段存在且不为 `null` 时必须通过 `isValidLiveCycleDayKey()`。不要修改 `SCHEMA_VERSION = 9`，不要改动 Electron schema migration 文件。

- [ ] **Step 4: 接通 Store、保存、加载、导出和恢复**

```ts
// src/store/useStore.ts，State
liveStatsStartTradingDayKey: string | null
setLiveStatsStartTradingDayKey: (value: string | null) => void

// 初始状态与动作
liveStatsStartTradingDayKey: null,
setLiveStatsStartTradingDayKey: (value) => {
  if (value !== null && !isValidLiveCycleDayKey(value)) throw new Error('实盘统计起点必须是有效交易日')
  set({ liveStatsStartTradingDayKey: value, pendingTradeOpenRequest: null })
},

// src/lib/importMerge.ts，普通合并结果
liveStatsStartTradingDayKey: current.liveStatsStartTradingDayKey ?? null,
```

以下所有完整快照通道都按同名字段接线：

```ts
liveStatsStartTradingDayKey: state.liveStatsStartTradingDayKey ?? null,
```

接线位置必须包括 `pickPersisted()`、bootstrap hydrate、`applySnapshotToStore()`、`resetEmptyLibraryIntoStore()`、`rehydrateRiskGateFromStorage()`、`PersistedSlice`、`ExportPayload`、`PortableSnapshotState`、`buildPortableSnapshotFromState()`、`buildExportPayloadFromState()` 与 `buildExportPayload()`。完整恢复使用快照字段，普通 merge 只保留 current 字段。

- [ ] **Step 5: 运行合同测试与类型检查**

Run: `node scripts/run-regression-tests.mjs --unit-only src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts src/storage/migrateDefaults.test.ts src/lib/importExportAssets.test.ts`

Expected: 所有导出测试 `PASS`。

Run: `pnpm typecheck`

Expected: 两次 TypeScript 编译均以 exit code 0 完成。

- [ ] **Step 6: 提交持久化合同**

```powershell
git add -- src/storage src/lib/importTypes.ts src/lib/importMerge.ts src/lib/importExport.ts src/lib/importExportAssets.test.ts src/store/useStore.ts
git commit -m "feat: persist live statistics cycle start"
```

---

### Task 3: 将风险预算和开仓 Gate 切换到当前周期

**Files:**
- Modify: `src/lib/riskBudget.ts`
- Modify: `src/lib/riskBudget.test.ts`
- Modify: `src/lib/tradeOpenRiskGate.ts`
- Modify: `src/lib/tradeOpenRiskGate.test.ts`
- Modify: `src/lib/riskGatedTradeOpenCommit.ts`
- Modify: `src/lib/riskGatedTradeOpenCommit.test.ts`
- Modify: `src/store/riskGateIntegration.test.ts`
- Modify: `src/store/useStore.ts`
- Modify: `src/components/RiskBudgetCard.tsx`
- Modify: `src/components/RiskManagement.browser.test.tsx`

**Interfaces:**
- Consumes: `filterTradesForLiveCycle()`、Store 的统计起点和交易日起始小时。
- Produces: `ResolveRiskOutcomesInput.liveStatsStartTradingDayKey` 与包含周期设置的 Gate fingerprint。

- [ ] **Step 1: 写风险预算与 Gate 失败测试**

```ts
// 追加到 src/lib/riskBudget.test.ts
export function testRiskBudgetExcludesPreCycleTradeByOpenDay(): void {
  const input = fixture({ pnls: [-1_000, -1_000] })
  input.liveStatsStartTradingDayKey = '2026-07-27'
  input.tradingDayStartHour = 0
  input.trades[0] = {
    ...input.trades[0]!, openedAt: '2026-07-26', closedAt: '2026-07-27',
    closedTradingDayKey: '2026-07-27',
  }
  const result = resolveRiskOutcomes(input)
  assert(result.month.coverage === 'complete', '规则前交易不得制造当前周期未知覆盖')
  assert(result.month.netBudgetR === -1, '只应计入边界日开仓的当前周期交易')
  assert(result.month.includedTradeCount === 1, '规则前交易不得显示为当前周期未计入')
}

export function testRiskBudgetKeepsCurrentCycleUnknownFailClosed(): void {
  const input = fixture({ pnls: [-1_000] })
  input.liveStatsStartTradingDayKey = '2026-07-27'
  input.trades[0] = { ...input.trades[0]!, pnl: null, resultSource: 'r', rMultiple: -1 }
  const result = resolveRiskOutcomes(input)
  assert(result.gateCoverage === 'unknown', '当前周期缺失现金亏损必须继续 unknown')
}
```

在 `src/lib/tradeOpenRiskGate.test.ts` 增加一例：旧亏损开仓日在起点前时 `requestTradeOpenCandidate()` 返回 `opened/below`；同一亏损改为起点日开仓时返回 `confirmation-required/unknown`。

- [ ] **Step 2: 运行风险测试并确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.test.ts`

Expected: FAIL，旧交易仍进入月度候选或新输入字段尚未定义。

- [ ] **Step 3: 在风险聚合前过滤当前周期**

```ts
// src/lib/riskBudget.ts
export interface ResolveRiskOutcomesInput {
  trades: Trade[]
  policies: RiskPolicyVersion[]
  monthlyLimits: MonthlyRiskLimit[]
  currentTradingDayKey: string
  liveStatsStartTradingDayKey?: string | null
  tradingDayStartHour?: number
}

const currentCycleTrades = filterTradesForLiveCycle(
  input.trades,
  'current',
  input.liveStatsStartTradingDayKey ?? null,
  input.tradingDayStartHour ?? 0,
)
```

把 `calculateCanonicalOutcomes()` 中循环链的起点从 `input.trades` 精确替换为 `currentCycleTrades`，循环的 filter、sort 和正文不改。不要把规则前数量写入 `excludedTradeCount`；这个数字只描述当前周期候选中的数据完整度。

- [ ] **Step 4: 将起点加入 Gate 状态、结果引用与 fingerprint**

```ts
// src/lib/tradeOpenRiskGate.ts
export interface TradeOpenRiskGateState {
  trades: Trade[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  currentTradingDayKey: string
  liveStatsStartTradingDayKey: string | null
  tradingDayStartHour: number
}

export interface RiskGateFingerprintInput {
  trade: Trade
  currentTradingDayKey: string
  liveStatsStartTradingDayKey: string | null
  policy: RiskPolicyVersion | null
  monthlyLimit: MonthlyRiskLimit | null
  outcomes: Record<RiskPeriodScope, RiskPeriodOutcomeSnapshot>
  resultRefs: readonly unknown[]
}
```

`buildRiskGateFingerprint()` 的 canonical 对象增加 `liveStatsStartTradingDayKey: input.liveStatsStartTradingDayKey`，`createPendingRequest()` 与 `validatePendingFingerprint()` 的构造调用都传当前 state 值。

`createPendingRequest()` 调用 `resolveRiskOutcomes()` 时传入两字段；`riskResultRefs()` 先用 `filterTradesForLiveCycle(..., 'current', ...)` 再收集引用。`useStore.requestTradeOpen()` 和确认后的重校验都传 `s.liveStatsStartTradingDayKey` 与 `s.display.tradingDayStartHour`。`historicalMonthlyPolicyGapOnly` 分支保持原代码不变，使未设置起点的资料库继续兼容旧行为。

`riskGatedTradeOpenCommit.ts` 的 `RiskGateCommitState` 增加 `liveStatsStartTradingDayKey` 与 `display.tradingDayStartHour`，`stateMatchesSnapshot()` 同时比较这两个值，重建 `TradeOpenRiskGateState` 时显式传入。对应 commit 测试 fixture 使用 `snapshot.liveStatsStartTradingDayKey ?? null` 和 `snapshot.display.tradingDayStartHour`。

- [ ] **Step 5: RiskBudgetCard 传入统一口径并回归浏览器行为**

```tsx
const liveStatsStartTradingDayKey = useStore((state) => state.liveStatsStartTradingDayKey)
const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)

const outcomes = useMemo(() => resolveRiskOutcomes({
  trades,
  policies,
  monthlyLimits,
  currentTradingDayKey: tradingDay,
  liveStatsStartTradingDayKey,
  tradingDayStartHour,
}), [trades, policies, monthlyLimits, tradingDay, liveStatsStartTradingDayKey, tradingDayStartHour])
```

在 `RiskManagement.browser.test.tsx` 的 fixture 恢复块显式设置 `liveStatsStartTradingDayKey: null`，新增起点前亏损并设置起点后，断言预算卡不含“未计入 1 笔”和“覆盖未知”；再加入起点日未知亏损，断言“覆盖未知”恢复。

- [ ] **Step 6: 运行风险回归并提交**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.test.ts src/store/riskGateIntegration.test.ts`

Expected: 所有导出测试 `PASS`。

Run: `node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts`

Expected: `PASS src/components/RiskManagement.browser.test.html`，且浏览器测试总失败数为 0。

```powershell
git add -- src/lib/riskBudget.ts src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.ts src/lib/tradeOpenRiskGate.test.ts src/lib/riskGatedTradeOpenCommit.ts src/lib/riskGatedTradeOpenCommit.test.ts src/store/useStore.ts src/store/riskGateIntegration.test.ts src/components/RiskBudgetCard.tsx src/components/RiskManagement.browser.test.tsx
git commit -m "feat: scope risk controls to live cycle"
```

---

### Task 4: 统一工作台、仪表盘、策略与周复盘口径

**Files:**
- Modify: `src/views/TodayWorkspace.tsx`
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/components/StrategyHeader.tsx`
- Modify: `src/components/trades/TradeList.tsx`
- Modify: `src/views/settings/StrategiesPanel.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/lib/sidebarWorkspace.ts`
- Modify: `src/lib/workbenchTrades.ts`
- Modify: `src/regression.test.ts`
- Modify: `src/lib/analysisScope.ts`
- Modify: `src/lib/analysisScope.test.ts`
- Modify: `src/data/weeklyReviews.ts`
- Modify: `src/data/weeklyReviews.test.ts`
- Modify: `src/lib/weeklyReviewSnapshot.test.ts`
- Modify: `src/views/WeeklyReviewView.tsx`
- Modify: `src/views/DashboardScope.browser.test.tsx`

**Interfaces:**
- Consumes: `filterTradesForLiveCycle()` 与 Task 3 的周期化 `resolveRiskOutcomes()`。
- Produces: 所有日常统计默认只消费当前周期；已冻结周复盘保持原快照。

- [ ] **Step 1: 写分析与周复盘失败测试**

```ts
// 追加到 src/lib/analysisScope.test.ts
export function testLiveAnalysisUsesCurrentCycleButKeepsPaper(): void {
  const trades = [
    trade({ id: 'old-live', tradeKind: 'live', openedAt: '2026-07-20', closedAt: '2026-07-27' }),
    trade({ id: 'new-live', tradeKind: 'live', openedAt: '2026-07-27', closedAt: '2026-07-27' }),
    trade({ id: 'paper', tradeKind: 'paper', openedAt: '2026-07-20', closedAt: '2026-07-27' }),
  ]
  const live = filterTradesByAnalysisScope(trades, { kind: 'live', range: 'all' }, new Date('2026-07-28T12:00:00'), 0, '2026-07-27')
  const all = filterTradesByAnalysisScope(trades, { kind: 'all', range: 'all' }, new Date('2026-07-28T12:00:00'), 0, '2026-07-27')
  assert(live.map((item) => item.id).join() === 'new-live', '实盘分析必须使用当前周期')
  assert(all.map((item) => item.id).join() === 'new-live,paper', '混合分析必须保留模拟盘并排除规则前实盘')
}

// 追加到 src/data/weeklyReviews.test.ts
export function testWeeklyReviewExcludesPreCycleOpenTrades(): void {
  const trades = [trade('old', { openedAt: '2026-07-20', closedAt: '2026-07-28' }), trade('new', { openedAt: '2026-07-27', closedAt: '2026-07-28' })]
  const result = tradesClosedInWeek(trades, '2026-07-27', 0, '2026-07-27')
  assert(result.map((item) => item.id).join() === 'new', '跨起点旧仓不得进入新周事实')
}
```

- [ ] **Step 2: 运行定向测试并确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/analysisScope.test.ts src/data/weeklyReviews.test.ts src/lib/weeklyReviewSnapshot.test.ts`

Expected: FAIL，现有分析和周复盘仍包含规则前实盘。

- [ ] **Step 3: 在日常统计入口复用当前周期过滤**

```tsx
// TodayWorkspace.tsx
const liveStatsStartTradingDayKey = useStore((state) => state.liveStatsStartTradingDayKey)
const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
const currentCycleTrades = useMemo(
  () => filterTradesForLiveCycle(trades, 'current', liveStatsStartTradingDayKey, tradingDayStartHour),
  [trades, liveStatsStartTradingDayKey, tradingDayStartHour],
)
const buckets = useMemo(() => getTodayWorkflowBuckets(currentCycleTrades, today), [currentCycleTrades, today])
const todayMetrics = useMemo(() => buildTodayClosedMetrics(currentCycleTrades, today), [currentCycleTrades, today])
```

对 `TradeList` 策略预览、`StrategiesPanel` 和 `StrategyHeader` 先生成同样的 `currentCycleTrades`，再调用现有统计函数。不要修改 `buildDashboardStats()` 与 `computeStrategyStats()` 的纯聚合职责。

`Sidebar` 同样先生成 `currentCycleTrades` 再计算今日行动数；`SidebarCountContext` 和 `countWorkbenchVisibleTrades()` 增加 `liveStatsStartTradingDayKey`，侧栏实盘快捷入口默认使用 `current` 范围。`src/regression.test.ts` 增加旧/新两笔 fixture，断言交易日志和今日侧栏计数只包含新周期，模拟盘与案例计数不受影响。

- [ ] **Step 4: 扩展分析范围函数并接入 Dashboard**

```ts
export function filterTradesByAnalysisScope(
  trades: readonly Trade[],
  scope: AnalysisScope,
  now: Date | BusinessDateAnchor = new Date(),
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
  liveStatsStartTradingDayKey: string | null = null,
): Trade[] {
  const cycleScoped = filterTradesForLiveCycle(
    trades,
    'current',
    liveStatsStartTradingDayKey,
    tradingDayStartHour,
  )
  const scoped = cycleScoped.filter((trade) =>
    !trade.deletedAt &&
    isAccountTrade(trade) &&
    isExecutedClosed(trade.status) &&
    (scope.kind === 'all' || trade.tradeKind === scope.kind),
  )
  if (scope.range === 'all') return scoped
}
```

上述代码替换原函数开头到 `if (scope.range === 'all') return scoped`；其后的 BusinessDateAnchor 与日期范围分支保持原代码不变。

`Dashboard`、`StrategyHeader` 的所有调用都传 Store 起点；Dashboard 的 `activeTrades` 与 `missedTradesInWeek` 也使用相同口径。`DashboardScope.browser.test.tsx` 增加旧/新实盘 fixture，断言默认实盘统计只出现新交易。

- [ ] **Step 5: 周复盘只冻结当前周期事实**

```ts
// src/data/weeklyReviews.ts
export interface CompleteWeeklyReviewState {
  trades: Trade[]
  weeklyReviews: WeeklyReview[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  riskOverrideEvents: RiskOverrideEvent[]
  liveStatsStartTradingDayKey: string | null
  display: { tradingDayStartHour: number }
}

export function tradesClosedInWeek(
  trades: Trade[], weekStart: string, tradingDayStartHour = 0,
  liveStatsStartTradingDayKey: string | null = null,
): Trade[] {
  const current = filterTradesForLiveCycle(trades, 'current', liveStatsStartTradingDayKey, tradingDayStartHour)
  const weekEnd = weekEndFor(weekStart)
  return current.filter((trade) => {
    if (trade.deletedAt || trade.tradeKind !== 'live' || !isExecutedClosed(trade.status)) return false
    const date = closedTradingDayKey(trade, tradingDayStartHour)
    return date !== null && date >= weekStart && date <= weekEnd
  })
}
```

`missedTradesInWeek()` 增加相同参数。`completeWeeklyReviewCandidate()`、`buildWeeklyRiskReviewSnapshot()` 和未冻结 `WeeklyReviewView` 均传起点；风险快照内 override event 还需满足 `event.tradingDayKeyAtDecision >= liveStatsStartTradingDayKey`。已完成且已有 `metricsSnapshot` / `riskSnapshot` 的渲染路径保持原样。

首个跨起点周在 `WeeklyReviewView` 标题说明后追加：

```tsx
{liveStatsStartTradingDayKey && selectedWeek < liveStatsStartTradingDayKey && weekEndFor(selectedWeek) >= liveStatsStartTradingDayKey
  ? ` · 当前周期自 ${liveStatsStartTradingDayKey} 开始`
  : null}
```

- [ ] **Step 6: 运行统计与复盘回归并提交**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/analysisScope.test.ts src/data/weeklyReviews.test.ts src/lib/weeklyReviewSnapshot.test.ts`

Expected: 所有导出测试 `PASS`。

```powershell
git add -- src/views/TodayWorkspace.tsx src/views/Dashboard.tsx src/components/StrategyHeader.tsx src/components/trades/TradeList.tsx src/views/settings/StrategiesPanel.tsx src/components/Sidebar.tsx src/lib/sidebarWorkspace.ts src/lib/workbenchTrades.ts src/regression.test.ts src/lib/analysisScope.ts src/lib/analysisScope.test.ts src/data/weeklyReviews.ts src/data/weeklyReviews.test.ts src/lib/weeklyReviewSnapshot.test.ts src/views/WeeklyReviewView.tsx src/views/DashboardScope.browser.test.tsx
git commit -m "feat: align live analytics with current cycle"
```

---

### Task 5: 增加无损设置、影响预览与风险卡引导

**Files:**
- Create: `src/components/LiveCycleSettings.tsx`
- Create: `src/components/LiveCycleSettings.css`
- Create: `src/components/LiveCycleSettings.browser.test.tsx`
- Create: `src/components/LiveCycleSettings.browser.test.html`
- Modify: `scripts/qa-risk-management-mobile.mjs`
- Modify: `src/components/RiskBudgetCard.tsx`
- Modify: `src/components/RiskBudgetCard.css`
- Modify: `src/views/settings/DataSettingsPanel.tsx`

**Interfaces:**
- Consumes: `buildLiveCyclePreview()`、`suggestLiveCycleStartTradingDayKey()`、Store 设置动作。
- Produces: `LiveCycleSettings({ variant, currentTradingDayKey })`，供风险卡与数据设置复用。

- [ ] **Step 1: 写真实设置流程失败测试**

```tsx
// src/components/LiveCycleSettings.browser.test.tsx 的核心断言
useStore.setState((state) => ({
  trades: [oldLiveTrade, currentLiveTrade],
  riskPolicyVersions: [policyEffectiveOn20260727],
  liveStatsStartTradingDayKey: null,
  display: { ...state.display, tradingDayStartHour: 0 },
}))

root.render(<LiveCycleSettings variant="settings" currentTradingDayKey="2026-07-28" />)
click('建立实盘统计起点')
await waitFor(() => document.body.textContent?.includes('规则前实盘 1 笔') ?? false, '预览未显示规则前数量')
assert(document.body.textContent?.includes('当前周期 1 笔'), '预览必须显示当前周期数量')
click('确认建立新周期')
await waitFor(() => useStore.getState().liveStatsStartTradingDayKey === '2026-07-27', '起点未保存')
assert(useStore.getState().trades.every((trade) => trade.tradeKind === 'live'), '设置不得改写交易类型')
click('清除统计起点')
assert(useStore.getState().liveStatsStartTradingDayKey === null, '清除必须恢复全历史口径')
```

HTML 入口设置 `window.__liveCycleSettingsBrowserTest`，加载 tokens、global CSS 与测试模块，匹配现有浏览器发现约定。查询参数 `?visual=dialog` 时保持预览弹窗打开，供移动端 QA 截取真实布局。

- [ ] **Step 2: 运行浏览器测试并确认失败**

Run: `node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts`

Expected: FAIL，浏览器构建找不到 `LiveCycleSettings`。

- [ ] **Step 3: 实现复用设置组件**

```tsx
export function LiveCycleSettings({
  variant,
  currentTradingDayKey,
}: {
  variant: 'prompt' | 'settings'
  currentTradingDayKey: string
}) {
  const trades = useStore((state) => state.trades)
  const policies = useStore((state) => state.riskPolicyVersions)
  const currentStart = useStore((state) => state.liveStatsStartTradingDayKey)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const saveStart = useStore((state) => state.setLiveStatsStartTradingDayKey)
  const suggested = suggestLiveCycleStartTradingDayKey(policies)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(currentStart ?? suggested ?? currentTradingDayKey)
  const preview = useMemo(
    () => isValidLiveCycleDayKey(draft)
      ? buildLiveCyclePreview(trades, draft, tradingDayStartHour)
      : { current: [], preCycle: [], unresolved: [] },
    [draft, trades, tradingDayStartHour],
  )
  const promptEligible = currentStart === null && suggested !== null && preview.preCycle.length > 0
  if (variant === 'prompt' && !promptEligible) return null

  const commitStart = async (next: string | null, successMessage: string) => {
    const previous = useStore.getState().liveStatsStartTradingDayKey
    setBusy(true)
    saveStart(next)
    try {
      await flushPersistNow()
      setOpen(false)
      toast(successMessage)
    } catch {
      saveStart(previous)
      await flushPersistNow().catch(() => undefined)
      toast('统计起点保存失败，原设置已保留')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!isValidLiveCycleDayKey(draft) || draft > currentTradingDayKey || preview.unresolved.length > 0) return
    await commitStart(draft, `当前实盘周期已从 ${draft} 开始`)
  }

  // settings 变体渲染当前值、修改/建立与清除按钮；prompt 变体渲染中性引导。
  // ModalShell 内使用 DatePicker、三项数量、逐笔 ref/symbol/openedAt 列表和无法判断警告。
}
```

按钮文案固定为“建立实盘统计起点”“修改统计起点”“清除统计起点”“确认建立新周期”。确认按钮在未来日期、`unresolved.length > 0` 或 `busy` 时禁用。每次打开弹窗时把 draft 重置为当前值、建议值或当前交易日。清除前使用紧凑确认态，并调用 `commitStart(null, '已恢复全部实盘统计')`；保存失败必须回滚旧值并保留旧统计。

- [ ] **Step 4: 接入风险卡与数据设置**

```tsx
// RiskBudgetCard.tsx，卡片 footer 后
<LiveCycleSettings variant="prompt" currentTradingDayKey={tradingDay} />

// DataSettingsPanel.tsx，DataIOContent 后、存储健康前
<LiveCycleSettings variant="settings" currentTradingDayKey={currentTradingDayKey} />
```

`DataSettingsPanel` 使用 `useLocalDateKey()` 获得当前交易日。CSS 沿用现有 `--bg-surface`、`--border-subtle`、`--text-*` 与 `--accent-*` token；不使用大面积警告红色。420px 下数量卡改为单列，Modal footer 保持可见。

- [ ] **Step 5: 风险周期标题显示截断起点**

```tsx
function scopedRiskLabel(
  scope: RiskPeriodScope,
  label: string,
  start: string | null,
  current: string,
): string {
  if (!start || start > current) return label
  const periodStart = scope === 'day'
    ? current
    : scope === 'week'
      ? weekStartFor(parseLocalDate(current))
      : `${current.slice(0, 7)}-01`
  return start > periodStart ? `${label} · 自${Number(start.slice(5, 7))}月${Number(start.slice(8, 10))}日起` : label
}
```

`RiskMeter` 接收该 label；限额仍显示完整规则值，不做按天折算。

- [ ] **Step 6: 运行浏览器、移动端与类型检查并提交**

Run: `node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts`

Expected: `PASS src/components/LiveCycleSettings.browser.test.html` 且总失败数为 0。

Run: `pnpm qa:risk-management-mobile`

Expected: 输出风险准备卡、预算卡、开仓 Gate 和实盘新周期预览在 420×844 下无横向溢出、footer 完整可见，exit code 0。

Run: `pnpm typecheck`

Expected: exit code 0。

```powershell
git add -- src/components/LiveCycleSettings.tsx src/components/LiveCycleSettings.css src/components/LiveCycleSettings.browser.test.tsx src/components/LiveCycleSettings.browser.test.html src/components/RiskBudgetCard.tsx src/components/RiskBudgetCard.css src/views/settings/DataSettingsPanel.tsx scripts/qa-risk-management-mobile.mjs
git commit -m "feat: add live cycle setup flow"
```

---

### Task 6: 增加当前周期、规则前与全部实盘历史筛选

**Files:**
- Modify: `src/lib/liveCycle.ts`
- Modify: `src/lib/liveCycle.test.ts`
- Modify: `src/lib/workbenchTrades.ts`
- Modify: `src/hooks/useWorkbenchVisibleTrades.ts`
- Modify: `src/components/trades/TradeFilters.tsx`
- Modify: `src/components/StrategyHeader.tsx`
- Modify: `src/lib/savedTradeViews.ts`
- Modify: `src/components/trades/TradeRow.tsx`
- Modify: `src/components/trades/TradeList.css`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/views/DetailView.css`
- Create: `src/views/LiveCycleHistory.browser.test.tsx`
- Create: `src/views/LiveCycleHistory.browser.test.html`

**Interfaces:**
- Consumes: `LiveCycleScope` 与周期分类函数。
- Produces: URL 参数 `liveCycle=pre-cycle|all`；参数缺失表示 `current`。

- [ ] **Step 1: 写 URL 范围与列表失败测试**

```ts
// 追加到 src/lib/liveCycle.test.ts
export function testLiveCycleScopeParsingIsStable(): void {
  assert(parseLiveCycleScope('') === 'current', '缺省必须是当前周期')
  assert(parseLiveCycleScope('?liveCycle=pre-cycle') === 'pre-cycle', '必须识别规则前范围')
  assert(parseLiveCycleScope('?liveCycle=all') === 'all', '必须识别全部实盘范围')
  assert(parseLiveCycleScope('?liveCycle=broken') === 'current', '非法值必须回退当前周期')
}
```

`LiveCycleHistory.browser.test.tsx` 使用 MemoryRouter 与 `useWorkbenchVisibleTrades({ type: 'all', tradeKind: 'live' })`：默认只渲染新交易；导航到 `?liveCycle=pre-cycle` 只渲染旧交易；导航到 `?liveCycle=all` 渲染两笔。再渲染旧交易的 `TradeRow`，断言出现“规则前”。

- [ ] **Step 2: 运行单元与浏览器测试并确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveCycle.test.ts`

Expected: FAIL，`parseLiveCycleScope` 尚不存在。

Run: `node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts`

Expected: FAIL，历史范围尚未过滤。

- [ ] **Step 3: 接入工作台可见交易派生**

```ts
// src/lib/liveCycle.ts
export function parseLiveCycleScope(input: string | URLSearchParams): LiveCycleScope {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input
  const value = params.get('liveCycle')
  return value === 'pre-cycle' || value === 'all' ? value : 'current'
}

// deriveWorkbenchVisibleTrades options 新增
liveStatsStartTradingDayKey: string | null

// routeFiltered 后
const cycleFiltered = filterTradesForLiveCycle(
  routeFiltered,
  parseLiveCycleScope(options.search),
  options.liveStatsStartTradingDayKey,
  tradingDayStartHour,
)
```

后续 analysis、display 与 facet 都使用 `cycleFiltered`。`countWorkbenchVisibleTrades()` 使用同样的 scope，保证列表与侧栏计数一致。当 `filter.tradeKind` 是 `paper` 或 `case` 时强制使用 `all`，并在 `TradeFilters` canonicalize effect 中删除残留 `liveCycle` 参数，避免实盘周期参数误删非实盘工作区。`useWorkbenchVisibleTrades` 订阅 Store 起点、传入派生函数，并把它加入 memo 依赖。

`StrategyHeader` 从 `search` 解析同一个 `liveCycle`，先按该 scope 调用 `filterTradesForLiveCycle()`，再把结果交给 `filterTradesByAnalysisScope(cycleFiltered, analysisScope, businessDateAnchor, tradingDayStartHour, null)`；这样策略标题指标与列表在“规则前 / 全部实盘”下不会分叉。Dashboard 不提供该历史参数，继续固定使用当前周期。

- [ ] **Step 4: 增加筛选器与保存视图合同**

```tsx
// TradeFilters.tsx，实盘或包含实盘的工作区显示
<FilterSelect
  label="实盘周期"
  value={searchParams.get('liveCycle') ?? ''}
  onChange={(value) => setParam('liveCycle', value)}
  options={[
    ['', '当前周期'],
    ['pre-cycle', '规则前'],
    ['all', '全部实盘'],
  ]}
/>
```

把 `liveCycle` 加入 `KNOWN_TRADE_VIEW_PARAMS` 与 `savedTradeViews.ts` 的枚举合同：

```ts
const LIVE_CYCLE_LABELS: Record<string, string> = {
  'pre-cycle': '规则前',
  all: '全部实盘',
}

// ENUM_FACET_VALUES
liveCycle: Object.keys(LIVE_CYCLE_LABELS),
```

显式范围加入 active filter；重置筛选删除该参数并回到当前周期。保存视图名称建议包含对应中文标签。

- [ ] **Step 5: 在列表与详情显示中性派生标签**

```tsx
// TradeRow.tsx
const liveStatsStartTradingDayKey = useStore((state) => state.liveStatsStartTradingDayKey)
const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
const isPreCycle = classifyLiveCycleTrade(
  trade,
  liveStatsStartTradingDayKey,
  tradingDayStartHour,
) === 'pre-cycle'

{isPreCycle ? <span className="trade-row-tag is-pre-cycle">规则前</span> : null}
```

`DetailView` 使用相同判断，在 `trade.ref` 后渲染 `<span className="dv-cycle-badge">规则前</span>`。样式只使用中性色 `--text-tertiary`、`--bg-inset`、`--border-subtle`，不得使用错误红或警告橙。

- [ ] **Step 6: 运行历史范围回归并提交**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveCycle.test.ts`

Expected: 所有导出测试 `PASS`。

Run: `node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts`

Expected: `PASS src/views/LiveCycleHistory.browser.test.html` 且总失败数为 0。

```powershell
git add -- src/lib/liveCycle.ts src/lib/liveCycle.test.ts src/lib/workbenchTrades.ts src/hooks/useWorkbenchVisibleTrades.ts src/components/trades/TradeFilters.tsx src/components/StrategyHeader.tsx src/lib/savedTradeViews.ts src/components/trades/TradeRow.tsx src/components/trades/TradeList.css src/views/DetailView.tsx src/views/DetailView.css src/views/LiveCycleHistory.browser.test.tsx src/views/LiveCycleHistory.browser.test.html
git commit -m "feat: expose live cycle history scopes"
```

---

### Task 7: 全量回归、Windows 打包与规格收尾

**Files:**
- Modify: `docs/superpowers/specs/2026-07-28-live-cycle-start-design.md`

**Interfaces:**
- Consumes: Tasks 1–6 的全部提交。
- Produces: 通过验证的 Windows 安装包与已实施规格状态。

- [ ] **Step 1: 检查差异边界和 UTF-8**

Run: `git status --short; git diff --check; git diff --name-only HEAD~6..HEAD`

Expected: 没有空白错误；改动仅落在本计划列出的代码、测试与文档文件。

Run:

```powershell
$files = git diff --name-only HEAD~6..HEAD | Where-Object { Test-Path -LiteralPath $_ }
foreach ($file in $files) {
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $file))
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    throw "UTF-8 BOM detected: $file"
  }
}
```

Expected: 无输出、exit code 0。

- [ ] **Step 2: 运行完整测试与生产构建**

Run: `pnpm test`

Expected: 单元、浏览器、治理与移动端风险 QA 全部 PASS，无 skip/todo。

Run: `pnpm build`

Expected: TypeScript、Vite production build 与 bundle budget 全部通过。

- [ ] **Step 3: 构建 Windows 安装包**

先用只读检查确认没有运行中的 `release\win-unpacked\Trader Atlas.exe`；若存在，只停止路径精确匹配该 unpacked 目录的进程，再运行：

Run: `pnpm dist:win`

Expected: electron-builder 生成 `release/Trader-Atlas-1.2.60-win-x64.exe` 与 `release/latest.yml`，exit code 0。

Run:

```powershell
$installer = Resolve-Path -LiteralPath 'release\Trader-Atlas-1.2.60-win-x64.exe'
Get-Item -LiteralPath $installer | Select-Object FullName, Length, LastWriteTime
Get-FileHash -LiteralPath $installer -Algorithm SHA256
```

Expected: 安装包存在、大小大于 100 MB，并输出 SHA-256。

- [ ] **Step 4: 人工验收当前资料库但不旁路改库**

在新构建客户端中打开“设置 → 数据 → 实盘统计起点”，选择 `2026-07-27`，确认预览为：

```text
规则前实盘 16 笔
当前周期 1 笔
无法判断 0 笔
```

确认前检查所有交易仍为实盘；确认后检查风险卡不再显示“覆盖未知”，历史筛选分别显示 1 / 16 / 17 笔。该动作必须通过产品 UI 完成，不直接修改 SQLite、JSON 或 Store 调试接口。

- [ ] **Step 5: 标记规格已实施并提交**

```markdown
> 状态：已实施并验证
```

Run:

```powershell
git add -- docs/superpowers/specs/2026-07-28-live-cycle-start-design.md
git commit -m "docs: mark live cycle implementation verified"
git status --short --branch
```

Expected: 提交成功，工作区干净。

---

## Final Acceptance Checklist

- [ ] 设置前预览准确显示 16 / 1 / 0，且不修改任何交易。
- [ ] 设置后风险卡、Gate、今日工作台、仪表盘、策略指标和新周复盘口径一致。
- [ ] 当前周期的未知亏损仍触发确认，规则前缺口不再影响当前风险。
- [ ] 历史页默认当前周期，可切换规则前和全部实盘；详情保留真实类型并显示中性标签。
- [ ] 清除起点后恢复全历史统计与原有覆盖状态。
- [ ] 普通合并导入不改变当前起点，完整恢复正确采用备份起点。
- [ ] 已冻结周复盘内容与指标没有被重算。
- [ ] `pnpm test`、`pnpm build`、`pnpm dist:win` 全部通过。
