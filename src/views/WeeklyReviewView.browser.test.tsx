import { createRoot } from 'react-dom/client'
import {
  createMemoryRouter,
  Link,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom'
import type { Trade } from '@/data/trades'
import type { RiskOverrideEvent, RiskPeriodOutcomeSnapshot } from '@/data/riskManagement'
import { createWeeklyReview, weekStartFor } from '@/data/weeklyReviews'
import { ToastHost } from '@/components/Toast'
import {
  rememberTradeReturnAnchor,
  tradeReturnLocationState,
  useTradeReturnAnchor,
} from '@/hooks/useTradeReturnAnchor'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'
import type { TradeDetailLocationState } from '@/lib/tradeRoute'
import { getStorage } from '@/storage/bootstrap'
import {
  hasNoteDraft,
  resetNoteDraftsForTests,
  setNoteDraft,
  WEEKLY_REVIEW_DRAFT_PREFIX,
} from '@/storage/noteDrafts'
import { useStore } from '@/store/useStore'
import { WeeklyReviewView } from '@/views/WeeklyReviewView'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __weeklyReviewFlowTest?: Promise<void>
    __atlasBrowserViewport?: { width: number, height: number } | null
  }
}

const activeWeekStart = weekStartFor(parseLocalDate(getTradingDayKey()))
const browserPolicyId = 'policybrowserabcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitForFrames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) await waitForFrame()
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

function clickButton(label: string, scope: ParentNode = document): HTMLButtonElement {
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.trim() === label || item.textContent?.trim().startsWith(`${label} ·`))
  assert(button, `找不到按钮：${label}`)
  button.click()
  return button
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  assert(setter, '浏览器缺少 input value setter')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function makeTrade(id: string, status: 'win' | 'loss' | 'missed', pnl: number | null): Trade {
  const weekStart = activeWeekStart
  return {
    id,
    ref: `TRD-${id}`,
    symbol: id === 'one' ? 'BTCUSDT' : 'ETHUSDT',
    side: 'long',
    status,
    conviction: 'medium',
    strategyId: 'strategy',
    tags: [],
    mistakeTags: status === 'loss' ? ['追价'] : status === 'missed' ? ['情绪化'] : [],
    reviewStatus: status === 'win' ? 'reviewed' : 'unreviewed',
    reviewCategory: status === 'loss' ? 'mistake' : 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: null,
    size: 1,
    pnl,
    cashCurrency: 'USD',
    rMultiple: null,
    resultSource: status === 'missed' ? undefined : 'pnl',
    missReason: status === 'missed' ? 'hesitation' : undefined,
    openedAt: `${weekStart}T08:00:00.000Z`,
    closedAt: `${weekStart}T09:00:00.000Z`,
    note: '',
  }
}

function riskOutcome(netBudgetR: number, limitR: number): RiskPeriodOutcomeSnapshot {
  const consumedR = Math.max(0, -netBudgetR)
  return {
    netBudgetR,
    limitR,
    consumedR,
    remainingR: Math.max(0, limitR - consumedR),
    progress: consumedR / limitR,
    coverage: 'complete',
    triggered: consumedR >= limitR,
    includedTradeCount: 2,
    excludedTradeCount: 0,
    unknownReasons: [],
  }
}

function addDays(ymd: string, days: number): string {
  const date = parseLocalDate(ymd)
  date.setDate(date.getDate() + days)
  return formatYmd(date)
}

function assertNoHorizontalOverflow(elements: HTMLElement[], message: string): void {
  for (const element of elements) {
    assert(
      element.scrollWidth <= element.clientWidth,
      `${message}：${element.className || element.tagName}（${element.scrollWidth}/${element.clientWidth}px）`,
    )
  }
}

function assertRectFitsHorizontally(
  element: HTMLElement,
  container: DOMRect,
  message: string,
): void {
  const rect = element.getBoundingClientRect()
  assert(rect.left >= container.left && rect.right <= container.right, message)
  assert(rect.left >= 0 && rect.right <= window.innerWidth, `${message}：超出视口`)
}

function assertNoOverlaps(elements: HTMLElement[], message: string): void {
  for (let left = 0; left < elements.length; left += 1) {
    const leftRect = elements[left]!.getBoundingClientRect()
    for (let right = left + 1; right < elements.length; right += 1) {
      const rightRect = elements[right]!.getBoundingClientRect()
      const overlaps = leftRect.left < rightRect.right
        && leftRect.right > rightRect.left
        && leftRect.top < rightRect.bottom
        && leftRect.bottom > rightRect.top
      assert(!overlaps, message)
    }
  }
}

function assertVerticallyAfter(previous: HTMLElement, next: HTMLElement, message: string): void {
  const previousRect = previous.getBoundingClientRect()
  const nextRect = next.getBoundingClientRect()
  assert(previousRect.bottom <= nextRect.top + 0.5, message)
}

function assertAuditTextIsVisible(element: HTMLElement, auditEvidence: HTMLElement, message: string): void {
  const style = window.getComputedStyle(element)
  assert(!['hidden', 'clip'].includes(style.overflowX), `${message}：不得裁切横向内容`)
  assert(!['hidden', 'clip'].includes(style.overflowY), `${message}：不得裁切纵向内容`)
  assert(element.scrollWidth <= element.clientWidth, `${message}：内容不得横向溢出`)
  const range = document.createRange()
  range.selectNodeContents(element)
  const elementRect = element.getBoundingClientRect()
  const parentRect = element.parentElement!.getBoundingClientRect()
  const auditRect = auditEvidence.getBoundingClientRect()
  let ancestor: HTMLElement | null = element
  while (ancestor) {
    const ancestorStyle = window.getComputedStyle(ancestor)
    assert(!['hidden', 'clip'].includes(ancestorStyle.overflowY), `${message}：祖先不得裁切纵向内容`)
    if (ancestorStyle.overflowY === 'auto') assert(ancestor.scrollHeight <= ancestor.clientHeight, `${message}：祖先不得隐藏纵向滚动内容`)
    if (ancestor === auditEvidence) break
    ancestor = ancestor.parentElement
  }
  const textRects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
  assert(textRects.length > 0, `${message}：内容必须可见`)
  for (const rect of textRects) {
    assert(rect.left >= elementRect.left && rect.right <= elementRect.right, `${message}：文本超出内容节点`)
    assert(rect.left >= parentRect.left && rect.right <= parentRect.right, `${message}：文本超出审计容器`)
    assert(rect.left >= 0 && rect.right <= window.innerWidth, `${message}：文本超出视口`)
    assert(rect.top >= elementRect.top && rect.bottom <= elementRect.bottom, `${message}：文本超出内容节点`)
    assert(rect.top >= parentRect.top && rect.bottom <= parentRect.bottom, `${message}：文本超出审计容器`)
    assert(rect.top >= auditRect.top && rect.bottom <= auditRect.bottom, `${message}：文本超出审计区`)
    assert(rect.top >= 0 && rect.bottom <= window.innerHeight, `${message}：文本超出视口`)
  }
}

function assertVisibleContentAfter(previous: HTMLElement[], next: HTMLElement[], message: string): void {
  const previousBottom = Math.max(...previous.map((element) => element.getBoundingClientRect().bottom))
  const nextTop = Math.min(...next.map((element) => element.getBoundingClientRect().top))
  assert(previousBottom <= nextTop + 0.5, message)
}

function assertDailyRiskRowKeepsKeyValuesOnOneLine(row: HTMLElement): void {
  const values = [
    row.querySelector<HTMLElement>('.wr-risk-day-date'),
    row.querySelector<HTMLElement>('strong'),
    row.querySelector<HTMLElement>('.wr-risk-day-status'),
  ]
  assert(values.every(Boolean), '每日轨迹缺少日期、R 值或状态')
  const centers = values.map((value) => {
    const rect = value!.getBoundingClientRect()
    return rect.top + rect.height / 2
  })
  assert(centers.every((center) => Math.abs(center - centers[0]!) < 1), '每日日期、R 值和状态必须保持同一行')
}

function riskEvent(): RiskOverrideEvent {
  const outcome = riskOutcome(-1, 2)
  return {
    id: 'override-1',
    tradeId: 'two',
    tradeIdentityAtDecision: { ref: 'TRD-two', symbol: 'ETHUSDT', tradeKind: 'live' },
    linkState: 'unresolved',
    decisionType: 'triggered',
    tradingDayKeyAtDecision: activeWeekStart,
    policyVersionId: browserPolicyId,
    createdAt: `${activeWeekStart}T10:00:00.000Z`,
    reason: '触线后只执行预设止损',
    fingerprint: 'browser-fixture',
    outcomesAtDecision: { day: outcome, week: outcome, month: outcome },
    unknownReasons: [],
  }
}

function resolvedRiskEvent(): RiskOverrideEvent {
  return {
    ...riskEvent(),
    id: 'override-resolved',
    tradeId: 'one',
    tradeIdentityAtDecision: { ref: 'TRD-one', symbol: 'BTCUSDT', tradeKind: 'live' },
    linkState: 'resolved',
    reason: '盈利后仍按计划执行',
  }
}

function StoreRenderSentinel() {
  const trades = useStore((state) => state.trades)
  return <output data-testid="store-render-sentinel">{trades.length}:{trades.filter((trade) => trade.deletedAt).length}</output>
}

function weekRangeText(start: string): string {
  const end = addDays(start, 6)
  const left = parseLocalDate(start)
  const right = parseLocalDate(end)
  return left.getMonth() === right.getMonth()
    ? `${left.getMonth() + 1}月${left.getDate()}日 – ${right.getDate()}日`
    : `${left.getMonth() + 1}月${left.getDate()}日 – ${right.getMonth() + 1}月${right.getDate()}日`
}

function installCurrentDate(initialNow: number): {
  set: (nextNow: number) => void
  restore: () => void
} {
  const NativeDate = globalThis.Date
  let currentNow = initialNow
  const ShiftedDate = new Proxy(NativeDate, {
    construct(target, argumentsList) {
      return argumentsList.length > 0
        ? Reflect.construct(target, argumentsList)
        : new target(currentNow)
    },
    get(target, property, receiver) {
      if (property === 'now') return () => currentNow
      return Reflect.get(target, property, receiver)
    },
  })
  globalThis.Date = ShiftedDate as DateConstructor
  return {
    set: (nextNow) => {
      currentNow = nextNow
    },
    restore: () => {
      globalThis.Date = NativeDate
    },
  }
}

function clickLink(label: string): HTMLAnchorElement {
  const link = [...document.querySelectorAll<HTMLAnchorElement>('a')]
    .find((item) => item.textContent?.trim() === label)
  assert(link, `找不到链接：${label}`)
  link.click()
  return link
}

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

function DetailFixture() {
  const location = useLocation()
  const navigate = useNavigate()
  const from = (location.state as TradeDetailLocationState | null)?.from
  return (
    <div data-testid="weekly-detail" data-source-anchor={from?.anchorTradeId ?? ''}>
      交易详情
      <Link
        to={{
          pathname: from?.pathname ?? '/list',
          search: from?.restoreSearch ?? from?.search ?? '',
        }}
        state={tradeReturnLocationState(from)}
      >
        返回复盘
      </Link>
      <button type="button" onClick={() => navigate(-1)}>浏览器返回</button>
    </div>
  )
}

const focusedRestoreStarts: string[] = []
const focusedRestoreMissing: string[] = []

function ReturnAnchorRaceFixture() {
  const navigate = useNavigate()
  useTradeReturnAnchor({
    onRestoreStart: (anchorId) => focusedRestoreStarts.push(anchorId),
    onMissing: (anchorId) => focusedRestoreMissing.push(anchorId),
  })
  return (
    <main>
      <button
        type="button"
        onClick={() => navigate(
          { pathname: '/weekly-anchor-race', search: '?view=review' },
          { replace: true, state: { restoreTradeId: 'weekly-trade:race-b' } },
        )}
      >
        替换恢复锚点
      </button>
      <article data-trade-id="weekly-trade:race-b">
        <button type="button" data-trade-primary-action>恢复目标 B</button>
      </article>
    </main>
  )
}

function HiddenReturnAnchorFixture() {
  useTradeReturnAnchor({
    onRestoreStart: (anchorId) => focusedRestoreStarts.push(anchorId),
    onMissing: (anchorId) => focusedRestoreMissing.push(anchorId),
  })
  return (
    <main>
      <details>
        <summary>隐藏恢复目标</summary>
        <article data-trade-id="weekly-risk:hidden-event">
          <button type="button" data-trade-primary-action>隐藏主操作</button>
        </article>
      </details>
    </main>
  )
}

function BoardCardReturnAnchorFixture() {
  useTradeReturnAnchor({
    onRestoreStart: (anchorId) => focusedRestoreStarts.push(anchorId),
    onMissing: (anchorId) => focusedRestoreMissing.push(anchorId),
  })
  return (
    <main>
      <div style={{ height: '1200px' }} aria-hidden />
      <article
        data-trade-id="board-card:return-target"
        role="button"
        tabIndex={0}
        style={{ height: '120px' }}
      >
        看板返回卡片
      </article>
      <div style={{ height: '1200px' }} aria-hidden />
    </main>
  )
}

function ReturnAnchorNavigationFixture() {
  const location = useLocation()
  const navigate = useNavigate()
  useTradeReturnAnchor({
    onRestoreStart: (anchorId) => focusedRestoreStarts.push(anchorId),
    onMissing: (anchorId) => focusedRestoreMissing.push(anchorId),
  })
  const detailFrom = {
    pathname: '/return-anchor-navigation',
    search: '?view=review',
    anchorTradeId: 'weekly-trade:race-b',
  }
  return (
    <main>
      <output data-testid="return-state-probe">
        {(location.state as { restoreTradeId?: string } | null)?.restoreTradeId ?? ''}
      </output>
      <button
        type="button"
        onClick={() => {
          rememberTradeReturnAnchor(detailFrom)
          navigate('/return-anchor-detail')
        }}
      >
        打开详情 B
      </button>
      <article data-trade-id="weekly-trade:race-b">
        <button type="button" data-trade-primary-action>恢复目标 B</button>
      </article>
    </main>
  )
}

function ReturnAnchorNavigationDetailFixture() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(-1)}>浏览器返回 B</button>
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  const storage = getStorage()
  const originalSaveAsset = storage.saveAsset
  let currentDateControl: ReturnType<typeof installCurrentDate> | null = null
  const pageErrors: string[] = []
  const capturePageError = (event: ErrorEvent) => pageErrors.push(event.error?.message ?? event.message)
  window.addEventListener('error', capturePageError)
  try {
    useStore.setState({
      trades: [makeTrade('one', 'win', 150), makeTrade('two', 'loss', -50), makeTrade('three', 'missed', null)],
      weeklyReviews: [],
      riskPolicyVersions: [{
        id: browserPolicyId,
        sourceWeekStart: activeWeekStart,
        effectiveTradingDay: activeWeekStart,
        capitalBase: 10_000,
        riskPercent: 1,
        riskAmount: 100,
        dailyLossLimitR: 2,
        weeklyLossLimitR: 5,
        monthlyLossLimitRDefault: 10,
        disciplineText: '浏览器冻结规则',
        confirmedAt: `${activeWeekStart}T07:00:00.000Z`,
      }],
      monthlyRiskLimits: [{
        id: `monthly-risk-limit:${activeWeekStart.slice(0, 7)}`,
        monthKey: activeWeekStart.slice(0, 7),
        limitR: 10,
        sourcePolicyVersionId: browserPolicyId,
        lockedAt: `${activeWeekStart}T07:00:00.000Z`,
      }],
      riskOverrideEvents: [riskEvent(), resolvedRiskEvent()],
    })
    root.render(
      <MemoryRouter initialEntries={['/weekly-review']}>
        <Routes>
          <Route path="/weekly-review" element={<><WeeklyReviewView /><StoreRenderSentinel /><RouteProbe /></>} />
          <Route path="/trade/:id" element={<DetailFixture />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => document.body.textContent?.includes('+$100') ?? false, '自动周指标未按平仓交易计算')
    assert(document.body.textContent?.includes('50%'), '胜率指标未出现')
    assert(document.body.textContent?.includes('错过机会 1'), '错过机会没有作为独立执行缺口显示')
    assert(document.body.textContent?.includes('犹豫未进'), '执行缺口没有显示原因分布')
    assert(document.body.textContent?.includes('不计入平仓、胜率、盈亏与平均 R'), '执行缺口缺少与绩效指标的边界说明')
    assert(document.querySelectorAll('.wr-trade-row').length === 3, '关键证据应同时保留已执行交易与错过机会')
    const missedRow = [...document.querySelectorAll<HTMLElement>('.wr-trade-row')]
      .find((row) => row.textContent?.includes('错过 · 犹豫未进'))
    assert(missedRow && !missedRow.textContent?.includes('$'), '错过机会不得展示为真实盈亏')
    assert(missedRow.querySelectorAll('button').length === 0, '错过机会不应显示不可用的交易角色按钮')
    assert(document.querySelectorAll('.wr-history button').length === 0, '首次复盘不应显示没有历史价值的周次栏')
    assert(document.body.textContent?.includes('首次周复盘'), '首次复盘缺少明确的首次使用提示')
    if (new URLSearchParams(location.search).has('visual')) {
      await new Promise<void>(() => {})
    }

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
    await waitFor(
      () => document.querySelector('[data-testid="weekly-route-probe"]')
        ?.getAttribute('data-search') === '',
      '当前周恢复成功后没有压缩为规范地址',
    )
    await waitForFrame()

    document.querySelector<HTMLAnchorElement>(
      '[data-trade-id="weekly-trade:one"] [data-trade-primary-action]',
    )?.click()
    await waitFor(() => document.querySelector('[data-testid="weekly-detail"]') !== null, '第二次未进入普通证据详情')
    clickButton('浏览器返回')
    await waitFor(
      () => document.activeElement?.closest('[data-trade-id="weekly-trade:one"]') !== null,
      '浏览器返回没有读取 sessionStorage 并恢复普通证据焦点',
    )

    const priorActivityWeek = addDays(activeWeekStart, -7)
    const priorActivityTrade = {
      ...makeTrade('prior-activity', 'loss', -50),
      openedAt: priorActivityWeek,
      closedAt: priorActivityWeek,
      closedTradingDayKey: priorActivityWeek,
    }
    useStore.setState((state) => ({ trades: [...state.trades, priorActivityTrade] }))
    await waitFor(() => document.querySelectorAll('.wr-history button').length === 2, '活动周没有进入复盘历史')
    const pendingWeek = document.querySelector<HTMLButtonElement>(`[data-review-week="${priorActivityWeek}"]`)
    assert(pendingWeek, '有活动但未建档的周必须进入复盘历史')
    assert(pendingWeek.textContent?.includes('待补做'), '有活动但未建档的周必须显示待补做')
    pendingWeek.click()
    await waitFor(() => pendingWeek.classList.contains('is-active'), '待补做周无法切换')
    assert(useStore.getState().weeklyReviews.length === 0, '只查看待补做周不得创建空复盘')
    clickButton('3')
    await waitFor(
      () => useStore.getState().weeklyReviews.some((review) => review.weekStart === priorActivityWeek),
      '首次编辑后没有创建待补做周复盘',
    )
    document.querySelector<HTMLButtonElement>('[aria-label="下一条复盘"]')?.click()
    await waitFor(
      () => document.querySelector(`[data-review-week="${activeWeekStart}"].is-active`) !== null,
      '下一条复盘没有沿活动周序列返回本周',
    )
    useStore.setState((state) => ({
      trades: state.trades.filter((trade) => trade.id !== priorActivityTrade.id),
      weeklyReviews: [],
    }))
    await waitFor(() => document.querySelectorAll('.wr-history button').length === 0, '清除活动历史后首次复盘状态没有恢复')

    clickButton('完成本周复盘')
    await waitFor(() => Boolean(document.querySelector('.wr-issue-summary')), '缺少必填项时没有显示持久错误摘要')
    assert(document.querySelector('[data-weekly-section="scores"]')?.getAttribute('data-invalid') === 'true', '评分区没有标记错误状态')
    assert(document.querySelector('[data-weekly-section="commitment"]')?.getAttribute('data-invalid') === 'true', '承诺区没有标记错误状态')
    assert(document.activeElement?.closest('[data-weekly-field="score-execution"]'), '完成失败后焦点没有落到第一项评分')
    assert(useStore.getState().weeklyReviews.every((item) => item.status !== 'completed'), '缺少必填项时不得完成复盘')
    assert(!document.querySelector('.toast'), '完成失败不得使用瞬时 Toast 代替持久错误摘要')

    for (const group of document.querySelectorAll<HTMLElement>('.wr-score-row [role="radiogroup"]')) {
      const score = [...group.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '4')
      score?.click()
    }
    clickButton('追价')
    const firstTrade = document.querySelector('.wr-trade-row')
    assert(firstTrade, '关键交易证据未渲染')
    clickButton('做得好', firstTrade)

    const inputs = document.querySelectorAll<HTMLInputElement>('.wr-commitment input')
    assert(inputs.length === 2, '行动承诺与验收标准输入框不完整')
    setInputValue(inputs[0], '等待确认后再入场')
    setInputValue(inputs[1], '每笔入场截图都有确认信号')
    await waitFor(() => useStore.getState().weeklyReviews[0]?.commitmentText === '等待确认后再入场', '行动承诺未写入独立周复盘实体')
    await waitFor(() => !document.querySelector('.wr-issue-summary'), '字段有效后错误摘要没有自动清除')
    inputs[1]?.scrollIntoView({ block: 'center' })
    await waitForFrame()
    if (window.innerWidth === 960) {
      const actionRail = document.querySelector<HTMLElement>('.wr-footer-action')
      assert(actionRail, '周复盘缺少底部操作栏')
      const actionRect = actionRail.getBoundingClientRect()
      assert(actionRect.top >= 0 && actionRect.bottom <= window.innerHeight, '960×640 下底部操作栏没有保持可见')
    }

    clickButton('完成本周复盘')
    await waitFor(() => useStore.getState().weeklyReviews[0]?.status === 'completed', '周复盘未完成')
    const completed = useStore.getState().weeklyReviews[0]
    assert(completed?.metricsSnapshot?.totalPnl === 100, '完成时没有冻结周指标快照')
    assert(completed?.metricsSnapshot?.tradeCount === 2, '错过机会被错误计入平仓交易数量')
    assert(completed?.metricsSnapshot?.missedCount === 1, '完成时没有冻结执行缺口数量')
    assert(completed?.metricsSnapshot?.mistakeTagCounts['情绪化'] === undefined, '错过机会标签污染了已执行交易错误统计')
    assert(completed.completedAt === completed.riskSnapshot?.frozenAt, '完成与风险冻结必须使用同一时间戳')
    assert(document.body.textContent?.includes('浏览器冻结规则'), '已完成复盘没有展示冻结规则')
    const risk = document.querySelector<HTMLElement>('.wr-risk-evidence')
    assert(risk, '已完成复盘没有展示冻结风控证据')
    const text = risk.textContent ?? ''
    const weekly = text.indexOf('本周风险状态')
    const monthly = text.indexOf('完成时月度状态')
    const daily = text.indexOf('每日风险轨迹')
    const audit = text.indexOf('冻结审计')
    assert([weekly, monthly, daily, audit].every((index) => index >= 0), '冻结风控证据缺少信息层级标题')
    assert(weekly < monthly && monthly < daily && daily < audit, '本周→月度→每日→审计顺序错误')
    assert(document.querySelectorAll('.wr-risk-day').length === completed.riskSnapshot?.dailyOutcomes.length, '每日轨迹数量错误')
    const progressbars = [...risk.querySelectorAll<HTMLElement>('[role="progressbar"]')]
    assert(progressbars.length === 2, '风控决策必须有两个周期进度条')
    for (const [progressbar, expected] of [
      [progressbars[0]!, ['本周风险状态', '未触线', '0.0R 已使用 / +5.0R 限制']],
      [progressbars[1]!, ['完成时月度状态', '未触线', '0.0R 已使用 / +10.0R 限制']],
    ] as const) {
      const accessibleName = progressbar.getAttribute('aria-label') ?? ''
      assert(expected.every((part) => accessibleName.includes(part)), `进度条可访问名称不完整：${accessibleName}`)
    }
    const audits = [...document.querySelectorAll<HTMLDetailsElement>('.wr-risk-audit')]
    assert(audits.length === 2 && audits.every((item) => !item.open), '两个审计区默认必须收起')
    const dailyDisclosure = risk.querySelector<HTMLDetailsElement>('.wr-risk-daily')
    assert(dailyDisclosure && !dailyDisclosure.open, '每日风险轨迹默认必须收起，避免风控区过度占高')
    const collapsedRiskHeight = risk.getBoundingClientRect().height
    const compactHeightLimit = window.innerWidth <= 768 ? 440 : 360
    assert(collapsedRiskHeight < compactHeightLimit, `收起状态的风控区高度必须紧凑，当前为 ${collapsedRiskHeight}px`)
    dailyDisclosure.querySelector<HTMLElement>('summary')?.click()
    assert(dailyDisclosure.open, '每日风险轨迹必须能够按需展开')
    const firstSummary = audits[0]!.querySelector<HTMLElement>('summary')
    assert(firstSummary && firstSummary.tabIndex >= 0, '原生 summary 必须可聚焦')
    firstSummary.focus()
    assert(document.activeElement === firstSummary, '审计摘要必须能够获得键盘焦点')
    firstSummary.click()
    assert(audits[0]!.open, '激活 summary 后必须展开审计区')
    assert(audits[0]!.textContent?.includes(browserPolicyId), '规则展开后必须显示完整 ID')
    const secondSummary = audits[1]!.querySelector<HTMLElement>('summary')
    assert(secondSummary, '继续交易确认缺少审计摘要')
    secondSummary.click()
    assert(audits[1]!.open, '继续交易确认必须能够展开')
    const shell = document.querySelector<HTMLElement>('.wr-shell')
    const decisions = risk.querySelector<HTMLElement>('.wr-risk-decisions')
    const dailyEvidence = risk.querySelector<HTMLElement>('.wr-risk-daily')
    const auditEvidence = risk.querySelector<HTMLElement>('.wr-risk-audits')
    assert(shell, '复盘页面缺少宽度边界容器')
    assert(decisions && dailyEvidence && auditEvidence, '冻结风控证据缺少关键布局容器')
    const riskElements = [
      shell,
      risk,
      decisions,
      dailyEvidence,
      auditEvidence,
      ...risk.querySelectorAll<HTMLElement>('[class*="wr-risk-"]'),
    ]
    assertNoHorizontalOverflow(riskElements, `${window.innerWidth}px 风控容器不得横向滚动`)
    const shellBounds = shell.getBoundingClientRect()
    for (const element of [risk, decisions, dailyEvidence, auditEvidence]) {
      assertRectFitsHorizontally(element, shellBounds, '风控布局容器必须位于页面容器内')
    }
    const riskBounds = risk.getBoundingClientRect()
    const periods = [...risk.querySelectorAll<HTMLElement>('.wr-risk-period')]
    const days = [...risk.querySelectorAll<HTMLElement>('.wr-risk-day')]
    for (const element of [...periods, ...days, ...audits]) assertRectFitsHorizontally(element, riskBounds, '风控区关键元素必须位于容器内')
    const ruleParagraph = audits[0]!.querySelector<HTMLElement>(':scope > p')
    const confirmationArticle = audits[1]!.querySelector<HTMLElement>(':scope > article')
    assert(ruleParagraph?.textContent?.includes(browserPolicyId), '规则审计内容缺少完整长 ID')
    assert(confirmationArticle?.textContent?.includes('触线后只执行预设止损'), '继续交易确认缺少实际内容')
    const auditContent = [ruleParagraph, confirmationArticle].filter((element): element is HTMLElement => Boolean(element))
    assert(auditContent.length === 2, '审计展开后必须渲染规则与确认内容')
    auditEvidence.scrollIntoView({ block: 'center' })
    await waitForFrame()
    assertNoHorizontalOverflow(auditContent, `${window.innerWidth}px 审计内容不得横向滚动`)
    for (const content of auditContent) assertAuditTextIsVisible(content, auditEvidence, '审计文本必须完整可见')
    const visibleChildren = [...periods, ...days, ...audits]
      .flatMap((element) => [...element.children])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element.getClientRects().length > 0)
    for (const child of visibleChildren) {
      assertRectFitsHorizontally(child, child.parentElement!.getBoundingClientRect(), '风控区关键子元素必须位于父容器内')
    }
    assertNoOverlaps(periods, '风险决策卡不得重叠')
    assertNoOverlaps(days, '每日风险行不得重叠')
    assertNoOverlaps(audits, '审计区不得重叠')
    assertVerticallyAfter(decisions, dailyEvidence, '每日风险轨迹不得与风险决策区重叠')
    assertVerticallyAfter(dailyEvidence, auditEvidence, '冻结审计不得与每日风险轨迹重叠')
    assertVisibleContentAfter(periods, days, '每日实际内容不得侵入风险决策区')
    assertVisibleContentAfter(days, auditContent, '审计实际内容不得侵入每日风险轨迹')
    assert(document.body.textContent?.includes('触线后只执行预设止损'), '已完成复盘没有展示确认原因')
    assert(document.body.textContent?.includes('TRD-two · ETHUSDT · 关联未解析'), '未解析事件没有展示冻结身份与关联状态')
    const resolvedLink = [...document.querySelectorAll<HTMLAnchorElement>('a')]
      .find((link) => link.textContent === '查看交易' && link.getAttribute('href') === '/trade/TRD-one')
    assert(resolvedLink, 'resolved 冻结事件没有生成真实交易详情路由')

    const confirmationDisclosure = [...document.querySelectorAll<HTMLDetailsElement>('.wr-risk-audit')]
      .find((details) => details.querySelector('summary')?.textContent?.includes('继续交易确认'))
    assert(confirmationDisclosure, '缺少继续交易确认审计区')
    if (!confirmationDisclosure.open) confirmationDisclosure.querySelector('summary')?.click()
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

    const frozen = completed.riskSnapshot!
    const dailyFixture = [
      { date: activeWeekStart, coverage: 'complete' as const, triggered: false, label: '未触线', netBudgetR: 1.25, remainingR: 8.75, unknownReasons: [], expectedNet: '+1.25R' },
      { date: addDays(activeWeekStart, 1), coverage: 'partial' as const, triggered: false, label: '部分覆盖', netBudgetR: -1.5, remainingR: 3.5, unknownReasons: ['missing-loss-pnl'] as const, expectedNet: '-1.5R' },
      {
        date: addDays(activeWeekStart, 2), coverage: 'unknown' as const, triggered: false, label: '无法确认', netBudgetR: -2.25, remainingR: 2.75,
        unknownReasons: ['result-conflict', 'missing-policy', 'missing-close-date', 'invalid-close-date', 'future-loss-close-date', 'invalid-live-cycle-start'] as const,
        expectedNet: '-2.25R',
      },
      { date: addDays(activeWeekStart, 3), coverage: 'complete' as const, triggered: true, label: '已触线', netBudgetR: -5, remainingR: 0, unknownReasons: [], expectedNet: '-5.0R' },
    ]
    useStore.setState({
      weeklyReviews: [{
        ...completed,
        riskSnapshot: {
          ...frozen,
          dailyOutcomes: dailyFixture.map(({ date, coverage, triggered, netBudgetR, remainingR, unknownReasons }) => ({
            ...frozen.weeklyOutcome, coverage, triggered, date, netBudgetR, remainingR, unknownReasons: [...unknownReasons],
          })),
        },
      }],
    })
    await waitFor(
      () => document.querySelectorAll('.wr-risk-day').length === dailyFixture.length,
      '每日状态 fixture 未完整渲染',
    )
    const dailyRows = [...document.querySelectorAll<HTMLElement>('.wr-risk-day')]
    for (const expected of dailyFixture) {
      const row = dailyRows.find((item) => item.querySelector('.wr-risk-day-date')?.textContent === expected.date)
      assert(row, `每日轨迹缺少 ${expected.date}`)
      assert(row.querySelector('.wr-risk-day-status')?.textContent === expected.label, `${expected.date} 状态文案错误`)
      const value = row.querySelector('strong')?.textContent ?? ''
      assert(value === expected.expectedNet, `${expected.date} 必须展示净预算 R，实际为 ${value}`)
      assertDailyRiskRowKeepsKeyValuesOnOneLine(row)
    }
    const unknownRow = dailyRows.find((item) => item.querySelector('.wr-risk-day-status')?.textContent === '无法确认')
    assert(unknownRow, '每日轨迹缺少无法确认行')
    const longReasons = unknownRow?.querySelector<HTMLElement>('.wr-risk-day-reasons')
    assert(longReasons, '无法确认行缺少原因摘要')
    assert(longReasons.textContent?.includes('风险核算起点晚于当前交易日'), '长原因摘要没有完整渲染')
    assert(longReasons.scrollWidth <= longReasons.clientWidth, `${window.innerWidth}px 长原因摘要不得水平裁切`)
    assertRectFitsHorizontally(longReasons, unknownRow.getBoundingClientRect(), '长原因摘要必须在每日行内换行')
    useStore.setState({ weeklyReviews: [completed] })

    const frozenEvidence = [...document.querySelectorAll<HTMLElement>('.wr-trade-row')]
      .map((row) => row.textContent)
    const nextCycleDate = new Date(`${activeWeekStart}T12:00:00`)
    nextCycleDate.setDate(nextCycleDate.getDate() + 7)
    useStore.setState({ liveStatsStartTradingDayKey: getTradingDayKey(nextCycleDate) })
    await waitFor(
      () => document.querySelectorAll('.wr-trade-row').length === frozenEvidence.length,
      '调整统计周期后冻结证据列表被实时数据改写',
    )
    assert(
      [...document.querySelectorAll<HTMLElement>('.wr-trade-row')]
        .map((row) => row.textContent).join('|') === frozenEvidence.join('|'),
      '调整统计周期后冻结证据内容必须保持完成时快照',
    )

    useStore.getState().removeTrade('two')
    await waitFor(() => document.querySelector('[data-testid="store-render-sentinel"]')?.textContent === '3:1', '生产软删除后 Store 未确定重渲染')
    useStore.getState().purgeTrade('two')
    await waitFor(() => document.querySelector('[data-testid="store-render-sentinel"]')?.textContent === '2:0', '生产彻底删除后 Store 未确定重渲染')
    useStore.setState({ riskPolicyVersions: [], riskOverrideEvents: [] })
    await waitFor(() => document.body.textContent?.includes('触线后只执行预设止损') ?? false, '删除关联交易后冻结事件消失')
    assert(document.body.textContent?.includes('浏览器冻结规则'), '完成后读取了实时规则而不是快照')
    assert(document.body.textContent?.includes('+$100'), '完成后读取了实时绩效而不是快照')
    assert(
      [...document.querySelectorAll<HTMLElement>('.wr-trade-row')]
        .map((row) => row.textContent).join('|') === frozenEvidence.join('|'),
      '删除交易后冻结证据内容必须保持完成时快照',
    )

    clickButton('重新打开')
    await waitFor(() => useStore.getState().weeklyReviews[0]?.status === 'draft', '完成的复盘无法重新打开')
    assert(useStore.getState().weeklyReviews[0]?.metricsSnapshot === null, '重开后应恢复实时指标')
    assert(useStore.getState().weeklyReviews[0]?.riskSnapshot === undefined, '重开后应清除风险快照')

    const priorDate = new Date(`${activeWeekStart}T12:00:00`)
    priorDate.setDate(priorDate.getDate() - 7)
    const priorReview = {
      ...createWeeklyReview(weekStartFor(priorDate)),
      contentHtml: '<p>上一周真实复盘</p>',
    }
    useStore.getState().upsertWeeklyReview(priorReview)
    await waitFor(() => document.querySelectorAll('.wr-history button').length === 2, '真实历史周没有进入复盘记录')
    const historyButtons = [...document.querySelectorAll<HTMLButtonElement>('.wr-history button')]
    historyButtons[1]?.click()
    await waitFor(() => document.body.textContent?.includes('上一周真实复盘') ?? false, '切换历史周后正文没有更新')
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
    await waitFor(() => document.body.textContent?.includes('做法评分趋势') ?? false, '年度趋势页不可达')

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
    historyButtons[0]?.click()
    await waitFor(() => !document.body.textContent?.includes('上一周真实复盘'), '返回本周后仍显示历史正文')
    assert(!pageErrors.some((message) => message.includes('removeChild')), '切换周次触发了 removeChild 页面异常')
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
    const liveRecomputedTrades = [
      makeTrade('one', 'win', 300),
      makeTrade('two', 'loss', -50),
      makeTrade('three', 'missed', null),
    ]
    const assertLiveRecomputedState = async (missingType: string, riskUnavailableReason: string) => {
      await waitFor(
        () => document.body.textContent?.includes('历史快照缺失，指标与交易证据为实时重算；风险无法实时重算，当前不可用') ?? false,
        `缺少${missingType}时没有诚实说明各区域数据来源`,
      )
      const metricText = document.querySelector('.wr-metrics')?.textContent ?? ''
      const evidenceText = [...document.querySelectorAll<HTMLElement>('.wr-trade-row')]
        .map((row) => row.textContent).join('|')
      assert(metricText.includes('+$250') && !metricText.includes('+$100'), `缺少${missingType}时指标必须来自实时交易`)
      assert(evidenceText.includes('+$300') && !evidenceText.includes('+$100'), `缺少${missingType}时交易证据必须来自实时交易`)
      assert(document.body.textContent?.includes(missingType), `缺少${missingType}时必须列出缺失快照类型`)
      assert(!document.body.textContent?.includes('数据已冻结'), `缺少${missingType}时不得宣称数据已冻结`)
      const riskText = document.querySelector('.wr-risk-evidence')?.textContent ?? ''
      assert(riskText.includes(riskUnavailableReason), `缺少${missingType}时风控不可用原因不准确`)
      assert(document.querySelectorAll('.wr-risk-evidence [role="progressbar"]').length === 0, `缺少${missingType}时不得展示冻结风险数值`)
    }

    useStore.setState({ trades: liveRecomputedTrades, weeklyReviews: [completed] })
    await waitFor(
      () => document.body.textContent?.includes('完成时快照') ?? false,
      '三类快照齐全的 completed 复盘未进入完成时快照展示态',
    )
    assert(document.querySelector('.wr-metrics')?.textContent?.includes('+$100'), '完整快照时指标必须来自完成时快照')
    assert(
      [...document.querySelectorAll<HTMLElement>('.wr-trade-row')].some((row) => row.textContent?.includes('+$150')),
      '完整快照时交易证据必须来自完成时快照',
    )
    assert(document.querySelector('.wr-risk-evidence')?.textContent?.includes('浏览器冻结规则'), '完整快照时风控必须来自完成时冻结数据')
    assert(document.querySelectorAll('.wr-risk-evidence [role="progressbar"]').length === 2, '完整快照时必须展示冻结风险数值')

    useStore.setState({ weeklyReviews: [{ ...completed, metricsSnapshot: null }] })
    await assertLiveRecomputedState('指标快照', '快照集合不完整，已停用冻结风险展示，避免混合来源')

    useStore.setState({ weeklyReviews: [{ ...completed, evidenceSnapshot: undefined }] })
    await assertLiveRecomputedState('交易证据快照', '快照集合不完整，已停用冻结风险展示，避免混合来源')

    useStore.setState({ weeklyReviews: [{ ...completed, riskSnapshot: undefined }] })
    await assertLiveRecomputedState('风控快照', '历史记录未包含风控快照')
    assert(
      document.querySelector('.wr-risk-evidence')?.textContent?.includes('历史记录未包含风控快照'),
      '缺少风控快照时不得伪造历史风控数据',
    )
    root.render(
      <MemoryRouter
        key="missing-weekly-anchor"
        initialEntries={[{
          pathname: '/weekly-review',
          state: { restoreTradeId: 'weekly-trade:missing' },
        }]}
      >
        <Routes>
          <Route path="/weekly-review" element={<><WeeklyReviewView /><RouteProbe /><ToastHost /></>} />
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

    focusedRestoreStarts.length = 0
    focusedRestoreMissing.length = 0
    root.render(
      <MemoryRouter
        key="weekly-anchor-race"
        initialEntries={[{
          pathname: '/weekly-anchor-race',
          search: '?view=review',
          state: { restoreTradeId: 'weekly-trade:race-a' },
        }]}
      >
        <Routes>
          <Route path="/weekly-anchor-race" element={<ReturnAnchorRaceFixture />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => focusedRestoreStarts.join('|') === 'weekly-trade:race-a',
      '首个恢复请求没有进入准备阶段',
    )
    const raceStorageKey = 'trade-return-anchor:/weekly-anchor-race?view=review'
    sessionStorage.setItem(raceStorageKey, 'second-consumption-sentinel')
    clickButton('替换恢复锚点')
    await waitFor(
      () => document.activeElement?.closest('[data-trade-id="weekly-trade:race-b"]') !== null,
      '同路由的新恢复请求被旧 pending 吞掉',
    )
    assert(
      focusedRestoreStarts.join('|') === 'weekly-trade:race-a|weekly-trade:race-b',
      '每个恢复请求必须且只能调用一次恢复准备回调',
    )
    assert(!focusedRestoreMissing.includes('weekly-trade:race-a'), '旧恢复请求被替换后不得触发缺失降级')
    assert(
      sessionStorage.getItem(raceStorageKey) === 'second-consumption-sentinel',
      '同一来源路由的 sessionStorage 锚点只能消费一次',
    )
    sessionStorage.removeItem(raceStorageKey)

    focusedRestoreStarts.length = 0
    focusedRestoreMissing.length = 0
    root.render(
      <MemoryRouter
        key="weekly-hidden-anchor"
        initialEntries={[{
          pathname: '/weekly-hidden-anchor',
          state: { restoreTradeId: 'weekly-risk:hidden-event' },
        }]}
      >
        <Routes>
          <Route path="/weekly-hidden-anchor" element={<HiddenReturnAnchorFixture />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => focusedRestoreMissing.includes('weekly-risk:hidden-event'),
      'DOM 中仍隐藏的恢复目标被误判为成功',
    )
    assert(
      focusedRestoreStarts.join('|') === 'weekly-risk:hidden-event',
      '隐藏目标逐帧等待期间恢复准备回调只能调用一次',
    )
    assert(
      document.activeElement?.closest('[data-trade-id="weekly-risk:hidden-event"]') === null,
      '不可见主操作不得获得焦点',
    )
    assert(
      focusedRestoreMissing.filter((anchorId) => anchorId === 'weekly-risk:hidden-event').length === 1,
      '隐藏目标的缺失回调必须且只能触发一次',
    )

    focusedRestoreStarts.length = 0
    focusedRestoreMissing.length = 0
    root.render(
      <MemoryRouter
        key="board-card-return-anchor"
        initialEntries={[{
          pathname: '/board-return-anchor',
          state: { restoreTradeId: 'board-card:return-target' },
        }]}
      >
        <Routes>
          <Route path="/board-return-anchor" element={<BoardCardReturnAnchorFixture />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[data-trade-id="board-card:return-target"]') !== null,
      '看板返回夹具缺少目标卡片',
    )
    const boardCard = document.querySelector<HTMLElement>('[data-trade-id="board-card:return-target"]')
    assert(boardCard, '看板返回夹具缺少目标卡片')
    await waitFor(() => document.activeElement === boardCard, '看板卡片自身没有获得返回焦点')
    const boardCardRect = boardCard.getBoundingClientRect()
    assert(
      Math.abs(boardCardRect.top + boardCardRect.height / 2 - window.innerHeight / 2) < 2,
      '看板卡片返回后没有滚动到视口中部',
    )
    assert(focusedRestoreMissing.length === 0, '看板卡片自身可聚焦时不得触发缺失回调')

    focusedRestoreStarts.length = 0
    focusedRestoreMissing.length = 0
    root.render(
      <MemoryRouter
        key="return-anchor-navigation"
        initialEntries={[{
          pathname: '/return-anchor-navigation',
          search: '?view=review',
          state: { restoreTradeId: 'weekly-trade:race-a' },
        }]}
      >
        <Routes>
          <Route path="/return-anchor-navigation" element={<ReturnAnchorNavigationFixture />} />
          <Route path="/return-anchor-detail" element={<ReturnAnchorNavigationDetailFixture />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => focusedRestoreStarts.join('|') === 'weekly-trade:race-a',
      '恢复 A 没有进入待处理阶段',
    )
    clickButton('打开详情 B')
    await waitFor(
      () => document.body.textContent?.includes('浏览器返回 B') ?? false,
      '恢复 A 待处理期间没有打开详情 B',
    )
    clickButton('浏览器返回 B')
    await waitFor(
      () => document.activeElement?.closest('[data-trade-id="weekly-trade:race-b"]') !== null,
      '浏览器返回后最新的恢复请求 B 没有获得焦点',
    )
    await waitForFrames(40)
    assert(
      focusedRestoreStarts.join('|') === 'weekly-trade:race-a|weekly-trade:race-b',
      '离开未完成的 A 后只能启动最新请求 B',
    )
    assert(!focusedRestoreMissing.includes('weekly-trade:race-a'), '已离开的恢复 A 不得延迟触发缺失回退')
    assert(
      document.querySelector('[data-testid="return-state-probe"]')?.textContent === '',
      '显式恢复请求必须在恢复完成前从来源 history state 消费',
    )
    assert(
      sessionStorage.getItem('trade-return-anchor:/return-anchor-navigation?view=review') === null,
      '最新恢复请求 B 必须保持 sessionStorage 单次消费',
    )

    const rolloverTrade = makeTrade('rollover-source', 'win', 80)
    const rolloverDate = parseLocalDate(addDays(activeWeekStart, 7))
    rolloverDate.setHours(useStore.getState().display.tradingDayStartHour, 0, 0, 0)
    const rolloverBoundary = rolloverDate.getTime()
    currentDateControl = installCurrentDate(rolloverBoundary - 10_000)
    useStore.setState({ trades: [rolloverTrade], weeklyReviews: [] })
    root.render(
      <MemoryRouter key="weekly-current-rollover" initialEntries={['/weekly-review']}>
        <Routes>
          <Route path="/weekly-review" element={<><WeeklyReviewView /><RouteProbe /><ToastHost /></>} />
          <Route path="/trade/:id" element={<DetailFixture />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[data-trade-id="weekly-trade:rollover-source"]') !== null,
      '跨周返回夹具没有渲染来源周证据',
    )
    document.querySelector<HTMLAnchorElement>(
      '[data-trade-id="weekly-trade:rollover-source"] [data-trade-primary-action]',
    )?.click()
    await waitFor(() => document.querySelector('[data-testid="weekly-detail"]') !== null, '跨周返回夹具没有进入详情')
    currentDateControl?.set(rolloverBoundary + 10_000)
    clickLink('返回复盘')
    await waitFor(
      () => document.querySelector('[data-testid="weekly-route-probe"]')
        ?.getAttribute('data-search') === `?week=${activeWeekStart}`,
      '业务周推进后返回没有冻结原来源周',
    )
    await waitFor(
      () => document.activeElement?.closest('[data-trade-id="weekly-trade:rollover-source"]') !== null,
      '业务周推进后没有恢复原周锚点与焦点',
    )
    assert(
      document.querySelector('.wr-page-head h1')?.textContent === weekRangeText(activeWeekStart),
      '业务周推进后页面内容没有保持原来源周',
    )
    assert(
      !document.querySelector('.wr-page-head p')?.textContent?.includes('本周进行中'),
      '原来源周在业务周推进后必须显示为历史周',
    )
    currentDateControl?.restore()
    currentDateControl = null

    currentDateControl = installCurrentDate(rolloverBoundary - 10_000)
    useStore.setState({ trades: [rolloverTrade], weeklyReviews: [] })
    root.render(
      <MemoryRouter key="weekly-current-rollover-browser-back" initialEntries={['/weekly-review']}>
        <Routes>
          <Route path="/weekly-review" element={<><WeeklyReviewView /><RouteProbe /><ToastHost /></>} />
          <Route path="/trade/:id" element={<DetailFixture />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => (
        document.querySelector('[data-testid="weekly-route-probe"]')
          ?.getAttribute('data-search') === '' &&
        document.querySelector('[data-trade-id="weekly-trade:rollover-source"]') !== null
      ),
      '浏览器返回跨周夹具没有渲染来源周证据',
    )
    await waitForFrame()
    document.querySelector<HTMLAnchorElement>(
      '[data-trade-id="weekly-trade:rollover-source"] [data-trade-primary-action]',
    )?.click()
    await waitFor(() => document.querySelector('[data-testid="weekly-detail"]') !== null, '浏览器返回跨周夹具没有进入详情')
    currentDateControl?.set(rolloverBoundary + 10_000)
    clickButton('浏览器返回')
    await waitFor(
      () => (
        document.querySelector('[data-testid="weekly-route-probe"]')
          ?.getAttribute('data-search') === `?week=${activeWeekStart}` &&
        document.activeElement?.closest('[data-trade-id="weekly-trade:rollover-source"]') !== null
      ),
      '业务周推进后的浏览器返回没有恢复原周锚点与焦点',
    )
    currentDateControl?.restore()
    currentDateControl = null

    const disappearingWeek = addDays(activeWeekStart, -7)
    const disappearingTrade = {
      ...makeTrade('disappearing-activity', 'loss', -40),
      openedAt: disappearingWeek,
      closedAt: disappearingWeek,
      closedTradingDayKey: disappearingWeek,
    }
    useStore.setState({ trades: [disappearingTrade], weeklyReviews: [] })
    root.render(
      <MemoryRouter
        key="weekly-disappearing-activity"
        initialEntries={[`/weekly-review?week=${disappearingWeek}`]}
      >
        <Routes>
          <Route path="/weekly-review" element={<><WeeklyReviewView /><RouteProbe /><ToastHost /></>} />
          <Route path="/trade/:id" element={<DetailFixture />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[data-trade-id="weekly-trade:disappearing-activity"]') !== null,
      '活动历史周没有渲染待返回证据',
    )
    document.querySelector<HTMLAnchorElement>(
      '[data-trade-id="weekly-trade:disappearing-activity"] [data-trade-primary-action]',
    )?.click()
    await waitFor(() => document.querySelector('[data-testid="weekly-detail"]') !== null, '活动历史周没有进入详情')
    useStore.setState({ trades: [] })
    clickLink('返回复盘')
    await waitFor(
      () => (
        (document.body.textContent?.includes('原交易已不在当前复盘证据中') ?? false) &&
        document.activeElement?.classList.contains('wr-main') === true
      ),
      '活动历史周消失后返回没有执行缺失锚点回退',
    )
    assert(
      document.querySelector('[data-testid="weekly-route-probe"]')
        ?.getAttribute('data-search') === `?week=${disappearingWeek}`,
      '已验证返回请求没有临时保留消失的活动历史周',
    )
    assert(
      document.querySelector('.wr-page-head h1')?.textContent === weekRangeText(disappearingWeek),
      '缺失锚点回退没有停留在原活动历史周',
    )
    assert(document.activeElement?.classList.contains('wr-main'), '缺失锚点回退必须聚焦周复盘内容起点')
    assert(useStore.getState().weeklyReviews.length === 0, '为保留返回周次不得创建周复盘实体')

    root.render(
      <MemoryRouter
        key="weekly-disappearing-direct-link"
        initialEntries={[`/weekly-review?week=${disappearingWeek}`]}
      >
        <Routes>
          <Route path="/weekly-review" element={<><WeeklyReviewView /><RouteProbe /></>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[data-testid="weekly-route-probe"]')
        ?.getAttribute('data-search') === '',
      '没有返回上下文的不可用周深链仍被错误放行',
    )
    assert(
      document.querySelector('.wr-page-head p')?.textContent?.includes('本周进行中'),
      '普通不可用周深链必须恢复当前周内容',
    )

    root.render(<div data-testid="route-intent-reset" />)
    await waitForFrame()
    resetNoteDraftsForTests()
    const intentWeekA = addDays(activeWeekStart, -7)
    const intentWeekB = addDays(activeWeekStart, -14)
    const makeIntentReviews = () => [
      createWeeklyReview(activeWeekStart),
      createWeeklyReview(intentWeekA),
      createWeeklyReview(intentWeekB),
    ]
    const currentDraftId = `${WEEKLY_REVIEW_DRAFT_PREFIX}weekly-review:${activeWeekStart}`

    useStore.setState({ trades: [], weeklyReviews: makeIntentReviews() })
    const weekThenTabStarted = deferred<void>()
    const allowWeekThenTab = deferred<string>()
    storage.saveAsset = async () => {
      weekThenTabStarted.resolve()
      return allowWeekThenTab.promise
    }
    setNoteDraft(currentDraftId, '<p>周切换等待页签</p><img src="data:image/png;base64,QQ==">')
    const weekThenTabRouter = createMemoryRouter([{
      path: '/weekly-review',
      element: <><WeeklyReviewView /><RouteProbe /></>,
    }], { initialEntries: ['/weekly-review'] })
    const weekThenTabWrites: string[] = []
    const unsubscribeWeekThenTab = weekThenTabRouter.subscribe((state) => {
      weekThenTabWrites.push(state.location.search)
    })
    root.render(<RouterProvider key="week-then-tab" router={weekThenTabRouter} />)
    await waitFor(
      () => document.querySelector(`[data-review-week="${intentWeekA}"]`) !== null,
      '周后页签竞态夹具没有渲染目标周',
    )
    document.querySelector<HTMLButtonElement>(`[data-review-week="${intentWeekA}"]`)?.click()
    await weekThenTabStarted.promise
    clickButton('年度趋势')
    await waitFor(
      () => document.querySelector('[data-testid="weekly-route-probe"]')?.getAttribute('data-search') === '?tab=year',
      '较新的页签意图没有先写入路由',
    )
    allowWeekThenTab.resolve('week-then-tab-asset')
    await waitFor(() => !hasNoteDraft(currentDraftId), '周后页签竞态的草稿没有完成 flush')
    await waitForFrames(4)
    assert(
      document.querySelector('[data-testid="weekly-route-probe"]')?.getAttribute('data-search') === '?tab=year',
      '较旧的周切换在 flush 后覆盖了较新的页签意图',
    )
    assert(
      !weekThenTabWrites.some((search) => search.includes(`week=${intentWeekA}`)),
      '较旧的周切换仍曾写入路由',
    )
    unsubscribeWeekThenTab()

    root.render(<div data-testid="route-intent-reset" />)
    await waitForFrame()
    resetNoteDraftsForTests()
    useStore.setState({ trades: [], weeklyReviews: makeIntentReviews() })
    const weekThenWeekStarted = deferred<void>()
    const allowWeekThenWeek = deferred<string>()
    storage.saveAsset = async () => {
      weekThenWeekStarted.resolve()
      return allowWeekThenWeek.promise
    }
    setNoteDraft(currentDraftId, '<p>连续周切换</p><img src="data:image/png;base64,Qg==">')
    const weekThenWeekRouter = createMemoryRouter([{
      path: '/weekly-review',
      element: <><WeeklyReviewView /><RouteProbe /></>,
    }], { initialEntries: ['/weekly-review'] })
    const weekThenWeekWrites: string[] = []
    const unsubscribeWeekThenWeek = weekThenWeekRouter.subscribe((state) => {
      weekThenWeekWrites.push(state.location.search)
    })
    root.render(<RouterProvider key="week-then-week" router={weekThenWeekRouter} />)
    await waitFor(
      () => document.querySelector(`[data-review-week="${intentWeekB}"]`) !== null,
      '连续周切换竞态夹具没有渲染两个目标周',
    )
    document.querySelector<HTMLButtonElement>(`[data-review-week="${intentWeekA}"]`)?.click()
    await weekThenWeekStarted.promise
    document.querySelector<HTMLButtonElement>(`[data-review-week="${intentWeekB}"]`)?.click()
    allowWeekThenWeek.resolve('week-then-week-asset')
    await waitFor(() => !hasNoteDraft(currentDraftId), '连续周切换竞态的草稿没有完成 flush')
    await waitForFrames(4)
    assert(
      document.querySelector('[data-testid="weekly-route-probe"]')
        ?.getAttribute('data-search') === `?week=${intentWeekB}`,
      '连续周切换没有保留最后一次周选择',
    )
    assert(
      !weekThenWeekWrites.includes(`?week=${intentWeekA}`),
      '连续周切换期间较旧的周 A 仍曾写入路由',
    )
    unsubscribeWeekThenWeek()

    root.render(<div data-testid="route-intent-reset" />)
    await waitForFrame()
    resetNoteDraftsForTests()
    useStore.setState({ trades: [], weeklyReviews: makeIntentReviews() })
    const browserNavigationStarted = deferred<void>()
    const allowBrowserNavigation = deferred<string>()
    storage.saveAsset = async () => {
      browserNavigationStarted.resolve()
      return allowBrowserNavigation.promise
    }
    setNoteDraft(currentDraftId, '<p>等待浏览器导航</p><img src="data:image/png;base64,Qw==">')
    const browserNavigationRouter = createMemoryRouter([{
      path: '/weekly-review',
      element: <><WeeklyReviewView /><RouteProbe /></>,
    }], {
      initialEntries: ['/weekly-review?tab=year&visual=browser', '/weekly-review'],
      initialIndex: 1,
    })
    const browserNavigationWrites: string[] = []
    let releaseFlushOnBrowserNavigation = false
    const unsubscribeBrowserNavigation = browserNavigationRouter.subscribe((state) => {
      browserNavigationWrites.push(state.location.search)
      if (
        releaseFlushOnBrowserNavigation &&
        state.location.search === '?tab=year&visual=browser'
      ) {
        releaseFlushOnBrowserNavigation = false
        allowBrowserNavigation.resolve('browser-navigation-asset')
      }
    })
    root.render(<RouterProvider key="browser-navigation-before-flush" router={browserNavigationRouter} />)
    await waitFor(
      () => document.querySelector(`[data-review-week="${intentWeekA}"]`) !== null,
      '浏览器导航竞态夹具没有渲染目标周',
    )
    document.querySelector<HTMLButtonElement>(`[data-review-week="${intentWeekA}"]`)?.click()
    await browserNavigationStarted.promise
    releaseFlushOnBrowserNavigation = true
    await browserNavigationRouter.navigate(-1)
    await waitFor(
      () => document.querySelector('[data-testid="weekly-route-probe"]')
        ?.getAttribute('data-search') === '?tab=year&visual=browser',
      'flush 等待期间的浏览器导航没有生效',
    )
    await waitFor(() => !hasNoteDraft(currentDraftId), '浏览器导航竞态的草稿没有完成 flush')
    await waitForFrames(4)
    assert(
      document.querySelector('[data-testid="weekly-route-probe"]')
        ?.getAttribute('data-search') === '?tab=year&visual=browser',
      '较旧的周切换在 flush 后覆盖了浏览器导航',
    )
    assert(
      !browserNavigationWrites.some((search) => search.includes(`week=${intentWeekA}`)),
      '浏览器导航后较旧的周切换仍曾写入路由',
    )
    unsubscribeBrowserNavigation()

    root.render(<div data-testid="route-intent-reset" />)
    await waitForFrame()
    resetNoteDraftsForTests()
    useStore.setState({ trades: [], weeklyReviews: makeIntentReviews() })
    const unmountStarted = deferred<void>()
    const allowUnmountedFlush = deferred<string>()
    storage.saveAsset = async () => {
      unmountStarted.resolve()
      return allowUnmountedFlush.promise
    }
    setNoteDraft(currentDraftId, '<p>等待组件卸载</p><img src="data:image/png;base64,RA==">')
    const unmountRouter = createMemoryRouter([{
      path: '/weekly-review',
      element: <><WeeklyReviewView /><RouteProbe /></>,
    }], { initialEntries: ['/weekly-review'] })
    const unmountWrites: string[] = []
    const unsubscribeUnmount = unmountRouter.subscribe((state) => {
      unmountWrites.push(state.location.search)
    })
    root.render(<RouterProvider key="unmount-before-flush" router={unmountRouter} />)
    await waitFor(
      () => document.querySelector(`[data-review-week="${intentWeekA}"]`) !== null,
      '组件卸载竞态夹具没有渲染目标周',
    )
    document.querySelector<HTMLButtonElement>(`[data-review-week="${intentWeekA}"]`)?.click()
    await unmountStarted.promise
    root.render(<div data-testid="route-intent-unmounted" />)
    await waitFor(
      () => document.querySelector('[data-testid="route-intent-unmounted"]') !== null,
      '慢 flush 等待期间没有卸载周复盘组件',
    )
    allowUnmountedFlush.resolve('unmounted-route-intent-asset')
    await waitFor(() => !hasNoteDraft(currentDraftId), '组件卸载后的草稿没有完成 flush')
    await waitForFrames(4)
    assert(
      !unmountWrites.some((search) => search.includes(`week=${intentWeekA}`)),
      '组件卸载后较旧的周切换仍写入路由',
    )
    unsubscribeUnmount()

    resetNoteDraftsForTests()
    useStore.setState({ trades: [], weeklyReviews: makeIntentReviews() })
    storage.saveAsset = async () => { throw new Error('fixture draft save failure') }
    setNoteDraft(currentDraftId, '<p>保存失败</p><img src="data:image/png;base64,RQ==">')
    const failedDraftRouter = createMemoryRouter([{
      path: '/weekly-review',
      element: <><WeeklyReviewView /><RouteProbe /><ToastHost /></>,
    }], { initialEntries: ['/weekly-review'] })
    root.render(<RouterProvider key="failed-current-route-intent" router={failedDraftRouter} />)
    await waitFor(
      () => document.querySelector(`[data-review-week="${intentWeekA}"]`) !== null,
      '保存失败夹具没有渲染目标周',
    )
    document.querySelector<HTMLButtonElement>(`[data-review-week="${intentWeekA}"]`)?.click()
    await waitFor(
      () => document.body.textContent?.includes('正文尚未保存，请重试') ?? false,
      '当前周切换的草稿保存失败没有显示既有提示',
    )
    assert(
      document.querySelector('[data-testid="weekly-route-probe"]')?.getAttribute('data-search') === '',
      '草稿保存失败后仍执行了周切换',
    )
  } finally {
    currentDateControl?.restore()
    storage.saveAsset = originalSaveAsset
    resetNoteDraftsForTests()
    window.removeEventListener('error', capturePageError)
    root.unmount()
    useStore.setState({
      trades: previous.trades,
      weeklyReviews: previous.weeklyReviews,
      riskPolicyVersions: previous.riskPolicyVersions,
      monthlyRiskLimits: previous.monthlyRiskLimits,
      riskOverrideEvents: previous.riskOverrideEvents,
      liveStatsStartTradingDayKey: previous.liveStatsStartTradingDayKey,
    })
  }
}

window.__weeklyReviewFlowTest = run()
