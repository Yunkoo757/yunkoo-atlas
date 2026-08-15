# Historical Live Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有“历史记录”升级为“历史实盘”，在同一桌面模块中分别展示并筛选重置起点前的实盘记录及其关联案例。

**Architecture:** 保留现有 `all-archives` 实盘边界作为唯一事实来源，在 `liveStatisticsArchive` 中新增按 `sourceTradeId` 派生关联案例的纯函数，不新增持久化状态。页面以 `/live-history` 为规范路由，用查询参数保存实盘/案例视图和筛选状态，旧 `/live-archive` 路由仅承担兼容跳转。

**Tech Stack:** React 18、TypeScript、React Router 6、Zustand、CSS Design Tokens、Vite 8、Electron 43、Node 回归测试、Playwright 桌面视觉矩阵。

## Global Constraints

- 始终以 UTF-8 无 BOM 读取和保存文件，完整保留中文字符。
- 仅适配 Windows 和 macOS 桌面客户端，窗口范围为 960–1920px。
- 不新增数据库表、store slice、归档副本或双写字段。
- 历史实盘交易继续由 `resolveLiveArchiveScope(cycles, 'all-archives')` 与 `filterLiveLogRecords` 决定。
- 关联案例只按未删除案例的 `sourceTradeId` 指向历史实盘成员派生。
- 案例不得参与交易数量、胜率、净盈亏和平均 R 计算。
- 旧 `/live-archive` 路由必须继续兼容；用户界面统一使用“历史实盘”。
- 每个实现任务先建立失败契约，再写最小实现并独立提交。

---

## File Structure

- `src/lib/liveStatisticsArchive.ts`：历史实盘成员、关联案例投影和案例快捷分类的纯函数边界。
- `src/lib/liveStatisticsArchive.test.ts`：来源关联、排除条件、分类互斥和 KPI 隔离的单元契约。
- `src/views/LiveArchiveView.tsx`：历史实盘双视图、URL 状态、筛选、摘要、列表和详情返回。
- `src/views/LiveArchiveView.css`：双视图快捷栏、筛选面板和窄桌面布局。
- `src/views/LiveArchiveView.browser.test.tsx`：视图切换、筛选组合、空态、详情返回和旧路由交互。
- `src/views/LiveArchiveView.design.test.ts`：模块命名、共享组件、可访问状态和窄桌面样式契约。
- `src/App.tsx`：新增规范路由和旧路由兼容跳转。
- `src/components/Sidebar.tsx`：侧栏入口与导航语义。
- `src/lib/tradeRoute.ts`：允许历史实盘作为交易及案例详情的合法返回来源。
- `src/views/DetailView.tsx`、`src/views/Dashboard.tsx`、`src/views/ImportDataHealthView.tsx`：历史实盘相关返回与提示文案。
- `scripts/qa-desktop-visual.mjs` 及其场景定义：将历史截图场景切换到规范路由并覆盖关联案例视图。

---

### Task 1: Project Historical Cases from Archived Live Sources

**Files:**
- Modify: `src/lib/liveStatisticsArchive.test.ts`
- Modify: `src/lib/liveStatisticsArchive.ts`

**Interfaces:**
- Consumes: `Trade`、`LiveArchiveScope`、`filterLiveLogRecords`、`matchesReviewCaseScope` 和 `starredIds`。
- Produces: `filterAssociatedLiveArchiveCases(trades, archivedLiveRecords): Trade[]` 与 `matchesHistoricalCaseCategory(trade, category, starredIds): boolean`。

- [ ] **Step 1: Write failing archive-case projection tests**

在 `src/lib/liveStatisticsArchive.test.ts` 导入新接口并增加以下契约：

```ts
import {
  filterAssociatedLiveArchiveCases,
  matchesHistoricalCaseCategory,
  type HistoricalCaseCategory,
} from '@/lib/liveStatisticsArchive'

export function testAssociatedCasesOnlyFollowArchivedLiveSources(): void {
  const archived = [trade('archived-source'), trade('archived-missed', { status: 'missed' })]
  const candidates = [
    trade('linked', { tradeKind: 'case', sourceTradeId: 'archived-source', caseType: 'exemplar' }),
    trade('linked-missed', { tradeKind: 'case', sourceTradeId: 'archived-missed', caseType: 'missed' }),
    trade('current-source-case', { tradeKind: 'case', sourceTradeId: 'current-source' }),
    trade('unlinked', { tradeKind: 'case', sourceTradeId: undefined }),
    trade('deleted-case', { tradeKind: 'case', sourceTradeId: 'archived-source', deletedAt: '2026-01-02' }),
    trade('not-a-case', { sourceTradeId: 'archived-source' }),
  ]

  assert(
    ids(filterAssociatedLiveArchiveCases(candidates, archived)) === 'linked,linked-missed',
    '历史实盘案例只能按未删除案例的 sourceTradeId 投影',
  )
}

export function testHistoricalCaseCategoriesReuseCanonicalCaseSemantics(): void {
  const starred = new Set(['starred'])
  const fixtures = [
    trade('starred', { tradeKind: 'case', caseType: 'exemplar' }),
    trade('mistake', { tradeKind: 'case', caseType: 'mistake', mistakeTags: ['追单'] }),
    trade('missed', { tradeKind: 'case', caseType: 'missed', status: 'missed', mistakeTags: ['犹豫'] }),
    trade('recheck', { tradeKind: 'case', masteryState: 'recheck', reviewStatus: 'unreviewed' }),
    trade('mastered', { tradeKind: 'case', masteryState: 'mastered', reviewStatus: 'reviewed' }),
  ]
  const matching = (category: HistoricalCaseCategory) => fixtures
    .filter((item) => matchesHistoricalCaseCategory(item, category, starred))
    .map((item) => item.id)

  assert(matching('focus').includes('starred'), '重点必须兼容星标案例')
  assert(matching('mistakes').join(',') === 'mistake', '错题必须排除错过机会')
  assert(matching('missed').join(',') === 'missed', '错过机会必须按规范 caseType 命中')
  assert(matching('unreviewed').includes('recheck'), '待复看必须复用案例掌握状态')
  assert(matching('reviewed').includes('mastered'), '已掌握必须复用案例掌握状态')
}
```

- [ ] **Step 2: Run the focused unit suite and verify failure**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveStatisticsArchive.test.ts`

Expected: FAIL，提示 `filterAssociatedLiveArchiveCases` 或 `matchesHistoricalCaseCategory` 尚未导出。

- [ ] **Step 3: Implement the pure projection and category matcher**

在 `src/lib/liveStatisticsArchive.ts` 增加：

```ts
import { matchesReviewCaseScope } from '@/lib/reviewCaseScope'

export type HistoricalCaseCategory =
  | 'all'
  | 'focus'
  | 'mistakes'
  | 'missed'
  | 'unreviewed'
  | 'reviewed'

export function filterAssociatedLiveArchiveCases(
  trades: readonly Trade[],
  archivedLiveRecords: readonly Trade[],
): Trade[] {
  const archivedSourceIds = new Set(archivedLiveRecords.map((trade) => trade.id))
  return trades.filter((trade) =>
    trade.tradeKind === 'case' &&
    trade.deletedAt === undefined &&
    Boolean(trade.sourceTradeId) &&
    archivedSourceIds.has(trade.sourceTradeId!),
  )
}

export function matchesHistoricalCaseCategory(
  trade: Trade,
  category: HistoricalCaseCategory,
  starredIds: ReadonlySet<string>,
): boolean {
  if (category === 'all') return trade.tradeKind === 'case'
  if (category === 'missed') return trade.tradeKind === 'case' && trade.caseType === 'missed'
  return matchesReviewCaseScope(trade, category, starredIds)
}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/liveStatisticsArchive.test.ts`

Expected: PASS。

Run: `pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/liveStatisticsArchive.ts src/lib/liveStatisticsArchive.test.ts
git commit -m "feat: project historical live cases"
```

### Task 2: Add the Historical Live Dual View and Filters

**Files:**
- Modify: `src/views/LiveArchiveView.browser.test.tsx`
- Modify: `src/views/LiveArchiveView.tsx`
- Modify: `src/views/LiveArchiveView.css`

**Interfaces:**
- Consumes: Task 1 的 `filterAssociatedLiveArchiveCases`、`matchesHistoricalCaseCategory`、`HistoricalCaseCategory`，现有 `TradeList`、`TradeRow`、`FilterBar`、`Select` 与 `matchesTradeFacets`。
- Produces: `/live-history` 页面内由 `view=cases` 和 `caseCategory` 驱动的双视图、快捷分类与高级筛选。

- [ ] **Step 1: Add failing browser fixtures and dual-view assertions**

扩展 `src/views/LiveArchiveView.browser.test.tsx` 的 fixture：一个历史来源实盘、一个当前来源实盘、分别关联的案例、无来源案例、重点/错题/错过机会/待复看/已掌握案例。加入以下关键断言：

```ts
root.render(
  <MemoryRouter initialEntries={['/live-history?view=cases']}>
    <Routes><Route path="/live-history" element={<LiveArchiveView />} /></Routes>
  </MemoryRouter>,
)
await waitFor(() => document.body.textContent?.includes('关联案例') ?? false)
assert(document.querySelector('[data-trade-id="case-linked"]'), '必须显示历史来源案例')
assert(!document.querySelector('[data-trade-id="case-current"]'), '不得显示当前来源案例')
assert(!document.querySelector('[data-trade-id="case-unlinked"]'), '不得显示无来源案例')

findButton('错题')?.click()
await waitFor(() => Boolean(document.querySelector('[data-trade-id="case-mistake"]')))
assert(!document.querySelector('[data-trade-id="case-missed"]'), '错题快捷筛选必须排除错过机会')
```

再验证“实盘记录”按钮恢复交易列表、`view=cases&caseCategory=reviewed` 可刷新恢复、清除筛选后保留当前案例视图、详情导航 state 保留完整查询参数。

- [ ] **Step 2: Run the focused browser test and verify failure**

Run: `node scripts/run-regression-tests.mjs --browser-only src/views/LiveArchiveView.browser.test.tsx`

Expected: FAIL，`/live-history?view=cases` 尚无关联案例视图或快捷分类。

- [ ] **Step 3: Implement URL state and derived datasets**

在 `LiveArchiveView.tsx` 中规范化查询状态：

```ts
const view = searchParams.get('view') === 'cases' ? 'cases' : 'trades'
const requestedCategory = searchParams.get('caseCategory')
const caseCategory: HistoricalCaseCategory = HISTORICAL_CASE_CATEGORIES.includes(
  requestedCategory as HistoricalCaseCategory,
) ? requestedCategory as HistoricalCaseCategory : 'all'

const associatedCases = useMemo(
  () => filterAssociatedLiveArchiveCases(trades, historyMembers),
  [trades, historyMembers],
)
```

用 `setSearchParams(next, { replace: true })` 切换视图与筛选。切换回实盘视图时删除 `caseCategory`、`caseType` 和 `masteryState`；切换案例分类时保留 `view=cases` 与可组合高级条件。

- [ ] **Step 4: Implement shared facet filtering without changing KPI scope**

为页面筛选状态读取 `symbol`、`strategyId`、`side`、`status`、`tag`、`caseType`、`masteryState`，并将 `query`、`dateFrom`、`dateTo` 同步到 URL。用 `matchesTradeFacets` 过滤当前视图数据，但 `metrics` 继续只依赖未筛选的 `historyMembers`：

```ts
const sourceItems = view === 'cases' ? associatedCases : historyMembers
const visibleMembers = sourceItems.filter((trade) =>
  matchesHistoricalSearchAndDate(trade, query, dateFrom, dateTo, startHour) &&
  matchesTradeFacets(trade, facets, startHour) &&
  (view !== 'cases' || matchesHistoricalCaseCategory(trade, caseCategory, starredSet)),
)
```

案例日期优先使用 `recordedAt`，缺失时回退 `openedAt`；实盘继续使用既有归属业务日。筛选选项只从当前视图源数据收集，避免展示不存在的值。

- [ ] **Step 5: Render quick views, category chips and view-specific empty states**

在标准 `FilterBar` 的 `quickViews` 中加入：

```tsx
<div className="la-view-switch" aria-label="历史实盘视图">
  <button aria-pressed={view === 'trades'} onClick={() => setView('trades')}>实盘记录</button>
  <button aria-pressed={view === 'cases'} onClick={() => setView('cases')}>关联案例</button>
</div>
```

案例视图下渲染 `全部、重点、错题、错过机会、待复看、已掌握` 快捷按钮；列表 `recordLabel` 改为“案例记录”，分组名改为“关联案例”。没有关联案例时展示“历史实盘还没有关联案例”，有数据但筛选为空时继续提供“清除筛选”。

- [ ] **Step 6: Add desktop-only responsive styles**

在 `LiveArchiveView.css` 使用既有 token 增加 `.la-view-switch`、`.la-case-quickviews`、`.la-filter-select-grid`，在 `@media (max-width: 1099px)` 中允许快捷按钮横向滚动或紧凑换行。不得新增低于 960px 的移动端断点；交互控件保持至少现有共享按钮高度。

- [ ] **Step 7: Run focused browser, design and type verification**

Run: `node scripts/run-regression-tests.mjs --browser-only src/views/LiveArchiveView.browser.test.tsx`

Expected: PASS。

Run: `pnpm typecheck`

Expected: PASS。

Run: `pnpm qa:design`

Expected: PASS。

- [ ] **Step 8: Commit**

```powershell
git add -- src/views/LiveArchiveView.tsx src/views/LiveArchiveView.css src/views/LiveArchiveView.browser.test.tsx
git commit -m "feat: add historical live case views"
```

### Task 3: Establish the Canonical Route and Rename Product Copy

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/lib/tradeRoute.ts`
- Modify: `src/regression.test.ts`
- Modify: `src/views/DetailView.tsx`
- Modify: `src/views/Dashboard.tsx`
- Modify: `src/views/ImportDataHealthView.tsx`
- Modify: `src/views/LiveArchiveView.tsx`
- Modify: `src/views/LiveArchiveView.design.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `/live-history` 页面查询协议。
- Produces: 规范 `/live-history` 导航、旧路由兼容跳转和统一“历史实盘”文案。

- [ ] **Step 1: Add failing route and naming contracts**

在 `LiveArchiveView.design.test.ts` 和 `regression.test.ts` 增加断言：

```ts
assert(sidebar.includes('to="/live-history"'), '侧栏必须使用历史实盘规范路由')
assert(sidebar.includes('历史实盘'), '侧栏必须使用历史实盘名称')
assert(app.includes('path="/live-history"'), '应用必须注册历史实盘规范路由')
assert(app.includes('LegacyLiveArchiveRedirect'), '旧历史路由必须有显式兼容跳转')
assert(resolveTradeDetailReturn({
  from: { pathname: '/live-history', search: '?view=cases' },
  tradeKind: 'case',
}).pathname === '/live-history', '案例详情必须允许返回历史实盘')
```

静态扫描用户可见文案，确认目标文件不再把模块命名为“历史记录”。

- [ ] **Step 2: Run focused contracts and verify failure**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts src/views/LiveArchiveView.design.test.ts`

Expected: FAIL，侧栏或应用尚未注册 `/live-history`。

- [ ] **Step 3: Add the canonical and compatibility routes**

在 `App.tsx` 注册：

```tsx
<Route path="/live-history" element={<LiveArchiveView />} />
<Route path="/live-archive" element={<LegacyLiveArchiveRedirect />} />
<Route path="/live-archive/:archiveId" element={<LegacyLiveArchiveRedirect />} />
```

`LegacyLiveArchiveRedirect` 使用 `useLocation`、`useParams` 和 `<Navigate replace>`：无子路径时保留原查询；有 `archiveId` 时附加 `archiveReason=missing&requestedKey=<id>` 后跳到 `/live-history`。

- [ ] **Step 4: Rename navigation, page and return copy**

将侧栏、顶部标题、仪表盘提示、详情返回和导入日期核对中的模块名称统一为“历史实盘”。把所有新导航目标、`tradeDetailNavState` 和 `rememberTradeReturnAnchor` 的 pathname 改为 `/live-history`。`tradeRoute.ts` 同时接受 `/live-history` 与旧 `/live-archive`，保证旧返回栈仍有效。

- [ ] **Step 5: Run route, browser and full regression tests**

Run: `node scripts/run-regression-tests.mjs --unit-only src/regression.test.ts src/views/LiveArchiveView.design.test.ts`

Expected: PASS。

Run: `node scripts/run-regression-tests.mjs --browser-only src/views/LiveArchiveView.browser.test.tsx`

Expected: PASS，旧路由跳转后查询参数与兼容提示存在。

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS。

- [ ] **Step 6: Commit**

```powershell
git add -- src/App.tsx src/components/Sidebar.tsx src/lib/tradeRoute.ts src/regression.test.ts src/views/DetailView.tsx src/views/Dashboard.tsx src/views/ImportDataHealthView.tsx src/views/LiveArchiveView.tsx src/views/LiveArchiveView.design.test.ts
git commit -m "refactor: rename archive to historical live"
```

### Task 4: Complete Desktop Visual QA and Build the Windows Installer

**Files:**
- Modify: historical-live scenario files discovered by `rg -n "live-archive" scripts src/test .gstack`
- Verify: `.gstack/qa-reports/desktop-visual-convergence/renderer/<viewport>/live-archive.png`
- Generate: `release/Trader-Atlas-1.4.1-win-x64.exe`

**Interfaces:**
- Consumes: Tasks 1–3 的最终数据投影、页面和路由。
- Produces: Windows/macOS 桌面视觉证据、全量质量门禁和最新 Windows x64 安装包。

- [ ] **Step 1: Update visual scenarios to the canonical route**

Run: `rg -n "live-archive|历史记录" scripts src/test .gstack`

将视觉场景的访问路由改为 `/live-history`，保留稳定场景 ID `live-archive` 以避免无意义重命名已有基线；新增或扩展一个场景使用 `/live-history?view=cases`，fixture 至少包含重点、错题、错过机会、待复看和已掌握案例。

- [ ] **Step 2: Run the complete automated suite**

Run: `pnpm typecheck`

Expected: PASS。

Run: `pnpm test`

Expected: PASS，无 skip/todo。

Run: `pnpm build`

Expected: PASS，包体预算通过。

Run: `pnpm qa:design`

Expected: PASS。

- [ ] **Step 3: Regenerate the desktop renderer matrix**

Run: `pnpm qa:desktop-visual --renderer`

Expected: 全部场景 × 960、1100、1280、1440、1920 五档桌面视口完成；0 overflow、0 console errors、0 page errors。

- [ ] **Step 4: Inspect representative historical-live screenshots**

人工检查 960×640、1440×900、1920×1080 下的实盘记录与关联案例页面。确认视图切换和六类案例筛选清晰可见、摘要不因案例视图改变、长编号无横向溢出、筛选面板未被裁切、交易与案例行层级和其他工作区一致。

- [ ] **Step 5: Verify source integrity and repository state**

Run: `git diff --check`

Expected: 无输出。

Run: `git status --short`

Expected: 仅存在本计划明确产生且尚待最终提交的文件；不存在无关改动。

- [ ] **Step 6: Build the Windows installer**

Run: `pnpm dist:win`

Expected: 成功生成 `release/Trader-Atlas-1.4.1-win-x64.exe`，构建退出码为 0。

- [ ] **Step 7: Record installer integrity**

Run:

```powershell
$exe = Get-Item -LiteralPath 'release\Trader-Atlas-1.4.1-win-x64.exe'
$hash = Get-FileHash -LiteralPath $exe.FullName -Algorithm SHA256
[pscustomobject]@{
  Path = $exe.FullName
  SizeMB = [math]::Round($exe.Length / 1MB, 2)
  SHA256 = $hash.Hash
} | Format-List
```

Expected: 输出安装包绝对路径、文件大小和 SHA-256；文件存在且大小大于 0。

- [ ] **Step 8: Commit scenario and documentation changes**

```powershell
git add -- scripts src/test .gstack docs/superpowers/specs/2026-08-16-historical-live-module-design.md docs/superpowers/plans/2026-08-16-historical-live-module.md
git commit -m "test: verify historical live module"
```
