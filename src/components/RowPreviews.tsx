import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import { fmtMoney, fmtR, fmtDate } from '@/lib/format'
import { getStrategyName } from '@/lib/strategies'
import type { buildDashboardStats } from '@/lib/dashboardStats'
import { STATUS_META, CONVICTION_META } from '@/data/trades'
import { PreviewHeader, PreviewMeta } from '@/components/HoverPreview'
import { StrategyIcon } from '@/components/StrategyIcon'
import { useStore } from '@/store/useStore'
import './RowPreviews.css'

export type StrategyPreviewStats = ReturnType<typeof buildDashboardStats>['strategies'][number]

/** 交易行悬浮预览 */
export function TradePreview({
  trade,
  strategies,
}: {
  trade: Trade
  strategies: Strategy[]
}) {
  const privacyMode = useStore((state) => state.display.privacyMode)
  const statusMeta = STATUS_META[trade.status]
  const convictionMeta = CONVICTION_META[trade.conviction]
  const strategyName = getStrategyName(strategies, trade.strategyId)

  return (
    <div className="rp-card">
      <PreviewHeader
        icon={
          <span className="rp-status-ring" data-status={trade.status}>
            {statusMeta.label.charAt(0)}
          </span>
        }
        title={`${trade.symbol} ${trade.side === 'long' ? '多' : trade.side === 'short' ? '空' : ''}`}
        subtitle={strategyName}
      />
      <div className="rp-divider" />
      <PreviewMeta>
        <div className="rp-meta-grid">
          <span className="rp-meta-item">
            <span className="rp-meta-label">状态</span>
            <span>{statusMeta.label}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">信心</span>
            <span>{convictionMeta.label}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">开仓</span>
            <span>{fmtDate(trade.openedAt)}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">盈亏</span>
            <span>{fmtMoney(trade.pnl, privacyMode)}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">R</span>
            <span>{fmtR(trade.rMultiple)}</span>
          </span>
          <span className="rp-meta-item">
            <span className="rp-meta-label">编号</span>
            <span>{trade.ref}</span>
          </span>
        </div>
      </PreviewMeta>
      {trade.note && (
        <>
          <div className="rp-divider" />
          <p className="rp-note">{trade.note.replace(/<[^>]+>/g, '').slice(0, 120)}</p>
        </>
      )}
      {trade.tags && trade.tags.length > 0 && (
        <div className="rp-tags">
          {trade.tags.slice(0, 4).map((t) => (
            <span className="rp-tag" key={t}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** 策略胶囊悬浮统计：仅展示实盘中可信的已平结果。 */
export function StrategyPreview({
  strategyId,
  strategies,
  stats,
}: {
  strategyId: string
  strategies: Strategy[]
  stats: StrategyPreviewStats | null
}) {
  const privacyMode = useStore((state) => state.display.privacyMode)
  const strategy = strategies.find((item) => item.id === strategyId)
  const strategyName = strategy?.name ?? stats?.name ?? '未分类'

  return (
    <div className="sp-card">
      <PreviewHeader
        icon={strategy ? <StrategyIcon icon={strategy.icon} color={strategy.color} size={18} /> : undefined}
        title={strategyName}
      />
      <div className="rp-divider" />
      {!stats || stats.n === 0 ? (
        <p className="sp-empty">
          {stats?.closedCount ? `${stats.closedCount} 笔已平，暂无可信结果` : '暂无已完成的实盘交易'}
        </p>
      ) : (
        <div className="sp-summary">
          <span className="sp-outcomes">
            <span className="is-positive">盈利 {stats.wins}</span>
            <span className="is-negative">亏损 {stats.losses}</span>
            {stats.breakevens > 0 && <span>保本 {stats.breakevens}</span>}
          </span>
          <span className="sp-metric">
            净盈亏
            <strong className={stats.pnl > 0 ? 'is-positive' : stats.pnl < 0 ? 'is-negative' : ''}>
              {stats.pnlCount ? fmtMoney(stats.pnl, privacyMode) : '—'}
            </strong>
          </span>
          <span className="sp-metric">
            <strong>{stats.winRate === null ? '—' : `${stats.winRate.toFixed(0)}%`}</strong> 胜率
          </span>
          <span className="sp-metric">
            平均 R <strong>{stats.rCount ? fmtR(stats.averageR) : '—'}</strong>
          </span>
        </div>
      )}
    </div>
  )
}
