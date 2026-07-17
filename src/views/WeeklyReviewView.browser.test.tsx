import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { weekStartFor } from '@/data/weeklyReviews'
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

function makeTrade(id: string, status: 'win' | 'loss', pnl: number): Trade {
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
    mistakeTags: status === 'loss' ? ['追价'] : [],
    reviewStatus: status === 'win' ? 'reviewed' : 'unreviewed',
    reviewCategory: status === 'loss' ? 'mistake' : 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: null,
    size: 1,
    pnl,
    rMultiple: null,
    resultSource: 'pnl',
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
  try {
    useStore.setState({
      trades: [makeTrade('one', 'win', 150), makeTrade('two', 'loss', -50)],
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

    clickButton('重新打开')
    await waitFor(() => useStore.getState().weeklyReviews[0]?.status === 'draft', '完成的复盘无法重新打开')
    assert(useStore.getState().weeklyReviews[0]?.metricsSnapshot === null, '重开后应恢复实时指标')

    clickButton('年度趋势')
    await waitFor(() => document.body.textContent?.includes('做法评分趋势') ?? false, '年度趋势页不可达')
  } finally {
    root.unmount()
    useStore.setState({ trades: previous.trades, weeklyReviews: previous.weeklyReviews })
  }
}

window.__weeklyReviewFlowTest = run()
