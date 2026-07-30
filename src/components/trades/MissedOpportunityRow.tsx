import { MoreHorizontal } from '@/icons/appIcons'
import { Menu } from '@/components/Menu'
import { SymbolIcon } from '@/components/SymbolIcon'
import type { Strategy } from '@/data/strategies'
import { MISS_REASON_META, type Trade } from '@/data/trades'
import { getStrategyName } from '@/lib/strategies'
import type { MissedOpportunityItem, MissedOpportunitySource } from '@/lib/missedOpportunities'
import type { SymbolIconsMap } from '@/lib/symbolIcons'
import { fmtDate } from '@/lib/format'

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

export function MissedOpportunityRow({
  item,
  strategies,
  focused,
  symbolIcons,
  onOpen,
}: MissedOpportunityRowProps) {
  const { primary } = item
  const merged = !item.missingSourceId && item.linkedCases.length > 0
  const strategyName = getStrategyName(strategies, primary.strategyId)
  const sideLabel = primary.side === 'long' ? '做多' : '做空'
  const missReason = MISS_REASON_META[primary.missReason ?? 'other'].label
  const openLabel = `打开 ${primary.symbol} ${RECORD_LABELS[primary.tradeKind]}`
  const caseCount = item.linkedCases.length
  const sourceActionLabel = mergedSourceActionLabel(primary)
  const menuOptions = [
    { value: `source:${primary.id}`, label: sourceActionLabel },
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
    <div
      className={
        'missed-row' +
        (focused ? ' is-focused' : '') +
        (merged ? ' is-merged' : '') +
        (item.missingSourceId ? ' has-missing-source' : '')
      }
      data-trade-id={item.key}
      role="listitem"
      aria-label={`${primary.symbol}，${sideLabel}，${SOURCE_LABELS[item.source]}，${fmtDate(item.occurredAt)}`}
    >
      {!merged ? (
        <button
          type="button"
          className="missed-row-open"
          data-trade-primary-action
          aria-label={openLabel}
          onClick={() => onOpen(primary, item.key)}
        />
      ) : null}

      <span className="missed-row-source" data-missed-source={item.source}>
        {SOURCE_LABELS[item.source]}
      </span>
      <span className="missed-row-symbol">
        <SymbolIcon symbol={primary.symbol} overrides={symbolIcons} size={14} />
        <strong>{primary.symbol}</strong>
      </span>
      <span className={'missed-row-side is-' + primary.side}>{sideLabel}</span>
      <span className="missed-row-summary">
        {item.missingSourceId ? (
          <>
            <span className="missed-row-missing">来源记录已删除</span>
            <span aria-hidden="true"> · </span>
          </>
        ) : null}
        <span>{strategyName}</span>
        <span aria-hidden="true"> · </span>
        <span>{missReason}</span>
        <span aria-hidden="true"> · </span>
        <span>{primary.ref}</span>
        {merged ? (
          <>
            <span aria-hidden="true"> · </span>
            <span className="missed-row-relation">关联 {caseCount} 个案例</span>
          </>
        ) : null}
      </span>
      <time className="missed-row-time" dateTime={item.occurredAt}>
        {fmtDate(item.occurredAt)}
      </time>

      {merged ? (
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
      ) : null}
    </div>
  )
}
