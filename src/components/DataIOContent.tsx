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
  restoreWebJournalArchive,
  switchActiveLibrary,
} from '@/lib/importExport'
import {
  parseWebJournalArchive,
  type ParsedWebJournalArchive,
} from '@/lib/webJournalArchive'
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
import { ModalShell } from '@/components/ui/ModalShell'
import './DataIOContent.css'

function formatArchiveBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function DataIOContent({
  onDone,
  onLibraryChanged,
}: {
  onDone?: () => void
  onLibraryChanged?: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const archiveFileRef = useRef<HTMLInputElement>(null)
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
  const [webArchive, setWebArchive] = useState<ParsedWebJournalArchive | null>(null)
  const [archiveRestoring, setArchiveRestoring] = useState(false)
  const [archiveBackingUp, setArchiveBackingUp] = useState(false)
  const [pendingLibrarySwitch, setPendingLibrarySwitch] = useState<{
    mode: 'open' | 'create'
    picked: string
  } | null>(null)
  const duplicateScanTradesRef = useRef<typeof trades | null>(null)
  const dataBusy = libraryBusy || dupScanning || dupCleaning

  useEffect(() => {
    if (duplicateScanTradesRef.current === trades) return
    duplicateScanTradesRef.current = null
    setDupGroups(null)
  }, [trades])

  useEffect(() => {
    if (!electron) return
    void getLibraryPath().then(setLibraryPath)
  }, [electron])

  const onSwitchLibrary = async (mode: 'open' | 'create') => {
    if (!electron || dataBusy) return
    const bridge = getJournalBridge()
    if (!bridge) {
      toast('无法访问桌面能力')
      return
    }

    setLibraryBusy(true)
    try {
      const picked = await bridge.pickLibraryFolder()
      if (!picked) return

      setPendingLibrarySwitch({ mode, picked })
    } catch (err) {
      toast(err instanceof Error ? `选择失败：${err.message}` : '选择失败')
    } finally {
      setLibraryBusy(false)
    }
  }

  const confirmLibrarySwitch = async () => {
    const request = pendingLibrarySwitch
    if (!request || libraryBusy) return
    setPendingLibrarySwitch(null)
    setLibraryBusy(true)
    try {
      const result = await switchActiveLibrary(request.mode, request.picked)
      if (result.canceled) return
      if (!result.ok) {
        toast(result.error ? `切换失败：${result.error}` : '切换失败')
        return
      }
      setLibraryPath(result.path ?? null)
      setDupGroups(null)
      toast(request.mode === 'create' ? '已切换到新库' : '已切换交易库')
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
    } catch (error) {
      toast(error instanceof Error ? error.message : '导出失败')
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
    } catch (error) {
      toast(error instanceof Error ? error.message : '导出失败')
    }
  }

  const onImportZip = async () => {
    if (dataBusy) return
    setLibraryBusy(true)
    try {
      const result = await importJournalArchive()
      if (result.ok) {
        setDupGroups(null)
        toast('交易库已导入')
        onLibraryChanged?.()
        onDone?.()
      } else if (!result.canceled) {
        toast(result.error ? `导入失败：${result.error}` : '导入失败')
      }
      // 注：用户取消文件对话框时不显示 toast，这是预期行为
    } catch (err) {
      toast(err instanceof Error ? `导入失败：${err.message}` : '导入失败')
    } finally {
      setLibraryBusy(false)
    }
  }

  const onWebArchiveChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || dataBusy) return

    setLibraryBusy(true)
    setWebArchive(null)
    try {
      setWebArchive(await parseWebJournalArchive(file))
    } catch (error) {
      toast(error instanceof Error ? error.message : '无法读取完整备份')
    } finally {
      setLibraryBusy(false)
    }
  }

  const onRestoreWebArchive = async () => {
    if (!webArchive || archiveRestoring) return
    setArchiveRestoring(true)
    setLibraryBusy(true)
    try {
      const result = await restoreWebJournalArchive(webArchive)
      toast(result.summary)
      setWebArchive(null)
      setDupGroups(null)
      onLibraryChanged?.()
      onDone?.()
    } catch (error) {
      toast(error instanceof Error ? `恢复失败：${error.message}` : '恢复失败')
    } finally {
      setArchiveRestoring(false)
      setLibraryBusy(false)
    }
  }

  const onDownloadRestorePoint = async () => {
    if (archiveBackingUp) return
    setArchiveBackingUp(true)
    try {
      await downloadWebJournalZip()
      toast('当前交易库恢复点已下载')
    } catch (error) {
      toast(error instanceof Error ? error.message : '当前交易库导出失败，请重试')
    } finally {
      setArchiveBackingUp(false)
    }
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || dataBusy) return

    setLibraryBusy(true)
    try {
      const text = await file.text()
      const result = parseImportJson(text)
      if (!result.ok) {
        toast(result.error)
        return
      }
      const imported = await applyImport(result.data)
      setDupGroups(null)
      toast(imported.summary)
      onDone?.()
    } catch (error) {
      toast(error instanceof Error ? error.message : '读取文件失败')
    } finally {
      setLibraryBusy(false)
    }
  }

  const onScanDuplicates = async () => {
    if (dataBusy) return
    setDupScanning(true)
    setDupGroups(null)
    const scannedTrades = trades
    duplicateScanTradesRef.current = scannedTrades
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
      if (useStore.getState().trades !== scannedTrades) {
        duplicateScanTradesRef.current = null
        toast('资料库已变化，请重新扫描重复项')
        return
      }
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
    if (duplicateScanTradesRef.current !== useStore.getState().trades) {
      duplicateScanTradesRef.current = null
      setDupGroups(null)
      toast('资料库已变化，请重新扫描重复项')
      return
    }
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
            数据保存在本机磁盘的 journal.db、manifest.json 与 attachments/ 文件夹中。
            更换电脑时，请先导出完整备份，再在另一台设备导入。
          </p>
          <div className="dio-lib-actions">
            <button
              type="button"
              className="dio-btn dio-btn-primary"
              disabled={dataBusy}
              onClick={() => void onSwitchLibrary('open')}
            >
              <FolderOpen size={15} />
              <span>{libraryBusy ? '切换中…' : '打开其他库…'}</span>
            </button>
            <button
              type="button"
              className="dio-btn"
              disabled={dataBusy}
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
                交易与案例、策略、标签、快捷键、显示偏好、个人资料和保存视图；
                {electron
                  ? '笔记原图保存在资料库的 attachments/ 文件夹。'
                  : '笔记原图保存在浏览器 IndexedDB 的同一资料库中。'}
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
              <div className="dio-task-title">{electron ? '仅保留在这台电脑' : '仅保留在当前浏览器'}</div>
              <div className="dio-task-meta">
                {electron
                  ? 'GitHub 更新令牌、窗口位置、当前资料库路径与随机复盘轮次不会写入资料库或导出文件。'
                  : '随机复盘的当前轮次只保留在此标签页，不会写入资料库或导出文件。'}
              </div>
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
        {!electron && (
          <input
            ref={archiveFileRef}
            type="file"
            accept=".journal.zip,.zip,application/zip"
            className="dio-file-input"
            onChange={onWebArchiveChange}
          />
        )}
        <div className="dio-task-list">
          <div className="dio-task">
            <Upload size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">Yunkoo JSON</div>
              <div className="dio-task-meta">合并交易、策略、标签与嵌入图片到当前资料库</div>
            </div>
            <button type="button" className="dio-btn" disabled={dataBusy} onClick={() => fileRef.current?.click()}>
              <span>选择文件</span>
            </button>
          </div>
          <div className="dio-task">
            <FileSpreadsheet size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">其他交易日志</div>
              <div className="dio-task-meta">导入 CSV，自动识别中英文列名</div>
            </div>
            <button type="button" className="dio-btn" disabled={dataBusy} onClick={() => setCsvOpen(true)}>
              <span>导入 CSV</span>
            </button>
          </div>
          <div className="dio-task">
            <FileSpreadsheet size={18} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">Notion</div>
              <div className="dio-task-meta">导入数据库、页面正文与截图</div>
            </div>
            <button type="button" className="dio-btn" disabled={dataBusy} onClick={() => setNotionOpen(true)}>
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
            仅在同一记录类型内按正文与截图识别明显抄重；实盘、模拟与案例之间不会互相判重。
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
              disabled={dataBusy}
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

      <section className="dio-group dio-group-danger">
        <div className="dio-task">
          <Archive size={18} className="dio-task-icon" />
          <div className="dio-task-copy">
            <div className="dio-task-title">恢复完整交易库</div>
            <div className="dio-task-meta">
              {electron
                ? '替换当前桌面资料库与附件，操作前请先备份'
                : '校验浏览器完整备份后，精确替换当前数据、设置与附件'}
            </div>
          </div>
          <button
            type="button"
            className="dio-btn dio-btn-warn"
            disabled={dataBusy}
            onClick={electron ? onImportZip : () => archiveFileRef.current?.click()}
          >
            <span>{libraryBusy ? '资料库处理中…' : '选择 .journal.zip'}</span>
          </button>
        </div>
      </section>

      <p className="dio-safety-note">
        <AlertTriangle size={15} />
        <span>
          仅导入可信文件。
          {electron
            ? '完整备份会替换当前库，JSON 只合并数据。'
            : '完整备份恢复会替换当前库，JSON 导入只合并数据。'}
        </span>
      </p>
      <CsvImportModal open={csvOpen} onClose={() => setCsvOpen(false)} />
      <NotionImportModal open={notionOpen} onClose={() => setNotionOpen(false)} />
      {pendingLibrarySwitch ? (
        <ModalShell
          title={pendingLibrarySwitch.mode === 'create' ? '创建并切换交易库？' : '切换交易库？'}
          description="软件会先保存当前资料库，再切换到所选目录。"
          size="compact"
          onClose={() => setPendingLibrarySwitch(null)}
          footer={(
            <>
              <button
                type="button"
                className="ui-btn ui-btn-bordered"
                data-autofocus
                onClick={() => setPendingLibrarySwitch(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary"
                onClick={confirmLibrarySwitch}
              >
                {pendingLibrarySwitch.mode === 'create' ? '创建并切换' : '确认切换'}
              </button>
            </>
          )}
        >
          <p className="dio-desc"><code>{pendingLibrarySwitch.picked}</code></p>
        </ModalShell>
      ) : null}
      {webArchive && (
        <ModalShell
          title="恢复完整交易库"
          description="归档已通过格式与附件校验。确认后将精确替换当前浏览器资料库。"
          busy={archiveRestoring}
          onClose={() => setWebArchive(null)}
          footer={(
            <>
              <button
                type="button"
                className="dio-btn"
                disabled={archiveRestoring || archiveBackingUp}
                onClick={onDownloadRestorePoint}
              >
                {archiveBackingUp ? '正在导出…' : '先下载当前库'}
              </button>
              <button
                type="button"
                className="dio-btn"
                data-autofocus
                disabled={archiveRestoring}
                onClick={() => setWebArchive(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="dio-btn dio-btn-warn"
                disabled={archiveRestoring || archiveBackingUp}
                onClick={onRestoreWebArchive}
              >
                {archiveRestoring ? '正在替换…' : '替换当前资料库'}
              </button>
            </>
          )}
        >
          <div className="dio-restore-warning" role="alert">
            <AlertTriangle size={17} />
            <span>当前记录、设置、快捷键和附件都会被归档内容替换；此操作不是合并。</span>
          </div>
          <dl className="dio-restore-grid">
            <div><dt>交易与案例</dt><dd>{webArchive.preview.tradeCount}</dd></div>
            <div><dt>周复盘</dt><dd>{webArchive.preview.weeklyReviewCount}</dd></div>
            <div><dt>策略</dt><dd>{webArchive.preview.strategyCount}</dd></div>
            <div><dt>原始附件</dt><dd>{webArchive.preview.assetCount}</dd></div>
            <div><dt>附件大小</dt><dd>{formatArchiveBytes(webArchive.preview.assetBytes)}</dd></div>
            <div><dt>快捷键</dt><dd>{webArchive.preview.shortcutCount}</dd></div>
            <div><dt>保存视图</dt><dd>{webArchive.preview.savedViewCount}</dd></div>
            <div>
              <dt>标签设置</dt>
              <dd>{webArchive.preview.tagPresetCount} 标签 · {webArchive.preview.mistakeTagPresetCount} 错误标签</dd>
            </div>
            <div>
              <dt>工作区设置</dt>
              <dd>显示偏好 · {webArchive.preview.pinnedStrategyCount} 固定策略 · {webArchive.preview.symbolCatalogCount} 品种</dd>
            </div>
          </dl>
          <div className="dio-restore-meta">
            <span>导出格式 v{webArchive.preview.exportVersion}</span>
            <span>解压后 {formatArchiveBytes(webArchive.preview.expandedBytes)}</span>
            {webArchive.preview.profileDisplayName ? (
              <span>资料：{webArchive.preview.profileDisplayName}</span>
            ) : null}
          </div>
        </ModalShell>
      )}
    </div>
  )
}
