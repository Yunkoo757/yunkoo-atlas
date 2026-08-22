import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import type { LiveStage } from '@/lib/liveStages'
import {
  clearReviewSessionStorage,
  loadReviewSession,
} from '@/lib/reviewSession'
import { bootstrapStorage, getStorage } from '@/storage'
import { useShortcutHost } from '@/shortcuts/ShortcutHost'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { ReviewSessionView } from '@/views/ReviewSessionView'

declare global {
  interface Window {
    __reviewSessionStageSourceTest?: Promise<void>
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

const archivedStage: LiveStage = {
  id: 'review-stage-archived',
  sequence: 1,
  name: '突破训练',
  status: 'archived',
  startsOn: '2026-01-01',
  endsOn: '2026-07-31',
  createdAt: '2026-01-01T00:00:00.000Z',
  archivedAt: '2026-08-01T00:00:00.000Z',
}

const currentStage: LiveStage = {
  id: 'review-stage-current',
  sequence: 2,
  name: '当前执行',
  status: 'current',
  startsOn: '2026-08-01',
  endsOn: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  archivedAt: null,
}

function reviewCase(id: string, ref: string, symbol: string, liveStageId: string): Trade {
  return {
    id,
    ref,
    symbol,
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'stage-source-strategy',
    tradeKind: 'case',
    caseType: 'exemplar',
    masteryState: 'new',
    nextReviewAt: null,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 100,
    rMultiple: 2,
    openedAt: '2026-07-01',
    closedAt: '2026-07-02',
    note: `<p>${symbol} 阶段复盘</p>`,
    liveStageId,
  }
}

function DetailProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  const from = (location.state as { from?: { pathname?: string } } | null)?.from
  return <button type="button" onClick={() => navigate(from?.pathname ?? '/review-session')}>返回随机复盘</button>
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
  const historical = reviewCase('historical-case', 'CAS-HISTORY', 'ETHUSDT', archivedStage.id)
  const current = reviewCase('current-case', 'CAS-CURRENT', 'BTCUSDT', currentStage.id)
  const currentTwo = reviewCase('current-case-two', 'CAS-CURRENT-2', 'XRPUSDT', currentStage.id)
  const pending = { ...reviewCase('pending-case', 'CAS-PENDING', 'SOLUSDT', currentStage.id), liveStageId: null }
  clearReviewSessionStorage(manifest.libraryId)
  useStore.setState({
    trades: [current, historical, currentTwo, pending],
    liveStages: [archivedStage, currentStage],
    currentLiveStageId: currentStage.id,
    strategies: [{ id: 'stage-source-strategy', name: '结构确认', icon: 'target', color: '#5e6ad2' }],
    starredIds: [],
    composerOpen: false,
    closeTradeRequest: null,
  })
  useShortcutStore.setState({ bindings: {}, lightbox: null, cmdkOpen: false, modalOverlayCount: 0 })

  const originalRandom = Math.random
  let randomValue = 0
  let traceRandom = false
  let regenerationShuffleCalls = 0
  Math.random = () => {
    if (traceRandom && new Error('random call').stack?.includes('shuffleReviewSessionIds')) {
      regenerationShuffleCalls += 1
    }
    return randomValue
  }
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
    await waitFor(() => document.body.textContent?.includes('可随机复盘 3 条') === true, '默认池没有覆盖当前与历史阶段')
    assert(document.body.textContent?.includes('当前阶段 + 全部历史'), '开始页没有显示默认阶段来源')
    assert(!document.body.textContent?.includes('CAS-PENDING'), '待整理案例不得进入复盘入口')
    assert(document.documentElement.scrollWidth <= window.innerWidth, `${window.innerWidth}px 开始页不得横向溢出`)

    findButton('更多')?.click()
    await waitFor(() => Boolean(findButton('复盘设置')), '更多菜单缺少复盘设置')
    findButton('复盘设置')?.click()
    await waitFor(() => Boolean(document.querySelector('button[aria-label="阶段来源"]')), '设置缺少阶段来源控件')
    const sourceSelect = document.querySelector<HTMLButtonElement>('button[aria-label="阶段来源"]')
    assert(sourceSelect, '设置缺少可操作的阶段来源按钮')
    assert(sourceSelect.textContent?.includes('当前阶段 + 全部历史'), '阶段来源控件默认值错误')
    const modalRect = document.querySelector<HTMLElement>('.modal-shell')?.getBoundingClientRect()
    assert(modalRect && modalRect.left >= 0 && modalRect.right <= window.innerWidth, `${window.innerWidth}px 设置弹层必须留在桌面视口内`)

    sourceSelect.click()
    await waitFor(() => Boolean(findButton('自选阶段')), '阶段来源缺少自选阶段')
    findButton('自选阶段')?.click()
    await waitFor(() => document.querySelectorAll<HTMLInputElement>('.review-session-stage-option input').length === 2, '自选阶段没有列出当前与历史阶段')
    const stageInputs = [...document.querySelectorAll<HTMLInputElement>('.review-session-stage-option input')]
    assert(stageInputs.every((input) => !input.checked), '切换到自选阶段不得自动选中任何阶段')
    assert(document.body.textContent?.includes('突破训练 · 已归档'), '历史阶段缺少名称与状态')
    assert(document.body.textContent?.includes('当前执行 · 当前阶段'), '当前阶段缺少名称与状态')
    assert(stageInputs.every((input) => input.tabIndex === 0), '多阶段复选框必须保持原生键盘焦点能力')
    stageInputs[0]?.focus()
    assert(document.activeElement === stageInputs[0], '历史阶段复选框不能通过键盘焦点访问')
    stageInputs[0]?.click()
    stageInputs[1]?.click()
    findButton('应用设置')?.click()
    await waitFor(() => document.body.textContent?.includes('可随机复盘 3 条') === true, '自选两个阶段没有生成精确候选池')

    findButton('开启一轮新的复盘')?.click()
    await waitFor(() => document.body.textContent?.includes('CAS-HISTORY') === true, '固定随机源没有先展示历史案例')
    assert(document.body.textContent?.includes('来源 · 突破训练'), '历史案例没有显示归档阶段来源标签')
    assert(loadReviewSession(manifest.libraryId)?.filters.stageSource instanceof Object, '自选阶段来源没有保存到活动轮次')

    const accepted = (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
      key: '3',
      bubbles: true,
      cancelable: true,
    }))
    assert(!accepted, '历史案例掌握度快捷键必须被复盘作用域消费')
    await waitFor(() => useStore.getState().trades.find((trade) => trade.id === historical.id)?.masteryState === 'mastered', '历史案例评估没有写回原实体')
    const assessedHistorical = useStore.getState().trades.find((trade) => trade.id === historical.id)
    assert(useStore.getState().trades.length === 4, '历史案例评估不得复制实体')
    assert(
      assessedHistorical?.tradeKind === 'case' &&
        assessedHistorical.id === historical.id &&
        assessedHistorical.liveStageId === archivedStage.id,
      '历史案例评估不得移动或改写阶段归属',
    )
    await waitFor(() => loadReviewSession(manifest.libraryId)?.cursor === 1, '历史评估后活动轮次游标没有推进到当前阶段案例')

    findButton('调整范围')?.click()
    await waitFor(() => Boolean(document.querySelector('button[aria-label="阶段来源"]')), '活动轮次无法打开范围设置')
    assert(document.body.textContent?.includes('应用新范围会重新生成当前轮次'), '活动轮次设置没有进入丢弃进度确认语义')
    assert(
      document.querySelector<HTMLElement>('[data-active-stage-source]')?.dataset.activeStageSource === 'custom',
      `活动轮次来源快照错误：${document.querySelector<HTMLElement>('[data-active-stage-source]')?.dataset.activeStageSource ?? 'missing'}`,
    )
    document.querySelector<HTMLButtonElement>('button[aria-label="阶段来源"]')?.click()
    await waitFor(() => Boolean(findButton('仅当前阶段')), '活动轮次设置缺少仅当前阶段')
    findButton('仅当前阶段')?.click()
    await waitFor(
      () => document.querySelector<HTMLButtonElement>('button[aria-label="阶段来源"]')?.textContent?.includes('仅当前阶段') === true,
      '活动轮次来源选择没有提交到设置草稿',
    )
    const sessionKey = `yunkoo-atlas:review-session:v2:${encodeURIComponent(manifest.libraryId)}`
    const activeBeforeConfirmation = JSON.stringify(loadReviewSession(manifest.libraryId))
    const persistedBeforeConfirmation = sessionStorage.getItem(sessionKey)
    const activeApply = findButton('应用设置')
    assert(activeApply && !activeApply.disabled, '活动轮次设置缺少可用的应用按钮')
    activeApply.click()
    await waitFor(
      () => document.querySelector('[role="dialog"] h2')?.textContent?.trim() === '重新生成当前轮次？',
      '活动轮次来源切换没有打开项目统一确认弹层',
    )
    assert(document.body.textContent?.includes('本轮已评进度会被丢弃'), '确认弹层没有清楚说明丢弃进度后果')
    await waitFor(() => document.activeElement?.textContent?.trim() === '保留当前轮次', '确认弹层没有优先聚焦安全取消动作')
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(escape)
    assert(escape.defaultPrevented, '确认弹层必须消费 Escape')
    await waitFor(
      () => document.querySelector('[role="dialog"] h2')?.textContent?.trim() === '复盘设置',
      'Escape 取消后没有返回原设置草稿',
    )
    assert(JSON.stringify(loadReviewSession(manifest.libraryId)) === activeBeforeConfirmation, 'Escape 取消不得改变活动轮次')
    assert(sessionStorage.getItem(sessionKey) === persistedBeforeConfirmation, 'Escape 取消不得写入持久化会话')
    assert(
      document.querySelector<HTMLButtonElement>('button[aria-label="阶段来源"]')?.textContent?.includes('仅当前阶段') === true,
      'Escape 取消不得丢失待确认的设置草稿',
    )
    await waitFor(() => document.activeElement === findButton('应用设置'), 'Escape 取消后没有把焦点恢复到设置应用动作')

    findButton('应用设置')?.click()
    await waitFor(() => Boolean(findButton('保留当前轮次')), '设置草稿无法再次进入确认弹层')
    findButton('保留当前轮次')?.click()
    await waitFor(
      () => document.querySelector('[role="dialog"] h2')?.textContent?.trim() === '复盘设置',
      '显式取消后没有返回原设置草稿',
    )
    assert(JSON.stringify(loadReviewSession(manifest.libraryId)) === activeBeforeConfirmation, '显式取消不得改变活动轮次')
    assert(sessionStorage.getItem(sessionKey) === persistedBeforeConfirmation, '显式取消不得写入持久化会话')
    assert(document.body.textContent?.includes('CAS-CURRENT-2'), '取消确认不得改变当前活动条目')

    findButton('应用设置')?.click()
    await waitFor(() => Boolean(findButton('重新生成轮次')), '第三次应用没有打开确认弹层')
    const confirmationForm = document.querySelector<HTMLFormElement>('#review-session-regeneration-confirm-form')
    const confirmRegeneration = findButton('重新生成轮次')
    assert(confirmationForm && confirmRegeneration, '确认弹层缺少可提交表单或明确确认动作')
    assert(
      confirmRegeneration.type === 'submit' && confirmRegeneration.getAttribute('form') === confirmationForm.id,
      '确认动作必须使用可由 Enter 提交的原生表单语义',
    )
    confirmRegeneration.focus()
    assert(document.activeElement === confirmRegeneration, '确认动作必须可通过键盘焦点到达')
    const confirmEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    confirmRegeneration.dispatchEvent(confirmEnter)
    assert(!confirmEnter.defaultPrevented, '确认动作不得阻止原生 Enter 表单提交语义')
    randomValue = 0.999
    traceRandom = true
    confirmationForm.requestSubmit(confirmRegeneration)
    confirmationForm.requestSubmit(confirmRegeneration)
    await waitFor(
      () => document.querySelector('[role="dialog"]')?.getAttribute('aria-busy') === 'true',
      '确认提交后没有进入 busy 状态',
    )
    assert(confirmRegeneration.disabled, 'busy 时确认动作必须禁用以防重复应用')
    const busyEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(busyEscape)
    assert(busyEscape.defaultPrevented, 'busy 时确认弹层仍必须消费 Escape')
    assert(document.querySelector('[role="dialog"]'), 'busy 时 Escape 不得关闭确认弹层')
    await waitFor(() => !document.querySelector('.modal-shell'), '确认切换来源后设置弹层没有关闭')
    await waitFor(() => document.body.textContent?.includes('CAS-CURRENT') === true, '确认切换来源后没有展示当前阶段队列')
    await waitFor(() => loadReviewSession(manifest.libraryId)?.filters.stageSource === 'current',
      `确认切换来源后没有持久化新阶段来源：${sessionStorage.getItem(sessionKey)}`)
    assert(
      new Set(loadReviewSession(manifest.libraryId)?.ids).size === 2 &&
        loadReviewSession(manifest.libraryId)?.ids.every((id) => id === current.id || id === currentTwo.id),
      `确认切换来源后队列错误：${loadReviewSession(manifest.libraryId)?.ids.join(',') ?? 'null'}`,
    )
    assert(regenerationShuffleCalls === 1, `双重提交只能随机并再生成一次活动轮次：${regenerationShuffleCalls}`)
    traceRandom = false
    await waitFor(
      () => document.activeElement === document.querySelector('[data-review-session-focus]'),
      '确认再生成后没有把焦点恢复到新活动条目',
    )
    await waitFor(() => document.body.textContent?.includes('来源 · 当前阶段') === true, '当前阶段案例没有显示来源标签')

    findButton('打开详情')?.click()
    await waitFor(() => Boolean(findButton('返回随机复盘')), '没有进入详情探针')
    findButton('返回随机复盘')?.click()
    await waitFor(() => document.body.textContent?.includes('CAS-CURRENT') === true, '路由重载后没有恢复同一轮次')
    assert(loadReviewSession(manifest.libraryId)?.filters.stageSource === 'current', '路由重载后没有恢复阶段来源')

    findButton('调整范围')?.click()
    await waitFor(() => Boolean(document.querySelector('button[aria-label="阶段来源"]')), '恢复后无法再次调整来源')
    document.querySelector<HTMLButtonElement>('button[aria-label="阶段来源"]')?.click()
    await waitFor(() => Boolean(findButton('自选阶段')), '恢复后来源选项缺失')
    findButton('自选阶段')?.click()
    await waitFor(
      () => document.querySelectorAll<HTMLInputElement>('.review-session-stage-option input').length === 2,
      '恢复后切换自选阶段没有渲染空多选列表',
    )
    findButton('应用设置')?.click()
    await waitFor(() => Boolean(findButton('重新生成轮次')), '空自选变更没有进入确认弹层')
    findButton('重新生成轮次')?.click()
    await waitFor(() => !document.querySelector('[role="dialog"]'), '空自选确认后设置弹层没有关闭')
    await waitFor(() => Boolean(document.querySelector('.review-session-empty-selection')), '空自选没有呈现清晰筛选状态')
    await waitFor(() => loadReviewSession(manifest.libraryId)?.ids.length === 0, '空自选活动轮次没有持久化为空队列')
    assert(document.documentElement.scrollWidth <= window.innerWidth, `${window.innerWidth}px 空状态不得横向溢出`)

    findButton('重新选择阶段')?.click()
    await waitFor(() => Boolean(document.querySelector('button[aria-label="阶段来源"]')), '空状态无法重新打开阶段选择')
    document.querySelector<HTMLButtonElement>('button[aria-label="阶段来源"]')?.click()
    await waitFor(() => Boolean(findButton('仅当前阶段')), '空状态重新选择缺少仅当前阶段')
    findButton('仅当前阶段')?.click()
    await waitFor(
      () => document.querySelector<HTMLButtonElement>('button[aria-label="阶段来源"]')?.textContent?.includes('仅当前阶段') === true,
      '空状态重新选择没有提交当前阶段草稿',
    )
    findButton('应用设置')?.click()
    await waitFor(() => document.body.textContent?.includes('可随机复盘 2 条') === true, '空状态选择有效阶段后没有返回可开始状态')
    findButton('开启一轮新的复盘')?.click()
    await waitFor(() => document.body.textContent?.includes('来源 · 当前阶段') === true, '空状态恢复后无法开启当前阶段新轮次')
  } finally {
    root.unmount()
    Math.random = originalRandom
    clearReviewSessionStorage(manifest.libraryId)
    useStore.setState({
      trades: previous.trades,
      liveStages: previous.liveStages,
      currentLiveStageId: previous.currentLiveStageId,
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

window.__reviewSessionStageSourceTest = run()
