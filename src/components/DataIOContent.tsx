import { useEffect, useRef, useState } from 'react'
import { Download, Upload, AlertTriangle, FileSpreadsheet, Package, Archive } from '@/icons/appIcons'
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
          <h2 className="dio-section-title">本地库</h2>
          <p className="dio-desc dio-mono">{libraryPath}</p>
          <p className="dio-desc">
            数据保存在 journal.db、manifest.json 与 attachments/ 文件夹中，可用 iCloud
            网盘同步整个库目录。
          </p>
        </section>
      )}

      <section className="dio-group" aria-labelledby="dio-export-title">
        <div className="dio-group-head">
          <h2 id="dio-export-title" className="dio-group-title">备份与导出</h2>
          <p className="dio-group-desc">完整备份用于日常保护；JSON 适合只取出结构化数据。</p>
        </div>
        <div className="dio-task-list">
          <div className="dio-task dio-task-primary">
            <Package size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">完整备份</div>
              <div className="dio-task-meta">交易、设置与笔记图片 · 推荐</div>
            </div>
            <button type="button" className="dio-btn dio-btn-primary" onClick={onExportZip}>
              <span>导出 .journal.zip</span>
            </button>
          </div>
          <div className="dio-task">
            <Download size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">JSON 数据副本</div>
              <div className="dio-task-meta">仅交易、策略与偏好，不含图片</div>
            </div>
            <button type="button" className="dio-btn" onClick={onExportJson}>
              <span>下载 JSON</span>
            </button>
          </div>
        </div>
      </section>

      <section className="dio-group" aria-labelledby="dio-import-title">
        <div className="dio-group-head">
          <h2 id="dio-import-title" className="dio-group-title">导入与迁移</h2>
          <p className="dio-group-desc">按原始数据来源选择入口，不需要先判断文件格式。</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="dio-file-input"
          onChange={onFileChange}
        />
        <div className="dio-task-list">
          <div className="dio-task">
            <Upload size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">Yunkoo JSON</div>
              <div className="dio-task-meta">合并到当前交易库，不含图片</div>
            </div>
            <button type="button" className="dio-btn" onClick={() => fileRef.current?.click()}>
              <span>选择文件</span>
            </button>
          </div>
          <div className="dio-task">
            <FileSpreadsheet size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">其他交易日志</div>
              <div className="dio-task-meta">导入 CSV，自动识别中英文列名</div>
            </div>
            <button type="button" className="dio-btn" onClick={() => setCsvOpen(true)}>
              <span>导入 CSV</span>
            </button>
          </div>
          <div className="dio-task">
            <FileSpreadsheet size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">Notion</div>
              <div className="dio-task-meta">导入数据库、页面正文与截图</div>
            </div>
            <button type="button" className="dio-btn" onClick={() => setNotionOpen(true)}>
              <span>从 Notion 导入</span>
            </button>
          </div>
        </div>
      </section>

      {electron && (
        <section className="dio-group dio-group-danger">
          <div className="dio-task">
            <Archive size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">恢复完整交易库</div>
              <div className="dio-task-meta">替换当前数据与附件，操作前请先备份</div>
            </div>
            <button type="button" className="dio-btn dio-btn-warn" onClick={onImportZip}>
              <span>选择 .journal.zip</span>
            </button>
          </div>
        </section>
      )}

      <p className="dio-safety-note">
        <AlertTriangle size={15} />
        <span>
          仅导入可信文件。{electron
            ? '完整备份会替换当前库，JSON 只合并数据。'
            : '数据保存在当前浏览器中，建议定期导出完整备份。'}
        </span>
      </p>
      <CsvImportModal open={csvOpen} onClose={() => setCsvOpen(false)} />
      <NotionImportModal open={notionOpen} onClose={() => setNotionOpen(false)} />
    </div>
  )
}
