import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
async function waitFor(check: () => boolean, message: string) { for (let i = 0; i < 120; i += 1) { if (check()) return; await frame() } throw new Error(message) }
function focusLink(link: HTMLAnchorElement): void {
  link.focus()
  assert(document.activeElement === link, `键盘必须能聚焦链接：${link.textContent}`)
}
function trade(id: string, day: string, patch: Partial<Trade> = {}): Trade { return { id, ref: `TRD-${id}`, symbol: 'BTCUSDT', side: 'long', status: 'win', conviction: 'medium', strategyId: 'strategy', tradeKind: 'live', tags: [], mistakeTags: [], reviewStatus: 'reviewed', reviewCategory: 'normal', entry: 100, exit: 110, size: 1, pnl: 100, rMultiple: 1, resultSource: 'imported', openedAt: day, closedAt: day, closedTradingDayKey: day, note: '', ...patch } }
async function run() {
  const element = document.getElementById('root'); assert(element, '缺少测试挂载节点')
  const previous = useStore.getState(); let root = createRoot(element)
  const cycles: LivePerformanceCycle[] = [{ id: 'members-only', name: '实盘-2025-12-01', startTradingDayKey: '2025-12-01', createdAt: '2025-12-01T00:00:00.000Z' }, { id: 'archive', name: '实盘-2026-01-01', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' }, { id: 'current', name: '实盘-2026-02-01', startTradingDayKey: '2026-02-01', createdAt: '2026-02-01T00:00:00.000Z' }]
  const old = Array.from({ length: 126 }, (_, i) => trade(`old-${i}`, '2026-01-15'))
  const source = old[0]!
  try {
    const singleBoundary: LivePerformanceCycle[] = [{ id: 'only-boundary', name: '实盘-2026-01-01', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' }]
    useStore.setState((state) => ({ trades: [trade('before-boundary', '2025-12-15')], livePerformanceCycles: singleBoundary, display: { ...state.display, tradingDayStartHour: 0 } }))
    root.render(<MemoryRouter key="single-boundary" initialEntries={['/live-archive']}><Routes><Route path="/live-archive" element={<LiveArchiveView />} /><Route path="/live-archive/:archiveId" element={<LiveArchiveView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('历史归档') ?? false, '单边界归档首页必须可达')
    assert(document.body.textContent?.includes('1 笔已平仓'), '单边界前的旧交易必须生成归档卡片')
    const earliestLink = document.querySelector<HTMLAnchorElement>('[data-archive-detail-link]')
    assert(earliestLink?.getAttribute('href') === '/live-archive/pre-cycle', '最早边界前归档必须使用稳定入口')
    earliestLink?.click()
    await waitFor(() => document.body.textContent?.includes('归档交易') ?? false, '最早边界前归档详情必须可达')
    assert(document.body.textContent?.includes('TRD-before-boundary'), '最早边界前交易必须能在详情回看')

    root.unmount(); root = createRoot(element)
    const incomplete = trade('incomplete', '2026-01-20', { pnl: null, rMultiple: null, resultSource: undefined })
    const membersOnly = trade('missed-only', '2025-12-15', { status: 'missed', pnl: null, rMultiple: null, resultSource: undefined })
    const deletedSource = { ...source, id: 'source-deleted', deletedAt: '2026-02-03T00:00:00.000Z' }
    useStore.setState((state) => ({ trades: [...old, incomplete, membersOnly, trade('current', '2026-02-02'), trade('pending', '2026-02-03', { closedAt: 'invalid', closedTradingDayKey: undefined }), { ...source, id: 'case-linked', ref: 'CAS-1', tradeKind: 'case', sourceTradeId: source.id }, { ...source, id: 'case-members-only', ref: 'CAS-ONLY', tradeKind: 'case', sourceTradeId: membersOnly.id }, { ...source, id: 'case-other', ref: 'CAS-2', tradeKind: 'case', sourceTradeId: 'current' }, deletedSource, { ...source, id: 'case-source-deleted', ref: 'CAS-DELETED', tradeKind: 'case', sourceTradeId: deletedSource.id }], livePerformanceCycles: cycles, liveStatsStartTradingDayKey: '2026-02-01', display: { ...state.display, tradingDayStartHour: 0 } }))
    root.render(<MemoryRouter key="archive-home" initialEntries={['/live-archive']}><Routes><Route path="/live-archive" element={<LiveArchiveView />} /><Route path="/live-archive/:archiveId" element={<LiveArchiveView />} /><Route path="/list" element={<div>日志入口</div>} /><Route path="/trade/:id" element={<DetailView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('历史归档') ?? false, '归档首页必须可达')
    assert(document.body.textContent?.includes('127 笔已平仓'), '卡片必须展示已平仓数量')
    assert(document.body.textContent?.includes('结果完整度'), '卡片必须展示结果完整度')
    assert(document.body.textContent?.includes('关联案例 1 个'), '案例计数只能按 sourceTradeId')
    assert(document.body.textContent?.includes('暂无已平仓记录'), '仅含日志成员的归档不能被隐藏')
    const liveStatus = document.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')
    assert(liveStatus?.textContent?.includes('历史归档首页'), '归档首页必须向辅助技术发布当前范围状态')
    assert(document.documentElement.scrollWidth <= window.innerWidth, `归档首页在 ${window.innerWidth}px 不得横向溢出`)
    const pending = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((link) => link.textContent?.includes('待整理'))
    assert(pending?.getAttribute('href') === '/list?statsCycle=pending', '待整理入口必须进入共享 pending 日志')
    assert(pending?.getAttribute('aria-label')?.includes('待整理记录'), '待整理数量不能仅依赖颜色或位置表达')
    const detailLink = document.querySelector<HTMLAnchorElement>('[data-archive-detail-link]')
    assert(detailLink, '归档卡片必须提供可聚焦的详情入口')
    focusLink(detailLink)
    detailLink.click()
    await waitFor(() => document.body.textContent?.includes('归档交易') ?? false, '归档详情必须可达')
    assert(document.body.textContent?.includes('平仓日期'), '详情筛选必须按平仓日期说明')
    const returnLink = document.querySelector<HTMLAnchorElement>('[data-archive-return]')
    assert(returnLink, '详情必须提供返回归档首页')
    assert(document.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')?.textContent?.includes('正在查看历史归档'), '归档详情必须向辅助技术发布固定范围状态')
    assert(document.documentElement.scrollWidth <= window.innerWidth, `归档详情在 ${window.innerWidth}px 不得横向溢出`)
    assert(document.body.textContent?.includes('待补结果'), '详情必须保留固定归档内的缺结果日志成员')
    const query = document.querySelector<HTMLInputElement>('[data-archive-query]')
    assert(query, '详情必须提供只读搜索')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(query, 'TRD-incomplete'); query.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => document.querySelectorAll('[data-archive-trade-row]').length === 1, '搜索必须只作用于固定归档成员')
    const from = document.querySelector<HTMLInputElement>('[data-archive-date-from]')
    assert(from, '详情必须提供平仓日期范围筛选')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(from, '2026-01-21'); from.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => document.querySelectorAll('[data-archive-trade-row]').length === 0, '日期筛选必须按平仓业务日过滤')
    focusLink(returnLink)
    returnLink.click()
    await waitFor(() => document.body.textContent?.includes('旧实盘记录会保留在这里') ?? false, '键盘必须能从归档详情返回归档首页')
    root.render(<MemoryRouter key="deleted-source-case" initialEntries={['/trade/case-source-deleted']}><Routes><Route path="/trade/:id" element={<DetailView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('来源已删除（来源不可用）') ?? false, '删除来源后案例仍必须可打开并说明来源不可用')

    root.render(<MemoryRouter key="archive-fact-edit" initialEntries={['/trade/old-0']}><Routes><Route path="/trade/:id" element={<DetailView />} /></Routes></MemoryRouter>)
    await waitFor(() => document.body.textContent?.includes('TRD-old-0') ?? false, '归档交易详情必须可打开')
    assert(!document.body.textContent?.includes('规则前'), '详情页不得把风险起算日投射为规则前徽标')
    const archiveBefore = JSON.stringify(useStore.getState().trades)
    ;[...document.querySelectorAll<HTMLButtonElement>('.dv-section-head')].find((button) => button.textContent?.trim() === '时间')?.click()
    await waitFor(() => Boolean(document.querySelector('.dv-datarow-btn')), '时间区必须可展开')
    ;[...document.querySelectorAll<HTMLButtonElement>('.dv-datarow-btn')].find((button) => button.textContent?.trim().startsWith('平仓'))?.click()
    await waitFor(() => Boolean(document.querySelector('[role="dialog"][aria-label="平仓日历"]')), '编辑平仓日必须打开日期选择器')
    document.querySelector<HTMLButtonElement>('button[aria-label="下个月"]')?.click()
    await waitFor(() => Boolean(document.querySelector('button[aria-label="2026-02-02"]')), '日期选择器必须可选择跨边界日期')
    document.querySelector<HTMLButtonElement>('button[aria-label="2026-02-02"]')?.click()
    await waitFor(() => document.body.textContent?.includes('保存后将离开当前归档') ?? false, '归档交易改到当前范围必须先确认')
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
    assert(moved?.closedAt === '2026-02-02', '确认后必须保存修改后的 closedAt')
    assert(moved && resolveLiveRecordBucket(moved, cycles, 0) === 'current', '确认后归档交易必须进入当前范围')

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

    const performanceTrades = Array.from({ length: 20_000 }, (_, index) => trade(`performance-${index}`, '2026-01-15'))
    useStore.setState((state) => ({
      trades: performanceTrades,
      livePerformanceCycles: [
        { id: 'performance-archive', name: '实盘-2026-01-01', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'performance-current', name: '实盘-2026-02-01', startTradingDayKey: '2026-02-01', createdAt: '2026-02-01T00:00:00.000Z' },
      ],
      display: { ...state.display, tradingDayStartHour: 0 },
    }))
    const homepageStartedAt = performance.now()
    root.render(<MemoryRouter key="archive-performance-home" initialEntries={['/live-archive']}><Routes><Route path="/live-archive" element={<LiveArchiveView />} /><Route path="/live-archive/:archiveId" element={<LiveArchiveView />} /></Routes></MemoryRouter>)
    await waitFor(() => Boolean(document.querySelector('[data-archive-detail-link]')), '两万笔归档首页必须保持可达')
    const homepageMs = performance.now() - homepageStartedAt
    const performanceDetail = document.querySelector<HTMLAnchorElement>('[data-archive-detail-link]')
    assert(performanceDetail, '两万笔归档首页必须保留详情入口')
    const detailStartedAt = performance.now()
    performanceDetail.click()
    await waitFor(() => document.querySelectorAll('[data-archive-trade-row]').length === 20_000, '两万笔归档详情必须完整渲染固定成员')
    const detailMs = performance.now() - detailStartedAt
    assert(homepageMs < 2_500, `两万笔归档首页首屏投影过慢：${homepageMs.toFixed(1)}ms`)
    assert(detailMs < 8_000, `两万笔归档详情渲染过慢：${detailMs.toFixed(1)}ms`)
    window.__liveArchivePerfMetrics = { homepageMs, detailMs }
  } finally { root.unmount(); useStore.setState({ trades: previous.trades, livePerformanceCycles: previous.livePerformanceCycles, display: previous.display }) }
}
window.__liveArchiveViewTest = run()
