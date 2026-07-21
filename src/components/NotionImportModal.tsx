import { useEffect, useState, useRef, useMemo, type DragEvent } from 'react'
import { Upload, ArrowRight, CheckCircle, AlertCircle, FileText, Image } from '@/icons/appIcons'
import { LinearGridLoaderIcon } from '@/icons/linear'
import { ICON_HERO } from '@/icons/iconSize'
import { ModalShell } from '@/components/ui/ModalShell'
import { Button } from '@/components/ui/Button'
import { useStore } from '@/store/useStore'
import {
  parseNotionCsv,
  parseNotionZip,
  type NotionTradePreview,
  type NotionImportResult,
} from '@/lib/notionImport'
import { commitNotionImportBatch } from '@/lib/notionImportCommit'
import {
  buildContentSignature,
  buildLibraryContentIndex,
  createDuplicateLookupIndex,
  duplicateReasonLabel,
  findObviousDuplicateIndexed,
  hashImageFiles,
  type DuplicateMatch,
} from '@/lib/tradeDuplicates'
import { collectAssetIdsFromNotes, getStorage } from '@/storage'
import { toast } from '@/lib/toast'
import { Tooltip } from '@/components/ui/Tooltip'
import { SelectionBox } from '@/components/ui/SelectionBox'
import { MAX_NOTION_IMPORT_ROWS } from '@/lib/notionImportLimits'
import type { TradeKind } from '@/data/trades'
import { fmtMoney } from '@/lib/format'
import './NotionImportModal.css'

interface Props {
  open: boolean
  onClose: () => void
}

type Step = 'upload' | 'preview' | 'importing' | 'done'

export const MAX_NOTION_CSV_FILE_BYTES = 32 * 1024 * 1024
export const MAX_NOTION_ZIP_FILE_BYTES = 160 * 1024 * 1024
const MAX_DUPLICATE_IMAGE_SCAN_COUNT = 300
const MAX_DUPLICATE_IMAGE_SCAN_BYTES = 128 * 1024 * 1024
const PREVIEW_ROW_LIMIT = 100
const IMPORT_TARGETS: Array<{
  kind: TradeKind
  label: string
  hint: string
  recordLabel: string
}> = [
  { kind: 'live', label: '交易日志', hint: '计入实盘统计', recordLabel: '笔交易' },
  { kind: 'paper', label: '模拟回测', hint: '独立于实盘统计', recordLabel: '笔模拟记录' },
  { kind: 'case', label: '案例记录', hint: '进入案例复看体系', recordLabel: '条案例' },
]

const NOTION_CAPACITY_ERRORS = new Set([
  '单张原图超过 32 MB，请移除该附件后重试；为保留画质，软件不会自动压缩原图',
  '本次原图总量超过 96 MB，请分批导入；为保留画质，软件不会自动压缩原图',
  'Notion 导出解压后超过 160 MB，请拆分后导入',
  'Notion 导入记录超过 20000 笔，请拆分后导入',
  'Notion 导出包含过多分卷，请拆分后导入',
  'Notion 导出的嵌套层级过深，请重新导出后再试',
])

export function getNotionCapacityErrorMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : ''
  return NOTION_CAPACITY_ERRORS.has(message) ? message : null
}

export function NotionImportModal({ open, onClose }: Props) {
  const strategies = useStore((s) => s.strategies)
  const trades = useStore((s) => s.trades)
  const privacyMode = useStore((s) => s.display.privacyMode)
  const [step, setStep] = useState<Step>('upload')
  const [result, setResult] = useState<NotionImportResult | null>(null)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [imported, setImported] = useState(0)
  const [importedImages, setImportedImages] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [duplicateByRow, setDuplicateByRow] = useState<Record<number, DuplicateMatch>>({})
  const [forceImportRows, setForceImportRows] = useState<Record<number, boolean>>({})
  const [dupScanState, setDupScanState] = useState<'idle' | 'scanning' | 'done'>('idle')
  const [duplicateScanNotice, setDuplicateScanNotice] = useState('')
  const [parsing, setParsing] = useState(false)
  const [targetKind, setTargetKind] = useState<TradeKind>('live')
  const fileRef = useRef<HTMLInputElement>(null)
  const requestGenerationRef = useRef(0)
  const duplicateScanGenerationRef = useRef(0)
  const activeParseGenerationRef = useRef<number | null>(null)

  const duplicateCount = useMemo(
    () => Object.keys(duplicateByRow).length,
    [duplicateByRow],
  )

  const invalidatePendingRequest = () => {
    requestGenerationRef.current += 1
    duplicateScanGenerationRef.current += 1
  }

  useEffect(() => {
    if (!open) {
      invalidatePendingRequest()
      setResult(null)
      setStep('upload')
      setFileName('')
      setImported(0)
      setImportedImages(0)
      setDuplicateByRow({})
      setForceImportRows({})
      setDupScanState('idle')
      setDuplicateScanNotice('')
      setTargetKind('live')
    }
  }, [open])

  useEffect(() => () => invalidatePendingRequest(), [])

  const detectDuplicates = async (
    previews: NotionTradePreview[],
    requestGeneration: number,
    importTarget: TradeKind,
  ) => {
    const scanGeneration = duplicateScanGenerationRef.current + 1
    duplicateScanGenerationRef.current = scanGeneration
    const isCurrentScan = () =>
      requestGenerationRef.current === requestGeneration &&
      duplicateScanGenerationRef.current === scanGeneration
    if (!isCurrentScan()) return
    setDupScanState('scanning')
    setDuplicateScanNotice('')
    setDuplicateByRow({})
    setForceImportRows({})
    try {
      const storage = getStorage()
      const targetTrades = trades.filter((trade) => trade.tradeKind === importTarget)
      const candidateHasImages = previews.some((preview) => preview.images.length > 0)
      let includeImages = candidateHasImages
      if (candidateHasImages) {
        const assetIds = collectAssetIdsFromNotes(targetTrades)
        const stats = await storage.getAssetStats(assetIds)
        if (!isCurrentScan()) return
        includeImages =
          stats.count <= MAX_DUPLICATE_IMAGE_SCAN_COUNT &&
          stats.totalBytes <= MAX_DUPLICATE_IMAGE_SCAN_BYTES
        if (!includeImages) {
          setDuplicateScanNotice('图库较大，本次只检查正文重复；截图仍会按原图完整导入')
        }
      }
      const library = await buildLibraryContentIndex(targetTrades, async (assetId) => {
        const rec = await storage.getAssetForExport(assetId)
        return rec?.data ?? null
      }, {
        includeImages,
        shouldContinue: isCurrentScan,
      })
      const duplicateIndex = createDuplicateLookupIndex(library)
      const next: Record<number, DuplicateMatch> = {}
      for (const preview of previews) {
        if (!isCurrentScan()) return
        if (preview.errors.length > 0) continue
        const hashes = includeImages
          ? await hashImageFiles(preview.images.map((img) => ({ data: img.data })))
          : []
        if (!isCurrentScan()) return
        const sig = buildContentSignature(preview.noteHtml || preview.trade.note || '', hashes)
        const match = findObviousDuplicateIndexed(sig, duplicateIndex)
        if (match) next[preview.rowIndex] = match
      }
      if (!isCurrentScan()) return
      setDuplicateByRow(next)
    } catch (err) {
      if (!isCurrentScan()) return
      console.error('[NotionImport] duplicate scan failed', err)
    } finally {
      if (isCurrentScan()) {
        setDupScanState('done')
      }
    }
  }

  const processFile = async (file: File) => {
    if (activeParseGenerationRef.current !== null) return
    const requestGeneration = requestGenerationRef.current + 1
    requestGenerationRef.current = requestGeneration
    setError('')
    setFileName(file.name)
    setDuplicateByRow({})
    setForceImportRows({})
    setDupScanState('idle')
    setDuplicateScanNotice('')

    const isZip = file.name.toLowerCase().endsWith('.zip')
    const fileSizeLimit = isZip ? MAX_NOTION_ZIP_FILE_BYTES : MAX_NOTION_CSV_FILE_BYTES
    if (file.size > fileSizeLimit) {
      setError(
        isZip
          ? 'Notion ZIP 文件超过 160 MB，请拆分后导入'
          : 'Notion CSV 文件超过 32 MB，请拆分后导入',
      )
      return
    }

    activeParseGenerationRef.current = requestGeneration
    setParsing(true)

    try {
      if (isZip) {
        const buffer = await file.arrayBuffer()
        const r = await parseNotionZip(buffer, strategies, {
          shouldContinue: () => requestGenerationRef.current === requestGeneration,
        })
        if (requestGenerationRef.current !== requestGeneration) return
        if (r.totalRows === 0) {
          setError('ZIP 文件中未找到有效的交易记录（.md 文件为空或无交易数据）')
          return
        }
        setResult(r)
        setStep('preview')
        void detectDuplicates(r.previews, requestGeneration, targetKind)
      } else {
        const text = await file.text()
        if (requestGenerationRef.current !== requestGeneration) return
        const r = parseNotionCsv(text, strategies)
        if (r.totalRows > MAX_NOTION_IMPORT_ROWS) {
          setError('Notion 导入记录超过 20000 笔，请拆分后导入')
          return
        }
        if (r.totalRows === 0) {
          setError('CSV 文件为空或格式不正确')
          return
        }
        setResult(r)
        setStep('preview')
        void detectDuplicates(r.previews, requestGeneration, targetKind)
      }
    } catch (err) {
      if (requestGenerationRef.current !== requestGeneration) return
      console.error('[NotionImport] parse error', err)
      setError(
        getNotionCapacityErrorMessage(err) ??
          '无法解析文件，请确认是 Notion 导出的 .zip 或 CSV 文件',
      )
    } finally {
      if (activeParseGenerationRef.current === requestGeneration) {
        activeParseGenerationRef.current = null
        setParsing(false)
      }
    }
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await processFile(file)
  }

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (parsing) return
    const file = event.dataTransfer.files?.[0]
    if (file) await processFile(file)
  }

  const shouldImportPreview = (preview: NotionTradePreview) => {
    if (preview.errors.length > 0) return false
    const dup = duplicateByRow[preview.rowIndex]
    if (!dup) return true
    if (!skipDuplicates) return true
    return Boolean(forceImportRows[preview.rowIndex])
  }

  const visiblePreviews = useMemo(
    () => result?.previews.slice(0, PREVIEW_ROW_LIMIT) ?? [],
    [result],
  )
  const selectedPreviewCount = useMemo(() => {
    if (!result) return 0
    return result.previews.reduce((count, preview) => {
      if (preview.errors.length > 0) return count
      const duplicate = duplicateByRow[preview.rowIndex]
      if (!duplicate || !skipDuplicates || forceImportRows[preview.rowIndex]) return count + 1
      return count
    }, 0)
  }, [result, duplicateByRow, skipDuplicates, forceImportRows])

  const handleImport = async () => {
    if (!result || dupScanState !== 'done') return

    const selectedPreviews = result.previews.filter(shouldImportPreview)
    if (selectedPreviews.length === 0) {
      setError('没有可导入的记录（疑似重复已全部跳过）')
      return
    }

    setStep('importing')
    setError('')

    let committed
    try {
      committed = await commitNotionImportBatch(selectedPreviews, { targetKind })
    } catch (err) {
      console.error('[NotionImport] persist failed', err)
      setImportedImages(0)
      setStep('preview')
      setError(
        getNotionCapacityErrorMessage(err) ??
          '导入失败，交易、策略与图片均未写入，请重试',
      )
      return
    }

    const totalImages = committed.imageCount
    const newTrades = committed.importedTrades
    const newStrategies = committed.newStrategies
    setImportedImages(totalImages)
    setImported(newTrades.length)
    setStep('done')

    const skipped = skipDuplicates
      ? Object.keys(duplicateByRow).filter((row) => !forceImportRows[Number(row)]).length
      : 0
    const target = IMPORT_TARGETS.find((item) => item.kind === targetKind)!
    const parts = [`${newTrades.length} ${target.recordLabel}`]
    if (skipped > 0) parts.push(`跳过 ${skipped} 笔重复`)
    if (newStrategies.length > 0) {
      parts.push(`${newStrategies.length} 个策略：${newStrategies.map((s) => s.name).join('、')}`)
    }
    if (totalImages > 0) {
      parts.push(`${totalImages} 张截图`)
    }
    if (committed.trailingSaveFailed) {
      parts.push('并发设置待重试保存')
    }
    toast(`已从 Notion 导入 ${parts.join('，')}`)
  }

  const reset = () => {
    invalidatePendingRequest()
    setStep('upload')
    setResult(null)
    setError('')
    setFileName('')
    setImported(0)
    setImportedImages(0)
    setDragging(false)
    setSkipDuplicates(true)
    setDuplicateByRow({})
    setForceImportRows({})
    setDupScanState('idle')
    setDuplicateScanNotice('')
    setTargetKind('live')
    if (fileRef.current) fileRef.current.value = ''
  }

  const selectTarget = (nextTarget: TradeKind) => {
    if (nextTarget === targetKind) return
    setTargetKind(nextTarget)
    if (result && step === 'preview') {
      void detectDuplicates(result.previews, requestGenerationRef.current, nextTarget)
    }
  }

  if (!open) return null

  const requestClose = () => {
    if (step === 'importing') return
    reset()
    onClose()
  }

  const pickFile = () => {
    if (!parsing) fileRef.current?.click()
  }

  const targetLabel = IMPORT_TARGETS.find((target) => target.kind === targetKind)!.label

  const footer =
    step === 'upload' ? (
      <>
        <span className="nim-file-status">{fileName || '未选择文件'}</span>
        <Button variant="primary" size="lg" onClick={pickFile} disabled={parsing}>
          {parsing ? '正在解析…' : '选择文件'}
        </Button>
      </>
    ) : step === 'preview' && result ? (
      <>
        <Button variant="bordered" size="lg" onClick={reset}>
          重新选择文件
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={handleImport}
          disabled={
            dupScanState !== 'done' ||
            result.validRows === 0 ||
            selectedPreviewCount === 0
          }
        >
          确认导入
          {selectedPreviewCount > 0 ? ` ${selectedPreviewCount} 笔` : ''}
          {`到${targetLabel}`}
          {result.totalImages > 0 ? '（含截图）' : ''} <ArrowRight size={16} />
        </Button>
      </>
    ) : step === 'done' ? (
      <>
        <Button variant="bordered" size="lg" onClick={requestClose}>
          关闭
        </Button>
        <Button variant="primary" size="lg" onClick={reset}>
          导入更多
        </Button>
      </>
    ) : undefined

  return (
    <ModalShell
      title="从 Notion 导入"
      description={step === 'upload' ? '请先导出 Markdown & CSV，再选择文件' : undefined}
      busy={step === 'importing' || parsing}
      size={step === 'upload' || step === 'done' || step === 'importing' ? 'compact' : 'wide'}
      onClose={requestClose}
      footer={footer}
    >
      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="nim-upload-area">
          <div
            className={'nim-drop' + (dragging ? ' is-drag' : '')}
            onDragOver={(event) => {
              event.preventDefault()
              if (parsing) return
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={pickFile}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                pickFile()
              }
            }}
            role="button"
            tabIndex={parsing ? -1 : 0}
            aria-disabled={parsing}
            aria-busy={parsing}
            aria-label="拖放或选择 Notion 导出文件"
          >
            <div className="nim-drop-icon">
              <Upload size={16} />
            </div>
            <p className="nim-drop-title">拖放或选择文件</p>
            <p className="nim-drop-hint">.zip · .csv</p>
          </div>
          <div className="nim-formats">
            <div className="nim-format is-rec">
              <span className="nim-format-code">.zip</span>
              <span className="nim-format-name">
                含截图 <span className="nim-format-pill">推荐</span>
              </span>
            </div>
            <div className="nim-format">
              <span className="nim-format-code">.csv</span>
              <span className="nim-format-name">仅数据</span>
            </div>
          </div>
          <p className="nim-upload-tip">导出时勾选「包含子页面」</p>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,.csv"
            onChange={handleFile}
            disabled={parsing}
            className="nim-file-input-hidden"
          />
          {error && <p className="nim-error">{error}</p>}
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 'preview' && result && (
        <div className="nim-preview-area">
          <div className="nim-preview-summary">
            <FileText size={14} />
            <span className="nim-file-name">{fileName}</span>
          </div>
          <div className="nim-import-target">
            <span className="nim-import-target-label">导入到</span>
            <div className="nim-import-target-options" role="radiogroup" aria-label="Notion 导入目标">
              {IMPORT_TARGETS.map((target) => (
                <button
                  key={target.kind}
                  type="button"
                  role="radio"
                  aria-checked={targetKind === target.kind}
                  className={targetKind === target.kind ? 'is-selected' : ''}
                  onClick={() => selectTarget(target.kind)}
                >
                  <strong>{target.label}</strong>
                  <span>{target.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="nim-preview-stats">
            共 {result.totalRows} 笔记录：
            <span className="nim-ok">{result.validRows} 笔可导入</span>
            {result.errorRows > 0 && (
              <>
                {' · '}
                <span className="nim-bad">{result.errorRows} 笔有误</span>
              </>
            )}
            {duplicateCount > 0 && (
              <>
                {' · '}
                <span className="nim-dup-count">{duplicateCount} 笔疑似重复</span>
              </>
            )}
            {result.totalImages > 0 && (
              <>
                {' · '}
                <span className="nim-img-count">
                  <Image size={13} /> {result.totalImages} 张截图
                </span>
              </>
            )}
            {result.newStrategies.length > 0 && (
              <>
                {' · '}
                <span className="nim-new-strat">
                  {result.newStrategies.length} 个新策略：{result.newStrategies.join('、')}
                </span>
              </>
            )}
          </p>

          {dupScanState === 'scanning' && (
            <p className="nim-dup-scan">正在对照库内正文与截图检测重复…</p>
          )}
          {duplicateScanNotice && (
            <p className="nim-dup-scan" role="status">{duplicateScanNotice}</p>
          )}
          {result.previews.length > PREVIEW_ROW_LIMIT && (
            <p className="nim-dup-scan" role="status">
              仅展示前 {PREVIEW_ROW_LIMIT} 笔，确认后仍会导入全部 {selectedPreviewCount} 笔可导入记录
            </p>
          )}
          {dupScanState === 'done' && duplicateCount > 0 && (
            <label className="nim-dup-toggle">
              <SelectionBox
                checked={skipDuplicates}
                alwaysVisible
                label="跳过明显重复"
                onToggle={() => setSkipDuplicates((value) => !value)}
              />
              <span>跳过库内已有的明显重复（正文/截图相同）</span>
            </label>
          )}

          <div className="nim-preview-table-wrap">
            <table className="nim-preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>状态</th>
                  <th>标的</th>
                  <th>方向</th>
                  <th>交易状态</th>
                  <th>策略</th>
                  <th>PnL</th>
                  <th>R</th>
                  <th>日期</th>
                  <th>截图</th>
                  <th>标签</th>
                  <th>问题</th>
                </tr>
              </thead>
              <tbody>
                {visiblePreviews.map((p) => (
                  <PreviewRow
                    key={p.rowIndex}
                    preview={p}
                    duplicate={duplicateByRow[p.rowIndex]}
                    forceImport={Boolean(forceImportRows[p.rowIndex])}
                    onToggleForce={(next) =>
                      setForceImportRows((prev) => ({ ...prev, [p.rowIndex]: next }))
                    }
                    showForce={skipDuplicates}
                    privacyMode={privacyMode}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {error && <p className="nim-error">{error}</p>}
        </div>
      )}

      {/* Step 2.5: Importing */}
      {step === 'importing' && (
        <div className="nim-done-area">
          <LinearGridLoaderIcon variant="hourglass" size={ICON_HERO} aria-hidden />
          <p>正在导入…</p>
          <p className="nim-done-hint">截图正在离线保存到本地库，请稍候。</p>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 'done' && (
        <div className="nim-done-area">
          <CheckCircle size={40} className="nim-ok" />
          <p>
            已导入 {imported} {IMPORT_TARGETS.find((target) => target.kind === targetKind)!.recordLabel}
          </p>
          {importedImages > 0 && (
            <p className="nim-done-images">
              <Image size={15} /> {importedImages} 张截图已离线保存
            </p>
          )}
          <p className="nim-done-hint">
            {targetKind === 'case'
              ? '已进入案例记录，可继续补充分类与掌握状态。'
              : '请在详情中补充仓位、止损与结果数据。'}
          </p>
        </div>
      )}
    </ModalShell>
  )
}

function PreviewRow({
  preview,
  duplicate,
  forceImport,
  onToggleForce,
  showForce,
  privacyMode,
}: {
  preview: NotionTradePreview
  duplicate?: DuplicateMatch
  forceImport: boolean
  onToggleForce: (next: boolean) => void
  showForce: boolean
  privacyMode: boolean
}) {
  const t = preview.trade
  const hasError = preview.errors.length > 0
  const hasWarning = preview.warnings.length > 0 || Boolean(duplicate)

  return (
    <tr
      className={
        hasError ? 'nim-row-err' : duplicate ? 'nim-row-dup' : hasWarning ? 'nim-row-warn' : ''
      }
    >
      <td>{preview.rowIndex + 1}</td>
      <td>
        {hasError ? (
          <AlertCircle size={14} className="nim-bad" />
        ) : duplicate ? (
          <AlertCircle size={14} className="nim-dup" />
        ) : (
          <CheckCircle size={14} className="nim-ok" />
        )}
      </td>
      <td className="nim-cell-symbol">{t.symbol}</td>
      <td>{t.side === 'long' ? '做多' : t.side === 'short' ? '做空' : ''}</td>
      <td>{statusLabel(t.status)}</td>
      <td>
        {preview.newStrategyName ? (
          <span className="nim-new-badge">🆕 {preview.newStrategyName}</span>
        ) : (
          t.strategyId || '—'
        )}
      </td>
      <td className={privacyMode ? '' : t.pnl != null && t.pnl > 0 ? 'nim-pnl-pos' : t.pnl != null && t.pnl < 0 ? 'nim-pnl-neg' : ''}>
        {fmtMoney(t.pnl, privacyMode)}
      </td>
      <td>{t.rMultiple != null ? t.rMultiple.toFixed(2) : '—'}</td>
      <td>{t.openedAt ?? '—'}</td>
      <td>
        {preview.imageCount > 0 ? (
          <span className="nim-img-badge">
            <Image size={11} /> {preview.imageCount}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="nim-cell-tags">
        {(t.tags ?? []).slice(0, 3).map((tag) => (
          <span className="nim-tag" key={tag}>{tag}</span>
        ))}
        {(t.tags ?? []).length > 3 && (
          <Tooltip
            content={(t.tags ?? []).slice(3).join(' · ')}
            label={`其余标签：${(t.tags ?? []).slice(3).join('、')}`}
            focusable
          >
            <span className="nim-tag-more">+{(t.tags ?? []).length - 3}</span>
          </Tooltip>
        )}
      </td>
      <td className="nim-err-cell">
        {preview.errors.join('; ')}
        {hasWarning && !hasError && !duplicate ? preview.warnings.join('; ') : ''}
        {duplicate && (
          <span className="nim-dup-msg">
            与 {duplicate.tradeRef} {duplicateReasonLabel(duplicate.reason)}
            {showForce && (
              <>
                {' · '}
                <button
                  type="button"
                  className="nim-dup-force"
                  onClick={() => onToggleForce(!forceImport)}
                >
                  {forceImport ? '取消仍导入' : '仍导入'}
                </button>
              </>
            )}
          </span>
        )}
      </td>
    </tr>
  )
}

function statusLabel(s?: string): string {
  switch (s) {
    case 'win': return '盈利'
    case 'loss': return '亏损'
    case 'breakeven': return '保本'
    case 'open': return '持仓中'
    case 'planned': return '计划中'
    case 'missed': return '错过'
    default: return s ?? '—'
  }
}
