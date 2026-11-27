import { useState } from 'react'
import { flushSync } from 'react-dom'
import { createQuickNote } from '@/data/quickNotes'
import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { CommandPalette } from './CommandPalette'
import { useStore } from '@/store/useStore'
import type { Trade } from '@/data/trades'
import type { CommandSearchSession } from '@/lib/commandDateSearch'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global { interface Window { __commandPaletteDateTest?: Promise<void> } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function waitFor(check: () => boolean, message: string) {
  const end = performance.now() + 4000
  while (!check()) {
    if (performance.now() > end) throw new Error(message)
    await new Promise(requestAnimationFrame)
  }
}
function queryInput(value: string) {
  const input = document.querySelector<HTMLInputElement>('.cmdk-input')!
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
function click(selector: string) { document.querySelector<HTMLButtonElement>(selector)!.click() }
const results = () => document.querySelectorAll<HTMLButtonElement>('.cmdk-item')
function Harness() {
  const [open, setOpen] = useState(true)
  const location = useLocation()
  const navigate = useNavigate()
  const session = (location.state as { commandSearch?: CommandSearchSession } | null)?.commandSearch
  return <>
    <output id="command-route">{location.pathname + location.search}</output>
    <button id="opener" onClick={() => setOpen(true)}>搜索</button>
    {session && <Link id="return-search" to={session.origin} state={{ restoreCommandSearch: session }}>返回搜索结果</Link>}
    <button id="history-back" onClick={() => navigate(-1)}>历史返回</button>
    <CommandPalette open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} />
  </>
}
async function run() {
  const original = useStore.getState()
  const trades: Trade[] = Array.from({ length: 137 }, (_, i) => ({
    id: `date-${String(i).padStart(3, '0')}`, ref: `TRD-${i}`, symbol: 'GBPUSD', strategyId: '', tags: ['回调'], mistakeTags: [],
    side: 'long', status: 'win', conviction: 'medium', reviewStatus: 'unreviewed', reviewCategory: 'normal',
    tradeKind: (['case', 'paper', 'live', 'backtest'] as const)[i % 4]!,
    openedAt: '2024-05-18', recordedAt: '2026-09-13', closedAt: null, entry: 1, exit: 2, size: 1, pnl: 1, rMultiple: 1, note: '',
  }))
  const note = { ...createQuickNote(), id: 'memo', title: '晨盘观察' }
  useStore.setState({ trades, strategies: [], quickNotes: [note] })
  const root = createRoot(document.getElementById('root')!)
  root.render(<MemoryRouter initialEntries={['/list?view=active']}><Harness /></MemoryRouter>)
  try {
    await waitFor(() => !!document.querySelector('.cmdk-input'), '搜索未打开')
    queryInput('20240')
    await waitFor(() => !!document.querySelector('.cmdk-empty')?.textContent?.includes('继续输入月份'), '缺少不完整日期提示')
    queryInput('20240230')
    await waitFor(() => document.querySelector('.cmdk-input')?.getAttribute('aria-invalid') === 'true', '无效日期未就地标记')
    queryInput('202405 GBPUSD')
    await waitFor(() => results().length === 60, '首批结果应为 60 项')
    assert(document.querySelector('.cmdk-result-note')?.textContent?.includes('137'), '总数应涵盖所有来源')
    assert(new Set([...document.querySelectorAll('.cmdk-item-source')].map((e) => e.textContent)).size === 4, '日志、模拟盘、回测和案例应各自标明来源')
    assert(document.querySelectorAll('.cmdk-item-date').length === 60, '每条结果须显示日期')
    click('.cmdk-result-note button')
    await waitFor(() => results().length === 120, '鼠标加载第二批失败')
    const list = document.querySelector<HTMLElement>('.cmdk-list')!
    results()[119]!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    await waitFor(() => results()[119]?.getAttribute('aria-selected') === 'true', '无法选中批次最后一项')
    document.querySelector('.cmdk-input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await waitFor(() => results().length === 137, '方向键无法越过批次边界')
    await waitFor(() => results()[120]?.getAttribute('aria-selected') === 'true', '方向键应选中新批次第一项')
    list.scrollTop = list.scrollHeight
    const selected = results()[125]!.textContent
    results()[125]!.click()
    await waitFor(() => !document.querySelector('.cmdk'), '打开详情应关闭搜索')
    click('#return-search')
    await waitFor(() => results().length === 137, '返回未恢复加载批次')
    await waitFor(() => document.querySelector('.cmdk-item.is-active')?.textContent === selected, '返回未恢复选中记录')
    assert(document.querySelector<HTMLInputElement>('.cmdk-input')?.value === '202405 GBPUSD', '返回未恢复关键词')
    await waitFor(() => document.querySelector<HTMLElement>('.cmdk-list')!.scrollTop > 0, '返回未恢复滚动位置')
    // 再次打开详情，验证原生历史返回也能恢复搜索。
    results()[125]!.click()
    await waitFor(() => !document.querySelector('.cmdk'), '再次打开详情失败')
    click('#history-back')
    await waitFor(() => results().length === 137, '历史返回未恢复搜索')
    queryInput('202405 EURUSD')
    await waitFor(() => !!document.querySelector('.cmdk-empty'), '日期与关键词应同时匹配')
    queryInput('TRD-136')
    await waitFor(() => results().length === 1, '普通编号搜索被日期规则干扰')
    // 同一事件轮次模拟打字后一刻就回车，旧选项应当留在屏幕且不可执行。
    const oldResult = results()[0]!
    flushSync(() => queryInput('晨盘观察'))
    assert(oldResult.isConnected && oldResult.getAttribute('aria-disabled') === 'true', '搜索更新时不应清空或激活旧结果')
    assert(!oldResult.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })), '旧结果不可在按下时抢走输入焦点')
    oldResult.click()
    assert(document.querySelector('.cmdk'), '旧结果劫持了新查询')
    document.querySelector('.cmdk-input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await waitFor(() => document.getElementById('command-route')?.textContent === '/notes/memo' && !document.querySelector('.cmdk'),
      '快速回车应进入最新查询命中的随记')
    click('#history-back')
    await waitFor(() => document.querySelector('.cmdk-item.is-active')?.textContent?.includes(note.title) === true,
      '从随记返回应恢复原搜索及所选项目')
    assert(document.querySelector<HTMLInputElement>('.cmdk-input')?.value === note.title, '从随记返回丢失关键词')
    assert(!document.querySelector('.cmdk-result-note'), '全部匹配项均已展示时无需显示加载栏')
    click('.cmdk-clear')
    await waitFor(() => document.querySelector<HTMLInputElement>('.cmdk-input')?.value === '' &&
      document.querySelector('.cmdk-list')?.getAttribute('aria-busy') === 'false', '清除失败')
    assert(!document.querySelector('.cmdk-item-date'), '清除应恢复命令导航')
    queryInput('设置')
    await waitFor(() => results().length === 10, '搜索设置应列出全部十个设置分区')
    queryInput('风险管理')
    await waitFor(() => results().length === 1 && results()[0]?.textContent?.includes('风险管理') === true,
      '特定设置应可通过名称直接检索')
    document.querySelector('.cmdk-input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await waitFor(() => document.getElementById('command-route')?.textContent === '/settings/risk' &&
      !document.querySelector('.cmdk'), 'Enter 应直接进入选中的设置页')
    click('#opener')
    const reopened = () => document.querySelector<HTMLInputElement>('.cmdk-input')
    await waitFor(() => reopened()?.value === '风险管理' && reopened()?.selectionStart === 0 &&
      reopened()?.selectionEnd === '风险管理'.length, '再次打开时保留上次搜索并选中关键词，允许直接输入新搜索')
  } finally { root.unmount(); useStore.setState(original) }
}
window.__commandPaletteDateTest = run()
