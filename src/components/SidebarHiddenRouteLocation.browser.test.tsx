import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
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

  try {
    useStore.setState((state) => ({
      trades: [],
      strategies: [],
      savedTradeViews: [],
      display: { ...state.display, sidebarWorkspaceItems: [] },
    }))
    root.render(
      <MemoryRouter initialEntries={['/favorites']}>
        <Sidebar />
      </MemoryRouter>,
    )
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
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__sidebarHiddenRouteLocationTest = run()
