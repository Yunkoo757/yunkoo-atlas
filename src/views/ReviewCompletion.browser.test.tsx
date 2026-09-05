import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { DetailView } from '@/views/DetailView'
import { getStorage } from '@/storage/bootstrap'
import {
  hasNoteDraft,
  resetNoteDraftsForTests,
  setNoteDraft,
} from '@/storage/noteDrafts'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __reviewCompletionFlowTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

function findButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) =>
      button.textContent?.trim() === label ||
      button.getAttribute('aria-label') === label,
    )
}

const strategy: Strategy = {
  id: 'review-strategy',
  name: '复盘策略',
  icon: 'target',
  color: '#5e6ad2',
}

const trade: Trade = {
  id: 'review-template-trade',
  ref: 'TRD-REVIEW',
  symbol: 'BTCUSDT',
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
  note: '',
}

const raceTrade: Trade = {
  ...trade,
  id: 'review-race-trade',
  ref: 'TRD-REVIEW-RACE',
  note: '<p>完整复盘结论</p>',
}

const filledTrade: Trade = {
  ...trade,
  id: 'review-filled-trade',
  ref: 'TRD-REVIEW-FILLED',
  note: '<p>这笔交易追价，下次等待回踩确认。</p>',
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  let root = createRoot(rootElement)
  const storage = getStorage()
  const originalSaveAsset = storage.saveAsset.bind(storage)

  try {
    useStore.setState({ trades: [trade], strategies: [strategy] })
    root.render(
      <MemoryRouter initialEntries={['/trade/TRD-REVIEW']}>
        <Routes>
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => Boolean(findButton('完成复盘')), '完成复盘操作未出现')
    const pendingToolbar = document.querySelector<HTMLElement>('.dv-review-toolbar')
    const pendingState = document.querySelector<HTMLElement>('.dv-review-state')
    const completionAction = findButton('完成复盘')
    assert(pendingToolbar, '待复盘交易必须保留状态/动作工具行')
    assert(pendingState?.textContent?.trim() === '待复盘', '复盘状态没有独立显示为待复盘')
    assert(completionAction, '完成复盘操作未出现')
    assert(pendingToolbar.contains(completionAction), '完成复盘动作必须留在轻量工具行内')
    assert(completionAction.classList.contains('ui-btn-primary'), '完成复盘必须使用主按钮')
    assert(document.querySelector('.dv-topbar')?.contains(completionAction), '完成复盘必须在固定顶栏内随时可达')
    assert(!pendingState.contains(completionAction), '复盘状态与完成命令不得合并为同一节点')
    assert(document.querySelector('[aria-label="复盘正文"]'), '复盘正文编辑器缺少准确名称')
    assert(document.querySelector('[aria-label="补充追记"]'), '复盘追记输入框缺少准确名称')
    const detailMain = document.querySelector<HTMLElement>('.trade-detail-layout .dv-main')
    const detailProperties = document.querySelector<HTMLElement>('.trade-detail-layout .dv-props')
    assert(detailMain && detailProperties, '详情页缺少正文或属性区域')
    if (window.innerWidth <= 1200) {
      const propertiesToggle = document.querySelector<HTMLButtonElement>('button[aria-label="打开交易属性"]')
      assert(propertiesToggle && getComputedStyle(propertiesToggle).display !== 'none', '960px 紧凑桌面缺少属性抽屉入口')
      propertiesToggle.click()
      await waitFor(() => detailProperties.getAttribute('role') === 'dialog', '属性抽屉没有打开为模态面板')
      assert(detailProperties.getBoundingClientRect().width <= 336, '紧凑桌面属性抽屉不得扩张为底部面板')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await waitFor(() => detailProperties.getAttribute('role') !== 'dialog', 'Escape 没有关闭属性抽屉')
    } else {
      assert(detailMain.getBoundingClientRect().width >= 620, '宽屏复盘正文不足 620px')
      assert(Math.abs(detailProperties.getBoundingClientRect().width - 336) < 1, '宽屏属性栏没有稳定为 336px')
      const dividerWidth = getComputedStyle(detailProperties).borderLeftWidth
      assert(Math.abs(Number.parseFloat(dividerWidth) - 1) < 0.1, `正文与属性栏缺少 1px 分隔线：${dividerWidth}`)
      const beforeWidth = detailMain.getBoundingClientRect().width
      document.querySelector<HTMLButtonElement>('button[aria-label="关闭交易属性"]')?.click()
      await waitFor(() => getComputedStyle(detailProperties).display === 'none', '宽桌面属性栏无法收起')
      assert(detailMain.getBoundingClientRect().width > beforeWidth + 300, '收起属性后没有把空间让给正文')
      assert(useStore.getState().display.detailPropertiesVisible === false, '属性偏好没有保存到显示设置')
      document.querySelector<HTMLButtonElement>('button[aria-label="打开交易属性"]')?.click()
      await waitFor(() => getComputedStyle(detailProperties).display !== 'none', '属性栏无法重新展开')
    }
    findButton('完成复盘')?.click()
    await waitForFrame()
    assert(
      useStore.getState().trades[0]?.reviewStatus === 'unreviewed',
      '空白笔记不能直接完成复盘',
    )
    assert(!findButton('使用策略模板'), '详情页不应继续提供策略模板入口')
    assert(!findButton('使用复盘模板'), '详情页不应继续提供内置模板入口')

    root.unmount()
    resetNoteDraftsForTests()
    useStore.setState({ trades: [filledTrade, raceTrade] })
    useShortcutStore.getState().setListContext({
      listPath: '/list', listSearch: '', filter: { type: 'all', tradeKind: 'live' },
      orderedIds: [filledTrade.id, raceTrade.id],
    })
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/trade/TRD-REVIEW-FILLED']}>
        <Routes>
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => findButton('完成复盘')?.disabled === false,
      '已有复盘结论时完成操作仍不可用',
    )
    findButton('完成复盘')?.click()
    await waitFor(
      () => useStore.getState().trades[0]?.reviewStatus === 'reviewed',
      '写下复盘结论后仍无法完成复盘',
    )
    assert(!document.querySelector('.dv-review-toolbar'), '已复盘正文不得保留空工具行')
    assert(!document.querySelector('.dv-main')?.textContent?.includes('复盘正文'), '普通已复盘交易不得显示重复视觉标题')
    assert(document.querySelector('[aria-label="复盘正文"]'), '去除视觉标题后必须保留编辑器可访问名称')
    assert(!document.querySelector('.dv-review-stage'), '已完成状态不应继续占据正文首屏')
    assert(!document.querySelector('.dv-review-complete-action'), '已完成状态不应继续显示完成命令')
    assert(
      document.querySelector('.dv-review-complete-meta')?.textContent?.trim() === '已复盘',
      '已完成状态应收敛到顶部应用栏',
    )
    const nextPending = findButton('下一条待复盘')
    assert(nextPending && document.querySelector('.dv-topbar')?.contains(nextPending), '完成后缺少常驻下一条待复盘入口')
    document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')?.click()
    await waitFor(() => Boolean(findButton('重新复盘')), '更多菜单缺少重新复盘入口')
    findButton('重新复盘')?.click()
    await waitFor(
      () => useStore.getState().trades[0]?.reviewStatus === 'unreviewed',
      '顶部菜单无法重新打开复盘',
    )
    await waitFor(() => findButton('完成复盘')?.disabled === false, '重新复盘后完成操作不可用')
    findButton('完成复盘')?.click()
    await waitFor(() => Boolean(findButton('下一条待复盘')), '再次完成后下一条入口未恢复')
    findButton('下一条待复盘')?.click()
    await waitFor(() => document.querySelector('.dv-crumb-active')?.textContent === raceTrade.ref, '常驻入口未进入同范围下一条待复盘')

    root.unmount()
    resetNoteDraftsForTests()
    useStore.setState({ trades: [raceTrade] })
    const saveStarted = deferred<void>()
    const allowSave = deferred<string>()
    storage.saveAsset = async () => {
      saveStarted.resolve()
      return allowSave.promise
    }
    root = createRoot(rootElement)
    root.render(
      <MemoryRouter initialEntries={['/trade/TRD-REVIEW-RACE']}>
        <Routes>
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(
      () => findButton('完成复盘')?.disabled === false,
      '并发场景的复盘内容就绪后，完成操作仍不可用',
    )
    setNoteDraft(
      raceTrade.id,
      '<p>完整复盘结论</p><img src="data:image/png;base64,QQ==">',
    )
    findButton('完成复盘')?.click()
    await saveStarted.promise
    setNoteDraft(raceTrade.id, '')
    allowSave.resolve('review-race-asset')
    await waitFor(() => !hasNoteDraft(raceTrade.id), '最新空白草稿没有完成落库')
    await waitForFrame()
    assert(
      useStore.getState().trades[0]?.reviewStatus === 'unreviewed',
      '保存等待期间被清空的笔记不能继续标记为已复盘',
    )
  } finally {
    root.unmount()
    storage.saveAsset = originalSaveAsset
    resetNoteDraftsForTests()
    useStore.setState({ trades: previous.trades, strategies: previous.strategies, display: previous.display })
    useShortcutStore.setState(previousShortcuts, true)
  }
}

window.__reviewCompletionFlowTest = run()
