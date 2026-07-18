import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { createWeeklyReview, weekStartFor } from '@/data/weeklyReviews'
import { useStore } from '@/store/useStore'
import { WeeklyReviewView } from '@/views/WeeklyReviewView'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __weeklyReviewFlowTest?: Promise<void>
  }
}

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
  const weekStart = weekStartFor()
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
    })
    root.render(
      <MemoryRouter initialEntries={['/weekly-review']}>
        <Routes>
          <Route path="/weekly-review" element={<WeeklyReviewView />} />
          <Route path="/trade/:id" element={<div>交易详情</div>} />
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

    clickButton('重新打开')
    await waitFor(() => useStore.getState().weeklyReviews[0]?.status === 'draft', '完成的复盘无法重新打开')
    assert(useStore.getState().weeklyReviews[0]?.metricsSnapshot === null, '重开后应恢复实时指标')

    const priorDate = new Date(`${weekStartFor()}T12:00:00`)
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
  } finally {
    window.removeEventListener('error', capturePageError)
    root.unmount()
    useStore.setState({ trades: previous.trades, weeklyReviews: previous.weeklyReviews })
  }
}

window.__weeklyReviewFlowTest = run()
