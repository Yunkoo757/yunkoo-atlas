import { ICON_LG, ICON_SM } from '@/icons/iconSize'
import { memo } from 'react'
import { Bookmark, Star } from '@/icons/appIcons'
import type { Strategy } from '@/data/strategies'
import { resolveTimeframe, type Trade } from '@/data/trades'
import { StatusIcon, SideTag } from '@/components/StatusIcon'
import { SymbolIcon } from '@/components/SymbolIcon'
import type { StrategyPreviewStats } from '@/components/RowPreviews'
import { SelectionBox } from '@/components/ui/SelectionBox'
import { fmtDate, fmtFullDateTime } from '@/lib/format'
import {
  buildTradeRowAccessibleLabel,
  buildTradeRowContext,
  resolveTradeRowResultPresentation,
} from '@/lib/tradeRowPresentation'
import type { SymbolIconsMap } from '@/lib/symbolIcons'
import { OverflowTooltip, Tooltip } from '@/components/ui/Tooltip'
import { useStore } from '@/store/useStore'
import { TradeRowLayout } from './TradeRowLayout'
import { TradeRowStrategy } from './TradeRowStrategy'
import { CaseContentPreview } from './CaseContentPreview'
import { TradeRowContext } from './TradeRowContext'

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
      symbol={
        <>
          {isCase ? (
            <CaseContentPreview trade={trade}>
              <button
                type="button"
                className="trade-row-symbol-main"
                aria-label={`打开 ${trade.symbol} ${trade.ref}，悬停预览案例内容`}
                onClick={() => onOpen(trade)}
              >
                <SymbolIcon symbol={trade.symbol} overrides={symbolIcons} size={ICON_LG} quiet />
                <strong>{trade.symbol}</strong>
              </button>
            </CaseContentPreview>
          ) : (
            <button type="button" className="trade-row-symbol-main"
              aria-label={`打开 ${trade.symbol} ${trade.ref}`} onClick={() => onOpen(trade)}>
              <SymbolIcon symbol={trade.symbol} overrides={symbolIcons} size={ICON_LG} quiet />
              <OverflowTooltip text={trade.symbol}>
                <strong>{trade.symbol}</strong>
              </OverflowTooltip>
            </button>
          )}
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
          <TradeRowContext items={context} onOpen={() => onOpen(trade)} />
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
      date={<Tooltip asChild content={<>{trade.ref}<br />{isCase && trade.sourceTradeId ? '来源日期' : '记录日期'}：{fmtFullDateTime(trade.openedAt)}{isCase && trade.recordedAt && <><br />收录日期：{fmtFullDateTime(trade.recordedAt)}</>}</>} label={`${trade.ref}，${fmtFullDateTime(trade.openedAt)}`}><button type="button" className="trade-row-date-detail" aria-label={`${trade.ref}，${fmtFullDateTime(trade.openedAt)}`} onClick={() => onOpen(trade)}>{date}</button></Tooltip>}
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
