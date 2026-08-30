import React from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, Link, Outlet, RouterProvider, useNavigate } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import type { WeeklyReview } from '@/data/weeklyReviews'
import { AppFrame } from '@/components/ui/AppFrame'
import { StageRolloverBanner } from '@/components/StageRolloverBanner'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window { __stageRolloverBannerTest?: Promise<void> }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

function blockedTrade(id: string, status: 'planned' | 'open'): Trade {
  return {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status,
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'live',
    liveStageId: 'stage-current',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-09-01',
    closedAt: null,
    note: '',
  }
}

function draftReview(): WeeklyReview {
  return {
    id: 'weekly-review:stage-current:2026-08-31',
    liveStageId: 'stage-current',
    weekStart: '2026-08-31',
    weekEnd: '2026-09-06',
    status: 'draft',
    executionScore: null,
    riskScore: null,
    emotionScore: null,
    strengthTags: [],
    mistakeTags: [],
    highlightTradeIds: [],
    mistakeTradeIds: [],
    followUpTradeIds: [],
    contentHtml: '',
    commitmentText: '',
    commitmentCriteria: '',
    previousCommitmentResult: null,
    metricsSnapshot: null,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
  }
}

function FirstRoute() {
  const navigate = useNavigate()
  const openComposer = useStore((state) => state.openComposer)
  return (
    <div>
      <h1>第一页面</h1>
      <button type="button" onClick={() => openComposer(null, 'live')}>新建交易</button>
      <button type="button" onClick={() => navigate('/second')}>前往第二页面</button>
    </div>
  )
}

function ShellFixture({ currentTradingDayKey }: { currentTradingDayKey: string }) {
  return (
    <AppFrame sidebar={<nav><Link to="/first">测试导航</Link></nav>}>
      <StageRolloverBanner currentTradingDayKey={currentTradingDayKey} />
      <Outlet />
    </AppFrame>
  )
}

function text(): string { return document.body.textContent ?? '' }

function button(label: string): HTMLButtonElement {
  const target = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.trim() === label)
  assert(target, `找不到按钮：${label}`)
  return target
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  try {
    useStore.setState({
      liveStages: [{
        id: 'stage-current', sequence: 1, name: '自由命名阶段', status: 'current',
        startsOn: '2026-08-01', endsOn: null,
        createdAt: '2026-08-01T00:00:00.000Z', archivedAt: null,
      }],
      currentLiveStageId: 'stage-current',
      scheduledStageRollover: {
        id: 'rollover-postponed',
        requestedAt: '2026-08-28T00:00:00.000Z',
        effectiveWeekStart: '2026-09-07',
        postponedCount: 1,
      },
      trades: [blockedTrade('planned-1', 'planned'), blockedTrade('planned-2', 'planned'), blockedTrade('open-1', 'open')],
      weeklyReviews: [draftReview()],
      composerOpen: false,
    })

    const router = createMemoryRouter([{
      element: <ShellFixture currentTradingDayKey="2026-09-01" />,
      children: [
        { path: '/first', element: <FirstRoute /> },
        { path: '/second', element: <div><h1>第二页面</h1><Link to="/first">返回</Link></div> },
      ],
    }], { initialEntries: ['/first'] })
    root.render(<RouterProvider router={router} />)
    await waitFor(() => text().includes('第一页面'), '第一页面未渲染')
    assert(text().includes('阶段切换已顺延至 9月7日'), '顺延 banner 必须展示新的有效日期')
    assert(text().includes('计划中 2 笔将保留在原阶段'), '顺延 banner 必须展示计划记录归属')
    assert(text().includes('持仓中 1 笔'), '顺延 banner 必须展示持仓数量')
    assert(text().includes('周复盘可稍后补做'), '顺延 banner 必须说明周复盘不再阻止切换')
    assert(text().includes('处理阻断项后将在新的生效日重试'), '阻断不得静默取消预约')

    const create = button('新建交易')
    assert(!create.disabled && !create.closest('[inert]'), '未到期预约不得禁用正常新建交易')
    create.click()
    assert(useStore.getState().composerOpen, '未到期预约期间新建交易动作必须正常执行')
    button('前往第二页面').click()
    await waitFor(() => text().includes('第二页面'), '路由未切换')
    assert(Boolean(document.querySelector('[data-stage-rollover-banner]')), 'banner 必须位于跨页面 app shell 中持续存在')
    assert(text().includes('阶段切换已顺延至 9月7日'), '路由切换后 banner 不得消失')
    assert(document.documentElement.scrollWidth <= document.documentElement.clientWidth, '桌面宽度不得产生横向溢出')
  } finally {
    root.unmount()
    useStore.setState(previous)
  }
}

window.__stageRolloverBannerTest = run()
