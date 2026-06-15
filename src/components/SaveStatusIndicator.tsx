import { useSaveStatus } from '@/store/saveStatus'
import './SaveStatusIndicator.css'

const LABELS = {
  idle: '',
  dirty: '未保存',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
} as const

export function SaveStatusIndicator() {
  const status = useSaveStatus((s) => s.status)
  const label = LABELS[status]
  if (!label) return null

  return (
    <span className={`save-status save-status--${status}`} aria-live="polite">
      {label}
    </span>
  )
}
