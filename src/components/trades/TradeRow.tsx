import { Bell, Check, Star } from 'lucide-react'
import type { Strategy } from '@/data/strategies'
import { REVIEW_CATEGORY_META, resolveTimeframe, type Trade } from '@/data/trades'
import { StatusIcon, SideTag } from '@/components/StatusIcon'
import { SymbolIcon } from '@/components/SymbolIcon'
import { StrategyLabel } from '@/components/StrategyIcon'
import { fmtDate, fmtMoney, fmtR } from '@/lib/format'
import { getTradeSessionMeta, getVisibleTradeTags } from '@/lib/tradeView'
import { Tooltip } from '@/components/ui/Tooltip'
import { useStore } from '@/store/useStore'

export type TradeRowProps = {
  trade: Trade
  strategies: Strategy[]
  selected: boolean
  focused: boolean
  starred: boolean
  followed: boolean
  onOpen: (trade: Trade) => void
  onSelect: (trade: Trade) => void
  onToggleStar: (trade: Trade) => void
  onContextMenu?: (event: React.MouseEvent, trade: Trade) => void
}

export function TradeRow({
  trade,
  strategies,
  selected,
  focused,
  starred,
  followed,
  onOpen,
  onSelect,
  onToggleStar,
  onContextMenu,
}: TradeRowProps) {
  const showResult = trade.status !== 'planned' && trade.status !== 'open'
  const session = getTradeSessionMeta(trade)
  const timeframe = resolveTimeframe(trade.timeframe)
  const symbolIcons = useStore((state) => state.symbolIcons)
  const regularTags = getVisibleTradeTags(trade, 2)
  const reviewLabel =
    regularTags.visible.length === 0 &&
    trade.mistakeTags.length === 0 &&
    trade.reviewCategory !== 'normal'
      ? REVIEW_CATEGORY_META[trade.reviewCategory].label
      : null

  return (
    <div
      className={'trade-row' + (selected ? ' is-selected' : '') + (focused ? ' is-focused' : '')}
      data-trade-id={trade.id}
      onContextMenu={(event) => onContextMenu?.(event, trade)}
    >
      <button
        type="button"
        className="trade-row-open"
        aria-label={`打开 ${trade.symbol} ${trade.ref}`}
        onClick={() => onOpen(trade)}
      />
      <button
        type="button"
        className={'trade-row-check' + (selected ? ' is-selected' : '')}
        aria-label={selected ? '取消选择' : '选择交易'}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(trade)
        }}
      >
        {selected && <Check size={11} />}
      </button>
      <span className="trade-row-status"><StatusIcon status={trade.status} /></span>
      <span className="trade-row-ref">{trade.ref}</span>
      <span className="trade-row-symbol trade-row-primary">
        <span className="trade-row-symbol-main">
          <SymbolIcon symbol={trade.symbol} overrides={symbolIcons} size={16} />
          <strong>{trade.symbol}</strong>
        </span>
        <SideTag side={trade.side} quiet />
        <span className="trade-row-strategy">
          <StrategyLabel strategyId={trade.strategyId} strategies={strategies} size={14} />
        </span>
      </span>
      <span className="trade-row-tags">
        {session && (
          <Tooltip content={session.raw} label={`交易时段：${session.raw}`}>
            <span className={`trade-row-session is-${session.kind}`}>
              {session.label}
            </span>
          </Tooltip>
        )}
        {regularTags.visible.map((tag) => (
          <Tooltip content={tag} label={`标签：${tag}`} key={tag}>
            <span className="trade-row-tag">{tag}</span>
          </Tooltip>
        ))}
        {reviewLabel && (
          <Tooltip content={reviewLabel} label={`复盘分类：${reviewLabel}`}>
            <span className="trade-row-tag is-review">{reviewLabel}</span>
          </Tooltip>
        )}
        {regularTags.hiddenCount > 0 && (
          <Tooltip
            content={regularTags.hidden.join(' · ')}
            label={`其余标签：${regularTags.hidden.join('、')}`}
            focusable
          >
            <span className="trade-row-more">+{regularTags.hiddenCount}</span>
          </Tooltip>
        )}
        {trade.mistakeTags.slice(0, 1).map((tag) => (
          <Tooltip content={tag} label={`错误标签：${tag}`} key={tag}>
            <span className="trade-row-tag is-mistake">{tag}</span>
          </Tooltip>
        ))}
        {trade.mistakeTags.length > 1 && (
          <Tooltip
            content={trade.mistakeTags.slice(1).join(' · ')}
            label={`其余错误标签：${trade.mistakeTags.slice(1).join('、')}`}
            focusable
          >
            <span className="trade-row-more is-mistake-more">
              +{trade.mistakeTags.length - 1}
            </span>
          </Tooltip>
        )}
      </span>
      <span className="trade-row-timeframe-slot">
        <span className="trade-row-timeframe" title={`波段级别 ${timeframe}`}>
          {timeframe}
        </span>
      </span>
      <span className={'trade-row-pnl' + (trade.pnl > 0 ? ' is-positive' : trade.pnl < 0 ? ' is-negative' : ' is-zero')}>
        {showResult ? fmtMoney(trade.pnl) : '—'}
      </span>
      <span className={'trade-row-r' + (trade.rMultiple > 0 ? ' is-positive' : trade.rMultiple < 0 ? ' is-negative' : ' is-zero')}>
        {showResult ? fmtR(trade.rMultiple) : '—'}
      </span>
      <span className="trade-row-date">{fmtDate(trade.openedAt)}</span>
      <span className="trade-row-end">
        {followed && <Bell size={12} className="trade-row-followed" aria-label="已置顶关注" />}
        <button
          type="button"
          className={'trade-row-star' + (starred ? ' is-starred' : '')}
          aria-label={starred ? '取消星标' : '星标交易'}
          onClick={(event) => {
            event.stopPropagation()
            onToggleStar(trade)
          }}
        >
          <Star size={13} fill={starred ? 'currentColor' : 'none'} />
        </button>
      </span>
    </div>
  )
}
