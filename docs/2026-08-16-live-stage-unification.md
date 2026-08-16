# Live Stage Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用唯一的“实盘阶段”统一交易归档、绩效和常规风险边界，并让阶段只能在交易周周一生效，同时完整保留历史交易与周复盘。

**Architecture:** 保留 `livePerformanceCycles` 作为 v11/v12 持久化兼容键，但在领域层将其提升为 `LiveStage`，新增预约阶段、显式风险覆盖和稳定的交易/周复盘阶段归属。先建立纯函数与迁移合同，再让 Zustand 通过单次状态事务完成预约激活，最后将交易日志、历史实盘、周复盘、仪表盘和风险界面切换到统一阶段解析器。

**Tech Stack:** TypeScript 5.6、React 18、Zustand 4、React Router 6、Vite 8、Electron 43、SQL.js、Playwright、自定义 Node/Vite 回归测试框架。

## Global Constraints

- 所有新增与修改文件必须使用 UTF-8 无 BOM，完整保留简体中文。
- 仅适配 Windows 与 macOS 桌面客户端；不新增手机、iPad、浏览器或其他平台适配分支。
- 实盘阶段只能在交易周周一生效，并服从 `display.tradingDayStartHour` 的交易日边界。
- 周一已有实盘活动或处于周二至周日时，只能预约下一个周一；不允许周中或追溯开启。
- 交易、案例、图片、评论、复盘正文和已完成周复盘快照不得因阶段切换被删除或复制。
- 实盘记录一旦获得阶段 ID，普通状态、平仓和日期编辑不得静默改变归属。
- 风险起点默认跟随当前阶段；单独风险起点只能作为有原因和时间戳的高级修复覆盖。
- 每个任务采用测试先行、最小实现、定向回归和独立提交。

---

## File Structure

- `src/lib/liveStages.ts`：阶段类型、周一合法性、预约、激活、范围解析与风险起点解析。
- `src/lib/liveStageMembership.ts`：交易和周复盘的稳定阶段归属、旧数据推导与待整理判断。
- `src/lib/liveStageMigration.ts`：v11 周期/风险起点/历史记录到 v12 阶段语义的幂等迁移。
- `src/lib/livePerformanceCycles.ts`：保留旧导出名称与查询兼容，内部委托阶段域。
- `src/lib/liveStatisticsArchive.ts`：按稳定阶段 ID生成当前、指定历史阶段、全部历史与待整理投影。
- `src/store/useStore.ts`：预约、取消、激活、风险修复以及新交易阶段赋值的唯一写入口。
- `src/storage/*`、`electron/library/schemaMigration.ts`：v12 快照、导入导出和 Electron 资料库迁移合同。
- `src/components/LivePerformanceCycleManager.tsx`：改造成“开启新实盘阶段”预约/立即生效确认流程。
- `src/components/LiveStageRepairDialog.tsx`：待整理记录的阶段校正和跨阶段计划处置预览。
- `src/components/LiveCycleSettings.tsx`：从普通设置退场，改为高级风险起点修复组件。
- `src/views/LiveArchiveView.tsx`、`src/views/ListView.tsx`、`src/views/Dashboard.tsx`：消费统一阶段范围。
- `src/data/weeklyReviews.ts`、`src/views/WeeklyReviewView.tsx`：周复盘阶段归属、标签与趋势筛选。

---

### Task 1: 建立实盘阶段纯领域模型

**Files:**
- Create: `src/lib/liveStages.ts`
- Create: `src/lib/liveStages.test.ts`
- Modify: `src/lib/livePerformanceCycles.ts`
- Test: `src/lib/livePerformanceCycles.test.ts`

**Interfaces:**
- Produces: `LiveStage`、`LiveStageRiskSnapshot`、`LiveStageBounds`、`ScheduledLiveStage`、`RiskAccountingOverride`。
- Produces: `tradingWeekStartFor(dayKey: string): string`。
- Produces: `resolveLiveStageStartMode(input: { currentTradingDayKey: string; currentWeekHasLiveActivity: boolean }): { kind: 'immediate' | 'schedule'; startTradingDayKey: string }`。
- Produces: `scheduleLiveStage(stages: readonly LiveStage[], scheduled: ScheduledLiveStage | null, input: ScheduledLiveStage): ScheduledLiveStage`。
- Produces: `activateScheduledLiveStage(stages: readonly LiveStage[], scheduled: ScheduledLiveStage, currentTradingDayKey: string, activatedAt: string): LiveStage[]`。
- Produces: `closeCurrentLiveStageWithRiskSnapshot(stages: readonly LiveStage[], snapshot: LiveStageRiskSnapshot): LiveStage[]`。
- Produces: `resolveStageBounds(stages: readonly LiveStage[], stageId: string): LiveStageBounds | null` 与 `resolveRiskAccountingStart(stages: readonly LiveStage[], override: RiskAccountingOverride | null): string | null`。
- Preserves: `LivePerformanceCycle` 作为 `LiveStage` 的 deprecated 类型别名，避免一次性破坏现有查询调用方。

- [ ] **Step 1: 写失败的周边界与预约测试**

```ts
function stage(id: string, startTradingDayKey: string): LiveStage {
  return {
    id,
    name: id,
    startTradingDayKey,
    createdAt: `${startTradingDayKey}T00:00:00.000Z`,
    activatedAt: `${startTradingDayKey}T00:00:00.000Z`,
  }
}

function scheduledStage(id: string, startTradingDayKey: string): ScheduledLiveStage {
  return { id, name: id, startTradingDayKey, createdAt: '2026-08-16T00:00:00.000Z' }
}

export function testLiveStageCanOnlyStartOnTheTradingWeekBoundary(): void {
  assert(tradingWeekStartFor('2026-08-16') === '2026-08-10', '周日必须归属本周周一')
  assert(tradingWeekStartFor('2026-08-17') === '2026-08-17', '周一必须保持自身')
  assert(
    resolveLiveStageStartMode({
      currentTradingDayKey: '2026-08-17',
      currentWeekHasLiveActivity: false,
    }).kind === 'immediate',
    '周一且无活动必须允许立即开启',
  )
  const scheduled = resolveLiveStageStartMode({
    currentTradingDayKey: '2026-08-19',
    currentWeekHasLiveActivity: false,
  })
  assert(scheduled.kind === 'schedule' && scheduled.startTradingDayKey === '2026-08-24', '周中只能预约下周一')
}

export function testLiveStageActivationIsAppendOnlyAndIdempotent(): void {
  const stages = [stage('old', '2026-08-10')]
  const scheduled = scheduledStage('next', '2026-08-17')
  const once = activateScheduledLiveStage(stages, scheduled, '2026-08-17', '2026-08-17T06:00:00.000Z')
  const twice = activateScheduledLiveStage(once, scheduled, '2026-08-17', '2026-08-17T06:00:00.000Z')
  assert(once.map((item) => item.id).join() === 'old,next', '激活必须追加而非覆盖旧阶段')
  assert(twice.map((item) => item.id).join() === 'old,next', '重复补激活不得生成双边界')
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveStages.test.ts src/lib/livePerformanceCycles.test.ts`

Expected: FAIL，提示 `@/lib/liveStages` 不存在或导出缺失。

- [ ] **Step 3: 实现最小阶段类型与纯函数**

```ts
export type LiveStage = {
  id: string
  name: string
  startTradingDayKey: string
  createdAt: string
  /** v11 兼容读取时可缺失；v12 迁移后和所有新阶段必须存在。 */
  activatedAt?: string
  riskSnapshot?: LiveStageRiskSnapshot
}

export type LiveStageRiskSnapshot = {
  capturedAt: string
  weeklyRiskPreparations: WeeklyRiskPreparation[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  riskOverrideEvents: RiskOverrideEvent[]
}

export type LiveStageBounds = {
  startInclusive: string | null
  endExclusive: string | null
}

export type ScheduledLiveStage = {
  id: string
  name: string
  startTradingDayKey: string
  createdAt: string
}

export type RiskAccountingOverride = {
  startTradingDayKey: string
  reason: string
  createdAt: string
}

export function tradingWeekStartFor(dayKey: string): string {
  if (!isValidLiveCycleDayKey(dayKey)) throw new Error('交易日无效')
  return weekStartFor(parseLocalDate(dayKey))
}

export function resolveRiskAccountingStart(
  stages: readonly LiveStage[],
  override: RiskAccountingOverride | null,
): string | null {
  return override?.startTradingDayKey ?? stages.at(-1)?.startTradingDayKey ?? null
}
```

实现时复用 `weekStartFor`、`parseLocalDate`、`isValidLiveCycleDayKey` 和现有 ISO 时间戳校验；不得复制日期算法。

- [ ] **Step 4: 将旧周期查询委托给阶段域**

在 `src/lib/livePerformanceCycles.ts` 中保留旧函数签名和路由保留 ID，改用：

```ts
/** @deprecated 仅供 v11 路由与序列化兼容。 */
export type LivePerformanceCycle = LiveStage
```

`appendLivePerformanceCycle` 必须继续追加。`createLiveStatisticsResetEpoch` 在本任务中暂时保留原签名并标记 deprecated，保证尚未改造的 store 仍可编译；Task 4 替换最后一个调用方后再删除该函数及其“覆盖为单边界”测试。

- [ ] **Step 5: 运行定向测试确认通过**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveStages.test.ts src/lib/livePerformanceCycles.test.ts src/lib/livePerformanceCycleRoute.test.ts`

Expected: PASS，旧路由 ID 和阶段范围测试仍通过。

- [ ] **Step 6: 提交阶段领域模型**

```bash
git add src/lib/liveStages.ts src/lib/liveStages.test.ts src/lib/livePerformanceCycles.ts src/lib/livePerformanceCycles.test.ts
git commit -m "feat(live-stage): add weekly stage domain"
```

---

### Task 2: 固化交易与周复盘的阶段归属

**Files:**
- Create: `src/lib/liveStageMembership.ts`
- Create: `src/lib/liveStageMembership.test.ts`
- Modify: `src/data/trades.ts`
- Modify: `src/data/weeklyReviews.ts`
- Modify: `src/lib/liveStatisticsArchive.ts`
- Test: `src/lib/liveStatisticsArchive.test.ts`
- Test: `src/data/weeklyReviews.test.ts`

**Interfaces:**
- Consumes: `LiveStage` 与 `resolveStageBounds`。
- Produces: `Trade.liveStageId?: string`、`Trade.liveStagePlanDisposition?: 'archive'`、`WeeklyReview.liveStageId?: string`。
- Produces: `resolveStageIdForTradingDay(stages, dayKey): string | null`。
- Produces: `inferTradeLiveStageId(trade, stages, tradingDayStartHour): string | null`，运行时只接受可靠开仓日。
- Produces: `inferMigrationTradeLiveStageId(trade, stages, tradingDayStartHour): string | null`，仅迁移时允许可靠业务日期回退。
- Produces: `resolveTradeLiveStageId(trade, stages, tradingDayStartHour): string | null`，显式 ID 优先。
- Produces: `assignWeeklyReviewStageId(review, stages): WeeklyReview`。

- [ ] **Step 1: 写失败的稳定归属测试**

```ts
function stage(id: string, startTradingDayKey: string): LiveStage {
  return { id, name: id, startTradingDayKey, createdAt: `${startTradingDayKey}T00:00:00.000Z` }
}

function trade(patch: Partial<Trade>): Trade {
  return {
    id: 'membership-trade', ref: 'TRD-MEMBERSHIP', symbol: 'EURUSD', side: 'long',
    status: 'open', conviction: 'medium', strategyId: 'strategy-1', tradeKind: 'live',
    tags: [], mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal',
    entry: 1, exit: null, size: 1, pnl: null, rMultiple: null,
    openedAt: '2026-08-14T10:00:00.000Z', closedAt: null, note: '',
    ...patch,
  }
}

export function testOpenedTradeNeverJumpsStageAfterClosing(): void {
  const stages = [stage('old', '2026-08-10'), stage('current', '2026-08-17')]
  const openedBeforeReset = trade({
    status: 'open',
    openedAt: '2026-08-14T10:00:00.000Z',
    liveStageId: 'old',
  })
  const closedAfterReset = {
    ...openedBeforeReset,
    status: 'win' as const,
    closedAt: '2026-08-18T10:00:00.000Z',
    closedTradingDayKey: '2026-08-18',
  }
  assert(resolveTradeLiveStageId(openedBeforeReset, stages, 0) === 'old', '持仓必须属于旧阶段')
  assert(resolveTradeLiveStageId(closedAfterReset, stages, 0) === 'old', '平仓后不得跳到新阶段')
}

export function testWeeklyReviewBelongsToItsMondayStage(): void {
  const stages = [stage('old', '2026-08-10'), stage('current', '2026-08-17')]
  const review = assignWeeklyReviewStageId(createWeeklyReview('2026-08-17'), stages)
  assert(review.liveStageId === 'current', '周复盘必须按周一起点归属阶段')
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveStageMembership.test.ts src/lib/liveStatisticsArchive.test.ts src/data/weeklyReviews.test.ts`

Expected: FAIL，提示 `liveStageId` 和成员解析器缺失。

- [ ] **Step 3: 实现阶段成员解析器**

```ts
export function resolveTradeLiveStageId(
  trade: Trade,
  stages: readonly LiveStage[],
  tradingDayStartHour: number,
): string | null {
  if (trade.tradeKind !== 'live' || trade.deletedAt) return null
  if (trade.liveStageId) {
    return stages.some((stage) => stage.id === trade.liveStageId) ? trade.liveStageId : null
  }
  return inferTradeLiveStageId(trade, stages, tradingDayStartHour)
}
```

运行时推导只用于尚未迁移的旧数据：优先使用 `openedTradingDayKey`；无法取得可靠开仓日时返回 `null`，不得回退到重置后的平仓日改变阶段。`inferMigrationTradeLiveStageId` 是独立迁移入口，只有它可以按设计文档使用可靠业务日期回退，并把推导结果写成稳定 ID。

- [ ] **Step 4: 改造归档投影使用稳定阶段 ID**

`resolveLiveRecordBucket`、`filterLiveLogRecords` 和 `filterAssociatedLiveArchiveCases` 接受阶段数组；显式 `liveStageId` 决定当前/历史/指定阶段，缺失且无法推导的记录进入 `pending`。旧阶段的 `planned` 记录进入 `pending`，旧阶段的 `open` 记录留在历史阶段；当前阶段的两者继续出现在当前交易日志。案例仍通过 `sourceTradeId` 继承来源交易范围。

用户选择“保留归档”后写入 `liveStagePlanDisposition: 'archive'`，该计划从待整理进入原阶段；选择“复制到当前阶段”时原计划同样标记为已归档，新副本写入当前阶段 ID。`ActivityKind` 增加 `'liveStage'`，`ActivityEvent` 增加 `fromLiveStageId` 与 `toLiveStageId`，并复用现有 `text` 字段记录阶段校正原因和计划处置。

- [ ] **Step 5: 运行定向测试确认通过**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveStageMembership.test.ts src/lib/liveStatisticsArchive.test.ts src/data/weeklyReviews.test.ts src/lib/analysisScope.test.ts`

Expected: PASS，风险起点仍不截断周事实，但阶段范围会稳定截断当前/历史绩效。

- [ ] **Step 6: 提交稳定归属**

```bash
git add src/lib/liveStageMembership.ts src/lib/liveStageMembership.test.ts src/data/trades.ts src/data/weeklyReviews.ts src/lib/liveStatisticsArchive.ts src/lib/liveStatisticsArchive.test.ts src/data/weeklyReviews.test.ts
git commit -m "feat(live-stage): freeze trade and review membership"
```

---

### Task 3: 增加 v12 持久化与幂等迁移

**Files:**
- Create: `src/lib/liveStageMigration.ts`
- Create: `src/lib/liveStageMigration.test.ts`
- Modify: `src/storage/types.ts`
- Modify: `src/storage/persistedKeys.ts`
- Modify: `src/storage/emptySnapshot.ts`
- Modify: `src/storage/snapshotCodec.ts`
- Modify: `src/storage/snapshotValidation.ts`
- Modify: `src/storage/fixtures/fullPersistedSnapshot.ts`
- Modify: `src/lib/importTypes.ts`
- Modify: `src/lib/importMerge.ts`
- Modify: `src/lib/importExport.ts`
- Modify: `electron/library/schemaMigration.ts`
- Modify: `electron/library/schemaMigration.test.ts`
- Modify: `scripts/qa-desktop-visual.mjs`
- Test: `src/storage/snapshotCodec.test.ts`
- Test: `src/lib/importExportAssets.test.ts`

**Interfaces:**
- Consumes: `LiveStage`、`ScheduledLiveStage`、`RiskAccountingOverride`、阶段成员推导器。
- Produces: `migrateLiveStageSnapshot(snapshot: PersistedSnapshot): PersistedSnapshot`。
- Adds persisted fields: `scheduledLiveStage?: ScheduledLiveStage | null`、`riskAccountingOverride?: RiskAccountingOverride | null`、`liveStageMigrationVersion?: 1`。
- Keeps persisted key: `livePerformanceCycles?: LiveStage[]`，避免 v11 文件和保存视图 URL 失效。

- [ ] **Step 1: 写失败的快照迁移合同**

```ts
function stage(id: string, startTradingDayKey: string): LiveStage {
  return { id, name: id, startTradingDayKey, createdAt: `${startTradingDayKey}T00:00:00.000Z` }
}

function closedTrade(id: string, day: string): PersistedTrade {
  return {
    id, ref: `TRD-${id}`, symbol: 'EURUSD', side: 'long', status: 'win',
    conviction: 'medium', strategyId: 'strategy-1', tradeKind: 'live',
    tags: [], mistakeTags: [], reviewStatus: 'reviewed', reviewCategory: 'normal',
    entry: 1, exit: 1.1, size: 1, pnl: 100, rMultiple: 1, resultSource: 'imported',
    openedAt: day, closedAt: day, closedTradingDayKey: day, note: '',
  }
}

function snapshot(patch: Partial<PersistedSnapshot>): PersistedSnapshot {
  return { ...createEmptyPersistedSnapshot(), ...patch }
}

export function testSingleLegacyBoundaryBecomesHistoricalAndCurrentStages(): void {
  const migrated = migrateLiveStageSnapshot(snapshot({
    livePerformanceCycles: [stage('current', '2026-08-10')],
    liveStatsStartTradingDayKey: '2026-08-01',
    trades: [closedTrade('old', '2026-07-20'), closedTrade('new', '2026-08-12')],
  }))
  assert(migrated.livePerformanceCycles?.length === 2, '单边界前可靠历史必须获得迁移阶段')
  assert(migrated.trades[0]?.liveStageId === migrated.livePerformanceCycles?.[0]?.id, '旧交易必须归迁移阶段')
  assert(migrated.trades[1]?.liveStageId === 'current', '新交易必须归当前阶段')
  assert(migrated.riskAccountingOverride?.startTradingDayKey === '2026-08-01', '不一致旧风险起点必须显式迁移为覆盖')
  assert(migrateLiveStageSnapshot(migrated).liveStageMigrationVersion === 1, '重复迁移必须幂等')
}
```

在 `snapshotCodec.test.ts` 增加 v11 解码、v12 编码和缺省字段测试；在 Electron 迁移测试中增加 v11→v12 正常打开与失败回滚。

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveStageMigration.test.ts src/storage/snapshotCodec.test.ts src/lib/importExportAssets.test.ts electron/library/schemaMigration.test.ts`

Expected: FAIL，提示 schema 仍为 11 或新快照字段缺失。

- [ ] **Step 3: 扩展快照合同并升级 schema**

```ts
export const SCHEMA_VERSION = 12

export interface PersistedSnapshot {
  // 保留既有字段
  livePerformanceCycles?: LiveStage[]
  scheduledLiveStage?: ScheduledLiveStage | null
  riskAccountingOverride?: RiskAccountingOverride | null
  liveStageMigrationVersion?: 1
}
```

将三个字段加入 `PERSISTED_SNAPSHOT_FIELDS`、空快照、完整 fixture、JSON/ZIP 导入导出、revision 比较和验证器。`scripts/qa-desktop-visual.mjs` 的注入快照版本同步改为 12。

- [ ] **Step 4: 实现无损幂等迁移**

`migrateLiveStageSnapshot` 必须满足：

```ts
if (snapshot.liveStageMigrationVersion === 1) return structuredClone(snapshot)
```

多边界按原顺序保留；单边界只在存在更早可靠实盘时补“历史实盘（迁移）”；不存在的旧边界不猜测恢复；风险起点偏离当前阶段时生成显式覆盖；交易和周复盘写入推导出的 ID，无法判断者不写 ID。

- [ ] **Step 5: 扩展 Electron 迁移允许 v11 来源**

将 `electron/library/schemaMigration.ts` 的合法来源版本联合扩展为 `8 | 9 | 10 | 11`，继续复用现有 recovery marker、数据库/manifest 双写与回滚协议，不建立独立 v12 快捷路径。

- [ ] **Step 6: 运行迁移与持久化测试确认通过**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveStageMigration.test.ts src/storage/snapshotCodec.test.ts src/storage/snapshotValidation.test.ts src/lib/importExportAssets.test.ts electron/library/schemaMigration.test.ts`

Expected: PASS，v11、v12、JSON、Web 归档与 Electron 资料库均保持完整字段往返。

- [ ] **Step 7: 提交迁移合同**

```bash
git add src/lib/liveStageMigration.ts src/lib/liveStageMigration.test.ts src/storage src/lib/importTypes.ts src/lib/importMerge.ts src/lib/importExport.ts electron/library/schemaMigration.ts electron/library/schemaMigration.test.ts scripts/qa-desktop-visual.mjs
git commit -m "feat(live-stage): migrate persisted stage state"
```

---

### Task 4: 实现预约、激活与风险回滚状态事务

**Files:**
- Create: `src/hooks/useLiveStageActivation.ts`
- Create: `src/hooks/useLiveStageActivation.browser.test.tsx`
- Create: `src/hooks/useLiveStageActivation.browser.test.html`
- Modify: `src/store/useStore.ts`
- Modify: `src/store/livePerformanceCycles.test.ts`
- Modify: `src/App.tsx`
- Test: `src/store/riskGateIntegration.test.ts`

**Interfaces:**
- Consumes: Task 1 的预约/激活函数和 Task 2 的阶段归属解析器。
- Adds store state: `scheduledLiveStage`、`riskAccountingOverride`。
- Adds action: `scheduleNextLiveStage(input: { id: string; name: string; currentTradingDayKey: string; createdAt: string }): ScheduledLiveStage`。
- Adds actions: `cancelScheduledLiveStage(): void`、`activateDueLiveStage(currentTradingDayKey: string): 'activated' | 'not-due' | 'unchanged'`。
- Adds actions: `setRiskAccountingOverride(input: RiskAccountingOverride): void`、`clearRiskAccountingOverride(): void`。
- Adds action: `repairTradeLiveStage(id: string, nextStageId: string, reason: string): 'updated' | 'not-found' | 'unchanged'`。
- Adds action: `resolveCrossStagePlan(id: string, resolution: { kind: 'archive' } | { kind: 'copy'; copy: Trade }): 'updated' | 'not-found'`。
- Produces: `buildLiveStageTransitionPreview(trades: readonly Trade[], weeklyReviews: readonly WeeklyReview[], stages: readonly LiveStage[], startTradingDayKey: string, tradingDayStartHour: number): LiveStageTransitionPreview`，其中返回类型包含 `nextStageCount`、`previousStageCount`、`pendingPlanCount`、`associatedCaseCount` 与 `preservedWeeklyReviewCount`。

```ts
export type LiveStageTransitionPreview = {
  startTradingDayKey: string
  nextStageCount: number
  previousStageCount: number
  pendingPlanCount: number
  associatedCaseCount: number
  preservedWeeklyReviewCount: number
}
```

- [ ] **Step 1: 写失败的 store 原子事务测试**

```ts
function stage(id: string, startTradingDayKey: string): LiveStage {
  return {
    id, name: id, startTradingDayKey,
    createdAt: `${startTradingDayKey}T00:00:00.000Z`,
    activatedAt: `${startTradingDayKey}T00:00:00.000Z`,
  }
}

function scheduledStage(id: string, startTradingDayKey: string): ScheduledLiveStage {
  return { id, name: id, startTradingDayKey, createdAt: '2026-08-16T00:00:00.000Z' }
}

export function testDueStageActivationClosesRiskStateWithoutTouchingFacts(): void {
  const beforeTrades = structuredClone(useStore.getState().trades)
  const beforeReviews = structuredClone(useStore.getState().weeklyReviews)
  useStore.setState({
    livePerformanceCycles: [stage('old', '2026-08-10')],
    scheduledLiveStage: scheduledStage('new', '2026-08-17'),
    weeklyRiskPreparations: [{
      id: 'prep-1', weekStart: '2026-08-10',
      draft: {
        capitalBase: 10000, riskPercent: 1, riskAmount: 100,
        dailyLossLimitR: 2, weeklyLossLimitR: 5, monthlyLossLimitRDefault: 10,
        disciplineText: '触线后停止开仓。',
      },
      reviewedAt: null, confirmedPolicyVersionId: null,
      createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
    }],
    riskPolicyVersions: [{
      id: 'policy-1', sourceWeekStart: '2026-08-10', effectiveTradingDay: '2026-08-10',
      capitalBase: 10000, riskPercent: 1, riskAmount: 100,
      dailyLossLimitR: 2, weeklyLossLimitR: 5, monthlyLossLimitRDefault: 10,
      disciplineText: '触线后停止开仓。', confirmedAt: '2026-08-10T00:00:00.000Z',
    }],
  })
  const result = useStore.getState().activateDueLiveStage('2026-08-17')
  const state = useStore.getState()
  assert(result === 'activated', '到期周一必须激活')
  assert(state.livePerformanceCycles.at(-1)?.id === 'new', '新阶段必须成为当前阶段')
  assert(state.scheduledLiveStage === null, '预约必须在激活后清除')
  assert(state.weeklyRiskPreparations.length === 0 && state.riskPolicyVersions.length === 0, '当前风险状态必须清零')
  assert(state.livePerformanceCycles[0]?.riskSnapshot?.riskPolicyVersions.length === 1, '旧阶段必须冻结风险证据')
  assert(JSON.stringify(state.trades) === JSON.stringify(beforeTrades), '激活不得删除交易')
  assert(JSON.stringify(state.weeklyReviews) === JSON.stringify(beforeReviews), '激活不得删除周复盘')
}
```

继续覆盖：周中调用只返回 `not-due`、重复调用返回 `unchanged`、周一已有活动时 `scheduleNextLiveStage` 只能生成下周预约、风险覆盖不会改变阶段。

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/store/livePerformanceCycles.test.ts src/store/riskGateIntegration.test.ts`

Expected: FAIL，提示新状态和 action 不存在。

- [ ] **Step 3: 实现单次 Zustand 状态事务**

```ts
activateDueLiveStage: (currentTradingDayKey) => {
  let outcome: 'activated' | 'not-due' | 'unchanged' = 'unchanged'
  set((state) => {
    const scheduled = state.scheduledLiveStage
    if (!scheduled) return state
    if (scheduled.startTradingDayKey > currentTradingDayKey) {
      outcome = 'not-due'
      return state
    }
    outcome = 'activated'
    const closedStages = closeCurrentLiveStageWithRiskSnapshot(
      state.livePerformanceCycles,
      {
        capturedAt: new Date().toISOString(),
        weeklyRiskPreparations: structuredClone(state.weeklyRiskPreparations),
        riskPolicyVersions: structuredClone(state.riskPolicyVersions),
        monthlyRiskLimits: structuredClone(state.monthlyRiskLimits),
        riskOverrideEvents: structuredClone(state.riskOverrideEvents),
      },
    )
    return {
      ...state,
      livePerformanceCycles: activateScheduledLiveStage(
        closedStages,
        scheduled,
        currentTradingDayKey,
        new Date().toISOString(),
      ),
      scheduledLiveStage: null,
      riskAccountingOverride: null,
      liveStatsStartTradingDayKey: scheduled.startTradingDayKey,
      weeklyRiskPreparations: [],
      riskPolicyVersions: [],
      monthlyRiskLimits: [],
      riskOverrideEvents: [],
      pendingTradeOpenRequest: null,
    }
  })
  return outcome
}
```

保留 `liveStatsStartTradingDayKey` 为兼容镜像字段；所有常规写入只能由阶段激活同步更新。

- [ ] **Step 4: 在所有实盘写入口赋予阶段 ID**

交互式新建/复制与非交互导入必须分开处理，避免把旧导入记录错误归入当前阶段：

```ts
function assignInteractiveLiveStageId(trade: Trade, currentStageId: string | null): Trade {
  if (trade.tradeKind !== 'live' || trade.liveStageId || !currentStageId) return trade
  return { ...trade, liveStageId: currentStageId }
}

function assignImportedLiveStageId(
  trade: Trade,
  stages: readonly LiveStage[],
  tradingDayStartHour: number,
): Trade {
  if (trade.tradeKind !== 'live' || trade.liveStageId) return trade
  const liveStageId = inferMigrationTradeLiveStageId(trade, stages, tradingDayStartHour)
  return liveStageId ? { ...trade, liveStageId } : trade
}
```

`upsertTrade`、交互式 `upsertTrades` 与复制计划使用第一个 helper；`upsertTradesFromNonInteractiveImport` 使用第二个 helper；`setStatus` 只保留已有 ID，旧记录缺 ID 时先按开仓日推导。案例不写阶段 ID；历史实盘案例通过来源交易投影。

本任务同时删除 store 对 `createLiveStatisticsResetEpoch` 的最后调用以及旧“重置后只保留一条边界”断言；从此所有正式阶段写入只能走预约/激活 action。

`repairTradeLiveStage` 必须要求非空原因，更新 `liveStageId` 并追加一条 `kind: 'liveStage'` activity；`resolveCrossStagePlan(id, 'archive')` 写入处置字段，`resolveCrossStagePlan(id, 'copy')` 原子化归档原计划并返回交由现有复制编号器写入当前阶段的新计划。两者都不得修改交易正文和历史评论。

- [ ] **Step 5: 增加启动时补激活 hook**

`useLiveStageActivation` 读取业务日锚点，在 App 已 hydrate 后调用 `activateDueLiveStage`；只有返回 `activated` 时才执行 `flushPersistNow()`。持久化失败必须恢复调用前完整阶段与风险切片，并沿用 `StorageRevisionConflictError` 的远端重载路径。

- [ ] **Step 6: 运行 unit 与 browser 状态测试**

Run: `node scripts/run-regression-tests.mjs --unit-only src/store/livePerformanceCycles.test.ts src/store/riskGateIntegration.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: PASS，浏览器控制台无未处理错误，延迟启动只补激活一次。

- [ ] **Step 7: 提交状态事务**

```bash
git add src/store/useStore.ts src/store/livePerformanceCycles.test.ts src/store/riskGateIntegration.test.ts src/hooks/useLiveStageActivation.ts src/hooks/useLiveStageActivation.browser.test.tsx src/hooks/useLiveStageActivation.browser.test.html src/App.tsx
git commit -m "feat(live-stage): schedule and activate stages atomically"
```

---

### Task 5: 重做设置流程并隔离高级风险修复

**Files:**
- Modify: `src/components/LivePerformanceCycleControl.tsx`
- Modify: `src/components/LivePerformanceCycleControl.css`
- Modify: `src/components/LivePerformanceCycleManager.tsx`
- Modify: `src/components/LivePerformanceCycleManager.css`
- Modify: `src/components/LivePerformanceCycleManager.browser.test.tsx`
- Modify: `src/components/LiveCycleSettings.tsx`
- Modify: `src/components/LiveCycleSettings.css`
- Modify: `src/components/LiveCycleSettings.browser.test.tsx`
- Modify: `src/views/settings/DataSettingsPanel.tsx`
- Modify: `src/views/settings/RiskDataRepairView.tsx`
- Modify: `src/views/settings/RiskDataRepairView.css`
- Modify: `src/views/settings/RiskDataRepairView.browser.test.tsx`
- Modify: `src/views/Dashboard.tsx`

**Interfaces:**
- Consumes: `buildLiveStageTransitionPreview`、预约/取消 action、风险覆盖 action。
- Produces user flow: “立即开启新阶段”或“安排下周新阶段”。
- Produces advanced flow: “单独校正风险起算日”与“恢复跟随当前阶段”。

- [ ] **Step 1: 改写浏览器测试为阶段语义并先确认失败**

新增以下断言：

```ts
assert(document.body.textContent?.includes('开启新实盘阶段'), '入口必须使用阶段语义')
assert(!document.body.textContent?.includes('重置统计'), '不得保留含糊的旧名称')
assert(document.body.textContent?.includes('将在 8月24日周一生效'), '周中必须明确显示预约日期')
assert(document.body.textContent?.includes('周复盘保留'), '影响预览必须说明周复盘不删除')
```

风险修复页测试必须确认普通数据设置不再展示任意风险日期按钮，而 `/settings/risk/data-repair` 显示偏离警告、必填原因和“恢复跟随当前阶段”。

- [ ] **Step 2: 运行相关 browser 测试确认失败**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: FAIL 在旧“重置实盘统计”与普通风险起点界面断言。

- [ ] **Step 3: 将重置弹窗改为阶段确认弹窗**

移除任意 `DatePicker`；根据 `resolveLiveStageStartMode` 固定合法周一。表单只允许编辑阶段名称，并展示：新阶段起点、进入新阶段/旧阶段/待整理数量、关联案例、保留周复盘和将重置的风险集合。主按钮文案由模式决定：

```tsx
<button type="button" className="ui-btn ui-btn-primary" onClick={confirmStage}>
  {mode.kind === 'immediate' ? '立即开启新阶段' : '安排下周新阶段'}
</button>
```

已有预约时控制区显示日期与“取消安排”，不允许再创建第二个预约。

- [ ] **Step 4: 将风险起点组件移动为高级修复**

`LiveCycleSettings` 改成只在修复中心渲染的 `variant="repair"`。保存时要求非空原因，调用 `setRiskAccountingOverride`；清除动作调用 `clearRiskAccountingOverride`。页面持续显示当前阶段起点、实际风险起点和偏离状态。

当前阶段卡展示阶段名称、起始周、持续周数和现有绩效摘要；当前阶段与已结束阶段都复用 `renameLivePerformanceCycle` 完成重命名。重命名只修改名称，不改变边界、交易归属或周复盘 ID。

`DataSettingsPanel` 用扩展后的 `LivePerformanceCycleControl` 替换原普通风险起点区，并在此承载当前阶段卡、预约状态和阶段管理弹窗。Dashboard 保留快捷入口，但文案与同一 manager 统一为“开启新实盘阶段”，不维护第二套确认流程。

- [ ] **Step 5: 保留 revision 冲突与持久化回滚**

阶段安排、取消和风险修复沿用现有 `flushPersistNow`、`StorageRevisionConflictError`、远端快照 reload 和失败二次 flush。回滚对象必须包含阶段数组、预约、风险覆盖、兼容风险起点以及四类风险状态。

- [ ] **Step 6: 运行 browser、设计与类型检查**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Run: `pnpm typecheck`

Run: `pnpm qa:design`

Expected: PASS；960、1280、1920 桌面宽度下弹窗和修复区无横向溢出。

- [ ] **Step 7: 提交设置体验**

```bash
git add src/components/LivePerformanceCycleControl.tsx src/components/LivePerformanceCycleControl.css src/components/LivePerformanceCycleManager.tsx src/components/LivePerformanceCycleManager.css src/components/LivePerformanceCycleManager.browser.test.tsx src/components/LiveCycleSettings.tsx src/components/LiveCycleSettings.css src/components/LiveCycleSettings.browser.test.tsx src/views/settings/DataSettingsPanel.tsx src/views/settings/RiskDataRepairView.tsx src/views/settings/RiskDataRepairView.css src/views/settings/RiskDataRepairView.browser.test.tsx src/views/Dashboard.tsx
git commit -m "feat(live-stage): replace reset with weekly stage flow"
```

---

### Task 6: 统一当前交易日志与历史实盘阶段导航

**Files:**
- Modify: `src/lib/livePerformanceCycleRoute.ts`
- Modify: `src/lib/livePerformanceCycleRoute.test.ts`
- Modify: `src/lib/workbenchTrades.ts`
- Create: `src/lib/workbenchTrades.test.ts`
- Modify: `src/views/ListView.tsx`
- Modify: `src/views/LiveArchiveView.tsx`
- Modify: `src/views/LiveArchiveView.css`
- Modify: `src/views/LiveArchiveView.browser.test.tsx`
- Modify: `src/views/LivePerformanceCycleNavigation.browser.test.tsx`
- Modify: `src/views/LiveCycleHistory.browser.test.tsx`
- Modify: `src/components/trades/TradeFilters.tsx`
- Modify: `src/components/trades/QuickViewBar.tsx`
- Create: `src/components/LiveStageRepairDialog.tsx`
- Create: `src/components/LiveStageRepairDialog.css`
- Create: `src/components/LiveStageRepairDialog.browser.test.tsx`
- Create: `src/components/LiveStageRepairDialog.browser.test.html`

**Interfaces:**
- Consumes: 稳定 `liveStageId`、阶段 bounds 和既有 `statsCycle` 查询参数。
- Produces: 当前交易日志缺省当前阶段；历史实盘支持 `statsCycle=<stage-id>` 与全部历史。
- Preserves: `view=cases`、筛选条件、看板/列表模式和详情返回参数。

- [ ] **Step 1: 写失败的路由与投影测试**

```ts
export function testHistoricalLiveRouteKeepsRequestedStageAndContentMode(): void {
  const params = new URLSearchParams('statsCycle=stage-1&view=cases&symbol=EURUSD')
  const route = resolveLiveRoute(params, stages(), 'archive')
  const destination = resolveLiveRouteNavigation(route)
  assert(destination.pathname === '/live-history', '历史阶段必须进入历史实盘')
  assert(destination.search.includes('statsCycle=stage-1'), '必须保留指定阶段')
  assert(destination.search.includes('view=cases'), '必须保留关联案例模式')
  assert(destination.search.includes('symbol=EURUSD'), '必须保留筛选')
}
```

浏览器测试准备两个已结束阶段和一个当前阶段，断言交易日志只显示当前阶段，历史实盘可在两个阶段之间切换，旧阶段来源案例只出现在对应阶段。

待整理测试准备缺失阶段 ID、失效阶段 ID 和旧阶段未开仓计划，断言三者不会进入绩效；旧计划提供“保留归档/复制到当前阶段”，缺失或冲突记录提供“校正阶段”，校正必须填写原因并生成 activity 审计。

- [ ] **Step 2: 运行 unit 与 browser 测试确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/livePerformanceCycleRoute.test.ts src/lib/workbenchTrades.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: FAIL，现有历史实盘仍把全部旧记录混成 `all-archives`，切换内容时会丢失查询参数。

- [ ] **Step 3: 修正统一路由合同**

`resolveLiveRouteNavigation` 对指定历史阶段写回 `statsCycle`；`LiveArchiveView.setArchiveContent` 从当前 `URLSearchParams` 克隆后只更新 `view`，不得重建空查询。缺失阶段 ID 显示一次兼容提示并回到全部历史。

- [ ] **Step 4: 增加阶段选择与摘要**

历史实盘顶部使用现有快捷条样式提供“全部历史”和各已结束阶段，阶段项显示名称与起止周。选中阶段后的交易与关联案例继续传给同一个 `TradesPage`、`ListView`、`TradeFilters` 和 `QuickViewBar`。

交易日志标题旁显示：

```tsx
<span className="list-context-stage">当前阶段：{currentStage.name} · {currentStage.startTradingDayKey} 起</span>
```

- [ ] **Step 5: 让 workbench 和筛选只消费统一范围**

删除历史实盘对纯关闭日边界的独立成员判断，统一调用 `filterLiveLogRecords(allTrades, requestedStageScope, tradingDayStartHour)`。保存视图继续保存 `statsCycle`，失效 ID 只清除自身，不影响其他筛选。

- [ ] **Step 6: 实现待整理阶段修复与计划处置**

`LiveStageRepairDialog` 显示交易编号、当前推导状态、目标阶段、移动后会进入的工作区、关联案例数量和必填原因。提交阶段校正调用 `repairTradeLiveStage`；旧计划的两个处置动作调用 `resolveCrossStagePlan`。提交前后都使用现有持久化 revision 冲突与失败回滚路径，不提供批量猜测。

- [ ] **Step 7: 运行导航、列表和设计回归**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/livePerformanceCycleRoute.test.ts src/lib/workbenchTrades.test.ts src/lib/savedTradeViews.test.ts src/lib/workspaceFacetConsistency.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Run: `pnpm qa:design`

Expected: PASS，历史阶段切换不丢内容模式、筛选和返回位置；待整理记录完成校正或处置后自动离开队列。

- [ ] **Step 8: 提交阶段工作台**

```bash
git add src/lib/livePerformanceCycleRoute.ts src/lib/livePerformanceCycleRoute.test.ts src/lib/workbenchTrades.ts src/lib/workbenchTrades.test.ts src/views/ListView.tsx src/views/LiveArchiveView.tsx src/views/LiveArchiveView.css src/views/LiveArchiveView.browser.test.tsx src/views/LivePerformanceCycleNavigation.browser.test.tsx src/views/LiveCycleHistory.browser.test.tsx src/components/trades/TradeFilters.tsx src/components/trades/QuickViewBar.tsx src/components/LiveStageRepairDialog.tsx src/components/LiveStageRepairDialog.css src/components/LiveStageRepairDialog.browser.test.tsx src/components/LiveStageRepairDialog.browser.test.html
git commit -m "feat(live-stage): browse current and historical stages"
```

---

### Task 7: 为周复盘增加阶段归属与趋势筛选

**Files:**
- Modify: `src/data/weeklyReviews.ts`
- Modify: `src/data/weeklyReviews.test.ts`
- Modify: `src/data/weeklyReviewTrend.test.ts`
- Modify: `src/views/WeeklyReviewView.tsx`
- Modify: `src/views/WeeklyReviewView.css`
- Modify: `src/views/WeeklyReviewView.browser.test.tsx`
- Modify: `src/views/WeeklyReviewPresentation.browser.test.tsx`

**Interfaces:**
- Consumes: `WeeklyReview.liveStageId`、`assignWeeklyReviewStageId` 和阶段列表。
- Produces: `buildWeeklyReviewTrend(reviews, stageId?: string | null)`。
- Produces: 每周阶段标签与年度趋势“全部阶段/指定阶段”筛选。

- [ ] **Step 1: 写失败的周复盘阶段测试**

```ts
function completedReview(weekStart: string, liveStageId: string): WeeklyReview {
  return {
    ...createWeeklyReview(weekStart, new Date(`${weekStart}T12:00:00.000Z`)),
    liveStageId,
    status: 'completed', executionScore: 4, riskScore: 4, emotionScore: 4,
    metricsSnapshot: buildWeeklyReviewMetrics([]),
    completedAt: `${weekStart}T12:00:00.000Z`,
  }
}

export function testWeeklyTrendCanFilterOneStageWithoutChangingSnapshots(): void {
  const first = completedReview('2026-08-03', 'stage-1')
  const second = completedReview('2026-08-10', 'stage-2')
  const all = buildWeeklyReviewTrend([first, second], null)
  const scoped = buildWeeklyReviewTrend([first, second], 'stage-2')
  assert(all.length === 2, '全部阶段必须保留全年连续趋势')
  assert(scoped.length === 1 && scoped[0]?.weekStart === '2026-08-10', '指定阶段只能显示自身周')
  assert(first.status === 'completed' && first.metricsSnapshot !== null, '筛选不得重写完成快照')
}
```

浏览器测试断言旧周仍存在、每周只显示一个阶段标签、切换趋势阶段不会创建或更新周复盘实体。

- [ ] **Step 2: 运行测试确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/data/weeklyReviews.test.ts src/data/weeklyReviewTrend.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: FAIL，趋势函数和页面尚未接受阶段 ID。

- [ ] **Step 3: 在创建与规范化时补阶段 ID**

`upsertWeeklyReview` 在新实体缺少 ID 时按 `weekStart` 调用 `assignWeeklyReviewStageId`。`normalizeWeeklyReviews` 保留已有 ID；旧记录仅在迁移或 store hydrate 时推导，不在每次渲染时改写。

- [ ] **Step 4: 增加阶段标签和趋势筛选**

周标题区域展示阶段名称；年度趋势标签使用现有 segmented control，并通过 `statsCycle=all|<stage-id>` 保存选择。当前周正文、上次承诺验证和完成快照逻辑保持不变。

- [ ] **Step 5: 运行周复盘完整回归**

Run: `node scripts/run-regression-tests.mjs --unit-only src/data/weeklyReviews.test.ts src/data/weeklyReviewTrend.test.ts src/lib/weeklyReviewSnapshot.test.ts src/lib/weeklyReviewCompletion.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: PASS，阶段切换不会删除、拆分或重算已完成周复盘。

- [ ] **Step 6: 提交周复盘阶段化**

```bash
git add src/data/weeklyReviews.ts src/data/weeklyReviews.test.ts src/data/weeklyReviewTrend.test.ts src/views/WeeklyReviewView.tsx src/views/WeeklyReviewView.css src/views/WeeklyReviewView.browser.test.tsx src/views/WeeklyReviewPresentation.browser.test.tsx
git commit -m "feat(weekly-review): label and filter by live stage"
```

---

### Task 8: 统一仪表盘、风险和侧栏消费范围

**Files:**
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/Dashboard.css`
- Modify: `src/views/DashboardScope.browser.test.tsx`
- Modify: `src/views/LivePerformanceCycleDashboard.browser.test.tsx`
- Modify: `src/lib/analysisScope.ts`
- Modify: `src/lib/analysisScope.test.ts`
- Modify: `src/lib/riskBudget.ts`
- Modify: `src/lib/riskBudget.test.ts`
- Modify: `src/lib/tradeOpenRiskGate.ts`
- Modify: `src/lib/tradeOpenRiskGate.test.ts`
- Modify: `src/components/RiskStatusStrip.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/views/TodayWorkspace.tsx`
- Modify: `src/lib/sidebarWorkspace.ts`
- Create: `src/lib/sidebarWorkspace.test.ts`

**Interfaces:**
- Consumes: `resolveRiskAccountingStart`、阶段范围和 `statsCycle`。
- Produces: 仪表盘当前/全部/指定阶段选择。
- Produces: 风险卡只消费当前阶段或显式覆盖起点。
- Preserves: 今日工作台与侧栏数字只计算当前阶段。

- [ ] **Step 1: 写失败的分析与风险范围测试**

```ts
export function testRiskStartFollowsCurrentStageUnlessExplicitlyOverridden(): void {
  const stages = [stage('old', '2026-08-10'), stage('current', '2026-08-17')]
  assert(resolveRiskAccountingStart(stages, null) === '2026-08-17', '风险必须默认跟随当前阶段')
  assert(
    resolveRiskAccountingStart(stages, {
      startTradingDayKey: '2026-08-18',
      reason: '修复导入日期',
      createdAt: '2026-08-18T10:00:00.000Z',
    }) === '2026-08-18',
    '显式修复覆盖必须优先',
  )
}
```

Dashboard browser 测试准备三个阶段，断言缺省当前阶段、`statsCycle=all` 展示全部、指定 ID 只展示对应阶段，风险卡始终保持当前/覆盖口径。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/analysisScope.test.ts src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.test.ts src/lib/sidebarWorkspace.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: FAIL，当前消费者仍直接读取独立 `liveStatsStartTradingDayKey` 或只支持当前周期。

- [ ] **Step 3: 集中解析风险起点**

在 store selector 或纯 helper 中生成：

```ts
const riskAccountingStart = resolveRiskAccountingStart(
  state.livePerformanceCycles,
  state.riskAccountingOverride,
)
```

风险预算、开仓门禁、周风险证据、RiskStatusStrip 和 Sidebar 不再自行选择起点。兼容镜像字段只用于 v11 导出和迁移，不是运行时真值。

- [ ] **Step 4: 增加仪表盘阶段范围选择**

复用 `writePerformanceAnalysisCycle` 和阶段列表，提供“当前阶段 / 全部历史 / 指定阶段”。绩效选择器使用阶段范围；风险卡旁明确显示“当前阶段风险”或“风险起点已单独校正”，不跟随历史绩效筛选。

- [ ] **Step 5: 对齐今日工作台与侧栏数字**

`TodayWorkspace`、`sidebarWorkspace` 和策略当前表现统一使用当前阶段 scope；历史阶段只通过历史实盘或仪表盘显式选择进入，不得增加到今日数字。

- [ ] **Step 6: 运行范围与浏览器回归**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/analysisScope.test.ts src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.test.ts src/lib/sidebarWorkspace.test.ts src/lib/workspaceFacetConsistency.test.ts`

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: PASS，各页面对同一阶段得到相同成员集合，风险卡不受历史筛选污染。

- [ ] **Step 7: 提交全局范围统一**

```bash
git add src/views/Dashboard.tsx src/views/Dashboard.css src/views/DashboardScope.browser.test.tsx src/views/LivePerformanceCycleDashboard.browser.test.tsx src/lib/analysisScope.ts src/lib/analysisScope.test.ts src/lib/riskBudget.ts src/lib/riskBudget.test.ts src/lib/tradeOpenRiskGate.ts src/lib/tradeOpenRiskGate.test.ts src/components/RiskStatusStrip.tsx src/components/Sidebar.tsx src/views/TodayWorkspace.tsx src/lib/sidebarWorkspace.ts
git commit -m "feat(live-stage): unify dashboard and risk scopes"
```

---

### Task 9: 完成兼容清理、全量验证与桌面安装包

**Files:**
- Modify: `src/regression.test.ts`
- Modify: `src/lib/typographySystem.design.test.ts`
- Modify: `docs/superpowers/specs/2026-08-16-historical-live-module-design.md`
- Modify: `docs/superpowers/specs/2026-08-16-live-stage-unification-design.md`

**Interfaces:**
- Consumes: Tasks 1–8 的最终用户文案、路由和持久化合同。
- Produces: 不含旧“重置起点决定历史实盘”的静态合同；保留旧 URL 和 v11 快照兼容。

- [ ] **Step 1: 更新静态回归与旧设计修订说明**

静态测试必须断言用户界面存在“当前实盘阶段”“安排下周新阶段”“单独校正风险起算日”，并且普通设置不再出现“调整风险核算起点”。旧历史实盘设计顶部补充本设计已落地的修订链接，不删除旧决策记录。

- [ ] **Step 2: 扫描遗留双边界文案和直接消费者**

Run: `rg -n "重置实盘统计|调整风险核算起点|清除风险核算起点|liveStatsStartTradingDayKey" src docs`

Expected: 用户界面不再出现前三个旧文案；`liveStatsStartTradingDayKey` 只保留在兼容序列化、迁移、测试 fixture 或有注释的镜像同步处。

- [ ] **Step 3: 运行完整工程门禁**

Run: `pnpm typecheck`

Run: `pnpm test`

Run: `pnpm build`

Run: `pnpm qa:design`

Run: `pnpm qa:desktop-visual --renderer`

Expected: 全部退出码为 0，无新增 console error、未捕获 rejection、设计合同或 bundle budget 失败。

- [ ] **Step 4: 在 Windows 构建并核验安装包**

Run: `pnpm dist:win`

Run: `Get-ChildItem release -File | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name,Length,LastWriteTime`

Expected: 生成非零大小的 `Trader-Atlas-1.4.1-win-x64.exe`，时间戳晚于本次构建开始时间。

- [ ] **Step 5: 在 macOS 构建对应桌面产物**

Run on macOS CI/host: `pnpm dist:mac`

Expected: 同时生成 arm64 与 x64 的 DMG/ZIP，应用启动后阶段预约、历史筛选和周复盘标签通过 smoke test。

- [ ] **Step 6: 检查工作树并提交验收修订**

Run: `git status --short`

Expected: 只包含 Task 9 的静态合同和文档修订。

```bash
git add src/regression.test.ts src/lib/typographySystem.design.test.ts docs/superpowers/specs/2026-08-16-historical-live-module-design.md docs/superpowers/specs/2026-08-16-live-stage-unification-design.md
git commit -m "test(live-stage): close desktop stage rollout"
```

---

## Final Acceptance Checklist

- [ ] 每次开启都会追加并永久保留独立历史阶段，不再覆盖旧边界。
- [ ] 阶段只在合法周一生效；周中和已有本周实盘活动时只能预约下周。
- [ ] 跨阶段持仓平仓后仍属于旧阶段，普通编辑不会造成阶段跳动。
- [ ] 当前交易日志只显示当前阶段，历史实盘可筛选每个已结束阶段及关联案例。
- [ ] 周复盘不清空、不拆分，每周显示唯一阶段标签，完成快照保持冻结。
- [ ] 风险默认跟随当前阶段，独立日期只通过高级修复覆盖并持续提示。
- [ ] v11→v12、JSON、Web 归档与 Electron 资料库迁移无数据丢失且失败可回滚。
- [ ] Windows 安装包与 macOS 桌面产物在对应平台构建通过。
- [ ] `pnpm typecheck`、`pnpm test`、`pnpm build`、设计与桌面视觉门禁全部通过。
