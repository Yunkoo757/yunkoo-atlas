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
      <MemoryRouter initialEntries={['/sim']}>
        <Sidebar />
      </MemoryRouter>,
    )
    await waitFor(
      () => Boolean(document.querySelector('[data-sidebar-hidden-route]')),
      '隐藏工作区深链必须呈现当前位置',
    )

    const ghost = document.querySelector<HTMLElement>('[data-sidebar-hidden-route]')
    assert(ghost, '隐藏工作区深链当前位置不可用')
    assert(ghost.textContent?.includes('模拟盘'), '隐藏工作区当前位置标签错误')
    assert(ghost.getAttribute('aria-current') === 'location', '隐藏工作区当前位置缺少 aria-current=location')
    const ghostIcon = ghost.querySelector<SVGElement>('svg')
    assert(ghostIcon, '隐藏工作区当前位置缺少图标')
    const iconColorProbe = document.createElement('span')
    iconColorProbe.style.color = 'var(--nav-icon-ws-paper)'
    document.body.appendChild(iconColorProbe)
    assert(
      getComputedStyle(ghostIcon).color === getComputedStyle(iconColorProbe).color,
      '隐藏工作区当前位置也必须使用对应模块的图标强调色',
    )
    iconColorProbe.remove()

    const trades = document.querySelector<HTMLElement>('a[data-primary-id="trades"]')
    assert(trades, '缺少交易日志主导航')
    assert(trades.closest('.sb-sortable-row')?.classList.contains('is-page-active'), '隐藏工作区深链仍应标明所属的交易日志页面')
    assert(trades.getAttribute('aria-current') === 'page', '隐藏工作区深链必须保留交易日志的页面身份')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__sidebarHiddenRouteLocationTest = run()
