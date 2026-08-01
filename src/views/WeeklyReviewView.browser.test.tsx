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

function riskEvent(): RiskOverrideEvent {
  const outcome = riskOutcome(-1, 2)
  return {
    id: 'override-1',
    tradeId: 'two',
    tradeIdentityAtDecision: { ref: 'TRD-two', symbol: 'ETHUSDT', tradeKind: 'live' },
    linkState: 'unresolved',
    decisionType: 'triggered',
    tradingDayKeyAtDecision: activeWeekStart,
    policyVersionId: 'policy-browser',
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
        id: 'policy-browser',
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
        sourcePolicyVersionId: 'policy-browser',
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
    assert(document.body.textContent?.includes('触线后只执行预设止损'), '已完成复盘没有展示确认原因')
    assert(document.body.textContent?.includes('TRD-two · ETHUSDT · 关联未解析'), '未解析事件没有展示冻结身份与关联状态')
    const resolvedLink = [...document.querySelectorAll<HTMLAnchorElement>('a')]
      .find((link) => link.textContent === '查看交易' && link.getAttribute('href') === '/trade/TRD-one')
    assert(resolvedLink, 'resolved 冻结事件没有生成真实交易详情路由')

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
