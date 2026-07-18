import { createRoot } from 'react-dom/client'
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import {
  clearReviewSessionStorage,
  loadReviewSession,
} from '@/lib/reviewSession'
import { useShortcutHost } from '@/shortcuts/ShortcutHost'
import { bootstrapStorage, getStorage } from '@/storage'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { ReviewSessionView } from '@/views/ReviewSessionView'

declare global {
  interface Window {
    __reviewSessionFlowTest?: Promise<void>
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

function findButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === label)
}

const strategy: Strategy = {
  id: 'review-session-strategy',
  name: '突破回踩',
  icon: 'target',
  color: '#5e6ad2',
}

const trade: Trade = {
  id: 'review-session-trade',
  ref: 'TRD-RANDOM-1',
  symbol: 'BTCUSDT',
  side: 'long',
  status: 'win',
  conviction: 'medium',
  strategyId: strategy.id,
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
  openedAt: '2026-07-15',
  closedAt: '2026-07-16',
  note: '<p>复盘结论：等待回踩确认。</p><img alt="结构图" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22200%22%3E%3Crect width=%22400%22 height=%22200%22 fill=%22%235e6ad2%22/%3E%3C/svg%3E"><img src="journal-asset://missing-review-chart">',
}

function DetailProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  const from = (location.state as { from?: { pathname?: string } } | null)?.from
  return (
    <main data-detail-probe>
      <span>{from?.pathname}</span>
      <button type="button" onClick={() => navigate(from?.pathname ?? '/list')}>返回复盘</button>
    </main>
  )
}

function TestApp() {
  useShortcutHost({ onToggleCmdk: () => {} })
  return (
    <Routes>
      <Route path="/review-session" element={<ReviewSessionView />} />
      <Route path="/trade/:id" element={<DetailProbe />} />
    </Routes>
  )
}

async function run(): Promise<void> {
  await bootstrapStorage()
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const manifest = await getStorage().getManifest()
  const previous = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  clearReviewSessionStorage(manifest.libraryId)
  useStore.setState({
    trades: [trade],
    strategies: [strategy],
    starredIds: [],
    composerOpen: false,
    closeTradeRequest: null,
  })
  useShortcutStore.setState({
    lightbox: null,
    cmdkOpen: false,
    dataIOOpen: false,
  })

  const root = createRoot(rootElement)
  root.render(
    <MemoryRouter
      initialEntries={['/review-session']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <TestApp />
    </MemoryRouter>,
  )

  try {
    await waitFor(
      () => document.body.textContent?.includes('可随机复盘 1 条') === true,
      '随机复盘没有显示实时范围数量',
    )
    assert(document.querySelector('.review-session-scope-select .ui-select-trigger'), '案例范围应使用统一选择框')
    assert(!document.querySelector('.review-session-options select'), '随机复盘不得退回系统原生下拉框')
    findButton('随机开始')?.click()
    await waitFor(
      () => Boolean(document.querySelector('.review-session-workspace')),
      '开始后没有直接打开完整交易',
    )
    await waitFor(
      () => document.activeElement?.hasAttribute('data-review-session-focus') === true,
      '开始复盘后没有把焦点移入当前交易',
    )
    await waitFor(
      () => document.body.textContent?.includes('复盘结论') === true,
      '完整交易没有直接显示复盘正文',
    )
    assert(!document.querySelector('.review-session-card.is-front, .review-session-card.is-back'), '随机复盘不得再出现正反面卡片')
    assert(document.querySelectorAll('.review-session-gallery img').length === 1, '有效截图应从正文拆入受控图片画廊')
    assert(
      document.body.textContent?.includes('图片附件缺失'),
      '图片读取失败应显示可继续复盘的缺失占位',
    )

    const openDetail = findButton('打开详情')
    assert(openDetail, '完整复盘缺少详情入口')
    openDetail.focus()
    const buttonSpaceAccepted = openDetail.dispatchEvent(new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    }))
    assert(buttonSpaceAccepted, '按钮获得焦点时 Space 必须保留原生激活行为')
    assert(document.body.textContent?.includes('复盘结论'), '按钮 Space 不得推进当前交易')

    openDetail.click()
    await waitFor(() => Boolean(document.querySelector('[data-detail-probe]')), '没有进入交易详情')
    assert(document.body.textContent?.includes('/review-session'), '详情来源没有记录随机复盘')
    findButton('返回复盘')?.click()
    await waitFor(
      () => document.body.textContent?.includes('复盘结论') === true,
      '从详情返回后没有恢复同一条完整交易',
    )
    assert(loadReviewSession(manifest.libraryId)?.cursor === 0, '打开详情不得推进随机队列')

    const shortcutTarget = document.activeElement ?? document.body
    const accepted = shortcutTarget.dispatchEvent(new KeyboardEvent('keydown', {
      key: '2',
      bubbles: true,
      cancelable: true,
    }))
    assert(!accepted, '掌握度快捷键应在捕获阶段被随机复盘消费')
    await waitFor(
      () => loadReviewSession(manifest.libraryId)?.assessments[trade.id] === 'recheck',
      '基本理解没有写入会话结果',
    )
    const assessed = useStore.getState().trades.find((item) => item.id === trade.id)
    assert(assessed?.masteryState === 'recheck', '评估没有写回记录掌握度')
    assert(assessed.reviewCategory === 'recheck' && Boolean(assessed.nextReviewAt), '基本理解没有生成复看计划')
    await waitFor(
      () => document.body.textContent?.includes('本轮完成') === true,
      '评估后没有进入下一条或完成本轮',
    )
    await waitFor(
      () => document.activeElement?.hasAttribute('data-review-session-finished-focus') === true,
      '完成本轮后没有把焦点移到完成状态',
    )
    assert(document.querySelector('[data-review-session-finished-focus]')?.getAttribute('role') === 'status', '完成状态必须向读屏播报')
    assert(document.body.textContent?.includes('基本理解') === true, '完成页没有汇总掌握度')

    findButton('再随机一轮')?.click()
    await waitFor(() => Boolean(document.querySelector('.review-session-workspace')), '无法再次随机开始')
    const skipAccepted = (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'n',
      bubbles: true,
      cancelable: true,
    }))
    assert(!skipAccepted, 'N 应在捕获阶段执行跳过')
    await waitFor(() => loadReviewSession(manifest.libraryId)?.cursor === 1, 'N 没有跳过当前记录')
    assert(!useStore.getState().composerOpen, '随机复盘中的 N 不得触发全局新建交易')
  } finally {
    root.unmount()
    clearReviewSessionStorage(manifest.libraryId)
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      starredIds: previous.starredIds,
      composerOpen: previous.composerOpen,
      closeTradeRequest: previous.closeTradeRequest,
    })
    useShortcutStore.setState({
      lightbox: previousShortcuts.lightbox,
      cmdkOpen: previousShortcuts.cmdkOpen,
      dataIOOpen: previousShortcuts.dataIOOpen,
    })
  }
}

window.__reviewSessionFlowTest = run()
