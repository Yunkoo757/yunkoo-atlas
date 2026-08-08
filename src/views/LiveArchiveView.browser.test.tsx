import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import { useStore } from '@/store/useStore'
import { LiveArchiveView } from '@/views/LiveArchiveView'

declare global { interface Window { __liveArchiveViewTest?: Promise<void> } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
async function waitFor(check: () => boolean, message: string) { for (let i = 0; i < 120; i += 1) { if (check()) return; await frame() } throw new Error(message) }
function trade(id: string, day: string, patch: Partial<Trade> = {}): Trade { return { id, ref: `TRD-${id}`, symbol: 'BTCUSDT', side: 'long', status: 'win', conviction: 'medium', strategyId: 'strategy', tradeKind: 'live', tags: [], mistakeTags: [], reviewStatus: 'reviewed', reviewCategory: 'normal', entry: 100, exit: 110, size: 1, pnl: 100, rMultiple: 1, resultSource: 'imported', openedAt: day, closedAt: day, closedTradingDayKey: day, note: '', ...patch } }
async function run() {
  const element = document.getElementById('root'); assert(element, '缺少测试挂载节点')
  const previous = useStore.getState(); const root = createRoot(element)
  const cycles: LivePerformanceCycle[] = [{ id: 'members-only', name: '实盘-2025-12-01', startTradingDayKey: '2025-12-01', createdAt: '2025-12-01T00:00:00.000Z' }, { id: 'archive', name: '实盘-2026-01-01', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'current', name: '实盘-2026-02-01', startTradingDayKey: '2026-02-01', createdAt: '2026-02-01T00:00:00.000Z' }]
  const old = Array.from({ length: 126 }, (_, i) => trade(`old-${i}`, '2026-01-15'))
  const source = old[0]!
  try {
    const incomplete = trade('incomplete', '2026-01-20', { pnl: null, rMultiple: null, resultSource: undefined })
    const membersOnly = trade('missed-only', '2025-12-15', { status: 'missed', pnl: null, rMultiple: null, resultSource: undefined })
    useStore.setState((state) => ({ trades: [...old, incomplete, membersOnly, trade('current', '2026-02-02'), trade('pending', '2026-02-03', { closedAt: 'invalid', closedTradingDayKey: undefined }), { ...source, id: 'case-linked', ref: 'CAS-1', tradeKind: 'case', sourceTradeId: source.id }, { ...source, id: 'case-members-only', ref: 'CAS-ONLY', tradeKind: 'case', sourceTradeId: membersOnly.id }, { ...source, id: 'case-other', ref: 'CAS-2', tradeKind: 'case', sourceTradeId: 'current' }], livePerformanceCycles: cycles, display: { ...state.display, tradingDayStartHour: 0 } }))
    root.render(<MemoryRouter initialEntries={['/live-archive']}><Routes><Route path="/live-archive" element={<LiveArchiveView />} /><Route path="/live-archive/:archiveId" element={<LiveArchiveView />} /><Route path="/list" element={<div>日志入口</div>} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('历史归档') ?? false, '归档首页必须可达')
    assert(document.body.textContent?.includes('127 笔已平仓'), '卡片必须展示已平仓数量')
    assert(document.body.textContent?.includes('结果完整度'), '卡片必须展示结果完整度')
    assert(document.body.textContent?.includes('关联案例 1 个'), '案例计数只能按 sourceTradeId')
    assert(document.body.textContent?.includes('暂无已平仓记录'), '仅含日志成员的归档不能被隐藏')
    const pending = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((link) => link.textContent?.includes('待整理'))
    assert(pending?.getAttribute('href') === '/list?statsCycle=pending', '待整理入口必须进入共享 pending 日志')
    document.querySelector<HTMLAnchorElement>('[data-archive-detail-link]')?.click()
    await waitFor(() => document.body.textContent?.includes('归档交易') ?? false, '归档详情必须可达')
    assert(document.body.textContent?.includes('平仓日期'), '详情筛选必须按平仓日期说明')
    assert(Boolean(document.querySelector('[data-archive-return]')), '详情必须提供返回归档首页')
    assert(document.body.textContent?.includes('待补结果'), '详情必须保留固定归档内的缺结果日志成员')
    const query = document.querySelector<HTMLInputElement>('[data-archive-query]')
    assert(query, '详情必须提供只读搜索')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(query, 'TRD-incomplete'); query.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => document.querySelectorAll('[data-archive-trade-row]').length === 1, '搜索必须只作用于固定归档成员')
    const from = document.querySelector<HTMLInputElement>('[data-archive-date-from]')
    assert(from, '详情必须提供平仓日期范围筛选')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(from, '2026-01-21'); from.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => document.querySelectorAll('[data-archive-trade-row]').length === 0, '日期筛选必须按平仓业务日过滤')
  } finally { root.unmount(); useStore.setState({ trades: previous.trades, livePerformanceCycles: previous.livePerformanceCycles, display: previous.display }) }
}
window.__liveArchiveViewTest = run()
