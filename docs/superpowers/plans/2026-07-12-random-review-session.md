# 随机复盘会话（A+B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地独立路由「随机复盘」：默认从案例+交易日志建池洗牌，抽卡（A）为主、沉浸阅读（B）为深读，会话只读并可跳转现有详情编辑。

**Architecture:** 纯函数 `reviewSession.ts` 负责建池/筛选/洗牌/标题与抽图；`ReviewSessionView` 用本地 state（+可选 sessionStorage）持有队列与模式；A/B 两个展示组件共用同一 cursor。导航仅扩展 `PRIMARY_NAV` 与详情返回白名单，不新增 Zustand 实体。

**Tech Stack:** React 18、TypeScript、React Router 6、现有 Zustand store（只读 trades）、现有 `resolveNoteForDisplay` / `ImageLightbox` / `fmtR`、Node 回归测试（`src/regression.test.ts`）。

**Spec:** `docs/superpowers/specs/2026-07-12-random-review-session-design.md`

---

## Global Constraints

- UTF-8 无 BOM；保留中文。
- 不新增 npm 依赖。
- 不进回收站（`deletedAt` 有值的排除）。
- 会话内只读；编辑只通过 `tradeDetailPath` + `tradeDetailNavState({ pathname: '/review-session' })`。
- 盈亏主展示用 `fmtR(trade.rMultiple)`（与列表一致）；金额可用 `fmtMoney` 作次要信息。
- 图标用现有 `RotateCcw`（表示洗牌/再来一轮），不新增 SVG。
- 每个 Task 结束后跑该 Task 标明的验证，再 commit；禁止无关重构。

## File Responsibility Map

| File | Responsibility |
|---|---|
| `src/lib/reviewSession.ts` | 筛选选项类型、建池、Fisher–Yates、标题、空笔记判定、从 HTML 抽 img src |
| `src/lib/sidebarNav.ts` | `PRIMARY_NAV` 增加 `reviewSession` |
| `src/lib/sidebarWorkspace.ts` | `primaryIdForPath` 识别 `/review-session` |
| `src/lib/tradeRoute.ts` | 详情返回允许 `/review-session` |
| `src/App.tsx` | 注册 `/review-session` 路由 |
| `src/views/ReviewSessionView.tsx` | 开始面板 / A / B / 结束态编排 |
| `src/views/ReviewSessionView.css` | 模块样式（对齐 demo A/B 暗色） |
| `src/components/reviewSession/ReviewSessionStart.tsx` | 开始筛选 UI |
| `src/components/reviewSession/ReviewFlashcard.tsx` | 模式 A |
| `src/components/reviewSession/ReviewImmersive.tsx` | 模式 B |
| `src/components/CommandPalette.tsx` | 导航项「随机复盘」 |
| `src/components/MobileNavigation.tsx` | `MOBILE_LABELS.reviewSession` |
| `src/regression.test.ts` | 建池/洗牌/抽图/详情返回白名单回归 |
| `docs/superpowers/specs/2026-07-12-random-review-session-design.md` | 状态改为已批准 |

---

### Task 1: 纯函数建池与洗牌（TDD）

**Files:**
- Create: `src/lib/reviewSession.ts`
- Modify: `src/regression.test.ts`
- Modify: `docs/superpowers/specs/2026-07-12-random-review-session-design.md`（状态行改为「已批准」）

**Consumes:** `Trade`、`isAccountTrade`、`isReviewCaseTrade`、案例 scope 规则（与 `workbenchTrades.ts` 对齐）。

**Produces:** 可单测的建池 API。

- [ ] **Step 1: 在 `src/regression.test.ts` 增加失败测试并导出**

```ts
import {
  buildReviewSessionPool,
  extractNoteImageSrcs,
  hasReviewNoteContent,
  reviewSessionCardTitle,
  shuffleIds,
  type ReviewSessionFilters,
} from '@/lib/reviewSession'
import type { Trade } from '@/data/trades'

function miniTrade(partial: Partial<Trade> & Pick<Trade, 'id' | 'ref' | 'tradeKind'>): Trade {
  return {
    symbol: 'ES',
    side: 'Long',
    status: 'closed',
    pnl: 0,
    rMultiple: 1,
    openedAt: '2026-07-01T00:00:00.000Z',
    strategyId: 's1',
    tags: [],
    mistakeTags: [],
    note: '',
    conviction: 'medium',
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    ...partial,
  } as Trade
}

export function testReviewSessionPoolDefaultsIncludeCasesAndTrades(): void {
  const trades = [
    miniTrade({ id: '1', ref: 'CAS-1', tradeKind: 'case', note: '<p>a</p>' }),
    miniTrade({ id: '2', ref: 'TRD-1', tradeKind: 'live' }),
    miniTrade({ id: '3', ref: 'TRD-2', tradeKind: 'paper' }),
    miniTrade({ id: '4', ref: 'TRD-x', tradeKind: 'live', deletedAt: '2026-07-01T00:00:00.000Z' }),
  ]
  const filters: ReviewSessionFilters = {
    includeCases: true,
    includeTrades: true,
    caseScope: 'all',
    requireNote: false,
  }
  const pool = buildReviewSessionPool(trades, filters)
  assert(pool.length === 3, 'default pool excludes trash only')
  assert(pool.every((t) => !t.deletedAt), 'no deleted trades')
}

export function testReviewSessionPoolCanDisableKindsAndScopeMistakes(): void {
  const trades = [
    miniTrade({ id: '1', ref: 'CAS-1', tradeKind: 'case', reviewCategory: 'mistake' }),
    miniTrade({ id: '2', ref: 'CAS-2', tradeKind: 'case', reviewCategory: 'focus' }),
    miniTrade({ id: '3', ref: 'TRD-1', tradeKind: 'live' }),
  ]
  const onlyMistakes = buildReviewSessionPool(trades, {
    includeCases: true,
    includeTrades: false,
    caseScope: 'mistakes',
    requireNote: false,
  })
  assert(onlyMistakes.map((t) => t.id).join(',') === '1', 'mistakes scope only')

  const tradesOnly = buildReviewSessionPool(trades, {
    includeCases: false,
    includeTrades: true,
    caseScope: 'all',
    requireNote: false,
  })
  assert(tradesOnly.map((t) => t.id).join(',') === '3', 'trades only')
}

export function testReviewSessionShufflePreservesMembership(): void {
  const ids = ['a', 'b', 'c', 'd', 'e']
  const out = shuffleIds(ids)
  assert(out.length === 5, 'same length')
  assert([...out].sort().join(',') === 'a,b,c,d,e', 'same membership')
}

export function testReviewSessionNoteHelpers(): void {
  assert(!hasReviewNoteContent(''), 'empty string')
  assert(!hasReviewNoteContent('<p></p>'), 'empty p')
  assert(hasReviewNoteContent('<p>hi</p>'), 'has text')
  assert(
    extractNoteImageSrcs('<p>x</p><img src="blob:1"><img src="journal-asset://abc">').length === 2,
    'extract imgs',
  )
  assert(
    reviewSessionCardTitle(miniTrade({ id: '1', ref: 'CAS-1', tradeKind: 'case', symbol: 'NQ', note: '<p>开盘假突破</p>' }), '突破') ===
      '开盘假突破' ||
      reviewSessionCardTitle(
        miniTrade({ id: '1', ref: 'CAS-1', tradeKind: 'case', symbol: 'NQ', note: '' }),
        '突破',
      ) === 'NQ · 突破',
    'title falls back to symbol · strategy',
  )
}
```

在测试 runner 注册处挂上上述四个 export（与文件内现有 `test…` 注册方式一致；若为自动发现 `export function test*`，则无需改注册表）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`

Expected: FAIL — `@/lib/reviewSession` 无法解析或函数未定义。

- [ ] **Step 3: 实现 `src/lib/reviewSession.ts`**

```ts
import type { Trade } from '@/data/trades'
import type { ReviewCaseScope } from '@/lib/tradeFilters'
import { isAccountTrade, isReviewCaseTrade } from '@/lib/tradeKind'

export type ReviewSessionFilters = {
  includeCases: boolean
  includeTrades: boolean
  /** 仅当 includeCases 时作用于案例子集 */
  caseScope: ReviewCaseScope
  requireNote: boolean
}

export const DEFAULT_REVIEW_SESSION_FILTERS: ReviewSessionFilters = {
  includeCases: true,
  includeTrades: true,
  caseScope: 'all',
  requireNote: false,
}

function matchesCaseScope(trade: Trade, scope: ReviewCaseScope): boolean {
  if (scope === 'all') return true
  if (scope === 'focus') {
    return trade.reviewCategory === 'focus' || trade.reviewStatus === 'focus'
  }
  if (scope === 'mistakes') {
    return (
      trade.reviewCategory === 'mistake' ||
      trade.reviewCategory === 'ambiguous' ||
      trade.status === 'missed' ||
      trade.mistakeTags.length > 0
    )
  }
  if (scope === 'unreviewed') {
    return trade.reviewCategory === 'recheck' || trade.reviewStatus === 'unreviewed'
  }
  if (scope === 'reviewed') {
    return trade.reviewCategory === 'mastered' || trade.reviewStatus === 'reviewed'
  }
  return true
}

export function hasReviewNoteContent(note: string | undefined): boolean {
  if (!note) return false
  const text = note.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
  return text.length > 0
}

export function buildReviewSessionPool(trades: Trade[], filters: ReviewSessionFilters): Trade[] {
  const active = trades.filter((t) => !t.deletedAt)
  const out: Trade[] = []
  for (const trade of active) {
    let ok = false
    if (filters.includeCases && isReviewCaseTrade(trade) && matchesCaseScope(trade, filters.caseScope)) {
      ok = true
    }
    if (filters.includeTrades && isAccountTrade(trade)) {
      ok = true
    }
    if (!ok) continue
    if (filters.requireNote && !hasReviewNoteContent(trade.note)) continue
    out.push(trade)
  }
  return out
}

/** Fisher–Yates；不修改入参 */
export function shuffleIds<T>(items: T[]): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function reviewSessionCardTitle(trade: Trade, strategyName: string): string {
  if (hasReviewNoteContent(trade.note)) {
    const text = trade.note.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const first = text.slice(0, 48)
    if (first) return first
  }
  return `${trade.symbol} · ${strategyName || '未命名策略'}`
}

export function extractNoteImageSrcs(html: string): string[] {
  const out: string[] = []
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[1]) out.push(m[1])
  }
  return out
}

export type ReviewSessionMode = 'flashcard' | 'immersive'

export type ReviewSessionState = {
  filters: ReviewSessionFilters
  queueIds: string[]
  cursor: number
  mode: ReviewSessionMode
  flipped: boolean
}
```

修正 Step 1 里 `reviewSessionCardTitle` 断言为更清晰的两条 `assert`：

```ts
assert(
  reviewSessionCardTitle(
    miniTrade({ id: '1', ref: 'CAS-1', tradeKind: 'case', symbol: 'NQ', note: '<p>开盘假突破</p>' }),
    '突破',
  ).includes('开盘假突破'),
  'title from note text',
)
assert(
  reviewSessionCardTitle(
    miniTrade({ id: '1', ref: 'CAS-1', tradeKind: 'case', symbol: 'NQ', note: '' }),
    '突破',
  ) === 'NQ · 突破',
  'title fallback',
)
```

- [ ] **Step 4: 再跑测试**

Run: `pnpm test`

Expected: PASS（含新建四项）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/reviewSession.ts src/regression.test.ts docs/superpowers/specs/2026-07-12-random-review-session-design.md
git commit -m "feat(review-session): add pool builders and shuffle helpers"
```

---

### Task 2: 导航、路由与详情返回白名单

**Files:**
- Modify: `src/lib/sidebarNav.ts`
- Modify: `src/lib/sidebarWorkspace.ts`（`primaryIdForPath`）
- Modify: `src/lib/tradeRoute.ts`（`isValidDetailSource`）
- Modify: `src/App.tsx`
- Modify: `src/components/MobileNavigation.tsx`
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/regression.test.ts`

- [ ] **Step 1: 增加详情返回白名单测试**

```ts
import { resolveTradeDetailReturn } from '@/lib/tradeRoute'

export function testReviewSessionIsValidDetailReturnSource(): void {
  const back = resolveTradeDetailReturn({
    from: { pathname: '/review-session', search: '' },
    tradeKind: 'case',
  })
  assert(back.pathname === '/review-session', 'case can return to review-session')

  const backLive = resolveTradeDetailReturn({
    from: { pathname: '/review-session', search: '' },
    tradeKind: 'live',
  })
  assert(backLive.pathname === '/review-session', 'live can return to review-session')
}
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm exec node --import tsx -e "import { testReviewSessionIsValidDetailReturnSource } from './src/regression.test.ts'; testReviewSessionIsValidDetailReturnSource()"`  
（或 `pnpm test`）

Expected: FAIL — `/review-session` 被拒，回退到 `/review-cases` 或 `/list`。

- [ ] **Step 3: 改 `tradeRoute.ts`**

在 `isValidDetailSource` 开头加入：

```ts
if (pathname === '/review-session') return true
```

- [ ] **Step 4: 改导航**

`sidebarNav.ts`：

```ts
export type PrimarySidebarNavId =
  | 'today'
  | 'trades'
  | 'reviewCases'
  | 'reviewSession'
  | 'dashboard'

// PRIMARY_NAV 在 reviewCases 与 dashboard 之间插入：
{
  id: 'reviewSession',
  to: '/review-session',
  label: '随机复盘',
  icon: RotateCcw, // 从 appIcons 导入
},
```

`sidebarWorkspace.ts` 的 `primaryIdForPath`：

```ts
if (path === '/review-session') return 'reviewSession'
```

`MobileNavigation.tsx`：

```ts
reviewSession: '复盘',
```

`CommandPalette.tsx` 在案例记录旁增加：

```ts
{
  id: 'n-review-session',
  group: '导航',
  icon: <RotateCcw size={16} />,
  label: '随机复盘',
  hint: '抽卡过往交易与案例',
  run: go('/review-session'),
},
```

`App.tsx`：懒引入或静态引入 `ReviewSessionView`，在 Routes 内加：

```tsx
<Route path="/review-session" element={<ReviewSessionView />} />
```

先放占位组件（下一步 Task 填满）：

```tsx
// src/views/ReviewSessionView.tsx
export function ReviewSessionView() {
  return <div className="review-session">随机复盘（建设中）</div>
}
```

- [ ] **Step 5: 跑测 + 手工点侧栏能进路由**

Run: `pnpm test`  
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/lib/sidebarNav.ts src/lib/sidebarWorkspace.ts src/lib/tradeRoute.ts src/App.tsx src/components/MobileNavigation.tsx src/components/CommandPalette.tsx src/views/ReviewSessionView.tsx src/regression.test.ts
git commit -m "feat(review-session): wire nav route and detail return"
```

---

### Task 3: 开始面板 + 会话状态编排

**Files:**
- Create: `src/components/reviewSession/ReviewSessionStart.tsx`
- Modify: `src/views/ReviewSessionView.tsx`
- Create: `src/views/ReviewSessionView.css`

- [ ] **Step 1: 实现 `ReviewSessionStart`**

Props：

```ts
type Props = {
  filters: ReviewSessionFilters
  poolSize: number
  onChange: (next: ReviewSessionFilters) => void
  onStart: () => void
}
```

UI：

- 勾选「案例记录」「交易日志」（默认皆 true）
- 案例 scope：`全部 | 错题 | 重点 | 待复看 | 已掌握`（`includeCases === false` 时禁用）
- 勾选「仅含有笔记的条目」（默认 false）
- 文案：`将开始 N 笔`；`N===0` 时禁用开始按钮并提示放宽筛选

- [ ] **Step 2: 实现 `ReviewSessionView` 状态机**

```ts
const trades = useStore((s) => s.trades)
const strategies = useStore((s) => s.strategies)
const [filters, setFilters] = useState(DEFAULT_REVIEW_SESSION_FILTERS)
const [session, setSession] = useState<ReviewSessionState | null>(null)

const pool = useMemo(() => buildReviewSessionPool(trades, filters), [trades, filters])

function start() {
  const ids = shuffleIds(pool.map((t) => t.id))
  if (ids.length === 0) return
  setSession({
    filters,
    queueIds: ids,
    cursor: 0,
    mode: 'flashcard',
    flipped: false,
  })
}

const current = session
  ? trades.find((t) => t.id === session.queueIds[session.cursor])
  : undefined
```

无 `session` → 渲染 `ReviewSessionStart`。  
有 `session` 但 `current` 缺失（被删）→ 自动 `cursor++` 或结束。  
有 `session` → 暂时渲染占位：`{current?.ref} mode={session.mode}`（Task 4/5 替换）。

顶栏：进度 `cursor+1 / queueIds.length`、按钮「结束本轮」（`setSession(null)`）、「再洗一轮」。

可选 sessionStorage（同 Task 内完成）：

```ts
const STORAGE_KEY = 'atlas.reviewSession.v1'
// start / next / mode 变更时写入 { queueIds, cursor, mode, filters }
// mount 时若有且 ids 仍在 trades 中则恢复
```

- [ ] **Step 3: 挂 CSS 骨架**（全高、暗底、居中内容区）

- [ ] **Step 4: 手工验证**

- 打开 `/review-session`，默认 N = 案例+交易（无 trash）
- 关掉案例，N 下降；scope=错题时仅案例子集变化
- 点开始进入占位会话；结束回到开始面板

- [ ] **Step 5: Commit**

```bash
git add src/views/ReviewSessionView.tsx src/views/ReviewSessionView.css src/components/reviewSession/ReviewSessionStart.tsx
git commit -m "feat(review-session): add start panel and session state"
```

---

### Task 4: 模式 A 抽卡

**Files:**
- Create: `src/components/reviewSession/ReviewFlashcard.tsx`
- Modify: `src/views/ReviewSessionView.tsx`
- Modify: `src/views/ReviewSessionView.css`

- [ ] **Step 1: 实现 `ReviewFlashcard`**

Props：

```ts
{
  trade: Trade
  strategyName: string
  title: string
  flipped: boolean
  onToggleFlip: () => void
  onNext: () => void
  onDeepRead: () => void
  resolvedNoteHtml: string // 父组件 resolveNoteForDisplay 后传入；未翻转可不请求
}
```

正面：种类徽章（案例/交易）、`reviewCategory` 徽章、大号 symbol、title、side、strategyName、`fmtDate(openedAt|recordedAt)`、`fmtR(rMultiple)`、提示「先回忆，再翻转」。

背面：首图（`extractNoteImageSrcs(resolvedNoteHtml)[0]`）或占位；`dangerouslySetInnerHTML` 渲染笔记（容器 `max-height` + overflow）；空笔记文案「暂无复盘笔记」。

按钮：「翻转」/「再看正面」、「深读」、「下一张」。

键位（在卡片挂载的 `useEffect`）：

- Space → `onToggleFlip`（`preventDefault`）
- N / ArrowRight → `onNext`

- [ ] **Step 2: 父组件接入**

`mode === 'flashcard'` 时渲染 Flashcard；`onDeepRead` → `setSession(s => s && ({ ...s, mode: 'immersive', flipped: false }))`；`onNext` 递增 cursor，若越界进入结束态；新卡 `flipped: false`。

父组件对当前 trade：

```ts
useEffect(() => {
  let cancelled = false
  if (!current) return
  void resolveNoteForDisplay(current.note, getStorage()).then((html) => {
    if (!cancelled) setResolvedNote(html)
  })
  return () => { cancelled = true }
}, [current?.id, current?.note])
```

- [ ] **Step 3: 样式** — 参考 demo A（圆角卡、轻翻转可用 CSS `rotateY`，也可用简单显隐；优先 CSS 3D，失败则双面切换）。

- [ ] **Step 4: 手工验证**

- Space 翻转；N 下一张且重置正面
- 背面能看到笔记；无笔记显示空态
- 「深读」切到 immersive 占位（若 B 未完成则先显示简单全屏笔记）

- [ ] **Step 5: Commit**

```bash
git add src/components/reviewSession/ReviewFlashcard.tsx src/views/ReviewSessionView.tsx src/views/ReviewSessionView.css
git commit -m "feat(review-session): add flashcard mode A"
```

---

### Task 5: 模式 B 沉浸 + Lightbox

**Files:**
- Create: `src/components/reviewSession/ReviewImmersive.tsx`
- Modify: `src/views/ReviewSessionView.tsx`
- Modify: `src/views/ReviewSessionView.css`

- [ ] **Step 1: 实现 `ReviewImmersive`**

布局：宽屏 `grid 1.1fr 0.9fr`（左图右文）；`max-width: 860px` 改为上下。

左：主图 +缩略图条（`extractNoteImageSrcs`）；点击主图/缩略图调用现有 lightbox 打开方式——查 `ImageLightbox` / `shortcutStore` 的公开 API（与 DetailView 笔记图双击一致）。若现有 API 是自定义事件或 store action，复用同一入口，禁止复制第二套 lightbox。

右：完整 `resolvedNoteHtml`、元信息、`fmtR`。

顶栏操作：`返回抽卡`（Esc 同样）、`下一张`（仍留 B）、`打开详情`：

```ts
navigate(tradeDetailPath(trade), {
  state: tradeDetailNavState({ pathname: '/review-session', search: '', anchorTradeId: trade.id }),
})
```

- [ ] **Step 2: 父组件** `mode === 'immersive'` 渲染 Immersive；Esc 在 View 层统一：B→A，A 不退出（避免误触）；「结束本轮」用顶栏按钮。

- [ ] **Step 3: 手工验证**

- A→B cursor 不变；B 下一张仍在 B
- Esc 回 A 且未翻转
- 打开详情再返回应回到 `/review-session`（依赖 Task 2 白名单）
- 多图可 Lightbox

- [ ] **Step 4: Commit**

```bash
git add src/components/reviewSession/ReviewImmersive.tsx src/views/ReviewSessionView.tsx src/views/ReviewSessionView.css
git commit -m "feat(review-session): add immersive mode B"
```

---

### Task 6: 结束态、再洗一轮、空池与回归收尾

**Files:**
- Modify: `src/views/ReviewSessionView.tsx`
- Modify: `src/regression.test.ts`（若有遗漏）
- Modify: `src/components/Sidebar.tsx`（仅当 PRIMARY_NAV 驱动不足以显示新项时——通常无需改）

- [ ] **Step 1: 结束态 UI**

当 `cursor >= queueIds.length`：

- 文案「本轮结束 · 共 N 笔」
- 按钮「再洗一轮」（用当前 `session.filters` 重新 `buildReviewSessionPool` + `shuffleIds`）
- 按钮「调整筛选」（`setSession(null)`）

- [ ] **Step 2: 确认侧栏五主项 + 命令面板 + 移动底栏标签无 TS 错误**

Run: `pnpm exec tsc --noEmit`  
Run: `pnpm test`

Expected: PASS。

- [ ] **Step 3: 对照 spec 清单手工点验**

- [ ] 默认池含案例+交易  
- [ ] 可关掉其中一类  
- [ ] A 主流程 / B 深读  
- [ ] 只读 + 详情可回会话  
- [ ] 无 trash  

- [ ] **Step 4: Commit**

```bash
git add src/views/ReviewSessionView.tsx src/regression.test.ts
git commit -m "feat(review-session): finish round controls and harden edge cases"
```

---

## Spec coverage self-check

| Spec 项 | Task |
|--------|------|
| 侧栏入口 + `/review-session` | 2 |
| 默认案例+交易池、可关、case scope、requireNote | 1, 3 |
| 洗牌队列 / 下一张 / 再洗 | 1, 3, 6 |
| 模式 A 抽卡 | 4 |
| 模式 B 沉浸 + Lightbox | 5 |
| 只读 + 打开详情返回 | 2, 5 |
| Space / N / Esc | 4, 5 |
| 排除 trash | 1 |
| sessionStorage（可选） | 3 |
| 命令面板 | 2 |
| 不做间隔重复 / 不做 C | —（故意不做） |

## Placeholder scan

无 TBD；图标已定为 `RotateCcw`；Lightbox 接入要求实现者对照 DetailView 现有 API，不另造。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-12-random-review-session.md`.

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 每个 Task 开新子代理，Task 间我复核  
2. **Inline Execution** — 本会话按 executing-plans 连续做，设检查点  

你要哪一种？
