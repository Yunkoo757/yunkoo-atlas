import { useEffect, useRef, useState } from 'react'
import {
  Download,
  Upload,
  AlertTriangle,
  FileSpreadsheet,
  Package,
  Archive,
  Search,
  Trash2,
  FolderOpen,
  Plus,
  Database,
  Shield,
  LockKeyhole,
} from '@/icons/appIcons'
import {
  applyImport,
  downloadExport,
  downloadWebJournalZip,
  exportJournalArchive,
  getLibraryPath,
  importJournalArchive,
  parseImportJson,
  switchActiveLibrary,
} from '@/lib/importExport'
import {
  buildLibraryContentIndex,
  duplicateReasonLabel,
  groupObviousDuplicates,
  type DuplicateGroup,
} from '@/lib/tradeDuplicates'
import { getStorage } from '@/storage'
import { isElectron, getJournalBridge } from '@/storage/runtime'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { CsvImportModal } from './CsvImportModal'
import { NotionImportModal } from './NotionImportModal'
import './DataIOContent.css'

export function DataIOContent({
  onDone,
  onLibraryChanged,
}: {
  onDone?: () => void
  onLibraryChanged?: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const electron = isElectron()
  const trades = useStore((s) => s.trades)
  const removeTrades = useStore((s) => s.removeTrades)
  const [libraryPath, setLibraryPath] = useState<string | null>(null)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [csvOpen, setCsvOpen] = useState(false)
  const [notionOpen, setNotionOpen] = useState(false)
  const [dupScanning, setDupScanning] = useState(false)
  const [dupGroups, setDupGroups] = useState<DuplicateGroup[] | null>(null)
  const [dupCleaning, setDupCleaning] = useState(false)

  useEffect(() => {
    if (!electron) return
    void getLibraryPath().then(setLibraryPath)
  }, [electron])

  const onSwitchLibrary = async (mode: 'open' | 'create') => {
    if (!electron || libraryBusy) return
    const bridge = getJournalBridge()
    if (!bridge) {
      toast('无法访问桌面能力')
      return
    }

    setLibraryBusy(true)
    try {
      const picked = await bridge.pickLibraryFolder()
      if (!picked) return

      const confirmMsg =
        mode === 'create'
          ? `将先保存当前库，然后在以下目录创建新库并切换：\n\n${picked}\n\n继续？`
          : `将先保存当前库，然后打开以下目录中的交易库：\n\n${picked}\n\n继续？`
      if (!window.confirm(confirmMsg)) return

      const result = await switchActiveLibrary(mode, picked)
      if (result.canceled) return
      if (!result.ok) {
        toast(result.error ? `切换失败：${result.error}` : '切换失败')
        return
      }
      setLibraryPath(result.path ?? null)
      setDupGroups(null)
      toast(mode === 'create' ? '已切换到新库' : '已切换交易库')
      onLibraryChanged?.()
      onDone?.()
    } catch (err) {
      toast(err instanceof Error ? `切换失败：${err.message}` : '切换失败')
    } finally {
      setLibraryBusy(false)
    }
  }

  const onExportJson = async () => {
    try {
      await downloadExport()
      toast('JSON 数据副本已下载')
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
        library
          .map((item) => ({
            trade: byId.get(item.id)!,
            sig: item.sig,
          }))
          .filter((item) => Boolean(item.trade)),
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
      const idsToRemove = new Set<string>()
      for (const group of dupGroups) {
        for (const id of group.memberIds) {
          if (id === group.keepId) continue
          idsToRemove.add(id)
        }
      }
      removeTrades([...idsToRemove])
      setDupGroups([])
      toast(`已清理 ${idsToRemove.size} 条重复记录（移入回收站）`)
      onDone?.()
    } finally {
      setDupCleaning(false)
    }
  }

  return (
    <div className="dio-content">
      {electron && (
        <section className="dio-section dio-section-muted">
          <h2 className="dio-section-title">本地库</h2>
          {libraryPath ? (
            <p className="dio-desc dio-mono">{libraryPath}</p>
          ) : (
            <p className="dio-desc">正在读取库路径…</p>
          )}
          <p className="dio-desc">
            数据保存在 journal.db、manifest.json 与 attachments/ 文件夹中，可用 iCloud
            网盘同步整个库目录。换电脑或换盘符时，可在此打开其他目录中的库。
          </p>
          <div className="dio-lib-actions">
            <button
              type="button"
              className="dio-btn dio-btn-primary"
              disabled={libraryBusy}
              onClick={() => void onSwitchLibrary('open')}
            >
              <FolderOpen size={15} />
              <span>{libraryBusy ? '切换中…' : '打开其他库…'}</span>
            </button>
            <button
              type="button"
              className="dio-btn"
              disabled={libraryBusy}
              onClick={() => void onSwitchLibrary('create')}
            >
              <Plus size={15} />
              <span>在此新建库…</span>
            </button>
          </div>
        </section>
      )}

      <section className="dio-group" aria-labelledby="dio-boundary-title">
        <div className="dio-group-head">
          <h2 id="dio-boundary-title" className="dio-group-title">保存边界</h2>
          <p className="dio-group-desc">区分自动保存、恢复点和仅保留在此电脑的配置。</p>
        </div>
        <div className="dio-task-list">
          <div className="dio-task">
            <Database size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">自动保存到当前资料库</div>
              <div className="dio-task-meta">
                交易与案例、策略、标签、快捷键、显示偏好、个人资料和保存视图；笔记原图保存在 attachments/。
              </div>
            </div>
          </div>
          {electron && (
            <div className="dio-task">
              <Shield size={18} className="dio-task-icon" />
              <div className="dio-task-copy">
                <div className="dio-task-title">自动恢复点</div>
                <div className="dio-task-meta">
                  每 15 分钟及退出前保存数据库、资料库清单和原始附件；相同附件只保留一份。
                </div>
              </div>
            </div>
          )}
          <div className="dio-task">
            <LockKeyhole size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">仅保留在这台电脑</div>
              <div className="dio-task-meta">GitHub 更新令牌、窗口位置与当前资料库路径不会写入资料库或导出文件。</div>
            </div>
          </div>
        </div>
      </section>

      <section className="dio-group" aria-labelledby="dio-export-title">
        <div className="dio-group-head">
          <h2 id="dio-export-title" className="dio-group-title">
            备份与导出
          </h2>
          <p className="dio-group-desc">完整备份用于日常保护；JSON 适合只取出结构化数据。</p>
        </div>
        <div className="dio-task-list">
          <div className="dio-task dio-task-primary">
            <Package size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">完整备份</div>
              <div className="dio-task-meta">交易、设置、快捷键与原始笔记图片 · 推荐</div>
            </div>
            <button type="button" className="dio-btn dio-btn-primary" onClick={onExportZip}>
              <span>导出 .journal.zip</span>
            </button>
          </div>
          <div className="dio-task">
            <Download size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">JSON 数据副本</div>
              <div className="dio-task-meta">交易、策略、标签与嵌入图片；不含个人资料和快捷键</div>
            </div>
            <button type="button" className="dio-btn" onClick={onExportJson}>
              <span>下载 JSON</span>
            </button>
          </div>
        </div>
      </section>

      <section className="dio-group" aria-labelledby="dio-import-title">
        <div className="dio-group-head">
          <h2 id="dio-import-title" className="dio-group-title">
            导入与迁移
          </h2>
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
              <div className="dio-task-meta">合并交易、策略、标签与嵌入图片到当前资料库</div>
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
          <h2 id="dio-dup-title" className="dio-group-title">
            重复检测
          </h2>
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
                  <span>
                    {dupCleaning
                      ? '清理中…'
                      : `清理 ${dupGroups.reduce((n, g) => n + g.memberIds.length - 1, 0)} 条重复`}
                  </span>
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
          仅导入可信文件。
          {electron
            ? '完整备份会替换当前库，JSON 只合并数据。'
            : '数据保存在当前浏览器中，建议定期导出完整备份。'}
        </span>
      </p>
      <CsvImportModal open={csvOpen} onClose={() => setCsvOpen(false)} />
      <NotionImportModal open={notionOpen} onClose={() => setNotionOpen(false)} />
    </div>
  )
}
