import { useMemo } from 'react'
import { StrategyIcon } from '@/components/StrategyIcon'
import { useStore } from '@/store/useStore'
import { computeStrategyStats } from '@/lib/strategies'
import { fmtMoney, fmtR } from '@/lib/format'
import './StrategyHeader.css'

export function StrategyHeader({ strategyId }: { strategyId: string }) {
  const strategy = useStore((s) => s.getStrategy(strategyId))
  const trades = useStore((s) => s.trades)

  const stats = useMemo(
    () => computeStrategyStats(trades, strategyId),
    [trades, strategyId],
  )

  if (!strategy) return null

  return (
    <header className="sh">
      <div className="sh-main">
        <StrategyIcon icon={strategy.icon} color={strategy.color} size={22} />
        <div className="sh-info">
          <h1 className="sh-name" style={{ color: strategy.color }}>
            {strategy.name}
          </h1>
          <p className="sh-sub">
            {stats.tradeCount} 笔交易
            {stats.closedCount > 0 && ` · ${stats.closedCount} 笔已平`}
          </p>
        </div>
      </div>
      <div className="sh-stats">
        <div className="sh-stat">
          <span className="sh-stat-label">胜率</span>
          <span className="sh-stat-value">
            {stats.closedCount > 0 ? `${stats.winRate.toFixed(0)}%` : '—'}
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
            {stats.closedCount > 0 ? fmtR(stats.averageR) : '—'}
          </span>
        </div>
      </div>
    </header>
  )
}
