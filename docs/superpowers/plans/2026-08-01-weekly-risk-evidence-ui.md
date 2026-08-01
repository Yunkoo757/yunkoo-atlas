# 周复盘风控决策界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已冻结的周复盘风控证据重排为“本周决策优先、月度状态次之、每日轨迹与审计信息下沉”的可扫描界面。

**Architecture:** 风险数值继续使用 `WeeklyRiskReviewSnapshot`，不改计算与冻结流程。新增纯展示映射模块和聚焦的 `WeeklyRiskEvidence` 组件，`WeeklyReviewView` 只负责传入快照；结构测试、设计 token 合同和多视口浏览器测试分别守住语义、视觉约束与响应式。

**Tech Stack:** React 18、TypeScript 5.6、Zustand、React Router、Vite 8、自定义 SSR 单元测试与 Playwright 浏览器回归。

## Global Constraints

- 不改变风险预算、覆盖状态、触线判断或周复盘冻结口径。
- 本周风险状态必须先于月度状态、每日轨迹和冻结审计证据。
- 状态优先级固定为：`triggered` → `coverage === 'unknown'` → `coverage === 'partial'` → `未触线`。
- 只使用 `--bg-surface/elevated/inset`、`--border-subtle/default/strong`、`--text-strong/body/muted/faint`、`--neg/warn/pos/accent`、`--sp-1` 至 `--sp-8`、`--radius-6/8/10`、`--type-section-title-*`、`--type-body-size`、`--type-metadata-*` 与 `--font-mono`。
- 风控样式不得新增页面私有颜色、字号、间距、圆角或阴影值。
- 颜色必须同时配套可读文字状态，不得只靠颜色表达。
- 375、768、1280、1920 宽度不得裁切、重叠或横向滚动。
- 所有新增和修改文件保持 UTF-8 无 BOM，并完整保留简体中文。

---

## File Map

- Create: `src/lib/weeklyRiskPresentation.ts` — 将冻结 outcome 与 policy 映射为稳定的展示文案、tone 和进度值。
- Create: `src/lib/weeklyRiskPresentation.test.ts` — 覆盖状态优先级、进度钳制与规则摘要。
- Create: `src/views/WeeklyRiskEvidence.tsx` — 只读渲染双周期决策带、每日轨迹和两个审计折叠区。
- Create: `src/views/WeeklyRiskEvidence.test.tsx` — 用静态 React 标记验证信息顺序、默认折叠和无空白补位。
- Modify: `src/views/WeeklyReviewView.tsx:72-118` — 删除旧 `RiskOutcome`/`WeeklyRiskEvidence` 内联实现并接入新组件。
- Modify: `src/views/WeeklyReviewView.css:18-24,42-43` — 删除风控对通用 `.wr-metric-grid` 的依赖，新增 token-only 风控结构与响应式。
- Create: `src/views/WeeklyReviewRisk.design.test.ts` — 静态检查风控选择器只消费批准的 token，不出现私有视觉值。
- Modify: `src/views/WeeklyReviewView.browser.test.tsx:80-122,204-219` — 补齐四种状态、结构顺序、折叠交互与溢出断言。
- Modify: `src/views/WeeklyReviewView.browser.test.html:3-7` — 注册 1920、1280、768、375 四组浏览器视口。

### Task 1: 冻结风险展示语义

**Files:**
- Create: `src/lib/weeklyRiskPresentation.ts`
- Create: `src/lib/weeklyRiskPresentation.test.ts`

**Interfaces:**
- Consumes: `RiskPeriodOutcomeSnapshot`、`RiskPolicyVersion`。
- Produces:
  - `type WeeklyRiskTone = 'positive' | 'warning' | 'negative'`
  - `getWeeklyRiskStatus(outcome): { label: string; hint: string; tone: WeeklyRiskTone }`
  - `clampRiskProgress(progress: number): number`
  - `summarizeRiskPolicies(policies: RiskPolicyVersion[]): string`

- [ ] **Step 1: 写状态优先级、进度和规则摘要失败测试**

```ts
import type { RiskPeriodOutcomeSnapshot, RiskPolicyVersion } from '@/data/riskManagement'
import {
  clampRiskProgress,
  getWeeklyRiskStatus,
  summarizeRiskPolicies,
} from '@/lib/weeklyRiskPresentation'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function outcome(overrides: Partial<RiskPeriodOutcomeSnapshot> = {}): RiskPeriodOutcomeSnapshot {
  return {
    netBudgetR: -1,
    limitR: 5,
    consumedR: 1,
    remainingR: 4,
    progress: 0.2,
    coverage: 'complete',
    triggered: false,
    includedTradeCount: 1,
    excludedTradeCount: 0,
    unknownReasons: [],
    ...overrides,
  }
}

export function testWeeklyRiskStatusUsesApprovedPriorityAndWords(): void {
  assert(getWeeklyRiskStatus(outcome({ triggered: true, coverage: 'unknown' })).label === '已触线', '触线必须优先')
  assert(getWeeklyRiskStatus(outcome({ coverage: 'unknown' })).label === '无法确认', '未知覆盖文案错误')
  assert(getWeeklyRiskStatus(outcome({ coverage: 'partial' })).label === '部分覆盖', '部分覆盖文案错误')
  assert(getWeeklyRiskStatus(outcome()).label === '未触线', '完整未触线文案错误')
}

export function testWeeklyRiskProgressIsFiniteAndClamped(): void {
  assert(clampRiskProgress(-1) === 0, '负进度必须钳制为 0')
  assert(clampRiskProgress(0.35) === 0.35, '合法进度不得改写')
  assert(clampRiskProgress(2) === 1, '超限进度必须钳制为 1')
  assert(clampRiskProgress(Number.NaN) === 0, '非法进度必须安全回退')
}

export function testRiskPolicySummaryUsesCountAndEffectiveRange(): void {
  const policies = [
    { id: 'p1', effectiveTradingDay: '2026-07-27' },
    { id: 'p2', effectiveTradingDay: '2026-07-29' },
  ] as RiskPolicyVersion[]
  assert(summarizeRiskPolicies([]) === '当周没有生效规则', '空规则摘要错误')
  assert(summarizeRiskPolicies(policies) === '2 个版本 · 07-27 至 07-29', '规则日期摘要错误')
}
```

- [ ] **Step 2: 运行定向测试并确认红灯**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyRiskPresentation.test.ts`

Expected: FAIL，错误包含 `Could not resolve "@/lib/weeklyRiskPresentation"`。

- [ ] **Step 3: 写最小展示映射实现**

```ts
import type { RiskPeriodOutcomeSnapshot, RiskPolicyVersion } from '@/data/riskManagement'

export type WeeklyRiskTone = 'positive' | 'warning' | 'negative'

export function getWeeklyRiskStatus(outcome: RiskPeriodOutcomeSnapshot): {
  label: string
  hint: string
  tone: WeeklyRiskTone
} {
  if (outcome.triggered) return { label: '已触线', hint: '已达到冻结限制', tone: 'negative' }
  if (outcome.coverage === 'unknown') return { label: '无法确认', hint: '数据不完整，不能判断是否安全', tone: 'warning' }
  if (outcome.coverage === 'partial') return { label: '部分覆盖', hint: '按保守数值展示', tone: 'warning' }
  return { label: '未触线', hint: '风险空间仍可用', tone: 'positive' }
}

export function clampRiskProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
}

export function summarizeRiskPolicies(policies: RiskPolicyVersion[]): string {
  if (policies.length === 0) return '当周没有生效规则'
  const dates = policies.map((policy) => policy.effectiveTradingDay).sort()
  const short = (value: string) => value.slice(5)
  return policies.length === 1
    ? `1 个版本 · ${short(dates[0]!)}`
    : `${policies.length} 个版本 · ${short(dates[0]!)} 至 ${short(dates[dates.length - 1]!)}`
}
```

- [ ] **Step 4: 重跑定向测试并确认绿灯**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyRiskPresentation.test.ts`

Expected: 三个导出测试均 PASS。

- [ ] **Step 5: 提交展示语义**

```powershell
git add -- src/lib/weeklyRiskPresentation.ts src/lib/weeklyRiskPresentation.test.ts
git commit -m "test: define weekly risk presentation semantics"
```

### Task 2: 双周期决策带、每日轨迹和审计层

**Files:**
- Create: `src/views/WeeklyRiskEvidence.tsx`
- Create: `src/views/WeeklyRiskEvidence.test.tsx`
- Modify: `src/views/WeeklyReviewView.tsx:28-30,72-118`

**Interfaces:**
- Consumes: Task 1 的 `getWeeklyRiskStatus`、`clampRiskProgress`、`summarizeRiskPolicies`，以及 `WeeklyRiskReviewSnapshot`。
- Produces: `WeeklyRiskEvidence({ snapshot }: { snapshot: WeeklyRiskReviewSnapshot }): JSX.Element`。

- [ ] **Step 1: 写结构顺序和折叠行为失败测试**

在 `src/views/WeeklyRiskEvidence.test.tsx` 写入完整冻结快照 fixture：

```ts
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { RiskPeriodOutcomeSnapshot, WeeklyRiskReviewSnapshot } from '@/data/riskManagement'
import { WeeklyRiskEvidence } from '@/views/WeeklyRiskEvidence'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const complete: RiskPeriodOutcomeSnapshot = {
  netBudgetR: -1,
  limitR: 5,
  consumedR: 1,
  remainingR: 4,
  progress: 0.2,
  coverage: 'complete',
  triggered: false,
  includedTradeCount: 1,
  excludedTradeCount: 0,
  unknownReasons: [],
}
const snapshot: WeeklyRiskReviewSnapshot = {
  frozenAt: '2026-08-01T12:00:00.000Z',
  policyVersions: [{
    id: 'policy-1', sourceWeekStart: '2026-07-27', effectiveTradingDay: '2026-07-27',
    capitalBase: 10_000, riskPercent: 1, riskAmount: 100,
    dailyLossLimitR: 2, weeklyLossLimitR: 5, monthlyLossLimitRDefault: 10,
    disciplineText: '触线后停止开仓', confirmedAt: '2026-07-27T07:00:00.000Z',
  }],
  dailyOutcomes: [
    { ...complete, date: '2026-07-27' },
    { ...complete, netBudgetR: -2, consumedR: 2, remainingR: 3, progress: 0.4, date: '2026-07-28' },
  ],
  weeklyOutcome: complete,
  monthlyOutcomeAtCompletion: { ...complete, limitR: 10, remainingR: 9, progress: 0.1 },
  overrideEvents: [{
    id: 'override-1', tradeId: 'trade-1',
    tradeIdentityAtDecision: { ref: 'TRD-1', symbol: 'BTCUSDT', tradeKind: 'live' },
    linkState: 'resolved', decisionType: 'triggered', tradingDayKeyAtDecision: '2026-07-28',
    policyVersionId: 'policy-1', createdAt: '2026-07-28T10:00:00.000Z',
    reason: '只执行预设止损', fingerprint: 'fixture',
    outcomesAtDecision: { day: complete, week: complete, month: complete }, unknownReasons: [],
  }],
}

export function testWeeklyRiskEvidenceUsesDecisionFirstStructure(): void {
const html = renderToStaticMarkup(
  <MemoryRouter><WeeklyRiskEvidence snapshot={snapshot} /></MemoryRouter>,
)
const weekly = html.indexOf('本周风险状态')
const monthly = html.indexOf('完成时月度状态')
const daily = html.indexOf('每日风险轨迹')
const audit = html.indexOf('冻结审计')
assert(weekly >= 0 && weekly < monthly && monthly < daily && daily < audit, '信息优先级错误')
assert((html.match(/class="wr-risk-day"/g) ?? []).length === snapshot.dailyOutcomes.length, '每日行必须一日一行')
assert(html.includes('<details class="wr-risk-audit"'), '规则和确认必须使用原生 details')
assert(!html.includes('<details class="wr-risk-audit" open=""'), '审计层默认必须收起')
assert(!html.includes('wr-metric-grid'), '风控区不得继续使用等权指标网格')
}
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/WeeklyRiskEvidence.test.tsx`

Expected: FAIL，错误包含 `Could not resolve "@/views/WeeklyRiskEvidence"`。

- [ ] **Step 3: 实现聚焦组件并替换旧内联实现**

组件固定输出以下语义结构；精确 R 值继续调用 `fmtR`，进度通过 CSS 自定义属性传递钳制后的百分比：

```tsx
function PeriodDecision({ label, outcome, primary = false }: PeriodDecisionProps) {
  const status = getWeeklyRiskStatus(outcome)
  const progress = clampRiskProgress(outcome.progress)
  const style = { '--risk-progress': `${progress * 100}%` } as CSSProperties
  return (
    <article className={`wr-risk-period${primary ? ' is-primary' : ''}`} data-risk-tone={status.tone}>
      <div className="wr-risk-period-head"><span>{label}</span><strong>{status.label}</strong></div>
      <div className="wr-risk-remaining"><b>{fmtR(outcome.remainingR)}</b><span>剩余</span></div>
      <p>{fmtR(outcome.consumedR)} 已使用 / {fmtR(outcome.limitR)} 限制</p>
      <div
        className="wr-risk-track"
        style={style}
        role="progressbar"
        aria-label={`已使用 ${fmtR(outcome.consumedR)}，限制 ${fmtR(outcome.limitR)}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <i aria-hidden />
      </div>
      <small>{status.hint}</small>
    </article>
  )
}
```

`WeeklyRiskEvidence` 的直接子层按下列固定顺序实现：

1. `.wr-section-head`；
2. `.wr-risk-decisions`，本周 `primary`、月度次位；
3. `.wr-risk-daily`，标题“每日风险轨迹”，每个 snapshot outcome 对应一个 `.wr-risk-day`；
4. `.wr-risk-audits`，包含“规则版本”和“继续交易确认”两个原生 `<details>`。

规则 summary 使用 `summarizeRiskPolicies`；展开内容逐项显示 `effectiveTradingDay`、`disciplineText || '未填写纪律文本'` 与完整 `id`。确认 summary 为 `本周无继续交易确认` 或 `${count} 条继续交易确认`；展开内容保留冻结身份、关联状态和现有 `tradeDetailPath` 链接逻辑。

在 `WeeklyReviewView.tsx` 删除 `RISK_COVERAGE_META`、`RiskOutcome` 和内联 `WeeklyRiskEvidence`，改为：

```tsx
import { WeeklyRiskEvidence } from '@/views/WeeklyRiskEvidence'
```

- [ ] **Step 4: 重跑组件测试与类型检查**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/WeeklyRiskEvidence.test.tsx src/lib/weeklyRiskPresentation.test.ts`

Expected: 两个文件全部 PASS。

Run: `pnpm typecheck`

Expected: PASS，无未使用 import 和 JSX 类型错误。

- [ ] **Step 5: 提交结构重排**

```powershell
git add -- src/views/WeeklyRiskEvidence.tsx src/views/WeeklyRiskEvidence.test.tsx src/views/WeeklyReviewView.tsx
git commit -m "feat: restructure weekly risk evidence"
```

### Task 3: Token-only 风控样式合同

**Files:**
- Modify: `src/views/WeeklyReviewView.css:18-24,42-43`
- Create: `src/views/WeeklyReviewRisk.design.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `wr-risk-*` 类名和 `data-risk-tone`。
- Produces: 两列/单列响应式布局以及静态 token 合同测试。

- [ ] **Step 1: 写样式合同失败测试**

测试读取 `WeeklyReviewView.css`，收集所有包含 `.wr-risk-` 的规则块，并执行这些断言：

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'

function riskRuleBlocks(source: string): string[] {
  const blocks: string[] = []
  const starts = /([^{}]+)\{/g
  let match: RegExpExecArray | null
  while ((match = starts.exec(source)) !== null) {
    if (!match[1]?.includes('.wr-risk-')) continue
    const open = match.index + match[0].lastIndexOf('{')
    let depth = 0
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1
      if (source[index] !== '}') continue
      depth -= 1
      if (depth === 0) {
        blocks.push(source.slice(match.index, index + 1))
        break
      }
    }
  }
  return blocks
}

export function testWeeklyRiskStylesUseOnlyApprovedDesignRoles(): void {
const css = readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8').replace(/\r\n?/g, '\n')
const riskCss = riskRuleBlocks(css).join('\n')
for (const forbidden of [/#(?:[\da-f]{3}){1,2}\b/i, /\brgba?\(/i, /\bhsla?\(/i, /\b(?:ok)?lch\(/i, /box-shadow\s*:/i]) {
  if (forbidden.test(riskCss)) throw new Error(`风控区出现私有视觉值：${forbidden}`)
}
for (const declaration of ['font-size', 'gap', 'padding', 'margin', 'border-radius']) {
  const rawValue = new RegExp(`${declaration}\\s*:\\s*(?!var\\(--)[^;]+;`, 'g')
  if (rawValue.test(riskCss)) throw new Error(`${declaration} 必须直接消费 token`)
}
for (const token of ['--bg-elevated', '--bg-inset', '--border-subtle', '--text-strong', '--text-muted', '--font-mono']) {
  if (!riskCss.includes(`var(${token})`)) throw new Error(`缺少设计角色 ${token}`)
}
if (css.includes('.wr-risk-evidence .wr-metric-grid')) throw new Error('风控区不得继续使用指标网格')
}
```

花括号深度提取能覆盖多行选择器，避免单行正则漏掉媒体块中的风控规则。

- [ ] **Step 2: 运行样式测试并确认红灯**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/WeeklyReviewRisk.design.test.ts`

Expected: FAIL，错误为“缺少设计角色 --bg-elevated”或“风控区不得继续使用指标网格”。

- [ ] **Step 3: 实现决策带、轨迹和审计样式**

样式使用以下结构值，所有视觉值直接取批准 token：

```css
.wr-risk-decisions { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: var(--sp-3); }
.wr-risk-period { padding: var(--sp-4); border: 1px solid var(--border-subtle); border-radius: var(--radius-8); background: var(--bg-elevated); }
.wr-risk-period.is-primary { border-color: var(--border-strong); background: var(--bg-inset); }
.wr-risk-period-head,.wr-risk-day { display: grid; align-items: center; gap: var(--sp-3); }
.wr-risk-period-head { grid-template-columns: minmax(0, 1fr) auto; }
.wr-risk-period-head span,.wr-risk-period p,.wr-risk-period small { color: var(--text-muted); font-size: var(--type-metadata-size); }
.wr-risk-period-head strong { color: var(--text-strong); font-size: var(--type-body-size); }
.wr-risk-remaining { display: flex; align-items: baseline; gap: var(--sp-2); margin-block: var(--sp-3); }
.wr-risk-remaining b { color: var(--text-strong); font-family: var(--font-mono); font-size: var(--type-section-title-size); font-variant-numeric: tabular-nums; }
.wr-risk-track { height: var(--sp-1); overflow: hidden; background: var(--bg-surface); border-radius: var(--radius-6); }
.wr-risk-track i { display: block; width: var(--risk-progress); height: 100%; background: var(--accent); }
[data-risk-tone="negative"] .wr-risk-period-head strong { color: var(--neg); }
[data-risk-tone="negative"] .wr-risk-track i { background: var(--neg); }
[data-risk-tone="warning"] .wr-risk-period-head strong { color: var(--warn); }
[data-risk-tone="warning"] .wr-risk-track i { background: var(--warn); }
[data-risk-tone="positive"] .wr-risk-period-head strong { color: var(--pos); }
[data-risk-tone="positive"] .wr-risk-track i { background: var(--pos); }
.wr-risk-daily,.wr-risk-audits { margin-top: var(--sp-5); }
.wr-risk-day { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); padding-block: var(--sp-3); border-bottom: 1px solid var(--border-subtle); }
.wr-risk-day b { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.wr-risk-day span:last-child { justify-self: end; color: var(--text-muted); font-size: var(--type-metadata-size); }
.wr-risk-audit { border-top: 1px solid var(--border-subtle); }
.wr-risk-audit summary { padding-block: var(--sp-3); color: var(--text-body); font-size: var(--type-body-size); cursor: pointer; }
.wr-risk-audit-body { padding-block-end: var(--sp-4); color: var(--text-muted); font-size: var(--type-metadata-size); }
```

轨迹高度固定使用已批准的 `--sp-1`，不引入新的尺寸角色。窄屏媒体块只加入：

```css
@media (max-width: 768px) {
  .wr-risk-decisions { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: 重跑样式合同**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/WeeklyReviewRisk.design.test.ts`

Expected: PASS，批准 token 均出现且禁止模式均未命中。

- [ ] **Step 5: 提交视觉合同**

```powershell
git add -- src/views/WeeklyReviewView.css src/views/WeeklyReviewRisk.design.test.ts
git commit -m "style: apply weekly risk design tokens"
```

### Task 4: 多视口、键盘和冻结证据回归

**Files:**
- Modify: `src/views/WeeklyReviewView.browser.test.tsx:12-16,80-122,204-219`
- Modify: `src/views/WeeklyReviewView.browser.test.html:3-7`

**Interfaces:**
- Consumes: Task 2/3 的 DOM 类名、details 行为和响应式样式。
- Produces: 1920×1080、1280×900、768×1024、375×812 四组自动浏览器证据。

- [ ] **Step 1: 注册视口并写浏览器失败断言**

在 HTML `<head>` 增加：

```html
<meta name="atlas-browser-viewports" content="1920x1080, 1280x900, 768x1024, 375x812" />
```

在测试 Window 类型增加 `__atlasBrowserViewport`，并把旧的“完整 · 上限”断言替换为：

```ts
const risk = document.querySelector<HTMLElement>('.wr-risk-evidence')
assert(risk, '已完成复盘没有展示冻结风控证据')
const text = risk.textContent ?? ''
assert(text.indexOf('本周风险状态') < text.indexOf('完成时月度状态'), '本周状态必须优先')
assert(text.indexOf('完成时月度状态') < text.indexOf('每日风险轨迹'), '每日轨迹不得压过周期结论')
assert(document.querySelectorAll('.wr-risk-day').length === completed.riskSnapshot?.dailyOutcomes.length, '每日轨迹数量错误')
const audits = [...document.querySelectorAll<HTMLDetailsElement>('.wr-risk-audit')]
assert(audits.length === 2 && audits.every((item) => !item.open), '两个审计区默认必须收起')
const firstSummary = audits[0]!.querySelector<HTMLElement>('summary')
assert(firstSummary && firstSummary.tabIndex >= 0, '原生 summary 必须可聚焦')
firstSummary.focus()
assert(document.activeElement === firstSummary, '审计摘要必须能够获得键盘焦点')
firstSummary.click()
assert(audits[0]!.open, '激活 summary 后必须展开审计区')
assert(audits[0]!.textContent?.includes('policy-browser'), '规则展开后必须显示完整 ID')
assert(document.documentElement.scrollWidth <= document.documentElement.clientWidth, `${window.innerWidth}px 不得横向溢出`)
```

浏览器状态 fixture 在完成后临时替换为：

```ts
const frozen = completed.riskSnapshot!
useStore.setState({
  weeklyReviews: [{
    ...completed,
    riskSnapshot: {
      ...frozen,
      dailyOutcomes: [
        { ...frozen.weeklyOutcome, coverage: 'partial', date: activeWeekStart },
        { ...frozen.weeklyOutcome, coverage: 'unknown', triggered: false, date: addDays(activeWeekStart, 1) },
        { ...frozen.weeklyOutcome, coverage: 'complete', triggered: true, date: addDays(activeWeekStart, 2) },
      ],
    },
  }],
})
await waitFor(() => document.body.textContent?.includes('部分覆盖') ?? false, '部分覆盖文字未出现')
assert(document.body.textContent?.includes('无法确认'), '未知覆盖文字未出现')
assert(document.body.textContent?.includes('已触线'), '触线文字未出现')
useStore.setState({ weeklyReviews: [completed] })
```

在测试文件复用生产 `parseLocalDate/formatYmd` 写一个 `addDays(ymd, days)`，与页面日期计算保持同一口径。

- [ ] **Step 2: 运行浏览器回归并确认新断言先失败**

Run: `node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts`

Expected: FAIL 于 `WeeklyReviewView.browser.test.html` 的新结构、状态或多视口断言。

- [ ] **Step 3: 修正组件的可访问性和窄屏边界**

按以下固定边界修正组件：

- `<summary>` 保持原生可聚焦，不添加自定义 role；
- 进度轨迹拥有完整中文 `aria-label`；
- 每日日期、R 值和覆盖状态在 375px 仍为单行，长原因摘要允许换行到下一行；
- 规则完整 ID 在展开区允许 `overflow-wrap: anywhere`，不截断审计数据；
- 不隐藏任何精确 R 数值或状态文案。

- [ ] **Step 4: 运行全部相关质量门**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyRiskPresentation.test.ts src/views/WeeklyRiskEvidence.test.tsx src/views/WeeklyReviewRisk.design.test.ts`

Expected: PASS。

Run: `node scripts/run-browser-tests.mjs D:\Trader-Atlas D:\Trader-Atlas\vite.config.ts`

Expected: 所有浏览器测试 PASS，四个 WeeklyReview 视口均单独报告 PASS。

Run: `pnpm build`

Expected: typecheck、Vite build 与 bundle budget 全部 PASS。

- [ ] **Step 5: 提交浏览器验收**

```powershell
git add -- src/views/WeeklyReviewView.browser.test.tsx src/views/WeeklyReviewView.browser.test.html src/views/WeeklyRiskEvidence.tsx src/views/WeeklyReviewView.css
git commit -m "test: verify weekly risk evidence across viewports"
```

## Completion Evidence

- 定向语义、组件和设计合同测试全部通过。
- 全套浏览器回归通过，WeeklyReview fixture 明确覆盖 1920、1280、768、375。
- `pnpm build` 通过。
- `git diff --check` 无错误；新增文件为 UTF-8 无 BOM。
- 页面首屏不再出现等权风险网格、空白补位格或常驻完整规则 ID。
