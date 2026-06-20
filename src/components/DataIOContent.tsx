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
import './DataIOContent.css'

export function DataIOContent({ onDone }: { onDone?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const electron = isElectron()
  const [libraryPath, setLibraryPath] = useState<string | null>(null)
  const [csvOpen, setCsvOpen] = useState(false)

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
      const ok = await importJournalArchive()
      if (ok) {
        toast('交易库已导入')
        onDone?.()
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

      {/* 主力：完整备份 */}
      <section className="dio-section">
        <h3 className="dio-section-title">导出完整备份 (.journal.zip)</h3>
        <p className="dio-desc">
          完整备份：交易数据 + 策略 + 笔记图片，图片按原始二进制存储，
          适合日常备份、整库迁移、大量图片场景。
        </p>
        <button type="button" className="dio-btn dio-btn-primary" onClick={onExportZip}>
          <Package size={16} />
          <span>导出 .journal.zip</span>
        </button>
      </section>

      {/* 辅助：轻量 JSON（纯数据，不含图片） */}
      <section className="dio-section">
        <h3 className="dio-section-title">导出 JSON（纯数据）</h3>
        <p className="dio-desc">
          轻量 JSON，仅含交易、策略与偏好元数据，不含笔记图片。适合快速备份或手写导入。
        </p>
        <button type="button" className="dio-btn" onClick={onExportJson}>
          <Download size={16} />
          <span>下载 JSON</span>
        </button>
      </section>

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
        <button type="button" className="dio-btn" onClick={() => fileRef.current?.click()}>
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
          <button type="button" className="dio-btn dio-btn-warn" onClick={onImportZip}>
            <Archive size={16} />
            <span>选择 .journal.zip</span>
          </button>
        </section>
      )}

      <section className="dio-section">
        <h3 className="dio-section-title">从 CSV 导入交易</h3>
        <p className="dio-desc">
          支持从其他交易日志工具导出的 CSV 文件导入。自动识别中英文表头，
          交互式映射字段后预览确认。
        </p>
        <button type="button" className="dio-btn" onClick={() => setCsvOpen(true)}>
          <FileSpreadsheet size={16} />
          <span>导入 CSV 文件</span>
        </button>
      </section>

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
              ? '桌面版数据保存在「文档/Linear Journal」文件夹，可用 iCloud 同步该目录。'
              : '浏览器版数据保存在 IndexedDB，建议定期导出 .journal.zip 备份。'}
          </li>
        </ul>
      </section>
      <CsvImportModal open={csvOpen} onClose={() => setCsvOpen(false)} />
    </div>
  )
}
