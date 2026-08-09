import { useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import { computeStrategyStats, formatStrategyMetricCoverage } from '@/lib/strategies'
import { fmtMoney, fmtR } from '@/lib/format'
import {
  filterTradesByAnalysisScope,
  type AnalysisScope,
} from '@/lib/analysisScope'
import { filterTradesByFacets } from '@/lib/tradeView'
import { parseTradeFacets } from '@/lib/workbenchTrades'
import { resolveLiveRoute } from '@/lib/livePerformanceCycleRoute'
import { filterLivePerformanceRecords } from '@/lib/liveStatisticsArchive'
import { Tooltip } from '@/components/ui/Tooltip'
import './StrategyHeader.css'

/** 策略页统计条：标题已由 Topbar 承接，这里只保留轻量指标，避免双标题大 banner */
export function StrategyHeader({
  strategyId,
  analysisScope,
  search = '',
}: {
  strategyId: string
  analysisScope?: AnalysisScope
  search?: string
}) {
  const strategy = useStore((s) => s.getStrategy(strategyId))
  const trades = useStore((s) => s.trades)
  const privacyMode = useStore((s) => s.display.privacyMode)
  const tradingDayStartHour = useStore((s) => s.display.tradingDayStartHour)
  const livePerformanceCycles = useStore((s) => s.livePerformanceCycles)
  const legacyCashCurrencyAssumption = useStore((s) => s.profile.legacyCashCurrencyAssumption)
  const [, setSearchParams] = useSearchParams()
  const businessDateAnchor = useBusinessDateAnchor()
  const localDateKey = businessDateAnchor.currentTradingDayKey
  const facets = useMemo(() => {
    const parsed = parseTradeFacets(search)
    return analysisScope?.kind && analysisScope.kind !== 'all'
      ? { ...parsed, tradeKind: undefined }
      : parsed
  }, [analysisScope?.kind, search])
  const performanceRoute = resolveLiveRoute(search, livePerformanceCycles, 'strategy')
  const canonicalPerformanceSearch = performanceRoute.canonicalSearch
  const needsPerformanceReplace = performanceRoute.needsReplace

  useEffect(() => {
    if (!needsPerformanceReplace) return
    setSearchParams(new URLSearchParams(canonicalPerformanceSearch), { replace: true })
  }, [canonicalPerformanceSearch, needsPerformanceReplace, setSearchParams])

  const stats = useMemo(() => {
    const cycleScopedTrades = performanceRoute.target.kind === 'archive-home'
      ? []
      : (() => {
          const scoped = filterLivePerformanceRecords(trades, performanceRoute.target.scope, tradingDayStartHour)
          const ids = new Set(scoped.map((trade) => trade.id))
          return trades.filter((trade) => trade.tradeKind !== 'live' || ids.has(trade.id))
        })()
    const scoped = analysisScope
      ? filterTradesByAnalysisScope(
        cycleScopedTrades,
        analysisScope,
        businessDateAnchor,
        tradingDayStartHour,
      )
      : cycleScopedTrades
    return computeStrategyStats(
      filterTradesByFacets(scoped, facets, tradingDayStartHour, businessDateAnchor),
      strategyId,
      { tradeKind: analysisScope ? 'all' : 'live', legacyCashCurrencyAssumption },
    )
  }, [
      trades,
      strategyId,
      analysisScope?.kind,
      analysisScope?.range,
      search,
      facets,
      localDateKey,
      businessDateAnchor,
      tradingDayStartHour,
      livePerformanceCycles,
      canonicalPerformanceSearch,
      performanceRoute.target,
      legacyCashCurrencyAssumption,
    ])

  const scopeLabel = analysisScope
    ? `${analysisScope.kind === 'live' ? '实盘' : analysisScope.kind === 'paper' ? '模拟' : '全部类型'} · ${
        analysisScope.range === 'all'
          ? '全部时间'
          : analysisScope.range === 'this-week'
            ? '本周'
            : analysisScope.range === 'this-month'
              ? '本月'
              : analysisScope.range === '30d'
                ? '近30天'
                : analysisScope.range === '90d'
                  ? '近90天'
                  : '本年'
      } · 按平仓日`
    : null
  const pendingResultCount = Math.max(
    0,
    stats.closedCount - stats.evaluatedCount - stats.conflictCount,
  )
  const pnlCoverage = formatStrategyMetricCoverage(stats.pnlCount, stats.closedCount)
  const rCoverage = formatStrategyMetricCoverage(stats.rCount, stats.closedCount)

  if (!strategy) return null

  return (
    <header className="sh" aria-label={`${strategy.name} 统计`}>
      <p className="sh-sub">
        {scopeLabel ? `${scopeLabel} · ${stats.closedCount} 笔已平` : `${stats.tradeCount} 笔交易`}
        {!scopeLabel && stats.closedCount > 0 ? ` · ${stats.closedCount} 笔已平` : ''}
        {pendingResultCount > 0 ? ` · ${pendingResultCount} 笔待补结果` : ''}
        {stats.conflictCount > 0 ? ` · ${stats.conflictCount} 笔结果冲突` : ''}
      </p>
      <div className="sh-stats">
        <div className="sh-stat">
          <span className="sh-stat-label">胜率</span>
          <span className="sh-stat-value">
            {stats.winRate == null ? '—' : `${stats.winRate.toFixed(0)}%`}
          </span>
        </div>
        {pnlCoverage ? (
          <Tooltip asChild content={`净盈亏仅 ${pnlCoverage}`} label={`净盈亏仅 ${pnlCoverage}`}>
            <div className="sh-stat">
              <span className="sh-stat-label">
                净盈亏 · {stats.pnlCount}/{stats.closedCount}
              </span>
              <span
                className="sh-stat-value"
                style={{
                  color:
                    privacyMode || stats.totalPnl == null
                      ? 'var(--text-tertiary)'
                      : stats.totalPnl >= 0
                        ? 'var(--pos)'
                        : 'var(--neg)',
                }}
              >
                {fmtMoney(stats.totalPnl, 'USD', privacyMode)}
              </span>
            </div>
          </Tooltip>
        ) : (
          <div className="sh-stat">
            <span className="sh-stat-label">净盈亏</span>
            <span
              className="sh-stat-value"
              style={{
                color:
                  privacyMode || stats.totalPnl == null
                    ? 'var(--text-tertiary)'
                    : stats.totalPnl >= 0
                      ? 'var(--pos)'
                      : 'var(--neg)',
              }}
            >
              {fmtMoney(stats.totalPnl, 'USD', privacyMode)}
            </span>
          </div>
        )}
        {rCoverage ? (
          <Tooltip asChild content={`总 R 仅 ${rCoverage}`} label={`总 R 仅 ${rCoverage}`}>
            <div className="sh-stat">
              <span className="sh-stat-label">
                总 R · {stats.rCount}/{stats.closedCount}
              </span>
              <span
                className="sh-stat-value"
                style={{
                  color:
                    stats.totalR == null
                      ? 'var(--text-tertiary)'
                      : stats.totalR >= 0
                        ? 'var(--pos)'
                        : 'var(--neg)',
                }}
              >
                {fmtR(stats.totalR)}
              </span>
            </div>
          </Tooltip>
        ) : (
          <div className="sh-stat">
            <span className="sh-stat-label">总 R</span>
            <span
              className="sh-stat-value"
              style={{
                color:
                  stats.totalR == null
                    ? 'var(--text-tertiary)'
                    : stats.totalR >= 0
                      ? 'var(--pos)'
                      : 'var(--neg)',
              }}
            >
              {fmtR(stats.totalR)}
            </span>
          </div>
        )}
        <div className="sh-stat">
          <span className="sh-stat-label">均 R</span>
          <span className="sh-stat-value">
            {fmtR(stats.averageR)}
          </span>
        </div>
      </div>
    </header>
  )
}
