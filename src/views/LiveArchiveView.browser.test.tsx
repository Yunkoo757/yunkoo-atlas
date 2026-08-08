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
  const cycles: LivePerformanceCycle[] = [{ id: 'archive', name: '实盘-2026-01-01', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'current', name: '实盘-2026-02-01', startTradingDayKey: '2026-02-01', createdAt: '2026-02-01T00:00:00.000Z' }]
  const old = Array.from({ length: 126 }, (_, i) => trade(`old-${i}`, '2026-01-15'))
  const source = old[0]!
  try {
    useStore.setState((state) => ({ trades: [...old, trade('current', '2026-02-02'), trade('pending', '2026-02-03', { closedAt: 'invalid', closedTradingDayKey: undefined }), { ...source, id: 'case-linked', ref: 'CAS-1', tradeKind: 'case', sourceTradeId: source.id }, { ...source, id: 'case-other', ref: 'CAS-2', tradeKind: 'case', sourceTradeId: 'current' }], livePerformanceCycles: cycles, display: { ...state.display, tradingDayStartHour: 0 } }))
    root.render(<MemoryRouter initialEntries={['/live-archive']}><Routes><Route path="/live-archive" element={<LiveArchiveView />} /><Route path="/live-archive/:archiveId" element={<LiveArchiveView />} /><Route path="/list" element={<div>日志入口</div>} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('历史归档') ?? false, '归档首页必须可达')
    assert(document.body.textContent?.includes('126 笔已平仓'), '卡片必须展示已平仓数量')
    assert(document.body.textContent?.includes('结果完整度'), '卡片必须展示结果完整度')
    assert(document.body.textContent?.includes('关联案例 1 个'), '案例计数只能按 sourceTradeId')
    const pending = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((link) => link.textContent?.includes('待整理'))
    assert(pending?.getAttribute('href') === '/list?statsCycle=pending', '待整理入口必须进入共享 pending 日志')
    document.querySelector<HTMLAnchorElement>('[data-archive-detail-link]')?.click()
    await waitFor(() => document.body.textContent?.includes('归档交易') ?? false, '归档详情必须可达')
    assert(document.body.textContent?.includes('平仓日期'), '详情筛选必须按平仓日期说明')
    assert(Boolean(document.querySelector('[data-archive-return]')), '详情必须提供返回归档首页')
  } finally { root.unmount(); useStore.setState({ trades: previous.trades, livePerformanceCycles: previous.livePerformanceCycles, display: previous.display }) }
}
window.__liveArchiveViewTest = run()
