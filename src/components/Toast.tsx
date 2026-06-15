import { useToast } from '@/lib/toast'
import './Toast.css'

export function ToastHost() {
  const message = useToast((s) => s.message)
  if (!message) return null
  return <div className="toast-host">{message}</div>
}
