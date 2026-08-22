import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import {
  buildWeeklyReviewMetrics,
  createWeeklyReview,
  weekStartFor,
} from '@/data/weeklyReviews'
import { getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { useStore } from '@/store/useStore'
import { WeeklyReviewView } from '@/views/WeeklyReviewView'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __weeklyReviewPresentationTest?: Promise<void>
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
    liveStageId: useStore.getState().currentLiveStageId,
    entry: 100,
    exit: 90,
    size: 1,
    pnl: -100,
    cashCurrency: 'USD',
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
    const weekStart = activeWeekStart
    const trade = makeTrade(weekStart)
    const review = {
      ...createWeeklyReview(weekStart, previous.currentLiveStageId),
      status: 'completed' as const,
      executionScore: 2,
      riskScore: 2,
      emotionScore: 4,
      mistakeTags: ['情绪化', 'FOMO'],
      metricsSnapshot: buildWeeklyReviewMetrics([trade]),
      completedAt: new Date().toISOString(),
    }
    useStore.setState({
      trades: [trade],
      weeklyReviews: [review],
      display: { ...previous.display, privacyMode: true },
    })
    root.render(
      <MemoryRouter initialEntries={['/weekly-review']}>
        <Routes><Route path="/weekly-review" element={<WeeklyReviewView />} /></Routes>
      </MemoryRouter>,
    )

    await waitFor(() => document.body.textContent?.includes('本周交易标签') ?? false, '自定义交易标签证据区未显示')
    const pageHead = document.querySelector<HTMLElement>('.wr-page-head-inner')
    const content = document.querySelector<HTMLElement>('.wr-content')
    assert(pageHead && content, '周复盘缺少页头或正文轨道')
    const pageHeadRect = pageHead.getBoundingClientRect()
    const contentRect = content.getBoundingClientRect()
    assert(Math.abs(pageHeadRect.left - contentRect.left) < 1, '页头与正文左轨没有对齐')
    assert(Math.abs(pageHeadRect.width - contentRect.width) < 1, '页头与正文宽度没有对齐')
    const elevatedSections = [...document.querySelectorAll<HTMLElement>('.wr-section')].filter((section) => {
      const style = getComputedStyle(section)
      return style.borderTopWidth !== '0px' && style.borderRadius !== '0px'
    })
    assert(elevatedSections.length <= 3, '周复盘保留了超过三块抬升章节')
    assert(document.querySelector('.wr-progress-summary'), '周复盘缺少紧凑进度摘要')
    assert(getComputedStyle(document.querySelector<HTMLElement>('.wr-footer-action')!).position === 'sticky', '周复盘主操作栏没有保持 sticky')
    assert(![...document.querySelectorAll<HTMLButtonElement>('.wr-tag-group button')].some((button) => button.textContent?.startsWith('FOMO')), '自定义交易标签不应成为统计选项')
    assert(document.querySelector('.wr-evidence-tags')?.textContent?.includes('FOMO×1'), '自定义标签及次数没有作为证据显示')
    const frozenPnl = [...document.querySelectorAll<HTMLElement>('.wr-metric')]
      .find((metric) => metric.textContent?.includes('净盈亏'))
    assert(frozenPnl?.textContent?.includes('****'), '隐私模式必须遮蔽周复盘冻结净盈亏')
    assert(!frozenPnl?.textContent?.includes('$100'), '隐私模式不得泄露周复盘冻结净盈亏')

    if (new URLSearchParams(location.search).get('visual') === 'review') await new Promise<void>(() => {})

    const yearButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '年度趋势')
    assert(yearButton, '年度趋势入口不存在')
    yearButton.click()
    await waitFor(() => document.body.textContent?.includes('趋势起点') ?? false, '单周数据没有显示趋势起点')
    assert(document.body.textContent?.includes('2.7'), '趋势起点评分没有保留一位小数')
    assert(!document.querySelector('.wr-chart'), '只有一周数据时不应绘制折线图')
    assert(document.querySelector('.wr-year-summary')?.textContent?.includes('情绪化'), '年度最常见错误没有使用固定分类')
    assert(!document.querySelector('.wr-year-summary')?.textContent?.includes('FOMO'), '自定义标签污染了年度最常见错误')

    const otherStageReview = {
      ...createWeeklyReview(weekStart, 'stage-other'),
      status: 'completed' as const,
      executionScore: 4,
      riskScore: 4,
      emotionScore: 4,
    }
    useStore.setState((state) => ({ weeklyReviews: [...state.weeklyReviews, otherStageReview] }))
    await waitFor(() => !document.querySelector('.wr-chart'), '默认当前阶段趋势混入了其他阶段')
    const trendScope = document.querySelector<HTMLSelectElement>('[aria-label="年度趋势阶段范围"]')
    assert(trendScope, '年度趋势缺少阶段范围选择器')
    const reviewsBeforeScopeChange = JSON.stringify(useStore.getState().weeklyReviews)
    trendScope.value = ''
    trendScope.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => Boolean(document.querySelector('.wr-chart svg')), '全部阶段趋势没有包含其他阶段完成周')
    assert(JSON.stringify(useStore.getState().weeklyReviews) === reviewsBeforeScopeChange, '切换趋势范围不得修改复盘实体')
    trendScope.value = previous.currentLiveStageId
    trendScope.dispatchEvent(new Event('change', { bubbles: true }))
    await waitFor(() => !document.querySelector('.wr-chart'), '切回当前阶段后趋势仍混入其他阶段')
    useStore.setState((state) => ({
      weeklyReviews: state.weeklyReviews.filter((item) => item.id !== otherStageReview.id),
    }))

    const priorDate = new Date(`${weekStart}T12:00:00`)
    priorDate.setDate(priorDate.getDate() - 7)
    useStore.getState().upsertWeeklyReview({
      ...createWeeklyReview(weekStartFor(priorDate), previous.currentLiveStageId),
      status: 'completed',
      executionScore: 3,
      riskScore: 3,
      emotionScore: 3,
      completedAt: priorDate.toISOString(),
    })
    await waitFor(
      () => Boolean(document.querySelector('.wr-chart svg')),
      '第二个完成周出现后应按需载入年度评分折线图',
    )
  } finally {
    if (!new URLSearchParams(location.search).has('visual')) {
      root.unmount()
      useStore.setState({
        trades: previous.trades,
        weeklyReviews: previous.weeklyReviews,
        display: previous.display,
      })
    }
  }
}

window.__weeklyReviewPresentationTest = run()
