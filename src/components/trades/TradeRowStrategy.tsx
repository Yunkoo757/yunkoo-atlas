import { HoverPreview } from '@/components/HoverPreview'
import { StrategyLabel } from '@/components/StrategyIcon'
import { StrategyPreview, type StrategyPreviewStats } from '@/components/RowPreviews'
import type { Strategy } from '@/data/strategies'

type TradeRowStrategyProps = {
  strategyId: string
  strategies: Strategy[]
  stats?: StrategyPreviewStats | null
  ariaLabel: string
  onClick?: () => void
}

export function TradeRowStrategy({
  strategyId,
  strategies,
  stats = null,
  ariaLabel,
  onClick,
}: TradeRowStrategyProps) {
  const label = <StrategyLabel strategyId={strategyId} strategies={strategies} />

  return (
    <HoverPreview
      content={(
        <StrategyPreview
          strategyId={strategyId}
          strategies={strategies}
          stats={stats}
        />
      )}
    >
      {onClick ? (
        <button
          type="button"
          className="trade-row-strategy"
          aria-label={ariaLabel}
          onClick={onClick}
        >
          {label}
        </button>
      ) : (
        <span
          className="trade-row-strategy"
          tabIndex={0}
          aria-label={ariaLabel}
        >
          {label}
        </span>
      )}
    </HoverPreview>
  )
}
