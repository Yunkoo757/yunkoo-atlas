import { useToast } from '@/lib/toast'
import './Toast.css'

export function ToastHost() {
  const message = useToast((s) => s.message)
  const actionLabel = useToast((s) => s.actionLabel)
  const onAction = useToast((s) => s.onAction)
  const dismiss = useToast((s) => s.dismiss)
  if (!message) return null
  return (
    <div className="toast-host" role="status" aria-live="polite" aria-atomic="true">
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={() => {
            dismiss()
            onAction()
          }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
