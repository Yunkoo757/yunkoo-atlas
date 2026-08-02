# Weekly Review Route and Return State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让周复盘的历史周与页签状态可刷新、可分享，并让交易详情返回时精确恢复原周、原页签、点击位置和键盘焦点。

**Architecture:** 新增纯函数模块，把 `week` 与 `tab` 的解析、校验和规范化集中起来，并让 `WeeklyReviewView` 直接从 URL 派生页面状态。交易详情继续复用现有 `TradeDetailFrom` 和返回锚点机制，通过带命名空间的页面锚点区分普通证据与风险事件；`DetailView` 只增加周复盘来源识别和文案，不读取周复盘业务数据。

**Tech Stack:** TypeScript 5.6、React 18、React Router 6、Zustand、Vite 8、自定义 SSR 单元测试运行器、Playwright 浏览器回归运行器

## Global Constraints

- 所有新增和修改文件必须保存为 UTF-8 without BOM，保留全部中文字符。
- 当前周复盘详情的规范地址必须保持 `/weekly-review`。
- 历史周只使用 `week=YYYY-MM-DD`，年度趋势只使用 `tab=year`；默认值不得写入 URL。
- 周次和页签切换必须使用 `replace`，进入交易详情继续使用正常历史压栈。
- 规范化只能拥有 `week`、`tab`，必须保留 `visual` 和其他无关查询参数。
- 不新增依赖、持久化字段、周复盘实体或导航历史实体。
- 不改变周复盘指标、冻结证据、风险计算、活动周推导规则和视觉体系。
- 每个代码任务都必须执行红—绿测试循环，并在本任务测试通过后单独提交。

---

## File Map

- Create: `src/lib/weeklyReviewRouteState.ts` — 周复盘 URL 状态的唯一解析、规范化和写回实现。
- Create: `src/lib/weeklyReviewRouteState.test.ts` — 路由状态纯函数的边界测试。
- Modify: `src/views/WeeklyReviewView.tsx` — 消费 URL 状态、切换周次和页签、生成详情来源、恢复返回焦点。
- Modify: `src/views/WeeklyRiskEvidence.tsx` — 为风险事件生成唯一锚点和带来源的详情链接。
- Modify: `src/hooks/useTradeReturnAnchor.ts` — 在查找目标前通知来源页准备被折叠的返回目标。
- Modify: `src/lib/tradeRoute.ts` — 允许实盘详情接受 `/weekly-review` 来源。
- Modify: `src/views/DetailView.tsx` — 增加周复盘面包屑、返回名称和空状态文案。
- Modify: `src/regression.test.ts` — 覆盖合法来源、类型边界、完整查询和详情文案契约。
- Modify: `src/views/WeeklyReviewView.browser.test.tsx` — 覆盖 URL 恢复、替换导航、普通证据与风险事件原位返回、锚点缺失降级。
- Modify: `src/views/DetailShortcutNavigation.browser.test.tsx` — 使用真实 `DetailView` 覆盖周复盘来源文案和返回查询。
- Modify: `docs/superpowers/specs/2026-08-02-weekly-review-route-return-state-design.md` — 全部门禁通过后更新实施状态。

---

### Task 1: 周复盘 URL 状态纯函数

**Files:**
- Create: `src/lib/weeklyReviewRouteState.ts`
- Create: `src/lib/weeklyReviewRouteState.test.ts`

**Interfaces:**
- Consumes: 标准查询字符串、`currentWeek: string`、`availableWeeks: readonly string[]`。
- Produces: `WeeklyReviewTab`、`WeeklyReviewRouteState`、`WeeklyReviewRouteResolution`、`buildWeeklyReviewSearch()`、`resolveWeeklyReviewRouteState()`。

- [ ] **Step 1: 写入失败的纯函数测试**

创建 `src/lib/weeklyReviewRouteState.test.ts`：

```ts
import {
  buildWeeklyReviewSearch,
  resolveWeeklyReviewRouteState,
} from '@/lib/weeklyReviewRouteState'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const currentWeek = '2026-07-27'
const historyWeek = '2026-07-20'
const availableWeeks = [currentWeek, historyWeek]

export function testWeeklyReviewRouteUsesCompactCanonicalDefaults(): void {
  const result = resolveWeeklyReviewRouteState('', { currentWeek, availableWeeks })
  assert(result.state.selectedWeek === currentWeek, '默认地址必须使用当前周')
  assert(result.state.tab === 'review', '默认地址必须使用复盘详情')
  assert(result.canonicalSearch === '', '默认状态不得产生查询参数')
  assert(!result.needsReplace, '规范默认地址不得重复 replace')

  const explicitDefaults = resolveWeeklyReviewRouteState(
    `?week=${currentWeek}&tab=review&visual=mobile`,
    { currentWeek, availableWeeks },
  )
  assert(explicitDefaults.canonicalSearch === '?visual=mobile', '默认参数必须压缩并保留 visual')
  assert(explicitDefaults.needsReplace, '冗余默认参数必须被替换')
}

export function testWeeklyReviewRouteRestoresHistoryAndYearTab(): void {
  const result = resolveWeeklyReviewRouteState(
    `?tab=year&week=${historyWeek}&visual=desktop`,
    { currentWeek, availableWeeks },
  )
  assert(result.state.selectedWeek === historyWeek, '有效历史周必须保持固定')
  assert(result.state.tab === 'year', '年度趋势页签必须恢复')
  assert(
    result.canonicalSearch === `?week=${historyWeek}&tab=year&visual=desktop`,
    '规范地址必须按 week、tab、其他参数的稳定顺序输出',
  )
}

export function testWeeklyReviewRouteCleansInvalidOwnedParamsOnly(): void {
  const result = resolveWeeklyReviewRouteState(
    '?week=2026-07-22&tab=unknown&visual=mobile&fixture=route',
    { currentWeek, availableWeeks },
  )
  assert(result.state.selectedWeek === currentWeek, '不可用周必须回退当前周')
  assert(result.state.tab === 'review', '非法页签必须回退复盘详情')
  assert(
    result.canonicalSearch === '?fixture=route&visual=mobile',
    '纠正只能清理 week 和 tab，并稳定保留其他参数',
  )
}

export function testWeeklyReviewRouteBuildersPreserveUnrelatedParams(): void {
  const historySearch = buildWeeklyReviewSearch(
    '?visual=mobile&fixture=route',
    { selectedWeek: historyWeek, tab: 'review' },
    currentWeek,
  )
  assert(historySearch === `?week=${historyWeek}&fixture=route&visual=mobile`, '历史周地址错误')

  const yearSearch = buildWeeklyReviewSearch(
    historySearch,
    { selectedWeek: historyWeek, tab: 'year' },
    currentWeek,
  )
  assert(
    yearSearch === `?week=${historyWeek}&tab=year&fixture=route&visual=mobile`,
    '年度趋势写回不得丢失历史周或其他参数',
  )
}

export function testWeeklyReviewRouteFollowsRolloverUnlessHistoryIsPinned(): void {
  const nextCurrentWeek = '2026-08-03'
  const nextAvailableWeeks = [nextCurrentWeek, currentWeek, historyWeek]
  const defaultResult = resolveWeeklyReviewRouteState('', {
    currentWeek: nextCurrentWeek,
    availableWeeks: nextAvailableWeeks,
  })
  assert(defaultResult.state.selectedWeek === nextCurrentWeek, '默认地址跨周后必须跟随新当前周')

  const pinnedResult = resolveWeeklyReviewRouteState(`?week=${historyWeek}`, {
    currentWeek: nextCurrentWeek,
    availableWeeks: nextAvailableWeeks,
  })
  assert(pinnedResult.state.selectedWeek === historyWeek, '显式历史周跨周后必须保持固定')

  const unavailableResult = resolveWeeklyReviewRouteState('?week=2026-07-13', {
    currentWeek: nextCurrentWeek,
    availableWeeks: nextAvailableWeeks,
  })
  assert(unavailableResult.state.selectedWeek === nextCurrentWeek, '不可用的合法周日期必须回退当前周')
}
```

- [ ] **Step 2: 运行目标测试并确认失败**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyReviewRouteState.test.ts
```

Expected: FAIL，错误指向无法解析 `@/lib/weeklyReviewRouteState`。

- [ ] **Step 3: 实现最小纯函数模块**

创建 `src/lib/weeklyReviewRouteState.ts`：

```ts
export type WeeklyReviewTab = 'review' | 'year'

export type WeeklyReviewRouteState = {
  selectedWeek: string
  tab: WeeklyReviewTab
}

export type WeeklyReviewRouteOptions = {
  currentWeek: string
  availableWeeks: readonly string[]
}

export type WeeklyReviewRouteResolution = {
  state: WeeklyReviewRouteState
  canonicalSearch: string
  needsReplace: boolean
}

const OWNED_PARAMS = new Set(['week', 'tab'])

function unrelatedEntries(search: string): Array<[string, string]> {
  return [...new URLSearchParams(search).entries()]
    .filter(([key]) => !OWNED_PARAMS.has(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
    )
}

function toSearch(params: URLSearchParams): string {
  const value = params.toString()
  return value ? `?${value}` : ''
}

export function buildWeeklyReviewSearch(
  baseSearch: string,
  state: WeeklyReviewRouteState,
  currentWeek: string,
): string {
  const params = new URLSearchParams()
  if (state.selectedWeek !== currentWeek) params.set('week', state.selectedWeek)
  if (state.tab === 'year') params.set('tab', 'year')
  for (const [key, value] of unrelatedEntries(baseSearch)) params.append(key, value)
  return toSearch(params)
}

export function resolveWeeklyReviewRouteState(
  search: string,
  options: WeeklyReviewRouteOptions,
): WeeklyReviewRouteResolution {
  const params = new URLSearchParams(search)
  const requestedWeek = params.get('week')
  const selectedWeek = requestedWeek && options.availableWeeks.includes(requestedWeek)
    ? requestedWeek
    : options.currentWeek
  const tab: WeeklyReviewTab = params.get('tab') === 'year' ? 'year' : 'review'
  const state = { selectedWeek, tab }
  const canonicalSearch = buildWeeklyReviewSearch(search, state, options.currentWeek)
  return {
    state,
    canonicalSearch,
    needsReplace: canonicalSearch !== search,
  }
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyReviewRouteState.test.ts
pnpm typecheck
```

Expected: 新增测试全部 PASS，类型检查退出码为 0。

- [ ] **Step 5: 提交纯函数任务**

```powershell
git add src/lib/weeklyReviewRouteState.ts src/lib/weeklyReviewRouteState.test.ts
git commit -m "feat: add weekly review route state"
```

---

### Task 2: 让周复盘直接消费 URL 状态

**Files:**
- Modify: `src/views/WeeklyReviewView.tsx:1-285,292-360`
- Modify: `src/views/WeeklyReviewView.browser.test.tsx:1-20,150-260,700-820`

**Interfaces:**
- Consumes: Task 1 的 `resolveWeeklyReviewRouteState(search, options)` 和 `buildWeeklyReviewSearch(baseSearch, state, currentWeek)`。
- Produces: URL 驱动的 `selectedWeek`、`tab`、`changeWeek()`、`changeTab()`；规范化通过 React Router `replace` 完成。

- [ ] **Step 1: 在浏览器 fixture 中加入 URL 与导航类型断言**

在 `WeeklyReviewView.browser.test.tsx` 中从 `react-router-dom` 导入 `useLocation`、`useNavigationType`，加入探针：

```tsx
function RouteProbe() {
  const location = useLocation()
  const navigationType = useNavigationType()
  return (
    <output
      data-testid="weekly-route-probe"
      data-pathname={location.pathname}
      data-search={location.search}
      data-navigation-type={navigationType}
    />
  )
}
```

把 `/weekly-review` 路由元素改成同时渲染探针：

```tsx
<Route
  path="/weekly-review"
  element={<><WeeklyReviewView /><StoreRenderSentinel /><RouteProbe /></>}
/>
```

在创建上一周 `priorReview` 后，加入以下断言；`priorReview.weekStart` 已由 fixture 生成：

```ts
historyButtons[1]?.click()
await waitFor(
  () => document.querySelector('[data-testid="weekly-route-probe"]')
    ?.getAttribute('data-search') === `?week=${priorReview.weekStart}`,
  '切换历史周后 URL 没有写入 week',
)
assert(
  document.querySelector('[data-testid="weekly-route-probe"]')
    ?.getAttribute('data-navigation-type') === 'REPLACE',
  '周次切换必须替换当前历史项',
)

clickButton('年度趋势')
await waitFor(
  () => document.querySelector('[data-testid="weekly-route-probe"]')
    ?.getAttribute('data-search') === `?week=${priorReview.weekStart}&tab=year`,
  '年度趋势没有保留历史周并写入 tab=year',
)

clickButton('本周复盘')
await waitFor(
  () => document.querySelector('[data-testid="weekly-route-probe"]')
    ?.getAttribute('data-search') === `?week=${priorReview.weekStart}`,
  '返回复盘详情后没有清理默认 tab',
)
```

在 fixture 结束前使用新 `MemoryRouter` key 重挂载非法地址，断言清理本功能参数但保留无关参数：

先重挂载有效历史深链，验证刷新等价行为：

```tsx
root.render(
  <MemoryRouter
    key="restored-weekly-route"
    initialEntries={[`/weekly-review?week=${priorReview.weekStart}&tab=year&visual=mobile`]}
  >
    <Routes>
      <Route path="/weekly-review" element={<><WeeklyReviewView /><RouteProbe /></>} />
    </Routes>
  </MemoryRouter>,
)
await waitFor(
  () => document.body.textContent?.includes('做法评分趋势') ?? false,
  '重挂载历史年度深链后没有恢复年度趋势',
)
assert(
  document.querySelector('[data-testid="weekly-route-probe"]')
    ?.getAttribute('data-search') === `?week=${priorReview.weekStart}&tab=year&visual=mobile`,
  '重挂载后没有保留历史周、页签和无关参数',
)
```

随后重挂载非法地址：

```tsx
root.render(
  <MemoryRouter
    key="invalid-weekly-route"
    initialEntries={['/weekly-review?week=2026-07-22&tab=unknown&visual=mobile']}
  >
    <Routes>
      <Route path="/weekly-review" element={<><WeeklyReviewView /><RouteProbe /></>} />
    </Routes>
  </MemoryRouter>,
)
await waitFor(
  () => document.querySelector('[data-testid="weekly-route-probe"]')
    ?.getAttribute('data-search') === '?visual=mobile',
  '非法周复盘参数没有一次性清理',
)
```

- [ ] **Step 2: 运行浏览器回归并确认新增断言失败**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
```

Expected: `WeeklyReviewView.browser.test.html` FAIL，首个失败断言为历史周 URL 未写入 `week`。

- [ ] **Step 3: 用路由状态替换本地周次和页签状态**

修改 `WeeklyReviewView.tsx`：

1. 将路由导入改为：

```ts
import { Link, useLocation, useNavigate } from 'react-router-dom'
```

2. 导入 Task 1 的两个函数：

```ts
import {
  buildWeeklyReviewSearch,
  resolveWeeklyReviewRouteState,
  type WeeklyReviewTab,
} from '@/lib/weeklyReviewRouteState'
```

3. 删除 `selectedWeek`、`previousCurrentWeekRef`、`tab` 的三个本地状态以及同步当前周的 effect。先推导 `availableWeeks`，再解析路由：

```ts
const location = useLocation()
const navigate = useNavigate()
const availableWeeks = useMemo(
  () => deriveWeeklyReviewWeeks(trades, reviews, currentWeek, tradingDayStartHour),
  [trades, reviews, currentWeek, tradingDayStartHour],
)
const routeResolution = useMemo(
  () => resolveWeeklyReviewRouteState(location.search, { currentWeek, availableWeeks }),
  [availableWeeks, currentWeek, location.search],
)
const { selectedWeek, tab } = routeResolution.state

useEffect(() => {
  if (!routeResolution.needsReplace) return
  navigate(
    { pathname: location.pathname, search: routeResolution.canonicalSearch },
    { replace: true, state: location.state },
  )
}, [
  location.pathname,
  location.state,
  navigate,
  routeResolution.canonicalSearch,
  routeResolution.needsReplace,
])
```

4. 删除页面后部原有的 `availableWeeks` 重复推导。加入统一写回函数：

```ts
const replaceRouteState = useCallback((nextWeek: string, nextTab: WeeklyReviewTab) => {
  const search = buildWeeklyReviewSearch(
    location.search,
    { selectedWeek: nextWeek, tab: nextTab },
    currentWeek,
  )
  navigate(
    { pathname: location.pathname, search },
    { replace: true, state: location.state },
  )
}, [currentWeek, location.pathname, location.search, location.state, navigate])

const changeWeek = async (week: string) => {
  if (week === selectedWeek) return
  const draftSaved = await flushNoteDraftToStore(draftId)
  if (!draftSaved) {
    toast('正文尚未保存，请重试')
    return
  }
  replaceRouteState(week, tab)
}

const changeTab = (nextTab: WeeklyReviewTab) => {
  if (nextTab === tab) return
  replaceRouteState(selectedWeek, nextTab)
}
```

5. 所有周次按钮改为 `onClick={() => void changeWeek(week)}`；上一周和下一周按钮同样使用 `void changeWeek(...)`。两个页签按钮分别调用 `changeTab('review')` 和 `changeTab('year')`。

- [ ] **Step 4: 运行纯函数、浏览器和类型检查**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/lib/weeklyReviewRouteState.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
```

Expected: URL 断言、原有周复盘浏览器断言和类型检查全部 PASS。

- [ ] **Step 5: 提交 URL 接线任务**

```powershell
git add src/views/WeeklyReviewView.tsx src/views/WeeklyReviewView.browser.test.tsx
git commit -m "feat: persist weekly review state in url"
```

---

### Task 3: 普通证据与风险事件精确原位返回

**Files:**
- Modify: `src/views/WeeklyReviewView.tsx:99-142,145-220,292-380,450-472`
- Modify: `src/views/WeeklyRiskEvidence.tsx:1-12,46-55,112-132`
- Modify: `src/hooks/useTradeReturnAnchor.ts:15-115`
- Modify: `src/views/WeeklyReviewView.browser.test.tsx:1-20,150-260,600-820`

**Interfaces:**
- Consumes: `TradeDetailFrom`、`tradeDetailNavState()`、`rememberTradeReturnAnchor()`、`useTradeReturnAnchor()`。
- Produces: 普通证据锚点 `weekly-trade:<trade-id>`、风险事件锚点 `weekly-risk:<event-id>`、详情来源 `{ pathname, search, anchorTradeId }`、`onRestoreStart(anchorId)` 恢复准备回调。

- [ ] **Step 1: 扩展浏览器 fixture 的来源与焦点断言**

将 fixture 中的假详情组件改为读取路由 state，并提供显式返回动作：

```tsx
function DetailFixture() {
  const location = useLocation()
  const navigate = useNavigate()
  const from = (location.state as TradeDetailLocationState | null)?.from
  return (
    <div data-testid="weekly-detail" data-source-anchor={from?.anchorTradeId ?? ''}>
      交易详情
      <Link
        to={{ pathname: from?.pathname ?? '/list', search: from?.search ?? '' }}
        state={tradeReturnLocationState(from?.anchorTradeId)}
      >
        返回复盘
      </Link>
      <button type="button" onClick={() => navigate(-1)}>浏览器返回</button>
    </div>
  )
}
```

补充导入：

```ts
import type { TradeDetailLocationState } from '@/lib/tradeRoute'
import { tradeReturnLocationState } from '@/hooks/useTradeReturnAnchor'
```

路由改为：

```tsx
<Route path="/trade/:id" element={<DetailFixture />} />
```

在未删除交易时先验证普通证据：

```ts
const ordinaryEvidenceLink = document.querySelector<HTMLAnchorElement>(
  '[data-trade-id="weekly-trade:one"] [data-trade-primary-action]',
)
assert(ordinaryEvidenceLink, '普通交易证据缺少稳定返回锚点和主操作')
ordinaryEvidenceLink.click()
await waitFor(() => document.querySelector('[data-testid="weekly-detail"]') !== null, '普通证据未进入详情')
assert(
  document.querySelector('[data-testid="weekly-detail"]')
    ?.getAttribute('data-source-anchor') === 'weekly-trade:one',
  '普通证据没有携带命名空间锚点',
)
clickLink('返回复盘')
await waitFor(
  () => document.activeElement?.closest('[data-trade-id="weekly-trade:one"]') !== null,
  '普通证据返回后没有恢复原位置和焦点',
)

document.querySelector<HTMLAnchorElement>(
  '[data-trade-id="weekly-trade:one"] [data-trade-primary-action]',
)?.click()
await waitFor(() => document.querySelector('[data-testid="weekly-detail"]') !== null, '第二次未进入普通证据详情')
clickButton('浏览器返回')
await waitFor(
  () => document.activeElement?.closest('[data-trade-id="weekly-trade:one"]') !== null,
  '浏览器返回没有读取 sessionStorage 并恢复普通证据焦点',
)
```

先展开“继续交易确认”，再验证风险事件；返回后审计区必须自动重新展开。使用 fixture 已有的 `resolvedRiskEvent()`：

```ts
const confirmationDisclosure = [...document.querySelectorAll<HTMLDetailsElement>('.wr-risk-audit')]
  .find((details) => details.querySelector('summary')?.textContent?.includes('继续交易确认'))
assert(confirmationDisclosure, '缺少继续交易确认审计区')
confirmationDisclosure.querySelector('summary')?.click()
await waitFor(() => confirmationDisclosure.open, '继续交易确认审计区没有展开')
const resolvedRiskArticle = document.querySelector<HTMLElement>(
  '[data-trade-id="weekly-risk:override-resolved"]',
)
const resolvedRiskLink = resolvedRiskArticle?.querySelector<HTMLAnchorElement>(
  '[data-trade-primary-action]',
)
assert(resolvedRiskLink, '风险事件缺少独立锚点和主操作')
resolvedRiskLink.click()
await waitFor(() => document.querySelector('[data-testid="weekly-detail"]') !== null, '风险事件未进入详情')
assert(
  document.querySelector('[data-testid="weekly-detail"]')
    ?.getAttribute('data-source-anchor') === 'weekly-risk:override-resolved',
  '风险事件没有携带独立命名空间锚点',
)
clickLink('返回复盘')
await waitFor(
  () => document.activeElement?.closest('[data-trade-id="weekly-risk:override-resolved"]') !== null,
  '风险事件返回后错误定位到普通证据',
)
assert(
  [...document.querySelectorAll<HTMLDetailsElement>('.wr-risk-audit')]
    .some((details) => details.open && details.textContent?.includes('盈利后仍按计划执行')),
  '风险事件返回后没有先展开继续交易确认审计区',
)
```

为 fixture 增加以下确定性帮助函数：

```ts
function clickLink(label: string): HTMLAnchorElement {
  const link = [...document.querySelectorAll<HTMLAnchorElement>('a')]
    .find((item) => item.textContent?.trim() === label)
  assert(link, `找不到链接：${label}`)
  link.click()
  return link
}
```

在 fixture 末尾通过一次带缺失恢复 state 的重挂载模拟交易已不存在。该场景必须仍停在周复盘，并显示一次提示：

```tsx
root.render(
  <MemoryRouter
    key="missing-weekly-anchor"
    initialEntries={[{
      pathname: '/weekly-review',
      state: { restoreTradeId: 'weekly-trade:missing' },
    }]}
  >
    <Routes>
      <Route path="/weekly-review" element={<><WeeklyReviewView /><RouteProbe /></>} />
    </Routes>
  </MemoryRouter>,
)
await waitFor(
  () => document.body.textContent?.includes('原交易已不在当前复盘证据中') ?? false,
  '缺失锚点没有触发降级提示',
)
assert(
  document.body.textContent?.includes('原交易已不在当前复盘证据中'),
  '锚点消失后缺少明确降级提示',
)
assert(
  document.querySelector('[data-testid="weekly-route-probe"]')
    ?.getAttribute('data-pathname') === '/weekly-review',
  '锚点消失后不得跳回交易日志',
)
assert(document.activeElement?.classList.contains('wr-main'), '锚点消失后焦点必须落到周复盘内容起点')
```

- [ ] **Step 2: 运行浏览器回归并确认锚点断言失败**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
```

Expected: `WeeklyReviewView.browser.test.html` FAIL，页面中不存在 `weekly-trade:one` 锚点。

- [ ] **Step 3: 为返回 hook 增加恢复前准备回调**

在 `useTradeReturnAnchor.ts` 扩展选项：

```ts
export type UseTradeReturnAnchorOptions = {
  onMissing?: (tradeId: string) => void
  onRestoreStart?: (tradeId: string) => void
}
```

增加最新回调 ref：

```ts
const onRestoreStartRef = useRef(options.onRestoreStart)

useEffect(() => {
  onRestoreStartRef.current = options.onRestoreStart
}, [options.onRestoreStart])
```

把 `pendingRef` 的值类型扩展为：

```ts
{
  key: string
  tradeId: string
  explicit: boolean
  prepared: boolean
}
```

创建 pending 时写入 `prepared: false`。在 `attemptRestore()` 第一次查找目标之前执行，并明确等待下一帧，让来源页有机会展开折叠区域：

```ts
if (!pending.prepared) {
  pending.prepared = true
  onRestoreStartRef.current?.(pending.tradeId)
  frame += 1
  animationFrame = requestAnimationFrame(attemptRestore)
  return
}
```

该回调只暴露锚点字符串，不解析 `weekly-risk:`，因此现有列表、看板、错失机会和风险设置调用不需要修改。

- [ ] **Step 4: 为普通交易证据接入来源状态**

在 `WeeklyReviewView.tsx` 导入：

```ts
import {
  rememberTradeReturnAnchor,
  useTradeReturnAnchor,
} from '@/hooks/useTradeReturnAnchor'
import {
  tradeDetailNavState,
  tradeDetailPath,
  type TradeDetailFrom,
} from '@/lib/tradeRoute'
```

把 `TradeEvidence` props 扩展为：

```ts
{
  trade: WeeklyReviewEvidenceTrade
  review: WeeklyReview
  onPatch: (patch: ReviewPatch) => void
  detailFrom: TradeDetailFrom
}
```

普通证据根节点和链接改为：

```tsx
<article className="wr-trade-row" data-trade-id={detailFrom.anchorTradeId}>
  <Link
    to={tradeDetailPath(trade)}
    state={tradeDetailNavState(detailFrom)}
    onClick={() => rememberTradeReturnAnchor(detailFrom)}
    className="wr-trade-main"
    data-trade-primary-action
  >
```

在 `WeeklyReviewView` 内定义来源构造器：

```ts
const detailFrom = useCallback((anchorTradeId: string): TradeDetailFrom => ({
  pathname: location.pathname,
  search: routeResolution.canonicalSearch,
  anchorTradeId,
}), [location.pathname, routeResolution.canonicalSearch])
```

两处 `TradeEvidence` 映射分别传入：

```tsx
detailFrom={detailFrom(`weekly-trade:${trade.id}`)}
```

- [ ] **Step 5: 为风险事件接入独立锚点和受控展开状态**

在 `WeeklyRiskEvidence.tsx` 导入 `rememberTradeReturnAnchor`、`tradeDetailNavState` 和 `TradeDetailFrom`。扩展 props：

```ts
interface WeeklyRiskEvidenceProps {
  snapshot?: WeeklyRiskReviewSnapshot
  availability?: 'draft' | 'legacy'
  detailSource?: Pick<TradeDetailFrom, 'pathname' | 'search'>
  overrideEventsOpen?: boolean
  onOverrideEventsOpenChange?: (open: boolean) => void
}
```

把“继续交易确认”的 `<details>` 改为受控状态：

```tsx
<details
  className="wr-risk-audit"
  open={overrideEventsOpen}
  onToggle={(event) => onOverrideEventsOpenChange?.(event.currentTarget.open)}
>
```

对每个 override event 生成来源：

```ts
const eventFrom = detailSource
  ? {
      ...detailSource,
      anchorTradeId: `weekly-risk:${event.id}`,
    }
  : undefined
```

风险事件 article 与链接改为：

```tsx
<article key={event.id} data-trade-id={eventFrom?.anchorTradeId}>
  <p>{event.reason}</p>
  <small>
    {event.tradeIdentityAtDecision.ref} · {event.tradeIdentityAtDecision.symbol} · {event.linkState === 'resolved' ? '已关联' : '关联未解析'}
    {event.linkState === 'resolved' ? <>
      {' · '}
      <Link
        to={tradeDetailPath(event.tradeIdentityAtDecision)}
        state={eventFrom ? tradeDetailNavState(eventFrom) : undefined}
        onClick={() => eventFrom && rememberTradeReturnAnchor(eventFrom)}
        data-trade-primary-action
      >
        查看交易
      </Link>
    </> : null}
  </small>
</article>
```

`WeeklyReviewView` 调用风险组件时传入：

```tsx
detailSource={{
  pathname: location.pathname,
  search: routeResolution.canonicalSearch,
}}
overrideEventsOpen={overrideEventsOpen}
onOverrideEventsOpenChange={setOverrideEventsOpen}
```

- [ ] **Step 6: 启用恢复准备、返回恢复与缺失降级**

在 `WeeklyReviewView` 中增加主内容 ref、审计展开状态和回调：

```ts
const mainContentRef = useRef<HTMLElement>(null)
const [overrideEventsOpen, setOverrideEventsOpen] = useState(false)
const handleReturnRestoreStart = useCallback((anchorId: string) => {
  if (anchorId.startsWith('weekly-risk:')) setOverrideEventsOpen(true)
}, [])
const handleMissingReturnAnchor = useCallback(() => {
  const target = mainContentRef.current
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ block: 'start' })
  toast('原交易已不在当前复盘证据中')
}, [])

useTradeReturnAnchor({
  onRestoreStart: handleReturnRestoreStart,
  onMissing: handleMissingReturnAnchor,
})
```

主内容容器改为：

```tsx
<section
  ref={mainContentRef}
  className="wr-main"
  aria-label="周复盘内容"
  tabIndex={-1}
>
```

- [ ] **Step 7: 运行浏览器回归和类型检查**

Run:

```powershell
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
```

Expected: 普通证据、风险事件、锚点缺失和全部既有浏览器场景 PASS；类型检查退出码为 0。

- [ ] **Step 8: 提交原位返回任务**

```powershell
git add src/hooks/useTradeReturnAnchor.ts src/views/WeeklyReviewView.tsx src/views/WeeklyRiskEvidence.tsx src/views/WeeklyReviewView.browser.test.tsx
git commit -m "feat: restore weekly review trade position"
```

---

### Task 4: 详情页周复盘来源与专属文案

**Files:**
- Modify: `src/lib/tradeRoute.ts:8-71`
- Modify: `src/views/DetailView.tsx:239-257,448-485,739-752`
- Modify: `src/regression.test.ts:1658-1755`
- Modify: `src/views/DetailShortcutNavigation.browser.test.tsx:1-75,150-240`

**Interfaces:**
- Consumes: Task 3 写入的 `{ pathname: '/weekly-review', search, anchorTradeId }`。
- Produces: 实盘详情合法返回目标 `/weekly-review`、面包屑 `周复盘`、返回名称 `返回周复盘`。

- [ ] **Step 1: 写入失败的详情来源与文案契约测试**

在 `testTradeDetailReturnRemembersListView()` 中加入：

```ts
const weeklyReviewReturn = resolveTradeDetailReturn({
  from: {
    pathname: '/weekly-review',
    search: '?week=2026-07-20&tab=year&visual=mobile',
    anchorTradeId: 'weekly-trade:live-1',
  },
  tradeKind: 'live',
})
assert(weeklyReviewReturn.pathname === '/weekly-review', '实盘详情必须接受周复盘来源')
assert(
  weeklyReviewReturn.search === '?week=2026-07-20&tab=year&visual=mobile',
  '周复盘返回目标必须保留完整查询参数',
)

const invalidPaperWeeklySource = resolveTradeDetailReturn({
  from: { pathname: '/weekly-review', anchorTradeId: 'weekly-trade:paper-1' },
  tradeKind: 'paper',
})
assert(invalidPaperWeeklySource.pathname === '/list', '模拟盘不得接受周复盘来源')

const invalidCaseWeeklySource = resolveTradeDetailReturn({
  from: { pathname: '/weekly-review', anchorTradeId: 'weekly-trade:case-1' },
  tradeKind: 'case',
})
assert(invalidCaseWeeklySource.pathname === '/review-cases', '案例不得接受周复盘来源')

const missingWeeklyTradeReturn = resolveTradeDetailReturn({
  from: {
    pathname: '/weekly-review',
    search: '?week=2026-07-20',
    anchorTradeId: 'weekly-trade:purged-live-1',
  },
})
assert(missingWeeklyTradeReturn.pathname === '/weekly-review', '已彻底不存在的周复盘来源交易仍须返回原周')
assert(missingWeeklyTradeReturn.search === '?week=2026-07-20', '缺失交易返回时不得丢失原周')
```

新增源码契约测试：

```ts
export async function testWeeklyReviewDetailSourceUsesDedicatedReturnCopy(): Promise<void> {
  const fs = await import('node:fs/promises')
  const detailView = await fs.readFile('src/views/DetailView.tsx', 'utf8')
  assert(detailView.includes("from?.pathname === '/weekly-review'"), '详情页必须识别周复盘来源')
  assert(detailView.includes("'周复盘'"), '详情面包屑必须显示周复盘')
  assert(detailView.includes("'返回周复盘'"), '详情返回按钮必须使用周复盘专属名称')
}
```

- [ ] **Step 2: 运行 regression 测试并确认失败**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts
```

Expected: FAIL，`weeklyReviewReturn.pathname` 实际回退 `/list`。

- [ ] **Step 3: 允许合法的周复盘实盘来源**

在 `tradeRoute.ts` 的 `isValidDetailSource()` 中加入：

```ts
if (pathname === '/weekly-review') return tradeKind === 'live' || tradeKind === undefined
```

该判断放在案例工作区判断之前。`undefined` 只用于已经彻底不存在、无法再读取类型的内部来源记录；周复盘自身只生成实盘交易链接，明确的 `paper` 和 `case` 仍被拒绝。

- [ ] **Step 4: 统一详情正常、删除和缺失状态的文案**

在 `DetailView.tsx` 的来源解析处加入：

```ts
const fromWeeklyReview = from?.pathname === '/weekly-review'
const detailKind = trade?.tradeKind ?? deletedTrade?.tradeKind
const detailCrumb = fromMissedOpportunities
  ? '错过的机会'
  : fromWeeklyReview
    ? '周复盘'
    : detailKind === 'case'
      ? '案例记录'
      : detailKind === 'paper'
        ? '模拟'
        : '交易日志'
const backAriaLabel = fromMissedOpportunities
  ? '返回错过的机会'
  : fromWeeklyReview
    ? '返回周复盘'
    : '返回列表'
const returnDestinationLabel = fromMissedOpportunities
  ? '错过的机会'
  : fromWeeklyReview
    ? '周复盘'
    : detailKind === 'case'
      ? '案例记录'
      : '交易日志'
```

把删除或未找到空状态中的硬编码表达式：

```tsx
返回{deletedTrade?.tradeKind === 'case' ? '案例记录' : '交易日志'}
```

替换为：

```tsx
返回{returnDestinationLabel}
```

- [ ] **Step 5: 使用真实 DetailView 写入浏览器文案和返回查询测试**

在 `DetailShortcutNavigation.browser.test.tsx` 中增加一个实盘 fixture：

```ts
function makeWeeklyLiveTrade(): Trade {
  return {
    ...makeCase(1),
    id: 'weekly-live-1',
    ref: 'TRD-WEEKLY-LIVE-1',
    symbol: 'BTCUSDT',
    tradeKind: 'live',
    caseType: undefined,
    masteryState: undefined,
    nextReviewAt: undefined,
    note: '<p>周复盘来源交易</p>',
  }
}
```

增加一个返回目标探针：

```tsx
function WeeklyReturnProbe() {
  const location = useLocation()
  return <output data-testid="weekly-return-search">{location.search}</output>
}
```

在原有快捷键场景完成后、`finally` 之前，重挂载真实详情：

```tsx
const weeklyTrade = makeWeeklyLiveTrade()
useStore.setState({ trades: [weeklyTrade] })
root.render(
  <MemoryRouter
    key="weekly-detail-source"
    initialEntries={[{
      pathname: `/trade/${weeklyTrade.ref}`,
      state: tradeDetailNavState({
        pathname: '/weekly-review',
        search: '?week=2026-07-20&visual=mobile',
        anchorTradeId: 'weekly-trade:weekly-live-1',
      }),
    }]}
  >
    <Routes>
      <Route path="/trade/:id" element={<DetailView />} />
      <Route path="/weekly-review" element={<WeeklyReturnProbe />} />
    </Routes>
  </MemoryRouter>,
)
await waitFor(
  () => document.querySelector('[aria-label="返回周复盘"]') !== null,
  '真实详情页没有显示周复盘返回名称',
)
assert(document.body.textContent?.includes('周复盘'), '真实详情页面包屑没有显示周复盘')
document.querySelector<HTMLAnchorElement>('[aria-label="返回周复盘"]')?.click()
await waitFor(
  () => document.querySelector('[data-testid="weekly-return-search"]')?.textContent
    === '?week=2026-07-20&visual=mobile',
  '真实详情返回后没有保留原周和无关参数',
)

useStore.getState().removeTrade(weeklyTrade.id)
useStore.getState().purgeTrade(weeklyTrade.id)
root.render(
  <MemoryRouter
    key="missing-weekly-detail-source"
    initialEntries={[{
      pathname: `/trade/${weeklyTrade.ref}`,
      state: tradeDetailNavState({
        pathname: '/weekly-review',
        search: '?week=2026-07-20',
        anchorTradeId: 'weekly-trade:weekly-live-1',
      }),
    }]}
  >
    <Routes>
      <Route path="/trade/:id" element={<DetailView />} />
      <Route path="/weekly-review" element={<WeeklyReturnProbe />} />
    </Routes>
  </MemoryRouter>,
)
await waitFor(
  () => [...document.querySelectorAll<HTMLAnchorElement>('a')]
    .some((link) => link.textContent?.trim() === '返回周复盘'),
  '交易彻底不存在时空状态没有保留周复盘入口',
)
const missingReturn = [...document.querySelectorAll<HTMLAnchorElement>('a')]
  .find((link) => link.textContent?.trim() === '返回周复盘')
missingReturn?.click()
await waitFor(
  () => document.querySelector('[data-testid="weekly-return-search"]')?.textContent
    === '?week=2026-07-20',
  '交易彻底不存在时没有返回原周',
)
```

补充 `useLocation`、`tradeDetailNavState` 导入。`makeWeeklyLiveTrade()` 通过显式 `undefined` 清除案例专属可选字段，不改变 `Trade` 类型。

- [ ] **Step 6: 运行 regression、浏览器和类型检查**

Run:

```powershell
node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts
node scripts/run-browser-tests.mjs . vite.config.ts
pnpm typecheck
```

Expected: 周复盘来源、类型边界、详情文案和全部浏览器回归 PASS。

- [ ] **Step 7: 提交详情来源任务**

```powershell
git add src/lib/tradeRoute.ts src/views/DetailView.tsx src/regression.test.ts src/views/DetailShortcutNavigation.browser.test.tsx
git commit -m "feat: recognize weekly review detail source"
```

---

### Task 5: 完整回归、文档状态与交付检查

**Files:**
- Modify: `docs/superpowers/specs/2026-08-02-weekly-review-route-return-state-design.md:1-5`

**Interfaces:**
- Consumes: Tasks 1-4 的完整实现和提交。
- Produces: 可交付的回归证据、已实施设计状态、干净且可审查的工作树。

- [ ] **Step 1: 运行完整类型和自动化测试**

Run:

```powershell
pnpm typecheck
pnpm test
```

Expected: 两条命令退出码均为 0；完整测试不得出现跳过标记、待办标记或新增浏览器诊断错误。

- [ ] **Step 2: 检查差异、编码和 BOM**

Run:

```powershell
git diff --check
@'
$paths = git diff --name-only --diff-filter=ACM
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
foreach ($path in $paths) {
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $path))
  [void]$utf8.GetString($bytes)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    throw "检测到 UTF-8 BOM: $path"
  }
}
'@ | powershell -NoProfile -Command -
```

Expected: `git diff --check` 无输出；UTF-8 严格解码和无 BOM 检查退出码为 0。

- [ ] **Step 3: 对照验收标准做最终源码核对**

Run:

```powershell
rg -n "resolveWeeklyReviewRouteState|buildWeeklyReviewSearch|weekly-trade:|weekly-risk:|返回周复盘|pathname === '/weekly-review'" src
git status --short
```

Expected: 六类实现点都能定位；工作树只包含本计划内文件，没有 release、临时目录或无关修改。

- [ ] **Step 4: 更新设计文档状态**

将设计文档头部：

```markdown
状态：设计已确认，实施计划已完成，待执行
```

改为：

```markdown
状态：已实施并通过完整回归
```

- [ ] **Step 5: 提交验证文档**

```powershell
git add docs/superpowers/specs/2026-08-02-weekly-review-route-return-state-design.md
git commit -m "docs: mark weekly review route state complete"
```

- [ ] **Step 6: 记录最终交付信息**

Run:

```powershell
git status --short
git log -5 --oneline
```

Expected: 工作树干净；最近提交依次包含路由状态、URL 接线、原位返回、详情来源和设计状态五个提交。

最终交付说明必须包含：实现结果、`pnpm typecheck`、`pnpm test`、编码检查结果、最近提交摘要，以及本轮没有重新打包 EXE 的事实；只有用户再次要求打包时才执行 `pnpm dist:win`。
