import { createPortal } from 'react-dom'
import { AlertCircle, AlertTriangle, CheckCircle, CircleDot, X } from '@/icons/appIcons'
import { ICON_MD } from '@/icons/iconSize'
import { useToast, type ToastTone } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import './Toast.css'

const TONE_ICONS = {
  info: CircleDot,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
} satisfies Record<ToastTone, typeof AlertCircle>

export function ToastHost() {
  const items = useToast((state) => state.items)
  const dismiss = useToast((state) => state.dismiss)
  if (items.length === 0) return null

  return createPortal(
    <div className="toast-host" aria-label="系统通知">
      {items.map((item) => {
        const Icon = TONE_ICONS[item.tone]
        const isError = item.tone === 'error'
        return (
          <div
            key={item.id}
            className={`toast-panel is-${item.tone}`}
            role={isError ? 'alert' : 'status'}
            aria-live={isError ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            <Icon className="toast-icon" size={ICON_MD} aria-hidden />
            <span className="toast-message">{item.message}</span>
            {item.actionLabel && item.onAction ? (
              <Button
                size="sm"
                className="toast-action"
                onClick={() => {
                  dismiss(item.id)
                  item.onAction?.()
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
                onClick={() => dismiss(item.id)}
              >
                <X size={ICON_MD} aria-hidden />
              </IconButton>
            ) : null}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
