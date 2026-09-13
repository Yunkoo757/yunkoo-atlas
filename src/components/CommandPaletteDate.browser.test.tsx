import { useState } from 'react'
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
    tradeKind: i % 3 === 0 ? 'case' : i % 3 === 1 ? 'paper' : 'live',
    openedAt: '2024-05-18', recordedAt: '2026-09-13', closedAt: null, entry: 1, exit: 2, size: 1, pnl: 1, rMultiple: 1, note: '',
  }))
  useStore.setState({ trades, strategies: [] })
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
    assert(new Set([...document.querySelectorAll('.cmdk-item-source')].map((e) => e.textContent)).size === 3, '缺少日志、模拟盘或案例来源')
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
    click('.cmdk-clear')
    await waitFor(() => document.querySelector<HTMLInputElement>('.cmdk-input')?.value === '', '清除失败')
    assert(!document.querySelector('.cmdk-item-date'), '清除应恢复命令导航')
  } finally { root.unmount(); useStore.setState(original) }
}
window.__commandPaletteDateTest = run()
