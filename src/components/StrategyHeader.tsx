import { useMemo } from 'react'
import { useStore } from '@/store/useStore'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { computeStrategyStats, formatStrategyMetricCoverage } from '@/lib/strategies'
import { fmtMoney, fmtR } from '@/lib/format'
import {
  filterTradesByAnalysisScope,
  type AnalysisScope,
} from '@/lib/analysisScope'
import { filterTradesByFacets } from '@/lib/tradeView'
import { parseTradeFacets } from '@/lib/workbenchTrades'
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
  const localDateKey = useLocalDateKey()
  const facets = useMemo(() => {
    const parsed = parseTradeFacets(search)
    return analysisScope?.kind && analysisScope.kind !== 'all'
      ? { ...parsed, tradeKind: undefined }
      : parsed
  }, [analysisScope?.kind, search])

  const stats = useMemo(() => {
    const scoped = analysisScope ? filterTradesByAnalysisScope(trades, analysisScope) : trades
    return computeStrategyStats(
      filterTradesByFacets(scoped, facets),
      strategyId,
      { tradeKind: analysisScope ? 'all' : 'live' },
    )
  }, [
      trades,
      strategyId,
      analysisScope?.kind,
      analysisScope?.range,
      facets,
      localDateKey,
    ])

  const scopeLabel = analysisScope
    ? `${analysisScope.kind === 'live' ? '实盘' : analysisScope.kind === 'paper' ? '模拟' : '全部类型'} · ${
        analysisScope.range === 'all'
          ? '全部时间'
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
        <div className="sh-stat" title={pnlCoverage ? `总盈亏仅 ${pnlCoverage}` : undefined}>
          <span className="sh-stat-label">
            总盈亏{pnlCoverage ? ` · ${stats.pnlCount}/${stats.closedCount}` : ''}
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
            {fmtMoney(stats.totalPnl, privacyMode)}
          </span>
        </div>
        <div className="sh-stat" title={rCoverage ? `总 R 仅 ${rCoverage}` : undefined}>
          <span className="sh-stat-label">
            总 R{rCoverage ? ` · ${stats.rCount}/${stats.closedCount}` : ''}
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
