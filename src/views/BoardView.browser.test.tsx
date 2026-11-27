import { MemoryAppRouter } from '@/test/fixtures/MemoryAppRouter'
import { createRoot } from 'react-dom/client'
import { Route, Routes } from 'react-router-dom'
import type { Trade, TradeStatus } from '@/data/trades'
import { toastStore } from '@/lib/toast'
import { useShortcutStore } from '@/store/shortcutStore'
import { handleShortcutKeydown } from '@/shortcuts/engine'
import { getDetailNavigation } from '@/shortcuts/listNav'
import { useStore } from '@/store/useStore'
import { DetailView } from '@/views/DetailView'
import { ListView } from '@/views/ListView'
import { BoardView } from '@/views/BoardView'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __boardViewVisualContractTest?: Promise<void>
  }
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

function caseTrade(status: TradeStatus, index: number, currentLiveStageId: string): Trade {
  return {
    id: `case-${status}`,
    ref: `CAS-${index}`,
    symbol: index % 2 === 0 ? 'XAUUSD' : 'EURUSD',
    side: index % 2 === 0 ? 'long' : 'short',
    status,
    conviction: 'medium',
    strategyId: 'strategy-1',
    tradeKind: 'case',
    caseType: status === 'loss' ? 'mistake' : 'exemplar',
    tags: ['伦敦盘', 'MTF ORA'],
    mistakeTags: status === 'loss' ? ['着急入场'] : [],
    reviewStatus: 'unreviewed',
    reviewCategory: status === 'loss' ? 'mistake' : 'normal',
    entry: 1.1,
    exit: 1.2,
    size: 1,
    pnl: 350,
    rMultiple: status === 'loss' ? -1 : 4.3,
    resultSource: 'r',
    openedAt: '2026-08-24',
    closedAt: status === 'planned' || status === 'open' ? null : '2026-08-24',
    closedTradingDayKey: status === 'planned' || status === 'open' ? undefined : '2026-08-24',
    liveStageId: currentLiveStageId,
    note: index === 1 ? '<h2>突破后等待回踩确认</h2><p>复盘正文</p>' : '',
    sourceNoteHtml: status === 'loss' ? '<img src="journal-asset://1"><img src="journal-asset://2">' : undefined,
  }
}

async function run(): Promise<void> {
  const host = document.getElementById('root')
  assert(host, '缺少测试挂载节点')
  const preview = new URLSearchParams(window.location.search).has('preview')
  const previous = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  const root = createRoot(host)

  try {
    const currentLiveStageId = previous.currentLiveStageId
    useStore.setState((state) => ({
      trades: (['planned', 'missed', 'win', 'breakeven', 'loss'] as TradeStatus[])
        .map((status, index) => caseTrade(status, index + 1, currentLiveStageId)).reverse(),
      display: { ...state.display, hideClosed: false, showEmptyGroups: false },
    }))

    root.render(
      <MemoryAppRouter initialEntries={['/review-cases/board']}>
        <main style={{ width: '1440px', height: '760px', display: 'flex', flexDirection: 'column' }}>
          <BoardView
            title="案例库"
            view="board"
            onView={() => undefined}
            onOpen={() => undefined}
            filter={{ type: 'all', tradeKind: 'case', reviewCaseScope: 'all' }}
          />
        </main>
      </MemoryAppRouter>,
    )

    await waitFor(() => document.querySelectorAll('.bd-col').length === 5, '五个状态列未完整渲染')
    await waitFor(() => document.querySelectorAll('.bd-card').length === 5, '案例卡片未完整渲染')

    const board = document.querySelector<HTMLElement>('.board-scroll')
    const columns = [...document.querySelectorAll<HTMLElement>('.bd-col')]
    const cards = [...document.querySelectorAll<HTMLElement>('.bd-card')]
    assert(board, '缺少案例看板滚动容器')
    const cardIds = cards.map(card => card.dataset.tradeId)
    const context = useShortcutStore.getState().listContext
    assert(context?.orderedIds.join() === cardIds.join(), '详情翻页顺序必须使用看板实际列顺序')
    const mixed = useStore.getState().trades.map((record, index): Trade => ({ ...record, tradeKind: index % 2 ? 'live' : 'paper' }))
    const adjacent = getDetailNavigation(mixed, context, mixed.find(record => record.id === cardIds[1]))
    assert(adjacent && adjacent.nextId === cardIds[2] && adjacent.orderedIds.length === mixed.length, '混合交易列表翻页必须保留模拟和实盘记录')
    if (!preview) {
      useShortcutStore.setState({ bindings: { ...previousShortcuts.bindings, 'list.focusNext': { key: 'j' } } })
      cards[2]!.focus()
      assert(handleShortcutKeydown(new KeyboardEvent('keydown', { key: 'j' }), '/review-cases/board'), '看板未接收已配置的下一条快捷键')
      await waitFor(() => document.activeElement === cards[3], '从已聚焦或返回定位的卡片继续应前往视觉上的下一张卡片')
      const toolbarButton = document.querySelector<HTMLButtonElement>('button[aria-label="筛选"]') ??
        document.querySelector<HTMLButtonElement>('button[aria-pressed]')
      assert(toolbarButton, '缺少可聚焦的工具栏按钮')
      toolbarButton.focus()
      useStore.setState(state => ({ trades: state.trades.map(t => ({ ...t, note: t.note + ' ' })) }))
      await frame()
      await frame()
      assert(document.activeElement === toolbarButton, '背景刷新案例时不能把焦点从工具栏拉回卡片')
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      toolbarButton.dispatchEvent(enter)
      assert(!handleShortcutKeydown(enter, '/review-cases/board'), '工具栏 Enter 应保留按钮自身操作，不能打开旧卡片')
    }
    assert(!document.querySelector('.board-scroll-case, .bd-card-case'), '案例库不得启用第二套看板视觉分支')
    assert(getComputedStyle(board).gap === '0px', '看板列之间不得保留卡片式沟槽')
    assert(columns.every((column) => getComputedStyle(column).borderRadius === '0px'), '状态列不得继续使用独立大圆角容器')
    assert(columns.every((column) => getComputedStyle(column).backgroundColor === 'rgba(0, 0, 0, 0)'), '状态列必须共享页面底色')
    assert(getComputedStyle(columns[1]!).borderLeftWidth === '1px', '相邻状态列应以轻分隔线建立结构')
    assert(cards.every((card) => card.getBoundingClientRect().width > 240), '案例卡片宽度不应因内外双层容器被过度压缩')
    assert(document.querySelectorAll('.bd-card-result').length === 4, '已结束和有潜在 R 的错过卡片应保留结果值，计划不展示不适用占位')
    const potential = board.querySelector('.bd-card-result[data-value-state="missed"]')
    assert(potential && potential.textContent?.includes('4.3R') && !potential.hasAttribute('data-value-sign'), '潜在 R 必须可读并使用机会色')
    assert(!/突破后等待回踩确认|来源复盘|张截图/.test(board.textContent ?? ''), '案例看板只在打开详情后展示复盘正文和截图')
    assert(!document.body.textContent?.includes('$350'), '看板不得重新引入列表已经移除的现金金额')
    if (!preview) {
      const batch = () => document.querySelector<HTMLElement>('[aria-label="批量操作"]:not([aria-hidden="true"])')
      const batchButton = (name: string) => [...batch()!.querySelectorAll('button')].find(button => button.textContent?.trim() === name)
      cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
      await waitFor(() => batch()?.textContent?.includes('已选 1 项') ?? false, '看板逐卡选择应提供批量工具条')
      cards[1]!.focus()
      cards[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }))
      const selectionMenu = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes('选择这条记录'))
      await waitFor(() => !!selectionMenu() && document.activeElement === selectionMenu(), 'Shift+F10 应打开聚焦卡片的菜单并聚焦选择入口')
      selectionMenu()!.click()
      await waitFor(() => batch()?.textContent?.includes('已选 2 项') ?? false, '看板右键选中应保留已选项')
      batchButton('复制案例')!.click()
      await waitFor(() => !!document.querySelector('.copy-confirm-modal'), '看板应使用标准批量复制确认')
      const cancel = [...document.querySelectorAll<HTMLButtonElement>('.copy-confirm-modal button')].find(button => button.textContent?.trim() === '取消')
      cancel!.click()
      await waitFor(() => !document.querySelector('[role="dialog"]:not([aria-hidden="true"])'), '取消应返回仍保留选择的看板')
      batchButton('删除')!.click()
      await waitFor(() => useStore.getState().trades.filter(t => t.deletedAt).length === 2, '批量删除应只软删除所选案例')
      assert(toastStore.getVisible().at(-1)?.actionLabel === '撤销', '必须能撤销看板删除')
      toastStore.getVisible().at(-1)?.onAction?.()
      await waitFor(() => useStore.getState().trades.every(t => !t.deletedAt), '撤销应恢复两条案例')
      const active = { ...caseTrade('win', 1, currentLiveStageId), id: 'active-live', ref: 'TRD-1', openedAt: '2026-08-26', tradeKind: 'live' as const }
      const hidden = { ...active, id: 'other-stage', ref: 'TRD-3', liveStageId: 'past-stage', openedAt: '2026-08-25' }
      const july = { ...active, id: 'folded-month', ref: 'OTHER-1', openedAt: '2026-07-21' }
      const paper = { ...active, id: 'simulated', ref: 'TRD-2', openedAt: '2026-08-24', tradeKind: 'paper' as const }
      useStore.setState(state => ({
        trades: [paper, hidden, active, july],
        display: { ...state.display, groupByDate: true, groupByStrategy: false, sortBy: 'date', sortDirection: 'desc' },
      }))
      root.render(
        <MemoryAppRouter key="journal" initialEntries={['/list?kind=all']}>
          <main style={{ height: '760px', display: 'flex', flexDirection: 'column' }}>
            <Routes>
              <Route path="/list" element={<ListView title="交易日志" view="list" onView={() => {}} journal />} />
              <Route path="/trade/:id" element={<DetailView />} />
            </Routes>
          </main>
        </MemoryAppRouter>,
      )
      await waitFor(() => document.querySelectorAll('.trade-row').length === 3, '日志应呈现两个可折叠月份')
      document.querySelector<HTMLButtonElement>('[data-trade-id="folded-month"] [role="checkbox"]')!.click()
      const julyToggle = () => [...document.querySelectorAll<HTMLButtonElement>('.trade-list-group-toggle')]
        .find(button => button.textContent?.includes('7月'))
      julyToggle()!.click()
      await waitFor(() => document.querySelectorAll('.trade-row').length === 2 && !batch(), '折叠所选行后应退出空选择')
      assert(useShortcutStore.getState().listContext?.orderedIds.join() === [active.id, paper.id].join(), '详情和键盘顺序应排除折叠行')
      assert(handleShortcutKeydown(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, metaKey: true }), '/list'), '可见记录应该支持全选')
      await waitFor(() => batch()?.textContent?.includes('已选 2 项') ?? false, '全选只能包括展开分组中的记录')
      assert(handleShortcutKeydown(new KeyboardEvent('keydown', { key: 'Escape' }), '/list'), 'Escape 应退出批量选择')
      await waitFor(() => !batch(), '退出选择后应继续浏览当前列表')
      document.querySelector<HTMLButtonElement>('[data-trade-id="active-live"] .trade-row-open')!.click()
      await waitFor(() => document.querySelector('.dv-detail-position')?.textContent?.replace(/\s/g, '') === '1/2', '详情计数应排除其他阶段')
      document.querySelector<HTMLButtonElement>('.dv-detail-navigation button:last-of-type')!.click()
      await waitFor(() => !!document.querySelector('.dv-reading-context')?.textContent?.includes('TRD-2'), '下一笔应跳过隐藏阶段并打开相邻模拟交易')
      document.querySelector<HTMLAnchorElement>('a[aria-label="返回交易日志"]')!.click()
      await waitFor(() => !!document.querySelector('[data-trade-id="active-live"] [role="checkbox"]'), '详情未返回原日志')
      assert(julyToggle()?.getAttribute('aria-expanded') === 'false', '从下一笔详情返回时应保留之前折叠的月份')
      document.querySelector<HTMLButtonElement>('[data-trade-id="active-live"] [role="checkbox"]')!.click()
      await waitFor(() => !!document.querySelector('[aria-label="批量操作"] button'), '选择一笔记录后应能批量复制')
      document.querySelector<HTMLButtonElement>('[aria-label="批量操作"] button')!.click()
      await waitFor(() => !!document.querySelector('.copy-confirm-modal .ui-btn-primary'), '批量复制确认未出现')
      document.querySelector<HTMLButtonElement>('.copy-confirm-modal .ui-btn-primary')!.click()
      await waitFor(() => useStore.getState().trades.length === 5, '应创建一笔新计划')
      const copy = useStore.getState().trades.find(record => ![active.id, hidden.id, paper.id, july.id].includes(record.id))
      assert(copy?.ref === 'TRD-4', '隐藏阶段的记录也占用编号，复制不能产生已有编号')
    }
  } finally {
    if (!preview) {
      root.unmount()
      useStore.setState(previous, true)
      toastStore.dismiss()
      useShortcutStore.setState(previousShortcuts, true)
    }
  }
}

window.__boardViewVisualContractTest = run()
