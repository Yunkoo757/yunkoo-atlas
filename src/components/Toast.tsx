import { motionDuration, reducesMotion } from '@/lib/motion'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AlertCircle, AlertTriangle, Check, X } from '@/icons/appIcons'
import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { toastStore, type ToastItem, type ToastTone } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import './Toast.css'

const TONE_ICONS = {
  info: null,
  success: Check,
  warning: AlertTriangle,
  error: AlertCircle,
} satisfies Record<ToastTone, typeof AlertCircle | null>

type PresentToast = ToastItem & { exiting: boolean }


function usePresentToasts(items: readonly ToastItem[]): PresentToast[] {
  const [present, setPresent] = useState<PresentToast[]>(() =>
    items.map((item) => ({ ...item, exiting: false })),
  )
  const removalTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    setPresent((previous) => {
      const active = new Map(items.map((item) => [item.id, item]))
      const next = previous.map((item) => {
        const updated = active.get(item.id)
        if (!updated) return { ...item, exiting: true }
        active.delete(item.id)
        return { ...updated, exiting: false }
      })
      for (const item of active.values()) next.push({ ...item, exiting: false })
      return next
    })
  }, [items])

  useEffect(() => {
    const activeIds = new Set(present.map((item) => item.id))
    for (const [id, timer] of removalTimers.current) {
      const item = present.find((candidate) => candidate.id === id)
      if (!activeIds.has(id) || !item?.exiting) {
        clearTimeout(timer)
        removalTimers.current.delete(id)
      }
    }
    for (const item of present) {
      if (!item.exiting || removalTimers.current.has(item.id)) continue
      const timer = setTimeout(() => {
        removalTimers.current.delete(item.id)
        setPresent((current) => current.filter((candidate) => candidate.id !== item.id))
      }, reducesMotion() ? 0 : motionDuration(document.documentElement, '--toast-motion-out'))
      removalTimers.current.set(item.id, timer)
    }
  }, [present])

  useEffect(() => () => {
    for (const timer of removalTimers.current.values()) clearTimeout(timer)
    removalTimers.current.clear()
  }, [])

  return present
}

export function ToastHost() {
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.getVisible, toastStore.getVisible)
  const presentItems = usePresentToasts(items)
  if (presentItems.length === 0) return null

  return createPortal(
    <div className="toast-host" aria-label="系统通知">
      {presentItems.map((item) => {
        const Icon = TONE_ICONS[item.tone]
        const isError = item.tone === 'error'
        return (
          <div
            key={item.id}
            ref={element => { if (element) element.inert = item.exiting }}
            className={`toast-panel is-${item.tone}${item.exiting ? ' is-exiting' : ''}`}
            data-state={item.exiting ? 'exiting' : 'active'}
            role={isError ? 'alert' : 'status'}
            aria-hidden={item.exiting || undefined}
            aria-live={isError ? 'assertive' : 'polite'}
            aria-atomic="true"
            onPointerEnter={() => toastStore.hold(item.id, 'pointer', true)}
            onPointerLeave={() => toastStore.hold(item.id, 'pointer', false)}
            onFocus={() => toastStore.hold(item.id, 'focus', true)}
            onBlur={event => {
              if (!event.currentTarget.contains(event.relatedTarget)) toastStore.hold(item.id, 'focus', false)
            }}
          >
            <div className="toast-content">
              {Icon && <Icon className="toast-icon" size={ICON_MD} aria-hidden />}
              <span className="toast-message">{item.message}</span>
            </div>
            {item.actionLabel && item.onAction ? (
              <Button
                size="sm"
                className="toast-action"
                onClick={() => {
                  const active = toastStore.getVisible().find(candidate => candidate.id === item.id)
                  if (!active?.onAction) return
                  toastStore.dismiss(item.id)
                  active.onAction()
                }}
              >
                {item.actionLabel}
              </Button>
            ) : null}
            {item.persistent ? (
              <IconButton
                size="sm"
                className="toast-close"
                label="关闭通知"
                onClick={() => toastStore.dismiss(item.id)}
              >
                <X size={ICON_SM} aria-hidden />
              </IconButton>
            ) : null}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
