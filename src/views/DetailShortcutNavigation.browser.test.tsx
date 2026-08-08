import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { tradeDetailNavState } from '@/lib/tradeRoute'
import { useShortcutHost } from '@/shortcuts/ShortcutHost'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import { DetailView } from '@/views/DetailView'
import { ImageLightbox } from '@/components/ImageLightbox'

declare global {
  interface Window {
    __detailShortcutNavigationTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await waitForFrame()
  }
  throw new Error(message)
}

function makeCase(index: number): Trade {
  return {
    id: `case-${index}`,
    ref: `CAS-${index}`,
    symbol: `CASE${index}`,
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'uncategorized',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'reviewed',
    reviewCategory: 'normal',
    tradeKind: 'case',
    caseType: 'exemplar',
    masteryState: 'new',
    nextReviewAt: null,
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 10,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: `2026-07-${10 + index}`,
    closedAt: `2026-07-${10 + index}`,
    note: index === 1
      ? `<p>案例 ${index} 的复盘正文</p>`
      : `<p>案例 ${index} 的复盘正文</p><img src="/src/views/fixtures/browser-test-image.svg?case-${index}.png">`,
  }
}

function makeWeeklyLiveTrade(): Trade {
  return {
    ...makeCase(1),
    id: 'weekly-live-1',
    ref: 'TRD-WEEKLY-LIVE-1',
    symbol: 'BTCUSDT',
    tradeKind: 'live',
    caseType: undefined,
    masteryState: undefined,
    nextReviewAt: undefined,
    note: '<p>周复盘来源交易</p>',
  }
}

function WeeklyReturnProbe() {
  const location = useLocation()
  return <output data-testid="weekly-return-search">{location.search}</output>
}

function ReturnPathProbe() {
  const location = useLocation()
  return <output data-testid="detail-return-path">{location.pathname}</output>
}

function ShortcutDetailFixture() {
  useShortcutHost({ onToggleCmdk: () => {} })
  return <>
    <Routes>
      <Route path="/trade/:id" element={<DetailView />} />
    </Routes>
    <ImageLightbox />
  </>
}

function pressShortcut(key: 'q' | 'e'): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previousStore = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  const cases = [makeCase(1), makeCase(2), makeCase(3)]
  const root = createRoot(rootElement)
  const pageErrors: string[] = []
  const capturePageError = (event: ErrorEvent) => pageErrors.push(event.error?.message ?? event.message)
  window.addEventListener('error', capturePageError)
  const copied: string[] = []
  const ownClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string) => { copied.push(value) } },
  })

  function findButton(label: string): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === label)
  }

  try {
    useStore.setState({
      trades: cases,
      tagPresets: ['计划内'],
      mistakeTagPresets: ['周末交易'],
    })
    useShortcutStore.setState({
      bindings: {
        ...previousShortcuts.bindings,
        'trade.prev': { key: 'q' },
        'trade.next': { key: 'e' },
      },
      listContext: {
        filter: { type: 'all', tradeKind: 'case' },
        listPath: '/review-cases',
        listSearch: '',
        orderedIds: cases.map((item) => item.id),
      },
    })

    root.render(
      <MemoryRouter initialEntries={['/trade/CAS-2']}>
        <ShortcutDetailFixture />
      </MemoryRouter>,
    )

    await waitFor(
      () => document.querySelector('.ProseMirror')?.textContent?.includes('案例 2') ?? false,
      '初始案例正文未载入',
    )
    assert(!document.querySelector('.dv-copy-id'), '案例正文右侧不得显示复制编号按钮')
    document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')?.click()
    await waitFor(() => Boolean(findButton('复制编号')), '更多菜单缺少复制编号')
    findButton('复制编号')?.click()
    await waitFor(() => copied.at(-1) === 'CAS-2', '更多菜单没有复制当前案例编号')
    const tagsSection = [...document.querySelectorAll<HTMLButtonElement>('.dv-section-head')]
      .find((button) => button.textContent?.trim() === '标签')
    assert(tagsSection, '详情页缺少标签分区')
    tagsSection.click()
    await waitFor(
      () => document.querySelector('[aria-label="添加标签「计划内」"]') !== null,
      '详情页必须展示未选择的普通预置标签',
    )
    assert(
      document.querySelector('[aria-label="添加标签「周末交易」"]'),
      '详情页必须展示未选择的错误预置标签',
    )

    const caseNavigation = document.querySelector<HTMLElement>('[aria-label="案例导航"]')
    const previousCaseButton = document.querySelector<HTMLButtonElement>('[aria-label^="上一个案例"]')
    const nextCaseButton = document.querySelector<HTMLButtonElement>('[aria-label^="下一个案例"]')
    assert(caseNavigation?.textContent?.replace(/\s/g, '') === '2/3', '案例顶部栏应显示当前序号与总数')
    assert(previousCaseButton && !previousCaseButton.disabled, '中间案例应可前往上一个案例')
    assert(nextCaseButton && !nextCaseButton.disabled, '中间案例应可前往下一个案例')
    nextCaseButton.click()
    await waitFor(
      () => document.body.textContent?.includes('CAS-3') ?? false,
      '顶部栏未切换到下一个案例',
    )
    assert(
      document.querySelector<HTMLElement>('[aria-label="案例导航"]')?.textContent?.replace(/\s/g, '') === '3/3',
      '切换后案例序号未同步',
    )
    assert(document.querySelector<HTMLButtonElement>('[aria-label^="下一个案例"]')?.disabled, '最后一个案例应禁用下一案例')
    document.querySelector<HTMLButtonElement>('[aria-label^="上一个案例"]')?.click()
    await waitFor(
      () => document.body.textContent?.includes('CAS-2') ?? false,
      '顶部栏未返回上一个案例',
    )

    const initialImage = document.querySelector<HTMLImageElement>('.ProseMirror img')
    assert(initialImage, '案例正文缺少用于打开全屏的图片')
    initialImage.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    await waitFor(
      () => document.querySelector<HTMLImageElement>('.img-lightbox-img')?.src.includes('case-2.png') ?? false,
      '初始案例图片未打开',
    )
    pressShortcut('e')
    await waitFor(
      () => document.body.textContent?.includes('CAS-3') ?? false,
      '全屏图片打开时未切换到下一案例',
    )
    await waitFor(
      () => document.querySelector<HTMLImageElement>('.img-lightbox-img')?.src.includes('case-3.png') ?? false,
      '切换案例后全屏图片仍停留在旧案例',
    )
    pressShortcut('q')
    await waitFor(
      () => document.querySelector<HTMLImageElement>('.img-lightbox-img')?.src.includes('case-2.png') ?? false,
      '返回上一案例后全屏图片未同步恢复',
    )
    pressShortcut('q')
    await waitFor(
      () => useShortcutStore.getState().lightbox === null,
      '切换到无图案例时应退出全屏图片',
    )
    pressShortcut('e')
    await waitFor(
      () => document.body.textContent?.includes('CAS-2') ?? false,
      '无图案例退出全屏后未能继续切换',
    )

    const sequence: Array<['q' | 'e', string]> = [
      ['e', 'CAS-3'],
      ['q', 'CAS-2'],
      ['q', 'CAS-1'],
      ['e', 'CAS-2'],
      ['e', 'CAS-3'],
      ['q', 'CAS-2'],
      ['q', 'CAS-1'],
      ['e', 'CAS-2'],
    ]
    for (const [key, expectedRef] of sequence) {
      pressShortcut(key)
      await waitFor(
        () => document.body.textContent?.includes(expectedRef) || pageErrors.length > 0,
        `按 ${key.toUpperCase()} 后未切换到 ${expectedRef}`,
      )
      if (pageErrors.length > 0) break
      await waitForFrame()
    }

    assert(
      !pageErrors.some((message) => message.includes('removeChild')),
      `Q/E 切换案例触发页面异常：${pageErrors.join(' | ')}`,
    )
    assert(pageErrors.length === 0, `Q/E 切换案例出现未处理异常：${pageErrors.join(' | ')}`)
    assert(document.querySelector('.ProseMirror'), '连续切换后案例编辑器不应丢失')

    const weeklyTrade = makeWeeklyLiveTrade()
    useStore.setState({ trades: [weeklyTrade] })
    root.render(
      <MemoryRouter
        key="weekly-detail-source"
        initialEntries={[{
          pathname: `/trade/${weeklyTrade.ref}`,
          state: tradeDetailNavState({
            pathname: '/weekly-review',
            search: '?week=2026-07-20&visual=mobile',
            anchorTradeId: 'weekly-trade:weekly-live-1',
          }),
        }]}
      >
        <Routes>
          <Route path="/trade/:id" element={<DetailView />} />
          <Route path="/weekly-review" element={<WeeklyReturnProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[aria-label="返回周复盘"]') !== null,
      '真实详情页没有显示周复盘返回名称',
    )
    const liveInlineCopy = document.querySelector<HTMLButtonElement>('.dv-copy-id')
    assert(liveInlineCopy?.textContent?.trim() === `复制 ${weeklyTrade.ref}`, '实盘详情必须保留正文侧栏复制编号入口')
    liveInlineCopy.click()
    await waitFor(() => copied.at(-1) === weeklyTrade.ref, '实盘详情侧栏没有复制正确编号')
    document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')?.click()
    await waitFor(() => Boolean(findButton('复制编号')), '实盘详情更多菜单缺少复制编号')
    findButton('复制编号')?.click()
    await waitFor(() => copied.at(-1) === weeklyTrade.ref, '实盘详情更多菜单没有复制正确编号')
    assert(document.body.textContent?.includes('周复盘'), '真实详情页面包屑没有显示周复盘')
    document.querySelector<HTMLAnchorElement>('[aria-label="返回周复盘"]')?.click()
    await waitFor(
      () => document.querySelector('[data-testid="weekly-return-search"]')?.textContent
        === '?week=2026-07-20&visual=mobile',
      '真实详情返回后没有保留原周和无关参数',
    )

    useStore.getState().removeTrade(weeklyTrade.id)
    useStore.getState().purgeTrade(weeklyTrade.id)
    root.render(
      <MemoryRouter
        key="missing-weekly-detail-source"
        initialEntries={[{
          pathname: `/trade/${weeklyTrade.ref}`,
          state: tradeDetailNavState({
            pathname: '/weekly-review',
            search: '?week=2026-07-20',
            anchorTradeId: 'weekly-trade:weekly-live-1',
          }),
        }]}
      >
        <Routes>
          <Route path="/trade/:id" element={<DetailView />} />
          <Route path="/weekly-review" element={<WeeklyReturnProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => [...document.querySelectorAll<HTMLAnchorElement>('a')]
        .some((link) => link.textContent?.trim() === '返回周复盘'),
      '交易彻底不存在时空状态没有保留周复盘入口',
    )
    const missingReturn = [...document.querySelectorAll<HTMLAnchorElement>('a')]
      .find((link) => link.textContent?.trim() === '返回周复盘')
    missingReturn?.click()
    await waitFor(
      () => document.querySelector('[data-testid="weekly-return-search"]')?.textContent
        === '?week=2026-07-20',
      '交易彻底不存在时没有返回原周',
    )

    const invalidWeeklyPaper: Trade = {
      ...weeklyTrade,
      id: 'weekly-paper-1',
      ref: 'TRD-WEEKLY-PAPER-1',
      tradeKind: 'paper',
      note: '<p>模拟盘来源交易</p>',
    }
    useStore.setState({ trades: [invalidWeeklyPaper] })
    root.render(
      <MemoryRouter
        key="invalid-paper-weekly-source"
        initialEntries={[{
          pathname: `/trade/${invalidWeeklyPaper.ref}`,
          state: tradeDetailNavState({
            pathname: '/weekly-review',
            search: '?week=2026-07-20',
            anchorTradeId: 'weekly-trade:weekly-paper-1',
          }),
        }]}
      >
        <Routes>
          <Route path="/trade/:id" element={<DetailView />} />
          <Route path="/list" element={<ReturnPathProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[aria-label="返回列表"]') !== null,
      '模拟盘非法周复盘来源仍显示周复盘返回名称',
    )
    const paperInlineCopy = document.querySelector<HTMLButtonElement>('.dv-copy-id')
    assert(paperInlineCopy?.textContent?.trim() === `复制 ${invalidWeeklyPaper.ref}`, '模拟盘详情必须保留正文侧栏复制编号入口')
    paperInlineCopy.click()
    await waitFor(() => copied.at(-1) === invalidWeeklyPaper.ref, '模拟盘详情侧栏没有复制正确编号')
    document.querySelector<HTMLButtonElement>('button[aria-label="更多"]')?.click()
    await waitFor(() => Boolean(findButton('复制编号')), '模拟盘详情更多菜单缺少复制编号')
    findButton('复制编号')?.click()
    await waitFor(() => copied.at(-1) === invalidWeeklyPaper.ref, '模拟盘详情更多菜单没有复制正确编号')
    assert(!document.body.textContent?.includes('周复盘'), '模拟盘非法来源不得显示周复盘面包屑')
    document.querySelector<HTMLAnchorElement>('[aria-label="返回列表"]')?.click()
    await waitFor(
      () => document.querySelector('[data-testid="detail-return-path"]')?.textContent === '/list',
      '模拟盘非法周复盘来源没有返回交易列表',
    )

    const invalidWeeklyCase = makeCase(4)
    useStore.setState({ trades: [invalidWeeklyCase] })
    root.render(
      <MemoryRouter
        key="invalid-case-weekly-source"
        initialEntries={[{
          pathname: `/trade/${invalidWeeklyCase.ref}`,
          state: tradeDetailNavState({
            pathname: '/weekly-review',
            search: '?week=2026-07-20',
            anchorTradeId: 'weekly-trade:case-4',
          }),
        }]}
      >
        <Routes>
          <Route path="/trade/:id" element={<DetailView />} />
          <Route path="/review-cases" element={<ReturnPathProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('[aria-label="返回列表"]') !== null,
      '案例非法周复盘来源仍显示周复盘返回名称',
    )
    assert(!document.body.textContent?.includes('周复盘'), '案例非法来源不得显示周复盘面包屑')
    document.querySelector<HTMLAnchorElement>('[aria-label="返回列表"]')?.click()
    await waitFor(
      () => document.querySelector('[data-testid="detail-return-path"]')?.textContent
        === '/review-cases',
      '案例非法周复盘来源没有返回案例列表',
    )
  } finally {
    if (ownClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', ownClipboardDescriptor)
    } else {
      delete (navigator as unknown as { clipboard?: Clipboard }).clipboard
    }
    window.removeEventListener('error', capturePageError)
    root.unmount()
    useStore.setState({
      trades: previousStore.trades,
      strategies: previousStore.strategies,
      tagPresets: previousStore.tagPresets,
      mistakeTagPresets: previousStore.mistakeTagPresets,
    })
    useShortcutStore.setState({
      bindings: previousShortcuts.bindings,
      listContext: previousShortcuts.listContext,
      lightbox: previousShortcuts.lightbox,
    })
  }
}

window.__detailShortcutNavigationTest = run()
