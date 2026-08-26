import { ICON_SM } from '@/icons/iconSize'
import { memo } from 'react'
import { Star } from '@/icons/appIcons'
import type { Strategy } from '@/data/strategies'
import { CASE_TYPE_META, REVIEW_CATEGORY_META, resolveTimeframe, type Trade } from '@/data/trades'
import { StatusIcon, SideTag } from '@/components/StatusIcon'
import { SymbolIcon } from '@/components/SymbolIcon'
import type { StrategyPreviewStats } from '@/components/RowPreviews'
import { SelectionBox } from '@/components/ui/SelectionBox'
import { fmtDate, fmtMoney, fmtR } from '@/lib/format'
import { formatTradeCashPnl } from '@/lib/cashCurrency'
import { getTradeSessionMeta, getVisibleTradeTags } from '@/lib/tradeView'
import type { SymbolIconsMap } from '@/lib/symbolIcons'
import { Tooltip } from '@/components/ui/Tooltip'
import { useStore } from '@/store/useStore'
import { TradeRowLayout } from './TradeRowLayout'
import { TradeRowStrategy } from './TradeRowStrategy'

export type TradeRowProps = {
  trade: Trade
  strategies: Strategy[]
  strategyStats?: StrategyPreviewStats | null
  selected: boolean
  focused: boolean
  starred: boolean
  selectable?: boolean
  ariaPosInSet?: number
  ariaSetSize?: number
  ariaDescribedBy?: string
  /** 由列表父级传入，避免每行订阅 store */
  symbolIcons?: SymbolIconsMap
  onOpen: (trade: Trade) => void
  onSelect: (trade: Trade) => void
  onToggleStar: (trade: Trade) => void
  onContextMenu?: (event: React.MouseEvent, trade: Trade) => void
}

export const TradeRow = memo(function TradeRow({
  trade,
  strategies,
  strategyStats = null,
  selected,
  focused,
  starred,
  selectable = true,
  ariaPosInSet,
  ariaSetSize,
  ariaDescribedBy,
  symbolIcons: symbolIconsProp,
  onOpen,
  onSelect,
  onToggleStar,
  onContextMenu,
}: TradeRowProps) {
  const showResult = trade.status !== 'planned' && trade.status !== 'open'
  const isMissed = trade.status === 'missed'
  const privacyMode = useStore((state) => state.display.privacyMode)
  const legacyCashCurrencyAssumption = useStore((state) => state.profile.legacyCashCurrencyAssumption)
  const session = getTradeSessionMeta(trade)
  const timeframe = resolveTimeframe(trade.timeframe)
  const symbolIconsFromStore = useStore((state) =>
    symbolIconsProp === undefined ? state.symbolIcons : null,
  )
  const symbolIcons = symbolIconsProp ?? symbolIconsFromStore ?? {}
  const regularTags = getVisibleTradeTags(trade, 0)
  const mistakeTags = {
    visible: trade.mistakeTags.slice(0, 2),
    hidden: trade.mistakeTags.slice(2),
    hiddenCount: Math.max(0, trade.mistakeTags.length - 2),
  }
  const reviewLabel =
    isMissed
      ? null
      : trade.tradeKind === 'case' && trade.caseType
      ? CASE_TYPE_META[trade.caseType].label
      : trade.reviewCategory !== 'normal'
        ? REVIEW_CATEGORY_META[trade.reviewCategory].label
        : null

  return (
    <TradeRowLayout
      tradeId={trade.id}
      ariaPosInSet={ariaPosInSet}
      ariaSetSize={ariaSetSize}
      ariaDescribedBy={ariaDescribedBy}
      focused={focused}
      selected={selected}
      openAction={{
        ariaLabel: `打开 ${trade.symbol} ${trade.ref}`,
        onClick: () => onOpen(trade),
        primary: true,
      }}
      check={selectable ? (
        <SelectionBox
          checked={selected}
          label={selected ? '取消选择' : '选择交易'}
          onToggle={() => onSelect(trade)}
          className="trade-row-check"
        />
      ) : (
        <span className="trade-row-check-spacer" aria-hidden />
      )}
      status={<StatusIcon status={trade.status} />}
      reference={trade.ref}
      symbol={
        <>
          <span className="trade-row-symbol-main">
            <SymbolIcon symbol={trade.symbol} overrides={symbolIcons} size={ICON_SM} />
            <strong>{trade.symbol}</strong>
          </span>
          <SideTag side={trade.side} quiet />
        </>
      }
      tags={
        <>
          <TradeRowStrategy
            strategyId={trade.strategyId}
            strategies={strategies}
            stats={strategyStats}
            ariaLabel={`打开 ${trade.ref} 交易详情`}
            onClick={() => onOpen(trade)}
          />
          {session && (
            session.raw !== session.label ? (
              <Tooltip content={session.raw} label={`交易时段：${session.raw}`}>
                <span className={`trade-row-session is-${session.kind}`}>
                  {session.label}
                </span>
              </Tooltip>
            ) : (
              <span className={`trade-row-session is-${session.kind}`}>
                {session.label}
              </span>
            )
          )}
          {mistakeTags.visible.map((tag) => (
            <span className="trade-row-tag is-mistake" key={tag}>{tag}</span>
          ))}
          {mistakeTags.hiddenCount > 0 && (
            <Tooltip
              content={mistakeTags.hidden.join(' · ')}
              label={`其余错误标签：${mistakeTags.hidden.join('、')}`}
              focusable
            >
              <span className="trade-row-more is-mistake-more">
                +{mistakeTags.hiddenCount}
              </span>
            </Tooltip>
          )}
          {regularTags.visible.map((tag) => (
            <span className="trade-row-tag" key={tag}>{tag}</span>
          ))}
          {reviewLabel && (
            <span
              className={
                'trade-row-tag is-review' +
                ((trade.caseType ?? trade.reviewCategory) === 'ambiguous' ? ' is-ambiguous' : '')
              }
            >
              {reviewLabel}
            </span>
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
        </>
      }
      timeframe={
        <span className="trade-row-timeframe">{timeframe}</span>
      }
      pnl={
        <span
          className={
            'trade-row-pnl' +
            (isMissed
              ? ' is-missed'
              : privacyMode
                ? ' is-zero'
                : trade.pnl != null && trade.pnl > 0
                  ? ' is-positive'
                  : trade.pnl != null && trade.pnl < 0
                    ? ' is-negative'
                    : ' is-zero')
          }
        >
          {showResult ? (isMissed ? '未成交' : formatTradeCashPnl(trade, legacyCashCurrencyAssumption, privacyMode)) : '—'}
        </span>
      }
      r={
        <span
          className={
            'trade-row-r' +
            (isMissed && trade.rMultiple != null
              ? ' is-opportunity'
              : trade.rMultiple != null && trade.rMultiple > 0
                ? ' is-positive'
                : trade.rMultiple != null && trade.rMultiple < 0
                  ? ' is-negative'
                  : ' is-zero')
          }
        >
          {showResult ? fmtR(trade.rMultiple) : '—'}
        </span>
      }
      date={fmtDate(trade.openedAt)}
      end={
        <Tooltip
          asChild
          content={starred ? '取消星标' : '星标交易'}
          label={starred ? '取消星标' : '星标交易'}
        >
          <button
            type="button"
            className={'trade-row-star' + (starred ? ' is-starred' : '')}
            aria-label={starred ? '取消星标' : '星标交易'}
            onClick={(event) => {
              event.stopPropagation()
              onToggleStar(trade)
            }}
          >
            <Star size={ICON_SM} fill={starred ? 'currentColor' : 'none'} />
          </button>
        </Tooltip>
      }
      onContextMenu={(event) => onContextMenu?.(event, trade)}
    />
  )
})
