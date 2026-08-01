import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/components/Sidebar'
import type { SidebarWorkspaceItem } from '@/lib/sidebarWorkspace'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __sidebarCapabilityMenuBrowserTest: Promise<void>
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

const sidebarItems: SidebarWorkspaceItem[] = [
  {
    id: 'system:active',
    target: { kind: 'system', id: 'active', workspaces: ['trade'] },
    placement: 'pinned',
    order: 0,
  },
  {
    id: 'system:missed',
    target: { kind: 'system', id: 'missed', workspaces: ['trade', 'paper', 'case'] },
    placement: 'pinned',
    order: 1,
  },
]

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)

  try {
    useStore.setState((state) => ({
      trades: [],
      strategies: [],
      savedTradeViews: [],
      display: {
        ...state.display,
        sidebarWorkspaceItems: sidebarItems,
      },
    }))
    root.render(
      <MemoryRouter initialEntries={['/list']}>
        <Sidebar />
      </MemoryRouter>,
    )

    await waitFor(
      () => document.querySelector('[data-sidebar-workspace-id="system:missed"]') !== null,
      '错过的机会侧栏项没有渲染',
    )

    const missedItem = document.querySelector<HTMLElement>(
      '[data-sidebar-workspace-id="system:missed"]',
    )
    assert(missedItem, '缺少错过的机会侧栏项')
    assert(
      !missedItem.querySelector('[aria-label="错过的机会包含范围"]'),
      '错过的机会不应重复提供侧栏包含范围菜单',
    )

    missedItem.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 80,
    }))
    await frame()
    assert(!document.querySelector('.ctx'), '右键错过的机会不应打开重复的包含范围菜单')

    const activeMenu = document.querySelector<HTMLButtonElement>('[aria-label="进行中可见工作区"]')
    assert(activeMenu, '其他能力项仍应保留侧栏工作区菜单')
    activeMenu.click()
    await waitFor(() => document.querySelector('.ctx') !== null, '进行中工作区菜单没有打开')
    assert(
      document.querySelector('.ctx-label')?.textContent?.trim() === '可见工作区',
      '其他能力项应继续显示可见工作区菜单',
    )
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__sidebarCapabilityMenuBrowserTest = run()
