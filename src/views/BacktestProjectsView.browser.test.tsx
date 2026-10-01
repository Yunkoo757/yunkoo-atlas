import { createRoot } from 'react-dom/client'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { BacktestProjectsView } from './BacktestProjectsView'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { handleShortcutKeydown } from '@/shortcuts/engine'
import { useShortcutHost } from '@/shortcuts/ShortcutHost'
import { getProjectTrades, summarizeBacktest, type BacktestProject } from '@/lib/backtestProjects'
import type { Trade } from '@/data/trades'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global { interface Window { __backtestListInteractionTest?: Promise<void> } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function waitFor(check: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 4000
  while (performance.now() < deadline) { if (check()) return; await new Promise(resolve => requestAnimationFrame(resolve)) }
  throw new Error(message)
}
function button(label: string): HTMLButtonElement {
  const element = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label)
  assert(element, `找不到按钮：${label}`)
  return element
}
function fillInput(selector: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(selector)!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
const project: BacktestProject = { id: 'bt-interaction', name: '隔离交互测试', symbol: 'XAUUSD', startedAt: '2025-02-26', targetCount: 100, defaultStrategyId: null, rules: '', archivedAt: null, completedAt: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
function record(index: number, projectId = project.id): Trade {
  return { id: `${projectId}-${index}`, ref: `TRD-${index}`, tradeKind: 'backtest', backtestProjectId: projectId, symbol: 'XAUUSD', side: 'long', status: 'win', conviction: 'medium', strategyId: 'uncategorized', tags: [], mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal', entry: 0, exit: null, size: 0, pnl: null, rMultiple: 2, resultSource: 'r', openedAt: '2025-03-01', closedAt: '2025-03-01', note: '<p>源记录</p>' }
}
function ShortcutFixture() {
  useShortcutHost({ onToggleCmdk: () => {} })
  return <Outlet />
}
function escape(): void {
  ;(document.activeElement ?? window).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}
async function run(): Promise<void> {
  const previous = useStore.getState()
  const previousShortcuts = useShortcutStore.getState()
  const root = createRoot(document.getElementById('root')!)
  const secondProject = { ...project, id: 'bt-other', name: '另一个项目', rules: '<b>固定规则原文</b>\n' + '按系统机会参与，不因结果更改规则。'.repeat(100) }
  const router = createMemoryRouter([{ element: <ShortcutFixture />, children: [
    { path: '/backtests/:id', element: <BacktestProjectsView /> },
    { path: '/backtests', element: <BacktestProjectsView /> },
    { path: '/list', element: <div>交易日志</div> },
  ] }], { initialEntries: [`/backtests/${project.id}`] })
  try {
    useStore.setState({ trades: [...Array.from({ length: 100 }, (_, index) => record(index + 1)), record(101, secondProject.id)], backtestProjects: [project, secondProject], starredIds: [] })
    useShortcutStore.setState({ bindings: { 'list.selectAll': { key: 'a', mod: true } }, modalOverlayCount: 0, cmdkOpen: false, lightbox: null })
    root.render(<RouterProvider router={router} />)
    await waitFor(() => Boolean(document.querySelector('.trade-row')), '记录列表未渲染')
    assert(!document.querySelector('.backtest-stats') && !document.querySelector('.backtest-project-meta'), '默认列表不能常驻统计概览与项目说明')
    assert(![...document.querySelectorAll('button')].some(item => item.textContent === '记录下一笔'), '默认头部不应重复全局新建入口')
    const toolbar = document.querySelector('.ui-toolbar')!.getBoundingClientRect()
    const filters = document.querySelector('.backtest-filter-bar')!.getBoundingClientRect()
    assert(filters.bottom - toolbar.top <= 90, '记录列表前只能保留公共标题栏和筛选栏')
    button('项目统计').click()
    await waitFor(() => Boolean(document.querySelector('.backtest-stats')), '完整统计应按需打开')
    assert(document.querySelector('.backtest-stats')?.textContent?.includes('100 / 100'), '统计应保留全部项目口径')
    escape()
    await waitFor(() => !document.querySelector('[role="dialog"]'), '统计关闭应返回列表')
    assert(router.state.location.pathname === `/backtests/${project.id}`, '统计弹窗 Escape 不得穿透回日志')
    const row = document.querySelector<HTMLElement>('.trade-row')!
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 150 }))
    await waitFor(() => Boolean(document.querySelector('[role="menu"]')), '右键必须显示菜单')
    assert(router.state.location.pathname === `/backtests/${project.id}`, '右键不得跳转详情')
    assert(document.querySelector('[role="menu"]')?.textContent?.includes('提炼为案例'), '回测必须沿用公共记录菜单')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitFor(() => !document.querySelector('[role="menu"]'), 'Escape 应关闭右键菜单')
    document.querySelector<HTMLButtonElement>('.trade-row [role="checkbox"]')!.click()
    await waitFor(() => Boolean(document.querySelector('.batch-action-bar')), '行勾选应显示批量操作')
    assert(router.state.location.pathname === `/backtests/${project.id}`, '勾选不得跳转详情')
    button('复制为待确认记录').click()
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')), '批量复制必须确认')
    button('创建 1 条待确认记录').click()
    await waitFor(() => getProjectTrades(useStore.getState().trades, project.id).length === 101 && !document.querySelector('.batch-action-bar'), '复制应新增副本并清空选择')
    const copy = useStore.getState().trades.find(trade => trade.id !== secondProject.id + '-101' && !trade.id.startsWith(project.id + '-'))!
    assert(copy.backtestProjectId === project.id && copy.rMultiple === null && copy.note === '', '复制保留项目并清空结果正文')
    assert(summarizeBacktest(getProjectTrades(useStore.getState().trades, project.id)).evaluatedCount === 100, '副本不能增加确认进度')
    button('待确认').click()
    await waitFor(() => document.querySelectorAll('.trade-row').length === 1, '待确认筛选应仅展示新副本')
    button('项目统计').click()
    await waitFor(() => Boolean(document.querySelector('.backtest-stats')), '筛选中仍应可查看统计')
    assert(document.querySelector('.backtest-stats')?.textContent?.includes('100 / 100'), '筛选不得改变项目统计范围')
    button('关闭').click()
    await waitFor(() => !document.querySelector('[role="dialog"]'), '统计应回到原筛选')
    document.querySelector<HTMLButtonElement>('.trade-row [role="checkbox"]')!.click()
    await waitFor(() => Boolean(document.querySelector('.batch-action-bar')), '待确认记录应支持勾选')
    button('删除').click()
    await waitFor(() => !document.querySelector('.trade-row') && !document.querySelector('.batch-action-bar'), '批量删除应更新列表并清空选择')
    assert(useStore.getState().trades.find(trade => trade.id === copy.id)?.deletedAt, '删除必须进入回收站')
    assert(!useStore.getState().trades.find(trade => trade.backtestProjectId === secondProject.id)?.deletedAt, '批量操作不得影响其他项目')
    button('全部记录').click()
    await waitFor(() => Boolean(document.querySelector('.trade-row')), '切回全部记录失败')
    assert(handleShortcutKeydown(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true }), `/backtests/${project.id}`), '项目全选应接入快捷键引擎')
    await waitFor(() => document.querySelector('.batch-action-count')?.textContent === '已选 100 项', '全选应包含虚拟列表未挂载行')
    button('切换项目').click()
    await waitFor(() => Boolean(document.querySelector('[role="menuitemradio"]')), '切换菜单应提供项目选项')
    button(secondProject.name).click()
    await waitFor(() => !document.querySelector('.batch-action-bar') && document.querySelectorAll('.trade-row').length === 1, '切换项目必须清除前项目选择')
    document.querySelector<HTMLButtonElement>('.trade-row [role="checkbox"]')!.click()
    await waitFor(() => Boolean(document.querySelector('.batch-action-bar')), '项目选择未建立')
    escape()
    await waitFor(() => !document.querySelector('.batch-action-bar'), 'Escape 应优先取消项目记录选择')
    assert(router.state.location.pathname === `/backtests/${secondProject.id}`, '取消选择不得同时回日志')
    escape()
    await waitFor(() => router.state.location.pathname === '/list', '项目记录无选择时 Escape 必须回交易日志')
    await router.navigate(`/backtests/${secondProject.id}`)
    await waitFor(() => Boolean(document.querySelector('.trade-row')), '重新进入项目失败')
    useStore.setState({ backtestProjects: [project, { ...secondProject, archivedAt: '2026-10-01T00:00:00Z' }] })
    await waitFor(() => document.querySelector('.backtest-lifecycle')?.textContent === '已归档', '归档状态必须常驻可见')
    useStore.getState().openComposer(null, 'backtest', secondProject.id)
    assert(!useStore.getState().composerOpen, '归档应禁止全局入口新建记录')
    document.querySelector<HTMLElement>('.trade-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 150 }))
    await waitFor(() => Boolean(document.querySelector('[role="menu"]')), '归档记录菜单应保留')
    const copyMenu = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes('复制为待确认记录'))
    assert((copyMenu as HTMLButtonElement | undefined)?.disabled, '归档应禁用菜单复制')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitFor(() => !document.querySelector('[role="menu"]'), '菜单关闭失败')
    button('项目操作').click()
    await waitFor(() => Boolean(document.querySelector('[role="menuitem"]')), '项目菜单未打开')
    button('项目信息').click()
    await waitFor(() => Boolean(document.querySelector('.backtest-info-rules')), '项目信息应按需打开')
    assert(document.querySelector('.backtest-info-rules')?.textContent === secondProject.rules && !document.querySelector('.backtest-info-rules b'), '规则应保留完整原文而不是执行 HTML')
    button('关闭').click()
    await waitFor(() => !document.querySelector('[role="dialog"]'), '项目信息关闭应返回记录')
    button('项目操作').click()
    await waitFor(() => Boolean(document.querySelector('[role="menuitem"]')), '设置菜单未打开')
    button('项目设置').click()
    await waitFor(() => Boolean(document.querySelector('#backtest-project-name')), '项目设置未打开')
    await waitFor(() => document.activeElement?.id === 'backtest-project-name', '项目设置初始焦点未完成')
    const fixedSymbol = document.querySelector<HTMLInputElement>('#backtest-fixed-symbol')!
    const fixedStart = document.querySelector<HTMLInputElement>('#backtest-fixed-start')!
    assert(fixedSymbol.readOnly && !fixedSymbol.disabled && fixedStart.readOnly, '固定字段须保持只读可读，不能用禁用态替代')
    assert(!document.querySelector<HTMLDetailsElement>('.backtest-form details')!.open, '低频规则默认收起')
    fillInput('#backtest-target', '0')
    await waitFor(() => document.querySelector<HTMLInputElement>('#backtest-target')!.value === '0', '目标输入失败')
    button('保存').click()
    await waitFor(() => document.querySelector('#backtest-target')?.getAttribute('aria-invalid') === 'true', '无效目标须显示字段校验')
    assert(document.activeElement?.id === 'backtest-target', '校验须聚焦出错字段')
    assert(useStore.getState().backtestProjects.find(item => item.id === secondProject.id)?.targetCount === 100, '错误输入不能写入项目')
    fillInput('#backtest-target', '150')
    await waitFor(() => document.querySelector('#backtest-target')?.getAttribute('aria-invalid') === 'false', '修正目标应清除错误')
    button('保存').click()
    await waitFor(() => !document.querySelector('[role="dialog"]'), '项目设置保存失败')
    assert(useStore.getState().backtestProjects.find(item => item.id === secondProject.id)?.targetCount === 150, '合法目标应保存且不改变项目身份')
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const winRate = document.querySelector<HTMLButtonElement>('[aria-label="胜率，查看统计口径"]')!
    winRate.focus()
    await waitFor(() => document.querySelector('[role="tooltip"]')?.textContent?.includes('分母包含保本') === true, '统计口径须可由键盘按需查看')
    winRate.blur()
    const longName = '固定规则项目 · ' + 'XAUUSD顺势交易机会'.repeat(7)
    useStore.setState({ backtestProjects: useStore.getState().backtestProjects.map(item => item.id === secondProject.id ? { ...item, name: longName } : item) })
    await waitFor(() => document.querySelector('.ui-toolbar-title')?.textContent === longName, '长标题未更新')
    const title = document.querySelector<HTMLElement>('.ui-toolbar-title')!
    title.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await waitFor(() => document.querySelector('[role="tooltip"]')?.textContent === longName, '截断的项目标题须能查看全文')
    const context = document.querySelector<HTMLElement>('.ui-toolbar-context')!
    assert(context.scrollWidth <= context.clientWidth + 1, '长标题不能挤掉确认进度和归档状态')
    title.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    button('切换项目').click()
    await waitFor(() => Boolean(document.querySelector('.menu-pop-bounded')), '长项目名切换菜单未打开')
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const menu = document.querySelector<HTMLElement>('.menu-pop-bounded')!
    const longLabel = [...menu.querySelectorAll<HTMLElement>('.menu-item-label')].find(item => item.textContent?.startsWith(longName))!
    assert(longLabel.scrollWidth > longLabel.clientWidth && longLabel.getBoundingClientRect().height <= 22, '长项目名须单行截断，不能覆盖相邻选项')
    assert(menu.getBoundingClientRect().right <= innerWidth - 7, '项目切换菜单不能越过窗口边界')
    longLabel.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await waitFor(() => document.querySelector('[role="tooltip"]')?.textContent === longName + '（已归档）', '截断的切换选项须能查看全文')
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await waitFor(() => !document.querySelector('[role="menu"]'), '切换菜单应可用 Escape 关闭')
    assert(router.state.location.pathname === `/backtests/${secondProject.id}`, '菜单 Escape 不得穿透回交易日志')
    useStore.setState({ backtestProjects: useStore.getState().backtestProjects.map(item => item.id === secondProject.id ? { ...item, name: '短项目名' } : item) })
    await waitFor(() => document.querySelector('.ui-toolbar-title')?.textContent === '短项目名', '短标题未更新')
    document.querySelector('.ui-toolbar-title')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 800))
    assert(!document.querySelector('[role="tooltip"]'), '完整可见的标题不应重复提示')
    const emptyProject = { ...project, id: 'bt-empty', name: '尚未开始' }
    const lossProject = { ...project, id: 'bt-loss', name: '亏损项目' }
    useStore.setState({
      backtestProjects: [...useStore.getState().backtestProjects, emptyProject, lossProject],
      trades: [...useStore.getState().trades, { ...record(1, lossProject.id), status: 'loss', rMultiple: -2 }],
    })
    button('切换项目').click()
    await waitFor(() => Boolean(document.querySelector('[role="menuitemradio"]')), '返回项目列表菜单未打开')
    button('全部项目').click()
    await waitFor(() => Boolean(document.querySelector('.backtest-project-row')), '项目总览未打开')
    assert(!document.querySelector('.backtest-project-head'), '项目总览应按对象组织，不能恢复报表列标题')
    const overviewFilter = document.querySelector('.backtest-filter-bar')!.getBoundingClientRect()
    const overviewRow = document.querySelector('.backtest-project-row')!.getBoundingClientRect()
    assert(overviewRow.top - overviewFilter.bottom <= 1, '项目列表须紧接公共筛选栏，不保留原报表空隙')
    const projectRow = document.querySelector<HTMLAnchorElement>(`a[href="/backtests/${project.id}"]`)!
    assert(projectRow.querySelector('.backtest-project-winrate')?.textContent === '100%' && projectRow.querySelector('.backtest-project-r')?.textContent === '200 R', '总览须直接显示当前项目胜率和总 R')
    assert(projectRow.querySelector('.backtest-project-meta')?.textContent?.includes('XAUUSD') && projectRow.querySelector('time')?.dateTime === project.startedAt, '项目身份区须保留固定品种与历史开始')
    const emptyRow = document.querySelector<HTMLAnchorElement>(`a[href="/backtests/${emptyProject.id}"]`)!
    assert(emptyRow.querySelector('.backtest-project-winrate')?.textContent === '—' && emptyRow.querySelector('.backtest-project-r')?.textContent === '—', '尚无结果的项目不得显示虚构零值')
    const lossRow = document.querySelector<HTMLAnchorElement>(`a[href="/backtests/${lossProject.id}"]`)!
    assert(lossRow.querySelector('.backtest-project-winrate')?.textContent === '0%' && lossRow.querySelector('.backtest-project-r.is-negative')?.textContent === '-2 R', '亏损项目应保留真实负 R 与业务色')
    button('已归档').click()
    await waitFor(() => document.querySelectorAll('.backtest-project-row').length === 1, '归档范围应只展示归档项目')
    assert(document.querySelector('.backtest-project-winrate')?.textContent === '100%' && document.querySelector('.backtest-project-r')?.textContent === '2 R', '归档不应丢失统计')
    escape()
    await waitFor(() => router.state.location.pathname === '/list', '项目总览 Escape 必须回交易日志')
  } finally {
    root.unmount()
    router.dispose()
    useStore.setState(previous, true)
    useShortcutStore.setState(previousShortcuts, true)
  }
}
window.__backtestListInteractionTest = run()
