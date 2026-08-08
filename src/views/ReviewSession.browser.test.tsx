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
    __atlasBrowserAllowedErrors?: string[]
  }
}

window.__atlasBrowserAllowedErrors = [
  'Persist failed OperationalError: Snapshot references missing asset: missing-review-chart',
]

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
  closedTradingDayKey: '2026-07-16',
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
  const accountTrade = trade
  const reviewCase: Trade = {
    ...trade,
    id: 'review-session-case',
    ref: 'CAS-RANDOM-1',
    symbol: 'SOLUSDT',
    tradeKind: 'case',
    caseType: 'exemplar',
    masteryState: 'new',
    nextReviewAt: null,
    note: '<p>案例结论：等待结构确认。</p>',
  }
  useStore.setState({
    trades: [accountTrade, reviewCase],
    strategies: [strategy],
    starredIds: [],
    composerOpen: false,
    closeTradeRequest: null,
  })
  useShortcutStore.setState({
    lightbox: null,
    cmdkOpen: false,
    modalOverlayCount: 0,
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
    assert(!document.querySelector('.review-session-source-grid'), '开始页不得直接暴露来源表单')
    assert(!document.querySelector('.review-session-options'), '开始页不得直接暴露高级选项')
    assert(findButton('开启一轮新的复盘'), '开始页缺少单一主操作')

    findButton('更多')?.click()
    await waitFor(() => Boolean(findButton('复盘设置')), '更多菜单没有提供复盘设置')
    findButton('复盘设置')?.click()
    await waitFor(() => document.body.textContent?.includes('只影响接下来开启的这一轮复盘。') === true, '没有打开复盘设置')
    const sourceInputs = [...document.querySelectorAll<HTMLInputElement>('.review-session-settings-sources input[type="checkbox"]')]
    assert(sourceInputs.length === 2, '复盘设置缺少来源选项')
    assert(sourceInputs[1]?.checked === false, '账户交易默认必须未选中')
    sourceInputs[1]?.click()
    findButton('应用设置')?.click()
    await waitFor(() => document.body.textContent?.includes('可随机复盘 2 条') === true, '启用账户交易后预览没有包含两条记录')

    findButton('更多')?.click()
    await waitFor(() => Boolean(findButton('复盘设置')), '更多菜单没有再次提供复盘设置')
    findButton('复盘设置')?.click()
    await waitFor(() => document.body.textContent?.includes('只影响接下来开启的这一轮复盘。') === true, '没有再次打开复盘设置')
    const reopenedSourceInputs = [...document.querySelectorAll<HTMLInputElement>('.review-session-settings-sources input[type="checkbox"]')]
    assert(reopenedSourceInputs[1]?.checked === true, '应用后的账户交易设置没有保留到当前视图')
    reopenedSourceInputs[1]?.click()
    const contentOnlyInput = document.querySelector<HTMLInputElement>('.review-session-content-toggle input[type="checkbox"]')
    assert(contentOnlyInput?.checked === false, '仅含有效图文默认必须未选中')
    contentOnlyInput.click()
    findButton('应用设置')?.click()
    await waitFor(() => document.body.textContent?.includes('可随机复盘 1 条') === true, '关闭账户交易后预览没有恢复案例数量')

    findButton('开启一轮新的复盘')?.click()
    await waitFor(
      () => Boolean(document.querySelector('.review-session-workspace')),
      '开始后没有直接打开完整交易',
    )
    assert(loadReviewSession(manifest.libraryId)?.filters.includeAccountTrades === false,
      '非默认轮次快照不得包含账户交易')
    assert(loadReviewSession(manifest.libraryId)?.filters.requireContent === true,
      '非默认轮次快照必须保留仅含有效图文设置')
    assert(loadReviewSession(manifest.libraryId)?.ids.join(',') === reviewCase.id,
      '默认一键开始只能建立案例队列')
    await waitFor(
      () => document.activeElement?.hasAttribute('data-review-session-focus') === true,
      '开始复盘后没有把焦点移入当前交易',
    )
    await waitFor(
      () => document.body.textContent?.includes('案例结论') === true,
      '完整交易没有直接显示复盘正文',
    )
    assert(!document.querySelector('.review-session-card.is-front, .review-session-card.is-back'), '随机复盘不得再出现正反面卡片')

    const openDetail = findButton('打开详情')
    assert(openDetail, '完整复盘缺少详情入口')
    openDetail.focus()
    const buttonSpaceAccepted = openDetail.dispatchEvent(new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    }))
    assert(buttonSpaceAccepted, '按钮获得焦点时 Space 必须保留原生激活行为')
    assert(document.body.textContent?.includes('案例结论'), '按钮 Space 不得推进当前交易')

    openDetail.click()
    await waitFor(() => Boolean(document.querySelector('[data-detail-probe]')), '没有进入交易详情')
    assert(document.body.textContent?.includes('/review-session'), '详情来源没有记录随机复盘')
    findButton('返回复盘')?.click()
    await waitFor(
      () => document.body.textContent?.includes('案例结论') === true,
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
      () => loadReviewSession(manifest.libraryId)?.assessments[reviewCase.id] === 'recheck',
      '基本理解没有写入会话结果',
    )
    const assessed = useStore.getState().trades.find((item) => item.id === reviewCase.id)
    assert(assessed?.masteryState === 'recheck', '评估没有写回记录掌握度')
    assert(Boolean(assessed.nextReviewAt), '基本理解没有生成复看计划')
    assert(
      assessed?.reviewStatus === 'unreviewed' && assessed.reviewCategory === 'recheck',
      '案例评估必须同步更新案例复盘状态与分类',
    )
    const untouchedAccountTrade = useStore.getState().trades.find((item) => item.id === accountTrade.id)
    assert(
      untouchedAccountTrade?.reviewStatus === 'reviewed' && untouchedAccountTrade.reviewCategory === 'normal',
      '未入队的账户交易不得被案例评估改写',
    )
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
    assert(loadReviewSession(manifest.libraryId)?.filters.includeAccountTrades === false,
      '再随机一轮必须沿用已完成轮次的筛选条件')
    assert(loadReviewSession(manifest.libraryId)?.filters.requireContent === true,
      '再随机一轮不得把非默认筛选快照硬编码回默认值')
    const beforeNoOpAssessment = JSON.stringify(
      useStore.getState().trades.find((item) => item.id === reviewCase.id),
    )
    const undoCountBeforeNoOp = useStore.getState().undoStack.length
    const repeatedAssessmentAccepted = (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
      key: '2',
      bubbles: true,
      cancelable: true,
    }))
    assert(!repeatedAssessmentAccepted, '重复评估仍应被随机复盘消费')
    await waitFor(() => loadReviewSession(manifest.libraryId)?.cursor === 1, '无字段变化的重复评估仍必须推进队列')
    assert(useStore.getState().undoStack.length === undoCountBeforeNoOp, '无字段变化的评估不得伪造 UndoAction')

    const backFromFinished = findButton('上一条')
    assert(backFromFinished, '完成页必须允许返回上一条 no-op 评估')
    backFromFinished.click()
    await waitFor(() => loadReviewSession(manifest.libraryId)?.cursor === 0, 'no-op 评估返回时没有恢复队列位置')
    assert(JSON.stringify(
      useStore.getState().trades.find((item) => item.id === reviewCase.id),
    ) === beforeNoOpAssessment, '返回 no-op 评估不得改写队列中的目标案例')

    const skipAccepted = (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'n',
      bubbles: true,
      cancelable: true,
    }))
    assert(!skipAccepted, 'N 应在捕获阶段执行跳过')
    await waitFor(() => loadReviewSession(manifest.libraryId)?.cursor === 1, 'N 没有跳过当前记录')
    assert(!useStore.getState().composerOpen, '随机复盘中的 N 不得触发全局新建交易')

    await waitFor(() => document.body.textContent?.includes('本轮完成') === true, '跳过后没有完成当前轮次')
    findButton('重新设置')?.click()
    await waitFor(() => document.body.textContent?.includes('只影响接下来开启的这一轮复盘。') === true, '重新设置没有打开同一个对话框')
    await waitFor(
      () => document.querySelector('.modal-shell')?.contains(document.activeElement) === true,
      '重新设置后焦点必须进入对话框',
    )
    const resetSourceInputs = [...document.querySelectorAll<HTMLInputElement>('.review-session-settings-sources input[type="checkbox"]')]
    const resetContentOnlyInput = document.querySelector<HTMLInputElement>('.review-session-content-toggle input[type="checkbox"]')
    assert(resetSourceInputs[1]?.checked === false, '重新设置必须恢复完成轮次的账户交易快照')
    assert(resetContentOnlyInput?.checked === true, '重新设置必须恢复完成轮次的非默认图文快照')
    resetSourceInputs[1]?.click()
    resetContentOnlyInput.click()
    findButton('取消')?.click()
    await waitFor(() => Boolean(findButton('开启一轮新的复盘')), '取消重新设置后没有返回开始页')
    assert(document.body.textContent?.includes('可随机复盘 1 条') === true, '取消重新设置不得提交草稿')

    findButton('更多')?.click()
    await waitFor(() => Boolean(findButton('复盘设置')), '取消后更多菜单没有继续提供复盘设置')
    findButton('复盘设置')?.click()
    await waitFor(() => document.querySelector('.modal-shell')?.contains(document.activeElement) === true,
      '取消后再次打开设置没有恢复焦点')
    const cancelledSourceInputs = [...document.querySelectorAll<HTMLInputElement>('.review-session-settings-sources input[type="checkbox"]')]
    const cancelledContentOnlyInput = document.querySelector<HTMLInputElement>('.review-session-content-toggle input[type="checkbox"]')
    assert(cancelledSourceInputs[1]?.checked === false, '取消后账户交易草稿污染了完成轮次快照')
    assert(cancelledContentOnlyInput?.checked === true, '取消后图文草稿污染了完成轮次快照')
  } finally {
    root.unmount()
    clearReviewSessionStorage(manifest.libraryId)
    useStore.setState({
      trades: previous.trades,
      strategies: previous.strategies,
      starredIds: previous.starredIds,
      undoStack: previous.undoStack,
      redoStack: previous.redoStack,
      composerOpen: previous.composerOpen,
      closeTradeRequest: previous.closeTradeRequest,
    })
    useShortcutStore.setState({
      lightbox: previousShortcuts.lightbox,
      cmdkOpen: previousShortcuts.cmdkOpen,
      modalOverlayCount: previousShortcuts.modalOverlayCount,
    })
  }
}

window.__reviewSessionFlowTest = run()
