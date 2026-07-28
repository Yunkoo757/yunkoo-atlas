# Today Workspace Risk Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the heavy Today Workspace risk configuration block with an always-visible, read-only day/week/month status rail, and move weekly risk configuration into Settings.

**Architecture:** Add a pure presentation mapper for risk outcomes, then build a focused `RiskStatusStrip` that consumes the existing `resolveRiskOutcomes` result without owning configuration state. Keep the existing weekly preparation form behavior, but render it only inside a new Settings panel. The risk calculation, live-cycle boundary, persistence schema, trade-open gate, and frozen review evidence remain unchanged.

**Tech Stack:** React 18, TypeScript, Zustand, React Router, existing CSS design tokens, Vite browser regression harness, Playwright mobile QA.

## Global Constraints

- The Today Workspace only displays day, week, and month risk status, consumed R, limit R, a short detail, and one summary sentence.
- Risk configuration and weekly confirmation live under `Settings > 风险管理`.
- Formal implementation reuses existing Trader Atlas fonts, colors, spacing, borders, radii, controls, and responsive conventions.
- Use existing `--bg-*`, `--text-*`, `--border-*`, `--pos`, `--warn-action`, `--neg`, `--sp-*`, and `--radius-*` tokens; do not copy hard-coded Demo colors or type sizes.
- Preserve `resolveRiskOutcomes`, live-cycle classification, persisted schemas, trade-open risk gating, override evidence, and weekly review snapshots.
- `unknown`, `partial`, missing-policy, and unreviewed-week states must never be presented as safe.
- Keep all files UTF-8 without BOM and preserve Chinese text.
- Do not add dependencies, remote fonts, gradients, glow effects, or a second design system.

---

## File Structure

### New files

- `src/lib/riskStatus.ts`: pure mapping from `RiskPeriodOutcomeSnapshot` to display state and summary copy.
- `src/lib/riskStatus.test.ts`: exhaustive state precedence and summary tests.
- `src/components/RiskStatusStrip.tsx`: read-only day/week/month status rail.
- `src/components/RiskStatusStrip.css`: token-only desktop and mobile layout.
- `src/views/settings/RiskManagementSettingsPanel.tsx`: Settings page wrapper for weekly risk preparation.
- `src/views/settings/RiskManagementSettingsPanel.css`: Settings-specific flattening and responsive rules.
- `src/views/settings/RiskManagementSettings.browser.test.html`: browser-test entry.
- `src/views/settings/RiskManagementSettings.browser.test.tsx`: real form, route, confirmation, and privacy behavior tests.
- `src/components/RiskStatusStrip.design.test.ts`: source-level contract for token use and read-only responsibility.

### Modified files

- `src/views/TodayWorkspace.tsx`: replace the budget card, remove inline weekly preparation, and keep the primary action independent of review state.
- `src/views/settings/SettingsLayout.tsx`: add the “风险管理” navigation item.
- `src/App.tsx`: lazy-load and route `/settings/risk`.
- `src/components/RiskManagement.browser.test.tsx`: replace old budget-card/workspace-form assertions with status-rail assertions while preserving gate tests.
- `src/views/TodayWorkspace.design.test.ts`: remove contracts tied to the deleted budget card.
- `scripts/qa-risk-management-mobile.mjs`: validate the status rail and Settings form at 420×844.

### Deleted files

- `src/components/RiskBudgetCard.tsx`: replaced by the read-only strip.
- `src/components/RiskBudgetCard.css`: replaced by token-only strip styles.

### Retained files

- `src/components/WeeklyRiskPreparationCard.tsx`: keep existing draft, validation, confirmation, and future-effective policy behavior; render it only from Settings.
- `src/components/WeeklyRiskPreparationCard.css`: keep field and form behavior; Settings wrapper removes the old standalone-card surface.

---

### Task 1: Freeze risk-status presentation semantics

**Files:**
- Create: `src/lib/riskStatus.ts`
- Create: `src/lib/riskStatus.test.ts`

**Interfaces:**
- Consumes: `RiskPeriodOutcomeSnapshot` from `src/data/riskManagement.ts`.
- Produces: `RiskStatusKind`, `RiskStatusPresentation`, `presentRiskOutcome(outcome)`, and `summarizeRiskStatus(rows)` for the strip component and tests.

- [ ] **Step 1: Write the failing presentation tests**

Create `src/lib/riskStatus.test.ts` with explicit fixtures and precedence checks:

```ts
import type { RiskPeriodOutcomeSnapshot } from '@/data/riskManagement'
import {
  presentRiskOutcome,
  summarizeRiskStatus,
  type RiskStatusRow,
} from '@/lib/riskStatus'

function outcome(patch: Partial<RiskPeriodOutcomeSnapshot> = {}): RiskPeriodOutcomeSnapshot {
  return {
    netBudgetR: -0.8,
    limitR: 2,
    consumedR: 0.8,
    remainingR: 1.2,
    progress: 0.4,
    coverage: 'complete',
    triggered: false,
    includedTradeCount: 1,
    excludedTradeCount: 0,
    unknownReasons: [],
    ...patch,
  }
}

export function testRiskStatusPresentationUsesFailClosedPrecedence(): void {
  if (presentRiskOutcome(outcome({ limitR: 0 })).kind !== 'unconfigured') {
    throw new Error('invalid limit must be unconfigured')
  }
  if (presentRiskOutcome(outcome({ coverage: 'unknown' })).kind !== 'unknown') {
    throw new Error('unknown coverage must not be presented as safe')
  }
  if (presentRiskOutcome(outcome({ coverage: 'partial', triggered: true, progress: 1 })).kind !== 'triggered') {
    throw new Error('a confirmed breach must outrank partial coverage')
  }
  if (presentRiskOutcome(outcome({ coverage: 'partial' })).kind !== 'partial') {
    throw new Error('partial coverage must require confirmation')
  }
  if (presentRiskOutcome(outcome({ progress: 0.9 })).kind !== 'near') {
    throw new Error('90 percent must be near the limit')
  }
  if (presentRiskOutcome(outcome()).kind !== 'normal') {
    throw new Error('complete low usage must be normal')
  }
}

export function testRiskStatusSummaryKeepsPeriodOrderAndNamesSafePeriods(): void {
  const rows: RiskStatusRow[] = [
    { periodLabel: '今日', presentation: presentRiskOutcome(outcome({ triggered: true, progress: 1 })) },
    { periodLabel: '本周', presentation: presentRiskOutcome(outcome()) },
    { periodLabel: '本月', presentation: presentRiskOutcome(outcome({ coverage: 'partial' })) },
  ]
  const summary = summarizeRiskStatus(rows)
  if (summary !== '今日已超限，本月数据待确认；本周仍在限额内。') {
    throw new Error(`unexpected summary: ${summary}`)
  }
  const allNormal = rows.map((row) => ({
    ...row,
    presentation: presentRiskOutcome(outcome()),
  }))
  if (summarizeRiskStatus(allNormal) !== '日、周、月均在风险限额内。') {
    throw new Error('all-normal summary must remain stable')
  }
}
```

- [ ] **Step 2: Run the focused unit test and verify failure**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/riskStatus.test.ts
```

Expected: the build fails because `@/lib/riskStatus` does not exist.

- [ ] **Step 3: Implement the pure mapping**

Create `src/lib/riskStatus.ts`:

```ts
import type { RiskPeriodOutcomeSnapshot } from '@/data/riskManagement'

export type RiskStatusKind =
  | 'normal'
  | 'near'
  | 'triggered'
  | 'partial'
  | 'unknown'
  | 'unconfigured'

export interface RiskStatusPresentation {
  kind: RiskStatusKind
  label: '正常' | '接近限额' | '已超限' | '待确认' | '无法判断' | '未配置'
}

export interface RiskStatusRow {
  periodLabel: string
  presentation: RiskStatusPresentation
}

export function presentRiskOutcome(outcome: RiskPeriodOutcomeSnapshot): RiskStatusPresentation {
  if (outcome.limitR <= 0) return { kind: 'unconfigured', label: '未配置' }
  if (outcome.coverage === 'unknown') return { kind: 'unknown', label: '无法判断' }
  if (outcome.triggered || outcome.progress >= 1) return { kind: 'triggered', label: '已超限' }
  if (outcome.coverage === 'partial') return { kind: 'partial', label: '待确认' }
  if (outcome.progress >= 0.9) return { kind: 'near', label: '接近限额' }
  return { kind: 'normal', label: '正常' }
}

function issueCopy(row: RiskStatusRow): string | null {
  switch (row.presentation.kind) {
    case 'triggered': return `${row.periodLabel}已超限`
    case 'near': return `${row.periodLabel}接近限额`
    case 'partial': return `${row.periodLabel}数据待确认`
    case 'unknown': return `${row.periodLabel}无法判断`
    case 'unconfigured': return `${row.periodLabel}未配置`
    case 'normal': return null
  }
}

export function summarizeRiskStatus(rows: readonly RiskStatusRow[]): string {
  const issues = rows.map(issueCopy).filter((value): value is string => Boolean(value))
  if (issues.length === 0) return '日、周、月均在风险限额内。'
  const safe = rows
    .filter((row) => row.presentation.kind === 'normal')
    .map((row) => row.periodLabel)
  return `${issues.join('，')}${safe.length > 0 ? `；${safe.join('、')}仍在限额内。` : '。'}`
}
```

- [ ] **Step 4: Run the focused test and verify pass**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/riskStatus.test.ts
```

Expected: both exported tests print `PASS` and the command exits 0.

- [ ] **Step 5: Commit the semantic layer**

```powershell
git add -- src/lib/riskStatus.ts src/lib/riskStatus.test.ts
git commit -m "feat: define compact risk status semantics"
```

---

### Task 2: Build and integrate the read-only status rail

**Files:**
- Create: `src/components/RiskStatusStrip.tsx`
- Create: `src/components/RiskStatusStrip.css`
- Create: `src/components/RiskStatusStrip.design.test.ts`
- Modify: `src/views/TodayWorkspace.tsx:22,268`
- Modify: `src/components/RiskManagement.browser.test.tsx:190-390`
- Modify: `src/views/TodayWorkspace.design.test.ts:46-72,88-102`
- Delete: `src/components/RiskBudgetCard.tsx`
- Delete: `src/components/RiskBudgetCard.css`

**Interfaces:**
- Consumes: `presentRiskOutcome`, `summarizeRiskStatus`, `resolveRiskOutcomes`, existing store fields, and `currentTradingDayKey?: string`.
- Produces: `RiskStatusStrip({ currentTradingDayKey })`, `[data-risk-status]`, three `[data-risk-period]` nodes, and one recovery link when attention is required.

- [ ] **Step 1: Replace old browser assertions with failing status-rail assertions**

In `src/components/RiskManagement.browser.test.tsx`, retain the existing `trade`, `policy`, `monthlyLimit`, store reset, and trade-open dialog fixtures. Replace budget-card disclosure assertions with:

```ts
const status = document.querySelector<HTMLElement>('[data-risk-status]')
assert(status, '今日工作台缺少风险状态轨道')
assert(status.querySelectorAll('[data-risk-period]').length === 3, '风险状态必须始终展示日周月')
assert(!status.querySelector('details'), '风险状态不得折叠')
assert(!status.textContent?.includes('1R ='), '工作台不得展示 1R 配置说明')
assert(!status.textContent?.includes('计入'), '工作台不得展示风险统计审计明细')

useStore.setState({
  weeklyRiskPreparations: [{
    ...useStore.getState().weeklyRiskPreparations[0]!,
    reviewedAt: confirmedAt,
    confirmedPolicyVersionId: policy.id,
  }],
})
await waitFor(() => !(status.textContent?.includes('本周风险规则尚未确认') ?? true), '已复核状态没有生效')

const cases = [
  {
    name: '正常',
    trades: [trade('target', 'planned')],
    policies: [policy],
    limits: [monthlyLimit],
    expected: ['正常', '日、周、月均在风险限额内。'],
  },
  {
    name: '临界',
    trades: [{ ...trade('near', 'loss'), pnl: -1_800 }],
    policies: [policy],
    limits: [monthlyLimit],
    expected: ['接近限额', '今日接近限额'],
  },
  {
    name: '超限',
    trades: [trade('triggered', 'loss')],
    policies: [policy],
    limits: [monthlyLimit],
    expected: ['已超限', '今日已超限'],
  },
  {
    name: '未知',
    trades: [trade('unknown-loss', 'loss', { unknown: true })],
    policies: [policy],
    limits: [monthlyLimit],
    expected: ['无法判断', '今日无法判断'],
  },
  {
    name: '未配置',
    trades: [],
    policies: [],
    limits: [],
    expected: ['未配置', '今日未配置'],
  },
] as const

for (const fixture of cases) {
  useStore.setState({
    trades: fixture.trades.slice(),
    riskPolicyVersions: fixture.policies.slice(),
    monthlyRiskLimits: fixture.limits.slice(),
  })
  await waitFor(
    () => fixture.expected.every((copy) => status.textContent?.includes(copy)),
    `${fixture.name} 风险状态没有更新`,
  )
}
```

- [ ] **Step 2: Run browser regression and verify failure**

Run:

```powershell
node scripts/run-regression-tests.mjs
```

Expected: `RiskManagement.browser.test.html` fails because `[data-risk-status]` does not exist.

- [ ] **Step 3: Implement `RiskStatusStrip`**

Create `src/components/RiskStatusStrip.tsx` with these exact responsibilities:

```tsx
import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { RiskPeriodOutcomeSnapshot, RiskPeriodScope } from '@/data/riskManagement'
import { weekStartFor } from '@/data/weeklyReviews'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { fmtR } from '@/lib/format'
import { parseLocalDate } from '@/lib/periods'
import { activeRiskPolicy } from '@/lib/riskPolicy'
import { resolveRiskOutcomes } from '@/lib/riskBudget'
import { presentRiskOutcome, summarizeRiskStatus } from '@/lib/riskStatus'
import { useStore } from '@/store/useStore'
import './RiskStatusStrip.css'

const PERIODS: ReadonlyArray<{ scope: RiskPeriodScope; label: string; ariaLabel: string }> = [
  { scope: 'day', label: '今日', ariaLabel: '今日止损预算' },
  { scope: 'week', label: '本周', ariaLabel: '本周止损预算' },
  { scope: 'month', label: '本月', ariaLabel: '本月止损预算' },
]

function formatBudgetR(value: number): string {
  return fmtR(Math.abs(value)).replace(/^\+/, '')
}

function scopedPeriodLabel(
  scope: RiskPeriodScope,
  label: string,
  liveStart: string | null,
  tradingDay: string,
): string {
  if (!liveStart || liveStart > tradingDay) return label
  const periodStart = scope === 'day'
    ? tradingDay
    : scope === 'week'
      ? weekStartFor(parseLocalDate(tradingDay))
      : `${tradingDay.slice(0, 7)}-01`
  return liveStart > periodStart
    ? `${label} · 自${Number(liveStart.slice(5, 7))}月${Number(liveStart.slice(8, 10))}日起`
    : label
}

function detailCopy(outcome: RiskPeriodOutcomeSnapshot): string {
  const status = presentRiskOutcome(outcome)
  if (status.kind === 'unconfigured') return '止损上限未设置'
  if (status.kind === 'unknown') return '需要补齐风险数据'
  if (status.kind === 'partial') return '数据未完整覆盖'
  if (status.kind === 'triggered') {
    return `超出 ${formatBudgetR(Math.max(0, outcome.consumedR - outcome.limitR))}`
  }
  return `剩余 ${formatBudgetR(outcome.remainingR)}`
}

function RiskPeriod({
  label,
  ariaLabel,
  outcome,
}: {
  label: string
  ariaLabel: string
  outcome: RiskPeriodOutcomeSnapshot
}) {
  const presentation = presentRiskOutcome(outcome)
  const percentage = Math.round(Math.min(1, Math.max(0, outcome.progress)) * 100)
  return (
    <div className={`risk-status-period is-${presentation.kind}`} data-risk-period data-risk-state={presentation.kind}>
      <div className="risk-status-period-head">
        <span>{label}</span>
        <strong>{presentation.label}</strong>
      </div>
      <div
        className="risk-status-track"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <div className="risk-status-values">
        <span><strong>{formatBudgetR(outcome.consumedR)}</strong> / {outcome.limitR > 0 ? formatBudgetR(outcome.limitR) : '—'}</span>
        <span>{detailCopy(outcome)}</span>
      </div>
    </div>
  )
}

export function RiskStatusStrip({ currentTradingDayKey }: { currentTradingDayKey?: string }) {
  const liveTradingDay = useLocalDateKey()
  const tradingDay = currentTradingDayKey ?? liveTradingDay
  const trades = useStore((state) => state.trades)
  const policies = useStore((state) => state.riskPolicyVersions)
  const monthlyLimits = useStore((state) => state.monthlyRiskLimits)
  const preparations = useStore((state) => state.weeklyRiskPreparations)
  const liveStatsStartTradingDayKey = useStore((state) => state.liveStatsStartTradingDayKey)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const ensureRiskPeriodRecords = useStore((state) => state.ensureRiskPeriodRecords)

  useEffect(() => ensureRiskPeriodRecords(tradingDay), [ensureRiskPeriodRecords, tradingDay])

  const outcomes = useMemo(() => resolveRiskOutcomes({
    trades,
    policies,
    monthlyLimits,
    currentTradingDayKey: tradingDay,
    liveStatsStartTradingDayKey,
    tradingDayStartHour,
  }), [trades, policies, monthlyLimits, tradingDay, liveStatsStartTradingDayKey, tradingDayStartHour])
  const currentWeek = weekStartFor(parseLocalDate(tradingDay))
  const reviewed = preparations.some((item) =>
    item.weekStart === currentWeek && Boolean(item.reviewedAt && item.confirmedPolicyVersionId))
  const policy = activeRiskPolicy(policies, tradingDay)
  const rows = PERIODS.map((period) => ({
    ...period,
    displayLabel: scopedPeriodLabel(period.scope, period.label, liveStatsStartTradingDayKey, tradingDay),
    outcome: outcomes[period.scope],
    presentation: presentRiskOutcome(outcomes[period.scope]),
  }))
  const needsRecovery = !policy || !reviewed || rows.some((row) =>
    row.presentation.kind === 'unknown' ||
    row.presentation.kind === 'partial' ||
    row.presentation.kind === 'unconfigured')
  const summary = !reviewed
    ? '本周风险规则尚未确认。'
    : summarizeRiskStatus(rows.map((row) => ({
        periodLabel: row.label,
        presentation: row.presentation,
      })))

  return (
    <section className="risk-status-strip" data-risk-status aria-labelledby="risk-status-title">
      <header className="risk-status-head"><h2 id="risk-status-title">风险状态</h2></header>
      <div className="risk-status-periods">
        {rows.map((row) => <RiskPeriod key={row.scope} label={row.displayLabel} ariaLabel={row.ariaLabel} outcome={row.outcome} />)}
      </div>
      <footer className="risk-status-summary">
        <span>{summary}</span>
        {needsRecovery ? <Link to="/settings/risk">前往风险管理</Link> : null}
      </footer>
    </section>
  )
}
```

- [ ] **Step 4: Add token-only A-style layout**

Create `src/components/RiskStatusStrip.css`:

```css
.risk-status-strip {
  margin-top: 14px;
  color: var(--text-body);
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-8);
}
.risk-status-head {
  display: flex;
  min-height: 38px;
  align-items: center;
  padding: 0 var(--sp-3);
  border-bottom: 1px solid var(--border-subtle);
}
.risk-status-head h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--type-section-title-size);
  font-weight: var(--type-section-title-weight);
}
.risk-status-periods { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.risk-status-period { min-width: 0; padding: 11px var(--sp-3) 10px; background: transparent; }
.risk-status-period + .risk-status-period { border-left: 1px solid var(--border-subtle); }
.risk-status-period-head,
.risk-status-values { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.risk-status-period-head span { color: var(--text-secondary); font-size: var(--type-row-size); font-weight: var(--font-weight-semibold); }
.risk-status-period-head strong { color: var(--text-tertiary); font-size: var(--type-row-size); }
.risk-status-track { height: 3px; margin: 9px 0 7px; overflow: hidden; background: var(--bg-inset); border-radius: var(--radius-rounded); }
.risk-status-track > span { display: block; height: 100%; background: var(--pos); }
.risk-status-values { color: var(--text-muted); font-size: var(--type-metadata-size); font-variant-numeric: tabular-nums; }
.risk-status-values strong { color: var(--text-primary); font-family: var(--font-mono); }
.risk-status-period.is-near .risk-status-period-head strong,
.risk-status-period.is-partial .risk-status-period-head strong,
.risk-status-period.is-unknown .risk-status-period-head strong,
.risk-status-period.is-unconfigured .risk-status-period-head strong { color: var(--warn-action); }
.risk-status-period.is-near .risk-status-track > span,
.risk-status-period.is-partial .risk-status-track > span,
.risk-status-period.is-unknown .risk-status-track > span,
.risk-status-period.is-unconfigured .risk-status-track > span { background: var(--warn-action); }
.risk-status-period.is-triggered { background: color-mix(in srgb, var(--neg) 4%, transparent); }
.risk-status-period.is-triggered .risk-status-period-head strong { color: var(--neg); }
.risk-status-period.is-triggered .risk-status-track > span { background: var(--neg); }
.risk-status-summary {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: 0 var(--sp-3);
  color: var(--text-muted);
  font-size: var(--type-metadata-size);
  border-top: 1px solid var(--border-subtle);
}
.risk-status-summary a { color: var(--accent-readable); }
@media (max-width: 899px) {
  .risk-status-periods { grid-template-columns: 1fr; }
  .risk-status-period + .risk-status-period { border-top: 1px solid var(--border-subtle); border-left: 0; }
}
@media (max-width: 768px) {
  .risk-status-summary { min-height: 44px; align-items: flex-start; flex-direction: column; justify-content: center; padding-top: var(--sp-2); padding-bottom: var(--sp-2); }
  .risk-status-summary a { display: inline-flex; min-height: 44px; align-items: center; }
}
```

- [ ] **Step 5: Integrate the strip and remove the budget card**

In `src/views/TodayWorkspace.tsx`, replace the `RiskBudgetCard` import and render:

```tsx
import { RiskStatusStrip } from '@/components/RiskStatusStrip'
```

```tsx
<RiskStatusStrip currentTradingDayKey={today} />
```

Delete `src/components/RiskBudgetCard.tsx` and `src/components/RiskBudgetCard.css`. Update `src/views/TodayWorkspace.design.test.ts` to stop reading the deleted CSS file.

- [ ] **Step 6: Add source-level design contracts**

Create `src/components/RiskStatusStrip.design.test.ts` to assert:

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(file: string): string {
  return readFileSync(path.resolve(file), 'utf8').replace(/\r\n?/g, '\n')
}

export function testRiskStatusStripUsesProjectTokensAndNoConfigurationCopy(): void {
  const source = read('src/components/RiskStatusStrip.tsx')
  const css = read('src/components/RiskStatusStrip.css')
  for (const forbidden of ['修改规则', '1R =', '单笔风险比例', '确认本周规则']) {
    if (source.includes(forbidden)) throw new Error(`risk strip must stay read-only: ${forbidden}`)
  }
  if (/#[0-9a-f]{3,8}\b/i.test(css)) throw new Error('risk strip must not hard-code colors')
  for (const token of ['var(--border-subtle)', 'var(--pos)', 'var(--warn-action)', 'var(--neg)']) {
    if (!css.includes(token)) throw new Error(`risk strip must use ${token}`)
  }
}

export function testRiskStatusStripStacksWithoutHorizontalScrolling(): void {
  const css = read('src/components/RiskStatusStrip.css')
  const mobile = css.slice(css.indexOf('@media (max-width: 899px)'))
  if (!mobile.includes('grid-template-columns: 1fr')) throw new Error('risk periods must stack below 899px')
  if (mobile.includes('overflow-x: auto')) throw new Error('risk periods must not require horizontal scrolling')
}
```

- [ ] **Step 7: Run regressions and verify pass**

Run:

```powershell
node scripts/run-regression-tests.mjs
```

Expected: unit and browser regressions pass; the strip exposes three periods for every fixture and the existing trade-open gate tests remain green.

- [ ] **Step 8: Commit the read-only rail**

```powershell
git add -- src/lib/riskStatus.ts src/components/RiskStatusStrip.tsx src/components/RiskStatusStrip.css src/components/RiskStatusStrip.design.test.ts src/views/TodayWorkspace.tsx src/components/RiskManagement.browser.test.tsx src/views/TodayWorkspace.design.test.ts src/components/RiskBudgetCard.tsx src/components/RiskBudgetCard.css
git commit -m "feat: replace risk budget card with status rail"
```

---

### Task 3: Move weekly risk configuration into Settings

**Files:**
- Create: `src/views/settings/RiskManagementSettingsPanel.tsx`
- Create: `src/views/settings/RiskManagementSettingsPanel.css`
- Create: `src/views/settings/RiskManagementSettings.browser.test.html`
- Create: `src/views/settings/RiskManagementSettings.browser.test.tsx`
- Modify: `src/views/settings/SettingsLayout.tsx:1-16`
- Modify: `src/App.tsx:129-145,413-425`

**Interfaces:**
- Consumes: `WeeklyRiskPreparationCard`, `useLocalDateKey`, existing Settings layout, and existing store actions.
- Produces: `RiskManagementSettingsPanel` at `/settings/risk` and active Settings navigation labeled “风险管理”.

- [ ] **Step 1: Write the failing Settings browser test**

Create the HTML entry with promise key `__riskManagementSettingsBrowserTest`, then create `src/views/settings/RiskManagementSettings.browser.test.tsx`. The empty store state intentionally exercises the component's canonical default draft; mount the real nested route and define the browser helpers in the same file:

```tsx
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SettingsLayout } from '@/views/settings/SettingsLayout'
import { RiskManagementSettingsPanel } from '@/views/settings/RiskManagementSettingsPanel'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window { __riskManagementSettingsBrowserTest?: Promise<void> }
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

function setText(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('浏览器缺少 input value setter')
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  try {
    useStore.setState((state) => ({
      weeklyRiskPreparations: [],
      riskPolicyVersions: [],
      monthlyRiskLimits: [],
      display: { ...state.display, privacyMode: false },
    }))
    root.render(
      <MemoryRouter initialEntries={['/settings/risk']}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="risk" element={<RiskManagementSettingsPanel />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    const active = document.querySelector('.settings-nav-item.is-active')
    if (active?.textContent?.trim() !== '风险管理') throw new Error('风险管理导航没有激活')
    const panel = document.querySelector('[data-risk-management-settings]')
    if (!panel) throw new Error('风险管理设置页没有渲染')
    if (!panel.textContent?.includes('日止损线') || !panel.textContent?.includes('周止损线')) {
      throw new Error('风险管理设置页缺少周期限额')
    }
    if (!panel.textContent?.includes('确认本周规则')) throw new Error('设置页缺少每周确认动作')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__riskManagementSettingsBrowserTest = run()
```

Expected HTML contract:

```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Risk management settings browser test</title></head>
  <body>
    <div id="root"></div>
    <script>
      window.$RefreshReg$ = function () {}
      window.$RefreshSig$ = function () { return function (type) { return type } }
    </script>
    <script type="module" src="/src/views/settings/RiskManagementSettings.browser.test.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Run regressions and verify failure**

Run:

```powershell
node scripts/run-regression-tests.mjs
```

Expected: the new browser page fails because `RiskManagementSettingsPanel` and `/settings/risk` do not exist.

- [ ] **Step 3: Add the Settings panel wrapper**

Create `src/views/settings/RiskManagementSettingsPanel.tsx`:

```tsx
import { WeeklyRiskPreparationCard } from '@/components/WeeklyRiskPreparationCard'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import './RiskManagementSettingsPanel.css'

export function RiskManagementSettingsPanel() {
  const today = useLocalDateKey()
  return (
    <div className="settings-page risk-management-settings" data-risk-management-settings>
      <div className="settings-page-head">
        <h1 className="settings-page-title">风险管理</h1>
        <p className="settings-page-desc">配置资金基准、周期止损限额，并完成本周风险规则确认。</p>
      </div>
      <section className="settings-page-section">
        <div className="settings-page-head">
          <h2 className="settings-section-title">本周风险规则</h2>
          <p className="settings-section-desc">修改会保存为草稿；确认后按现有生效规则处理。</p>
        </div>
        <WeeklyRiskPreparationCard currentTradingDayKey={today} />
      </section>
    </div>
  )
}
```

Create `src/views/settings/RiskManagementSettingsPanel.css`:

```css
.risk-management-settings { max-width: 820px; }
.risk-management-settings .risk-preparation-card {
  margin-top: 0;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
}
.risk-management-settings .risk-preparation-card:not(.is-reviewed) {
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border-subtle);
}
.risk-management-settings .risk-preparation-card.is-reviewed {
  min-height: 52px;
  padding: var(--sp-2) 0;
  border-top: 1px solid var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}
@media (max-width: 768px) {
  .risk-management-settings .risk-preparation-card.is-reviewed { min-height: 56px; }
}
```

- [ ] **Step 4: Add navigation and route**

In `src/views/settings/SettingsLayout.tsx`, import `Shield` from `@/icons/appIcons` and insert:

```ts
{ to: '/settings/risk', label: '风险管理', icon: Shield },
```

Place it after “策略” and before taxonomy settings.

In `src/App.tsx`, add the lazy import and nested route:

```tsx
const RiskManagementSettingsPanel = lazy(() =>
  import('./views/settings/RiskManagementSettingsPanel').then((module) => ({ default: module.RiskManagementSettingsPanel })),
)
```

```tsx
<Route path="risk" element={<RiskManagementSettingsPanel />} />
```

- [ ] **Step 5: Extend the Settings browser test with confirmation and privacy checks**

Using the `setText` and `waitFor` helpers defined in Step 1, insert these assertions before the `finally` block:

```ts
const panel = document.querySelector<HTMLElement>('[data-risk-management-settings]')!
const daily = [...panel.querySelectorAll('label')]
  .find((label) => label.textContent?.includes('日止损线'))
  ?.querySelector<HTMLInputElement>('input')
if (!daily) throw new Error('设置页缺少日止损线输入')
setText(daily, '2.5')
const confirm = [...panel.querySelectorAll<HTMLButtonElement>('button')]
  .find((button) => button.textContent?.trim() === '确认本周规则')
if (!confirm) throw new Error('设置页缺少确认按钮')
confirm.click()
await waitFor(() => panel.textContent?.includes('本周风险规则已复核') ?? false, '设置页确认没有完成')
if (panel.querySelector('input')) throw new Error('确认后设置页必须回到只读摘要')
```

Set `display.privacyMode` to `true`, enter edit mode, and assert the capital and 1R inputs remain `type="password"` as in the current browser contract.

- [ ] **Step 6: Run regressions and verify pass**

Run:

```powershell
node scripts/run-regression-tests.mjs
```

Expected: the new Settings browser page passes, and existing browser pages remain green.

- [ ] **Step 7: Commit the Settings migration surface**

```powershell
git add -- src/views/settings/RiskManagementSettingsPanel.tsx src/views/settings/RiskManagementSettingsPanel.css src/views/settings/RiskManagementSettings.browser.test.html src/views/settings/RiskManagementSettings.browser.test.tsx src/views/settings/SettingsLayout.tsx src/App.tsx
git commit -m "feat: move weekly risk setup into settings"
```

---

### Task 4: Remove configuration responsibility from Today Workspace

**Files:**
- Modify: `src/views/TodayWorkspace.tsx:1-100,170-205,267-268`
- Modify: `src/components/RiskManagement.browser.test.tsx:190-560`
- Modify: `src/components/RiskStatusStrip.tsx`

**Interfaces:**
- Consumes: `RiskStatusStrip` recovery state and existing composer/risk-gate flow.
- Produces: a Today Workspace with no risk form, stable queue-first heading, always-visible primary action, and one Settings recovery link when weekly preparation is missing.

- [ ] **Step 1: Change the browser contract to the final workspace responsibility**

Add these assertions after rendering `TodayWorkspace` with an unreviewed preparation:

```ts
assert(!document.querySelector('[data-risk-preparation]'), '工作台不得渲染风险配置表单')
assert(!document.body.textContent?.includes('修改规则'), '工作台不得提供规则编辑动作')
assert(!document.body.textContent?.includes('确认本周规则'), '工作台不得提供每周确认动作')
assert(document.querySelector('.today-focus .empty-btn'), '工作台主动作不得因未复核而消失')
const status = document.querySelector<HTMLElement>('[data-risk-status]')
assert(status?.textContent?.includes('本周风险规则尚未确认'), '风险轨道必须说明未复核状态')
assert(
  status.querySelector<HTMLAnchorElement>('a[href="/settings/risk"]')?.textContent?.trim() === '前往风险管理',
  '未复核状态必须提供唯一设置恢复动作',
)
```

Retain all existing `TradeOpenRiskDialog` assertions to prove that simplifying the workspace does not relax the actual gate.

- [ ] **Step 2: Run regressions and verify failure**

Run:

```powershell
node scripts/run-regression-tests.mjs
```

Expected: the workspace browser test fails because `WeeklyRiskPreparationCard` is still rendered and the primary action is still conditional.

- [ ] **Step 3: Remove weekly preparation state and rendering from `TodayWorkspace`**

Remove these imports and selectors:

```ts
import { parseLocalDate } from '@/lib/periods'
import { weekStartFor } from '@/data/weeklyReviews'
import { WeeklyRiskPreparationCard } from '@/components/WeeklyRiskPreparationCard'
```

Remove `weeklyRiskPreparations` and the `riskReviewed` memo. Replace the focus copy with queue-only logic:

```tsx
<h1 id="today-focus-title">
  {buckets.actionCount > 0 ? `还有 ${buckets.actionCount} 项需要处理` : '今日交易已完成闭环'}
</h1>
<p>
  {buckets.actionCount > 0
    ? buckets.historicalActionCount > 0
      ? `其中 ${buckets.historicalActionCount} 项来自此前遗留；先补齐结果，再完成复盘。`
      : '按执行、结果、复盘的顺序完成闭环；统计会自动保持可信。'
    : '没有遗留的平仓结果或复盘任务，可以开始记录新机会。'}
</p>
```

Render the primary action without a review condition:

```tsx
<button type="button" className="empty-btn" onClick={() => openComposer()}>
  <Plus size={15} />
  新建交易
</button>
```

Delete both `WeeklyRiskPreparationCard` render sites. Keep one `RiskStatusStrip` after the action queue.

- [ ] **Step 4: Verify gate behavior remains fail-closed**

Run the regression suite and explicitly inspect these existing test names in output:

```powershell
node scripts/run-regression-tests.mjs
```

Expected output includes passing risk-gate integration tests and `PASS src/components/RiskManagement.browser.test.html`. No test may reintroduce direct configuration on the workspace.

- [ ] **Step 5: Commit the responsibility split**

```powershell
git add -- src/views/TodayWorkspace.tsx src/components/RiskManagement.browser.test.tsx src/components/RiskStatusStrip.tsx
git commit -m "refactor: keep risk configuration out of workspace"
```

---

### Task 5: Lock visual consistency, mobile behavior, and release quality

**Files:**
- Modify: `scripts/qa-risk-management-mobile.mjs:35-120`
- Modify: `src/components/RiskStatusStrip.design.test.ts`
- Modify: `src/views/TodayWorkspace.design.test.ts`

**Interfaces:**
- Consumes: final desktop strip, Settings panel, existing Playwright fixture server, and project quality commands.
- Produces: mobile evidence, source-level style contracts, clean build, and review-ready branch.

- [ ] **Step 1: Replace mobile card measurements with strip measurements**

In `scripts/qa-risk-management-mobile.mjs`, change the workspace fixture evaluation to require:

```js
const status = document.querySelector('[data-risk-status]')
const periods = document.querySelector('.risk-status-periods')
const recovery = status?.querySelector('a[href="/settings/risk"]')
if (!status || !periods) return null
const statusRect = status.getBoundingClientRect()
const recoveryRect = recovery?.getBoundingClientRect()
return {
  periodColumns: getComputedStyle(periods).gridTemplateColumns.split(' ').length,
  statusOverflow: status.scrollWidth > status.clientWidth,
  statusWithinViewport: statusRect.left >= 0 && statusRect.right <= window.innerWidth,
  recoveryHeight: recoveryRect?.height ?? null,
}
```

Assert:

```js
assert.equal(layout.periodColumns, 1, '风险状态在 420px 必须为单列')
assert.equal(layout.statusOverflow, false, '风险状态不得横向溢出')
assert.equal(layout.statusWithinViewport, true, '风险状态必须完整位于 viewport 内')
if (layout.recoveryHeight != null) assert.ok(layout.recoveryHeight >= 44, '风险恢复动作不得小于 44px')
```

Add a second mobile fixture for `/settings/risk` and assert the existing preparation form remains one column, action buttons remain reachable, and privacy inputs do not overflow.

- [ ] **Step 2: Strengthen design-token contracts**

Extend `src/components/RiskStatusStrip.design.test.ts` to reject page-level font overrides, hard-coded color literals, gradients, and large normal-state fills:

```ts
for (const forbidden of ['font-family: Inter', 'linear-gradient', 'radial-gradient', 'box-shadow: 0 0']) {
  if (css.includes(forbidden)) throw new Error(`risk strip must follow the existing design system: ${forbidden}`)
}
if (/\.risk-status-period\.is-normal[^}]*background:/s.test(css)) {
  throw new Error('normal periods must not add a colored surface')
}
```

Update `TodayWorkspace.design.test.ts` so no assertion references `RiskBudgetCard.css`, while retaining queue, typography, divider, accent, and mobile overflow contracts.

- [ ] **Step 3: Run focused mobile QA**

Run:

```powershell
pnpm qa:risk-management-mobile
```

Expected: `PASS: risk management and live cycle mobile QA at 420×844` with no browser diagnostics.

- [ ] **Step 4: Run the complete test suite**

Run:

```powershell
pnpm test
```

Expected: identity tests, quality Node tests, unit tests, browser tests, mobile QA, and governance all pass with exit code 0.

- [ ] **Step 5: Build the application**

Run:

```powershell
pnpm build
```

Expected: TypeScript, Vite build, and bundle-budget checks pass with exit code 0.

- [ ] **Step 6: Verify repository hygiene**

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` exits 0. `git status --short` lists only the intended Task 5 files before commit.

- [ ] **Step 7: Commit final QA contracts**

```powershell
git add -- scripts/qa-risk-management-mobile.mjs src/components/RiskStatusStrip.design.test.ts src/views/TodayWorkspace.design.test.ts
git commit -m "test: lock compact risk status design"
```

- [ ] **Step 8: Perform final UI acceptance**

Open the Electron app at desktop width and 420×844, then verify:

1. Current data: 今日 is “已超限”; 本周 and 本月 are “正常”.
2. All-normal data: the rail remains visible and visually quieter than the action queue.
3. Near-limit data: only the affected period uses `--warn-action`.
4. Unknown or partial data: no period is labeled safe and one recovery action is visible.
5. Unreviewed week: the workspace has no form and links to `Settings > 风险管理`.
6. Settings: the weekly draft, edit, confirmation, future-effective copy, and privacy behavior still work.
7. Trade-open gate: breach and unknown cases still require an explicit reason.

Document any mismatch before declaring the branch complete.
