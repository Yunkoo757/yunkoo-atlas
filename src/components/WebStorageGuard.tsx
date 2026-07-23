import { useCallback, useState, useSyncExternalStore } from 'react'
import { ModalShell } from '@/components/ui/ModalShell'
import {
  applySnapshotToStore,
  clearSessionUiAfterLibrarySwitch,
  downloadWebConflictRecoveryCopy,
  resetEmptyLibraryIntoStore,
} from '@/lib/importExport'
import { useSaveStatus } from '@/store/saveStatus'
import { getIndexedDbAdapter } from '@/storage/indexedDbAdapter'
import { discardAllNoteDrafts } from '@/storage/noteDrafts'
import { waitForPendingStorageOperations } from '@/storage/pendingOperations'
import {
  discardPendingAndResumePersist,
  resumePersist,
  suspendPersist,
} from '@/storage/persist'
import {
  clearWebWriteConflictAfterReload,
  getWebWriteGuardState,
  requestWebWriterOwnership,
  subscribeWebWriteGuard,
} from '@/storage/webWriteGuard'

export function WebStorageGuard() {
  const guard = useSyncExternalStore(
    subscribeWebWriteGuard,
    getWebWriteGuardState,
    getWebWriteGuardState,
  )
  const [busy, setBusy] = useState<'export' | 'reload' | 'ownership' | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadLatest = useCallback(async () => {
    setBusy('reload')
    setMessage(null)
    suspendPersist()
    try {
      await waitForPendingStorageOperations()
      const envelope = await getIndexedDbAdapter().loadSnapshotEnvelope()
      discardAllNoteDrafts()
      if (envelope.snapshot) applySnapshotToStore(envelope.snapshot)
      else resetEmptyLibraryIntoStore()
      clearSessionUiAfterLibrarySwitch()
      discardPendingAndResumePersist()
      clearWebWriteConflictAfterReload(envelope.revision)
      useSaveStatus.getState().reset()
    } catch (error) {
      resumePersist({ flushNow: false })
      setMessage(error instanceof Error ? error.message : '加载资料库最新版失败，请重试。')
    } finally {
      setBusy(null)
    }
  }, [])

  if (guard.phase === 'inactive' || guard.phase === 'editable') return null

  if (guard.phase === 'conflict') {
    return (
      <ModalShell
        title="检测到资料库写入冲突"
        description="另一标签页已先保存。为避免覆盖数据，本标签页的自动保存和所有写入已冻结。"
        dismissible={false}
        busy={busy !== null}
        onClose={() => {}}
        footer={(
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setBusy('export')
                setMessage(null)
                void downloadWebConflictRecoveryCopy().then((result) => {
                  setMessage(result.missingAssetIds.length > 0
                    ? `已导出不完整抢救副本；明确缺少 ${result.missingAssetIds.length} 个附件。`
                    : '已导出本标签页未保存副本。')
                }).catch((error) => {
                  setMessage(error instanceof Error ? error.message : '抢救副本导出失败。')
                }).finally(() => setBusy(null))
              }}
            >
              导出本标签页未保存副本
            </button>
            <button type="button" className="is-primary" disabled={busy !== null} onClick={() => void loadLatest()}>
              加载资料库最新版
            </button>
          </>
        )}
      >
        <p>本标签页基于 revision {guard.expectedRevision}，资料库当前为 revision {guard.actualRevision}。</p>
        <p>请先导出需要保留的本地副本，再加载最新版。这里不会提供强制覆盖。</p>
        {message ? <p role="status">{message}</p> : null}
      </ModalShell>
    )
  }

  const requesting = guard.phase === 'requesting' || busy === 'ownership'
  return (
    <ModalShell
      title={guard.phase === 'readonly' && guard.reason === 'lock-lost'
        ? '编辑权已失效'
        : '资料库已在另一标签页编辑'}
      description="当前标签页保持只读，只有取得资料库独占编辑权后才能继续修改。"
      dismissible={false}
      busy={busy !== null}
      onClose={() => {}}
      footer={(
        <>
          <button type="button" disabled={busy !== null} onClick={() => void loadLatest()}>
            加载资料库最新版
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={busy !== null}
            onClick={() => {
              setBusy('ownership')
              setMessage('正在等待当前编辑标签页释放所有权…')
              void requestWebWriterOwnership().catch((error) => {
                setMessage(error instanceof Error ? error.message : '请求编辑权失败。')
              }).finally(() => setBusy(null))
            }}
          >
            {requesting ? '等待编辑权…' : '请求编辑权'}
          </button>
        </>
      )}
    >
      <p>关闭当前持有编辑权的标签页后，本标签页的等待请求才能成功。</p>
      {guard.remoteRevision !== undefined ? <p>检测到最新 revision：{guard.remoteRevision}</p> : null}
      {message ? <p role="status">{message}</p> : null}
    </ModalShell>
  )
}
