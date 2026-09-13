import { useLayoutEffect, useRef, useState } from 'react'
import { Tooltip } from '@/components/ui/Tooltip'
import type { TradeRowContextItem } from '@/lib/tradeRowPresentation'

/** Fit a continuous prefix without counting partially clipped labels as visible. */
export function fitContextItems(widths: number[], available: number, gap: number, moreWidths: number[]): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap
  if (total <= available) return widths.length
  let used = 0
  let visible = 0
  for (let count = 0; count < widths.length; count += 1) {
    if (count > 0) used += widths[count - 1]! + (count > 1 ? gap : 0)
    const required = used + (count > 0 ? gap : 0) + (moreWidths[widths.length - count - 1] ?? 0)
    if (required <= available) visible = count
  }
  return visible
}

export function TradeRowContext({ items }: { items: TradeRowContextItem[] }) {
  const root = useRef<HTMLSpanElement>(null)
  const measure = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(0)
  const signature = JSON.stringify(items)

  useLayoutEffect(() => {
    const container = root.current
    const rail = measure.current
    if (!container || !rail) return
    let frame = 0
    let disposed = false
    const update = () => {
      const widths = Array.from(rail.querySelectorAll<HTMLElement>('[data-context-measure]'), el => el.getBoundingClientRect().width)
      const counters = Array.from(rail.querySelectorAll<HTMLElement>('[data-more-measure]'), el => el.getBoundingClientRect().width)
      const gap = parseFloat(getComputedStyle(container).columnGap) || 0
      const next = fitContextItems(widths, container.getBoundingClientRect().width, gap, counters)
      const focused = document.activeElement
      if (focused instanceof HTMLElement && container.contains(focused) &&
        ((focused.classList.contains('trade-row-more') && next === widths.length) ||
          Number(focused.dataset.contextIndex) >= next)) {
        container.closest('.trade-row')?.querySelector<HTMLButtonElement>('.trade-row-open')?.focus({ preventScroll: true })
      }
      setVisible(previous => previous === next ? previous : next)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    update()
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    observer.observe(rail)
    void document.fonts.ready.then(() => { if (!disposed) schedule() })
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame) }
  }, [signature])

  const hidden = items.slice(visible)
  const labels = hidden.map(item => item.label)
  return (
    <span className="trade-row-context" ref={root}>
      {items.slice(0, visible).map((item, index) => (
        <Tooltip key={item.key} asChild content={item.detail ?? item.label} label={item.detail ?? item.label}>
          <span className={`trade-row-tag is-${item.kind} trade-row-context-item`} data-context-index={index}>
            {item.label}
          </span>
        </Tooltip>
      ))}
      {hidden.length > 0 && (
        <Tooltip asChild content={labels.join(' · ')} label={`其余上下文：${labels.join('、')}`}>
          <span className="trade-row-more" tabIndex={0} aria-label={`其余上下文：${labels.join('、')}`}>
            +{hidden.length}
          </span>
        </Tooltip>
      )}
      <span className="trade-row-context-measure" ref={measure} aria-hidden="true">
        {items.map(item => <span key={item.key} data-context-measure className={`trade-row-tag is-${item.kind}`}>{item.label}</span>)}
        {items.map((item, index) => <span key={`more-${item.key}`} data-more-measure className="trade-row-more">+{index + 1}</span>)}
      </span>
    </span>
  )
}
