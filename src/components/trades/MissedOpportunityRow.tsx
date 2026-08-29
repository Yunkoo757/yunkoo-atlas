import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { MoreHorizontal } from '@/icons/appIcons'
import { Menu } from '@/components/Menu'
import { StatusIcon, SideTag } from '@/components/StatusIcon'
import { SymbolIcon } from '@/components/SymbolIcon'
import type { StrategyPreviewStats } from '@/components/RowPreviews'
import type { Strategy } from '@/data/strategies'
import { MISS_REASON_META, resolveTimeframe, type Trade } from '@/data/trades'
import type { MissedOpportunityItem, MissedOpportunitySource } from '@/lib/missedOpportunities'
import type { SymbolIconsMap } from '@/lib/symbolIcons'
import { fmtDate, fmtR } from '@/lib/format'
import { TradeRowLayout, type TradeRowOpenAction } from './TradeRowLayout'
import { TradeRowStrategy } from './TradeRowStrategy'

type MissedOpportunityRowProps = {
  item: MissedOpportunityItem
  strategies: Strategy[]
  strategyStats: StrategyPreviewStats | null
  focused: boolean
  ariaPosInSet?: number
  ariaSetSize?: number
  ariaDescribedBy?: string
  symbolIcons: SymbolIconsMap
  onOpen: (target: Trade, anchorId: string) => void
}

const SOURCE_LABELS: Record<MissedOpportunitySource, string> = {
  trade: '交易日志',
  paper: '模拟盘',
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
  strategyStats,
  merged,
  onOpen,
}: {
  item: MissedOpportunityItem
  strategies: Strategy[]
  strategyStats: StrategyPreviewStats | null
  merged: boolean
  onOpen: (target: Trade, anchorId: string) => void
}) {
  const { primary } = item
  const missReason = MISS_REASON_META[primary.missReason ?? 'other'].label
  const strategyName = strategies.find((strategy) => strategy.id === primary.strategyId)?.name ?? '未分类'

  return (
    <>
      <TradeRowStrategy
        strategyId={primary.strategyId}
        strategies={strategies}
        stats={strategyStats}
        ariaLabel={merged
          ? `打开 ${primary.ref} ${RECORD_LABELS[primary.tradeKind]}，策略 ${strategyName}`
          : `打开 ${primary.ref} ${RECORD_LABELS[primary.tradeKind]}`}
        onClick={() => onOpen(primary, item.key)}
      />
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
  strategyStats,
  focused,
  ariaPosInSet,
  ariaSetSize,
  ariaDescribedBy,
  symbolIcons,
  onOpen,
}: MissedOpportunityRowProps) {
  const { primary } = item
  const merged = !item.missingSourceId && item.linkedCases.length > 0
  const sideLabel = primary.side === 'long' ? '做多' : '做空'
  const missReason = MISS_REASON_META[primary.missReason ?? 'other'].label
  const openLabel = `打开 ${primary.symbol} ${RECORD_LABELS[primary.tradeKind]}`
  const openAction: TradeRowOpenAction = {
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
      ariaPosInSet={ariaPosInSet}
      ariaSetSize={ariaSetSize}
      ariaDescribedBy={ariaDescribedBy}
      ariaLabel={`${primary.symbol}，${sideLabel}，${SOURCE_LABELS[item.source]}，${missReason}，${fmtDate(item.occurredAt)}`}
      focused={focused}
      openAction={openAction}
      check={<span className="trade-row-check-spacer" aria-hidden />}
      status={<StatusIcon status="missed" />}
      reference={primary.ref}
      symbol={
        <>
          <span className="trade-row-symbol-main">
            <SymbolIcon symbol={primary.symbol} overrides={symbolIcons} size={ICON_SM} quiet />
            <strong>{primary.symbol}</strong>
          </span>
          <SideTag side={primary.side} quiet />
        </>
      }
      tags={(
        <MissedOpportunityTags
          item={item}
          strategies={strategies}
          strategyStats={strategyStats}
          merged={merged}
          onOpen={onOpen}
        />
      )}
      timeframe={<span className="trade-row-timeframe">{resolveTimeframe(primary.timeframe)}</span>}
      result={
        <span className={'trade-row-result-value' + (primary.rMultiple != null ? ' is-opportunity' : ' is-zero')}>
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
                <MoreHorizontal size={ICON_MD} aria-hidden="true" />
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
