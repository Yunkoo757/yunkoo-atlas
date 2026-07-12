import { useState, useRef, useMemo, type DragEvent } from 'react'
import { Upload, X, ArrowRight, CheckCircle, AlertCircle, FileText, Image } from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import {
  applyNotionImageAssetsToNote,
  parseNotionCsv,
  parseNotionZip,
  executeNotionImport,
  getImportableNotionPreviews,
  type NotionTradePreview,
  type NotionImportResult,
} from '@/lib/notionImport'
import {
  buildContentSignature,
  buildLibraryContentIndex,
  duplicateReasonLabel,
  findObviousDuplicate,
  hashImageFiles,
  type DuplicateMatch,
} from '@/lib/tradeDuplicates'
import { getStorage } from '@/storage'
import { toast } from '@/lib/toast'
import { withPersistSuspended } from '@/storage/persist'
import { Tooltip } from '@/components/ui/Tooltip'
import { SelectionBox } from '@/components/ui/SelectionBox'
import './NotionImportModal.css'

interface Props {
  open: boolean
  onClose: () => void
}

type Step = 'upload' | 'preview' | 'importing' | 'done'

export function NotionImportModal({ open, onClose }: Props) {
  const strategies = useStore((s) => s.strategies)
  const trades = useStore((s) => s.trades)
  const upsertTrades = useStore((s) => s.upsertTrades)
  const addStrategy = useStore((s) => s.addStrategy)

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
  const fileRef = useRef<HTMLInputElement>(null)

  const duplicateCount = useMemo(
    () => Object.keys(duplicateByRow).length,
    [duplicateByRow],
  )

  const detectDuplicates = async (previews: NotionTradePreview[]) => {
    setDupScanState('scanning')
    setDuplicateByRow({})
    setForceImportRows({})
    try {
      const storage = getStorage()
      const library = await buildLibraryContentIndex(trades, async (assetId) => {
        const rec = await storage.getAssetForExport(assetId)
        return rec?.data ?? null
      })
      const next: Record<number, DuplicateMatch> = {}
      for (const preview of previews) {
        if (preview.errors.length > 0) continue
        const hashes = await hashImageFiles(
          preview.images.map((img) => ({ data: img.data })),
        )
        const sig = buildContentSignature(preview.noteHtml || preview.trade.note || '', hashes)
        const match = findObviousDuplicate(sig, library)
        if (match) next[preview.rowIndex] = match
      }
      setDuplicateByRow(next)
    } catch (err) {
      console.error('[NotionImport] duplicate scan failed', err)
    } finally {
      setDupScanState('done')
    }
  }

  const processFile = async (file: File) => {
    setError('')
    setFileName(file.name)
    setDuplicateByRow({})
    setForceImportRows({})
    setDupScanState('idle')

    try {
      if (file.name.endsWith('.zip')) {
        const buffer = await file.arrayBuffer()
        const r = await parseNotionZip(buffer, strategies)
        if (r.totalRows === 0) {
          setError('ZIP 文件中未找到有效的交易记录（.md 文件为空或无交易数据）')
          return
        }
        setResult(r)
        setStep('preview')
        void detectDuplicates(r.previews)
      } else {
        const text = await file.text()
        const r = parseNotionCsv(text, strategies)
        if (r.totalRows === 0) {
          setError('CSV 文件为空或格式不正确')
          return
        }
        setResult(r)
        setStep('preview')
        void detectDuplicates(r.previews)
      }
    } catch (err) {
      console.error('[NotionImport] parse error', err)
      setError('无法解析文件，请确认是 Notion 导出的 .zip 或 CSV 文件')
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

  const handleImport = async () => {
    if (!result) return

    const selectedPreviews = result.previews.filter(shouldImportPreview)
    if (selectedPreviews.length === 0) {
      setError('没有可导入的记录（疑似重复已全部跳过）')
      return
    }

    setStep('importing')
    setError('')

    const { trades: newTrades, strategies: newStrategies } = executeNotionImport(
      selectedPreviews,
      strategies,
      trades,
    )
    const importablePreviews = getImportableNotionPreviews(selectedPreviews)

    let totalImages = 0
    const storage = getStorage()
    const imageAssetMap = new Map<number, string[]>()

    for (const preview of selectedPreviews) {
      if (preview.images.length === 0) continue
      const assetIds: string[] = []

      for (const img of preview.images) {
        try {
          const blob = new Blob([img.data as BlobPart], { type: img.mime })
          const file = new File([blob], img.name, { type: img.mime })
          const assetId = await storage.saveAsset(file, img.mime)
          assetIds.push(assetId)
          totalImages++
        } catch (err) {
          console.error(`[NotionImport] failed to save image: ${img.name}`, err)
        }
      }

      imageAssetMap.set(preview.rowIndex, assetIds)
    }

    setImportedImages(totalImages)

    for (let i = 0; i < newTrades.length; i++) {
      const trade = newTrades[i]!
      const preview = importablePreviews[i]
      if (preview) {
        const assetIds = imageAssetMap.get(preview.rowIndex) ?? []
        trade.note = applyNotionImageAssetsToNote(trade.note || '', assetIds)
      }
    }

    await withPersistSuspended(() => {
      const existingIds = new Set(useStore.getState().strategies.map((s) => s.id))
      for (const s of newStrategies) {
        if (!existingIds.has(s.id)) {
          addStrategy(s)
        }
      }
      upsertTrades(newTrades)
    })

    setImported(newTrades.length)
    setStep('done')

    const skipped = skipDuplicates
      ? Object.keys(duplicateByRow).filter((row) => !forceImportRows[Number(row)]).length
      : 0
    const parts = [`${newTrades.length} 笔交易`]
    if (skipped > 0) parts.push(`跳过 ${skipped} 笔重复`)
    if (newStrategies.length > 0) {
      parts.push(`${newStrategies.length} 个策略：${newStrategies.map((s) => s.name).join('、')}`)
    }
    if (totalImages > 0) {
      parts.push(`${totalImages} 张截图`)
    }
    toast(`已从 Notion 导入 ${parts.join('，')}`)
  }

  const reset = () => {
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
    if (fileRef.current) fileRef.current.value = ''
  }

  if (!open) return null

  const pickFile = () => fileRef.current?.click()

  return (
    <div className="nim-overlay" onMouseDown={onClose}>
      <div
        className={'nim-modal' + (step === 'upload' || step === 'done' || step === 'importing' ? '' : ' is-wide')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="nim-header">
          <div>
            <h2>从 Notion 导入</h2>
            {step === 'upload' && (
              <p className="nim-desc">请先导出 Markdown & CSV，再选择文件</p>
            )}
          </div>
          <button className="nim-close" onClick={onClose} type="button" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="nim-upload-area">
            <div
              className={'nim-drop' + (dragging ? ' is-drag' : '')}
              onDragOver={(event) => {
                event.preventDefault()
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
              tabIndex={0}
              aria-label="拖放或选择 Notion 导出文件"
            >
              <div className="nim-drop-icon">
                <Upload size={16} strokeWidth={1.5} />
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
            <div className="nim-upload-foot">
              <span className="nim-file-status">{fileName || '未选择文件'}</span>
              <button className="nim-btn nim-btn-primary" type="button" onClick={pickFile}>
                选择文件
              </button>
            </div>
            <p className="nim-upload-tip">导出时勾选「包含子页面」</p>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,.csv"
              onChange={handleFile}
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
            <p className="nim-preview-stats">
              共 {result.totalRows} 笔交易：
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
            {dupScanState === 'done' && duplicateCount > 0 && (
              <label className="nim-dup-toggle">
                <SelectionBox
                  checked={skipDuplicates}
                  alwaysVisible
                  label="跳过明显重复"
                  onToggle={() => setSkipDuplicates((value) => !value)}
                />
                <span>跳过明显重复（正文/截图相同），默认开启</span>
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
                  {result.previews.map((p) => (
                    <PreviewRow
                      key={p.rowIndex}
                      preview={p}
                      duplicate={duplicateByRow[p.rowIndex]}
                      forceImport={Boolean(forceImportRows[p.rowIndex])}
                      onToggleForce={(next) =>
                        setForceImportRows((prev) => ({ ...prev, [p.rowIndex]: next }))
                      }
                      showForce={skipDuplicates}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {error && <p className="nim-error">{error}</p>}

            <div className="nim-actions">
              <button className="nim-btn nim-btn-ghost" onClick={reset} type="button">
                重新选择文件
              </button>
              <button
                className="nim-btn nim-btn-primary"
                onClick={handleImport}
                disabled={
                  result.validRows === 0 ||
                  result.previews.filter(shouldImportPreview).length === 0
                }
                type="button"
              >
                确认导入
                {result.previews.filter(shouldImportPreview).length > 0
                  ? ` ${result.previews.filter(shouldImportPreview).length} 笔`
                  : ''}
                {result.totalImages > 0 ? `（含截图）` : ''} <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 2.5: Importing */}
        {step === 'importing' && (
          <div className="nim-done-area">
            <div className="nim-spinner" />
            <p>正在导入…</p>
            <p className="nim-done-hint">截图正在离线保存到本地库，请稍候。</p>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 'done' && (
          <div className="nim-done-area">
            <CheckCircle size={40} strokeWidth={1.5} className="nim-ok" />
            <p>已导入 {imported} 笔交易</p>
            {importedImages > 0 && (
              <p className="nim-done-images">
                <Image size={15} /> {importedImages} 张截图已离线保存
              </p>
            )}
            <p className="nim-done-hint">
              请在交易详情中补充入场价、出场价、仓位等数据。
            </p>
            <div className="nim-actions">
              <button className="nim-btn nim-btn-primary" onClick={reset} type="button">
                导入更多
              </button>
              <button className="nim-btn nim-btn-ghost" onClick={onClose} type="button">
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PreviewRow({
  preview,
  duplicate,
  forceImport,
  onToggleForce,
  showForce,
}: {
  preview: NotionTradePreview
  duplicate?: DuplicateMatch
  forceImport: boolean
  onToggleForce: (next: boolean) => void
  showForce: boolean
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
      <td className={t.pnl && t.pnl > 0 ? 'nim-pnl-pos' : t.pnl && t.pnl < 0 ? 'nim-pnl-neg' : ''}>
        {t.pnl !== undefined ? `$${t.pnl.toFixed(2)}` : '—'}
      </td>
      <td>{t.rMultiple ? t.rMultiple.toFixed(2) : '—'}</td>
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
