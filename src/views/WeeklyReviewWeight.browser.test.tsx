import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { createWeeklyReview, weekStartFor } from '@/data/weeklyReviews'
import { getTradingDayKey, parseLocalDate } from '@/lib/periods'
import { useStore } from '@/store/useStore'
import { WeeklyReviewView } from './WeeklyReviewView'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global { interface Window { __weeklyReviewWeightTest?: Promise<void> } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function waitFor(check: () => boolean, message: string) {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (check()) return
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  throw new Error(message)
}

async function run() {
  const previous = useStore.getState()
  const week = weekStartFor(parseLocalDate(getTradingDayKey()))
  const stageId = previous.currentLiveStageId
  const trades: Trade[] = Array.from({ length: 14 }, (_, index) => ({
    id: `weight-${index}`, ref: `QA-${index}`, symbol: 'BTCUSDT', side: 'long', status: 'win',
    conviction: 'medium', strategyId: '', tags: [], mistakeTags: [], reviewStatus: 'unreviewed',
    reviewCategory: 'normal', tradeKind: 'live', liveStageId: stageId, entry: 100, exit: 110,
    size: 1, pnl: 10, cashCurrency: 'USD', rMultiple: 1, resultSource: 'pnl',
    openedAt: `${week}T08:00:00.000Z`, closedAt: `${week}T09:00:00.000Z`, note: '<p>隔离证据</p>',
  }))
  const review = { ...createWeeklyReview(week, stageId), highlightTradeIds: [trades[0].id] }
  const root = createRoot(document.getElementById('root')!)
  try {
    useStore.setState({ trades, weeklyReviews: [review], liveStages: previous.liveStages.map((stage) => stage.id === stageId ? { ...stage, startsOn: week } : stage) })
    root.render(<MemoryRouter initialEntries={[`/weekly-review?week=${week}`]}><WeeklyReviewView /></MemoryRouter>)
    await waitFor(() => Boolean(document.querySelector('.wr-evidence-toggle')), '大量证据缺少展开入口')
    assert(document.querySelectorAll('.wr-trade-row').length === 1, '默认应突出已标记证据')
    const documentBefore = document.querySelector('.wr-editor-wrap')!.getBoundingClientRect()
    assert(!document.querySelector('.wr-section-nav'), '默认页面不得保留多层章节导航')
    const evidence = document.querySelector<HTMLDetailsElement>('.wr-disclosure:has([data-weekly-section="evidence"])')!
    assert(!evidence.open, '交易明细默认按需展开')
    const open = [...document.querySelectorAll<HTMLButtonElement>('.wr-document-links button')].find(button => button.textContent?.includes('14 笔交易'))!
    open.click()
    await waitFor(() => evidence.open && document.activeElement === evidence.querySelector('summary'), '证据入口必须展开明细并定位焦点')
    assert(documentBefore.height > 0, '正文必须优先显示')
    document.querySelector<HTMLButtonElement>('.wr-evidence-toggle')!.click()
    await waitFor(() => document.querySelectorAll('.wr-trade-row').length === 14, '展开必须保留全部交易')
    const row = document.querySelectorAll<HTMLElement>('.wr-trade-row')[3]
    const role = row.querySelector<HTMLButtonElement>('.wr-trade-roles button')!
    role.focus()
    assert(getComputedStyle(role).opacity === '1', '键盘聚焦必须显露角色操作')
    role.click()
    await waitFor(() => useStore.getState().weeklyReviews[0].highlightTradeIds.length === 2, '角色标记未保存')
    assert(document.querySelectorAll('.wr-trade-row').length === 14, '标记过程中不得移动或收起其他证据')
    assert(document.documentElement.scrollWidth <= innerWidth, '不得产生横向溢出')
  } finally {
    root.unmount()
    useStore.setState({ trades: previous.trades, weeklyReviews: previous.weeklyReviews, liveStages: previous.liveStages })
  }
}
window.__weeklyReviewWeightTest = run()
