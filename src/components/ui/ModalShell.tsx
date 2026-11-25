import { restoreFocusIfUnclaimed } from '@/lib/restoreFocus'
import { isComposingKey } from '@/lib/keyboardComposition'
import { ICON_MD } from '@/icons/iconSize'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from '@/icons/appIcons'
import { useExitClone } from '@/components/ui/useExitClone'
import { useShortcutStore } from '@/store/shortcutStore'
import './ModalShell.css'

export function useModalShortcutScope(open = true) {
  useEffect(() => {
    if (!open) return
    const { acquireModalOverlay, releaseModalOverlay } = useShortcutStore.getState()
    acquireModalOverlay()
    return releaseModalOverlay
  }, [open])
}

let openShells = 0
let previousBodyOverflow = ''

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.getClientRects().length > 0)
}

type ModalPortalRegistry = {
  registerPortalRoot: (root: HTMLElement) => () => void
}

export const ModalPortalContext = createContext<ModalPortalRegistry | null>(null)

/**
 * 将挂到 document.body 的菜单、选择器或日期层登记为当前 Modal 的焦点域。
 * 没有 Modal 上下文时保持无操作，基础浮层仍可独立使用。
 */
export function useModalPortalRoot(): (root: HTMLElement | null) => void {
  const registry = useContext(ModalPortalContext)
  const unregisterRef = useRef<(() => void) | null>(null)

  useEffect(() => () => unregisterRef.current?.(), [])

  return useCallback((root: HTMLElement | null) => {
    unregisterRef.current?.()
    unregisterRef.current = root && registry ? registry.registerPortalRoot(root) : null
  }, [registry])
}

export function useModalPortalRegistry(busy = false) {
  const portalRootsRef = useRef(new Set<HTMLElement>())
  const portalRegistry = useMemo(() => ({
    registerPortalRoot(root: HTMLElement) {
      portalRootsRef.current.add(root)
      if (busy) root.setAttribute('inert', '')
      return () => {
        root.removeAttribute('inert')
        portalRootsRef.current.delete(root)
      }
    },
  }), [busy])
  return { portalRootsRef, portalRegistry }
}

export function ModalShell({
  title,
  description,
  children,
  footer,
  busy = false,
  dismissible = true,
  size = 'default',
  panelClassName,
  bodyClassName,
  footerClassName,
  initialFocusSelector,
  returnFocusTo,
  describedById,
  onClose,
}: {
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  busy?: boolean
  dismissible?: boolean
  size?: 'default' | 'compact' | 'wide'
  panelClassName?: string
  bodyClassName?: string
  footerClassName?: string
  initialFocusSelector?: string
  returnFocusTo?: HTMLElement | null
  describedById?: string
  onClose: () => void
}) {
  const modalId = useId()
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const focusOptions = useRef({ initialFocusSelector, returnFocusTo })
  focusOptions.current = { initialFocusSelector, returnFocusTo }
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const exitRef = useExitClone<HTMLDivElement>()
  const { portalRootsRef, portalRegistry } = useModalPortalRegistry(busy)
  useModalShortcutScope()

  const isTopmostModal = useCallback(
    () => {
      const overlays = document.querySelectorAll<HTMLElement>('[data-modal-shell-id]')
      return overlays[overlays.length - 1]?.dataset.modalShellId === modalId
    },
    [modalId],
  )

  useEffect(() => {
    returnFocusRef.current = focusOptions.current.returnFocusTo ?? (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    )
    if (openShells === 0) previousBodyOverflow = document.body.style.overflow
    openShells += 1
    document.body.style.overflow = 'hidden'
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel || !isTopmostModal()) return
      const { initialFocusSelector } = focusOptions.current
      const preferred = initialFocusSelector
        ? panel.querySelector<HTMLElement>(initialFocusSelector)
        : panel.querySelector<HTMLElement>('[data-autofocus]')
      ;(preferred ?? focusableElements(panel)[0] ?? panel).focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      openShells -= 1
      if (openShells === 0) document.body.style.overflow = previousBodyOverflow
      const target = returnFocusRef.current
      requestAnimationFrame(() => {
        restoreFocusIfUnclaimed(target)
      })
    }
  }, [isTopmostModal])

  useEffect(() => {
    for (const root of portalRootsRef.current) {
      if (busy) root.setAttribute('inert', '')
      else root.removeAttribute('inert')
    }
  }, [busy])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current
      if (!panel || !isTopmostModal() || isComposingKey(event)) return
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return
        event.preventDefault()
        event.stopPropagation()
        if (!busy && dismissible) onClose()
        return
      }
      if (event.key !== 'Tab') return
      if (event.defaultPrevented) return
      const focusable = [
        ...focusableElements(panel),
        ...Array.from(portalRootsRef.current).flatMap(focusableElements),
      ]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        panel.focus()
        return
      }
      const activeElement = document.activeElement
      const activeInsideModal = panel.contains(activeElement) ||
        Array.from(portalRootsRef.current).some((root) => root.contains(activeElement))
      if (!activeInsideModal) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
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
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busy, dismissible, isTopmostModal, onClose])

  return createPortal(
    <ModalPortalContext.Provider value={portalRegistry}>
      <div
        ref={exitRef}
        className="modal-shell-overlay"
        data-modal-shell-id={modalId}
        role="presentation"
        onMouseDown={(event) => {
          if (
            isTopmostModal() &&
            !busy &&
            dismissible &&
            event.target === event.currentTarget
          ) onClose()
        }}
      >
        <div
          ref={panelRef}
          className={[
            'modal-shell',
            size === 'compact' ? 'is-compact' : '',
            size === 'wide' ? 'is-wide' : '',
            panelClassName ?? '',
          ].filter(Boolean).join(' ')}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={[
            description ? descriptionId : null,
            describedById ?? null,
          ].filter(Boolean).join(' ') || undefined}
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
                <X size={ICON_MD} />
              </button>
            ) : null}
          </header>
          {children ? (
            <div className={['modal-shell-body', bodyClassName ?? ''].filter(Boolean).join(' ')}>
              {children}
            </div>
          ) : null}
          {footer ? (
            <footer className={['modal-shell-footer', footerClassName ?? ''].filter(Boolean).join(' ')}>
              {footer}
            </footer>
          ) : null}
        </div>
      </div>
    </ModalPortalContext.Provider>,
    document.body,
  )
}
