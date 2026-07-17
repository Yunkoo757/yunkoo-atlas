import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import {
  buildWeeklyReviewMetrics,
  createWeeklyReview,
  weekStartFor,
} from '@/data/weeklyReviews'
import { useStore } from '@/store/useStore'
import { WeeklyReviewView } from '@/views/WeeklyReviewView'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __weeklyReviewPresentationTest?: Promise<void>
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

function makeTrade(weekStart: string): Trade {
  return {
    id: 'custom-label-trade',
    ref: 'TRD-CUSTOM',
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'loss',
    conviction: 'medium',
    strategyId: 'strategy',
    tags: [],
    mistakeTags: ['追价', 'FOMO'],
    reviewStatus: 'reviewed',
    reviewCategory: 'mistake',
    tradeKind: 'live',
    entry: 100,
    exit: 90,
    size: 1,
    pnl: -100,
    rMultiple: -1,
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
    const weekStart = weekStartFor()
    const trade = makeTrade(weekStart)
    const review = {
      ...createWeeklyReview(weekStart),
      status: 'completed' as const,
      executionScore: 2,
      riskScore: 2,
      emotionScore: 4,
      mistakeTags: ['情绪化', 'FOMO'],
      metricsSnapshot: buildWeeklyReviewMetrics([trade]),
      completedAt: new Date().toISOString(),
    }
    useStore.setState({ trades: [trade], weeklyReviews: [review] })
    root.render(
      <MemoryRouter initialEntries={['/weekly-review']}>
        <Routes><Route path="/weekly-review" element={<WeeklyReviewView />} /></Routes>
      </MemoryRouter>,
    )

    await waitFor(() => document.body.textContent?.includes('本周交易标签') ?? false, '自定义交易标签证据区未显示')
    assert(![...document.querySelectorAll<HTMLButtonElement>('.wr-tag-group button')].some((button) => button.textContent?.startsWith('FOMO')), '自定义交易标签不应成为统计选项')
    assert(document.querySelector('.wr-evidence-tags')?.textContent?.includes('FOMO×1'), '自定义标签及次数没有作为证据显示')

    if (new URLSearchParams(location.search).get('visual') === 'review') await new Promise<void>(() => {})

    const yearButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '年度趋势')
    assert(yearButton, '年度趋势入口不存在')
    yearButton.click()
    await waitFor(() => document.body.textContent?.includes('趋势起点') ?? false, '单周数据没有显示趋势起点')
    assert(document.body.textContent?.includes('2.7'), '趋势起点评分没有保留一位小数')
    assert(!document.querySelector('.wr-chart'), '只有一周数据时不应绘制折线图')
    assert(document.querySelector('.wr-year-summary')?.textContent?.includes('情绪化'), '年度最常见错误没有使用固定分类')
    assert(!document.querySelector('.wr-year-summary')?.textContent?.includes('FOMO'), '自定义标签污染了年度最常见错误')
  } finally {
    if (!new URLSearchParams(location.search).has('visual')) {
      root.unmount()
      useStore.setState({ trades: previous.trades, weeklyReviews: previous.weeklyReviews })
    }
  }
}

window.__weeklyReviewPresentationTest = run()
