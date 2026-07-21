import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { flushPersistNow } from '@/storage/persist'
import { useSaveStatus } from '@/store/saveStatus'
import { Tooltip } from '@/components/ui/Tooltip'
import './SaveStatusIndicator.css'

const LABELS = {
  idle: '',
  dirty: '未保存',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
} as const

const SAVED_VISIBLE_MS = 1600

export function SaveStatusIndicator() {
  const status = useSaveStatus((s) => s.status)
  const errorMessage = useSaveStatus((s) => s.errorMessage)
  const label = LABELS[status]

  useEffect(() => {
    if (status !== 'saved') return
    const timer = window.setTimeout(() => {
      useSaveStatus.getState().reset()
    }, SAVED_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  if (status === 'error') {
    const reason = errorMessage ?? '无法写入本地交易库'
    return (
      <span className="save-status-recovery" role="status" aria-live="assertive">
        <Tooltip asChild content={`保存失败：${reason}`} label="保存失败，点击重试">
          <button
            type="button"
            className="save-status save-status--error save-status--action"
            aria-label={`保存失败：${reason}。点击重试`}
            onClick={() => void flushPersistNow().catch(() => {})}
          >
            保存失败 · 重试
          </button>
        </Tooltip>
        <Tooltip asChild content="打开数据与备份设置" label="打开数据与备份设置">
          <Link
            className="save-status-recovery-link"
            to="/settings/data"
          >
            数据与备份
          </Link>
        </Tooltip>
      </span>
    )
  }

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
