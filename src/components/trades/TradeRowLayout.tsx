import type { MouseEvent, ReactNode } from 'react'

export type TradeRowOpenAction = {
  ariaLabel: string
  onClick: () => void
  primary?: boolean
}

export type TradeRowLayoutProps = {
  tradeId: string
  className?: string
  ariaLabel?: string
  role?: 'listitem'
  ariaPosInSet?: number
  ariaSetSize?: number
  ariaDescribedBy?: string
  resultSource?: string
  resultIntegrity?: string
  focused?: boolean
  selected?: boolean
  openAction?: TradeRowOpenAction
  check: ReactNode
  status: ReactNode
  reference: ReactNode
  symbol: ReactNode
  tags: ReactNode
  timeframe: ReactNode
  pnl: ReactNode
  r: ReactNode
  date: ReactNode
  end: ReactNode
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
}

export function TradeRowLayout({
  tradeId,
  className,
  ariaLabel,
  role = 'listitem',
  ariaPosInSet,
  ariaSetSize,
  ariaDescribedBy,
  resultSource,
  resultIntegrity,
  focused = false,
  selected = false,
  openAction,
  check,
  status,
  reference,
  symbol,
  tags,
  timeframe,
  pnl,
  r,
  date,
  end,
  onContextMenu,
}: TradeRowLayoutProps) {
  return (
    <div
      className={
        'trade-row' +
        (className ? ` ${className}` : '') +
        (selected ? ' is-selected' : '') +
        (focused ? ' is-focused' : '')
      }
      data-trade-id={tradeId}
      aria-label={ariaLabel}
      role={role}
      aria-posinset={ariaPosInSet}
      aria-setsize={ariaSetSize}
      aria-describedby={ariaDescribedBy}
      data-result-source={resultSource}
      data-result-integrity={resultIntegrity}
      onContextMenu={onContextMenu}
    >
      {openAction ? (
        <button
          type="button"
          className="trade-row-open"
          data-trade-primary-action={openAction.primary || undefined}
          aria-label={openAction.ariaLabel}
          onClick={openAction.onClick}
        />
      ) : null}
      <span className="trade-row-check-slot">{check}</span>
      <span className="trade-row-status">{status}</span>
      <span className="trade-row-ref">{reference}</span>
      <span className="trade-row-symbol trade-row-primary">{symbol}</span>
      <span className="trade-row-tags">{tags}</span>
      <span className="trade-row-timeframe-slot">{timeframe}</span>
      <span className="trade-row-pnl">{pnl}</span>
      <span className="trade-row-r">{r}</span>
      <span className="trade-row-date">{date}</span>
      <span className="trade-row-end">{end}</span>
    </div>
  )
}
