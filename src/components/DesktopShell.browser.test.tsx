import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { AppFrame } from './ui/AppFrame'
import { Toolbar } from './ui/Toolbar'

declare global {
  interface Window {
    __desktopShellTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')

  const root = createRoot(rootElement)
  let overflowSelection = ''
  root.render(
    <MemoryRouter initialEntries={['/today-record']}>
      <AppFrame
        sidebar={<Sidebar />}
      >
        <Toolbar
          title="桌面壳层"
          context="紧凑桌面宽度"
          actions={(
            <div>
              <button type="button">主要操作</button>
            </div>
          )}
          overflowActions={[
            {
              value: 'secondary-one',
              label: '次要操作一',
              onSelect: () => { overflowSelection = 'secondary-one' },
            },
            { value: 'secondary-two', label: '次要操作二', onSelect: () => {} },
          ]}
        />
        <div style={{ width: '100%', minWidth: 0 }}>主内容</div>
      </AppFrame>
    </MemoryRouter>,
  )

  await nextFrame()
  await nextFrame()

  const sidebar = document.querySelector<HTMLElement>('.sidebar')
  const main = document.querySelector<HTMLElement>('.ui-main-frame')
  assert(sidebar, '桌面壳层必须渲染侧栏')
  assert(main, '桌面壳层必须渲染主内容区')

  if (innerWidth === 960) {
    assert(sidebar.dataset.density === 'compact', '960px 必须使用 compact 侧栏')
    const overflowTrigger = document.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')
    assert(overflowTrigger, '960px 工具栏必须提供更多操作入口')
    overflowTrigger.focus()
    overflowTrigger.click()
    await nextFrame()
    const overflowMenu = document.querySelector<HTMLElement>('[role="menu"]')
    const firstOverflowAction = overflowMenu?.querySelector<HTMLButtonElement>('[role="menuitem"]')
    assert(overflowMenu && firstOverflowAction, '更多操作必须打开可键盘访问的菜单')
    assert(document.activeElement === firstOverflowAction, '更多操作菜单必须聚焦第一个动作')
    firstOverflowAction.click()
    assert(overflowSelection === 'secondary-one', '更多操作必须执行原动作')
  }
  if (innerWidth >= 1100) {
    assert(sidebar.dataset.density === 'standard', '宽桌面必须使用 standard 侧栏')
  }

  assert(!document.querySelector('.ui-mobile-navigation'), '桌面产品壳层不得渲染移动导航')
  assert(main.scrollWidth <= main.clientWidth, '主内容区不得产生水平溢出')

  root.unmount()
}

window.__desktopShellTest = run()
