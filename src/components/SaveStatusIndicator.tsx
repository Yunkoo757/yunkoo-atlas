import { useEffect } from 'react'
import { useSaveStatus } from '@/store/saveStatus'
import './SaveStatusIndicator.css'

const LABELS = {
  idle: '',
  dirty: '本机未保存',
  saving: '保存到本机中…',
  saved: '本机已保存',
  error: '本机保存失败',
} as const

const SAVED_VISIBLE_MS = 1600

export function SaveStatusIndicator() {
  const status = useSaveStatus((s) => s.status)
  const label = LABELS[status]

  useEffect(() => {
    if (status !== 'saved') return
    const timer = window.setTimeout(() => {
      useSaveStatus.getState().reset()
    }, SAVED_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  return (
    <span
      className={`save-status save-status--${status}`}
      aria-live="polite"
      aria-hidden={!label}
    >
      {label || '\u00a0'}
    </span>
  )
}
