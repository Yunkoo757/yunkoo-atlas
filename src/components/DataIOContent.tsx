import { useEffect, useRef, useState } from 'react'
import { Download, Upload, AlertTriangle, FileSpreadsheet, Package, Archive, Search, Trash2 } from '@/icons/appIcons'
import {
  applyImport,
  downloadExport,
  downloadWebJournalZip,
  exportJournalArchive,
  getLibraryPath,
  importJournalArchive,
  parseImportJson,
} from '@/lib/importExport'
import {
  buildLibraryContentIndex,
  duplicateReasonLabel,
  groupObviousDuplicates,
  type DuplicateGroup,
} from '@/lib/tradeDuplicates'
import { getStorage } from '@/storage'
import { isElectron } from '@/storage/runtime'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { CsvImportModal } from './CsvImportModal'
import { NotionImportModal } from './NotionImportModal'
import './DataIOContent.css'

export function DataIOContent({ onDone }: { onDone?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const electron = isElectron()
  const trades = useStore((s) => s.trades)
  const removeTrade = useStore((s) => s.removeTrade)
  const [libraryPath, setLibraryPath] = useState<string | null>(null)
  const [csvOpen, setCsvOpen] = useState(false)
  const [notionOpen, setNotionOpen] = useState(false)
  const [dupScanning, setDupScanning] = useState(false)
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[] | null>(null)
  const [dupCleaning, setDupCleaning] = useState(false)

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

  const onScanDuplicates = async () => {
    setDupScanning(true)
    setDupGroups(null)
    try {
      const storage = getStorage()
      const library = await buildLibraryContentIndex(trades, async (assetId) => {
        const rec = await storage.getAssetForExport(assetId)
        return rec?.data ?? null
      })
      const byId = new Map(trades.map((trade) => [trade.id, trade]))
      const groups = groupObviousDuplicates(
        library.map((item) => ({
          trade: byId.get(item.id)!,
          sig: item.sig,
        })).filter((item) => Boolean(item.trade)),
      )
      setDupGroups(groups)
      toast(groups.length === 0 ? '未发现明显重复' : `发现 ${groups.length} 组重复`)
    } catch (err) {
      console.error('[DataIO] duplicate scan failed', err)
      toast('扫描失败')
    } finally {
      setDupScanning(false)
    }
  }

  const onCleanDuplicates = () => {
    if (!dupGroups || dupGroups.length === 0) return
    setDupCleaning(true)
    try {
      let removed = 0
      for (const group of dupGroups) {
        for (const id of group.memberIds) {
          if (id === group.keepId) continue
          removeTrade(id)
          removed++
        }
      }
      setDupGroups([])
      toast(`已清理 ${removed} 条重复记录（移入回收站）`)
      onDone?.()
    } finally {
      setDupCleaning(false)
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

      <section className="dio-group" aria-labelledby="dio-dup-title">
        <div className="dio-group-head">
          <h2 id="dio-dup-title" className="dio-group-title">重复检测</h2>
          <p className="dio-group-desc">
            按正文与截图内容识别明显抄重，不会把同日同品种多笔正常交易当成重复。
          </p>
        </div>
        <div className="dio-task-list">
          <div className="dio-task">
            <Search size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">扫描库内重复</div>
              <div className="dio-task-meta">对照笔记正文与截图指纹</div>
            </div>
            <button
              type="button"
              className="dio-btn"
              onClick={onScanDuplicates}
              disabled={dupScanning}
            >
              <span>{dupScanning ? '扫描中…' : '开始扫描'}</span>
            </button>
          </div>
        </div>
        {dupGroups && (
          <div className="dio-dup-panel">
            {dupGroups.length === 0 ? (
              <p className="dio-desc">没有发现明显重复。</p>
            ) : (
              <>
                <p className="dio-desc">
                  共 {dupGroups.length} 组。清理时保留较新的一条，其余移入回收站。
                </p>
                <ul className="dio-dup-list">
                  {dupGroups.slice(0, 12).map((group) => {
                    const members = group.memberIds
                      .map((id) => trades.find((trade) => trade.id === id))
                      .filter(Boolean)
                    return (
                      <li key={group.id}>
                        <span className="dio-dup-reason">{duplicateReasonLabel(group.reason)}</span>
                        <span>
                          保留 {members.find((m) => m?.id === group.keepId)?.ref ?? '—'}，另有{' '}
                          {group.memberIds.length - 1} 条：
                          {members
                            .filter((m) => m?.id !== group.keepId)
                            .map((m) => m?.ref)
                            .join('、')}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                {dupGroups.length > 12 && (
                  <p className="dio-desc">另有 {dupGroups.length - 12} 组未展开显示。</p>
                )}
                <button
                  type="button"
                  className="dio-btn dio-btn-warn"
                  onClick={onCleanDuplicates}
                  disabled={dupCleaning}
                >
                  <Trash2 size={15} />
                  <span>{dupCleaning ? '清理中…' : `清理 ${dupGroups.reduce((n, g) => n + g.memberIds.length - 1, 0)} 条重复`}</span>
                </button>
              </>
            )}
          </div>
        )}
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
