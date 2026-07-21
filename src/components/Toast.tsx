import { createPortal } from 'react-dom'
import { useToast } from '@/lib/toast'
import './Toast.css'

export function ToastHost() {
  const id = useToast((s) => s.id)
  const message = useToast((s) => s.message)
  const actionLabel = useToast((s) => s.actionLabel)
  const onAction = useToast((s) => s.onAction)
  const dismiss = useToast((s) => s.dismiss)
  if (!message) return null
  return createPortal(
    <div className="toast-host" role="status" aria-live="polite" aria-atomic="true">
      {/* key 保证换文案时整卡重挂，避免 transform 动画与定位叠在同一层产生残影 */}
      <div key={id} className="toast-panel">
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
    </div>,
    document.body,
  )
}
