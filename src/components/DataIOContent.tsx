import { useEffect, useRef, useState } from 'react'
import { Download, Upload, AlertTriangle, FileSpreadsheet, Package, Archive } from 'lucide-react'
import {
  applyImport,
  downloadExport,
  downloadWebJournalZip,
  exportJournalArchive,
  getLibraryPath,
  importJournalArchive,
  parseImportJson,
} from '@/lib/importExport'
import { isElectron } from '@/storage/runtime'
import { toast } from '@/lib/toast'
import { CsvImportModal } from './CsvImportModal'
import { NotionImportModal } from './NotionImportModal'
import './DataIOContent.css'

export function DataIOContent({ onDone }: { onDone?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const electron = isElectron()
  const [libraryPath, setLibraryPath] = useState<string | null>(null)
  const [csvOpen, setCsvOpen] = useState(false)
  const [notionOpen, setNotionOpen] = useState(false)

  useEffect(() => {
    if (!electron) return
    void getLibraryPath().then(setLibraryPath)
  }, [electron])

  const onExportJson = async () => {
    try {
      await downloadExport()
      toast('JSON 备份已下载（不含图片）')
    } catch {
      toast('导出失败')
    }
  }

  const onExportZip = async () => {
    try {
      if (electron) {
        const result = await exportJournalArchive()
        if (result.ok) toast('交易库已导出')
        else toast('已取消导出')
      } else {
        await downloadWebJournalZip()
        toast('交易库已导出 (.journal.zip)')
      }
    } catch {
      toast('导出失败')
    }
  }

  const onImportZip = async () => {
    try {
      const result = await importJournalArchive()
      if (result.ok) {
        toast('交易库已导入')
        onDone?.()
      } else if (!result.canceled) {
        toast(result.error ? `导入失败：${result.error}` : '导入失败')
      }
      // 注：用户取消文件对话框时不显示 toast，这是预期行为
    } catch (err) {
      toast(err instanceof Error ? `导入失败：${err.message}` : '导入失败')
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
        .then((r) => {
          toast(r.summary)
          onDone?.()
        })
        .catch(() => toast('导入失败'))
    } catch {
      toast('读取文件失败')
    }
  }

  return (
    <div className="dio-content">
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

      <section className="dio-zone dio-zone-primary">
        <div className="dio-zone-head">
          <span className="dio-zone-kicker">推荐备份</span>
          <h3 className="dio-section-title">导出完整备份 (.journal.zip)</h3>
        </div>
        <p className="dio-desc">
          交易数据、策略与笔记图片都会写入压缩包。适合日常备份、整库迁移和大量图片场景。
        </p>
        <button type="button" className="dio-btn dio-btn-primary" onClick={onExportZip}>
          <Package size={16} />
          <span>导出 .journal.zip</span>
        </button>
      </section>

      <div className="dio-zone-grid">
        <section className="dio-zone">
          <div className="dio-zone-head">
            <span className="dio-zone-kicker">轻量导出</span>
            <h3 className="dio-section-title">JSON（纯数据）</h3>
          </div>
          <p className="dio-desc">
            仅含交易、策略与偏好元数据，不含笔记图片。适合快速备份或手写导入。
          </p>
          <button type="button" className="dio-btn" onClick={onExportJson}>
            <Download size={16} />
            <span>下载 JSON</span>
          </button>
        </section>

        <section className="dio-zone">
          <div className="dio-zone-head">
            <span className="dio-zone-kicker">导入 / 恢复</span>
            <h3 className="dio-section-title">JSON 与 CSV</h3>
          </div>
          <p className="dio-desc">
            JSON 会合并到当前数据；CSV 适合从其他交易日志工具迁移交易记录。
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="dio-file-input"
            onChange={onFileChange}
          />
          <div className="dio-actions">
            <button type="button" className="dio-btn" onClick={() => fileRef.current?.click()}>
              <Upload size={16} />
              <span>选择 JSON 文件</span>
            </button>
            <button type="button" className="dio-btn" onClick={() => setCsvOpen(true)}>
              <FileSpreadsheet size={16} />
              <span>导入 CSV 文件</span>
            </button>
            <button type="button" className="dio-btn" onClick={() => setNotionOpen(true)}>
              <FileSpreadsheet size={16} />
              <span>从 Notion 导入</span>
            </button>
          </div>
        </section>
      </div>

      {electron && (
        <section className="dio-zone dio-zone-danger">
          <div className="dio-zone-head">
            <span className="dio-zone-kicker">整库替换</span>
            <h3 className="dio-section-title">导入完整交易库 (.journal.zip)</h3>
          </div>
          <p className="dio-desc">
            将用压缩包内容替换当前库（journal.db 与附件）。操作前请先导出完整备份。
          </p>
          <button type="button" className="dio-btn dio-btn-warn" onClick={onImportZip}>
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
          <li>JSON 导入会合并到当前数据（不含图片）；.journal.zip 导入会替换整库。</li>
          <li>请确认备份文件来源可信，避免导入恶意数据。</li>
          <li>
            {electron
              ? '桌面版数据保存在「文档/Yunkoo Atlas」文件夹，可用 iCloud 同步该目录。'
              : '浏览器版数据保存在 IndexedDB，建议定期导出 .journal.zip 备份。'}
          </li>
        </ul>
      </section>
      <CsvImportModal open={csvOpen} onClose={() => setCsvOpen(false)} />
      <NotionImportModal open={notionOpen} onClose={() => setNotionOpen(false)} />
    </div>
  )
}
