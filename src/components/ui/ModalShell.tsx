import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from '@/icons/appIcons'
import { useExitClone } from '@/components/ui/useExitClone'
import { useShortcutStore } from '@/store/shortcutStore'
import './ModalShell.css'

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0)
}

export function ModalShell({
  title,
  description,
  children,
  footer,
  busy = false,
  dismissible = true,
  size = 'default',
  onClose,
}: {
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  busy?: boolean
  dismissible?: boolean
  size?: 'default' | 'compact' | 'wide'
  onClose: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const exitRef = useExitClone<HTMLDivElement>()

  useEffect(() => {
    useShortcutStore.getState().acquireModalOverlay()
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const preferred = panel.querySelector<HTMLElement>('[data-autofocus]')
      ;(preferred ?? focusableElements(panel)[0] ?? panel).focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      useShortcutStore.getState().releaseModalOverlay()
      const target = returnFocusRef.current
      requestAnimationFrame(() => {
        if (target?.isConnected) target.focus()
      })
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current
      if (!panel) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (!busy && dismissible) onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements(panel)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        panel.focus()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [busy, dismissible, onClose])

  return createPortal(
    <div
      ref={exitRef}
      className="modal-shell-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && dismissible && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={[
          'modal-shell',
          size === 'compact' ? 'modal-shell--compact' : '',
          size === 'wide' ? 'modal-shell--wide' : '',
        ].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
      >
        <header className="modal-shell-header">
          <div className="modal-shell-heading">
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          {dismissible ? (
            <button
              type="button"
              className="modal-shell-close"
              aria-label="关闭"
              disabled={busy}
              onClick={onClose}
            >
              <X size={16} />
            </button>
          ) : null}
        </header>
        {children ? <div className="modal-shell-body">{children}</div> : null}
        {footer ? <footer className="modal-shell-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}
