import { useEffect, useState, useCallback } from 'react'
import { DataIOContent } from '@/components/DataIOContent'
import { isElectron, getJournalBridge } from '@/storage/runtime'
import type { BackupInfo } from '@/types/journal-bridge'
import { toast } from '@/lib/toast'
import {
  applySnapshotToStore,
  clearSessionUiAfterLibrarySwitch,
} from '@/lib/importExport'
import {
  disablePersistWrites,
  discardPendingAndResumePersist,
  flushPersistNow,
  resumePersistAndFlush,
  suspendPersist,
} from '@/storage/persist'
import { useStore } from '@/store/useStore'
import { getStorage } from '@/storage'
import type { AssetPurgePreview } from '@/storage/adapter'
import { checkStorageHealth, type StorageHealth } from '@/lib/storageHealth'
import { Save, RotateCcw, Trash2, Clock, HardDrive, Image, Database, CheckCircle, AlertCircle } from '@/icons/appIcons'
import { Tooltip } from '@/components/ui/Tooltip'
import { ModalShell } from '@/components/ui/ModalShell'
import {
  flushStorageBeforeCutover,
  lockStorageCutoverInteraction,
} from '@/storage/cutover'
import { getElectronAdapter } from '@/storage/electronAdapter'
import { clearReviewSessionStorage } from '@/lib/reviewSession'
import { useSaveStatus } from '@/store/saveStatus'
import { buildWebJournalArchiveBlob } from '@/lib/importExport'

const ASSET_PURGE_COMMIT_ENABLED = import.meta.env.VITE_ENABLE_ASSET_PURGE_COMMIT === 'true'

function fmtBackupTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function DataSettingsPanel({
  assetPurgeCommitEnabled = ASSET_PURGE_COMMIT_ENABLED,
}: { assetPurgeCommitEnabled?: boolean } = {}) {
  const electron = isElectron()
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backing, setBacking] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<{
    kind: 'restore' | 'delete'
    name: string
  } | null>(null)
  const [health, setHealth] = useState<{
    storage: StorageHealth
    backupCount: number
    backupTotalSize: number
  } | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [purgePreview, setPurgePreview] = useState<AssetPurgePreview | null>(null)
  const [purgeBusy, setPurgeBusy] = useState(false)
  const [purgeArchiveReady, setPurgeArchiveReady] = useState(false)
  const [purgeAuthorization, setPurgeAuthorization] = useState<string | null>(null)
  const [purgeConfirmed, setPurgeConfirmed] = useState(false)
  const trades = useStore((s) => s.trades)
  const weeklyReviews = useStore((s) => s.weeklyReviews)
  const quickNotes = useStore((s) => s.quickNotes)

  const refreshHealth = useCallback(async () => {
    try {
      const storage = await checkStorageHealth()
      let backupCount = 0
      let backupTotalSize = 0
      if (electron) {
        try {
          const bridge = getJournalBridge()
          if (bridge) {
            const bs = await bridge.getBackupStats()
            backupCount = bs.count
            backupTotalSize = bs.totalSize
          }
        } catch { /* 备份统计失败不应伪装成附件清单失败。 */ }
      }
      setHealth({ storage, backupCount, backupTotalSize })
      setHealthError(null)
    } catch (error) {
      setHealth(null)
      setHealthError(error instanceof Error ? error.message : String(error))
    }
  }, [trades, weeklyReviews, quickNotes, electron])

  useEffect(() => {
    refreshHealth()
  }, [refreshHealth])

  const WARN_ATTACH_SIZE = 100 * 1024 * 1024 // 100 MB
  const WARN_BACKUP_SIZE = 500 * 1024 * 1024 // 500 MB

  const refreshBackups = async () => {
    if (!electron) return
    try {
      const list = await getJournalBridge()!.listBackups()
      setBackups(list)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    void refreshBackups()
  }, [electron])

  const handleCreateBackup = async () => {
    if (!electron) return
    setBacking(true)
    try {
      await flushPersistNow()
      const bridge = getJournalBridge()!
      const result = await bridge.createBackup()
      if (result) {
        const verification = await bridge.verifyBackup(result)
        toast(
          verification.status === 'verified'
            ? '备份已创建并验证'
            : verification.error ?? '备份已创建，但验证失败',
        )
        await Promise.all([refreshBackups(), refreshHealth()])
      } else {
        toast('备份失败')
      }
    } catch {
      toast('备份失败')
    } finally {
      setBacking(false)
    }
  }

  const handleRestore = async (name: string) => {
    if (!electron) return
    setConfirmRequest(null)
    setRestoring(name)
    const unlockInteraction = lockStorageCutoverInteraction()
    let suspended = false
    let safeToFlush = true
    try {
      await flushStorageBeforeCutover()
      suspendPersist()
      suspended = true
      const result = await getJournalBridge()!.restoreBackup(name)
      if (result && typeof result === 'object') {
        // bridge 已替换磁盘内容；内存切换完成前禁止旧快照重新写回。
        safeToFlush = false
        getElectronAdapter().clearObjectUrlCache()
        const manifest = await getStorage().getManifest()
        clearReviewSessionStorage(manifest.libraryId)
        applySnapshotToStore(result)
        clearSessionUiAfterLibrarySwitch()
        safeToFlush = true
        toast('备份已恢复')
        await Promise.all([refreshBackups(), refreshHealth()])
      } else {
        toast('恢复失败')
      }
    } catch {
      toast('恢复失败')
    } finally {
      if (suspended) {
        if (safeToFlush) {
          await resumePersistAndFlush().catch(() => toast('恢复后保存失败，请勿关闭软件'))
        } else {
          discardPendingAndResumePersist()
          disablePersistWrites()
          useSaveStatus.getState().setError('备份已恢复，但内存载入失败，自动保存已暂停')
          try {
            window.location?.reload()
          } catch {
            /* 正式客户端会重新载入已经恢复的资料库。 */
          }
        }
      }
      unlockInteraction()
      setRestoring(null)
    }
  }

  const handleVerify = async (name: string) => {
    if (!electron) return
    setVerifying(name)
    try {
      const result = await getJournalBridge()!.verifyBackup(name)
      await refreshBackups()
      toast(result.status === 'verified' ? '备份验证通过' : result.error ?? '备份验证失败')
    } catch {
      toast('备份验证失败')
    } finally {
      setVerifying(null)
    }
  }

  const handleVerifyAll = async () => {
    if (!electron || backups.length === 0) return
    setVerifying('all')
    let invalidCount = 0
    try {
      for (const backup of backups) {
        const result = await getJournalBridge()!.verifyBackup(backup.name)
        if (result.status !== 'verified') invalidCount++
      }
      await refreshBackups()
      toast(invalidCount === 0 ? '全部备份验证通过' : `${invalidCount} 份备份验证未通过，建议重新备份`)
    } catch {
      toast('备份验证未完成')
    } finally {
      setVerifying(null)
    }
  }

  const handleDelete = async (name: string) => {
    if (!electron) return
    setConfirmRequest(null)
    try {
      const deleted = await getJournalBridge()!.deleteBackup(name)
      if (!deleted) {
        toast('备份不存在或已被删除')
        return
      }
      await Promise.all([refreshBackups(), refreshHealth()])
      toast('备份已删除')
    } catch {
      toast('删除失败')
    }
  }

  const discardPurge = (preview = purgePreview) => {
    if (preview) void getStorage().cancelAssetPurge?.(preview.operationId)
    setPurgePreview(null)
    setPurgeArchiveReady(false)
    setPurgeAuthorization(null)
    setPurgeConfirmed(false)
  }

  const handlePreviewAssetPurge = async () => {
    setPurgeBusy(true)
    try {
      await flushPersistNow()
      const preview = await getStorage().previewAssetPurge?.()
      if (!preview) throw new Error('当前存储后端不支持附件清理预览')
      if (preview.candidateIds.length === 0) {
        toast('当前库没有可永久清理的孤立附件')
        await refreshHealth()
        return
      }
      setPurgeArchiveReady(false)
      setPurgeAuthorization(null)
      setPurgeConfirmed(false)
      setPurgePreview(preview)
    } catch (error) {
      toast(error instanceof Error ? error.message : '附件清理预览失败')
    } finally {
      setPurgeBusy(false)
    }
  }

  const handleCreatePurgeRecoveryArchive = async () => {
    if (!purgePreview) return
    setPurgeBusy(true)
    let refreshedPreview: AssetPurgePreview | null = null
    try {
      await flushPersistNow()
      refreshedPreview = await getStorage().previewAssetPurge?.() ?? null
      if (!refreshedPreview) throw new Error('恢复归档已导出，但无法重新生成附件清理预览')
      const recovery = await getStorage().prepareAssetPurgeRecovery?.(refreshedPreview)
      if (!recovery) throw new Error('当前存储后端无法生成清理恢复归档')
      if (recovery.webArchive) {
        const blob = buildWebJournalArchiveBlob(
          recovery.webArchive.snapshot,
          recovery.webArchive.assets,
          { recoveryOrphanAssetIds: recovery.webArchive.recoveryOrphanAssetIds },
        )
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `linear-journal-before-cleanup-${new Date().toISOString().slice(0, 10)}.journal.zip`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
      }
      if (purgePreview.operationId !== refreshedPreview.operationId) {
        await getStorage().cancelAssetPurge?.(purgePreview.operationId)
      }
      setPurgePreview(refreshedPreview)
      setPurgeAuthorization(recovery.authorization)
      setPurgeArchiveReady(true)
      toast('当前交易库恢复归档已导出')
    } catch (error) {
      if (refreshedPreview && refreshedPreview.operationId !== purgePreview.operationId) {
        await getStorage().cancelAssetPurge?.(refreshedPreview.operationId)
      }
      discardPurge()
      toast(error instanceof Error ? error.message : '恢复归档导出失败')
    } finally {
      setPurgeBusy(false)
    }
  }

  const handleCommitAssetPurge = async () => {
    if (!purgePreview || !purgeAuthorization || !purgeArchiveReady || !purgeConfirmed || !assetPurgeCommitEnabled) return
    setPurgeBusy(true)
    try {
      const commit = getStorage().commitAssetPurge
      if (!commit) throw new Error('当前存储后端不支持永久清理')
      const result = await commit.call(getStorage(), purgePreview, purgeAuthorization)
      setPurgePreview(null)
      setPurgeArchiveReady(false)
      setPurgeAuthorization(null)
      setPurgeConfirmed(false)
      await refreshHealth()
      toast(`已从当前库永久清理 ${result.deletedIds.length} 个孤立附件；历史备份未改变`)
    } catch (error) {
      discardPurge()
      toast(`${error instanceof Error ? error.message : '永久清理失败'}；请重新预览并重新导出恢复归档`)
    } finally {
      setPurgeBusy(false)
    }
  }

  return (
    <div className="settings-page data-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">数据</h1>
        <p className="settings-page-desc">导入、导出与备份本地交易库。</p>
      </div>
      <DataIOContent
        onLibraryChanged={() => {
          void refreshBackups()
          void refreshHealth()
        }}
      />

      {/* 存储健康面板 */}
      <section className="settings-page-section" style={{ marginTop: 32 }}>
        <div className="settings-page-head">
          <h2 className="settings-section-title">存储健康</h2>
          <p className="settings-section-desc">
            监控数据规模，及时发现膨胀风险。
          </p>
        </div>

        {healthError && (
          <div className="health-card health-warn" role="alert">
            <AlertCircle size={18} />
            <span className="health-label">附件清单读取失败</span>
            <span className="health-note">{healthError}</span>
          </div>
        )}

        {health && (
          <div className="health-grid">
            <div className="health-card">
              <Database size={18} />
              <span className="health-label">交易数</span>
              <span className="health-value">{health.storage.tradeCount}</span>
            </div>
            <div className={'health-card' + (
              health.storage.attachmentStats.totalBytes > WARN_ATTACH_SIZE ||
              health.storage.attachmentStats.missingCount > 0 ||
              health.storage.inventory.orphan.length > 0 ||
              health.storage.inventory.foreign.length > 0 ||
              health.storage.inventory.temp.length > 0
                ? ' health-warn'
                : ''
            )}>
              <Image size={18} />
              <span className="health-label">笔记图片</span>
              <span className="health-value">
                {health.storage.attachmentStats.count} 张 · {health.storage.attachmentStats.formattedSize}
              </span>
              {health.storage.attachmentStats.totalBytes > WARN_ATTACH_SIZE && (
                <span className="health-note">
                  {electron
                    ? '附件较多，建议创建并验证备份'
                    : '已接近浏览器完整备份 128 MB 上限，建议清理原图或分库'}
                </span>
              )}
              {health.storage.attachmentStats.missingCount > 0 && (
                <span className="health-note">
                  {health.storage.attachmentStats.missingCount} 张附件缺失或损坏
                </span>
              )}
              {health.storage.inventory.orphan.length > 0 && (
                <span className="health-note">{health.storage.inventory.orphan.length} 张当前库孤立附件</span>
              )}
              {health.storage.inventory.foreign.length > 0 && (
                <span className="health-note">{health.storage.inventory.foreign.length} 个未知或非法附件项</span>
              )}
              {health.storage.inventory.temp.length > 0 && (
                <span className="health-note">{health.storage.inventory.temp.length} 个未完成临时附件</span>
              )}
            </div>
            {electron && (
              <div className={'health-card' + (health.backupTotalSize > WARN_BACKUP_SIZE ? ' health-warn' : '')}>
                <HardDrive size={18} />
                <span className="health-label">备份占用</span>
                <span className="health-value">
                  {health.backupCount} 份 · {fmtBackupSize(health.backupTotalSize)}
                </span>
                {health.backupTotalSize > WARN_BACKUP_SIZE && (
                  <span className="health-note">超出建议上限，自动清理最旧备份</span>
                )}
              </div>
            )}
          </div>
        )}

        <button
          className="dio-btn"
          onClick={refreshHealth}
          style={{ marginTop: 12 }}
        >
          刷新检查
        </button>
        {health && health.storage.inventory.orphan.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="dio-btn dio-btn-warn"
              disabled={purgeBusy}
              onClick={() => void handlePreviewAssetPurge()}
            >
              <Trash2 size={14} />
              <span>{purgeBusy ? '扫描中…' : '预览永久清理'}</span>
            </button>
            <p className="dio-section-muted" style={{ marginTop: 8 }}>
              只检查当前活动库；历史备份不会被扫描或修改。默认仅 dry-run，不会删除文件。
            </p>
          </div>
        ) : null}
      </section>

      {electron && (
        <section className="settings-page-section" style={{ marginTop: 32 }}>
          <div className="settings-page-head">
            <h2 className="settings-section-title">自动备份</h2>
            <p className="settings-section-desc">
              每 15 分钟自动创建备份，并在退出前再保存一次。包含设置与原始附件，附件会去重；最多保留 7 份，总容量不超过 500 MB。
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              className="dio-btn dio-btn-primary"
              onClick={handleCreateBackup}
              disabled={backing}
            >
              <Save size={14} />
              <span>{backing ? '备份并验证中…' : '立即备份'}</span>
            </button>
            <button
              className="dio-btn"
              onClick={handleVerifyAll}
              disabled={backups.length === 0 || verifying !== null || restoring !== null}
            >
              <CheckCircle size={14} />
              <span>{verifying === 'all' ? '验证中…' : '验证全部'}</span>
            </button>
          </div>

          {backups.length === 0 && (
            <p className="dio-section-muted">暂无备份记录</p>
          )}

          {backups.length > 0 && (
            <div className="backup-list">
              {backups.map((b) => (
                <div key={b.name} className="backup-row">
                  <Clock size={14} className="backup-icon" />
                  <span className="backup-time">{fmtBackupTime(b.timestamp)}</span>
                  <span className="backup-meta">
                    {b.tradeCount != null ? `${b.tradeCount} 笔交易` : ''}
                    {b.strategyCount != null ? ` · ${b.strategyCount} 策略` : ''}
                    {b.attachmentCount != null ? ` · ${b.attachmentCount} 附件` : ''}
                  </span>
                  <span className="backup-size">{fmtBackupSize(b.size)}</span>
                  {b.verification?.status === 'verified' && (
                    <Tooltip
                      content={`最近验证：${fmtBackupTime(b.verification.checkedAt)}`}
                      label={`已验证，${fmtBackupTime(b.verification.checkedAt)}`}
                    >
                      <span className="backup-verification is-verified">
                        <CheckCircle size={13} />
                        已验证
                      </span>
                    </Tooltip>
                  )}
                  {b.verification?.status === 'invalid' && (
                    <Tooltip
                      content={b.verification.error ?? '备份验证失败'}
                      label={`验证失败：${b.verification.error ?? '未知原因'}`}
                    >
                      <span className="backup-verification is-invalid">
                        <AlertCircle size={13} />
                        验证失败
                      </span>
                    </Tooltip>
                  )}
                  {!b.verification && <span className="backup-verification">未验证</span>}
                  <div className="backup-actions">
                    <button
                      className="dio-btn"
                      onClick={() => handleVerify(b.name)}
                      disabled={verifying !== null || restoring !== null}
                    >
                      <CheckCircle size={13} />
                      <span>{verifying === b.name ? '验证中…' : '验证'}</span>
                    </button>
                    <button
                      className="dio-btn"
                      onClick={() => setConfirmRequest({ kind: 'restore', name: b.name })}
                      disabled={verifying !== null || restoring !== null || b.verification?.status === 'invalid'}
                    >
                      <RotateCcw size={13} />
                      <span>{restoring === b.name ? '恢复中…' : '恢复'}</span>
                    </button>
                    <Tooltip content="删除备份" label="删除此备份">
                      <button
                        className="dio-btn dio-btn-warn"
                        aria-label="删除此备份"
                        onClick={() => setConfirmRequest({ kind: 'delete', name: b.name })}
                        disabled={restoring !== null}
                      >
                        <Trash2 size={13} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}

          {backups.length > 0 && (
            <p className="dio-section-muted" style={{ marginTop: 8 }}>
              备份文件位于交易库目录的 <code>backups/</code> 下。
            </p>
          )}
        </section>
      )}
      {confirmRequest ? (
        <ModalShell
          title={confirmRequest.kind === 'restore' ? '恢复这个备份？' : '删除这个备份？'}
          description={confirmRequest.kind === 'restore'
            ? '当前交易库会被备份中的数据替换。建议先立即备份一次。'
            : '删除后无法再使用这份备份。'}
          size="compact"
          busy={confirmRequest.kind === 'restore' && restoring !== null}
          onClose={() => setConfirmRequest(null)}
          footer={(
            <>
              {confirmRequest.kind === 'restore' ? (
                <button
                  type="button"
                  className="ui-btn ui-btn-bordered"
                  disabled={backing || restoring !== null}
                  onClick={() => void handleCreateBackup()}
                >
                  {backing ? '备份并验证中…' : '恢复前先立即备份'}
                </button>
              ) : null}
              <button
                type="button"
                className="ui-btn ui-btn-bordered"
                data-autofocus
                onClick={() => setConfirmRequest(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={`ui-btn ${confirmRequest.kind === 'delete' ? 'ui-btn-danger-solid' : 'ui-btn-primary'}`}
                disabled={backing || (confirmRequest.kind === 'restore' && restoring !== null)}
                onClick={() => {
                  const { kind, name } = confirmRequest
                  void (kind === 'restore' ? handleRestore(name) : handleDelete(name))
                }}
              >
                {confirmRequest.kind === 'restore' ? '恢复备份' : '删除备份'}
              </button>
            </>
          )}
        >
          <p className="dio-section-muted"><code>{confirmRequest.name}</code></p>
        </ModalShell>
      ) : null}
      {purgePreview ? (
        <ModalShell
          title="永久清理当前库孤立附件"
          description="这是 dry-run 结果。候选只来自当前活动库，历史备份不会被扫描或修改。"
          size="compact"
          busy={purgeBusy}
          onClose={() => {
            if (purgeBusy) return
            discardPurge()
          }}
          footer={(
            <>
              <button
                type="button"
                className="ui-btn ui-btn-bordered"
                disabled={purgeBusy}
                onClick={() => void handleCreatePurgeRecoveryArchive()}
              >
                {purgeArchiveReady ? '恢复归档已导出' : '先导出恢复归档'}
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-bordered"
                data-autofocus
                disabled={purgeBusy}
                onClick={() => discardPurge()}
              >
                取消
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-danger-solid"
                disabled={purgeBusy || !purgeArchiveReady || !purgeConfirmed || !assetPurgeCommitEnabled}
                onClick={() => void handleCommitAssetPurge()}
              >
                永久删除候选附件
              </button>
            </>
          )}
        >
          <div className="dio-restore-warning" role="alert">
            <AlertCircle size={17} />
            <span>
              将永久删除 {purgePreview.candidateIds.length} 个附件（{fmtBackupSize(purgePreview.totalBytes)}）。
              成功后只能从刚导出的恢复归档找回。
            </span>
          </div>
          <p className="dio-section-muted">
            预览 revision：{purgePreview.revision}。预览后若数据变化，提交会被拒绝并要求重新扫描。
          </p>
          {!assetPurgeCommitEnabled ? (
            <p className="dio-section-muted">当前发布阶段仅开放 dry-run；实际删除开关将在独立观察期通过后启用。</p>
          ) : null}
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12 }}>
            <input
              type="checkbox"
              checked={purgeConfirmed}
              disabled={!purgeArchiveReady || purgeBusy || !assetPurgeCommitEnabled}
              onChange={(event) => setPurgeConfirmed(event.target.checked)}
            />
            <span>我已保存恢复归档，并确认只永久删除本次 dry-run 列出的当前库孤立附件。</span>
          </label>
        </ModalShell>
      ) : null}
    </div>
  )
}
