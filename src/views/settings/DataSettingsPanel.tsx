import { fmtBytes } from '@/lib/format'
import { BackupRestoreFlushError, restoreLibraryBackup } from '@/lib/libraryRestore'
import { flushPersistNow } from '@/storage/persist'
import { ICON_LG, ICON_SM } from '@/icons/iconSize'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { DisclosureSummary } from '@/components/ui/DisclosureSummary'
import { DataIOContent } from '@/components/DataIOContent'
import { LivePerformanceCycleControl } from '@/components/LivePerformanceCycleControl'
import { LiveStageManager } from '@/components/LiveStageManager'
import { AssetPurgeControl } from './AssetPurgeControl'
import { DataOrganizationPanel } from './DataOrganizationPanel'
import { StageOwnershipAutoRepair } from '@/components/StageOwnershipAutoRepair'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { isElectron, getJournalBridge } from '@/storage/runtime'
import type { BackupInfo } from '@/types/journal-bridge'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { checkStorageHealth, type StorageHealth } from '@/lib/storageHealth'
import { Save, RotateCcw, Trash2, Clock, HardDrive, Image, Database, CheckCircle, AlertCircle } from '@/icons/appIcons'
import { Tooltip } from '@/components/ui/Tooltip'
import { ModalShell } from '@/components/ui/ModalShell'
import { userFacingErrorMessage } from '@/lib/userFacingError'
import { listPendingStageOwnership } from '@/lib/stageOwnershipRepair'
import {
  automaticVerificationTarget,
  presentBackupHealth,
  type BackupListState,
} from '@/lib/backupHealthPresentation'


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
  assetPurgeCommitEnabled,
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
          { tone: verification.status === 'verified' ? 'success' : 'error' },
        )
        await Promise.all([refreshBackups(), refreshHealth()])
      } else {
        toast('备份失败', { tone: 'error' })
      }
    } catch (error) {
      reportDataSettingsFailure('创建备份失败', error)
      toast('备份失败', { tone: 'error' })
    } finally {
      setBacking(false)
    }
  }

  const handleRestore = async (name: string) => {
    if (!electron) return
    setConfirmRequest(null)
    setRestoring(name)
    try {
      const result = await restoreLibraryBackup(name, async () => {
        await Promise.all([refreshBackups(), refreshHealth()])
      })
      if (result.ok) toast('备份已恢复', { tone: 'success' })
      else toast(result.error ?? '恢复失败', { tone: 'error' })
    } catch (error) {
      reportDataSettingsFailure('恢复备份失败', error)
      toast(error instanceof BackupRestoreFlushError ? error.message : '恢复失败', { tone: 'error' })
    } finally {
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
        toast(
          result.status === 'verified' ? '备份验证通过' : result.error ?? '备份验证失败',
          { tone: result.status === 'verified' ? 'success' : 'error' },
        )
      }
    } catch (error) {
      reportDataSettingsFailure('验证备份失败', error)
      if (!quiet) toast('备份验证失败', { tone: 'error' })
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
      toast(
        invalidCount === 0 ? '全部备份验证通过' : `${invalidCount} 份备份验证未通过，建议重新备份`,
        { tone: invalidCount === 0 ? 'success' : 'error' },
      )
    } catch (error) {
      reportDataSettingsFailure('批量验证备份失败', error)
      toast('备份验证未完成', { tone: 'error' })
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
        toast('备份不存在或已被删除', { tone: 'warning' })
        return
      }
      await Promise.all([refreshBackups(), refreshHealth()])
      toast('备份已删除', { tone: 'success' })
    } catch (error) {
      reportDataSettingsFailure('删除备份失败', error)
      toast('删除失败', { tone: 'error', persistent: false })
    }
  }

  return (
    <div className="settings-page settings-page--reading data-settings">
      <div className="settings-page-head">
        <h1 className="settings-page-title">数据</h1>
      </div>
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
            {backupHealth.action === 'verify-latest' && backupHealth.latest ? <button type="button" className="dio-btn" disabled={verifying !== null} onClick={() => void handleVerify(backupHealth.latest!.name)}>验证最新备份</button> : null}
          </div>

          <div className="data-actions-row">
            <button
              className="dio-btn"
              onClick={handleCreateBackup}
              disabled={backing}
            >
              <Save size={ICON_SM} />
              <span>{backing ? '备份并验证中…' : backupHealth.action === 'create' ? backups.length ? '重新备份并验证' : '创建并验证备份' : '立即备份'}</span>
            </button>
          </div>

          {backups.length > 0 && (
            <details className="data-maintenance-disclosure">
              <DisclosureSummary>查看备份 <span>{backups.length}</span></DisclosureSummary>
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
                  <span className="backup-size">{fmtBytes(b.size)}</span>
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
      <DataIOContent
        onLibraryChanged={() => {
          void refreshBackups()
          void refreshHealth()
        }}
      />
      <DataOrganizationPanel day={currentTradingDayKey} onCompleted={() => { void refreshBackups(); void refreshHealth() }} />
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
        <StageOwnershipAutoRepair />

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
            {electron ? <span><HardDrive size={ICON_SM} /><strong>{health.backupCount}</strong> 份备份 · {fmtBytes(health.backupTotalSize)}</span> : null}
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
        <AssetPurgeControl
          hasOrphans={Boolean(health?.storage.inventory.orphan.length)}
          commitEnabled={assetPurgeCommitEnabled}
          refreshHealth={refreshHealth}
        />
      </section>

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
              <Button
                variant="danger-solid"
                disabled={backing || (confirmRequest.kind === 'restore' && restoring !== null)}
                onClick={() => {
                  const { kind, backup } = confirmRequest
                  const name = backup.name
                  void (kind === 'restore' ? handleRestore(name) : handleDelete(name))
                }}
              >
                {confirmRequest.kind === 'restore' ? '用备份替换当前资料库' : '删除备份'}
              </Button>
            </>
          )}
        >
          <dl className="dio-backup-facts">
            <div><dt>备份时间</dt><dd>{fmtBackupTime(confirmRequest.backup.timestamp)}</dd></div>
            <div><dt>交易与案例</dt><dd>{confirmRequest.backup.tradeCount ?? '—'}</dd></div>
            <div><dt>策略</dt><dd>{confirmRequest.backup.strategyCount ?? '—'}</dd></div>
            <div><dt>附件</dt><dd>{confirmRequest.backup.attachmentCount ?? '—'}</dd></div>
            <div><dt>验证状态</dt><dd>{confirmRequest.backup.verification?.status === 'verified' ? `已验证 · ${fmtBackupTime(confirmRequest.backup.verification.checkedAt)}` : '未通过验证'}</dd></div>
          </dl>
        </ModalShell>
      ) : null}
    </div>
  )
}
