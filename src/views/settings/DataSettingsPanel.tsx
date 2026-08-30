import { ICON_LG, ICON_SM } from '@/icons/iconSize'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { DataIOContent } from '@/components/DataIOContent'
import { LivePerformanceCycleControl } from '@/components/LivePerformanceCycleControl'
import { LiveStageManager } from '@/components/LiveStageManager'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
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
import { clearReviewSessionFilters, clearReviewSessionStorage } from '@/lib/reviewSession'
import { useSaveStatus } from '@/store/saveStatus'
import { buildWebJournalArchiveBlob } from '@/lib/importExport'
import { userFacingErrorMessage } from '@/lib/userFacingError'
import { listPendingStageOwnership } from '@/lib/stageOwnershipRepair'
import { notifyStorageRecoveryRequired } from '@/lib/storageRecovery'
import {
  automaticVerificationTarget,
  presentBackupHealth,
  type BackupListState,
} from '@/lib/backupHealthPresentation'

const ASSET_PURGE_COMMIT_ENABLED = import.meta.env.VITE_ENABLE_ASSET_PURGE_COMMIT !== 'false'

function reportDataSettingsFailure(operation: string, error: unknown): void {
  console.warn(`[DataSettings] ${operation}`, error)
}

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

export function StageOwnershipHealthEntry() {
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const trades = useStore((state) => state.trades)
  const weeklyReviews = useStore((state) => state.weeklyReviews)
  const weeklyRiskPreparations = useStore((state) => state.weeklyRiskPreparations)
  const riskPolicyVersions = useStore((state) => state.riskPolicyVersions)
  const monthlyRiskLimits = useStore((state) => state.monthlyRiskLimits)
  const riskOverrideEvents = useStore((state) => state.riskOverrideEvents)
  const pendingCount = useMemo(() => listPendingStageOwnership({
    liveStages,
    currentLiveStageId,
    trades,
    weeklyReviews,
    weeklyRiskPreparations,
    riskPolicyVersions,
    monthlyRiskLimits,
    riskOverrideEvents,
  }).length, [
    currentLiveStageId,
    liveStages,
    monthlyRiskLimits,
    riskOverrideEvents,
    riskPolicyVersions,
    trades,
    weeklyReviews,
    weeklyRiskPreparations,
  ])

  if (pendingCount === 0) return null

  return (
    <Link
      className="data-attention-row"
      data-stage-ownership-health-entry
      to="/settings/data/stage-ownership-repair"
      aria-label={`待归属记录，${pendingCount} 项`}
    >
      <AlertCircle size={ICON_SM} />
      <span>
        <strong>{pendingCount} 条记录需要整理</strong>
        <small>补充所属实盘阶段</small>
      </span>
      <span className="data-attention-action">查看并修复</span>
    </Link>
  )
}

export function DataSettingsPanel({
  assetPurgeCommitEnabled = ASSET_PURGE_COMMIT_ENABLED,
}: { assetPurgeCommitEnabled?: boolean } = {}) {
  const currentTradingDayKey = useLocalDateKey()
  const electron = isElectron()
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backupListState, setBackupListState] = useState<BackupListState>(electron ? 'loading' : 'loaded')
  const [backing, setBacking] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<{
    kind: 'restore' | 'delete'
    backup: BackupInfo
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
  const [stageManagerOpen, setStageManagerOpen] = useState(false)
  const automaticVerificationAttempts = useRef(new Set<string>())
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
        } catch (error) {
          reportDataSettingsFailure('读取备份统计失败', error)
        }
      }
      setHealth({ storage, backupCount, backupTotalSize })
      setHealthError(null)
    } catch (error) {
      setHealth(null)
      reportDataSettingsFailure('读取存储健康失败', error)
      setHealthError(userFacingErrorMessage(error, '暂时无法读取存储健康信息'))
    }
  }, [trades, weeklyReviews, quickNotes, electron])

  useEffect(() => {
    refreshHealth()
  }, [refreshHealth])

  const refreshBackups = async () => {
    if (!electron) return
    setBackupListState('loading')
    try {
      const list = await getJournalBridge()!.listBackups()
      setBackups(list)
      setBackupListState('loaded')
    } catch (error) {
      reportDataSettingsFailure('刷新备份列表失败', error)
      setBackupListState('error')
    }
  }

  const backupHealth = useMemo(
    () => presentBackupHealth(backupListState, backups),
    [backupListState, backups],
  )

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
    } catch (error) {
      reportDataSettingsFailure('创建备份失败', error)
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
      safeToFlush = false
      const result = await getJournalBridge()!.restoreBackup(name)
      safeToFlush = !result.committed
      if (result.ok) {
        // bridge 已替换磁盘内容；内存切换完成前禁止旧快照重新写回。
        safeToFlush = false
        getElectronAdapter().clearObjectUrlCache()
        const manifest = await getStorage().getManifest()
        clearReviewSessionStorage(manifest.libraryId)
        clearReviewSessionFilters(manifest.libraryId)
        applySnapshotToStore(result.snapshot)
        clearSessionUiAfterLibrarySwitch()
        safeToFlush = true
        toast('备份已恢复')
        await Promise.all([refreshBackups(), refreshHealth()])
      } else {
        toast(result.error ?? '恢复失败')
      }
    } catch (error) {
      reportDataSettingsFailure('恢复备份失败', error)
      toast('恢复失败')
    } finally {
      if (suspended) {
        if (safeToFlush) {
          await resumePersistAndFlush().catch(() => toast('恢复后保存失败，请勿关闭软件'))
        } else {
          discardPendingAndResumePersist()
          disablePersistWrites()
          const message = '备份替换已开始，但界面无法安全载入磁盘状态；已停止保存，请重新打开资料库'
          useSaveStatus.getState().setError(message)
          notifyStorageRecoveryRequired(message)
        }
      }
      unlockInteraction()
      setRestoring(null)
    }
  }

  const handleVerify = async (name: string, quiet = false) => {
    if (!electron) return
    setVerifying(name)
    try {
      const result = await getJournalBridge()!.verifyBackup(name)
      await refreshBackups()
      if (!quiet || result.status !== 'verified') {
        toast(result.status === 'verified' ? '备份验证通过' : result.error ?? '备份验证失败')
      }
    } catch (error) {
      reportDataSettingsFailure('验证备份失败', error)
      if (!quiet) toast('备份验证失败')
    } finally {
      setVerifying(null)
    }
  }

  useEffect(() => {
    if (!electron || verifying !== null || restoring !== null) return
    const target = automaticVerificationTarget(backupListState, backups)
    if (!target || automaticVerificationAttempts.current.has(target.name)) return
    automaticVerificationAttempts.current.add(target.name)
    void handleVerify(target.name, true)
  }, [backupListState, backups, electron, restoring, verifying])

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
    } catch (error) {
      reportDataSettingsFailure('批量验证备份失败', error)
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
    } catch (error) {
      reportDataSettingsFailure('删除备份失败', error)
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
        await getStorage().cancelAssetPurge?.(preview.operationId)
        toast('当前库没有可永久清理的孤立附件')
        await refreshHealth()
        return
      }
      setPurgeArchiveReady(false)
      setPurgeAuthorization(null)
      setPurgeConfirmed(false)
      setPurgePreview(preview)
    } catch (error) {
      reportDataSettingsFailure('预览附件清理失败', error)
      toast(userFacingErrorMessage(error, '附件清理预览失败'))
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
        anchor.download = `trader-atlas-before-cleanup-${new Date().toISOString().slice(0, 10)}.journal.zip`
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
      setPurgeConfirmed(false)
      toast('当前资料库恢复归档已导出')
    } catch (error) {
      reportDataSettingsFailure('导出清理恢复归档失败', error)
      if (refreshedPreview && refreshedPreview.operationId !== purgePreview.operationId) {
        await getStorage().cancelAssetPurge?.(refreshedPreview.operationId)
      }
      discardPurge()
      toast(userFacingErrorMessage(error, '恢复归档导出失败'))
    } finally {
      setPurgeBusy(false)
    }
  }

  const handleCommitAssetPurge = async () => {
    if (!purgePreview || !purgeConfirmed || !assetPurgeCommitEnabled) return
    setPurgeBusy(true)
    try {
      const commit = getStorage().commitAssetPurge
      if (!commit) throw new Error('当前存储后端不支持永久清理')
      const result = await commit.call(getStorage(), purgePreview, purgeAuthorization ?? undefined)
      setPurgePreview(null)
      setPurgeArchiveReady(false)
      setPurgeAuthorization(null)
      setPurgeConfirmed(false)
      await refreshHealth()
      toast(`已从当前库永久清理 ${result.deletedIds.length} 个孤立附件；历史备份未改变`)
    } catch (error) {
      reportDataSettingsFailure('永久清理附件失败', error)
      discardPurge()
      toast(`${userFacingErrorMessage(error, '永久清理失败')}；请重新预览后再确认`)
    } finally {
      setPurgeBusy(false)
    }
  }

  return (
    <div className="settings-page settings-page--reading data-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">数据</h1>
      </div>
      <DataIOContent
        onLibraryChanged={() => {
          void refreshBackups()
          void refreshHealth()
        }}
      />
      <section className="settings-page-section">
        <div className="settings-page-head">
          <h2 className="settings-section-title">实盘阶段</h2>
        </div>
        <LivePerformanceCycleControl onManage={() => setStageManagerOpen(true)} />
      </section>
      {stageManagerOpen ? (
        <LiveStageManager
          currentTradingDayKey={currentTradingDayKey}
          onClose={() => setStageManagerOpen(false)}
        />
      ) : null}

      {/* 存储健康面板 */}
      <section className="settings-page-section">
        <div className="settings-page-head">
          <h2 className="settings-section-title">资料概况</h2>
        </div>

        <StageOwnershipHealthEntry />

        {healthError && (
          <div className="data-attention-row is-danger" role="alert">
            <AlertCircle size={ICON_SM} />
            <span>
              <strong>无法读取资料概况</strong>
              <small>{healthError}</small>
            </span>
          </div>
        )}

        {health && (
          <div className="storage-summary" aria-label="资料库概况">
            <span><Database size={ICON_SM} /><strong>{health.storage.tradeCount}</strong> 笔交易</span>
            <span><Image size={ICON_SM} /><strong>{health.storage.attachmentStats.count}</strong> 张图片 · {health.storage.attachmentStats.formattedSize}</span>
            {electron ? <span><HardDrive size={ICON_SM} /><strong>{health.backupCount}</strong> 份备份 · {fmtBackupSize(health.backupTotalSize)}</span> : null}
          </div>
        )}

        {health && (
          health.storage.attachmentStats.missingCount > 0 ||
          health.storage.inventory.orphan.length > 0 ||
          health.storage.inventory.foreign.length > 0 ||
          health.storage.inventory.temp.length > 0
        ) ? (
          <div className="data-attention-row">
            <AlertCircle size={ICON_SM} />
            <span>
              <strong>附件需要整理</strong>
              <small>
                {[
                  health.storage.attachmentStats.missingCount > 0 ? `${health.storage.attachmentStats.missingCount} 张缺失或损坏` : '',
                  health.storage.inventory.orphan.length > 0 ? `${health.storage.inventory.orphan.length} 张未被引用` : '',
                  health.storage.inventory.foreign.length > 0 ? `${health.storage.inventory.foreign.length} 个未知项` : '',
                  health.storage.inventory.temp.length > 0 ? `${health.storage.inventory.temp.length} 个临时项` : '',
                ].filter(Boolean).join(' · ')}
              </small>
            </span>
          </div>
        ) : null}

        <button
          className="dio-btn data-refresh-action"
          onClick={refreshHealth}
        >
          刷新
        </button>
        {health && health.storage.inventory.orphan.length > 0 ? (
          <div className="data-actions-row is-top">
            <button
              type="button"
              className="dio-btn dio-btn-warn"
              disabled={purgeBusy}
              onClick={() => void handlePreviewAssetPurge()}
            >
              <Trash2 size={ICON_SM} />
              <span>{purgeBusy ? '扫描中…' : '清理孤立附件'}</span>
            </button>
            <p className="data-support-note">
              {assetPurgeCommitEnabled
                ? '只处理当前资料库中未被任何内容引用的附件；恢复归档可按需导出。'
                : '当前已关闭永久清理，只提供候选预览和恢复归档导出。'}
            </p>
          </div>
        ) : null}
      </section>

      {electron && (
        <section className="settings-page-section">
          <div className="settings-page-head">
            <h2 className="settings-section-title">自动备份</h2>
          </div>

          <div className={`backup-health-status is-${backupHealth.tone}`} role={backupListState === 'error' ? 'alert' : 'status'}>
            <div>
              <strong>{backupHealth.title}</strong>
              {backupHealth.detail ? <span>{backupHealth.detail}</span> : null}
              {backupHealth.latest?.verification?.checkedAt ? <small>最近验证：{fmtBackupTime(backupHealth.latest.verification.checkedAt)}</small> : null}
              {backupHealth.lastVerified && backupHealth.lastVerified.name !== backupHealth.latest?.name ? <small>最后可用备份：{fmtBackupTime(backupHealth.lastVerified.timestamp)}</small> : null}
            </div>
            {backupHealth.action === 'retry-load' ? <button type="button" className="dio-btn" onClick={() => void refreshBackups()}>重试读取</button> : null}
            {backupHealth.action === 'create' ? <button type="button" className="dio-btn" disabled={backing} onClick={() => void handleCreateBackup()}>重新备份并验证</button> : null}
            {backupHealth.action === 'verify-latest' && backupHealth.latest ? <button type="button" className="dio-btn" disabled={verifying !== null} onClick={() => void handleVerify(backupHealth.latest!.name)}>验证最新备份</button> : null}
          </div>

          <div className="data-actions-row">
            <button
              className="dio-btn"
              onClick={handleCreateBackup}
              disabled={backing}
            >
              <Save size={ICON_SM} />
              <span>{backing ? '备份并验证中…' : '立即备份'}</span>
            </button>
          </div>

          {backups.length > 0 && (
            <details className="data-maintenance-disclosure">
              <summary>查看备份 <span>{backups.length}</span></summary>
              <div className="data-maintenance-actions">
                <button
                  className="dio-btn"
                  onClick={handleVerifyAll}
                  disabled={verifying !== null || restoring !== null}
                >
                  <CheckCircle size={ICON_SM} />
                  <span>{verifying === 'all' ? '验证中…' : '验证全部'}</span>
                </button>
              </div>
              <div className="backup-list">
                {backups.map((b) => (
                <div key={b.name} className="backup-row">
                  <Clock size={ICON_SM} className="backup-icon" />
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
                        <CheckCircle size={ICON_SM} />
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
                        <AlertCircle size={ICON_SM} />
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
                      <CheckCircle size={ICON_SM} />
                      <span>{verifying === b.name ? '验证中…' : '验证'}</span>
                    </button>
                    <button
                      className="dio-btn"
                      onClick={() => setConfirmRequest({ kind: 'restore', backup: b })}
                      disabled={verifying !== null || restoring !== null || b.verification?.status !== 'verified'}
                    >
                      <RotateCcw size={ICON_SM} />
                      <span>{restoring === b.name ? '恢复中…' : '恢复'}</span>
                    </button>
                    <Tooltip content="删除备份" label="删除此备份">
                      <button
                        className="dio-btn dio-btn-warn"
                        aria-label="删除此备份"
                        onClick={() => setConfirmRequest({ kind: 'delete', backup: b })}
                        disabled={restoring !== null}
                      >
                        <Trash2 size={ICON_SM} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
                ))}
              </div>
              <p className="data-path-note">
                备份保存在资料库的 <code>backups/</code> 目录。
              </p>
            </details>
          )}
        </section>
      )}
      {confirmRequest ? (
        <ModalShell
          title={confirmRequest.kind === 'restore' ? '恢复这个备份？' : '删除这个备份？'}
          description={confirmRequest.kind === 'restore'
            ? '当前资料库会被备份中的数据替换。建议先立即备份一次。'
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
                  const { kind, backup } = confirmRequest
                  const name = backup.name
                  void (kind === 'restore' ? handleRestore(name) : handleDelete(name))
                }}
              >
                {confirmRequest.kind === 'restore' ? '恢复备份' : '删除备份'}
              </button>
            </>
          )}
        >
          <dl className="dio-restore-grid">
            <div><dt>备份时间</dt><dd>{fmtBackupTime(confirmRequest.backup.timestamp)}</dd></div>
            <div><dt>交易与案例</dt><dd>{confirmRequest.backup.tradeCount ?? '—'}</dd></div>
            <div><dt>策略</dt><dd>{confirmRequest.backup.strategyCount ?? '—'}</dd></div>
            <div><dt>附件</dt><dd>{confirmRequest.backup.attachmentCount ?? '—'}</dd></div>
            <div><dt>验证状态</dt><dd>{confirmRequest.backup.verification?.status === 'verified' ? `已验证 · ${fmtBackupTime(confirmRequest.backup.verification.checkedAt)}` : '未通过验证'}</dd></div>
          </dl>
        </ModalShell>
      ) : null}
      {purgePreview ? (
        <ModalShell
          title={assetPurgeCommitEnabled ? '清理孤立附件' : '预览孤立附件'}
          description={
            assetPurgeCommitEnabled
              ? '只处理当前资料库中未被任何内容引用的附件；历史备份不会被扫描或修改。'
              : '当前已关闭永久清理；历史备份不会被扫描或修改。'
          }
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
                className={assetPurgeCommitEnabled ? 'ui-btn ui-btn-bordered' : 'ui-btn ui-btn-primary'}
                disabled={purgeBusy}
                onClick={() => void handleCreatePurgeRecoveryArchive()}
              >
                {purgeArchiveReady
                  ? '恢复归档已导出'
                  : assetPurgeCommitEnabled
                    ? '导出恢复归档（可选）'
                    : '导出恢复归档'}
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-bordered"
                data-autofocus={assetPurgeCommitEnabled ? true : undefined}
                disabled={purgeBusy}
                onClick={() => discardPurge()}
              >
                {assetPurgeCommitEnabled ? '取消' : '关闭'}
              </button>
              {assetPurgeCommitEnabled ? (
                <button
                  type="button"
                  className="ui-btn ui-btn-danger-solid"
                  disabled={purgeBusy || !purgeConfirmed}
                  onClick={() => void handleCommitAssetPurge()}
                >
                  确认永久清理
                </button>
              ) : null}
            </>
          )}
        >
          <div className="data-purge-summary">
            <span>{assetPurgeCommitEnabled ? '待清理' : '扫描结果'}</span>
            <strong>{purgePreview.candidateIds.length} 个 · {fmtBackupSize(purgePreview.totalBytes)}</strong>
            <small>{assetPurgeCommitEnabled ? '永久清理不可撤销；恢复归档可选。' : '当前永久清理已关闭。'}</small>
          </div>
          <details className="data-purge-details">
            <summary>安全校验信息</summary>
            <p>
              数据版本：{purgePreview.revision}。
              {assetPurgeCommitEnabled
                ? '预览后若数据变化，提交会被拒绝并要求重新扫描。'
                : '重新扫描可刷新候选列表。'}
            </p>
          </details>
          {assetPurgeCommitEnabled ? (
            <label className="data-purge-confirm">
              <input
                type="checkbox"
                checked={purgeConfirmed}
                disabled={purgeBusy}
                onChange={(event) => setPurgeConfirmed(event.target.checked)}
              />
              <span>我确认清理本次列出的未引用附件，并理解删除后无法从当前资料库恢复。</span>
            </label>
          ) : null}
        </ModalShell>
      ) : null}
    </div>
  )
}
