import type { Trade } from '@/data/trades'
import type { Strategy } from '@/data/strategies'
import { fmtMoney, fmtR, fmtDate } from '@/lib/format'
import { getStrategyName } from '@/lib/strategies'
import { STATUS_META, CONVICTION_META } from '@/data/trades'
import { PreviewHeader, PreviewMeta } from '@/components/HoverPreview'
import './RowPreviews.css'

/** 交易行悬浮预览 */
export function TradePreview({
  trade,
  strategies,
}: {
  trade: Trade
  strategies: Strategy[]
}) {
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
            <span>{fmtMoney(trade.pnl)}</span>
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
