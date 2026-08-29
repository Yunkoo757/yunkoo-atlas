import { createRoot } from 'react-dom/client'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
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

function CanonicalRedirects() {
  return (
    <Routes>
      <Route path="/favorites" element={<Navigate to="/list?view=starred" replace />} />
      <Route path="/missed" element={<Navigate to="/list?view=missed" replace />} />
      <Route path="*" element={null} />
    </Routes>
  )
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
    id: 'system:favorites',
    target: { kind: 'system', id: 'favorites', workspaces: ['trade', 'paper'] },
    placement: 'pinned',
    order: 1,
  },
  {
    id: 'system:missed',
    target: { kind: 'system', id: 'missed', workspaces: ['trade', 'paper'] },
    placement: 'pinned',
    order: 2,
  },
  {
    id: 'strategy:navigation-1',
    target: { kind: 'strategy', strategyId: 'navigation-1' },
    placement: 'pinned',
    order: 3,
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
      riskPolicyVersions: [],
      monthlyRiskLimits: [],
      weeklyRiskPreparations: [],
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
        <CanonicalRedirects />
      </MemoryRouter>,
    )

    await waitFor(() => document.querySelector('[data-primary-id="trades"]') !== null, '核心导航没有渲染')

    const primaryLabels = [...document.querySelectorAll<HTMLElement>('.sb-primary [data-primary-id] .sb-item-label')]
      .map((node) => node.textContent?.trim())
    assert(
      primaryLabels.join(',') === '统计分析,随机复盘,周期复盘,案例库,交易日志',
      '工作区必须按用户保存的顺序渲染',
    )

    const headerActions = [...document.querySelectorAll<HTMLButtonElement>('.sb-header-actions button')]
    assert(
      headerActions.map((button) => button.className).join(',')
        === 'sb-hbtn sb-hbtn-search,sb-hbtn sb-hbtn-create',
      '侧栏头部必须按 Linear 风格呈现搜索与圆形记录按钮',
    )
    const createAction = document.querySelector<HTMLButtonElement>('.sb-hbtn-create')
    assert(createAction, '记录交易必须并入侧栏头部操作组')
    const createStyle = getComputedStyle(createAction)
    const searchStyle = getComputedStyle(headerActions[0]!)
    assert(
      createStyle.width === '28px' && createStyle.height === '28px'
        && createStyle.borderRadius === '9999px',
      '记录交易必须保持与搜索一致的 28px 圆形 Compose 按钮',
    )
    assert(
      createStyle.color === searchStyle.color
        && createStyle.borderStyle === 'none'
        && createStyle.boxShadow === 'none',
      '记录交易必须与搜索使用一致的图标透明层级，且不得额外增加边框或阴影',
    )
    assert(!document.querySelector('.sb-quick-record'), '记录交易不得继续成为孤立行')
    assert(document.body.textContent?.includes('工作区'), '主导航分组必须使用工作区表述')
    assert(!document.body.textContent?.includes('核心'), '侧栏不得继续使用模糊的核心表述')

    const riskTrigger = document.querySelector<HTMLButtonElement>('.sb-risk-summary')
    assert(riskTrigger, '侧栏底部缺少风险状态入口')
    assert(riskTrigger.textContent?.includes('风险未设置'), '未配置状态必须直接显示风险未设置')
    assert(riskTrigger.getAttribute('aria-expanded') === 'false', '风险弹层默认必须关闭')
    assert(!document.querySelector('.sb-risk-popover'), '风险详情不得在侧栏常驻堆叠')
    riskTrigger.click()
    await waitFor(() => document.querySelector('.sb-risk-popover') !== null, '点击风险入口没有打开详情弹层')
    assert(riskTrigger.getAttribute('aria-expanded') === 'true', '打开后风险入口没有同步 aria-expanded')
    assert(document.querySelectorAll('.sb-risk-period').length === 3, '风险弹层必须同时展示日、周、月')
    assert(
      document.querySelector<HTMLAnchorElement>('.sb-risk-manage')?.getAttribute('href') === '/settings/risk',
      '风险弹层缺少完整风险管理入口',
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await waitFor(() => document.querySelector('.sb-risk-popover') === null, 'Escape 没有关闭风险详情弹层')
    assert(document.activeElement === riskTrigger, 'Escape 关闭风险弹层后没有把焦点还给入口')

    const now = new Date()
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-')
    const stageId = useStore.getState().currentLiveStageId
    useStore.setState({
      riskPolicyVersions: [{
        id: 'sidebar-risk-policy',
        liveStageId: stageId,
        sourceWeekStart: '2020-01-06',
        effectiveTradingDay: '2020-01-06',
        capitalBase: 10_000,
        riskPercent: 1,
        riskAmount: 100,
        dailyLossLimitR: 2,
        weeklyLossLimitR: 5,
        monthlyLossLimitRDefault: 10,
        disciplineText: '',
        confirmedAt: '2020-01-06T00:00:00.000Z',
      }],
      monthlyRiskLimits: [{
        id: 'sidebar-risk-month',
        liveStageId: stageId,
        monthKey: today.slice(0, 7),
        limitR: 10,
        sourcePolicyVersionId: 'sidebar-risk-policy',
        lockedAt: '2020-01-06T00:00:00.000Z',
      }],
      weeklyRiskPreparations: [],
    })
    await waitFor(
      () => riskTrigger.textContent?.includes('风控中心') ?? false,
      '额度均正常时，周前准备状态不得把侧栏风险入口改成待复核告警',
    )

    const primary = document.querySelector<HTMLAnchorElement>('a[data-primary-id="trades"]')
    assert(primary, '缺少交易日志主导航')
    const activePrimaryRow = primary.closest<HTMLElement>('.sb-sortable-row')
    assert(activePrimaryRow, '当前主导航缺少可排序行容器')
    assert(activePrimaryRow.classList.contains('is-active'), '当前主导航外层必须表达选中状态')
    const activePrimaryStyle = getComputedStyle(primary)
    const activePrimaryIcon = primary.querySelector<SVGElement>('svg')
    assert(activePrimaryIcon, '当前主导航缺少图标')
    const activeProbe = document.createElement('span')
    activeProbe.style.color = 'var(--text-nav-active)'
    activeProbe.style.background = 'var(--surface-nav-active)'
    const activeIconProbe = document.createElement('span')
    activeIconProbe.style.color = 'var(--nav-icon-trades)'
    document.body.appendChild(activeProbe)
    document.body.appendChild(activeIconProbe)
    const activeProbeStyle = getComputedStyle(activeProbe)
    assert(
      activePrimaryStyle.color === activeProbeStyle.color
        && activePrimaryStyle.fontWeight === '550'
        && getComputedStyle(activePrimaryIcon).color === getComputedStyle(activeIconProbe).color
        && getComputedStyle(activePrimaryIcon).color !== activePrimaryStyle.color,
      '父层选中的可排序导航必须提升文字与字重，并恢复对应模块的图标强调色',
    )
    assert(
      getComputedStyle(activePrimaryRow).backgroundColor === activeProbeStyle.backgroundColor
        && activeProbeStyle.backgroundColor !== 'rgba(0, 0, 0, 0)',
      '当前位置必须使用独立且清晰的导航高亮表面，不能复用弱于 hover 的通用 selected 底色',
    )
    activeProbe.remove()
    activeIconProbe.remove()

    assert(
      !document.querySelector('[data-sidebar-workspace-id="system:favorites"]'),
      '星标交易已提升为交易日志顶部快捷视图，不得在侧栏形成重复入口',
    )
    assert(
      !document.querySelector('[data-sidebar-workspace-id="system:missed"]'),
      '错过机会已提升为交易日志顶部快捷视图，不得在侧栏形成重复入口',
    )

    assert(!document.querySelector('.sb-row-drag-handle'), '日常侧栏不应同时暴露来源菜单和排序抓手')
    const manageButton = document.querySelector<HTMLButtonElement>('.sb-workspace-manage')
    assert(manageButton, '缺少添加或管理入口')
    manageButton.click()
    await waitFor(
      () => document.querySelector('[data-sidebar-primary-item="trades"]') !== null,
      '管理器没有呈现工作区导航排序列表',
    )
    for (let index = 0; index < 4; index += 1) {
      const primaryHandle = document.querySelector<HTMLButtonElement>(
        '[data-sidebar-primary-item="trades"] [aria-label="排序 交易日志"]',
      )
      assert(primaryHandle, '管理器必须提供交易日志排序抓手')
      primaryHandle.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        altKey: true,
        key: 'ArrowUp',
      }))
      await frame()
    }
    const commitButton = document.querySelector<HTMLButtonElement>('.sb-editor-actions .is-primary')
    assert(commitButton, '管理器缺少完成按钮')
    commitButton.click()
    await waitFor(
      () => useStore.getState().display.sidebarPrimaryOrder?.at(0) === 'trades',
      '在管理器调整工作区入口后没有持久化新顺序',
    )
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

    assert(!document.querySelector('[data-sidebar-workspace-id="system:missed"]'), '旧版错过机会配置只保留来源范围，不得恢复重复侧栏入口')
    assert(document.querySelector('[data-sidebar-workspace-id="system:active"]'), '用户保存的进行中入口不得被渲染层静默隐藏')
    assert(!document.querySelector('[aria-label="排序 错过机会"]'), '系统快捷项排序必须收口到管理器')
    assert(!document.querySelector('[aria-label="排序 进行中"]'), '系统快捷项排序必须收口到管理器')

    assert(!document.querySelector('[aria-label="导航1包含来源"]'), '策略是交易日志筛选，不得再提供跨来源混排菜单')
    const strategyLink = document.querySelector<HTMLAnchorElement>('[data-sidebar-workspace-id="strategy:navigation-1"] a')
    assert(strategyLink, '缺少导航1策略入口')
    assert(strategyLink.getAttribute('href') === '/list?strategyId=navigation-1', '策略入口必须落在交易日志并携带策略筛选')
    strategyLink.click()
    await waitFor(
      () => strategyLink.closest('.sb-sortable-row')?.classList.contains('is-active') ?? false,
      '进入策略聚合页后，策略入口没有表达选中状态',
    )
    const strategyIcon = strategyLink.querySelector<SVGElement>('.strategy-icon svg')
    assert(strategyIcon, '策略入口缺少图标')
    const strategyColorProbe = document.createElement('span')
    strategyColorProbe.style.color = '#5e6ad2'
    document.body.appendChild(strategyColorProbe)
    assert(
      getComputedStyle(strategyIcon).color === getComputedStyle(strategyColorProbe).color,
      '策略入口选中后必须使用该策略保存的强调色',
    )
    strategyColorProbe.remove()
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__sidebarCapabilityMenuBrowserTest = run()
