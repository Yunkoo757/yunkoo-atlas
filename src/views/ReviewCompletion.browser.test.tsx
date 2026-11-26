import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Editor as TiptapEditor } from '@tiptap/core'
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

    const editorSelector = '[aria-label="复盘正文"][contenteditable="true"]'
    await waitFor(() => Boolean(document.querySelector(editorSelector)), '空白复盘编辑器未就绪')
    assert(!findButton('完成复盘') && !document.querySelector('.dv-review-actions'), '空白复盘不应出现收尾操作行')
    assert(!document.querySelector('.dv-review-state'), '待复盘状态不应占用顶栏')
    const editor = document.querySelector<HTMLElement & { editor: TiptapEditor }>(editorSelector)!.editor
    editor.commands.insertContent('等待确认后再入场。')
    await waitFor(() => findButton('完成复盘')?.disabled === false, '补充复盘结论后应在正文末尾出现完成操作')
    const completionAction = findButton('完成复盘')!
    assert(document.querySelector('.dv-document .dv-review-actions')?.contains(completionAction), '完成操作应在复盘正文末尾')
    assert(!document.querySelector('.dv-topbar')?.contains(completionAction), '记录导航不应混入复盘操作')
    editor.commands.clearContent(true)
    await waitFor(() => !findButton('完成复盘'), '清空复盘结论后应移除完成操作')
    const commentTrigger = findButton('添加追记')
    assert(commentTrigger && !document.querySelector('[aria-label="补充追记"]'), '首次打开只应提供追加入口')
    commentTrigger.click()
    await waitFor(() => document.activeElement?.getAttribute('aria-label') === '补充追记', '点击添加追记应聚焦输入框')
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await waitFor(() => !document.querySelector('[aria-label="补充追记"]'), 'Escape 应收起追记')
    assert(document.activeElement === commentTrigger, '收起追记应把焦点交还入口')
    const detailMain = document.querySelector<HTMLElement>('.trade-detail-layout .dv-main')
    const detailProperties = document.querySelector<HTMLElement>('.trade-detail-layout .dv-props')
    assert(detailMain && detailProperties, '详情页缺少正文或属性区域')
    if (window.innerWidth <= 1200) {
      const propertiesToggle = document.querySelector<HTMLButtonElement>('.trade-detail-properties-toggle[aria-expanded="false"]')
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
      const propertiesToggle = document.querySelector<HTMLButtonElement>('.trade-detail-properties-toggle')
      assert(propertiesToggle?.getAttribute('aria-expanded') === 'true', '属性栏应显示当前状态')
      propertiesToggle.click()
      await waitFor(() => detailProperties.inert && detailProperties.getAttribute('aria-hidden') === 'true', '宽桌面收起属性栏时应立即退出交互')
      await waitFor(() => getComputedStyle(detailProperties).visibility === 'hidden', '宽桌面属性栏未完成离场')
      assert(detailMain.getBoundingClientRect().width > beforeWidth + 300, '收起属性后没有把空间让给正文')
      assert(useStore.getState().display.detailPropertiesVisible === false, '属性偏好没有保存到显示设置')
      propertiesToggle.click()
      await waitFor(() => !detailProperties.inert && getComputedStyle(detailProperties).visibility === 'visible'
        && propertiesToggle.getAttribute('aria-expanded') === 'true', '属性栏无法重新展开')
    }
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
    assert(!document.querySelector('.dv-main')?.textContent?.includes('复盘正文'), '普通已复盘交易不得显示重复视觉标题')
    assert(document.querySelector('[aria-label="复盘正文"]'), '去除视觉标题后必须保留编辑器可访问名称')
    assert(!document.querySelector('.dv-review-stage'), '已完成状态不应继续占据正文首屏')
    assert(!document.querySelector('.dv-review-complete-action'), '已完成状态不应继续显示完成命令')
    assert(
      document.querySelector('.dv-review-complete-meta')?.textContent?.trim() === '已复盘',
      '完成后应就地显示已复盘状态',
    )
    const nextPending = findButton('下一条待复盘')
    assert(nextPending && document.querySelector('.dv-document .dv-review-actions')?.contains(nextPending), '完成后应在正文末尾直接进入下一条待复盘')
    const reviewActions = document.querySelector('.dv-review-actions')!
    assert(reviewActions.contains(nextPending) && reviewActions.firstElementChild?.classList.contains('dv-review-complete-meta'), '复盘状态应位于同组推进动作之前')
    document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')?.click()
    await waitFor(() => Boolean(findButton('重新复盘')), '更多菜单缺少重新复盘入口')
    findButton('重新复盘')?.click()
    await waitFor(
      () => useStore.getState().trades[0]?.reviewStatus === 'unreviewed',
      '顶部菜单无法重新打开复盘',
    )
    await waitFor(() => findButton('完成复盘')?.disabled === false, '重新复盘后完成操作不可用')
    const more = document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')!
    const menuAction = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.trim() === label)
    more.click()
    await waitFor(() => Boolean(menuAction('完成复盘')), '长文档应能从固定的更多菜单完成复盘')
    menuAction('完成复盘')!.click()
    await waitFor(() => Boolean(findButton('下一条待复盘')), '再次完成后下一条入口未恢复')
    more.click()
    await waitFor(() => Boolean(menuAction('下一条待复盘')), '长文档应能从固定的更多菜单进入下一条')
    menuAction('下一条待复盘')!.click()
    await waitFor(() => document.querySelector('.dv-record-ref')?.textContent === raceTrade.ref, '常驻入口未进入同范围下一条待复盘')

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
