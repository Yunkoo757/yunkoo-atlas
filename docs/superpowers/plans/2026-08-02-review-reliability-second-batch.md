# Review Reliability Second Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能补做最近有实盘活动但尚未建档的周复盘，并能从风险设置页定位、打开和修复当前风险周期的数据缺口。

**Architecture:** 两条能力都由纯函数从现有 Store 数据实时推导，不新增持久化实体。周复盘共享交易日归周口径；风险诊断复用风险预算内部的逐笔候选评估，使汇总结果和修复清单来自同一个事实源。

**Tech Stack:** React 18、TypeScript 5.6、Zustand、React Router 6、Vite 自定义单元/浏览器测试、CSS design tokens。

## Global Constraints

- 所有文件使用 UTF-8 without BOM，保留全部中文字符。
- 当前周始终保留；所有已存周复盘永久保留；交易活动只补入最近 12 个不同活动周。
- 活动仅包含未删除实盘中的已平仓交易和错过机会，并遵守 `tradingDayStartHour`。
- 选择待补做周不创建实体；首次编辑时沿用现有延迟创建。
- 风险缺口只来自当前实盘风险周期内未删除、已平仓交易及全局核算起点异常。
- 不新增风险任务、schema 字段或页内交易编辑；不改变现有风险预算含义。
- 风险重构前后的日、周、月数值、覆盖状态、触发状态和阻断原因顺序必须保持不变。

---

## File Map

- `src/data/weeklyReviews.ts`：统一活动交易判定和周列表纯函数。
- `src/data/weeklyReviews.test.ts`：活动周边界、12 周上限和交易日归属契约。
- `src/views/WeeklyReviewView.tsx`：消费活动周列表并标识待补做。
- `src/views/WeeklyReviewView.css`：待补做状态的紧凑样式。
- `src/views/WeeklyReviewView.browser.test.tsx`：待补做选择、延迟创建和周导航体验。
- `src/data/riskManagement.ts`：公开风险诊断项及部分覆盖原因类型。
- `src/lib/riskBudget.ts`：共享逐笔评估并导出诊断清单。
- `src/lib/riskBudget.test.ts`：逐笔诊断、边界、合并和稳定排序契约。
- `src/lib/riskUnknownReasonPresentation.ts`：阻断及部分覆盖原因的统一中文文案。
- `src/views/settings/RiskDataIssuesSection.tsx`：风险待修复数据展示和导航。
- `src/views/settings/RiskManagementSettingsPanel.tsx`：在规则表单前接入诊断区。
- `src/views/settings/RiskManagementSettingsPanel.css`：诊断摘要、列表和移动端样式。
- `src/views/settings/RiskManagementSettings.browser.test.tsx`：诊断展示、自动消失和导航流程。
- `src/lib/tradeRoute.ts`、`src/regression.test.ts`：允许交易详情返回 `/settings/risk`。

### Task 1: 推导最近活动周

**Files:**
- Modify: `src/data/weeklyReviews.ts`
- Test: `src/data/weeklyReviews.test.ts`

**Interfaces:**
- Consumes: `closedTradingDayKey(trade, tradingDayStartHour)`、`weekStartFor(parseLocalDate(dayKey))`。
- Produces: `deriveWeeklyReviewWeeks(trades: Trade[], reviews: Pick<WeeklyReview, 'weekStart'>[], currentWeek: string, tradingDayStartHour?: number, activityLimit?: number): string[]`。

- [ ] **Step 1: 写活动周失败测试**

```ts
export function testWeeklyReviewWeeksKeepStoredWeeksAndLimitActivityHistory(): void {
  const activity = Array.from({ length: 14 }, (_, index) => trade({
    id: `activity-${index}`,
    closedAt: formatYmd(addDays(parseLocalDate('2026-07-27'), -index * 7)),
  }))
  const stored = createWeeklyReview('2025-01-06')
  const result = deriveWeeklyReviewWeeks(activity, [stored], '2026-08-03', 0, 12)
  assert(result.includes('2025-01-06'), '已有复盘不得被活动周上限淘汰')
  assert(result.includes('2026-08-03'), '当前周必须始终存在')
  assert(result.filter((week) => week >= '2026-05-11' && week <= '2026-07-27').length === 12, '只补入最近 12 个活动周')
  assert(result.join() === [...result].sort((a, b) => b.localeCompare(a)).join(), '周列表必须按新到旧排序')
}

export function testWeeklyReviewWeeksOnlyIncludeReviewableLiveActivity(): void {
  const result = deriveWeeklyReviewWeeks([
    trade({ id: 'closed-live', closedAt: '2026-07-27' }),
    trade({ id: 'missed-live', status: 'missed', pnl: null, resultSource: undefined, closedAt: '2026-07-20' }),
    trade({ id: 'paper', tradeKind: 'paper', closedAt: '2026-07-13' }),
    trade({ id: 'open', status: 'open', pnl: null, resultSource: undefined, closedAt: null }),
    trade({ id: 'deleted', deletedAt: '2026-07-06', closedAt: '2026-07-06' }),
  ], [], '2026-08-03')
  assert(result.join() === '2026-08-03,2026-07-27,2026-07-20', '空周和不可复盘记录不得进入列表')
}
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `node scripts/run-regression-tests.mjs src/data/weeklyReviews.test.ts --unit-only`
Expected: FAIL，提示 `deriveWeeklyReviewWeeks` 尚未导出。

- [ ] **Step 3: 实现共享活动周推导**

```ts
function reviewActivityWeek(trade: Trade, tradingDayStartHour: number): string | null {
  if (trade.deletedAt || trade.tradeKind !== 'live') return null
  if (!isExecutedClosed(trade.status) && !isMissed(trade.status)) return null
  const day = closedTradingDayKey(trade, tradingDayStartHour)
  return day ? weekStartFor(parseLocalDate(day)) : null
}

export function deriveWeeklyReviewWeeks(
  trades: Trade[],
  reviews: Pick<WeeklyReview, 'weekStart'>[],
  currentWeek: string,
  tradingDayStartHour = 0,
  activityLimit = 12,
): string[] {
  const activityWeeks = [...new Set(trades.flatMap((trade) => {
    const week = reviewActivityWeek(trade, tradingDayStartHour)
    return week ? [week] : []
  }))].sort((left, right) => right.localeCompare(left)).slice(0, activityLimit)
  return [...new Set([currentWeek, ...reviews.map((review) => review.weekStart), ...activityWeeks])]
    .sort((left, right) => right.localeCompare(left))
}
```

- [ ] **Step 4: 补充凌晨跨周、去重、case 和无效日期断言并跑绿灯**

Run: `node scripts/run-regression-tests.mjs src/data/weeklyReviews.test.ts --unit-only`
Expected: PASS，全部 weekly review 单元测试通过。

- [ ] **Step 5: 提交活动周纯函数**

```bash
git add src/data/weeklyReviews.ts src/data/weeklyReviews.test.ts
git commit -m "feat: derive reviewable activity weeks"
```

### Task 2: 在周复盘中补做活动周

**Files:**
- Modify: `src/views/WeeklyReviewView.tsx`
- Modify: `src/views/WeeklyReviewView.css`
- Test: `src/views/WeeklyReviewView.browser.test.tsx`

**Interfaces:**
- Consumes: `deriveWeeklyReviewWeeks(...)` from Task 1。
- Produces: 历史栏中的 `data-review-week` 与 `data-review-week-state="pending"` 可测交互标记。

- [ ] **Step 1: 写待补做浏览器失败场景**

```ts
const priorWeek = addDays(activeWeekStart, -7)
useStore.setState({
  trades: [{ ...makeTrade('prior', 'loss', -50), openedAt: priorWeek, closedAt: priorWeek }],
  weeklyReviews: [],
})
const pending = document.querySelector<HTMLButtonElement>(`[data-review-week="${priorWeek}"]`)
assert(pending?.textContent?.includes('待补做'), '有活动但未建档的周必须显示待补做')
pending.click()
await waitFor(() => document.querySelector('.wr-page-head h1')?.textContent?.includes('日') ?? false, '未切换到待补做周')
assert(useStore.getState().weeklyReviews.length === 0, '只查看待补做周不得创建空复盘')
clickButton('3')
await waitFor(() => useStore.getState().weeklyReviews.some((review) => review.weekStart === priorWeek), '首次编辑后没有创建复盘')
```

- [ ] **Step 2: 运行浏览器测试并确认红灯**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`
Expected: FAIL，找不到活动周按钮或“待补做”。

- [ ] **Step 3: 接入推导列表和待补做状态**

```tsx
const availableWeeks = useMemo(
  () => deriveWeeklyReviewWeeks(trades, reviews, currentWeek, tradingDayStartHour),
  [trades, reviews, currentWeek, tradingDayStartHour],
)

<button
  data-review-week={week}
  data-review-week-state={item ? item.status : 'pending'}
  ...
>
  <span>{weekLabel(week, currentWeek)}</span>
  <small>{item ? week.slice(5).replace('-', '.') : '待补做'}</small>
  <i className={item?.status === 'completed' ? 'is-complete' : item ? 'is-draft' : 'is-pending'} />
</button>
```

- [ ] **Step 4: 样式化待补做并验证周导航使用同一序列**

```css
.wr-history button[data-review-week-state="pending"] small { color: var(--warn); }
.wr-history button i.is-pending { border: 1px solid var(--warn); background: transparent; }
```

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`
Expected: PASS，查看不建档、首次编辑建档、上下周导航均通过。

- [ ] **Step 5: 提交周复盘交互**

```bash
git add src/views/WeeklyReviewView.tsx src/views/WeeklyReviewView.css src/views/WeeklyReviewView.browser.test.tsx
git commit -m "feat: reopen missed activity weeks for review"
```

### Task 3: 从风险预算共享逐笔诊断

**Files:**
- Modify: `src/data/riskManagement.ts`
- Modify: `src/lib/riskBudget.ts`
- Modify: `src/lib/riskUnknownReasonPresentation.ts`
- Test: `src/lib/riskBudget.test.ts`

**Interfaces:**
- Produces: `RiskDataIssueSeverity = 'blocking' | 'partial' | 'global'`。
- Produces: `RiskPartialReason = 'partial-missing-pnl' | 'partial-missing-close-date' | 'partial-invalid-close-date' | 'partial-future-close-date' | 'partial-missing-policy'`。
- Produces: `RiskDataIssue { tradeId: string | null; tradingDayKey: string | null; severity: RiskDataIssueSeverity; reasons: RiskDataIssueReason[] }`。
- Produces: `resolveRiskDataIssues(input: ResolveRiskOutcomesInput): RiskDataIssue[]`。

- [ ] **Step 1: 写逐笔诊断失败测试**

```ts
export function testRiskDataIssuesMergeReasonsAndKeepStableOrder(): void {
  const input = fixture({ pnls: [-1_000, 1_000] })
  input.trades[0] = { ...input.trades[0]!, pnl: null, resultSource: 'r', rMultiple: -1, closedAt: null, closedTradingDayKey: undefined }
  input.trades[1] = { ...input.trades[1]!, pnl: null, resultSource: 'r', rMultiple: 1 }
  const issues = resolveRiskDataIssues({ ...input, trades: [...input.trades].reverse() })
  assert(issues.length === 2, '同一交易的多个原因必须合并为一项')
  assert(issues[0]?.tradeId === 'trade-1' && issues[0].severity === 'blocking', '阻断项必须优先')
  assert(issues[0]?.reasons.join() === 'missing-loss-pnl,missing-close-date', '阻断原因必须稳定排序')
  assert(issues[1]?.severity === 'partial' && issues[1].reasons.includes('partial-missing-pnl'), '非亏损缺金额必须显式标为部分覆盖')
}

export function testRiskDataIssuesRespectCycleAndGlobalBoundary(): void {
  const input = fixture({ pnls: [-1_000] })
  input.liveStatsStartTradingDayKey = '2026-07-28'
  const issues = resolveRiskDataIssues(input)
  assert(issues.length === 1 && issues[0]?.severity === 'global', '未来核算起点必须生成独立全局项')
  assert(issues[0]?.reasons[0] === 'invalid-live-cycle-start', '全局项必须保留准确原因')
}
```

- [ ] **Step 2: 运行风险测试并确认红灯**

Run: `node scripts/run-regression-tests.mjs src/lib/riskBudget.test.ts --unit-only`
Expected: FAIL，`resolveRiskDataIssues` 与诊断类型尚不存在。

- [ ] **Step 3: 建模逐笔候选及部分覆盖原因**

```ts
type CandidateResult = {
  tradeId: string | null
  date: string | null
  budgetR: number | null
  unknownReasons: RiskUnknownReason[]
  partialReasons: RiskPartialReason[]
}

function periodCoverage(results: CandidateResult[]): RiskCoverage {
  if (results.some((result) => result.unknownReasons.length > 0)) return 'unknown'
  return results.some((result) => result.partialReasons.length > 0) ? 'partial' : 'complete'
}
```

将原 `calculateCanonicalOutcomes` 的交易循环提取为 `evaluateRiskCandidates(input)`；每个原 `partial = true` 分支改为对应的 `partialReasons.push(...)`，预算汇总仍只消费同一批候选。

- [ ] **Step 4: 导出诊断并保持风险汇总契约**

```ts
export function resolveRiskDataIssues(input: ResolveRiskOutcomesInput): RiskDataIssue[] {
  const evaluation = evaluateRiskCandidates(input)
  if (evaluation.globalReasons.length > 0) {
    return [{ tradeId: null, tradingDayKey: null, severity: 'global', reasons: evaluation.globalReasons }]
  }
  return evaluation.results.flatMap((result) => {
    const reasons = [...result.unknownReasons, ...result.partialReasons]
    if (reasons.length === 0) return []
    return [{
      tradeId: result.tradeId,
      tradingDayKey: result.date,
      severity: result.unknownReasons.length > 0 ? 'blocking' as const : 'partial' as const,
      reasons,
    }]
  }).sort(compareRiskDataIssues)
}
```

Run: `node scripts/run-regression-tests.mjs src/lib/riskBudget.test.ts --unit-only`
Expected: PASS，既有预算测试与新增诊断测试全部通过。

- [ ] **Step 5: 补齐统一中文文案并提交**

```ts
export const RISK_PARTIAL_REASON_COPY: Readonly<Record<RiskPartialReason, string>> = {
  'partial-missing-pnl': '缺少可用于风险核算的盈亏金额',
  'partial-missing-close-date': '缺少平仓日期',
  'partial-invalid-close-date': '平仓日期无效',
  'partial-future-close-date': '平仓日期晚于当前交易日',
  'partial-missing-policy': '该平仓日没有生效的风险规则',
}
```

```bash
git add src/data/riskManagement.ts src/lib/riskBudget.ts src/lib/riskBudget.test.ts src/lib/riskUnknownReasonPresentation.ts
git commit -m "feat: expose risk data diagnostics"
```

### Task 4: 风险待修复区和返回上下文

**Files:**
- Create: `src/views/settings/RiskDataIssuesSection.tsx`
- Modify: `src/views/settings/RiskManagementSettingsPanel.tsx`
- Modify: `src/views/settings/RiskManagementSettingsPanel.css`
- Modify: `src/views/settings/RiskManagementSettings.browser.test.tsx`
- Modify: `src/lib/tradeRoute.ts`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes: `resolveRiskDataIssues(...)`、`RISK_UNKNOWN_REASON_COPY`、`RISK_PARTIAL_REASON_COPY`。
- Produces: `[data-risk-data-issues]`、`[data-risk-issue-trade]`、`[data-risk-data-complete]` 页面契约。

- [ ] **Step 1: 先写设置返回源的失败测试**

```ts
const riskSettingsReturn = resolveTradeDetailReturn({
  from: { pathname: '/settings/risk', search: '' },
  tradeKind: 'live',
})
assert(riskSettingsReturn.pathname === '/settings/risk', '风险修复后的交易详情必须返回风险设置')
```

Run: `node scripts/run-regression-tests.mjs src/regression.test.ts --unit-only`
Expected: FAIL，当前来源被回退到 `/list`。

- [ ] **Step 2: 仅对白名单开放风险设置来源**

```ts
function isValidDetailSource(pathname: string, tradeKind: Trade['tradeKind'] | undefined): boolean {
  if (pathname === '/settings/risk') return tradeKind === 'live'
  // 保留既有判断
}
```

Run: `node scripts/run-regression-tests.mjs src/regression.test.ts --unit-only`
Expected: PASS。

- [ ] **Step 3: 写风险设置浏览器失败场景**

```ts
useStore.setState({ trades: [dirtyLoss], riskPolicyVersions: [policy], monthlyRiskLimits: [limit] })
await waitFor(() => panel.textContent?.includes('阻断风险判断 1 条') ?? false, '没有显示阻断摘要')
const openTrade = panel.querySelector<HTMLAnchorElement>('[data-risk-issue-trade]')
if (!openTrade?.textContent?.includes('打开交易')) throw new Error('缺少交易修复入口')
openTrade.click()
await waitFor(() => location.pathname.startsWith('/trade/'), '没有进入问题交易')
// 测试详情占位路由读取 location.state.from.pathname === '/settings/risk'
useStore.setState({ trades: [{ ...dirtyLoss, pnl: -1_000, resultSource: 'pnl' }] })
await waitFor(() => document.querySelector('[data-risk-data-complete]') !== null, '修复后问题没有自动消失')
```

- [ ] **Step 4: 实现纯展示组件并接入规则表单之前**

```tsx
export function RiskDataIssuesSection({ currentTradingDayKey }: { currentTradingDayKey: string }) {
  const { trades, policies, monthlyLimits, cycleStart, tradingDayStartHour } = useStore((state) => ({
    trades: state.trades,
    policies: state.riskPolicyVersions,
    monthlyLimits: state.monthlyRiskLimits,
    cycleStart: state.liveStatsStartTradingDayKey,
    tradingDayStartHour: state.display.tradingDayStartHour,
  }))
  const issues = useMemo(() => resolveRiskDataIssues({
    trades, policies, monthlyLimits, currentTradingDayKey,
    liveStatsStartTradingDayKey: cycleStart, tradingDayStartHour,
  }), [trades, policies, monthlyLimits, currentTradingDayKey, cycleStart, tradingDayStartHour])
  // global 项链接 /settings/data；trade 项链接 tradeDetailPath(trade)，并携带 tradeDetailNavState({ pathname: '/settings/risk', anchorTradeId: trade.id })
}
```

在 `RiskManagementSettingsPanel` 页头之后、`WeeklyRiskPreparationCard` 之前渲染：

```tsx
<RiskDataIssuesSection currentTradingDayKey={today} />
```

- [ ] **Step 5: 加入桌面/移动端样式并跑浏览器绿灯**

```css
.risk-data-issues-summary { display: flex; flex-wrap: wrap; gap: var(--sp-3); }
.risk-data-issue { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--sp-3); }
@media (max-width: 640px) {
  .risk-data-issue { grid-template-columns: 1fr; }
}
```

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`
Expected: PASS，数量、原因、详情来源、自动消失、全局设置入口和健康状态全部通过。

- [ ] **Step 6: 提交风险修复界面**

```bash
git add src/views/settings/RiskDataIssuesSection.tsx src/views/settings/RiskManagementSettingsPanel.tsx src/views/settings/RiskManagementSettingsPanel.css src/views/settings/RiskManagementSettings.browser.test.tsx src/lib/tradeRoute.ts src/regression.test.ts
git commit -m "feat: guide risk data repairs"
```

### Task 5: 完整验证与设计状态更新

**Files:**
- Modify: `docs/superpowers/specs/2026-08-02-review-reliability-second-batch-design.md`

**Interfaces:**
- Consumes: Tasks 1–4 的全部公开契约。
- Produces: 可发布的完整回归证据。

- [ ] **Step 1: 运行类型检查**

Run: `pnpm typecheck`
Expected: PASS，无 TypeScript 或 Electron 类型错误。

- [ ] **Step 2: 运行完整测试**

Run: `pnpm test`
Expected: PASS，包括单元、浏览器、风险管理移动端 QA 和治理门禁。

- [ ] **Step 3: 检查补丁与 UTF-8**

Run: `git diff --check`
Expected: 无输出。

Run: `@'\nfrom pathlib import Path\nfor path in [*Path('src').rglob('*'), *Path('docs/superpowers').rglob('*.md')]:\n    if path.is_file():\n        data = path.read_bytes()\n        if data.startswith(b'\\xef\\xbb\\xbf'):\n            raise SystemExit(f'BOM: {path}')\n        data.decode('utf-8')\nprint('UTF-8 OK')\n'@ | python -`
Expected: `UTF-8 OK`。

- [ ] **Step 4: 将设计状态更新为已实施并提交**

```markdown
状态：已实施并通过完整回归
```

```bash
git add docs/superpowers/specs/2026-08-02-review-reliability-second-batch-design.md
git commit -m "docs: mark review reliability batch complete"
```
