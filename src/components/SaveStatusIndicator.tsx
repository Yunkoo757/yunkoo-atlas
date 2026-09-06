import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { flushPersistNow } from '@/storage/persist'
import { useSaveStatus } from '@/store/saveStatus'
import { InlineStatus } from '@/components/ui/InlineStatus'
import { Button } from '@/components/ui/Button'
import './SaveStatusIndicator.css'

const LABELS = {
  dirty: '未保存',
  saving: '保存中…',
  saved: '已保存',
} as const

const SAVED_VISIBLE_MS = 1600
const PENDING_VISIBLE_DELAY_MS = 600

export function SaveStatusIndicator({ quiet = true }: { quiet?: boolean }) {
  const status = useSaveStatus((state) => state.status)
  const errorMessage = useSaveStatus((state) => state.errorMessage)
  const [pendingVisible, setPendingVisible] = useState(false)
  const pending = status === 'dirty' || status === 'saving'

  useEffect(() => {
    if (!pending) {
      setPendingVisible(false)
      return
    }
    const timer = window.setTimeout(() => {
      setPendingVisible(true)
    }, PENDING_VISIBLE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [pending])

  useEffect(() => {
    if (status !== 'saved') return
    const timer = window.setTimeout(() => {
      useSaveStatus.getState().reset()
    }, SAVED_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [status])

  if (quiet && (status === 'idle' || status === 'saved' || (pending && !pendingVisible))) return null

  if (status === 'idle' || (pending && !pendingVisible)) {
    return <span className="save-status-slot" aria-hidden />
  }

  if (status === 'error') {
    const reason = errorMessage ?? '无法写入本地资料库'
    return (
      <InlineStatus
        compact
        className="save-status-recovery"
        tone="error"
        title="保存失败"
        detail={reason}
        action={(
          <>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`保存失败：${reason}。点击重试`}
              onClick={() => void flushPersistNow().catch(() => {})}
            >
              重试
            </Button>
            <Link className="save-status-recovery-link" to="/settings/data">
              数据与备份
            </Link>
          </>
        )}
      />
    )
  }

  return (
    <InlineStatus
      compact
      className={`save-status is-${status}`}
      tone={status === 'saved' ? 'success' : status === 'saving' ? 'progress' : 'neutral'}
      title={LABELS[status]}
    />
  )
}
