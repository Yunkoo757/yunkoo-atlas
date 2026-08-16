# Risk Data Repair Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将风险管理设置页的数据问题墙迁移到独立修复中心，并提供真实、连续、不可忽略历史缺口的桌面修复流程。

**Architecture:** `resolveRiskDataIssues` 继续作为唯一问题事实源；新的纯函数只负责统计、可修复性、稳定排序、单一主分组和下一项。风险设置页消费同一队列模型渲染紧凑摘要，修复中心在设置布局内按查询参数保存展开分组，并复用现有交易详情返回锚点恢复记录位置。

**Tech Stack:** React 18、TypeScript、React Router 6、Zustand、CSS、Vite 单元测试、Playwright 浏览器回归、Electron 桌面视觉矩阵。

## Global Constraints

- 始终以 UTF-8 无 BOM 读取和保存文件，完整保留中文字符。
- 仅适配 Windows 和 macOS 桌面客户端。
- 不新增手机、iPad、浏览器产品形态或其他平台适配逻辑。
- 不改变风险问题判定、风险限额、交易状态、统计口径、持久化结构或数据迁移。
- 历史问题不得忽略、隐藏或标记为已处理。
- 只有 `missing-policy` 或 `partial-missing-policy` 原因的历史缺口不可回填，不占用“处理下一项”，但持续影响完整度。
- 每个行为改动先写失败测试，确认因缺少目标行为而失败后再实现最小代码。

---

## File Structure

- `src/lib/riskDataRepair.ts`：把现有 `RiskDataIssue[]` 映射为统计、可修复项、稳定分组和下一项。
- `src/lib/riskDataRepair.test.ts`：验证严重度顺序、单一主分组、历史缺口保留和计数。
- `src/hooks/useRiskDataIssues.ts`：集中从 Zustand 读取风险输入并调用 `resolveRiskDataIssues`。
- `src/lib/riskUnknownReasonPresentation.ts`：导出统一的问题原因文案解析函数。
- `src/lib/tradeRoute.ts`：允许实盘详情返回风险修复中心并保留查询参数。
- `src/regression.test.ts`：验证风险修复中心是合法详情来源，案例记录仍拒绝该来源。
- `src/views/settings/RiskDataRepairView.tsx`：独立修复中心、单组展开、下一项和交易返回闭环。
- `src/views/settings/RiskDataRepairView.css`：修复中心的桌面层级、分组、行与 960px 单列布局。
- `src/views/settings/RiskDataRepairView.browser.test.tsx`：验证队列、历史缺口、查询参数和详情返回。
- `src/views/settings/RiskDataRepairView.browser.test.html`：修复中心浏览器测试入口。
- `src/views/settings/RiskDataHealthSummary.tsx`：风险设置页的紧凑数据完整性摘要。
- `src/views/settings/RiskManagementSettingsPanel.tsx`：把本周风险规则移到数据摘要之前。
- `src/views/settings/RiskManagementSettingsPanel.css`：删除逐条问题墙样式并增加紧凑摘要样式。
- `src/views/settings/RiskDataIssuesSection.tsx`：完成迁移后删除，避免保留第二套问题列表逻辑。
- `src/views/settings/RiskManagementSettings.browser.test.tsx`：验证设置页层级、摘要状态和修复入口。
- `src/App.tsx`：懒加载并注册 `/settings/risk/data-repair`。
- `scripts/desktop-visual-scenarios.mjs`：把修复中心加入 Windows/macOS 桌面截图矩阵。
- `scripts/fixtures/desktop-visual-matrix.test.mjs`：锁定新增后的 5×24 场景合同。

---

### Task 1: Build the Pure Repair Queue Model

**Files:**
- Create: `src/lib/riskDataRepair.ts`
- Create: `src/lib/riskDataRepair.test.ts`
- Create: `src/hooks/useRiskDataIssues.ts`
- Modify: `src/lib/riskUnknownReasonPresentation.ts`

**Interfaces:**
- Consumes: `RiskDataIssue[]`、`resolveRiskDataIssues(...)` 和现有原因文案映射。
- Produces: `buildRiskDataRepairQueue(issues): RiskDataRepairQueue`、`isRetainedRiskIssue(issue): boolean`、`riskDataIssueReasonCopy(reason): string`、`useRiskDataIssues(currentTradingDayKey): RiskDataIssue[]`。

- [ ] **Step 1: Write failing queue model tests**

创建 `src/lib/riskDataRepair.test.ts`，使用完整问题字面量覆盖严重度顺序、历史缺口跳过、单一主分组和独立计数：

```ts
import type { RiskDataIssue } from '@/data/riskManagement'
import { buildRiskDataRepairQueue } from '@/lib/riskDataRepair'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function issue(input: Partial<RiskDataIssue> & Pick<RiskDataIssue, 'severity' | 'reasons'>): RiskDataIssue {
  return {
    tradeId: input.tradeId ?? null,
    tradeRef: input.tradeRef ?? null,
    tradingDayKey: input.tradingDayKey ?? null,
    severity: input.severity,
    reasons: input.reasons,
  }
}

export function testRepairQueuePrioritizesActionableIssues(): void {
  const queue = buildRiskDataRepairQueue([
    issue({ tradeId: 'retained', tradeRef: 'TRD-1', severity: 'blocking', reasons: ['missing-policy'] }),
    issue({ tradeId: 'partial', tradeRef: 'TRD-2', severity: 'partial', reasons: ['partial-missing-pnl'] }),
    issue({ tradeId: 'blocking', tradeRef: 'TRD-3', severity: 'blocking', reasons: ['missing-loss-pnl'] }),
    issue({ severity: 'global', reasons: ['invalid-live-cycle-start'] }),
  ])

  assert(queue.nextItem?.issue.severity === 'global', '全局问题必须成为下一项')
  assert(queue.items.map((item) => item.issue.tradeId).join(',') === ',retained,blocking,partial', '必须按全局、阻断、完整度并保持同级输入顺序')
  assert(queue.retainedCount === 1, '必须独立统计保留型历史缺口')
}

export function testRepairQueueSkipsRetainedHistoryAndGroupsOnce(): void {
  const queue = buildRiskDataRepairQueue([
    issue({ tradeId: 'history', tradeRef: 'TRD-4', severity: 'blocking', reasons: ['missing-policy'] }),
    issue({ tradeId: 'mixed', tradeRef: 'TRD-5', severity: 'blocking', reasons: ['missing-policy', 'missing-close-date'] }),
  ])

  assert(queue.nextItem?.issue.tradeId === 'mixed', '纯历史缺口不得占用下一项')
  assert(queue.groups.flatMap((group) => group.items).filter((item) => item.issue.tradeId === 'mixed').length === 1, '多原因交易只能进入一个主分组')
  assert(queue.groups.find((group) => group.items.some((item) => item.issue.tradeId === 'mixed'))?.reason === 'missing-close-date', '主分组必须选择第一个可修复原因')
}

export function testRepairQueueCountsGlobalBlockingAndPartialSeparately(): void {
  const queue = buildRiskDataRepairQueue([
    issue({ severity: 'global', reasons: ['invalid-live-cycle-start'] }),
    issue({ tradeId: 'loss', severity: 'blocking', reasons: ['result-conflict'] }),
    issue({ tradeId: 'win', severity: 'partial', reasons: ['partial-missing-pnl'] }),
  ])

  assert(queue.counts.total === 3, '总数必须包含全部问题')
  assert(queue.counts.global === 1, '全局问题必须独立计数')
  assert(queue.counts.blocking === 1, '阻断计数不得重复包含全局问题')
  assert(queue.counts.partial === 1, '完整度计数必须只包含 partial')
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/riskDataRepair.test.ts`

Expected: FAIL，提示无法解析 `@/lib/riskDataRepair`。

- [ ] **Step 3: Implement the minimal pure queue model**

创建 `src/lib/riskDataRepair.ts`，保持输入内稳定顺序，并确保每个问题只属于一个主分组：

```ts
import type { RiskDataIssue, RiskDataIssueReason, RiskDataIssueSeverity } from '@/data/riskManagement'

export type RiskRepairBucket = 'priority' | 'completeness'
export type RiskRepairActionKind = 'data-settings' | 'open-trade' | 'view-trade'

export interface RiskRepairItem {
  issue: RiskDataIssue
  primaryReason: RiskDataIssueReason
  retained: boolean
  actionKind: RiskRepairActionKind
}

export interface RiskRepairGroup {
  key: string
  bucket: RiskRepairBucket
  reason: RiskDataIssueReason
  retained: boolean
  items: RiskRepairItem[]
}

export interface RiskDataRepairQueue {
  counts: { total: number; global: number; blocking: number; partial: number }
  retainedCount: number
  retainedOnly: boolean
  items: RiskRepairItem[]
  groups: RiskRepairGroup[]
  nextItem: RiskRepairItem | null
}

const SEVERITY_ORDER: Record<RiskDataIssueSeverity, number> = { global: 0, blocking: 1, partial: 2 }
const RETAINED_REASONS = new Set<RiskDataIssueReason>(['missing-policy', 'partial-missing-policy'])

export function isRetainedRiskIssue(issue: RiskDataIssue): boolean {
  return issue.reasons.length > 0 && issue.reasons.every((reason) => RETAINED_REASONS.has(reason))
}

function primaryReason(issue: RiskDataIssue): RiskDataIssueReason {
  const reason = issue.reasons.find((candidate) => !RETAINED_REASONS.has(candidate)) ?? issue.reasons[0]
  if (!reason) throw new Error('风险数据问题必须至少包含一个原因')
  return reason
}

export function buildRiskDataRepairQueue(issues: readonly RiskDataIssue[]): RiskDataRepairQueue {
  const ordered = issues
    .map((issue, index) => ({ issue, index }))
    .sort((left, right) => SEVERITY_ORDER[left.issue.severity] - SEVERITY_ORDER[right.issue.severity] || left.index - right.index)
    .map(({ issue }) => {
      const retained = isRetainedRiskIssue(issue)
      return {
        issue,
        retained,
        primaryReason: primaryReason(issue),
        actionKind: issue.severity === 'global' ? 'data-settings' : retained ? 'view-trade' : 'open-trade',
      } satisfies RiskRepairItem
    })

  const groups: RiskRepairGroup[] = []
  for (const item of ordered) {
    const bucket: RiskRepairBucket = item.issue.severity === 'partial' ? 'completeness' : 'priority'
    const key = `${bucket}:${item.primaryReason}`
    let group = groups.find((candidate) => candidate.key === key)
    if (!group) {
      group = { key, bucket, reason: item.primaryReason, retained: item.retained, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }

  const retainedCount = ordered.filter((item) => item.retained).length
  return {
    counts: {
      total: ordered.length,
      global: ordered.filter((item) => item.issue.severity === 'global').length,
      blocking: ordered.filter((item) => item.issue.severity === 'blocking').length,
      partial: ordered.filter((item) => item.issue.severity === 'partial').length,
    },
    retainedCount,
    retainedOnly: ordered.length > 0 && retainedCount === ordered.length,
    items: ordered,
    groups,
    nextItem: ordered.find((item) => !item.retained) ?? null,
  }
}
```

把 `RiskDataIssuesSection.tsx` 中的私有原因文案逻辑迁移为 `riskUnknownReasonPresentation.ts` 的导出函数：

```ts
export function riskDataIssueReasonCopy(reason: RiskDataIssueReason): string {
  return reason.startsWith('partial-')
    ? RISK_PARTIAL_REASON_COPY[reason as RiskPartialReason]
    : RISK_UNKNOWN_REASON_COPY[reason as RiskUnknownReason]
}
```

创建 `useRiskDataIssues.ts`，只集中现有 store 输入，不缓存第二份业务状态：

```ts
import { useMemo } from 'react'
import type { RiskDataIssue } from '@/data/riskManagement'
import { resolveRiskDataIssues } from '@/lib/riskBudget'
import { useStore } from '@/store/useStore'

export function useRiskDataIssues(currentTradingDayKey: string): RiskDataIssue[] {
  const trades = useStore((state) => state.trades)
  const policies = useStore((state) => state.riskPolicyVersions)
  const monthlyLimits = useStore((state) => state.monthlyRiskLimits)
  const liveStatsStartTradingDayKey = useStore((state) => state.liveStatsStartTradingDayKey)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)

  return useMemo(() => resolveRiskDataIssues({
    trades,
    policies,
    monthlyLimits,
    currentTradingDayKey,
    liveStatsStartTradingDayKey,
    tradingDayStartHour,
  }), [trades, policies, monthlyLimits, currentTradingDayKey, liveStatsStartTradingDayKey, tradingDayStartHour])
}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/riskDataRepair.test.ts`

Expected: PASS 三个导出测试。

Run: `pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: Commit the queue model**

```powershell
git add -- src/lib/riskDataRepair.ts src/lib/riskDataRepair.test.ts src/hooks/useRiskDataIssues.ts src/lib/riskUnknownReasonPresentation.ts
git commit -m "feat(risk): model the data repair queue"
```

---

### Task 2: Accept the Repair Center as a Detail Return Source

**Files:**
- Modify: `src/lib/tradeRoute.ts`
- Modify: `src/regression.test.ts`

**Interfaces:**
- Consumes: `TradeDetailFrom` 的 `pathname`、`search` 和 `anchorTradeId`。
- Produces: 实盘详情可返回 `/settings/risk/data-repair?group=...`；案例详情继续回退 `/review-cases`。

- [ ] **Step 1: Add failing route regression assertions**

在 `src/regression.test.ts` 的详情返回测试中加入：

```ts
const riskRepairReturn = resolveTradeDetailReturn({
  from: {
    pathname: '/settings/risk/data-repair',
    search: '?group=priority%3Amissing-loss-pnl',
    anchorTradeId: trade.id,
  },
  tradeKind: 'live',
})
assert(riskRepairReturn.pathname === '/settings/risk/data-repair', '实盘详情必须接受风险修复中心来源')
assert(riskRepairReturn.search === '?group=priority%3Amissing-loss-pnl', '风险修复中心返回必须保留展开分组')

const invalidCaseRepairSource = resolveTradeDetailReturn({
  from: { pathname: '/settings/risk/data-repair', anchorTradeId: trade.id },
  tradeKind: 'case',
})
assert(invalidCaseRepairSource.pathname === '/review-cases', '案例详情不得接受风险修复中心来源')
```

- [ ] **Step 2: Run regression and verify RED**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts`

Expected: FAIL，“实盘详情必须接受风险修复中心来源”。

- [ ] **Step 3: Extend the valid source contract**

在 `isValidDetailSource` 中把风险来源判断收口为：

```ts
if (pathname === '/settings/risk' || pathname === '/settings/risk/data-repair') {
  return tradeKind === 'live'
}
```

- [ ] **Step 4: Verify GREEN**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts`

Expected: PASS，原有列表、案例、周复盘返回合同仍通过。

- [ ] **Step 5: Commit the route contract**

```powershell
git add -- src/lib/tradeRoute.ts src/regression.test.ts
git commit -m "fix(risk): preserve repair center return context"
```

---

### Task 3: Build the Dedicated Repair Center

**Files:**
- Create: `src/views/settings/RiskDataRepairView.tsx`
- Create: `src/views/settings/RiskDataRepairView.css`
- Create: `src/views/settings/RiskDataRepairView.browser.test.tsx`
- Create: `src/views/settings/RiskDataRepairView.browser.test.html`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: Task 1 的 `useRiskDataIssues`、`buildRiskDataRepairQueue`、`riskDataIssueReasonCopy`，Task 2 的详情返回来源合同。
- Produces: `/settings/risk/data-repair`、`data-risk-data-repair-view`、`data-risk-repair-group`、`data-risk-repair-next` 和每行 `data-trade-id`。

- [ ] **Step 1: Write the failing repair center browser test**

创建浏览器测试 Harness，直接进入 `/settings/risk/data-repair`。第一阶段保持风险核算起点有效并注入三笔没有规则版本的实盘记录：缺少亏损盈亏的可修复阻断项、缺少盈利盈亏的可修复完整度项，以及交易事实完整但只有 `missing-policy` 的保留型历史缺口。测试必须断言：

```ts
const view = document.querySelector<HTMLElement>('[data-risk-data-repair-view]')
if (!view) throw new Error('风险数据修复中心没有渲染')
if (!view.textContent?.includes('优先处理') || !view.textContent?.includes('补全数据')) {
  throw new Error('修复中心缺少两级问题区域')
}
if (!view.textContent?.includes('历史风险规则不可回填')) {
  throw new Error('保留型历史缺口缺少真实说明')
}
const next = view.querySelector<HTMLAnchorElement>('[data-risk-repair-next]')
if (!next?.textContent?.includes('处理下一项')) throw new Error('缺少唯一下一项动作')
const expanded = [...view.querySelectorAll<HTMLElement>('[data-risk-repair-group]')]
  .filter((group) => group.getAttribute('data-expanded') === 'true')
if (expanded.length !== 1) throw new Error('修复中心必须只展开一个原因分组')
```

点击另一个分组后断言 URL 含 `group=`；点击交易动作后断言 `location.state.from.pathname` 为 `/settings/risk/data-repair`、`search` 保留当前分组、`anchorTradeId` 是该交易；使用 `tradeReturnLocationState(from)` 返回后，断言对应 `[data-trade-id]` 获得焦点或内部动作获得焦点。

完成混合队列断言后，把 `liveStatsStartTradingDayKey` 更新为当前交易日的下一天。现有 `resolveRiskDataIssues` 在全局起点无效时只返回全局问题，因此第二阶段应断言交易分组消失、“处理下一项”指向 `/settings/data` 且文案为“调整核算起点”，不能期待全局问题与交易问题同时出现。

- [ ] **Step 2: Run browser regressions and verify RED**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: FAIL，新测试页面找不到 `RiskDataRepairView` 或目标路由。

- [ ] **Step 3: Register the lazy child route**

在 `src/App.tsx` 增加懒加载和子路由：

```tsx
const RiskDataRepairView = lazy(() =>
  import('./views/settings/RiskDataRepairView').then((module) => ({ default: module.RiskDataRepairView })),
)

<Route path="risk" element={<RiskManagementSettingsPanel />} />
<Route path="risk/data-repair" element={<RiskDataRepairView />} />
```

保持 `SettingsLayout` 的风险管理 `NavLink` 不使用 `end`，使子路由继续显示风险管理已激活。

- [ ] **Step 4: Implement the page state and single-group accordion**

在 `RiskDataRepairView.tsx` 中使用如下状态合同：

```tsx
const issues = useRiskDataIssues(today)
const queue = useMemo(() => buildRiskDataRepairQueue(issues), [issues])
const [searchParams, setSearchParams] = useSearchParams()
const requestedGroup = searchParams.get('group')
const defaultGroup = queue.groups.find((group) => !group.retained) ?? queue.groups[0] ?? null
const activeGroup = queue.groups.find((group) => group.key === requestedGroup) ?? defaultGroup

function openGroup(key: string) {
  const next = new URLSearchParams(searchParams)
  next.set('group', key)
  setSearchParams(next, { replace: true })
}
```

调用 `useTradeReturnAnchor()`；每个组标题使用真实 `button` 和 `aria-expanded`，每个交易 `article` 使用 `data-trade-id={trade.id}`。所有交易链接传入：

```tsx
state={tradeDetailNavState({
  pathname: '/settings/risk/data-repair',
  search: location.search,
  restoreSearch: location.search,
  anchorTradeId: trade.id,
})}
```

全局项链接 `/settings/data`；可修复交易显示“打开交易”；保留型历史缺口显示“查看交易”和“历史风险规则不可回填，核对交易事实后仍会如实影响完整度”。只有 `queue.nextItem` 存在时渲染主动作“处理下一项”。

- [ ] **Step 5: Implement desktop layout and accessibility**

在 `RiskDataRepairView.css` 中限制正文宽度，组头与交易行使用两列，960px 紧凑窗口改为单列；不要添加低于 960px 的产品适配规则：

```css
.risk-data-repair-view { --settings-content-width: 880px; }
.risk-repair-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: var(--sp-4); }
.risk-repair-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--sp-4); }
.risk-repair-group-toggle:focus-visible,
.risk-repair-action:focus-visible { outline: var(--focus-ring-outline); outline-offset: 2px; }

@media (max-width: 1099px) {
  .risk-repair-hero,
  .risk-repair-row { grid-template-columns: minmax(0, 1fr); align-items: start; }
  .risk-repair-action { justify-self: start; }
}
```

- [ ] **Step 6: Verify the repair center**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/riskDataRepair.test.ts src/regression.test.ts`

Expected: PASS。

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: PASS，新增修复中心测试无控制台错误，现有浏览器测试不回归。

Run: `pnpm typecheck`

Expected: PASS。

- [ ] **Step 7: Commit the repair center**

```powershell
git add -- src/views/settings/RiskDataRepairView.tsx src/views/settings/RiskDataRepairView.css src/views/settings/RiskDataRepairView.browser.test.tsx src/views/settings/RiskDataRepairView.browser.test.html src/App.tsx
git commit -m "feat(risk): add the data repair center"
```

---

### Task 4: Replace the Settings Data Wall with a Compact Summary

**Files:**
- Create: `src/views/settings/RiskDataHealthSummary.tsx`
- Modify: `src/views/settings/RiskManagementSettingsPanel.tsx`
- Modify: `src/views/settings/RiskManagementSettingsPanel.css`
- Modify: `src/views/settings/RiskManagementSettings.browser.test.tsx`
- Delete: `src/views/settings/RiskDataIssuesSection.tsx`

**Interfaces:**
- Consumes: Task 1 的队列模型和 Hook，Task 3 的 `/settings/risk/data-repair`。
- Produces: `data-risk-data-summary`、健康态 `data-risk-data-complete`、“开始修复”或“查看历史缺口”入口。

- [ ] **Step 1: Change the existing browser test to the approved hierarchy**

更新 `RiskManagementSettings.browser.test.tsx` 的风险数据断言：

```ts
const preparation = panel.querySelector<HTMLElement>('[data-risk-preparation]')
const summary = panel.querySelector<HTMLElement>('[data-risk-data-summary]')
if (!preparation || !summary) throw new Error('风险设置页缺少规则或数据摘要')
if (!(preparation.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING)) {
  throw new Error('本周风险规则必须显示在数据摘要之前')
}
if (panel.textContent?.includes('亏损交易缺少盈亏金额')) {
  throw new Error('风险设置页不得继续渲染逐条问题原因')
}
const repairLink = summary.querySelector<HTMLAnchorElement>('a[href="/settings/risk/data-repair"]')
if (repairLink?.textContent?.trim() !== '开始修复') throw new Error('可修复问题必须提供开始修复入口')
```

保留原有每周规则草稿、确认、生效日、隐私模式测试；把全局问题的“调整核算起点”断言迁移到 `RiskDataRepairView.browser.test.tsx`。补充仅历史规则缺口时按钮为“查看历史缺口”，问题归零时出现 `data-risk-data-complete` 且不再存在修复链接。

- [ ] **Step 2: Run browser regressions and verify RED**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: FAIL，设置页顺序仍是数据问题列表在规则之前，且缺少 `data-risk-data-summary`。

- [ ] **Step 3: Implement the compact summary**

创建 `RiskDataHealthSummary.tsx`：读取问题并构建队列，只显示三个独立计数和一个状态句。CTA 规则必须是：

```tsx
const actionLabel = queue.retainedOnly ? '查看历史缺口' : '开始修复'

if (queue.counts.total === 0) {
  return (
    <section className="settings-page-section risk-data-summary" data-risk-data-summary data-risk-data-complete>
      <strong>风险数据完整</strong>
      <span>当前没有需要处理的数据问题</span>
    </section>
  )
}
```

非健康状态显示“全局设置 N”“阻断判断 N”“影响完整度 N”，并用 `<Link to="/settings/risk/data-repair">{actionLabel}</Link>` 进入修复中心。保留型历史缺口说明必须使用“仍会如实影响完整度”，不能使用“已处理”或“可忽略”。

- [ ] **Step 4: Reorder the settings page and remove the old list**

`RiskManagementSettingsPanel.tsx` 的正文顺序改为：

```tsx
<section className="settings-page-section">
  <div className="settings-page-head">
    <h2 className="settings-section-title">本周风险规则</h2>
    <p className="settings-section-desc">修改会保存为草稿；确认后按现有生效规则处理。</p>
  </div>
  <WeeklyRiskPreparationCard currentTradingDayKey={today} />
</section>
<RiskDataHealthSummary currentTradingDayKey={today} />
```

删除 `RiskDataIssuesSection.tsx`。从 `RiskManagementSettingsPanel.css` 删除 `.risk-data-issue-list`、`.risk-data-issue` 和逐行按钮样式，新增紧凑摘要的双列布局，并在现有 `max-width: 1099px` 桌面紧凑断点下改为单列。

- [ ] **Step 5: Verify the settings hierarchy**

Run: `node scripts/run-browser-tests.mjs . vite.config.ts`

Expected: PASS，规则编辑行为保持不变，设置页不再出现逐条问题原因。

Run: `pnpm typecheck`

Expected: PASS。

- [ ] **Step 6: Commit the settings integration**

```powershell
git add -- src/views/settings/RiskDataHealthSummary.tsx src/views/settings/RiskManagementSettingsPanel.tsx src/views/settings/RiskManagementSettingsPanel.css src/views/settings/RiskManagementSettings.browser.test.tsx
git add -u -- src/views/settings/RiskDataIssuesSection.tsx
git commit -m "refactor(risk): move data issues out of settings"
```

---

### Task 5: Add Desktop Visual Coverage and Complete Verification

**Files:**
- Modify: `scripts/desktop-visual-scenarios.mjs`
- Modify: `scripts/fixtures/desktop-visual-matrix.test.mjs`
- Modify only if verified defects require scoped fixes: files from Tasks 1–4.

**Interfaces:**
- Consumes: 完整的风险设置页与修复中心。
- Produces: Windows/macOS 共同使用的 5×24 桌面截图矩阵和完整质量证据。

- [ ] **Step 1: Write the failing visual matrix contract**

在场景列表中预期新增：

```js
['settings-risk', '/settings/risk'],
['settings-risk-repair', '/settings/risk/data-repair'],
['settings-tags', '/settings/tags'],
```

把测试名称从 `exact unique 5 by 23 capture matrix` 改为 `exact unique 5 by 24 capture matrix`。在 `desktop-visual-scenarios.mjs` 尚未新增场景前运行测试。

- [ ] **Step 2: Run the fixture tests and verify RED**

Run: `node --test scripts/fixtures/desktop-visual-matrix.test.mjs`

Expected: FAIL，实际场景列表缺少 `settings-risk-repair`。

- [ ] **Step 3: Register the repair center visual scenario**

在 `settings-risk` 后加入：

```js
Object.freeze({
  id: 'settings-risk-repair',
  path: '/settings/risk/data-repair',
  ready: '.risk-data-repair-view',
}),
```

继续使用现有 `createDesktopVisualSnapshot()`。该快照已有历史实盘交易且没有历史风险规则，能稳定展示保留型历史缺口，不读取用户数据。

- [ ] **Step 4: Verify the visual contract**

Run: `node --test scripts/fixtures/desktop-visual-matrix.test.mjs`

Expected: PASS，矩阵为 5 个桌面窗口乘 24 个场景。

- [ ] **Step 5: Run all automated checks**

Run: `pnpm typecheck`

Expected: PASS。

Run: `pnpm test`

Expected: PASS，所有单元测试和浏览器测试均执行，无 skip/todo。

Run: `pnpm build`

Expected: PASS，Vite 构建与包体预算通过。

- [ ] **Step 6: Run and inspect the desktop visual matrix**

Run: `pnpm qa:desktop-visual`

Expected: 120 个截图全部通过，无控制台错误、页面错误、横向溢出或字号治理错误。

检查 960×640、1280×860、1920×1080 的 `settings-risk.png`：本周风险规则和紧凑摘要均进入首屏，页面没有逐条问题墙。

检查相同尺寸的 `settings-risk-repair.png`：顶部统计和唯一主动作先于队列，单组展开清晰，历史缺口说明不与行操作重叠，设置导航仍高亮“风险管理”。

- [ ] **Step 7: Commit visual governance**

```powershell
git add -- scripts/desktop-visual-scenarios.mjs scripts/fixtures/desktop-visual-matrix.test.mjs
git commit -m "test(risk): cover the repair center visually"
```

- [ ] **Step 8: Confirm the final diff is scoped**

Run: `git status --short`

Expected: 空输出。

Run: `git diff main...HEAD --stat`

Expected: 变更仅包含风险修复中心、风险设置摘要、详情返回合同、对应测试与桌面视觉场景；没有风险计算、持久化和移动端文件变更。
