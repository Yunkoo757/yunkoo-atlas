import { ICON_SM } from '@/icons/iconSize'
import { memo } from 'react'
import { Bookmark, Star } from '@/icons/appIcons'
import type { Strategy } from '@/data/strategies'
import { resolveTimeframe, type Trade } from '@/data/trades'
import { StatusIcon, SideTag } from '@/components/StatusIcon'
import { SymbolIcon } from '@/components/SymbolIcon'
import type { StrategyPreviewStats } from '@/components/RowPreviews'
import { SelectionBox } from '@/components/ui/SelectionBox'
import { fmtDate } from '@/lib/format'
import {
  buildTradeRowAccessibleLabel,
  buildTradeRowContext,
  resolveTradeRowResultPresentation,
  type TradeRowContextItem,
} from '@/lib/tradeRowPresentation'
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
  const privacyMode = useStore((state) => state.display.privacyMode)
  const legacyCashCurrencyAssumption = useStore((state) => state.profile.legacyCashCurrencyAssumption)
  const timeframe = resolveTimeframe(trade.timeframe)
  const symbolIconsFromStore = useStore((state) =>
    symbolIconsProp === undefined ? state.symbolIcons : null,
  )
  const symbolIcons = symbolIconsProp ?? symbolIconsFromStore ?? {}
  const context = buildTradeRowContext(trade)
  const result = resolveTradeRowResultPresentation(
    trade,
    legacyCashCurrencyAssumption,
    privacyMode,
  )
  const strategyLabel = strategies.find((strategy) => strategy.id === trade.strategyId)?.name ?? '未设置'
  const date = fmtDate(trade.openedAt)
  const isCase = trade.tradeKind === 'case'
  const emphasisLabel = isCase
    ? (starred ? '取消重点' : '设为重点案例')
    : (starred ? '取消星标' : '星标交易')

  const contextItem = (item: TradeRowContextItem, index: number) => {
    const content = (
      <span
        key={item.key}
        className={
          `trade-row-tag is-${item.kind} trade-row-context-item` +
          (index >= 2 ? ' is-overflow-wide' : '') +
          (index >= 1 ? ' is-overflow-medium' : '')
        }
      >
        {item.label}
      </span>
    )
    return item.detail ? (
      <Tooltip key={item.key} asChild content={item.detail} label={`${item.label}：${item.detail}`}>
        {content}
      </Tooltip>
    ) : content
  }

  const overflow = (visibleCount: number, className: string) => {
    const hidden = context.slice(visibleCount)
    if (hidden.length === 0) return null
    const labels = hidden.map((item) => item.label)
    return (
      <Tooltip
        asChild
        content={labels.join(' · ')}
        label={`其余上下文：${labels.join('、')}`}
      >
        <span
          className={`trade-row-more ${className}`}
          tabIndex={0}
          aria-label={`其余上下文：${labels.join('、')}`}
        >
          +{hidden.length}
        </span>
      </Tooltip>
    )
  }

  return (
    <TradeRowLayout
      tradeId={trade.id}
      ariaLabel={buildTradeRowAccessibleLabel(
        trade,
        strategyLabel,
        context,
        result,
        timeframe,
        date,
        starred,
      )}
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
          label={`${selected ? '取消选择' : '选择'} ${trade.ref}`}
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
          {context.map(contextItem)}
          {overflow(2, 'is-wide-overflow')}
          {overflow(1, 'is-medium-overflow')}
          {overflow(0, 'is-compact-overflow')}
        </>
      }
      timeframe={
        <span className="trade-row-timeframe">{timeframe}</span>
      }
      result={
        <span
          className="trade-row-result-value"
          data-value-state={result.r.state}
          data-value-sign={
            result.r.state === 'value'
              ? trade.rMultiple != null && trade.rMultiple > 0 ? 'positive' : 'negative'
              : undefined
          }
        >
          {result.r.text}
        </span>
      }
      date={date}
      end={
        <Tooltip
          asChild
          content={emphasisLabel}
          label={emphasisLabel}
        >
          <button
            type="button"
            className={'trade-row-star' + (starred ? ' is-starred' : '')}
            aria-label={emphasisLabel}
            aria-pressed={starred}
            onClick={(event) => {
              event.stopPropagation()
              onToggleStar(trade)
            }}
          >
            {isCase
              ? <Bookmark size={ICON_SM} fill={starred ? 'currentColor' : 'none'} />
              : <Star size={ICON_SM} fill={starred ? 'currentColor' : 'none'} />}
          </button>
        </Tooltip>
      }
      onContextMenu={(event) => onContextMenu?.(event, trade)}
      resultSource={result.source}
      resultIntegrity={result.integrity}
    />
  )
})
