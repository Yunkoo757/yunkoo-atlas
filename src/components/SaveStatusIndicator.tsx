import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { flushPersistNow } from '@/storage/persist'
import { useSaveStatus } from '@/store/saveStatus'
import { InlineStatus } from '@/components/ui/InlineStatus'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { AlertCircle, Check, Clock } from '@/icons/appIcons'
import { ICON_SM } from '@/icons/iconSize'
import { LoadingIndicator } from '@/icons/LoadingIndicator'
import './SaveStatusIndicator.css'

const LABELS = {
  dirty: '待保存',
  saving: '保存中…',
  saved: '已保存',
} as const

const ICONS = {
  dirty: Clock,
  saving: LoadingIndicator,
  saved: Check,
}

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
        icon={<AlertCircle size={ICON_SM} aria-hidden />}
        action={(
          <>
            <Tooltip asChild showOnFocus content={reason} label="查看保存失败原因">
              <Button
                size="sm"
                className="save-status-retry"
                aria-label={`重试保存（${reason}）`}
                onClick={() => void flushPersistNow().catch(() => {})}
              >
                重试
              </Button>
            </Tooltip>
            <Link className="ui-btn ui-btn-ghost ui-btn-sm save-status-recovery-link" to="/settings/data">
              数据与备份
            </Link>
          </>
        )}
      />
    )
  }

  const Icon = ICONS[status]
  return (
    <InlineStatus
      compact
      className={`save-status is-${status}`}
      icon={<Icon size={ICON_SM} aria-hidden />}
      tone={status === 'saved' ? 'success' : status === 'saving' ? 'progress' : 'neutral'}
      title={LABELS[status]}
    />
  )
}
