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

    await waitFor(
      () => document.querySelector('[data-sidebar-workspace-id="system:missed"]') !== null,
      '错过的机会侧栏项没有渲染',
    )

    const primaryLabels = [...document.querySelectorAll<HTMLElement>('.sb-primary [data-primary-id] .sb-item-label')]
      .map((node) => node.textContent?.trim())
    assert(
      primaryLabels.join(',') === '今日工作台,随记,交易日志,案例记录,周复盘,随机复盘,仪表盘',
      '旧持久化顺序不得改变工作台标准顺序',
    )

    const primary = document.querySelector<HTMLAnchorElement>('[data-primary-id="dashboard"]')
    assert(primary, '缺少仪表盘主导航')
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

    const today = document.querySelector<HTMLAnchorElement>('[data-primary-id="today"]')
    assert(today, '缺少今日主导航')
    const persistedBefore = useStore.getState().display.sidebarPrimaryOrder?.join(',') ?? ''
    const orderBefore = [...document.querySelectorAll<HTMLElement>('.sb-primary [data-primary-id]')]
      .map((node) => node.dataset.primaryId).join(',')
    const originalElementFromPoint = document.elementFromPoint.bind(document)
    document.elementFromPoint = () => today
    try {
      primary.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        pointerId: 7,
        button: 0,
        clientX: 20,
        clientY: 20,
      }))
      primary.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 7,
        buttons: 1,
        clientX: 20,
        clientY: 80,
      }))
      primary.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 7,
        button: 0,
        clientX: 20,
        clientY: 80,
      }))
    } finally {
      document.elementFromPoint = originalElementFromPoint
    }
    assert(
      (useStore.getState().display.sidebarPrimaryOrder?.join(',') ?? '') === persistedBefore,
      '主导航手势不得写回旧顺序字段',
    )
    assert(
      [...document.querySelectorAll<HTMLElement>('.sb-primary [data-primary-id]')]
        .map((node) => node.dataset.primaryId).join(',') === orderBefore,
      '主导航手势不得改变标准顺序',
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
