import { useEffect, useState } from 'react'
import { DataIOContent } from '@/components/DataIOContent'
import { isElectron, getJournalBridge } from '@/storage/runtime'
import type { BackupInfo } from '@/types/journal-bridge'
import { toast } from '@/lib/toast'
import { Save, RotateCcw, Trash2, Clock } from 'lucide-react'

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
      const ok = await getJournalBridge()!.restoreBackup(name)
      if (ok) {
        toast('已恢复，请重启应用以加载数据')
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
      <DataIOContent />

      {electron && (
        <section className="settings-page-section" style={{ marginTop: 32 }}>
          <div className="settings-page-head">
            <h2 className="settings-page-title">自动备份</h2>
            <p className="settings-page-desc">
              每 15 分钟自动备份 + 退出前备份，保留最近 20 份。
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
                  <span className="backup-size">{fmtBackupSize(b.size)}</span>
                  <div className="backup-actions">
                    <button
                      className="dio-btn"
                      onClick={() => handleRestore(b.name)}
                      title="恢复此备份"
                    >
                      <RotateCcw size={13} />
                      <span>恢复</span>
                    </button>
                    <button
                      className="dio-btn dio-btn-warn"
                      onClick={() => handleDelete(b.name)}
                      title="删除此备份"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {backups.length > 0 && (
            <p className="dio-section-muted" style={{ marginTop: 8 }}>
              恢复备份后需重启应用。备份文件位于库目录的 <code>backups/</code> 下。
            </p>
          )}
        </section>
      )}
    </div>
  )
}
