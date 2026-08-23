import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import {
  clearReviewSessionStorage,
  loadReviewSession,
} from '@/lib/reviewSession'
import { bootstrapStorage, getStorage } from '@/storage'
import { useStore } from '@/store/useStore'
import { ReviewSessionView } from '@/views/ReviewSessionView'

declare global {
  interface Window {
    __reviewPoolStartTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 8_000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

const baseTrade: Extract<Trade, { tradeKind: 'live' }> = {
  id: 'pool-live-win',
  ref: 'TRD-POOL-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: 'uncategorized',
  tradeKind: 'live',
  tags: [],
  mistakeTags: [],
  reviewStatus: 'reviewed',
  reviewCategory: 'normal',
  entry: 100,
  exit: 110,
  size: 1,
  pnl: 100,
  rMultiple: 2,
  resultSource: 'imported',
  openedAt: '2026-08-01T00:00:00.000Z',
  closedAt: '2026-08-02T00:00:00.000Z',
  closedTradingDayKey: '2026-08-02',
  note: '<p>交易复盘</p>',
}

async function run(): Promise<void> {
  await bootstrapStorage()
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const manifest = await getStorage().getManifest()
  const previous = useStore.getState()
  clearReviewSessionStorage(manifest.libraryId)

  const liveWin = { ...baseTrade, liveStageId: previous.currentLiveStageId }
  const openTrade = {
    ...liveWin,
    id: 'pool-live-open',
    ref: 'TRD-POOL-2',
    status: 'open' as const,
    exit: null,
    pnl: null,
    rMultiple: null,
    resultSource: undefined,
    closedAt: null,
    closedTradingDayKey: undefined,
  }
  const reviewCase: Trade = {
    ...liveWin,
    id: 'pool-case',
    ref: 'CAS-POOL-1',
    tradeKind: 'case',
    status: 'loss',
    exit: 90,
    pnl: -100,
    rMultiple: -1,
    caseType: 'mistake',
    masteryState: 'new',
    reviewStatus: 'unreviewed',
    reviewCategory: 'mistake',
    note: '<p>案例洞见</p>',
  }

  useStore.setState({
    trades: [liveWin, openTrade, reviewCase],
    subscribedIds: [openTrade.id, reviewCase.id],
  })

  const root = createRoot(rootElement)
  root.render(
    <MemoryRouter
      initialEntries={['/review-session']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/review-session" element={<ReviewSessionView />} />
      </Routes>
    </MemoryRouter>,
  )

  try {
    await waitFor(
      () => [...document.querySelectorAll<HTMLButtonElement>('.review-session-preset-list button')]
        .some((button) => button.textContent?.includes('近期多看 · 1')),
      '近期多看必须只统计满足通用资格的已标记记录',
    )
    const boosted = [...document.querySelectorAll<HTMLButtonElement>('.review-session-preset-list button')]
      .find((button) => button.textContent?.includes('近期多看 · 1'))
    assert(boosted && !boosted.disabled, '非空近期多看复盘池必须可直接开始')
    boosted.click()

    await waitFor(() => Boolean(document.querySelector('.review-session-workspace')), '点击系统池后没有直接开始复盘')
    await waitFor(
      () => loadReviewSession(manifest.libraryId)?.systemPoolId === 'boosted',
      '临时会话没有耐久保存系统池来源',
    )
    const stored = loadReviewSession(manifest.libraryId)
    assert(stored?.systemPoolId === 'boosted', '临时会话必须记住系统池来源')
    assert(stored.ids.join(',') === reviewCase.id, '近期多看不得因 open 标记而放宽候选资格')
  } finally {
    root.unmount()
    clearReviewSessionStorage(manifest.libraryId)
    useStore.setState({
      trades: previous.trades,
      subscribedIds: previous.subscribedIds,
    })
  }
}

window.__reviewPoolStartTest = run()
