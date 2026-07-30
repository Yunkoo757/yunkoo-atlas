import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check } from '@/icons/appIcons'
import {
  MISSED_OPPORTUNITY_SOURCES,
  type MissedOpportunitySource,
} from '@/lib/missedOpportunities'

const SOURCE_LABELS: Record<MissedOpportunitySource, string> = {
  trade: '交易日志',
  paper: '模拟盘',
  case: '案例记录',
}

export type MissedOpportunityScopeMenuProps = {
  sources: readonly MissedOpportunitySource[]
  rawCounts: Record<MissedOpportunitySource, number>
  onToggle: (source: MissedOpportunitySource) => boolean
}

export function MissedOpportunityScopeMenu({
  sources,
  rawCounts,
  onToggle,
}: MissedOpportunityScopeMenuProps) {
  const [open, setOpen] = useState(false)
  const [constraint, setConstraint] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const close = useCallback(() => {
    setConstraint(null)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!open) return
    firstOptionRef.current?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [close, open])

  return (
    <div className="missed-scope-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={'missed-scope-trigger' + (open ? ' is-open' : '')}
        aria-label="管理包含范围"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="menu"
        onClick={() => {
          if (open) {
            close()
            return
          }
          setConstraint(null)
          setOpen(true)
        }}
      >
        <span>范围 · {sources.length}</span>
      </button>
      {open ? (
        <div id={panelId} className="missed-scope-popover" role="menu" aria-label="包含范围">
          {MISSED_OPPORTUNITY_SOURCES.map((source, index) => (
            <button
              ref={index === 0 ? firstOptionRef : undefined}
              key={source}
              type="button"
              role="menuitemcheckbox"
              aria-checked={sources.includes(source)}
              onClick={() => {
                const changed = onToggle(source)
                setConstraint(changed ? null : '至少保留一个工作区')
              }}
            >
              <span className="missed-scope-check" aria-hidden="true">
                {sources.includes(source) ? <Check size={11} /> : null}
              </span>
              <span>{SOURCE_LABELS[source]}</span>
              <span className="missed-scope-count" aria-hidden="true">{rawCounts[source]}</span>
            </button>
          ))}
          {constraint ? <p role="status">{constraint}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
