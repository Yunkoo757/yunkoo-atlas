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
  note: '<p>秘密结论：等待回踩确认。</p><img src="journal-asset://missing-review-chart">',
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
      () => document.body.textContent?.includes('将开始 1 张') === true,
      '随机复盘没有显示实时牌池数量',
    )
    findButton('开始复盘')?.click()
    await waitFor(
      () => Boolean(document.querySelector('.review-session-card.is-front')),
      '开始后没有进入卡片正面',
    )
    await waitFor(
      () => document.activeElement?.hasAttribute('data-review-session-focus') === true,
      '开始复盘后没有把焦点移入卡片',
    )
    const frontCard = document.querySelector<HTMLButtonElement>('.review-session-card.is-front')
    assert(frontCard?.hasAttribute('aria-labelledby'), '正面卡片必须关联可见交易信息作为名称')
    assert(!frontCard?.hasAttribute('aria-label'), '正面卡片不得用简略 aria-label 覆盖可见信息')
    assert(!document.body.textContent?.includes('秘密结论'), '卡片正面 DOM 不得包含笔记正文')
    assert(!document.querySelector('.review-session-card.is-front img'), '卡片正面 DOM 不得包含笔记图片')

    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    }))
    await waitFor(
      () => document.body.textContent?.includes('秘密结论') === true,
      'Space 没有翻面并按需载入笔记',
    )
    await waitFor(
      () => document.activeElement?.hasAttribute('data-review-session-focus') === true,
      '翻面后没有把焦点移到可连续使用快捷键的卡片容器',
    )
    assert(
      document.body.textContent?.includes('图片附件缺失'),
      '图片读取失败应显示可继续复盘的缺失占位',
    )

    const openDetail = findButton('打开详情')
    assert(openDetail, '复盘卡背面缺少详情入口')
    openDetail.focus()
    const buttonSpaceAccepted = openDetail.dispatchEvent(new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    }))
    assert(buttonSpaceAccepted, '按钮获得焦点时 Space 不得被全局翻面快捷键消费')
    assert(document.body.textContent?.includes('秘密结论'), '按钮 Space 不得意外翻回卡片正面')

    openDetail.click()
    await waitFor(() => Boolean(document.querySelector('[data-detail-probe]')), '没有进入交易详情')
    assert(document.body.textContent?.includes('/review-session'), '详情来源没有记录随机复盘')
    findButton('返回复盘')?.click()
    await waitFor(
      () => document.body.textContent?.includes('秘密结论') === true,
      '从详情返回后没有恢复同一张卡及翻面状态',
    )
    assert(loadReviewSession(manifest.libraryId)?.flipped === true, '翻面状态没有写入版本化会话')

    const shortcutTarget = document.activeElement ?? document.body
    const accepted = shortcutTarget.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'n',
      bubbles: true,
      cancelable: true,
    }))
    assert(!accepted, 'N 应在捕获阶段被随机复盘消费')
    await waitFor(
      () => loadReviewSession(manifest.libraryId)?.cursor === 1,
      'N 没有推进并保存会话游标',
    )
    assert(!useStore.getState().composerOpen, '随机复盘中的 N 不得触发全局新建交易')
    await waitFor(
      () => document.body.textContent?.includes('本轮完成') === true,
      'N 没有进入下一张或完成本轮',
    )
    await waitFor(
      () => document.activeElement?.hasAttribute('data-review-session-finished-focus') === true,
      '完成本轮后没有把焦点移到完成状态',
    )
    assert(document.querySelector('[data-review-session-finished-focus]')?.getAttribute('role') === 'status', '完成状态必须向读屏播报')
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
