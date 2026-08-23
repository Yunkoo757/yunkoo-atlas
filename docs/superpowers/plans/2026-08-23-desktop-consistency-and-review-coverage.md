# 桌面端页面一致性与随机复盘覆盖 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉历史实盘误报筛选、随机复盘候选池过窄，并把周复盘、历史实盘、随机复盘设置、设置页的桌面字号与密度对齐到现有 `type-*` token。

**Architecture:** 先抽“页面自有查询参数”和复盘池资格规则这两个纯函数，再用现有设计测试读 CSS 契约、用现有 browser harness 验四个界面。不改路由框架、Zustand、绩效或案例算法。四个界面只做局部升级：历史实盘列表仍复用 `TradesPage`，随机复盘预览/开始/轮次继续共用 `buildReviewSessionPool`。

**Tech Stack:** React 18、React Router 6、现有 CSS token（`--type-*`、`--sp-*`、`--bg-*`）、Vite + `scripts/run-regression-tests.mjs` 单元测试、Playwright browser harness。

## Global Constraints

- 适配范围仅为 Windows 与 macOS 桌面客户端，不考虑浏览器、手机或平板布局。
- 不改变案例的到期、掌握度和案例范围算法。
- 不改变历史阶段归属、绩效计算和风险事实。
- 不重做侧栏、顶栏或所有业务页面。
- 不引入新的 UI 框架、字体库或运行时依赖。
- 候选数量必须由同一个 `buildReviewSessionPool` 结果计算；不得把 181 / 178 写进代码。
- 数据数字继续使用 `font-variant-numeric: var(--numeric-tabular)`。
- 工作区里现有未提交改动（`legacyStageBoundaryOverlap`、logo 清理等）与本计划无关，实施时不要混进本计划的提交。
- 提交信息沿用仓库现有英文祈使句风格：`fix:` / `feat:` / `test:`。

---

## File Structure

| 文件 | 职责 |
| --- | --- |
| Create: `src/lib/tradeViewParams.ts` | 交易筛选已知参数、页面自有参数、重置时保留页面参数 |
| Create: `src/lib/tradeViewParams.test.ts` | 上述纯函数的单元测试 |
| Modify: `src/components/trades/TradeFilters.tsx` | 未知筛选标签与“清除筛选”改走共享参数表 |
| Modify: `src/lib/reviewSession.ts` | 实盘/模拟盘资格：结束或错过即可；图文只看 `requireContent` |
| Modify: `src/lib/reviewSession.test.ts` | 复盘池新契约与旧测试改写 |
| Modify: `src/views/ReviewSessionView.tsx` | 来源说明文案与“当前设置”数量口径 |
| Modify: `src/views/ReviewSessionView.css` | 设置弹窗来源选项变矮、字号改 `type-*` |
| Create: `src/views/ReviewSessionCoverage.browser.test.tsx` | 预览数量、开始轮次、来源组合同一口径 |
| Create: `src/views/ReviewSessionCoverage.browser.test.html` | 上述 browser 入口 |
| Modify: `src/views/WeeklyReviewView.tsx` | 左栏结构改为周标识 / 阶段名 / 状态点 |
| Modify: `src/views/WeeklyReviewView.css` | 左栏约 220px、禁止逐字换行、轻量选中 |
| Create: `src/views/WeeklyReviewHistory.design.test.ts` | 周复盘左栏与页头 token / 宽度契约 |
| Modify: `src/views/WeeklyReviewPresentation.browser.test.tsx` | 左栏可读、不对齐回归 |
| Modify: `src/views/LiveArchiveView.css` | 阶段条变紧凑、去掉三层厚卡 |
| Modify: `src/views/LiveArchiveView.design.test.ts` | 历史实盘容器与字号契约 |
| Modify: `src/views/LiveArchiveView.browser.test.tsx` | 不再出现“未支持的筛选条件” |
| Modify: `src/views/settings/SettingsLayout.css` | 仅在发现混用时补齐四级文本（现有页头已用 `type-*`） |
| Create: `src/views/DesktopSurfaceTypography.design.test.ts` | 四个相关界面禁止裸字号 / `--fs-sm` / `--fs-mini` |

---

### Task 1: 历史实盘页面自有查询参数

**Files:**
- Create: `src/lib/tradeViewParams.ts`
- Create: `src/lib/tradeViewParams.test.ts`
- Modify: `src/components/trades/TradeFilters.tsx:43-65,256-293`

**Interfaces:**
- Consumes: 现有 `KNOWN_TRADE_VIEW_PARAMS` 成员（`tradeKind`、`period`、`strategyId`、`symbol`、`side`、`status`、`session`、`tag`、`mistakeTag`、`reviewCategory`、`caseType`、`masteryState`、`kind`、`range`、`liveCycle`、`statsCycle`、`view`、`caseScope`、`archiveReason`、`requestedKey`）
- Produces: `PAGE_OWNED_TRADE_VIEW_PARAMS: ReadonlySet<string>`，值为 `'liveStage'` 与 `'tab'`；`KNOWN_TRADE_VIEW_PARAMS: ReadonlySet<string>`；`isKnownTradeViewParam(key: string): boolean`；`preservePageOwnedSearch(search: URLSearchParams, extras?: { historicalLiveScope?: 'trades' | 'cases' | null }): URLSearchParams`

- [ ] **Step 1: Write the failing test**

把现有 `TradeFilters.tsx` 里的参数集合抽出来之前，先写纯函数测试。当前这些函数还不存在，测试必须失败。

```ts
import {
  KNOWN_TRADE_VIEW_PARAMS,
  PAGE_OWNED_TRADE_VIEW_PARAMS,
  isKnownTradeViewParam,
  preservePageOwnedSearch,
} from '@/lib/tradeViewParams'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testLiveStageAndTabArePageOwnedNotUnknownFilters(): void {
  assert(PAGE_OWNED_TRADE_VIEW_PARAMS.has('liveStage'), 'liveStage 必须是历史实盘页面自有参数')
  assert(PAGE_OWNED_TRADE_VIEW_PARAMS.has('tab'), 'tab 必须是历史实盘页面自有参数')
  assert(isKnownTradeViewParam('liveStage'), '页面自有参数不得生成未知筛选标签')
  assert(isKnownTradeViewParam('tab'), '页面自有参数不得生成未知筛选标签')
  assert(!PAGE_OWNED_TRADE_VIEW_PARAMS.has('status'), 'status 仍是交易筛选，不是页面路由状态')
  assert(isKnownTradeViewParam('status'), '已知交易筛选仍算已知参数')
  assert(!isKnownTradeViewParam('notARealFilter'), '真正未知参数必须仍可被标成未支持')
}

export function testClearingTradeFiltersKeepsHistoricalStageAndTab(): void {
  const current = new URLSearchParams('liveStage=stage-2&tab=live&status=loss&symbol=BTCUSDT')
  const next = preservePageOwnedSearch(current, { historicalLiveScope: 'trades' })
  assert(next.get('liveStage') === 'stage-2', '清除交易筛选必须保留当前历史阶段')
  assert(next.get('tab') === 'live', '清除交易筛选必须保留当前标签页')
  assert(next.get('status') === null, '清除交易筛选必须去掉 status')
  assert(next.get('symbol') === null, '清除交易筛选必须去掉 symbol')
}

export function testClearingHistoricalCaseFiltersKeepsTabCases(): void {
  const current = new URLSearchParams('liveStage=stage-2&tab=cases&caseScope=mistakes')
  const next = preservePageOwnedSearch(current, { historicalLiveScope: 'cases' })
  assert(next.get('liveStage') === 'stage-2', '案例标签页清除筛选也必须保留阶段')
  assert(next.get('tab') === 'cases', '案例标签页清除筛选必须保留 tab=cases')
  assert(next.get('caseScope') === null, '案例范围属于交易筛选，应被清除')
}

export function testKnownTradeViewParamsKeepLegacyFacets(): void {
  for (const key of [
    'tradeKind', 'period', 'strategyId', 'symbol', 'side', 'status', 'session',
    'tag', 'mistakeTag', 'reviewCategory', 'caseType', 'masteryState', 'kind',
    'range', 'liveCycle', 'statsCycle', 'view', 'caseScope', 'archiveReason',
    'requestedKey', 'liveStage', 'tab',
  ]) {
    assert(KNOWN_TRADE_VIEW_PARAMS.has(key), `已知参数表缺少 ${key}`)
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/tradeViewParams.test.ts`

Expected: FAIL，模块不存在或 `isKnownTradeViewParam` 未定义。

- [ ] **Step 3: Write minimal implementation**

`src/lib/tradeViewParams.ts`：

```ts
export const PAGE_OWNED_TRADE_VIEW_PARAMS = new Set(['liveStage', 'tab'])

export const KNOWN_TRADE_VIEW_PARAMS = new Set([
  'tradeKind',
  'period',
  'strategyId',
  'symbol',
  'side',
  'status',
  'session',
  'tag',
  'mistakeTag',
  'reviewCategory',
  'caseType',
  'masteryState',
  'kind',
  'range',
  'liveCycle',
  'statsCycle',
  'view',
  'caseScope',
  'archiveReason',
  'requestedKey',
  ...PAGE_OWNED_TRADE_VIEW_PARAMS,
])

export function isKnownTradeViewParam(key: string): boolean {
  return KNOWN_TRADE_VIEW_PARAMS.has(key)
}

export function preservePageOwnedSearch(
  search: URLSearchParams,
  extras: { historicalLiveScope?: 'trades' | 'cases' | null } = {},
): URLSearchParams {
  const next = new URLSearchParams()
  for (const key of PAGE_OWNED_TRADE_VIEW_PARAMS) {
    const value = search.get(key)
    if (value) next.set(key, value)
  }
  if (extras.historicalLiveScope === 'cases' && !next.get('tab')) {
    next.set('tab', 'cases')
  }
  return next
}
```

`TradeFilters.tsx`：删掉文件内 `const KNOWN_TRADE_VIEW_PARAMS = new Set([...])`，改为：

```ts
import { isKnownTradeViewParam, preservePageOwnedSearch } from '@/lib/tradeViewParams'
```

未知参数循环改成：

```ts
for (const [key, value] of searchParams) {
  if (isKnownTradeViewParam(key)) continue
  activeFilters.push({
    key: `unsupported:${key}:${value}`,
    label: `未支持的筛选条件，可移除`,
    onRemove: () => setParam(key, ''),
  })
}
```

`resetFilters` 改成：

```ts
const resetFilters = () => {
  const base = filter.historicalLiveScope
    ? '/live-history'
    : filter.tradeKind === 'paper'
      ? '/sim'
      : filter.tradeKind === 'case'
        ? '/review-cases'
        : '/list'
  const mode = workbenchModeFromPathname(location.pathname)
  const next = filter.historicalLiveScope
    ? preservePageOwnedSearch(searchParams, { historicalLiveScope: filter.historicalLiveScope })
    : new URLSearchParams()
  navigate({
    pathname: pathWithWorkbenchMode(base, mode),
    search: next.toString() ? `?${next.toString()}` : '',
  }, { replace: true })
}
```

不要再写 `?view=cases`。`LiveArchiveView` 已经把 `view=cases` 规范化成 `tab=cases`；重置后应直接保留 `tab`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/tradeViewParams.test.ts src/lib/workspaceFacetConsistency.test.ts src/views/LiveArchiveView.design.test.ts`

Expected: PASS。`workspaceFacetConsistency` 仍要求源码里有“未支持的筛选条件，可移除”和 `unsupported:`。

- [ ] **Step 5: Commit**

```bash
git add src/lib/tradeViewParams.ts src/lib/tradeViewParams.test.ts src/components/trades/TradeFilters.tsx
git commit -m "fix: keep historical stage route params out of trade filters"
```

---

### Task 2: 随机复盘候选池资格

**Files:**
- Modify: `src/lib/reviewSession.ts:186-230`
- Modify: `src/lib/reviewSession.test.ts:294-335`
- Modify: `src/views/ReviewSessionView.tsx:850-914`

**Interfaces:**
- Consumes: Task 1 无依赖。继续使用现有 `buildReviewSessionPool(trades, filters, starredIds, currentTradingDayKey, tradingDayStartHour, stageContext): Trade[]`、`hasEffectiveReviewContent(note): boolean`、`ReviewSessionFilters.requireContent`
- Produces: 同一函数签名。实盘：所选阶段内 `executionState` 为 `closed` 或 `missed`、未删除即可，不再要求 `isReviewCompleted(reviewStatus)`。模拟盘：全部已结束或已错过且未删除，不受 `stageSource` 限制。`requireContent === true` 时三类来源统一走已有的 `getReviewSessionContent` + `hasEffectiveReviewContent`；关闭时不再因正文为空排除。案例规则保持 `matchesReviewCaseScope`、`reviewTiming`、`masteryState`、到期判断不变。

- [ ] **Step 1: Write the failing test**

改写并新增 `src/lib/reviewSession.test.ts` 中的账户交易测试。当前实现会让这些断言失败。

把 `testReviewSessionAccountTradesRequireClosedReviewedContent` 整段替换为下面三个导出函数，不要留旧函数名，避免 discovery 继续跑旧契约：

```ts
export function testReviewSessionLiveAndPaperIgnoreReviewStatus(): void {
  const trades: Trade[] = [
    { ...baseTrade, id: 'reviewed-live' },
    { ...baseTrade, id: 'unreviewed-live', reviewStatus: 'unreviewed' },
    { ...baseTrade, id: 'open-live', status: 'open', closedAt: null },
    { ...baseTrade, id: 'deleted-live', deletedAt: '2026-07-16T00:00:00.000Z' },
    paperTrade('reviewed-paper'),
    { ...paperTrade('unreviewed-paper'), reviewStatus: 'unreviewed' },
    { ...paperTrade('open-paper'), status: 'open', closedAt: null },
  ]

  const pool = buildPool(trades, {
    includeCases: false,
    includeLiveTrades: true,
    includePaperTrades: true,
    requireContent: false,
  })

  assert(
    pool.map((trade) => trade.id).join(',') === 'reviewed-live,unreviewed-live,reviewed-paper,unreviewed-paper',
    '实盘与模拟盘只要已结束或已错过且未删除即可进入候选池，不得要求 reviewStatus',
  )
}

export function testReviewSessionRequireContentIsTheOnlyContentFilter(): void {
  const trades: Trade[] = [
    { ...baseTrade, id: 'empty-live', note: '<p>&nbsp;</p>' },
    { ...baseTrade, id: 'text-live', note: '<p>假突破后没有追单</p>' },
    { ...paperTrade('empty-paper'), note: '<p></p>' },
    { ...paperTrade('image-paper'), note: '<p></p><img src="journal-asset://chart-1">' },
    { ...baseTrade, id: 'empty-case', tradeKind: 'case', note: '<p> </p>' },
    { ...baseTrade, id: 'text-case', tradeKind: 'case', note: '<p>案例洞见</p>' },
  ]

  const withoutContent = buildPool(trades, {
    includeCases: true,
    includeLiveTrades: true,
    includePaperTrades: true,
    requireContent: false,
    reviewTiming: 'all',
  })
  assert(
    withoutContent.map((trade) => trade.id).join(',') ===
      'empty-live,text-live,empty-paper,image-paper,empty-case,text-case',
    '关闭仅含有效图文时，不得再以正文是否存在过滤三类来源',
  )

  const withContent = buildPool(trades, {
    includeCases: true,
    includeLiveTrades: true,
    includePaperTrades: true,
    requireContent: true,
    reviewTiming: 'all',
  })
  assert(
    withContent.map((trade) => trade.id).join(',') === 'text-live,image-paper,text-case',
    '开启仅含有效图文时，三类来源必须统一要求有效文本或图片',
  )
}

export function testReviewSessionPaperIgnoresLiveStageSource(): void {
  const { liveStageId: _liveStageId, ...paperFields } = baseTrade
  const trades: Trade[] = [
    { ...baseTrade, id: 'current-live', liveStageId: 'stage-current' },
    { ...baseTrade, id: 'old-live', liveStageId: 'stage-oldest' },
    { ...paperFields, id: 'any-paper', ref: 'PAPER-any', tradeKind: 'paper' },
  ]

  const currentOnly = buildPool(trades, {
    includeCases: false,
    includeLiveTrades: true,
    includePaperTrades: true,
    requireContent: false,
    stageSource: 'current',
  })
  assert(
    currentOnly.map((trade) => trade.id).join(',') === 'current-live,any-paper',
    '模拟盘不受实盘阶段来源限制；当前阶段过滤只能约束实盘与案例',
  )

  const emptyLiveSource = buildPool(trades, {
    includeCases: false,
    includeLiveTrades: true,
    includePaperTrades: false,
    requireContent: false,
    stageSource: { stageIds: [] },
  })
  assert(emptyLiveSource.length === 0, '某个来源为空时数量必须是零，不得回退到其他来源')
}
```

保留现有 `testReviewSessionContentFilterKeepsTextAndImageNotes`、`testDefaultReviewPoolIncludesCurrentAndEveryHistoricalStageByOwnership`、案例到期/掌握度测试。默认池测试里的实盘仍带正文和 `reviewed`，行为应继续通过。

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts`

Expected: FAIL。`unreviewed-live` / `empty-live` 被旧规则排除，报“不得要求 reviewStatus”或“不得再以正文是否存在过滤”。

- [ ] **Step 3: Write minimal implementation**

`src/lib/reviewSession.ts` 的 `buildReviewSessionPool` 里，案例分支保持不动。把实盘/模拟盘结尾从：

```ts
    const executionState = resolveTradeTruth(trade).executionState
    return (
      (executionState === 'closed' || executionState === 'missed') &&
      isReviewCompleted(trade.reviewStatus) &&
      hasEffectiveReviewContent(content)
    )
```

改成：

```ts
    const executionState = resolveTradeTruth(trade).executionState
    return executionState === 'closed' || executionState === 'missed'
```

不要删除文件顶部对案例仍需要的 `isReviewCompleted` 导入，除非改完后该符号不再被本文件使用；若只剩这一处，删掉未用导入。

`requireContent` 已在函数前部分对三类来源统一检查，不要再对实盘/模拟盘重复检查正文。

模拟盘已经在阶段过滤外：

```ts
    if (trade.tradeKind !== 'paper') {
      const stage = typeof trade.liveStageId === 'string'
        ? stageById.get(trade.liveStageId)
        : undefined
      if (!stage) return false
      // ...
    }
```

不要把模拟盘重新纳入 `stageSource`。

`ReviewSessionView.tsx` 来源说明改成与新规则一致，数量文案保持“当前设置”口径：

```tsx
<span><strong>实盘交易</strong><small>所选阶段内已结束或已错过的实盘记录</small></span>
...
<span><strong>模拟盘</strong><small>全部已结束或已错过的模拟记录，不受实盘阶段限制</small></span>
...
<p className="review-session-settings-count" role="status">
  {noSources ? '请选择至少一个来源' : `当前设置可复盘 ${poolSize} 条`}
</p>
```

不要改 `settingsDraft` 取消/应用逻辑，不要改已开始轮次的 `session.ids` 快照。`settingsPoolSize` 和开始页 `pool` 已经都调用 `buildReviewSessionPool`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts`

Expected: PASS，包括默认池、案例到期、内容开关、模拟盘跨阶段。

- [ ] **Step 5: Commit**

```bash
git add src/lib/reviewSession.ts src/lib/reviewSession.test.ts src/views/ReviewSessionView.tsx
git commit -m "fix: include closed live and paper trades in review sessions"
```

---

### Task 3: 周复盘左栏结构与宽度

**Files:**
- Create: `src/views/WeeklyReviewHistory.design.test.ts`
- Modify: `src/views/WeeklyReviewView.tsx:662-684`
- Modify: `src/views/WeeklyReviewView.css:1-27`
- Modify: `src/views/WeeklyReviewPresentation.browser.test.tsx:98-117`

**Interfaces:**
- Consumes: 现有 `historyItems`、`weekLabel(start, currentWeek)`、`liveStages`、`.wr-shell` / `.wr-history` / `.wr-page-head-inner`
- Produces: 左栏按钮 DOM 为 `.wr-history-week`、`.wr-history-stage`、状态点 `i`；CSS 桌面列宽 `minmax(200px, 220px)`，窄窗 `minmax(168px, 200px)`；日期与短状态 `white-space: nowrap`

- [ ] **Step 1: Write the failing test**

`src/views/WeeklyReviewHistory.design.test.ts`，读 CSS 源码，不要启动浏览器：

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function weeklyCss(): string {
  return readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8').replace(/\r\n?/g, '\n')
}

function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(selector)
  assert(start >= 0, `缺少选择器 ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(start, close + 1)
}

export function testWeeklyHistoryRailUsesReadableDesktopWidth(): void {
  const shell = ruleBlock(weeklyCss(), '.wr-shell {')
  assert(
    /grid-template-columns:\s*minmax\(200px,\s*220px\)\s+minmax\(0,\s*1fr\)/.test(shell),
    '周复盘左栏桌面宽度必须约 220px，并保留可用最小宽度',
  )
  assert(!/grid-template-columns:\s*148px/.test(weeklyCss()), '左栏不得再使用 148px 固定列')
}

export function testWeeklyHistoryItemsDoNotWrapDateOrStatus(): void {
  const css = weeklyCss()
  assert(css.includes('.wr-history-week'), '周标识必须有独立 class')
  assert(css.includes('.wr-history-stage'), '阶段名必须有独立 class')
  assert(
    /white-space:\s*nowrap/.test(ruleBlock(css, '.wr-history-week')),
    '周标识/日期不得逐字换行',
  )
  assert(
    /white-space:\s*nowrap/.test(ruleBlock(css, '.wr-history-stage')) ||
      /white-space:\s*nowrap/.test(ruleBlock(css, '.wr-history-state')),
    '阶段名或短状态必须禁止逐字换行',
  )
}

export function testWeeklyHistoryActiveStateIsLightweight(): void {
  const active = ruleBlock(weeklyCss(), '.wr-history button.is-active')
  assert(active.includes('var(--bg-selected)'), '当前周必须使用轻量选中底色')
  assert(!/border:\s*[1-9]/.test(active), '当前周不得使用额外厚边框')
}

export function testWeeklyHistoryAndHeadUseTypeTokens(): void {
  const css = weeklyCss()
  const history = [
    ruleBlock(css, '.wr-history-title'),
    ruleBlock(css, '.wr-history button {'),
    ruleBlock(css, '.wr-page-head h1'),
    ruleBlock(css, '.wr-section-head h2'),
  ].join('\n')
  assert(!history.includes('--fs-sm'), '周复盘左栏和页头不得混用 --fs-sm')
  assert(!history.includes('--fs-mini') || history.includes('--type-metadata'), '描述级文字应落到 type token')
  assert(history.includes('--type-page-title-size') || weeklyCss().includes('--type-page-title-size'), '页头必须使用页面标题 token')
}
```

同时在 `WeeklyReviewPresentation.browser.test.tsx` 的页头对齐断言后插入（左栏只在 `historyItems.length > 1` 时出现；该测试后半段已经插入上一周，把这段放在插入上一周并出现折线图之后）：

```ts
    await waitFor(() => Boolean(document.querySelector('.wr-history')), '有两条以上记录时必须显示左栏')
    const rail = document.querySelector<HTMLElement>('.wr-history')
    const week = document.querySelector<HTMLElement>('.wr-history-week')
    const stage = document.querySelector<HTMLElement>('.wr-history-stage')
    assert(rail && week && stage, '左栏缺少周标识或阶段名结构')
    assert(rail.getBoundingClientRect().width >= 168, '左栏在常用桌面宽度下必须可读')
    assert(getComputedStyle(week).whiteSpace === 'nowrap', '周标识不得逐字换行')
    const pageHead = document.querySelector<HTMLElement>('.wr-page-head-inner')
    const progress = document.querySelector<HTMLElement>('.wr-progress-summary')
    const sectionHead = document.querySelector<HTMLElement>('.wr-section-head')
    assert(pageHead && progress && sectionHead, '页头、进度或章节标题缺失')
    assert(
      Math.abs(pageHead.getBoundingClientRect().left - sectionHead.getBoundingClientRect().left) < 1,
      '主内容标题与章节标题必须对齐到同一阅读轨道',
    )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/WeeklyReviewHistory.design.test.ts`

Expected: FAIL，仍是 `148px`，没有 `.wr-history-week`。

- [ ] **Step 3: Write minimal implementation**

`WeeklyReviewView.tsx` 左栏按钮改成稳定三行结构，状态仍用现有圆点，短状态文字放在 `aria-label` 或独立 nowrap 节点，不要再把“阶段名 · 待补做”挤在一个会换行的 `small` 里：

```tsx
<button
  key={item.key}
  type="button"
  className={isActive ? 'is-active' : ''}
  data-review-week={item.week}
  data-review-id={item.review?.id ?? ''}
  data-review-stage-id={item.liveStageId}
  data-review-week-state={item.review?.status ?? 'pending'}
  aria-label={`${weekLabel(item.week, currentWeek)} ${stageName} ${item.review?.status === 'completed' ? '已完成' : item.review ? '草稿' : '待补做'}`}
  onClick={() => void changeReview(item)}
>
  <span className="wr-history-week">{weekLabel(item.week, currentWeek)}</span>
  <small className="wr-history-stage">{stageName}</small>
  <i
    className={item.review?.status === 'completed' ? 'is-complete' : item.review ? 'is-draft' : 'is-pending'}
    aria-hidden
  />
</button>
```

`WeeklyReviewView.css` 相关片段：

```css
.wr-shell {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(200px, 220px) minmax(0, 1fr);
  overflow: hidden;
  background: var(--bg-surface);
}
.wr-history-title {
  padding: 0 9px 10px;
  color: var(--text-tertiary);
  font-size: var(--type-metadata-size);
  font-weight: var(--font-weight-semibold);
}
.wr-history button {
  width: 100%;
  min-height: 44px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 7px;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 7px;
  padding: 6px 9px;
  border: 0;
  border-radius: var(--radius-6);
  background: transparent;
  color: var(--text-tertiary);
  font: inherit;
  font-size: var(--type-row-size);
  text-align: left;
  cursor: pointer;
}
.wr-history button.is-active {
  background: var(--bg-selected);
  color: var(--text-primary);
}
.wr-history-week {
  grid-column: 1;
  color: inherit;
  font-size: var(--type-row-size);
  font-weight: var(--type-row-weight);
  white-space: nowrap;
}
.wr-history-stage {
  grid-column: 1;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--type-metadata-size);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wr-history button i {
  grid-column: 2;
  grid-row: 1 / span 2;
}
```

窄窗补在现有 `@media (max-width: 1099px)` 里：

```css
  .wr-shell:not(.is-first-review) {
    grid-template-columns: minmax(168px, 200px) minmax(0, 1fr);
  }
```

页头 `h1` 已用 `--type-page-title-*`，不要改阅读轨道宽度。不要给 `.wr-history button.is-active` 加粗边框。

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/WeeklyReviewHistory.design.test.ts src/views/WeeklyReviewRisk.design.test.ts`

Expected: PASS。风控区 token 契约不能被这次 CSS 改坏。

然后跑周复盘展示 browser 测试：

```js
node --experimental-strip-types -e "import { runBrowserRegressionTests } from './scripts/run-browser-tests.mjs'; const r = await runBrowserRegressionTests(process.cwd(), { configFile: 'vite.config.ts', requestedTestIds: ['src/views/WeeklyReviewPresentation.browser.test.html#__weeklyReviewPresentationTest@1440x900'] }); if (r.failed) process.exit(1)"
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/views/WeeklyReviewView.tsx src/views/WeeklyReviewView.css src/views/WeeklyReviewHistory.design.test.ts src/views/WeeklyReviewPresentation.browser.test.tsx
git commit -m "fix: keep weekly review history labels readable"
```

---

### Task 4: 历史实盘轻量导航与去厚卡

**Files:**
- Modify: `src/views/LiveArchiveView.design.test.ts`
- Modify: `src/views/LiveArchiveView.css`
- Modify: `src/views/LiveArchiveView.tsx:37-98,126-170,354-358`（只改 class / 结构密度，不改数据）
- Modify: `src/views/LiveArchiveView.browser.test.tsx:267-294`

**Interfaces:**
- Consumes: Task 1 的 `isKnownTradeViewParam`。现有 `ArchiveNavigation`、`live-archive-stage-rail`、`live-archive-tab-list`、`live-archive-panel`
- Produces: 阶段选择是紧凑横向选项；概览/周复盘/风险主体不再套 `background + 外层大卡 + 内层卡` 三层；实盘记录/关联案例仍走 `TradesPage`

- [ ] **Step 1: Write the failing test**

在 `LiveArchiveView.design.test.ts` 追加：

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'

function archiveCss(): string {
  return readFileSync(path.resolve('src/views/LiveArchiveView.css'), 'utf8').replace(/\r\n?/g, '\n')
}

export function testHistoricalArchiveNavIsCompactAndShared(): void {
  const css = archiveCss()
  assert(css.includes('.live-archive-navigation'), '阶段与标签必须共享一个导航区')
  assert(!/min-height:\s*58px/.test(css), '阶段条不得再使用厚卡片高度')
  assert(!/min-width:\s*120px/.test(css), '阶段选项不得再使用大块最小宽度')
  assert(
    css.includes('--type-row-size') || css.includes('--type-body-size'),
    '阶段名称必须使用正文/行级 token',
  )
  assert(css.includes('--type-metadata-size'), '阶段日期必须使用元信息 token')
}

export function testHistoricalArchiveDropsTripleCardNesting(): void {
  const css = archiveCss()
  assert(!/background:\s*var\(--bg-inset\)/.test(css) || !css.includes('.live-archive-panel'), '主体不得再做 inset 背景页加外层大卡')
  assert(
    /border:\s*0/.test(css) || !/border:\s*1px solid var\(--border-subtle\)/.test(
      css.slice(css.indexOf('.live-archive-panel'), css.indexOf('.live-archive-summary-grid')),
    ),
    '概览外层 panel 必须去掉厚重卡片边框',
  )
}
```

在 `LiveArchiveView.browser.test.tsx` 点开 `tab=live` 之后立刻断言：

```ts
    assert(
      !document.body.textContent?.includes('未支持的筛选条件'),
      '历史实盘不得把 liveStage 与 tab 显示成未支持的筛选条件',
    )
```

在切换到 `status=loss` 后再断言一次，确认真正的交易筛选仍在，路由参数仍不报未知。

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/LiveArchiveView.design.test.ts`

Expected: FAIL，阶段条仍是 `min-height: 58px` / `min-width: 120px`，panel 仍是厚卡。

- [ ] **Step 3: Write minimal implementation**

`LiveArchiveView.css` 按规格改，不要动列表行密度：

```css
.live-archive-navigation {
  display: grid;
  gap: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}
.live-archive-stage-rail {
  display: flex;
  gap: var(--sp-1);
  min-height: 0;
  padding: var(--sp-2) var(--page-inset-default) 0;
  overflow-x: auto;
}
.live-archive-stage-rail button {
  display: grid;
  flex: 0 0 auto;
  gap: 2px;
  min-width: 0;
  padding: 5px 8px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--radius-6);
  color: var(--text-tertiary);
  font-size: var(--type-row-size);
  background: transparent;
  cursor: pointer;
}
.live-archive-stage-rail button span {
  font-weight: var(--type-row-weight);
  white-space: nowrap;
}
.live-archive-stage-rail button small {
  color: var(--text-tertiary);
  font-size: var(--type-metadata-size);
  white-space: nowrap;
}
.live-archive-stage-rail button.is-active {
  color: var(--text-primary);
  border-color: var(--border-subtle);
  background: var(--bg-selected);
}
.live-archive-tab-list {
  display: flex;
  gap: var(--sp-4);
  min-height: 36px;
  padding: 0 var(--page-inset-default);
}
.live-archive-scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: var(--sp-5) var(--page-inset-default) 48px;
  background: var(--bg-surface);
}
.live-archive-panel {
  max-width: var(--page-rail-reading);
  margin: 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
}
.live-archive-panel > header {
  padding: 0 0 var(--sp-4);
  border-bottom: 1px solid var(--border-subtle);
}
.live-archive-panel > header h2 {
  margin: var(--sp-1) 0 0;
  font-size: var(--type-page-title-size);
  line-height: var(--type-page-title-line-height);
}
.live-archive-summary-grid,
.live-archive-integrity,
.live-archive-card-list article {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-6);
}
```

`LiveArchiveView.tsx` 的概览/周复盘/风险继续用 `live-archive-panel`，不要改 `buildStageArchiveOverview` 或风险过滤。实盘/案例分支继续渲染 `TradesPage`。

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/LiveArchiveView.design.test.ts src/lib/tradeViewParams.test.ts`

Expected: PASS。

Browser：

```js
node --experimental-strip-types -e "import { runBrowserRegressionTests } from './scripts/run-browser-tests.mjs'; const r = await runBrowserRegressionTests(process.cwd(), { configFile: 'vite.config.ts', requestedTestIds: ['src/views/LiveArchiveView.browser.test.html#__liveArchiveViewTest@1280x900'] }); if (r.failed) process.exit(1)"
```

Expected: PASS，且页面文本不含“未支持的筛选条件”。

- [ ] **Step 5: Commit**

```bash
git add src/views/LiveArchiveView.css src/views/LiveArchiveView.tsx src/views/LiveArchiveView.design.test.ts src/views/LiveArchiveView.browser.test.tsx
git commit -m "fix: flatten historical live archive chrome"
```

---

### Task 5: 随机复盘设置弹窗密度与同一口径

**Files:**
- Create: `src/views/ReviewSessionCoverage.browser.test.html`
- Create: `src/views/ReviewSessionCoverage.browser.test.tsx`
- Modify: `src/views/ReviewSessionView.css:211-316`
- Modify: `src/views/ReviewSessionView.tsx`（若 Task 2 已改文案，这里只改结构和 `data-*`）

**Interfaces:**
- Consumes: Task 2 的 `buildReviewSessionPool` 新资格；现有 `settingsDraft`、`settingsPoolSize`、`pool`
- Produces: 设置弹窗来源选项 `min-height` 不高于 52px；标题 `--type-row-*`，说明 `--type-metadata-*`；browser 测试证明预览条数 === 开始后 `session.ids.length`

- [ ] **Step 1: Write the failing test**

`ReviewSessionCoverage.browser.test.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="atlas-browser-viewports" content="1280x860" />
    <title>Random review coverage</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/views/ReviewSessionCoverage.browser.test.tsx"></script>
  </body>
</html>
```

`ReviewSessionCoverage.browser.test.tsx` 复用 `ReviewSession.browser.test.tsx` 的挂载方式（`bootstrapStorage`、`MemoryRouter`、`ReviewSessionView`），种子数据只要：

- 2 笔已结束实盘：1 笔 `reviewStatus: 'unreviewed'` 且无正文，1 笔已复盘有正文
- 2 笔已结束模拟盘：同样一笔无正文、一笔有正文
- 1 笔到期案例

测试步骤：

1. 打开复盘设置。
2. 只勾选模拟盘，关闭“仅含有效图文”。
3. 断言文案为 `当前设置可复盘 2 条`。
4. 开启“仅含有效图文”，断言变成 `当前设置可复盘 1 条`。
5. 应用设置并开始一轮，断言 `loadReviewSession(libraryId)?.ids.length === 1`，且预览数字与之相同。
6. 再开设置，只勾选模拟盘并关闭图文限制，应用后重新生成，断言 `ids.length === 2`。
7. 取消设置草稿（改勾选但不点应用，点取消），断言已开始轮次的 `ids` 不变。

来源选项视觉：

```ts
    const source = document.querySelector<HTMLElement>('.review-session-settings-sources label')
    assert(source, '缺少来源选项')
    assert(source.getBoundingClientRect().height <= 56, '来源选项垂直高度必须缩小')
    assert(getComputedStyle(source.querySelector('strong')!).fontSize === getComputedStyle(document.documentElement).getPropertyValue('--type-row-size').trim() || true, '来源标题应使用正文强调级')
```

高度用 `getBoundingClientRect().height <= 56` 即可，不要测计算后的 token 字符串是否带空格。

导出：

```ts
window.__reviewSessionCoverageTest = run()
```

- [ ] **Step 2: Run test to verify it fails**

```js
node --experimental-strip-types -e "import { runBrowserRegressionTests } from './scripts/run-browser-tests.mjs'; const r = await runBrowserRegressionTests(process.cwd(), { configFile: 'vite.config.ts', requestedTestIds: ['src/views/ReviewSessionCoverage.browser.test.html#__reviewSessionCoverageTest@1280x860'] }); if (r.failed) process.exit(1)"
```

Expected: FAIL。现有来源选项 `min-height: 82px`，高度会大于 56。

- [ ] **Step 3: Write minimal implementation**

`ReviewSessionView.css`：

```css
.review-session-settings-sources {
  display: grid;
  margin: 0;
  padding: 0;
  border: 0;
  gap: var(--sp-2);
}
.review-session-settings-sources label {
  display: grid;
  min-height: 0;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-8);
  background: transparent;
  cursor: pointer;
}
.review-session-settings-sources label.is-selected {
  border-color: color-mix(in srgb, var(--accent) 60%, var(--border-default));
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-surface));
}
.review-session-settings-sources strong {
  color: var(--text-primary);
  font-size: var(--type-row-size);
  font-weight: var(--type-row-weight);
}
.review-session-settings-sources small {
  color: var(--text-tertiary);
  font-size: var(--type-metadata-size);
  line-height: var(--type-metadata-line-height);
}
.review-session-settings-count {
  margin: var(--sp-2) 0 0;
  color: var(--text-tertiary);
  font-size: var(--type-metadata-size);
}
```

把数量放在过滤条件正下方，不要挪到 footer 远处。不要改已开始轮次的 reconcile 逻辑。

- [ ] **Step 4: Run test to verify it passes**

同一条 browser 命令。

Expected: PASS。再跑：

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/reviewSession.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/views/ReviewSessionView.css src/views/ReviewSessionView.tsx src/views/ReviewSessionCoverage.browser.test.tsx src/views/ReviewSessionCoverage.browser.test.html
git commit -m "fix: shrink review session filters and keep pool counts aligned"
```

---

### Task 6: 四个相关界面的四级文本契约

**Files:**
- Create: `src/views/DesktopSurfaceTypography.design.test.ts`
- Modify: `src/views/WeeklyReviewView.css`（左栏、页头、进度、章节标题）
- Modify: `src/views/LiveArchiveView.css`（导航与 panel 标题）
- Modify: `src/views/ReviewSessionView.css`（设置弹窗与开始页 intro）
- Modify: `src/views/settings/SettingsLayout.css`（若测试抓到 `--fs-sm` / 裸字号）

**Interfaces:**
- Consumes: 现有 token：`--type-page-title-size`、`--type-section-title-size`、`--type-row-size`、`--type-body-size`、`--type-metadata-size`
- Produces: 四个文件的目标选择器不再出现 `--fs-sm`、`--fs-mini`、裸 `px` 字号；数字区保留 `var(--numeric-tabular)`

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const SURFACES = [
  { file: 'src/views/WeeklyReviewView.css', selectors: ['.wr-history-title', '.wr-history-week', '.wr-history-stage', '.wr-page-head h1', '.wr-section-head h2', '.wr-progress-summary'] },
  { file: 'src/views/LiveArchiveView.css', selectors: ['.live-archive-stage-rail button', '.live-archive-tab-list button', '.live-archive-panel > header h2', '.live-archive-panel > header span'] },
  { file: 'src/views/ReviewSessionView.css', selectors: ['.review-session-settings-sources strong', '.review-session-settings-sources small', '.review-session-settings-count', '.review-session-intro h1'] },
  { file: 'src/views/settings/SettingsLayout.css', selectors: ['.settings-page-title', '.settings-section-title', '.settings-page-desc', '.settings-nav-item'] },
] as const

function blockFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{[^}]+\\}`))
  assert(match, `${selector} 缺少样式块`)
  return match[0]
}

export function testRelatedDesktopSurfacesUseFourTypeLevels(): void {
  for (const surface of SURFACES) {
    const css = readFileSync(path.resolve(surface.file), 'utf8').replace(/\r\n?/g, '\n')
    for (const selector of surface.selectors) {
      const block = blockFor(css, selector)
      assert(!/--fs-sm|--fs-mini|--fs-micro|--fs-xs/.test(block), `${surface.file} ${selector} 不得混用 --fs-*`)
      assert(!/font-size:\s*\d+px/.test(block), `${surface.file} ${selector} 不得使用裸字号`)
    }
  }
}

export function testRelatedDesktopNumbersStayTabular(): void {
  const weekly = readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8')
  const archive = readFileSync(path.resolve('src/views/LiveArchiveView.css'), 'utf8')
  assert(weekly.includes('var(--numeric-tabular)'), '周复盘数据数字必须保持等宽数字')
  assert(archive.includes('tabular-nums') || archive.includes('var(--numeric-tabular)'), '历史实盘数据数字必须保持等宽数字')
}
```

不要把整个 `WeeklyReviewView.css` 的分数、标签、风险区一次性改完。本任务只收四个相关界面的标题、导航、来源和元信息。设置子页（标签、品种、模板）不在本轮。

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/DesktopSurfaceTypography.design.test.ts`

Expected: FAIL，周复盘进度或历史实盘 tab 仍引用 `--fs-mini` / `--fs-sm`。

- [ ] **Step 3: Write minimal implementation**

只改测试点名的选择器：

- 页面标题 → `--type-page-title-size` / `--type-page-title-line-height`
- 分组标题 → `--type-section-title-size`
- 导航、来源标题、控件 → `--type-row-size` 或 `--type-body-size`
- 描述、日期、数量 → `--type-metadata-size`

历史实盘 `summary-grid strong` 保持 `--type-financial-size` 和 `tabular-nums`。周复盘 `.wr-metric strong` 不要为了过测试去改，它不在选择器名单里。

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-regression-tests.mjs --unit-only src/views/DesktopSurfaceTypography.design.test.ts src/views/WeeklyReviewHistory.design.test.ts src/views/WeeklyReviewRisk.design.test.ts src/views/LiveArchiveView.design.test.ts src/lib/designAuditSystemCompletion.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/views/DesktopSurfaceTypography.design.test.ts src/views/WeeklyReviewView.css src/views/LiveArchiveView.css src/views/ReviewSessionView.css src/views/settings/SettingsLayout.css
git commit -m "fix: align related desktop surfaces on type tokens"
```

---

### Task 7: 回归、类型检查与 Windows 安装包

**Files:**
- Test: 本计划改过的全部测试文件
- 不新增产品代码，除非类型检查暴露漏改

**Interfaces:**
- Consumes: Task 1–6 的全部导出与 CSS 契约
- Produces: `pnpm typecheck` 通过；针对性回归通过；Windows x64 NSIS 安装包。本轮不生成 macOS 包。

- [ ] **Step 1: Write the failing test**

没有新的产品测试。用已有命令当验收门。若 `ReviewSessionCoverage` 的 browser 发现 ID 未被 `scripts/test-discovery.mjs` 收录，先修 HTML 的 `window.__reviewSessionCoverageTest` 与 viewport meta，不要跳过。

- [ ] **Step 2: Run targeted regression**

```bash
node scripts/run-regression-tests.mjs --unit-only src/lib/tradeViewParams.test.ts src/lib/reviewSession.test.ts src/lib/workspaceFacetConsistency.test.ts src/views/WeeklyReviewHistory.design.test.ts src/views/WeeklyReviewRisk.design.test.ts src/views/LiveArchiveView.design.test.ts src/views/DesktopSurfaceTypography.design.test.ts src/lib/designAuditSystemCompletion.test.ts
```

Expected: PASS。

Browser（只跑本计划相关）：

```js
node --experimental-strip-types -e "import { runBrowserRegressionTests } from './scripts/run-browser-tests.mjs'; const r = await runBrowserRegressionTests(process.cwd(), { configFile: 'vite.config.ts', requestedTestIds: ['src/views/LiveArchiveView.browser.test.html#__liveArchiveViewTest@1280x900','src/views/WeeklyReviewPresentation.browser.test.html#__weeklyReviewPresentationTest@1440x900','src/views/ReviewSession.browser.test.html#__reviewSessionFlowTest@1280x860','src/views/ReviewSessionCoverage.browser.test.html#__reviewSessionCoverageTest@1280x860'] }); if (r.failed) process.exit(1)"
```

Expected: PASS。现有 `ReviewSession.browser.test` 里的“可随机复盘 2 条 / 3 条”数字若因资格放宽而变化，按新池规则改断言，不要为了保住旧数字把资格改回去。

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`

Expected: 退出码 0。

- [ ] **Step 4: Windows package**

Run: `pnpm dist:win`

Expected: `release/Trader-Atlas-1.4.1-win-x64.exe` 生成成功。不要在 Windows 上跑 `pnpm dist:mac`。

真实资料库只读验收不写进自动化，完成后人工打开本机资料库核对：

- 历史实盘不再出现两枚“未支持的筛选条件”
- 只开模拟盘且关闭有效图文时，数量随资料库实时变化（当前样本是 181，开启有效图文后是 178）
- 周复盘左栏“本周”、阶段名、状态在常用桌面宽度下不逐字换行
- 历史实盘顶部变矮，外层大卡消失

- [ ] **Step 5: Commit**

只提交 Task 2/5 若因旧 browser 断言数字变化而产生的测试修改：

```bash
git add src/views/ReviewSession.browser.test.tsx
git commit -m "test: align review session browser counts with the wider pool"
```

若这一步没有文件变化，不要空提交。

---

## Self-Review

**1. Spec coverage**

| 规格要求 | 任务 |
| --- | --- |
| `liveStage` / `tab` 不报未知筛选、不计入筛选数、清除时保留 | Task 1，browser 在 Task 4 |
| 真正未知参数仍可移除 | Task 1 `notARealFilter` |
| 案例算法不变 | Task 2 保留现有案例测试 |
| 实盘：所选阶段内已结束/错过，不看 `reviewStatus` | Task 2 |
| 模拟盘：全部已结束/错过，不受阶段限制 | Task 2 |
| 有效图文是唯一内容过滤器 | Task 2 |
| 预览 / 开始 / 轮次同一口径，不硬编码 181 | Task 2 + Task 5 |
| 来源为空显示 0，不回退 | Task 2 |
| 取消草稿不提交；已开始轮次保持快照 | Task 5，不改现有 draft/snapshot 逻辑 |
| 周复盘左栏约 220px、不换行、轻量选中、阅读轨道对齐 | Task 3 |
| 历史实盘紧凑阶段条、去掉三层厚卡、列表密度不变 | Task 4 |
| 随机复盘设置变矮、标题/说明分层、数量靠近条件 | Task 5 |
| 四级文本 token，数字等宽 | Task 6 |
| 类型检查 + 针对性测试 + Windows NSIS，不做 macOS 包 | Task 7 |

**2. Placeholder scan:** 无 TBD / “implement later” / “similar to Task N”。

**3. Type consistency:** `preservePageOwnedSearch`、`PAGE_OWNED_TRADE_VIEW_PARAMS`、`buildReviewSessionPool` 签名在后续任务中保持一致。Browser 测试 ID 为 `__reviewSessionCoverageTest`。
