import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { X, Download, Upload, AlertTriangle, Archive } from 'lucide-react'
import {
  applyImport,
  downloadExport,
  exportJournalArchive,
  getLibraryPath,
  importJournalArchive,
  parseImportJson,
} from '@/lib/importExport'
import { isElectron } from '@/storage/runtime'
import { toast } from '@/lib/toast'
import './DataIOModal.css'

export function DataIOModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const electron = isElectron()
  const [libraryPath, setLibraryPath] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !electron) return
    void getLibraryPath().then(setLibraryPath)
  }, [open, electron])

  if (!open) return null

  const onExport = async () => {
    try {
      await downloadExport()
      toast('JSON 备份已下载')
    } catch {
      toast('导出失败')
    }
  }

  const onExportZip = async () => {
    try {
      const result = await exportJournalArchive()
      if (result.ok) toast('交易库已导出')
      else toast('已取消导出')
    } catch {
      toast('导出失败')
    }
  }

  const onImportZip = async () => {
    try {
      const ok = await importJournalArchive()
      if (ok) {
        toast('交易库已导入')
        onClose()
      }
    } catch {
      toast('导入失败')
    }
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    try {
      const text = await file.text()
      const result = parseImportJson(text)
      if (!result.ok) {
        toast(result.error)
        return
      }
      applyImport(result.data)
        .then(() => {
          const count = result.data.trades.length
          toast(`已导入 ${count} 笔交易`)
          onClose()
        })
        .catch(() => toast('导入失败'))
    } catch {
      toast('读取文件失败')
    }
  }

  return createPortal(
    <div className="dio-overlay" onMouseDown={onClose}>
      <div className="dio" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dio-head">
          <span>导入 / 导出数据</span>
          <button className="dio-close" title="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="dio-body">
          {electron && libraryPath && (
            <section className="dio-section dio-section-muted">
              <h3 className="dio-section-title">本地库</h3>
              <p className="dio-desc dio-mono">{libraryPath}</p>
              <p className="dio-desc">
                数据保存在 journal.db、manifest.json 与 attachments/ 文件夹中，可用 iCloud
                网盘同步整个库目录。
              </p>
            </section>
          )}

          <section className="dio-section">
            <h3 className="dio-section-title">导出 JSON 备份</h3>
            <p className="dio-desc">
              轻量 JSON，含交易、策略、偏好与内嵌附件元数据，适合快速备份。
            </p>
            <button className="dio-btn dio-btn-primary" onClick={onExport}>
              <Download size={16} />
              <span>下载 JSON 备份</span>
            </button>
          </section>

          {electron && (
            <section className="dio-section">
              <h3 className="dio-section-title">导出完整交易库 (.journal.zip)</h3>
              <p className="dio-desc">
                包含 journal.db、manifest.json 与 attachments/，适合整库迁移或冷备份。
              </p>
              <button className="dio-btn" onClick={onExportZip}>
                <Archive size={16} />
                <span>导出 .journal.zip</span>
              </button>
            </section>
          )}

          <section className="dio-section">
            <h3 className="dio-section-title">导入 JSON 备份</h3>
            <p className="dio-desc">
              合并导入 JSON。相同 ID 的交易与策略将被覆盖，收藏与订阅会合并。
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="dio-file-input"
              onChange={onFileChange}
            />
            <button className="dio-btn" onClick={() => fileRef.current?.click()}>
              <Upload size={16} />
              <span>选择 JSON 文件</span>
            </button>
          </section>

          {electron && (
            <section className="dio-section">
              <h3 className="dio-section-title">导入完整交易库 (.journal.zip)</h3>
              <p className="dio-desc">
                将用压缩包内容替换当前库（journal.db 与附件）。操作前请先导出备份。
              </p>
              <button className="dio-btn dio-btn-warn" onClick={onImportZip}>
                <Archive size={16} />
                <span>选择 .journal.zip</span>
              </button>
            </section>
          )}

          <section className="dio-danger">
            <div className="dio-danger-head">
              <AlertTriangle size={16} />
              <span>注意</span>
            </div>
            <ul className="dio-danger-list">
              <li>JSON 导入会合并到当前数据；.journal.zip 导入会替换整库。</li>
              <li>请确认备份文件来源可信，避免导入恶意数据。</li>
              <li>
                {electron
                  ? '桌面版数据保存在「文档/Linear Journal」文件夹，可用 iCloud 同步该目录。'
                  : '浏览器版数据保存在 IndexedDB，建议定期导出 JSON 备份。'}
              </li>
            </ul>
          </section>
        </div>

        <div className="dio-foot">
          <button className="dio-btn dio-btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
