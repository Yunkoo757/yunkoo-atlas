import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Archive, ChevronRight } from '@/icons/appIcons'
import { Topbar } from '@/components/Topbar'
import type { Trade } from '@/data/trades'
import { fmtDate, fmtMoney, fmtR } from '@/lib/format'
import { formatYmd, parseLocalDate } from '@/lib/periods'
import { filterLiveLogRecords, listLiveArchiveProjections, resolveLiveArchiveScope, type LiveArchiveSummary } from '@/lib/liveStatisticsArchive'
import { resolveLivePerformanceCloseTradingDayKey } from '@/lib/livePerformanceCycles'
import { resolveTradeTruth, summarizeTradeResults } from '@/lib/tradeTruth'
import { tradeDetailPath, tradeDetailNavState } from '@/lib/tradeRoute'
import { useStore } from '@/store/useStore'
import './LiveArchiveView.css'

function rangeLabel(start: string | null, end: string | null): string {
  if (!start) return '较早记录'
  if (!end) return `${fmtDate(start)}起`
  const endDate = parseLocalDate(end)
  endDate.setDate(endDate.getDate() - 1)
  return `${fmtDate(start)} – ${fmtDate(formatYmd(endDate))}`
}

function summaryText(summary: LiveArchiveSummary): string {
  const result = summary.resultCompleteness
  if (result.closedCount === 0) return '暂无已平仓记录'
  const issues = [
    result.conflictCount > 0 ? `冲突 ${result.conflictCount}` : null,
    result.missingResultCount > 0 ? `待补 ${result.missingResultCount}` : null,
  ].filter((item): item is string => item !== null)
  return issues.length > 0
    ? `完整 ${result.validResultCount}/${result.closedCount} · ${issues.join(' · ')}`
    : `完整 ${result.validResultCount}/${result.closedCount}`
}

function ArchiveMetrics({ trades }: { trades: Trade[] }) {
  const metrics = summarizeTradeResults(trades)
  return <div className="la-card-metrics">
    <span><small>胜率</small><strong>{metrics.winRate == null ? '—' : `${metrics.winRate.toFixed(0)}%`}</strong></span>
    <span><small>净盈亏</small><strong className={metrics.totalPnl > 0 ? 'is-positive' : metrics.totalPnl < 0 ? 'is-negative' : ''}>{metrics.pnlCount ? fmtMoney(metrics.totalPnl, 'USD') : '—'}</strong></span>
    <span><small>平均 R</small><strong>{fmtR(metrics.averageR)}</strong></span>
  </div>
}

export function LiveArchiveView() {
  const { archiveId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const trades = useStore((state) => state.trades)
  const cycles = useStore((state) => state.livePerformanceCycles)
  const startHour = useStore((state) => state.display.tradingDayStartHour)
  const [query, setQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const cases = useMemo(() => trades.filter((trade) => trade.tradeKind === 'case'), [trades])
  const pendingCount = useMemo(() => filterLiveLogRecords(trades, resolveLiveArchiveScope(cycles, 'pending'), startHour).length, [trades, cycles, startHour])
  const archiveEntries = useMemo(() => listLiveArchiveProjections(trades, cases, cycles, startHour), [trades, cases, cycles, startHour])
  const summaries = archiveEntries.map((entry) => entry.summary)
  const summary = archiveId ? summaries.find((item) => item.archiveId === archiveId) : null
  const members = archiveId ? archiveEntries.find((item) => item.summary.archiveId === archiveId)?.members ?? [] : []
  const emptyPreCycle = archiveId === 'pre-cycle' && !summary
  const requestedKey = searchParams.get('requestedKey')
  const staleArchive = Boolean(archiveId && !summary && !emptyPreCycle)
  const missingArchiveKey = requestedKey ?? (staleArchive ? archiveId : null)
  const routeNotice = searchParams.get('archiveReason') === 'missing' && missingArchiveKey
    ? `原历史范围“${missingArchiveKey}”不存在，已返回历史归档首页。`
    : null
  useEffect(() => {
    if (emptyPreCycle) navigate('/live-archive', { replace: true })
    else if (staleArchive && archiveId) {
      navigate(`/live-archive?archiveReason=missing&requestedKey=${encodeURIComponent(archiveId)}`, { replace: true })
    }
  }, [archiveId, emptyPreCycle, navigate, staleArchive])
  const archiveStatus = summary
    ? `正在查看历史归档：${rangeLabel(summary.startTradingDayKey, summary.endExclusiveTradingDayKey)}，共 ${members.length} 条日志记录。`
    : `历史归档首页：${archiveEntries.length} 份可查看归档，待整理 ${pendingCount} 条记录。`
  const visibleMembers = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    return members.filter((trade) => {
      const day = resolveLivePerformanceCloseTradingDayKey(trade, startHour)
      return (!keyword || `${trade.ref} ${trade.symbol}`.toLocaleLowerCase().includes(keyword))
        && (!dateFrom || (day !== null && day >= dateFrom))
        && (!dateTo || (day !== null && day <= dateTo))
    })
  }, [members, query, dateFrom, dateTo, startHour])

  if (archiveId && !summary && !emptyPreCycle) {
    return <><Topbar title="历史归档" /><main className="la-scroll">{routeNotice ? <p className="la-route-notice" role="alert">{routeNotice}</p> : null}<section className="la-empty"><Archive size={24} aria-hidden /><h2>未找到这个归档</h2><Link to="/live-archive">返回历史归档</Link></section></main></>
  }
  if (summary) {
    return <>
      <Topbar title="归档交易" subtitle={rangeLabel(summary.startTradingDayKey, summary.endExclusiveTradingDayKey)} />
      <main className="la-scroll">
        <p className="la-sr-status" role="status" aria-live="polite">{archiveStatus}</p>
        <div className="la-detail-head"><Link data-archive-return className="la-back" to="/live-archive"><ArrowLeft size={15} />返回历史归档</Link><span>平仓日期范围内的只读记录</span></div>
        <section className="la-detail-summary"><strong>{summary.resultCompleteness.closedCount} 笔已平仓</strong><span>结果完整度：{summaryText(summary)}</span><span>关联案例 {summary.associatedCaseCount} 个</span></section>
        <div className="la-filters" aria-label="归档只读筛选">
          <label>搜索<input data-archive-query value={query} onChange={(event) => setQuery(event.target.value)} placeholder="编号或品种" /></label>
          <label>平仓日期<input data-archive-date-from type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label>至<input data-archive-date-to type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        </div>
        <section className="la-trade-list" aria-label="归档交易列表">
          {visibleMembers.map((trade) => {
            const truth = resolveTradeTruth(trade)
            const state = trade.status === 'missed' ? '错过机会' : truth.hasConflict ? '结果冲突' : !truth.isResultComplete ? '待补结果' : trade.status === 'win' ? '盈利' : trade.status === 'loss' ? '亏损' : '保本'
            return <Link data-archive-trade-row key={trade.id} className="la-trade-row" to={tradeDetailPath(trade)} state={tradeDetailNavState({ pathname: `/live-archive/${encodeURIComponent(summary.archiveId)}`, anchorTradeId: trade.id })}><div><strong>{trade.symbol}</strong><span>{trade.ref} · {fmtDate(resolveLivePerformanceCloseTradingDayKey(trade, startHour) ?? '')}</span></div><div><span>{state}</span><strong>{truth.isResultComplete ? fmtMoney(trade.pnl, trade.cashCurrency ?? null) : '—'}</strong></div></Link>
          })}
          {visibleMembers.length === 0 ? <p className="la-no-results">当前筛选没有归档记录</p> : null}
        </section>
      </main>
    </>
  }
  return <>
    <Topbar title="历史归档" subtitle="旧实盘记录会保留在这里" />
    <main className="la-scroll">
      {routeNotice ? <p className="la-route-notice" role="alert">{routeNotice}</p> : null}
      <p className="la-sr-status" role="status" aria-live="polite">{archiveStatus}</p>
      <div className="la-page-head"><div><h2>历史归档</h2><p>重新开始后，旧记录仍可随时回看。</p></div><div className="la-page-actions"><Link className="la-pending" to="/import-data-health">导入日期核对</Link><Link data-pending-log-link className="la-pending" aria-label={`查看待整理记录，共 ${pendingCount} 条`} to="/list?statsCycle=pending" state={tradeDetailNavState({ pathname: archiveId ? `/live-archive/${encodeURIComponent(archiveId)}` : '/live-archive' })}>待整理 {pendingCount}</Link></div></div>
      {archiveEntries.length ? <div className="la-cards">{archiveEntries.map(({ summary: item }) => <article className="la-card" key={item.archiveId}><div className="la-card-head"><div><h3>{rangeLabel(item.startTradingDayKey, item.endExclusiveTradingDayKey)}</h3><p>{item.resultCompleteness.closedCount ? `${item.resultCompleteness.closedCount} 笔已平仓` : '暂无已平仓记录'}</p></div><span className="la-completeness">结果完整度 · {summaryText(item)}</span></div><ArchiveMetrics trades={item.trades} /><div className="la-card-foot"><span>关联案例 {item.associatedCaseCount} 个</span><Link data-archive-detail-link to={`/live-archive/${encodeURIComponent(item.archiveId)}`}>查看归档交易 <ChevronRight size={14} /></Link></div></article>)}</div> : <section className="la-empty"><Archive size={24} aria-hidden /><h2>还没有可查看的历史归档</h2><p>开启新一轮当前实盘后，旧的已平仓记录会显示在这里。</p></section>}
    </main>
  </>
}
