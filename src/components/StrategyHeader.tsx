import { useMemo } from 'react'
import { useStore } from '@/store/useStore'
import { computeStrategyStats } from '@/lib/strategies'
import { fmtMoney, fmtR } from '@/lib/format'
import './StrategyHeader.css'

/** 策略页统计条：标题已由 Topbar 承接，这里只保留轻量指标，避免双标题大 banner */
export function StrategyHeader({ strategyId }: { strategyId: string }) {
  const strategy = useStore((s) => s.getStrategy(strategyId))
  const trades = useStore((s) => s.trades)

  const stats = useMemo(
    () => computeStrategyStats(trades, strategyId),
    [trades, strategyId],
  )

  if (!strategy) return null

  return (
    <header className="sh" aria-label={`${strategy.name} 统计`}>
      <p className="sh-sub">
        {stats.tradeCount} 笔交易
        {stats.closedCount > 0 ? ` · ${stats.closedCount} 笔已平` : ''}
      </p>
      <div className="sh-stats">
        <div className="sh-stat">
          <span className="sh-stat-label">胜率</span>
          <span className="sh-stat-value">
            {stats.winRate == null ? '—' : `${stats.winRate.toFixed(0)}%`}
          </span>
        </div>
        <div className="sh-stat">
          <span className="sh-stat-label">总盈亏</span>
          <span
            className="sh-stat-value"
            style={{
              color:
                stats.closedCount === 0
                  ? 'var(--text-tertiary)'
                  : stats.totalPnl >= 0
                    ? 'var(--pos)'
                    : 'var(--neg)',
            }}
          >
            {stats.closedCount > 0 ? fmtMoney(stats.totalPnl) : '—'}
          </span>
        </div>
        <div className="sh-stat">
          <span className="sh-stat-label">总 R</span>
          <span
            className="sh-stat-value"
            style={{
              color:
                stats.closedCount === 0
                  ? 'var(--text-tertiary)'
                  : stats.totalR >= 0
                    ? 'var(--pos)'
                    : 'var(--neg)',
            }}
          >
            {stats.closedCount > 0 ? fmtR(stats.totalR) : '—'}
          </span>
        </div>
        <div className="sh-stat">
          <span className="sh-stat-label">均 R</span>
          <span className="sh-stat-value">
            {stats.averageR == null ? '—' : fmtR(stats.averageR)}
          </span>
        </div>
      </div>
    </header>
  )
}
