import { useEffect, useState, useCallback } from 'react'
import { DataIOContent } from '@/components/DataIOContent'
import { isElectron, getJournalBridge } from '@/storage/runtime'
import type { BackupInfo } from '@/types/journal-bridge'
import { toast } from '@/lib/toast'
import { applySnapshotToStore } from '@/lib/importExport'
import { flushPersistNow } from '@/storage/persist'
import { useStore } from '@/store/useStore'
import { collectAssetIdsFromNotes, getStorage } from '@/storage'
import { type AssetStats } from '@/lib/storageHealth'
import { Save, RotateCcw, Trash2, Clock, HardDrive, Image, Database, AlertTriangle } from '@/icons/appIcons'
import { Tooltip } from '@/components/ui/Tooltip'

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

export function DataSettingsPanel() {
  const electron = isElectron()
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [backing, setBacking] = useState(false)
  const [health, setHealth] = useState<{
    tradeCount: number
    attachmentCount: number
    attachmentStats: AssetStats
    backupCount: number
    backupTotalSize: number
    orphanedCount: number
  } | null>(null)
  const trades = useStore((s) => s.trades)

  const refreshHealth = useCallback(async () => {
    const assetIds = collectAssetIdsFromNotes(trades)
    const storage = getStorage()
    let totalBytes = 0
    let count = 0
    for (const id of assetIds) {
      try {
        const rec = await storage.getAssetForExport(id)
        if (rec) {
          count++
          totalBytes += Math.round(rec.data.length * 0.75)
        }
      } catch { /* 忽略 */ }
    }
    const stats: AssetStats = {
      count: assetIds.length,
      totalBytes: 0,
      formattedSize: '0 B',
    }

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
      } catch { /* 忽略 */ }
    }

    setHealth({
      tradeCount: trades.length,
      attachmentCount: assetIds.length,
      attachmentStats: { count, totalBytes, formattedSize: fmtBackupSize(totalBytes) },
      backupCount,
      backupTotalSize,
      orphanedCount: 0,
    })
  }, [trades, electron])

  useEffect(() => {
    refreshHealth()
  }, [refreshHealth])

  const WARN_TRADE_COUNT = 500
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
      const result = await getJournalBridge()!.createBackup()
      if (result) {
        toast('备份已创建')
        void refreshBackups()
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
    if (!window.confirm(`确定恢复备份 ${name.slice(0, 34)}…？\n当前数据将被替换。`)) return
    try {
      const result = await getJournalBridge()!.restoreBackup(name)
      if (result && typeof result === 'object') {
        applySnapshotToStore(result)
        await flushPersistNow()
        toast('备份已恢复')
      } else {
        toast('恢复失败')
      }
    } catch {
      toast('恢复失败')
    }
  }

  const handleDelete = async (name: string) => {
    if (!electron) return
    if (!window.confirm(`删除备份 ${name.slice(0, 34)}…？`)) return
    try {
      await getJournalBridge()!.deleteBackup(name)
      void refreshBackups()
      toast('备份已删除')
    } catch {
      toast('删除失败')
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

        {health && (
          <div className="health-grid">
            <div className={'health-card' + (health.tradeCount > WARN_TRADE_COUNT ? ' health-warn' : '')}>
              <Database size={18} />
              <span className="health-label">交易数</span>
              <span className="health-value">{health.tradeCount}</span>
              {health.tradeCount > WARN_TRADE_COUNT && (
                <span className="health-note">建议启用列表虚拟化</span>
              )}
            </div>
            <div className={'health-card' + (health.attachmentStats.totalBytes > WARN_ATTACH_SIZE ? ' health-warn' : '')}>
              <Image size={18} />
              <span className="health-label">笔记图片</span>
              <span className="health-value">
                {health.attachmentStats.count} 张 · {health.attachmentStats.formattedSize}
              </span>
              {health.attachmentStats.totalBytes > WARN_ATTACH_SIZE && (
                <span className="health-note">建议用 .journal.zip 导出</span>
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
            {health.orphanedCount > 0 && (
              <div className="health-card health-warn">
                <AlertTriangle size={18} />
                <span className="health-label">孤立附件</span>
                <span className="health-value">{health.orphanedCount} 个</span>
                <span className="health-note">不再被任何笔记引用</span>
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
      </section>

      {electron && (
        <section className="settings-page-section" style={{ marginTop: 32 }}>
          <div className="settings-page-head">
            <h2 className="settings-section-title">自动备份</h2>
            <p className="settings-section-desc">
              每 15 分钟自动备份 + 退出前备份。最多保留 7 份，总容量不超过 500 MB。
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <button
              className="dio-btn dio-btn-primary"
              onClick={handleCreateBackup}
              disabled={backing}
            >
              <Save size={14} />
              <span>{backing ? '备份中…' : '立即备份'}</span>
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
                  <div className="backup-actions">
                    <button
                      className="dio-btn"
                      onClick={() => handleRestore(b.name)}
                    >
                      <RotateCcw size={13} />
                      <span>恢复</span>
                    </button>
                    <Tooltip content="删除备份" label="删除此备份">
                      <button
                        className="dio-btn dio-btn-warn"
                        aria-label="删除此备份"
                        onClick={() => handleDelete(b.name)}
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
              备份文件位于库目录的 <code>backups/</code> 下。
            </p>
          )}
        </section>
      )}
    </div>
  )
}
