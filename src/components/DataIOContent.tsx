import { fmtBytes } from '@/lib/format'
import { switchActiveLibrary } from '@/lib/librarySwitch'
import { commitPreparedJournalArchive, restoreWebJournalArchive } from '@/lib/libraryRestore'
import { DisclosureSummary } from '@/components/ui/DisclosureSummary'
import { Button } from '@/components/ui/Button'
import { ICON_LG, ICON_MD, ICON_SM } from '@/icons/iconSize'
import { useEffect, useRef, useState } from 'react'
import {
  Download,
  Upload,
  AlertTriangle,
  BookOpen,
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
  prepareJournalArchive,
  parseImportJson,
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
import { getStorage } from '@/storage/provider'
import { isElectron, getJournalBridge } from '@/storage/runtime'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { CsvImportModal } from './CsvImportModal'
import { NotionImportModal } from './NotionImportModal'
import { ModalShell } from '@/components/ui/ModalShell'
import { readJsonImportFile } from '@/lib/importLimits'
import { userFacingErrorMessage } from '@/lib/userFacingError'
import './DataIOContent.css'
import type { LibrarySwitchMode, PreparedJournalImportPreview } from '@/types/journalBridge'

export function DataIOContent({
  onDone,
  onLibraryChanged,
}: {
  onDone?: () => void
  onLibraryChanged?: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const archiveFileRef = useRef<HTMLInputElement>(null)
  const archiveTriggerRef = useRef<HTMLButtonElement>(null)
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
  const [preparedDesktopArchive, setPreparedDesktopArchive] = useState<PreparedJournalImportPreview | null>(null)
  const [archivePreparing, setArchivePreparing] = useState(false)
  const archiveSelectionRef = useRef<string | null>(null)
  const [pendingLibrarySwitch, setPendingLibrarySwitch] = useState<{
    mode: LibrarySwitchMode
    picked: string
  } | null>(null)
  const duplicateScanTradesRef = useRef<typeof trades | null>(null)
  const dataBusy = libraryBusy || dupScanning || dupCleaning || archivePreparing || archiveRestoring

  useEffect(() => {
    if (duplicateScanTradesRef.current === trades) return
    duplicateScanTradesRef.current = null
    setDupGroups(null)
  }, [trades])

  useEffect(() => {
    if (!electron) return
    const bridge = getJournalBridge()
    void bridge?.getLibraryPath().then(setLibraryPath)
    return () => {
      const id = archiveSelectionRef.current
      archiveSelectionRef.current = null
      if (id) void bridge?.cancelPreparedJournalImport(id).catch(() => {})
    }
  }, [electron])

  const onSwitchLibrary = async (mode: LibrarySwitchMode) => {
    if (!electron || dataBusy) return
    const bridge = getJournalBridge()
    if (!bridge) {
      toast('无法访问桌面能力', { tone: 'warning' })
      return
    }

    setLibraryBusy(true)
    try {
      const picked = await bridge.pickLibraryFolder()
      if (!picked) return

      setPendingLibrarySwitch({ mode, picked })
    } catch (err) {
      toast(userFacingErrorMessage(err, '选择资料库目录失败，请重试'), { tone: 'error', persistent: false })
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
      if (!result.ok) {
        toast(userFacingErrorMessage(result.error, '切换资料库失败，请重试'), { tone: 'error' })
        return
      }
      setLibraryPath(result.path)
      setDupGroups(null)
      toast(request.mode === 'create' ? '已切换到新资料库' : '已切换资料库', { tone: 'success' })
      onLibraryChanged?.()
      onDone?.()
    } catch (err) {
      toast(userFacingErrorMessage(err, '切换资料库失败，请重试'), { tone: 'error' })
    } finally {
      setLibraryBusy(false)
    }
  }

  const onExportJson = async () => {
    try {
      await downloadExport()
      toast('JSON 数据副本已下载', { tone: 'success' })
    } catch (error) {
      toast(userFacingErrorMessage(error, '导出失败，请重试'), { tone: 'error', persistent: false })
    }
  }

  const onExportZip = async () => {
    try {
      if (electron) {
        const result = await exportJournalArchive()
        if (result.ok) toast('资料库已导出', { tone: 'success' })
        else toast('已取消导出')
      } else {
        await downloadWebJournalZip()
        toast('资料库已导出 (.journal.zip)', { tone: 'success' })
      }
    } catch (error) {
      toast(userFacingErrorMessage(error, '导出失败，请重试'), { tone: 'error', persistent: false })
    }
  }

  const onImportZip = async () => {
    if (dataBusy) return
    const prepareRequestId = crypto.randomUUID()
    archiveSelectionRef.current = prepareRequestId
    setArchivePreparing(true)
    try {
      const result = await prepareJournalArchive(prepareRequestId)
      if (archiveSelectionRef.current !== prepareRequestId) {
        if (result.ok) await getJournalBridge()?.cancelPreparedJournalImport(result.preview.token)
        return
      }
      if (result.ok) {
        archiveSelectionRef.current = result.preview.token
        setPreparedDesktopArchive(result.preview)
        setArchivePreparing(false)
      } else if (!result.canceled) {
        toast(userFacingErrorMessage(result.error, '归档检查失败，请重试'), { tone: 'error', persistent: false })
      }
    } catch (err) {
      if (archiveSelectionRef.current === prepareRequestId) {
        toast(userFacingErrorMessage(err, '归档检查失败，请重试'), { tone: 'error', persistent: false })
      }
    } finally {
      if (archiveSelectionRef.current === prepareRequestId) {
        archiveSelectionRef.current = null
        setArchivePreparing(false)
      }
    }
  }

  const cancelDesktopArchivePreparation = async () => {
    const requestId = archiveSelectionRef.current
    if (!requestId) return
    archiveSelectionRef.current = null
    setArchivePreparing(false)
    await getJournalBridge()?.cancelPreparedJournalImport(requestId)
  }

  const cancelPreparedDesktopArchive = async () => {
    const prepared = preparedDesktopArchive
    archiveSelectionRef.current = null
    setPreparedDesktopArchive(null)
    if (prepared) await getJournalBridge()?.cancelPreparedJournalImport(prepared.token)
  }

  const commitDesktopArchive = async () => {
    const prepared = preparedDesktopArchive
    if (!prepared || archiveRestoring) return
    setArchiveRestoring(true)
    try {
      const result = await commitPreparedJournalArchive(prepared.token)
      if (result.ok) {
        archiveSelectionRef.current = null
        setPreparedDesktopArchive(null)
        setDupGroups(null)
        toast('资料库已恢复', { tone: 'success' })
        onLibraryChanged?.()
        onDone?.()
      } else {
        if (result.code === 'SOURCE_CHANGED' || result.code === 'TOKEN_EXPIRED') {
          archiveSelectionRef.current = null
          setPreparedDesktopArchive(null)
        }
        toast(
          userFacingErrorMessage(result.error, result.code === 'LIBRARY_BUSY' ? '资料库正在执行其他操作，请稍后重试' : '恢复资料库失败，请重试'),
          { tone: result.code === 'LIBRARY_BUSY' ? 'warning' : 'error' },
        )
      }
    } catch (error) {
      toast(userFacingErrorMessage(error, '恢复资料库失败，请重试'), { tone: 'error' })
    } finally {
      setArchiveRestoring(false)
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
      toast(userFacingErrorMessage(error, '无法读取完整备份'), { tone: 'error', persistent: false })
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
      toast(result.summary, { tone: 'success' })
      setWebArchive(null)
      setDupGroups(null)
      onLibraryChanged?.()
      onDone?.()
    } catch (error) {
      toast(userFacingErrorMessage(error, '恢复资料库失败，请重试'), { tone: 'error' })
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
      toast('当前资料库备份已下载', { tone: 'success' })
    } catch (error) {
      toast(userFacingErrorMessage(error, '当前资料库导出失败，请重试'), { tone: 'error', persistent: false })
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
      const text = await readJsonImportFile(file)
      const result = parseImportJson(text)
      if (!result.ok) {
        toast(userFacingErrorMessage(result.error, '导入文件内容无法识别'), { tone: 'warning' })
        return
      }
      const imported = await applyImport(result.data)
      setDupGroups(null)
      toast(imported.summary, { tone: 'success' })
      onDone?.()
    } catch (error) {
      toast(userFacingErrorMessage(error, '读取文件失败'), { tone: 'error', persistent: false })
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
        toast('交易库已变化，请重新扫描重复项', { tone: 'warning' })
        return
      }
      setDupGroups(groups)
      toast(groups.length === 0 ? '未发现明显重复' : `发现 ${groups.length} 组重复`)
    } catch (err) {
      console.error('[DataIO] duplicate scan failed', err)
      toast('扫描失败', { tone: 'error', persistent: false })
    } finally {
      setDupScanning(false)
    }
  }

  const onCleanDuplicates = () => {
    if (!dupGroups || dupGroups.length === 0) return
    if (duplicateScanTradesRef.current !== useStore.getState().trades) {
      duplicateScanTradesRef.current = null
      setDupGroups(null)
      toast('交易库已变化，请重新扫描重复项', { tone: 'warning' })
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
      toast(`已清理 ${idsToRemove.size} 条重复记录（移入回收站）`, { tone: 'success' })
      onDone?.()
    } finally {
      setDupCleaning(false)
    }
  }

  const libraryName = libraryPath?.split(/[\\/]/).filter(Boolean).at(-1) || '当前资料库'

  return (
    <div className="dio-content">
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

      {electron && (
        <section className="settings-group" aria-labelledby="dio-local-library-title">
          <div className="settings-group-head">
            <h2 id="dio-local-library-title" className="dio-section-title">本地资料库</h2>
          </div>
          <div className="settings-card">
            <div className="settings-row dio-library-row">
              <div className="settings-row-copy">
                <span className="settings-row-title">{libraryName}</span>
                <span className="settings-row-desc dio-mono" title={libraryPath ?? undefined}>
                  {libraryPath ?? '正在读取路径…'}
                </span>
              </div>
              <div className="settings-row-control">
                <button
                  type="button"
                  className="dio-btn"
                  disabled={dataBusy}
                  onClick={() => void onSwitchLibrary('open')}
                >
                  <FolderOpen size={ICON_SM} />
                  <span>{libraryBusy ? '切换中…' : '打开其他资料库…'}</span>
                </button>
                <button
                  type="button"
                  className="dio-btn"
                  disabled={dataBusy}
                  onClick={() => void onSwitchLibrary('create')}
                >
                  <Plus size={ICON_SM} />
                  <span>新建…</span>
                </button>
              </div>
            </div>
            <details className="settings-card-disclosure">
              <DisclosureSummary>保存说明</DisclosureSummary>
              <div className="dio-note">
                <p>资料库保存交易、截图、策略、标签、随记与周复盘；本机配置仅保存{electron ? '更新令牌、窗口位置、资料库路径与复盘轮次' : '当前复盘轮次'}。</p>
              </div>
            </details>
          </div>
        </section>
      )}

      <section className="settings-group dio-group" aria-labelledby="dio-export-title">
        <div className="settings-group-head">
          <h2 id="dio-export-title" className="dio-group-title">导出与恢复</h2>
        </div>
        <div className="settings-card">
          <div className="dio-task-list">
            <div className="dio-task">
              <Package size={ICON_MD} className="dio-task-icon" />
              <div className="dio-task-copy">
                <div className="dio-task-title">完整备份</div>
                <div className="dio-task-meta">全部数据与原始图片</div>
              </div>
              <button type="button" className="dio-btn" onClick={onExportZip}>
                <span>导出 .journal.zip</span>
              </button>
            </div>

            <div className="dio-task">
              <Download size={ICON_MD} className="dio-task-icon" />
              <div className="dio-task-copy">
                <div className="dio-task-title">JSON 副本</div>
                <div className="dio-task-meta">结构化交易数据</div>
              </div>
              <button type="button" className="dio-btn" onClick={onExportJson}>
                <span>导出 JSON</span>
              </button>
            </div>

            <div className="dio-task">
              <Archive size={ICON_MD} className="dio-task-icon" />
              <div className="dio-task-copy">
                <div className="dio-task-title">从归档恢复</div>
                <div className="dio-task-meta">.journal.zip 完整备份</div>
              </div>
              <button
                type="button"
                ref={archiveTriggerRef}
                className="dio-btn"
                disabled={dataBusy}
                onClick={electron ? onImportZip : () => archiveFileRef.current?.click()}
              >
                <span>{archivePreparing ? '检查中…' : '选择归档…'}</span>
              </button>
            </div>
          </div>

          <details className="settings-card-disclosure">
            <DisclosureSummary>导入其他来源</DisclosureSummary>
            <div className="dio-task-list">
              <div className="dio-task">
                <Upload size={ICON_MD} className="dio-task-icon" />
                <div className="dio-task-copy">
                  <div className="dio-task-title">Trader Atlas JSON</div>
                  <div className="dio-task-meta">合并交易、策略与嵌入图片</div>
                </div>
                <button type="button" className="dio-btn" disabled={dataBusy} onClick={() => fileRef.current?.click()}>
                  <span>选择文件</span>
                </button>
              </div>
              <div className="dio-task">
                <FileSpreadsheet size={ICON_MD} className="dio-task-icon" />
                <div className="dio-task-copy">
                  <div className="dio-task-title">CSV 交易日志</div>
                  <div className="dio-task-meta">自动识别中英文列名</div>
                </div>
                <button type="button" className="dio-btn" disabled={dataBusy} onClick={() => setCsvOpen(true)}>
                  <span>导入 CSV</span>
                </button>
              </div>
              <div className="dio-task">
                <BookOpen size={ICON_MD} className="dio-task-icon" />
                <div className="dio-task-copy">
                  <div className="dio-task-title">Notion</div>
                  <div className="dio-task-meta">导入数据库、正文与截图</div>
                </div>
                <button type="button" className="dio-btn" disabled={dataBusy} onClick={() => setNotionOpen(true)}>
                  <span>从 Notion 导入</span>
                </button>
              </div>
            </div>
          </details>
        </div>
      </section>

      <section className="settings-group" aria-labelledby="dio-dup-title">
        <div className="settings-group-head">
          <h2 id="dio-dup-title" className="dio-group-title">维护工具</h2>
        </div>
        <div className="settings-card">
          <div className="dio-task">
            <Search size={ICON_MD} className="dio-task-icon" />
            <div className="dio-task-copy">
              <div className="dio-task-title">重复检测</div>
              <div className="dio-task-meta">对照正文与截图指纹扫描重复记录</div>
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
                  <div className="dio-dup-actions">
                    <button
                      type="button"
                      className="dio-btn dio-btn-warn"
                      onClick={onCleanDuplicates}
                      disabled={dupCleaning}
                    >
                      <Trash2 size={ICON_SM} />
                      <span>
                        {dupCleaning
                          ? '清理中…'
                          : `清理 ${dupGroups.reduce((n, g) => n + g.memberIds.length - 1, 0)} 条重复`}
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <details className="settings-card-disclosure">
            <DisclosureSummary>保存机制说明</DisclosureSummary>
            <div className="dio-task-list">
              <div className="dio-task">
                <Database size={ICON_MD} className="dio-task-icon" />
                <div className="dio-task-copy">
                  <div className="dio-task-title">实时写入当前资料库</div>
                  <div className="dio-task-meta">交易、案例、策略、设置与原图</div>
                </div>
              </div>
              {electron && (
                <div className="dio-task">
                  <Shield size={ICON_MD} className="dio-task-icon" />
                  <div className="dio-task-copy">
                    <div className="dio-task-title">自动备份</div>
                    <div className="dio-task-meta">每 15 分钟及退出前自动验证保存</div>
                  </div>
                </div>
              )}
              <div className="dio-task">
                <LockKeyhole size={ICON_MD} className="dio-task-icon" />
                <div className="dio-task-copy">
                  <div className="dio-task-title">{electron ? '仅留存本机' : '仅留存当前浏览器'}</div>
                  <div className="dio-task-meta">{electron ? '窗口位置、资料库路径与复盘进度' : '当前复盘进度'}</div>
                </div>
              </div>
            </div>
          </details>
        </div>
      </section>

      <CsvImportModal open={csvOpen} onClose={() => setCsvOpen(false)} />
      <NotionImportModal open={notionOpen} onClose={() => setNotionOpen(false)} />
      {pendingLibrarySwitch ? (
        <ModalShell
          title={pendingLibrarySwitch.mode === 'create' ? '创建并切换资料库？' : '切换资料库？'}
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
          title="恢复完整资料库"
          returnFocusTo={archiveTriggerRef.current}
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
                {archiveBackingUp ? '正在导出…' : '先下载当前资料库'}
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
              <Button
                variant="danger-solid"
                busy={archiveRestoring}
                disabled={archiveBackingUp}
                onClick={onRestoreWebArchive}
              >
                {archiveRestoring ? '正在替换…' : '替换当前资料库'}
              </Button>
            </>
          )}
        >
          <div className="dio-restore-warning" role="alert">
            <AlertTriangle size={ICON_LG} />
            <span>归档将替换当前资料库的记录、设置、快捷键和附件。需要保留现状时，请先下载备份。</span>
          </div>
          <dl className="dio-restore-grid">
            <div><dt>交易与案例</dt><dd>{webArchive.preview.tradeCount}</dd></div>
            <div><dt>原始附件</dt><dd>{webArchive.preview.assetCount} 个 · {fmtBytes(webArchive.preview.assetBytes)}</dd></div>
          </dl>
          <details className="dio-restore-details"><DisclosureSummary>查看归档明细</DisclosureSummary>
          <dl className="dio-restore-grid">
            <div><dt>周复盘</dt><dd>{webArchive.preview.weeklyReviewCount}</dd></div>
            <div><dt>随记</dt><dd>{webArchive.preview.quickNoteCount}</dd></div>
            <div><dt>复盘模板</dt><dd>{webArchive.preview.reviewTemplateCount}</dd></div>
            <div><dt>策略</dt><dd>{webArchive.preview.strategyCount}</dd></div>
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
            <span>解压后 {fmtBytes(webArchive.preview.expandedBytes)}</span>
            {webArchive.preview.profileDisplayName ? (
              <span>资料：{webArchive.preview.profileDisplayName}</span>
            ) : null}
          </div>
          </details>
        </ModalShell>
      )}
      {preparedDesktopArchive ? (
        <ModalShell
          title="确认恢复完整资料库"
          returnFocusTo={archiveTriggerRef.current}
          busy={archiveRestoring}
          onClose={() => { if (!archiveRestoring) void cancelPreparedDesktopArchive() }}
          footer={(
            <>
              <Button variant="bordered" data-autofocus disabled={archiveRestoring} onClick={() => void cancelPreparedDesktopArchive()}>取消</Button>
              <Button variant="danger-solid" busy={archiveRestoring} onClick={() => void commitDesktopArchive()}>{archiveRestoring ? '正在安全恢复…' : '替换当前资料库'}</Button>
            </>
          )}
        >
          <p className="dio-restore-file">{preparedDesktopArchive.fileName}</p>
          <dl className="dio-restore-grid">
            <div><dt>交易与案例</dt><dd>{preparedDesktopArchive.tradeCount}</dd></div>
            <div><dt>策略</dt><dd>{preparedDesktopArchive.strategyCount}</dd></div>
            <div><dt>原始附件</dt><dd>{preparedDesktopArchive.attachmentCount}</dd></div>
            <div><dt>附件大小</dt><dd>{fmtBytes(preparedDesktopArchive.attachmentBytes)}</dd></div>
          </dl>
          <p className="dio-restore-warning" role="alert">
            <AlertTriangle size={ICON_LG} aria-hidden />
            <span>归档将替换当前交易、设置与附件。替换前会创建并验证整库恢复点。</span>
          </p>
          <details className="dio-restore-details"><DisclosureSummary>查看校验信息</DisclosureSummary>
            <p>格式、数据库与附件均已通过校验。文件修改于 {new Date(preparedDesktopArchive.modifiedAt).toLocaleString('zh-CN')}。</p>
          </details>
        </ModalShell>
      ) : null}
      {archivePreparing ? (
        <ModalShell
          title="正在检查归档"
          returnFocusTo={archiveTriggerRef.current}
          description="正在校验数据库与附件，完成后可预览恢复范围。"
          size="compact"
          busy
          onClose={() => void cancelDesktopArchivePreparation()}
          footer={<Button variant="bordered" onClick={() => void cancelDesktopArchivePreparation()}>取消检查</Button>}
        />
      ) : null}
    </div>
  )
}
