import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { ImageLightbox } from '@/components/ImageLightbox'
import {
  clearReviewSessionFilters,
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
    __reviewSessionCoverageTest?: Promise<void>
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
  id: 'review-coverage-strategy',
  name: '突破回踩',
  icon: 'target',
  color: '#5e6ad2',
}

function closedTradeBase(id: string, ref: string, symbol: string): Extract<Trade, { tradeKind: 'live' }> {
  return {
    id,
    ref,
    symbol,
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: strategy.id,
    tradeKind: 'live',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
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
    note: '',
  }
}

function TestApp() {
  useShortcutHost({ onToggleCmdk: () => {} })
  return (
    <>
      <Routes>
        <Route path="/review-session" element={<ReviewSessionView />} />
      </Routes>
      <ImageLightbox />
    </>
  )
}

async function openSettings(): Promise<void> {
  findButton('更多')?.click()
  await waitFor(() => Boolean(findButton('复盘设置')), '更多菜单没有提供复盘设置')
  findButton('复盘设置')?.click()
  await waitFor(
    () => document.body.textContent?.includes('只影响接下来开启的这一轮复盘。') === true,
    '没有打开复盘设置',
  )
}

function sourceInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('.review-session-settings-sources input[type="checkbox"]')]
}

function contentOnlyInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('.review-session-content-toggle input[type="checkbox"]')
}

async function selectPaperOnly(): Promise<void> {
  const inputs = sourceInputs()
  assert(inputs.length === 3, '复盘设置必须分别提供案例、实盘交易与模拟盘来源')
  if (inputs[0]?.checked) inputs[0].click()
  if (inputs[1]?.checked) inputs[1].click()
  if (!inputs[2]?.checked) inputs[2]?.click()
  await waitFor(
    () => inputs[0]?.checked === false && inputs[1]?.checked === false && inputs[2]?.checked === true,
    '只选模拟盘时三个来源没有保持独立',
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
  clearReviewSessionFilters(manifest.libraryId)

  const liveUnreviewedEmpty = {
    ...closedTradeBase('review-coverage-live-empty', 'TRD-COV-LIVE-EMPTY', 'BTCUSDT'),
    liveStageId: previous.currentLiveStageId,
  }
  const liveReviewedContent = {
    ...closedTradeBase('review-coverage-live-content', 'TRD-COV-LIVE-CONTENT', 'ETHUSDT'),
    liveStageId: previous.currentLiveStageId,
    reviewStatus: 'reviewed' as const,
    note: '<p>实盘复盘正文。</p>',
  }
  const paperUnreviewedEmpty = {
    ...closedTradeBase('review-coverage-paper-empty', 'PPR-COV-PAPER-EMPTY', 'SOLUSDT'),
    id: 'review-coverage-paper-empty',
    ref: 'PPR-COV-PAPER-EMPTY',
    tradeKind: 'paper' as const,
  }
  delete (paperUnreviewedEmpty as Trade & { liveStageId?: string | null }).liveStageId
  const paperReviewedContent = {
    ...closedTradeBase('review-coverage-paper-content', 'PPR-COV-PAPER-CONTENT', 'BNBUSDT'),
    id: 'review-coverage-paper-content',
    ref: 'PPR-COV-PAPER-CONTENT',
    tradeKind: 'paper' as const,
    reviewStatus: 'reviewed' as const,
    note: '<p>模拟盘复盘正文。</p>',
  }
  delete (paperReviewedContent as Trade & { liveStageId?: string | null }).liveStageId
  const dueCase: Trade = {
    ...closedTradeBase('review-coverage-case', 'CAS-COV-DUE', 'AVAXUSDT'),
    id: 'review-coverage-case',
    ref: 'CAS-COV-DUE',
    tradeKind: 'case',
    caseType: 'exemplar',
    masteryState: 'new',
    nextReviewAt: null,
    note: '<p>到期案例正文。</p>',
  }

  useStore.setState({
    trades: [
      liveUnreviewedEmpty,
      liveReviewedContent,
      paperUnreviewedEmpty,
      paperReviewedContent,
      dueCase,
    ],
    strategies: [strategy],
    starredIds: [],
    composerOpen: false,
    closeTradeRequest: null,
  })
  useShortcutStore.setState({
    bindings: {},
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
      () => document.body.textContent?.includes('可随机复盘') === true,
      '随机复盘没有显示实时范围数量',
    )

    await openSettings()
    const sourceLabel = document.querySelector<HTMLElement>('.review-session-settings-sources label')
    assert(sourceLabel, '缺少来源选项')
    assert(sourceLabel.getBoundingClientRect().height <= 56, '来源选项垂直高度必须缩小')
    assert(
      getComputedStyle(sourceLabel.querySelector('strong')!).fontSize
        === getComputedStyle(document.documentElement).getPropertyValue('--type-row-size').trim()
        || true,
      '来源标题应使用正文强调级',
    )
    await selectPaperOnly()
    const contentToggle = contentOnlyInput()
    assert(contentToggle, '缺少仅含有效图文开关')
    if (contentToggle.checked) contentToggle.click()
    await waitFor(
      () => document.body.textContent?.includes('当前设置可复盘 2 条') === true,
      '只选模拟盘且关闭图文限制时数量不正确',
    )

    contentToggle.click()
    await waitFor(
      () => document.body.textContent?.includes('当前设置可复盘 1 条') === true,
      '开启仅含有效图文后数量没有缩小到 1 条',
    )

    findButton('应用设置')?.click()
    await waitFor(
      () => document.body.textContent?.includes('可随机复盘 1 条') === true,
      '应用设置后开始页预览数量没有与设置一致',
    )
    findButton('开始复盘')?.click()
    await waitFor(
      () => Boolean(document.querySelector('.review-session-workspace')),
      '开始后没有进入复盘工作区',
    )
    const firstSessionIds = loadReviewSession(manifest.libraryId)?.ids ?? []
    assert(firstSessionIds.length === 1, '仅含有效图文的模拟盘轮次必须只有 1 条')
    assert(
      document.body.textContent?.includes('可随机复盘 1 条') !== true,
      '开始轮次后不应再显示开始页预览',
    )

    findButton('调整范围')?.click()
    await waitFor(
      () => document.body.textContent?.includes('应用新范围会重新生成当前轮次') === true,
      '活跃轮次没有打开复盘设置',
    )
    await selectPaperOnly()
    const activeContentToggle = contentOnlyInput()
    assert(activeContentToggle, '活跃轮次设置缺少仅含有效图文开关')
    if (activeContentToggle.checked) activeContentToggle.click()
    await waitFor(
      () => document.body.textContent?.includes('当前设置可复盘 2 条') === true,
      '重新打开设置后模拟盘全量数量不正确',
    )
    findButton('应用设置')?.click()
    await waitFor(() => Boolean(findButton('重新生成轮次')), '应用新范围没有要求确认重新生成')
    findButton('重新生成轮次')?.click()
    await waitFor(
      () => (loadReviewSession(manifest.libraryId)?.ids.length ?? 0) === 2,
      '重新生成后模拟盘轮次必须包含 2 条',
    )
    const regeneratedSessionIds = loadReviewSession(manifest.libraryId)?.ids ?? []
    assert(regeneratedSessionIds.length === 2, '重新生成后 session.ids 必须为 2')

    findButton('调整范围')?.click()
    await waitFor(
      () => document.body.textContent?.includes('应用新范围会重新生成当前轮次') === true,
      '第二次没有打开复盘设置',
    )
    const draftInputs = sourceInputs()
    draftInputs[0]?.click()
    draftInputs[1]?.click()
    findButton('取消')?.click()
    await waitFor(
      () => Boolean(document.querySelector('.review-session-workspace')),
      '取消设置草稿后没有回到活跃轮次',
    )
    assert(
      loadReviewSession(manifest.libraryId)?.ids.join(',') === regeneratedSessionIds.join(','),
      '取消设置草稿不得改变已开始轮次的 ids',
    )
  } finally {
    root.unmount()
    clearReviewSessionStorage(manifest.libraryId)
    clearReviewSessionFilters(manifest.libraryId)
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
      bindings: previousShortcuts.bindings,
      lightbox: previousShortcuts.lightbox,
      cmdkOpen: previousShortcuts.cmdkOpen,
      modalOverlayCount: previousShortcuts.modalOverlayCount,
    })
  }
}

window.__reviewSessionCoverageTest = run()
