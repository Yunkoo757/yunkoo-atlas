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

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })
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
  {
    id: 'strategy:navigation-1',
    target: { kind: 'strategy', strategyId: 'navigation-1' },
    placement: 'pinned',
    order: 2,
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
      strategies: [{ id: 'navigation-1', name: '导航1', icon: 'target', color: '#5e6ad2' }],
      savedTradeViews: [],
      display: {
        ...state.display,
        sidebarWorkspaceItems: sidebarItems,
        sidebarPrimaryOrder: [
          'dashboard',
          'reviewSession',
          'weeklyReview',
          'reviewCases',
          'trades',
          'quickNotes',
          'today',
        ],
      },
    }))
    root.render(
      <MemoryRouter initialEntries={['/list']}>
        <Sidebar />
      </MemoryRouter>,
    )

    await waitFor(() => document.querySelector('[data-primary-id="trades"]') !== null, '核心导航没有渲染')

    const primaryLabels = [...document.querySelectorAll<HTMLElement>('.sb-primary [data-primary-id] .sb-item-label')]
      .map((node) => node.textContent?.trim())
    assert(
      primaryLabels.join(',') === '交易日志,统计分析,周期复盘,案例记录,随机复盘',
      '旧持久化顺序不得改变精简后的核心导航顺序',
    )

    const primary = document.querySelector<HTMLAnchorElement>('[data-primary-id="trades"]')
    assert(primary, '缺少交易日志主导航')
    primary.focus()
    await frame()
    assert(!document.querySelector('[role="tooltip"]'), '聚焦工作台主导航不得显示 Tooltip')
    primary.blur()
    primary.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await wait(700)
    assert(!document.querySelector('[role="tooltip"]'), '悬停工作台主导航不得显示 Tooltip')

    const search = document.querySelector<HTMLButtonElement>('.sb-hbtn-search')
    assert(search, '搜索按钮必须保留')
    search.focus()
    await waitFor(
      () => document.querySelector('[role="tooltip"]') !== null,
      '搜索纯图标按钮仍应显示 Tooltip',
    )

    assert(!document.querySelector('[data-sidebar-workspace-id="system:missed"]'), '旧系统快捷项不应继续占据侧栏')
    assert(!document.querySelector('[data-sidebar-workspace-id="system:active"]'), '进行中已归入交易日志范围栏')

    const strategyMenu = document.querySelector<HTMLButtonElement>('[aria-label="导航1包含来源"]')
    assert(strategyMenu, '策略项必须提供包含来源菜单')
    strategyMenu.click()
    await waitFor(() => document.body.textContent?.includes('当前实盘') === true, '策略来源菜单没有打开')
    assert(document.body.textContent?.includes('模拟盘'), '策略来源必须包含模拟盘')
    assert(document.body.textContent?.includes('案例'), '策略来源必须包含案例')
    const caseOption = [...document.querySelectorAll<HTMLButtonElement>('.ctx button')]
      .find((button) => button.textContent?.trim() === '案例')
    assert(caseOption, '缺少案例来源选项')
    caseOption.click()
    await waitFor(
      () => useStore.getState().display.sidebarWorkspaceItems.some((item) => (
        item.target.kind === 'strategy'
        && item.target.strategyId === 'navigation-1'
        && item.target.workspaces?.includes('case')
      )),
      '勾选案例后没有写入策略来源',
    )
    const strategyLink = document.querySelector<HTMLAnchorElement>('[data-sidebar-workspace-id="strategy:navigation-1"]')
    assert(strategyLink?.getAttribute('href')?.includes('sources=trade,case'), '策略链接必须带上合并来源')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__sidebarCapabilityMenuBrowserTest = run()
