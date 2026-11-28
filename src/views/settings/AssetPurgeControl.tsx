import { useEffect, useRef, useState } from 'react'
import { DisclosureSummary } from '@/components/ui/DisclosureSummary'
import { ModalShell } from '@/components/ui/ModalShell'
import { rendererAllowsAssetPurge } from '@/config/assetPurge'
import { ICON_SM } from '@/icons/iconSize'
import { Trash2 } from '@/icons/appIcons'
import { fmtBytes } from '@/lib/format'
import { toast } from '@/lib/toast'
import { userFacingErrorMessage } from '@/lib/userFacingError'
import { AssetPurgeSession, type PurgeSelection } from './assetPurgeSession'

interface Props {
  hasOrphans: boolean
  commitEnabled?: boolean
  refreshHealth(): Promise<void>
}

export function AssetPurgeControl({ hasOrphans, commitEnabled = rendererAllowsAssetPurge(), refreshHealth }: Props) {
  const current = useRef<AssetPurgeSession | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [selection, setSelection] = useState<PurgeSelection | null>(null)
  const [busy, setBusy] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const preview = selection?.preview
  const archived = selection?.authorization !== undefined

  useEffect(() => () => {
    current.current?.close()
    current.current = null
  }, [])

  function close() {
    current.current?.close()
    current.current = null
    setSelection(null)
    setExportError(null)
    setBusy(false)
  }

  async function open() {
    if (current.current) return
    const session = new AssetPurgeSession()
    current.current = session
    setBusy(true)
    try {
      const result = await session.scan()
      if (!result || session.closed) return
      if (!result.candidateIds.length) {
        close()
        toast('当前库没有可永久清理的孤立附件')
        await refreshHealth()
        return
      }
      setSelection({ preview: result })
    } catch (error) {
      if (session.closed) return
      close()
      console.warn('[DataSettings] 预览附件清理失败', error)
      toast(userFacingErrorMessage(error, '附件清理预览失败'), { tone: 'error', persistent: false })
    } finally {
      if (!session.closed) setBusy(false)
    }
  }

  async function exportRecovery() {
    const session = current.current
    if (!session || !preview) return
    setExportError(null)
    setBusy(true)
    try {
      const result = await session.exportRecovery(preview)
      if (!result || session.closed) return
      setSelection(result)
      toast('当前资料库恢复归档已导出', { tone: 'success' })
    } catch (error) {
      if (session.closed || (error instanceof Error && error.message === '恢复归档导出已取消')) return
      console.warn('[DataSettings] 导出清理恢复归档失败', error)
      setExportError(userFacingErrorMessage(error, '恢复归档导出失败'))
    } finally {
      if (!session.closed) setBusy(false)
    }
  }

  async function commit() {
    const session = current.current
    if (!session || !selection || !commitEnabled) return
    setBusy(true)
    try {
      const result = await session.commit(selection)
      if (session.closed) return
      close()
      await refreshHealth()
      toast(`已从当前库永久清理 ${result.deletedIds.length} 个孤立附件；历史备份未改变`, { tone: 'success' })
    } catch (error) {
      if (session.closed) return
      console.warn('[DataSettings] 永久清理附件失败', error)
      close()
      toast(`${userFacingErrorMessage(error, '永久清理失败')}；请重新预览后再确认`, { tone: 'error' })
    }
  }

  return (
    <>
      {hasOrphans ? (
        <div className="data-actions-row">
          <p className="data-support-note">
            {commitEnabled
              ? '清理当前资料库中未被任何内容引用的孤立附件'
              : '当前已关闭永久清理，仅支持候选预览与恢复归档导出'}
          </p>
          <button
            type="button"
            ref={trigger}
            className="dio-btn dio-btn-warn"
            disabled={busy}
            onClick={() => void open()}
          >
            <Trash2 size={ICON_SM} />
            <span>{busy ? '扫描中…' : '清理孤立附件'}</span>
          </button>
        </div>
      ) : null}
      {preview ? (
        <ModalShell
          title={commitEnabled ? '清理孤立附件' : '预览孤立附件'}
          bodyClassName="data-purge-body"
          returnFocusTo={trigger.current}
          description={
            commitEnabled
              ? '只清理当前资料库中已无引用的附件。历史备份不会被扫描或修改。'
              : '此预览仅统计当前资料库中已无引用的附件。'
          }
          size="compact"
          busy={busy}
          onClose={() => {
            if (busy) return
            close()
          }}
          footer={(
            <>
              <button
                type="button"
                className={!commitEnabled && !archived ? 'ui-btn ui-btn-primary' : 'ui-btn ui-btn-bordered'}
                disabled={busy || archived}
                onClick={() => void exportRecovery()}
              >
                {archived
                  ? '恢复归档已导出'
                  : commitEnabled
                    ? '导出恢复归档（可选）'
                    : '导出恢复归档'}
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-bordered"
                data-autofocus={commitEnabled ? true : undefined}
                disabled={busy}
                onClick={() => close()}
              >
                {commitEnabled ? '取消' : '关闭'}
              </button>
              {commitEnabled ? (
                <button
                  type="button"
                  className="ui-btn ui-btn-danger-solid"
                  disabled={busy}
                  onClick={() => void commit()}
                >
                  确认永久清理
                </button>
              ) : null}
            </>
          )}
        >
          {exportError ? <div role="alert">
            <p>{commitEnabled ? '恢复归档导出失败，您仍可直接清理，或选择其他保存位置重试。' : '恢复归档导出失败，请选择其他保存位置重试。'}</p>
            <details><DisclosureSummary>查看失败详情</DisclosureSummary><p>{exportError}</p></details>
          </div> : null}
          <div className="data-purge-summary">
            <span>{commitEnabled ? '待清理' : '扫描结果'}</span>
            <strong>{preview.candidateIds.length} 个 · {fmtBytes(preview.totalBytes)}</strong>
            <small>{commitEnabled ? '永久清理后无法从当前资料库恢复。' : '当前永久清理已关闭。'}</small>
          </div>
          <details className="data-purge-details">
            <DisclosureSummary>安全校验信息</DisclosureSummary>
            <p>
              数据版本：{preview.revision}。
              {commitEnabled
                ? '预览后若数据变化，提交会被拒绝并要求重新扫描。'
                : '重新扫描可刷新候选列表。'}
            </p>
          </details>
        </ModalShell>
      ) : null}
    </>
  )
}
