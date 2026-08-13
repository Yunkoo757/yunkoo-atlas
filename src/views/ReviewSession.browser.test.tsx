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
import { ImageLightbox } from '@/components/ImageLightbox'
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
    <>
      <Routes>
        <Route path="/review-session" element={<ReviewSessionView />} />
        <Route path="/trade/:id" element={<DetailProbe />} />
      </Routes>
      <ImageLightbox />
    </>
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
    note: '<p>案例结论：等待结构确认。</p><p>执行要求：只在回踩确认后进入。</p>',
  }
  const futureReviewCase: Trade = {
    ...reviewCase,
    id: 'review-session-future-case',
    ref: 'CAS-RANDOM-FUTURE',
    nextReviewAt: '2099-01-01',
  }
  useStore.setState({
    trades: [accountTrade, reviewCase, futureReviewCase],
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
    const timingSelect = document.querySelector<HTMLButtonElement>('[aria-label="复盘时间范围"]')
    assert(timingSelect, '复盘设置缺少时间范围')
    assert(timingSelect.textContent?.includes('到期案例'), '复盘设置必须默认明确显示到期案例')
    timingSelect.click()
    await waitFor(() => Boolean(findButton('全部案例（含未到期与已掌握）')), '复盘设置缺少全部案例时间范围')
    findButton('全部案例（含未到期与已掌握）')?.click()
    await waitFor(() => document.body.textContent?.includes('当前设置可复盘 2 条') === true, '全部案例范围没有包含未来案例')
    useStore.setState({ trades: [accountTrade, reviewCase] })
    await waitFor(
      () => document.body.textContent?.includes('当前设置可复盘 1 条') === true,
      '移除未来案例后全部范围数量没有刷新',
    )
    const refreshedSourceInputs = [...document.querySelectorAll<HTMLInputElement>('.review-session-settings-sources input[type="checkbox"]')]
    refreshedSourceInputs[1]?.click()
    await waitFor(() => refreshedSourceInputs[1]?.checked === true, '账户交易来源没有启用')
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
    const reading = document.querySelector<HTMLElement>('.review-session-reading')?.getBoundingClientRect()
    const assessment = document.querySelector<HTMLElement>('.review-session-assessment')?.getBoundingClientRect()
    assert(reading && assessment, '短内容复盘必须同时呈现阅读区与评估区')
    assert(assessment.top - reading.bottom <= 240, '短内容的评估区不得与正文脱节超过 240px')
    assert(!document.querySelector('.review-session-card.is-front, .review-session-card.is-back'), '随机复盘不得再出现正反面卡片')

    const unfamiliarButton = document.querySelector<HTMLButtonElement>('.review-session-assessment-actions .is-unfamiliar')
    const skipButton = document.querySelector<HTMLButtonElement>('.review-session-assessment-actions .review-session-skip')
    assert(unfamiliarButton, '随机复盘缺少还没掌握动作')
    assert(skipButton, '随机复盘缺少跳过动作')
    assert(
      unfamiliarButton.getAttribute('aria-label') === '还没掌握，3 天后再看（1）',
      '默认掌握度 accessible name 必须同时保留评估标签、后果说明和真实快捷键',
    )

    useShortcutStore.getState().openLightbox([
      'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22200%22%3E%3Crect width=%22400%22 height=%22200%22 fill=%22%235e6ad2%22/%3E%3C/svg%3E',
    ], 0)
    await waitFor(() => Boolean(useShortcutStore.getState().lightbox), '随机复盘没有打开真实灯箱')
    const beforeLightboxShortcut = JSON.stringify(useStore.getState().trades.find((item) => item.id === reviewCase.id))
    const beforeLightboxCursor = loadReviewSession(manifest.libraryId)?.cursor
    for (const key of ['1', '2', '3', 'n', 'p']) {
      const acceptedWhileLightbox = (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      }))
      assert(acceptedWhileLightbox, `灯箱打开时 ${key} 不得被背景随机复盘动作消费`)
    }
    assert(
      JSON.stringify(useStore.getState().trades.find((item) => item.id === reviewCase.id)) === beforeLightboxShortcut,
      '灯箱打开时 1/2/3 不得写入背景案例字段',
    )
    assert(loadReviewSession(manifest.libraryId)?.cursor === beforeLightboxCursor, '灯箱打开时 N/P 不得移动背景游标')
    const closeAccepted = (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }))
    assert(!closeAccepted, '灯箱自身 Escape 快捷键必须继续工作')
    await waitFor(() => useShortcutStore.getState().lightbox === null, '灯箱 Escape 没有关闭预览')

    useShortcutStore.setState({
      bindings: {
        'reviewSession.unfamiliar': { key: 'x' },
        'reviewSession.skip': null,
      },
    })
    await waitFor(
      () => unfamiliarButton.textContent?.includes('X') === true,
      '自定义掌握度快捷键没有更新可见提示',
    )
    assert(!unfamiliarButton.textContent?.includes('1'), '自定义绑定后不得继续显示旧默认键')
    assert(unfamiliarButton.getAttribute('aria-keyshortcuts') === 'X', '自定义绑定没有更新 aria-keyshortcuts')
    assert(
      unfamiliarButton.getAttribute('aria-label') === '还没掌握，3 天后再看（X）',
      '自定义绑定的 accessible name 必须保留评估标签、后果说明和真实快捷键',
    )
    await waitFor(
      () => !skipButton.querySelector('kbd'),
      '禁用跳过快捷键后仍显示旧默认键',
    )
    assert(!skipButton.hasAttribute('aria-keyshortcuts'), '禁用绑定后不得保留 aria-keyshortcuts')
    assert(skipButton.getAttribute('aria-label') === '跳过（未设置快捷键）', '禁用绑定应明确说明未设置快捷键')
    useShortcutStore.setState({
      bindings: {
        'reviewSession.unfamiliar': null,
        'reviewSession.skip': null,
      },
    })
    await waitFor(
      () => !unfamiliarButton.querySelector('kbd'),
      '禁用掌握度快捷键后仍显示旧默认键',
    )
    assert(!unfamiliarButton.hasAttribute('aria-keyshortcuts'), '禁用掌握度绑定后不得保留 aria-keyshortcuts')
    assert(
      unfamiliarButton.getAttribute('aria-label') === '还没掌握，3 天后再看（未设置快捷键）',
      '禁用绑定的 accessible name 必须保留评估标签与后果说明且不得伪造快捷键',
    )
    useShortcutStore.setState({ bindings: {} })
    await waitFor(
      () => unfamiliarButton.textContent?.includes('1') === true && skipButton.textContent?.includes('N') === true,
      '恢复默认绑定后随机复盘提示没有同步刷新',
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
    assert(document.body.textContent?.includes('掌握度已经写回记录') === true, '存在案例评估时完成文案必须说明掌握度已写回')

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

    cancelledSourceInputs[0]?.click()
    cancelledSourceInputs[1]?.click()
    findButton('应用设置')?.click()
    await waitFor(() => document.body.textContent?.includes('可随机复盘 1 条') === true, '账户交易单独范围数量不准确')
    findButton('开启一轮新的复盘')?.click()
    await waitFor(() => document.body.textContent?.includes(accountTrade.ref) === true, '账户交易没有进入随机复盘')
    assert(!findButton('还没掌握') && !findButton('基本理解') && !findButton('已经掌握'),
      '账户交易不得渲染案例掌握度按钮')
    assert(findButton('提炼为案例'), '账户交易缺少提炼为案例动作')
    const accountNextButton = document.querySelector<HTMLButtonElement>('.review-session-account-actions .review-session-skip')
    assert(accountNextButton, '账户交易缺少下一条动作')
    assert(accountNextButton.querySelector('kbd')?.textContent === 'N', '账户下一条必须显示默认快捷键提示')
    assert(accountNextButton.getAttribute('aria-keyshortcuts') === 'N', '账户下一条默认 aria-keyshortcuts 必须真实')
    useShortcutStore.setState({ bindings: { 'reviewSession.skip': { key: 'x' } } })
    await waitFor(() => accountNextButton.querySelector('kbd')?.textContent === 'X', '账户下一条改绑后可见提示没有更新')
    assert(!accountNextButton.textContent?.includes('N'), '账户下一条改绑后不得显示旧默认键')
    assert(accountNextButton.getAttribute('aria-keyshortcuts') === 'X', '账户下一条改绑后 aria-keyshortcuts 没有更新')
    useShortcutStore.setState({ bindings: { 'reviewSession.skip': null } })
    await waitFor(() => !accountNextButton.querySelector('kbd'), '账户下一条禁用绑定后仍显示伪造快捷键')
    assert(!accountNextButton.hasAttribute('aria-keyshortcuts'), '账户下一条禁用绑定后不得保留 aria-keyshortcuts')
    assert(accountNextButton.getAttribute('aria-label') === '下一条（未设置快捷键）', '账户下一条禁用绑定必须明确说明未设置快捷键')
    useShortcutStore.setState({ bindings: {} })
    await waitFor(() => accountNextButton.querySelector('kbd')?.textContent === 'N', '账户下一条恢复默认绑定后提示没有更新')
    const caseCountBeforeExtraction = useStore.getState().trades.filter((item) => item.tradeKind === 'case').length
    findButton('提炼为案例')?.click()
    await waitFor(
      () => useStore.getState().trades.filter((item) => item.tradeKind === 'case').length === caseCountBeforeExtraction + 1,
      '账户交易没有调用当前提炼路径创建案例',
    )
    const accountAfterExtraction = useStore.getState().trades.find((item) => item.id === accountTrade.id)
    assert(accountAfterExtraction?.caseType === undefined && accountAfterExtraction?.masteryState === undefined && accountAfterExtraction?.nextReviewAt === undefined,
      '账户交易提炼动作不得写入案例掌握字段')
    accountNextButton.click()
    await waitFor(() => document.body.textContent?.includes('本轮完成') === true, '账户交易下一条没有完成本轮')
    assert(!document.body.textContent?.includes('掌握度已经写回记录'), '账户专属轮次不得声称掌握度已写回')
    assert(document.body.textContent?.includes('本轮没有写入案例掌握度') === true, '账户专属轮次必须显示真实的未写入文案')
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
      bindings: previousShortcuts.bindings,
      lightbox: previousShortcuts.lightbox,
      cmdkOpen: previousShortcuts.cmdkOpen,
      modalOverlayCount: previousShortcuts.modalOverlayCount,
    })
  }
}

window.__reviewSessionFlowTest = run()
