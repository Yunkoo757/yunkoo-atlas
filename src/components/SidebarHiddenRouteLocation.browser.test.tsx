import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { Sidebar } from '@/components/Sidebar'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __sidebarHiddenRouteLocationTest?: Promise<void>
  }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function waitFor(check: () => boolean, message: string) {
  for (let index = 0; index < 120; index += 1) {
    if (check()) return
    await frame()
  }
  throw new Error(message)
}

async function run() {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(element)

  const router = createMemoryRouter([{ path: '*', element: <Sidebar /> }], { initialEntries: ['/favorites'] })
  const live: Trade = {
    id: 'live', ref: 'TRD-1', symbol: 'EURUSD', side: 'long', status: 'planned', conviction: 'medium',
    strategyId: 'uncategorized', tags: [], mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal',
    tradeKind: 'live', entry: 1, exit: null, size: 1, pnl: null, rMultiple: null,
    openedAt: '2026-11-25', closedAt: null, note: '',
  }
  try {
    useStore.setState((state) => ({
      trades: [
        live,
        { ...live, tradeKind: 'paper', id: 'paper', ref: 'PPR-1' },
        { ...live, tradeKind: 'case', id: 'case', ref: 'CAS-1' },
        { ...live, tradeKind: 'backtest', id: 'backtest', ref: 'BKT-1', backtestProjectId: 'project' },
        { ...live, id: 'trashed', ref: 'TRD-2', deletedAt: '2026-11-25' },
      ],
      strategies: [],
      savedTradeViews: [],
      display: { ...state.display, sidebarWorkspaceItems: [] },
    }))
    root.render(<RouterProvider router={router} />)
    await waitFor(() => Boolean(document.querySelector('a[data-primary-id="trades"]')), '侧栏未完成渲染')

    assert(
      !document.querySelector('[data-sidebar-hidden-route]'),
      '顶部快捷视图不得临时插回侧栏并导致导航位移',
    )

    const trades = document.querySelector<HTMLElement>('a[data-primary-id="trades"]')
    assert(trades, '缺少交易日志主导航')
    const tradesRow = trades.closest('.sb-sortable-row')
    assert(tradesRow?.classList.contains('is-page-active'), '交易日志同页快捷视图必须保留一级导航完整高亮')
    assert(!tradesRow?.classList.contains('is-context-active'), '同页快捷视图不得错误降级为弱上下文态')
    assert(trades.getAttribute('aria-current') === 'page', '交易日志同页快捷视图必须保留页面身份')
    assert(trades.getAttribute('href') === '/list', '重复点击已选中的交易日志主导航必须返回默认首页')

    for (const [record, module, from] of [
      ['TRD-1', '/list'],
      ['case', '/review-cases'],
      ['ppr-1', '/list'],
      ['BKT-1', '/backtests'],
      ['TRD-1', '/list', '/dashboard'],
      ['CAS-1', '/review-cases', '/weekly-review'],
    ] as const) {
      await router.navigate('/trade/' + record, {
        state: from ? { from: { pathname: from, anchorTradeId: 'weekly-commitment:entry' } } : undefined,
      })
      await waitFor(() => Boolean(document.querySelector(`a[href="${module}"][aria-current="location"]`)), '详情侧栏没有选中记录所属模块：' + record)
      const active = document.querySelectorAll('nav a[aria-current]')
      assert(active.length === 1 && active[0].closest('.is-active.is-page-active'), '详情必须只有一个可见选中项')
    }
    for (const record of ['trashed', 'missing']) {
      await router.navigate('/trade/' + record)
      await waitFor(() => !document.querySelector('nav a[aria-current]'), '未找到的记录不可误选交易日志')
    }
    await router.navigate('/backtests/project')
    await waitFor(() => Boolean(document.querySelector('a[href="/backtests"][aria-current="page"]')), '进入回测项目页应恢复原导航状态')
  } finally {
    root.unmount()
    router.dispose()
    useStore.setState(previous, true)
  }
}

window.__sidebarHiddenRouteLocationTest = run()
