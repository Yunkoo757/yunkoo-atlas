import { MoreHorizontal } from '@/icons/appIcons'
import { Menu } from '@/components/Menu'
import { StatusIcon, SideTag } from '@/components/StatusIcon'
import { SymbolIcon } from '@/components/SymbolIcon'
import { StrategyLabel } from '@/components/StrategyIcon'
import type { Strategy } from '@/data/strategies'
import { MISS_REASON_META, resolveTimeframe, type Trade } from '@/data/trades'
import type { MissedOpportunityItem, MissedOpportunitySource } from '@/lib/missedOpportunities'
import type { SymbolIconsMap } from '@/lib/symbolIcons'
import { fmtDate, fmtR } from '@/lib/format'
import { TradeRowLayout, type TradeRowOpenAction } from './TradeRowLayout'

type MissedOpportunityRowProps = {
  item: MissedOpportunityItem
  strategies: Strategy[]
  focused: boolean
  symbolIcons: SymbolIconsMap
  onOpen: (target: Trade, anchorId: string) => void
}

const SOURCE_LABELS: Record<MissedOpportunitySource, string> = {
  trade: '交易日志',
  paper: '模拟盘',
  case: '案例记录',
}

const RECORD_LABELS: Record<Trade['tradeKind'], string> = {
  live: '交易记录',
  paper: '模拟记录',
  case: '案例记录',
}

function mergedSourceActionLabel(trade: Trade): string {
  return `打开 ${trade.symbol} 原始${RECORD_LABELS[trade.tradeKind]}`
}

function caseActionLabel(reviewCase: Trade): string {
  return `打开案例 ${reviewCase.ref}`
}

function MissedOpportunityTags({
  item,
  strategies,
  merged,
}: {
  item: MissedOpportunityItem
  strategies: Strategy[]
  merged: boolean
}) {
  const { primary } = item
  const missReason = MISS_REASON_META[primary.missReason ?? 'other'].label

  return (
    <>
      <span className="trade-row-strategy">
        <StrategyLabel strategyId={primary.strategyId} strategies={strategies} />
      </span>
      <span className="trade-row-tag missed-opportunity-source" data-missed-source={item.source}>
        {SOURCE_LABELS[item.source]}
      </span>
      <span className="trade-row-tag missed-row-reason">{missReason}</span>
      {item.missingSourceId ? <span className="trade-row-tag missed-row-missing">来源记录已删除</span> : null}
      {merged ? <span className="trade-row-more missed-row-relation">关联 {item.linkedCases.length} 个案例</span> : null}
    </>
  )
}

export function MissedOpportunityRow({
  item,
  strategies,
  focused,
  symbolIcons,
  onOpen,
}: MissedOpportunityRowProps) {
  const { primary } = item
  const merged = !item.missingSourceId && item.linkedCases.length > 0
  const sideLabel = primary.side === 'long' ? '做多' : '做空'
  const missReason = MISS_REASON_META[primary.missReason ?? 'other'].label
  const openLabel = `打开 ${primary.symbol} ${RECORD_LABELS[primary.tradeKind]}`
  const openAction: TradeRowOpenAction | undefined = merged
    ? undefined
    : {
        ariaLabel: openLabel,
        onClick: () => onOpen(primary, item.key),
        primary: true,
      }
  const menuOptions = [
    { value: `source:${primary.id}`, label: mergedSourceActionLabel(primary) },
    ...item.linkedCases.map((reviewCase) => ({
      value: `case:${reviewCase.id}`,
      label: caseActionLabel(reviewCase),
    })),
  ]

  const openMenuTarget = (value: string) => {
    if (value === `source:${primary.id}`) {
      onOpen(primary, item.key)
      return
    }
    const reviewCase = item.linkedCases.find((candidate) => value === `case:${candidate.id}`)
    if (reviewCase) onOpen(reviewCase, item.key)
  }

  return (
    <TradeRowLayout
      tradeId={item.key}
      className={'missed-opportunity-row' + (merged ? ' is-merged' : '')}
      role="listitem"
      ariaLabel={`${primary.symbol}，${sideLabel}，${SOURCE_LABELS[item.source]}，${missReason}，${fmtDate(item.occurredAt)}`}
      focused={focused}
      openAction={openAction}
      check={<span className="trade-row-check-spacer" aria-hidden />}
      status={<StatusIcon status="missed" />}
      reference={primary.ref}
      symbol={
        <>
          <span className="trade-row-symbol-main">
            <SymbolIcon symbol={primary.symbol} overrides={symbolIcons} size={14} />
            <strong>{primary.symbol}</strong>
          </span>
          <SideTag side={primary.side} quiet />
        </>
      }
      tags={<MissedOpportunityTags item={item} strategies={strategies} merged={merged} />}
      timeframe={<span className="trade-row-timeframe">{resolveTimeframe(primary.timeframe)}</span>}
      pnl={<span className="trade-row-pnl is-missed">未成交</span>}
      r={
        <span className={'trade-row-r' + (primary.rMultiple != null ? ' is-opportunity' : ' is-zero')}>
          {fmtR(primary.rMultiple)}
        </span>
      }
      date={<time dateTime={item.occurredAt}>{fmtDate(item.occurredAt)}</time>}
      end={merged ? (
        <span className="missed-row-menu">
          <Menu
            align="right"
            trigger={(
              <button
                type="button"
                data-trade-primary-action
                aria-label={`更多操作：${primary.symbol}`}
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
            )}
            options={menuOptions}
            onSelect={openMenuTarget}
          />
        </span>
      ) : <span aria-hidden />}
    />
  )
}
