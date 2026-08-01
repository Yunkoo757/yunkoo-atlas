import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import type { RiskOverrideEvent, RiskPeriodOutcomeSnapshot } from '@/data/riskManagement'
import { createWeeklyReview, weekStartFor } from '@/data/weeklyReviews'
import { formatYmd, getTradingDayKey, parseLocalDate } from '@/lib/periods'
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
    assert(element.scrollWidth <= element.clientWidth, `${message}：${element.className || element.tagName}`)
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

function assertAuditTextIsVisible(element: HTMLElement, message: string): void {
  const style = window.getComputedStyle(element)
  assert(!['hidden', 'clip'].includes(style.overflowX), `${message}：不得裁切横向内容`)
  assert(!['hidden', 'clip'].includes(style.overflowY), `${message}：不得裁切纵向内容`)
  assert(element.scrollWidth <= element.clientWidth, `${message}：内容不得横向溢出`)
  const range = document.createRange()
  range.selectNodeContents(element)
  const elementRect = element.getBoundingClientRect()
  const parentRect = element.parentElement!.getBoundingClientRect()
  const textRects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
  assert(textRects.length > 0, `${message}：内容必须可见`)
  for (const rect of textRects) {
    assert(rect.left >= elementRect.left && rect.right <= elementRect.right, `${message}：文本超出内容节点`)
    assert(rect.left >= parentRect.left && rect.right <= parentRect.right, `${message}：文本超出审计容器`)
    assert(rect.left >= 0 && rect.right <= window.innerWidth, `${message}：文本超出视口`)
  }
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

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
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
          <Route path="/weekly-review" element={<><WeeklyReviewView /><StoreRenderSentinel /></>} />
          <Route path="/trade/:id" element={<div>交易详情 <Link to="/weekly-review">返回复盘</Link></div>} />
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
    const audits = [...document.querySelectorAll<HTMLDetailsElement>('.wr-risk-audit')]
    assert(audits.length === 2 && audits.every((item) => !item.open), '两个审计区默认必须收起')
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
    assertNoHorizontalOverflow(auditContent, `${window.innerWidth}px 审计内容不得横向滚动`)
    for (const content of auditContent) assertAuditTextIsVisible(content, '审计文本必须完整可见')
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
    assert(document.body.textContent?.includes('触线后只执行预设止损'), '已完成复盘没有展示确认原因')
    assert(document.body.textContent?.includes('TRD-two · ETHUSDT · 关联未解析'), '未解析事件没有展示冻结身份与关联状态')
    const resolvedLink = [...document.querySelectorAll<HTMLAnchorElement>('a')]
      .find((link) => link.textContent === '查看交易' && link.getAttribute('href') === '/trade/TRD-one')
    assert(resolvedLink, 'resolved 冻结事件没有生成真实交易详情路由')

    const frozen = completed.riskSnapshot!
    const dailyFixture = [
      { date: activeWeekStart, coverage: 'complete' as const, triggered: false, label: '未触线' },
      { date: addDays(activeWeekStart, 1), coverage: 'partial' as const, triggered: false, label: '部分覆盖' },
      { date: addDays(activeWeekStart, 2), coverage: 'unknown' as const, triggered: false, label: '无法确认' },
      { date: addDays(activeWeekStart, 3), coverage: 'complete' as const, triggered: true, label: '已触线' },
    ]
    useStore.setState({
      weeklyReviews: [{
        ...completed,
        riskSnapshot: {
          ...frozen,
          dailyOutcomes: dailyFixture.map(({ date, coverage, triggered }) => ({
            ...frozen.weeklyOutcome, coverage, triggered, date,
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
      assertDailyRiskRowKeepsKeyValuesOnOneLine(row)
    }
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

    resolvedLink.click()
    await waitFor(() => document.body.textContent?.includes('交易详情') ?? false, 'resolved 冻结事件链接未进入交易详情路由')
    const returnLink = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((link) => link.textContent === '返回复盘')
    assert(returnLink, '交易详情缺少返回复盘入口')
    returnLink.click()
    await waitFor(() => document.body.textContent?.includes('这周已经形成闭环') ?? false, '从冻结交易详情返回后没有恢复复盘')

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
    historyButtons[0]?.click()
    await waitFor(() => !document.body.textContent?.includes('上一周真实复盘'), '返回本周后仍显示历史正文')
    assert(!pageErrors.some((message) => message.includes('removeChild')), '切换周次触发了 removeChild 页面异常')

    clickButton('年度趋势')
    await waitFor(() => document.body.textContent?.includes('做法评分趋势') ?? false, '年度趋势页不可达')

    clickButton('本周复盘')
    const legacyCycleStart = new Date(`${activeWeekStart}T12:00:00`)
    legacyCycleStart.setDate(legacyCycleStart.getDate() + 1)
    const legacyCompletedReview = { ...completed, evidenceSnapshot: undefined }
    useStore.setState({
      trades: [makeTrade('one', 'win', 150), makeTrade('two', 'loss', -50), makeTrade('three', 'missed', null)],
      weeklyReviews: [legacyCompletedReview],
      liveStatsStartTradingDayKey: getTradingDayKey(legacyCycleStart),
    })
    await waitFor(
      () => document.body.textContent?.includes('完成时快照') ?? false,
      '旧 completed 复盘未进入冻结展示态',
    )
    assert(
      document.querySelectorAll('.wr-trade-row').length === 3,
      '旧 completed 无 evidenceSnapshot 时必须回退展示未经当前周期过滤的当周历史证据',
    )
    assert(
      !document.body.textContent?.includes('当前周期自'),
      '旧 completed 无 evidenceSnapshot 时不得显示后来设置的当前周期标签',
    )
    assert(legacyCompletedReview.metricsSnapshot?.totalPnl === 100, '旧 completed 的冻结 metrics 不得重算')
  } finally {
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
