import { useLayoutEffect, useRef, useState } from 'react'
import { Tooltip } from '@/components/ui/Tooltip'
import { fitContextItems } from './TradeRowContext'

/** Keep complete labels; only the continuous suffix goes into the overflow control. */
export function BoardCardTags({ errors, tags }: { errors: string[]; tags: string[] }) {
  const root = useRef<HTMLSpanElement>(null)
  const measure = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(0)
  const items = [...errors.map(label => ({ label, danger: true })), ...tags.map(label => ({ label, danger: false }))]
  const signature = JSON.stringify(items)
  useLayoutEffect(() => {
    const container = root.current
    const rail = measure.current
    if (!container || !rail) return
    let disposed = false
    const update = () => {
      if (disposed) return
      const widths = Array.from(rail.querySelectorAll<HTMLElement>('[data-tag-measure]'), el => el.getBoundingClientRect().width)
      const counters = Array.from(rail.querySelectorAll<HTMLElement>('[data-count-measure]'), el => el.getBoundingClientRect().width)
      const next = fitContextItems(widths, container.getBoundingClientRect().width, parseFloat(getComputedStyle(container).columnGap) || 0, counters)
      if (next === widths.length && container.contains(document.activeElement)) {
        container.closest<HTMLElement>('.bd-card')?.focus({ preventScroll: true })
      }
      setVisible(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(rail)
    void document.fonts.ready.then(update)
    return () => { disposed = true; observer.disconnect() }
  }, [signature])
  const hidden = items.slice(visible)
  const className = (danger: boolean) => 'bd-case-tag' + (danger ? ' bd-case-tag-danger' : '')
  return <span className="bd-tags-rail" ref={root}>
    {items.slice(0, visible).map((item, index) => <span key={index} className={className(item.danger)}>{item.label}</span>)}
    {hidden.length > 0 && <Tooltip asChild content={hidden.map(item => item.label).join(' · ')} label={`其余标签：${hidden.map(item => item.label).join('、')}`}>
      <span className="bd-tags-more" tabIndex={0} aria-label={`其余标签：${hidden.map(item => item.label).join('、')}`} onClick={event => event.stopPropagation()}>+{hidden.length}</span>
    </Tooltip>}
    <span className="bd-tags-measure" ref={measure} aria-hidden="true">
      {items.map((item, index) => <span key={index} data-tag-measure className={className(item.danger)}>{item.label}</span>)}
      {items.map((_, index) => <span key={index} data-count-measure className="bd-tags-more">+{index + 1}</span>)}
    </span>
  </span>
}
