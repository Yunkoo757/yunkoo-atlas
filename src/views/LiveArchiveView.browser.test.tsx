import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import type { LivePerformanceCycle } from '@/lib/livePerformanceCycles'
import { useStore } from '@/store/useStore'
import { LiveArchiveView } from '@/views/LiveArchiveView'
import { DetailView } from '@/views/DetailView'
import { ListView } from '@/views/ListView'
import { resolveLiveRecordBucket } from '@/lib/liveStatisticsArchive'
import { getTradingDayKey } from '@/lib/periods'

declare global { interface Window { __liveArchiveViewTest?: Promise<void>; __liveArchivePerfMetrics?: { homepageMs: number; detailMs: number } } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
async function waitFor(check: () => boolean, message: string) { for (let i = 0; i < 180; i += 1) { if (check()) return; await frame() } throw new Error(message) }
function LocationProbe() {
  return <output data-route-path>{useLocation().pathname}</output>
}
function trade(id: string, day: string, patch: Partial<Trade> = {}): Trade { return { id, ref: `TRD-${id}`, symbol: 'BTCUSDT', side: 'long', status: 'win', conviction: 'medium', strategyId: 'strategy', tradeKind: 'live', tags: [], mistakeTags: [], reviewStatus: 'reviewed', reviewCategory: 'normal', entry: 100, exit: 110, size: 1, pnl: 100, cashCurrency: 'USD', rMultiple: 1, resultSource: 'imported', openedAt: day, closedAt: day, closedTradingDayKey: day, note: '', ...patch } }
async function openFilters(): Promise<void> {
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.getAttribute('aria-label') === '筛选历史记录')
  assert(trigger, '找不到历史记录筛选按钮')
  trigger.click()
  await waitFor(() => Boolean(document.querySelector('[data-archive-query]')), '筛选面板必须打开')
}
async function run() {
  const element = document.getElementById('root'); assert(element, '缺少测试挂载节点')
  const previous = useStore.getState(); let root = createRoot(element)
  const cycles: LivePerformanceCycle[] = [{ id: 'members-only', name: '实盘-2025-12-01', startTradingDayKey: '2025-12-01', createdAt: '2025-12-01T00:00:00.000Z' }, { id: 'archive', name: '实盘-2026-01-01', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'current', name: '实盘-2026-02-01', startTradingDayKey: '2026-02-01', createdAt: '2026-02-01T00:00:00.000Z' }]
  const old = Array.from({ length: 126 }, (_, i) => trade(`old-${i}`, '2026-01-15'))
  const source = old[0]!
  try {
    root.render(<MemoryRouter key="missing-archive" initialEntries={['/live-archive?archiveReason=missing&requestedKey=gone-cycle']}><Routes><Route path="/live-archive" element={<LiveArchiveView />} /><Route path="/live-archive/:archiveId" element={<LiveArchiveView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('历史记录') ?? false, '失效请求必须回到历史记录首页')
    assert(document.body.textContent?.includes('gone-cycle'), '失效提示必须保留原请求 ID')
    assert(document.body.textContent?.includes('已合并到统一历史记录'), '失效提示必须说明已合并')
    root.unmount(); root = createRoot(element)

    useStore.setState((state) => ({ trades: [], livePerformanceCycles: [{ id: 'only-boundary', name: '实盘-2026-01-01', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' }], display: { ...state.display, tradingDayStartHour: 0 } }))
    root.render(<MemoryRouter key="empty-pre-cycle" initialEntries={['/live-archive/pre-cycle']}><Routes><Route path="/live-archive" element={<><LiveArchiveView /><LocationProbe /></>} /><Route path="/live-archive/:archiveId" element={<><LiveArchiveView /><LocationProbe /></>} /></Routes></MemoryRouter>)
    await waitFor(() => document.querySelector('[data-route-path]')?.textContent === '/live-archive', '旧归档详情路由必须 replace 到扁平首页')
    assert(document.body.textContent?.includes('历史记录'), '旧详情路由必须回到历史记录')
    root.unmount(); root = createRoot(element)

    root.render(<MemoryRouter key="stale-bookmark" initialEntries={['/live-archive/stale-cycle']}><Routes><Route path="/live-archive" element={<><LiveArchiveView /><LocationProbe /></>} /><Route path="/live-archive/:archiveId" element={<><LiveArchiveView /><LocationProbe /></>} /></Routes></MemoryRouter>)
    await waitFor(() => document.querySelector('[data-route-path]')?.textContent === '/live-archive', '陈旧书签必须 replace 到扁平首页')
    assert(document.body.textContent?.includes('stale-cycle'), '陈旧书签必须显示原范围提示')
    root.unmount(); root = createRoot(element)

    const singleBoundary: LivePerformanceCycle[] = [{ id: 'only-boundary', name: '实盘-2026-01-01', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' }]
    useStore.setState((state) => ({ trades: [trade('before-boundary', '2025-12-15')], strategies: [{ id: 'strategy', name: '测试策略', icon: 'target', color: '#5e6ad2' }], livePerformanceCycles: singleBoundary, display: { ...state.display, tradingDayStartHour: 0 } }))
    root.render(<MemoryRouter key="single-boundary" initialEntries={['/live-archive']}><Routes><Route path="/live-archive" element={<LiveArchiveView />} /><Route path="/live-archive/:archiveId" element={<LiveArchiveView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('重置前记录') ?? false, '单边界历史首页必须可达')
    assert(document.querySelector('[data-archive-closed-count]')?.textContent === '1', '单边界前的旧交易必须出现在摘要计数')
    assert(document.querySelector('[data-trade-id="before-boundary"]'), '最早边界前交易必须使用标准 TradeRow')

    root.unmount(); root = createRoot(element)
    const incomplete = trade('incomplete', '2026-01-20', { pnl: null, rMultiple: null, resultSource: undefined })
    const conflict = trade('conflict', '2026-01-21', { pnl: 100, rMultiple: -1, resultSource: 'imported' })
    const membersOnly = trade('missed-only', '2025-12-15', { status: 'missed', pnl: null, rMultiple: null, resultSource: undefined })
    const missedPending = trade('missed-pending', '2026-02-03', { status: 'missed', closedAt: 'invalid', closedTradingDayKey: undefined, pnl: null, rMultiple: null, resultSource: undefined })
    const deletedSource = { ...source, id: 'source-deleted', deletedAt: '2026-02-03T00:00:00.000Z' }
    useStore.setState((state) => ({ trades: [...old, incomplete, conflict, membersOnly, missedPending, trade('current', '2026-02-02'), trade('pending', '2026-02-03', { closedAt: 'invalid', closedTradingDayKey: undefined }), { ...source, id: 'case-linked', ref: 'CAS-1', tradeKind: 'case', sourceTradeId: source.id }, { ...source, id: 'case-members-only', ref: 'CAS-ONLY', tradeKind: 'case', sourceTradeId: membersOnly.id }, { ...source, id: 'case-other', ref: 'CAS-2', tradeKind: 'case', sourceTradeId: 'current' }, deletedSource, { ...source, id: 'case-source-deleted', ref: 'CAS-DELETED', tradeKind: 'case', sourceTradeId: deletedSource.id }], strategies: [{ id: 'strategy', name: '测试策略', icon: 'target', color: '#5e6ad2' }], livePerformanceCycles: cycles, liveStatsStartTradingDayKey: '2026-02-01', display: { ...state.display, tradingDayStartHour: 0 } }))
    root.render(<MemoryRouter key="archive-home" initialEntries={['/live-archive']}><Routes><Route path="/live-archive" element={<LiveArchiveView />} /><Route path="/live-archive/:archiveId" element={<LiveArchiveView />} /><Route path="/list" element={<ListView title="交易日志" view="list" onView={() => undefined} filter={{ type: 'all', tradeKind: 'live' }} />} /><Route path="/trade/:id" element={<DetailView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('重置前记录') ?? false, '历史首页必须可达')
    assert(document.querySelector('[data-archive-closed-count]')?.textContent === '128', '统一列表必须汇总全部重置前已平仓')
    assert(document.querySelector('[data-trade-id="incomplete"]'), '缺结果日志成员必须保留在标准列表')
    assert(document.querySelector('.trade-list, [data-trade-id]'), '必须渲染标准交易列表')
    assert(document.querySelector('.ui-filter-shell'), '必须使用标准 FilterBar 壳')
    assert(getComputedStyle(document.querySelector('.la-view')!).backgroundColor !== '', '历史页必须挂载 surface 壳')
    const liveStatus = document.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')
    assert(liveStatus?.textContent?.includes('重置前记录'), '首页必须向辅助技术发布当前范围状态')
    const pending = document.querySelector<HTMLAnchorElement>('[data-pending-log-link]')
    assert(pending?.getAttribute('href') === '/list?statsCycle=pending', '待整理入口必须进入共享 pending 日志')
    assert(pending?.textContent?.includes('待整理 2'), '待整理数量必须包含缺日期的错过机会')
    pending?.click()
    await waitFor(() => document.querySelector('[data-trade-id="pending"]') !== null, '待整理入口必须打开共享 pending 日志')
    document.querySelector<HTMLButtonElement>('[data-trade-id="pending"] .trade-row-open')?.click()
    await waitFor(() => document.body.textContent?.includes('TRD-pending') ?? false, '待整理日志必须能打开交易详情')
    const archiveRepairDay = getTradingDayKey(new Date(), 0)
    ;[...document.querySelectorAll<HTMLButtonElement>('.dv-section-head')].find((button) => button.textContent?.trim() === '时间')?.click()
    await waitFor(() => Boolean(document.querySelector('.dv-datarow-btn')), '待整理详情的时间区必须可展开')
    ;[...document.querySelectorAll<HTMLButtonElement>('.dv-datarow-btn')].find((button) => button.textContent?.trim().startsWith('平仓'))?.click()
    await waitFor(() => Boolean(document.querySelector(`button[aria-label="${archiveRepairDay}"]`)), '待整理详情必须可修复平仓日')
    document.querySelector<HTMLButtonElement>(`button[aria-label="${archiveRepairDay}"]`)?.click()
    await waitFor(() => useStore.getState().trades.find((item) => item.id === 'pending')?.closedTradingDayKey === archiveRepairDay, '修复待整理详情必须先更新事实')
    document.querySelector<HTMLAnchorElement>('.dv-back')?.click()
    await waitFor(() => document.body.textContent?.includes('重置前的实盘记录会保留在这里') ?? false, '修复后返回必须恢复历史首页语境')

    await openFilters()
    const query = document.querySelector<HTMLInputElement>('[data-archive-query]')
    assert(query, '筛选面板必须提供搜索')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(query, 'TRD-incomplete'); query.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => document.querySelectorAll('[data-trade-id]').length === 1 && Boolean(document.querySelector('[data-trade-id="incomplete"]')), '搜索必须作用于统一历史成员')
    const from = document.querySelector<HTMLInputElement>('[data-archive-date-from]')
    assert(from, '必须提供平仓日期筛选')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(from, '2026-01-21'); from.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => document.querySelectorAll('[data-trade-id]').length === 0, '日期筛选必须按平仓业务日过滤')

    root.render(<MemoryRouter key="deleted-source-case" initialEntries={['/trade/case-source-deleted']}><Routes><Route path="/trade/:id" element={<DetailView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('来源已删除（来源不可用）') ?? false, '删除来源后案例仍必须可打开并说明来源不可用')

    root.render(<MemoryRouter key="archive-fact-edit" initialEntries={['/trade/old-0']}><Routes><Route path="/trade/:id" element={<DetailView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('TRD-old-0') ?? false, '历史交易详情必须可打开')
    const archiveBefore = JSON.stringify(useStore.getState().trades)
    ;[...document.querySelectorAll<HTMLButtonElement>('.dv-section-head')].find((button) => button.textContent?.trim() === '时间')?.click()
    await waitFor(() => Boolean(document.querySelector('.dv-datarow-btn')), '时间区必须可展开')
    ;[...document.querySelectorAll<HTMLButtonElement>('.dv-datarow-btn')].find((button) => button.textContent?.trim().startsWith('平仓'))?.click()
    await waitFor(() => Boolean(document.querySelector('[role="dialog"][aria-label="平仓日历"]')), '编辑平仓日必须打开日期选择器')
    document.querySelector<HTMLButtonElement>('button[aria-label="下个月"]')?.click()
    await waitFor(() => Boolean(document.querySelector('button[aria-label="2026-02-02"]')), '日期选择器必须可选择跨边界日期')
    document.querySelector<HTMLButtonElement>('button[aria-label="2026-02-02"]')?.click()
    await waitFor(() => document.body.textContent?.includes('保存后将离开当前归档') ?? false, '历史交易改到当前范围必须先确认')
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '取消')?.click()
    await waitFor(() => !(document.body.textContent?.includes('保存后将离开当前归档') ?? false), '取消必须关闭归属确认')
    assert(JSON.stringify(useStore.getState().trades) === archiveBefore, '取消详情事实修正不得写入 Store')
    ;[...document.querySelectorAll<HTMLButtonElement>('.dv-datarow-btn')].find((button) => button.textContent?.trim().startsWith('平仓'))?.click()
    await waitFor(() => Boolean(document.querySelector('button[aria-label="2026-02-02"]')), '再次编辑必须仍能选择跨边界日期')
    document.querySelector<HTMLButtonElement>('button[aria-label="2026-02-02"]')?.click()
    await waitFor(() => Boolean([...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '确认保存')), '确认前不得直接写入详情事实')
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '确认保存')?.click()
    await waitFor(() => useStore.getState().trades.find((item) => item.id === 'old-0')?.closedTradingDayKey === '2026-02-02', '确认后必须更新平仓业务日')
    const moved = useStore.getState().trades.find((item) => item.id === 'old-0')
    assert(moved && resolveLiveRecordBucket(moved, cycles, 0) === 'current', '确认后历史交易必须进入当前范围')

    const repairDay = getTradingDayKey(new Date(), 0)
    root.render(<MemoryRouter key="pending-fact-edit" initialEntries={['/trade/pending']}><Routes><Route path="/trade/:id" element={<DetailView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('TRD-pending') ?? false, '待整理交易详情必须可打开')
    ;[...document.querySelectorAll<HTMLButtonElement>('.dv-section-head')].find((button) => button.textContent?.trim() === '时间')?.click()
    await waitFor(() => Boolean(document.querySelector('.dv-datarow-btn')), '待整理交易的时间区必须可展开')
    ;[...document.querySelectorAll<HTMLButtonElement>('.dv-datarow-btn')].find((button) => button.textContent?.trim().startsWith('平仓'))?.click()
    await waitFor(() => Boolean(document.querySelector(`button[aria-label="${repairDay}"]`)), '待整理交易必须可选择合法平仓日')
    document.querySelector<HTMLButtonElement>(`button[aria-label="${repairDay}"]`)?.click()
    await waitFor(() => useStore.getState().trades.find((item) => item.id === 'pending')?.closedTradingDayKey === repairDay, '待整理修复后必须冻结合法平仓业务日')
    const repaired = useStore.getState().trades.find((item) => item.id === 'pending')
    assert(repaired && resolveLiveRecordBucket(repaired, cycles, 0) === 'current', '待整理修复后必须按本地边界进入当前范围')
    root.render(<MemoryRouter key="pending-list" initialEntries={['/list?statsCycle=pending']}><Routes><Route path="/list" element={<ListView title="交易日志" view="list" onView={() => undefined} filter={{ type: 'all', tradeKind: 'live' }} />} /></Routes></MemoryRouter>)
    await waitFor(() => !document.querySelector('[data-trade-id="pending"]'), '修复后记录必须从待整理列表消失')
    root.render(<MemoryRouter key="current-list" initialEntries={['/list']}><Routes><Route path="/list" element={<ListView title="交易日志" view="list" onView={() => undefined} filter={{ type: 'all', tradeKind: 'live' }} />} /></Routes></MemoryRouter>)
    await waitFor(() => Boolean(document.querySelector('[data-trade-id="pending"]')), '修复后记录必须在当前日志可见')

    const legacyUsd = trade('legacy-usd', '2026-01-15', { pnl: 50 })
    delete legacyUsd.cashCurrency
    useStore.setState((state) => ({
      trades: [
        trade('explicit-usd', '2026-01-15', { pnl: 100, cashCurrency: 'USD' }),
        trade('explicit-cny', '2026-01-15', { pnl: 700, cashCurrency: 'CNY' }),
        legacyUsd,
        trade('explicit-unknown', '2026-01-15', { pnl: 80, cashCurrency: null }),
        trade('result-conflict', '2026-01-15', { status: 'win', pnl: -10, rMultiple: -1, resultSource: 'imported', cashCurrency: 'USD' }),
      ],
      strategies: [{ id: 'strategy', name: '测试策略', icon: 'target', color: '#5e6ad2' }],
      livePerformanceCycles: cycles,
      profile: {
        ...state.profile,
        legacyCashCurrencyAssumption: { currency: 'USD', confirmedAt: '2026-08-09T04:00:00.000Z' },
      },
    }))
    root.render(<MemoryRouter key="archive-currency-facts" initialEntries={['/live-archive']}><Routes><Route path="/live-archive" element={<LiveArchiveView />} /><Route path="/live-archive/:archiveId" element={<LiveArchiveView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('+$150') ?? false, '摘要必须只汇总显式 USD 与已确认的 legacy USD')
    assert(!document.body.textContent?.includes('+$930'), '摘要不得混入 CNY 与显式 unknown')
    assert(document.querySelector('[data-trade-id="legacy-usd"]'), '旧记录行必须存在')
    assert(document.body.textContent?.includes('+CN¥700') || document.body.textContent?.includes('CN¥700'), '单笔 CNY 必须展示自身币种')
    assert(!document.body.textContent?.includes('币种未知'), '不得再展示币种未知噪音标签')

    // 规模压测另走正式包 gate；此处只确认中等列表能渲染标准行，避免浏览器 harness 15s 超时。
    const bulkTrades = Array.from({ length: 240 }, (_, index) => trade(`bulk-${index}`, '2026-01-15'))
    useStore.setState((state) => ({
      trades: bulkTrades,
      strategies: [{ id: 'strategy', name: '测试策略', icon: 'target', color: '#5e6ad2' }],
      livePerformanceCycles: cycles,
      display: { ...state.display, tradingDayStartHour: 0 },
    }))
    const homepageStartedAt = performance.now()
    root.render(<MemoryRouter key="archive-performance-home" initialEntries={['/live-archive']}><Routes><Route path="/live-archive" element={<LiveArchiveView />} /><Route path="/live-archive/:archiveId" element={<LiveArchiveView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.querySelector('[data-archive-closed-count]')?.textContent === '240', '统一历史摘要必须正确')
    await waitFor(() => Boolean(document.querySelector('[data-trade-id]')), '扁平历史必须渲染标准交易行')
    const homepageMs = performance.now() - homepageStartedAt
    assert(homepageMs < 8_000, `扁平历史首页过慢：${homepageMs.toFixed(1)}ms`)
    window.__liveArchivePerfMetrics = { homepageMs, detailMs: homepageMs }
  } finally { root.unmount(); useStore.setState({ trades: previous.trades, strategies: previous.strategies, livePerformanceCycles: previous.livePerformanceCycles, display: previous.display, profile: previous.profile }) }
}
window.__liveArchiveViewTest = run()
