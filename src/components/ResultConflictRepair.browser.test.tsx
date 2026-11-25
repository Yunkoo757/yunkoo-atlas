import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { TradeWorkbenchHeader } from './trades/TradeWorkbenchHeader'
import { resultRepairAnchor } from '@/hooks/useResultRepairReturn'
import { tradeReturnLocationState } from '@/hooks/useTradeReturnAnchor'
import type { Trade } from '@/data/trades'
import { ResultConflictRepair } from './ResultConflictRepair'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global { interface Window { __resultConflictRepairTest: Promise<void> } }

async function waitFor(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(message)
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const pending: Trade = {
  id: 'pending', ref: 'TRD-9', tradeKind: 'paper', symbol: 'EURUSD', side: 'long', status: 'win',
  conviction: 'medium', mistakeTags: [], reviewStatus: 'unreviewed', reviewCategory: 'normal',
  strategyId: 's', tags: [], note: '', entry: 1, exit: null, size: 0, pnl: null, rMultiple: null,
  openedAt: '2026-08-03', closedAt: '2026-08-04',
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const action = (text: string) => [...dialog()?.querySelectorAll('button') ?? []].find(button => button.textContent === text)
const rows = () => dialog()?.querySelectorAll<HTMLButtonElement>('li button')
const checkbox = () => dialog()?.querySelector<HTMLInputElement>('input[type="checkbox"]')

window.__resultConflictRepairTest = (async () => {
  const original = useStore.getState()
  const bridge = window.journalBridge
  const root = createRoot(document.getElementById('root')!)
  let opened = ''
  let unavailable = true
  let libraryId = 'isolated'
  let backupCalls = 0
  try {
    window.journalBridge = {
      isElectron: true,
      getManifest: async () => {
        if (unavailable) throw new Error('暂时无法读取资料库')
        return { libraryId }
      },
      createBackup: async () => { backupCalls++; return 'test-backup' },
    } as NonNullable<Window['journalBridge']>
    useStore.setState({ trades: [pending], display: { ...original.display, privacyMode: false } })
    const entry = createRef<{ reopen: (id?: string) => void }>()
    const render = (ids: string[]) => root.render(<ResultConflictRepair ref={entry} showCount ids={ids} onOpenTrade={id => { opened = id }} />)
    render([pending.id])
    await waitFor(() => !!document.querySelector('#root button'), '缺少核对入口')
    const trigger = document.querySelector<HTMLButtonElement>('#root button')!
    trigger.click()
    await waitFor(() => dialog()?.querySelector('[role="alert"]')?.textContent === '暂时无法读取资料库', '读取失败应显示反馈')
    unavailable = false
    expect(action('重新读取'), '缺少重试入口')
    action('重新读取')!.click()
    await waitFor(() => rows()?.length === 1, '重新读取后应显示一笔待补交易')
    expect(!dialog()?.querySelector('[role="alert"],footer'), '仅手工核对时应收起批量操作和上次错误')
    expect(dialog()?.querySelector('h3')?.textContent?.includes('待补结果'), '缺失结果应按原因归组')
    expect(rows()?.[0]?.textContent?.includes('登记状态 盈利'), '待补结果应保留所登记的盈亏状态')
    dialog()!.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click()
    await waitFor(() => !dialog() && document.activeElement === trigger, '关闭应将焦点还给核对入口')

    const conflicts: Trade[] = Array.from({ length: 6 }, (_, index) => ({
      ...pending, id: 'conflict-' + index, ref: 'FX-' + index,
      pnl: 0.00001234, cashCurrency: 'CNY', rMultiple: -1.25, resultSource: 'imported',
    }))
    const eligible: Trade = { ...pending, id: 'eligible', ref: 'FX-R', pnl: 0, rMultiple: -0.5, resultSource: 'imported' }
    const trades = [...conflicts, eligible]
    useStore.setState({ trades })
    render(trades.map(trade => trade.id))
    await waitFor(() => trigger.getAttribute('aria-label') === `核对交易结果，共 ${trades.length} 笔待核对` && trigger.textContent === `核对结果${trades.length} 笔`, '入口应已切换到新的待核对范围')
    trigger.click()
    await waitFor(() => rows()?.length === 5, '首页应显示四笔冲突和一笔可修正交易')
    expect(rows()?.[0].textContent?.includes('CN¥0.00001234'), '应保留实际币种和很小的非零金额')
    expect(action('备份并修正 1 笔')?.disabled && !checkbox()?.checked, '可修正记录必须先由用户确认')
    expect(rows()?.[4].textContent?.includes('改为亏损') && rows()?.[4].textContent?.includes('清空为未填写'), '预览应说明实际修正内容')
    useStore.setState(state => ({ display: { ...state.display, privacyMode: true } }))
    await waitFor(() => !!rows()?.[0].textContent?.includes('****'), '隐私模式应遮挡金额')
    expect(!dialog()?.textContent?.includes('0.00001234') && rows()?.[0].textContent?.includes('-1.25R'), '遮挡金额后仍应可核对 R')
    dialog()!.querySelector<HTMLButtonElement>('[aria-label="现金与 R 不一致下一页"]')!.click()
    await waitFor(() => rows()?.length === 3 && document.activeElement === rows()?.[0], '翻页后应聚焦新页首笔')
    expect(rows()?.[0].textContent?.includes('FX-4'), '第二页应展示后续的两笔冲突')
    rows()![0].click()
    await waitFor(() => !dialog() && opened === 'conflict-4', '整行应打开对应交易')
    entry.current!.reopen('conflict-5')
    await waitFor(() => rows()?.length === 3 && document.activeElement === rows()?.[1], '从详情返回须恢复到第二页的原交易')
    expect(!checkbox()?.checked, '回到清单必须重新核对批量修正')
    await waitFor(() => !!checkbox(), '再次打开应重新预览')
    checkbox()!.click()
    await waitFor(() => action('备份并修正 1 笔')?.disabled === false, '确认后应可执行')
    libraryId = 'switched'
    action('备份并修正 1 笔')!.click()
    await waitFor(() => !!action('重新预览') && !!dialog()?.querySelector('[role="alert"]'), '切换资料库后必须重新预览')
    expect(!checkbox() && backupCalls === 0, '旧预览不应执行修正')
    action('重新预览')!.click()
    await waitFor(() => action('备份并修正 1 笔')?.disabled === true && !checkbox()?.checked, '重试后必须重新确认')
    dialog()!.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click()
    await waitFor(() => !dialog(), '未关闭预览')
    useStore.setState({ trades: [] })
    trigger.click()
    await waitFor(() => !!dialog()?.textContent?.includes('当前范围的交易已全部核对'), '已处理的范围应显示完成状态')
    expect(!dialog()?.querySelector('footer,li') && backupCalls === 0, '没有候选时不应展示写入操作')

    const candidates = Array.from({ length: 150 }, (_, index) => ({
      ...pending, id: 'journal-' + index, ref: 'LOG-' + index,
    }))
    const journal = (view: 'list' | 'board', records: Trade[], returnId?: string) => {
      useStore.setState({ trades: records })
      root.render(<MemoryRouter key={view + (returnId ?? '')} initialEntries={[{
        pathname: '/' + view, state: returnId ? tradeReturnLocationState(resultRepairAnchor(returnId)) : undefined,
      }]}>
        <TradeWorkbenchHeader journal title="交易日志" view={view} onView={() => {}} filter={{type: 'all'}}
          trades={records} strategies={[]} onOpenResult={id => { opened = id }} />
      </MemoryRouter>)
    }
    const options = () => document.querySelector<HTMLButtonElement>('[aria-label="日志选项"]')
    const menuItem = () => document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-haspopup="dialog"]')
    journal('list', candidates)
    await waitFor(() => !!options(), '交易日志应有稳定的选项入口')
    expect(options()!.textContent === '' && !!options()!.querySelector('svg'), '日志选项以图标显示并保留可访问名称')
    expect(!document.querySelector('[data-workbench-result-repair]'), '列表工具栏不应常驻核对数量')
    options()!.click()
    await waitFor(() => menuItem()?.textContent === '核对交易结果150 笔', '当前日志的核对数量应在菜单中显示')
    const key = (el: HTMLElement, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}))
    const menu = document.querySelector<HTMLElement>('.display-pop')!
    key(menu, 'End')
    expect(document.activeElement === menuItem(), '日志选项应能用键盘定位核对操作')
    menuItem()!.click()
    await waitFor(() => rows()?.length === 4 && !document.querySelector('.display-pop:not(.ui-exit-clone)'), '选择核对后应关闭菜单并打开原有弹窗')
    dialog()!.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click()
    await waitFor(() => !dialog() && document.activeElement === options(), '核对弹窗关闭后应回到日志选项')
    journal('board', candidates, 'journal-12')
    await waitFor(() => document.activeElement?.closest('li')?.getAttribute('data-trade-id') === resultRepairAnchor('journal-12'), '从交易详情返回看板，应恢复到原核对页与交易')
    dialog()!.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!.click()
    await waitFor(() => !dialog() && document.activeElement === options(), '看板返回后仍可继续使用日志选项')
    const boardOptions = options()
    journal('list', [])
    await waitFor(() => !!options() && options() !== boardOptions && !dialog(), '零笔记录应保留日志选项')
    options()!.focus()
    options()!.click()
    await Promise.resolve()
    const firstItem = document.querySelector<HTMLElement>('.display-pop [role="menuitemcheckbox"]')
    expect(firstItem && document.activeElement === firstItem, '日志菜单打开后应立即接收键盘操作')
    expect(!menuItem() && !document.querySelector('[role="group"][aria-label="数据整理"]'), '无待处理记录时不应显示入口或分组标题')
    key(firstItem, 'Escape')
    await Promise.resolve()
    expect(options()!.getAttribute('aria-expanded') === 'false' && document.activeElement === options(), '立即按 Esc 应关闭菜单并返回三点按钮')

  } finally {
    root.unmount()
    useStore.setState(original, true)
    window.journalBridge = bridge
  }
})()
