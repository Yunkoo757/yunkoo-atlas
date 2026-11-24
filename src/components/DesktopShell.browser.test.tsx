import { createRoot } from 'react-dom/client'
import { HashRouter, Link, MemoryRouter } from 'react-router-dom'
import '../styles/tokens.css'
import '../styles/global.css'
import { Sidebar } from './Sidebar'
import { WindowTitlebar } from './WindowTitlebar'
import { WINDOW_TITLEBAR_HEIGHT } from '../lib/windowBounds'
import { useStore } from '../store/useStore'
import { useShortcutHost } from '../shortcuts/ShortcutHost'
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

function DesktopFixture({ onSearch }: { onSearch: (button: HTMLElement) => void }) {
  const collapsed = useStore(state => state.display.sidebarCollapsed === true)
  useShortcutHost({ onToggleCmdk: () => {} })
  return (
    <AppFrame
      titlebar={<WindowTitlebar onOpenSearch={onSearch} searchOpen={false} sidebarCollapsed={collapsed} />}
      sidebarCollapsed={collapsed}
      sidebar={<Sidebar showSearch={false} />}
    >
      <Link to="/review-cases/mistakes" data-window-case>错题</Link>
      <Link to="/settings/risk" data-window-settings>风险管理</Link>
      <input aria-label="测试编辑" />
    </AppFrame>
  )
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
  const mainStyle = getComputedStyle(main)
  const dividerWidth = Number.parseFloat(mainStyle.borderLeftWidth)
  assert(
    dividerWidth >= 0.75 && dividerWidth <= 1,
    `侧栏与主内容之间必须保持单物理像素分隔线：${mainStyle.borderLeftWidth}`,
  )
  assert(mainStyle.borderLeftStyle === 'solid', '桌面壳层分隔线必须使用实线')
  assert(mainStyle.boxShadow === 'none', '桌面壳层不得叠加控件阴影模糊分隔线')

  window.history.replaceState(window.history.state, '', '#/list')
  document.documentElement.style.setProperty('--window-titlebar-height', `${WINDOW_TITLEBAR_HEIGHT}px`)
  let opener: HTMLElement | null = null
  root.render(
    <HashRouter>
      <DesktopFixture onSearch={button => { opener = button }} />
    </HashRouter>,
  )
  await nextFrame()
  const titlebar = document.querySelector<HTMLElement>('.window-titlebar')!
  const search = titlebar.querySelector<HTMLButtonElement>('[data-command-palette-trigger]')!
  const title = titlebar.querySelector<HTMLElement>('[aria-current="page"]')!
  const toggle = titlebar.querySelector<HTMLButtonElement>('[aria-label="折叠左侧导航"]')!
  const back = titlebar.querySelector<HTMLButtonElement>('[aria-label="后退"]')!
  const forward = titlebar.querySelector<HTMLButtonElement>('[aria-label="前进"]')!
  const pane = document.querySelector<HTMLElement>('.ui-main-frame')!.getBoundingClientRect()
  const bar = titlebar.getBoundingClientRect()
  assert(bar.height === WINDOW_TITLEBAR_HEIGHT && bar.bottom === pane.top, '窗口工具栏必须直接衔接内容窗格')
  assert(title.getBoundingClientRect().left === pane.left, '位置标题必须与内容窗格对齐')
  assert(!title.closest('button') && title.tabIndex === -1, '标题应为静态文本')
  title.click()
  assert(opener === null, '点击标题不应打开搜索')
  assert(document.querySelectorAll('[data-command-palette-trigger]').length === 1, '桌面只保留一个搜索入口')
  assert(title.textContent?.includes('全部交易') && forward.disabled, '初始位置与前进状态应匹配真实历史')
  search.click()
  assert(opener === search, '搜索入口必须传递焦点返回目标')
  async function expectTitle(label: string) {
    for (let i = 0; i < 60 && document.title !== label + ' — Trader Atlas'; i++) await nextFrame()
    assert(document.title === label + ' — Trader Atlas' && title.textContent?.includes(label), '位置应同步到窗口及工具栏：' + label)
  }
  document.querySelector<HTMLAnchorElement>('[data-window-case]')!.click()
  await expectTitle('错题')
  assert(!back.disabled, '进入案例后可以后退')
  back.click()
  await expectTitle('全部交易')
  assert(!forward.disabled, '回到日志后可以前进')
  forward.click()
  await expectTitle('错题')
  back.click()
  await expectTitle('全部交易')
  document.querySelector<HTMLAnchorElement>('[data-window-settings]')!.click()
  await expectTitle('风险管理')
  assert(forward.disabled, '从历史中间切换页面应丢弃旧的前进分支')

  const nav = document.getElementById(toggle.getAttribute('aria-controls')!)!
  const toggleX = toggle.getBoundingClientRect().left
  nav.querySelector<HTMLElement>('a')!.focus()
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))
  await nextFrame()
  assert(nav.inert && toggle.getAttribute('aria-expanded') === 'false', '快捷键须收起侧栏并移除其所有键盘入口')
  assert(document.activeElement === toggle && toggle.getBoundingClientRect().left === toggleX, '收起后焦点应回到固定的开关')
  assert(document.querySelector('main')!.clientWidth > pane.width, '收起后应把空间交还给当前页面')
  const input = document.querySelector<HTMLInputElement>('[aria-label="测试编辑"]')!
  input.focus()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }))
  await nextFrame()
  assert(nav.inert && document.activeElement === input, '在编辑区域输入快捷键不得收展侧栏')
  toggle.click()
  await nextFrame()
  assert(!nav.inert && title.textContent === '风险管理', '展开应恢复原导航并保留当前页面')

  root.unmount()
  document.documentElement.style.removeProperty('--window-titlebar-height')
}

window.__desktopShellTest = run()
