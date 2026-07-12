import { useState, useMemo, useRef, type DragEvent } from 'react'
import { Upload, X, ArrowRight, AlertCircle, CheckCircle } from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import {
  parseCsv,
  autoMapFields,
  mapRowToTrade,
  finalizeTrade,
  TRADE_FIELD_LIST,
  type FieldMapping,
  type ImportPreview,
  type TradeField,
} from '@/lib/csvImport'
import type { Trade } from '@/data/trades'
import {
  buildContentSignature,
  buildLibraryContentIndex,
  duplicateReasonLabel,
  findObviousDuplicate,
  type DuplicateMatch,
} from '@/lib/tradeDuplicates'
import { getStorage } from '@/storage'
import { toast } from '@/lib/toast'
import { withPersistSuspended } from '@/storage/persist'
import { Select } from '@/components/ui/Select'
import { SelectionBox } from '@/components/ui/SelectionBox'
import './CsvImportModal.css'

interface Props {
  open: boolean
  onClose: () => void
}

export function CsvImportModal({ open, onClose }: Props) {
  const strategies = useStore((s) => s.strategies)
  const trades = useStore((s) => s.trades)
  const upsertTrades = useStore((s) => s.upsertTrades)

  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'done'>('upload')
  const [csvResult, setCsvResult] = useState<ReturnType<typeof parseCsv> | null>(null)
  const [mapping, setMapping] = useState<FieldMapping>({})
  const [previews, setPreviews] = useState<ImportPreview[]>([])
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [dragging, setDragging] = useState(false)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [duplicateByRow, setDuplicateByRow] = useState<Record<number, DuplicateMatch>>({})
  const [forceImportRows, setForceImportRows] = useState<Record<number, boolean>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const usedFields = useMemo(() => new Set(Object.values(mapping)), [mapping])
  const duplicateCount = useMemo(() => Object.keys(duplicateByRow).length, [duplicateByRow])

  const processFile = async (file: File) => {
    setError('')
    setFileName(file.name)
    setDuplicateByRow({})
    setForceImportRows({})
    try {
      const text = await file.text()
      const result = parseCsv(text)
      if (result.headers.length === 0) {
        setError('CSV 文件为空或格式不正确')
        return
      }
      setCsvResult(result)
      setMapping(autoMapFields(result.headers))
      setStep('map')
    } catch {
      setError('无法读取文件，请确认是有效的 CSV 文件')
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

  const setMap = (colIdx: number, field: TradeField | '') => {
    const next = { ...mapping }
    if (field === '') {
      delete next[colIdx]
    } else {
      // 如果该字段已被其他列映射，先移除旧映射
      for (const [ci, f] of Object.entries(next)) {
        if (f === field && parseInt(ci) !== colIdx) delete next[parseInt(ci)]
      }
      next[colIdx] = field
    }
    setMapping(next)
  }

  const handlePreview = async () => {
    if (!csvResult) return
    const pre: ImportPreview[] = []
    for (let i = 0; i < csvResult.rows.length; i++) {
      pre.push(mapRowToTrade(csvResult.rows[i] ?? [], mapping, i, strategies))
    }
    setPreviews(pre)
    setStep('preview')
    setForceImportRows({})

    try {
      const storage = getStorage()
      const library = await buildLibraryContentIndex(trades, async (assetId) => {
        const rec = await storage.getAssetForExport(assetId)
        return rec?.data ?? null
      })
      const next: Record<number, DuplicateMatch> = {}
      for (const row of pre) {
        if (row.errors.length > 0) continue
        const sig = buildContentSignature(row.trade.note ?? '', [])
        const match = findObviousDuplicate(sig, library)
        if (match) next[row.rowIndex] = match
      }
      setDuplicateByRow(next)
    } catch (err) {
      console.error('[CsvImport] duplicate scan failed', err)
      setDuplicateByRow({})
    }
  }

  const shouldImportPreview = (preview: ImportPreview) => {
    if (preview.errors.length > 0) return false
    const dup = duplicateByRow[preview.rowIndex]
    if (!dup) return true
    if (!skipDuplicates) return true
    return Boolean(forceImportRows[preview.rowIndex])
  }

  const handleImport = () => {
    const valid = previews.filter(shouldImportPreview)
    if (valid.length === 0) {
      setError('没有可导入的数据行（疑似重复已全部跳过或需修正映射）')
      return
    }

    let maxRef = 0
    for (const t of trades) {
      const n = parseInt(t.ref.replace('TRD-', ''), 10)
      if (!isNaN(n) && n > maxRef) maxRef = n
    }

    const batch: Trade[] = []
    for (const p of valid) {
      maxRef++
      const ref = `TRD-${maxRef}`
      const id = `trade-${Date.now()}-${maxRef}`
      const trade = finalizeTrade(p.trade, strategies, ref, id)
      if (trade) batch.push(trade)
    }

    const imported = batch.length
    if (imported === 0) {
      setError('没有可导入的数据行（疑似重复已全部跳过或需修正映射）')
      return
    }

    void withPersistSuspended(() => {
      upsertTrades(batch)
    })

    setStep('done')
    const skipped = skipDuplicates
      ? Object.keys(duplicateByRow).filter((row) => !forceImportRows[Number(row)]).length
      : 0
    toast(
      skipped > 0
        ? `成功导入 ${imported} 笔，跳过 ${skipped} 笔重复`
        : `成功导入 ${imported} 笔交易`,
    )
  }

  const reset = () => {
    setStep('upload')
    setCsvResult(null)
    setMapping({})
    setPreviews([])
    setError('')
    setFileName('')
    setDragging(false)
    setSkipDuplicates(true)
    setDuplicateByRow({})
    setForceImportRows({})
    if (fileRef.current) fileRef.current.value = ''
  }

  if (!open) return null

  const pickFile = () => fileRef.current?.click()

  return (
    <div className="csv-modal-overlay" onClick={onClose}>
      <div
        className={'csv-modal' + (step === 'upload' || step === 'done' ? '' : ' is-wide')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="csv-modal-header">
          <div>
            <h2>导入 CSV</h2>
            {step === 'upload' && (
              <p className="csv-modal-desc">支持中英文表头，自动匹配字段</p>
            )}
          </div>
          <button className="csv-modal-close" onClick={onClose} type="button" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="csv-upload-area">
            <div
              className={'csv-drop' + (dragging ? ' is-drag' : '')}
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
              aria-label="拖放或选择 CSV 文件"
            >
              <div className="csv-drop-icon">
                <Upload size={16} />
              </div>
              <p className="csv-drop-title">拖放或选择文件</p>
              <p className="csv-drop-hint">.csv · .tsv · .txt</p>
            </div>
            <div className="csv-upload-foot">
              <span className="csv-file-status">{fileName || '未选择文件'}</span>
              <button className="csv-btn csv-btn-primary" type="button" onClick={pickFile}>
                选择文件
              </button>
            </div>
            <p className="csv-upload-tip">如 symbol / side / entry</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={handleFile}
              className="csv-file-input-hidden"
            />
            {error && <p className="csv-error">{error}</p>}
          </div>
        )}

        {/* Step 2: Field Mapping */}
        {step === 'map' && csvResult && (
          <div className="csv-map-area">
            <p className="csv-map-hint">
              已自动识别 {Object.keys(mapping).length} 个字段映射，可手动调整：
            </p>
            <div className="csv-map-table-wrap">
              <table className="csv-map-table">
                <thead>
                  <tr>
                    <th>CSV 列</th>
                    <th>示例数据</th>
                    <th>映射到</th>
                  </tr>
                </thead>
                <tbody>
                  {csvResult.headers.map((h, i) => (
                    <tr key={i}>
                      <td className="csv-map-col">{h}</td>
                      <td className="csv-map-sample">
                        {csvResult.rows[0]?.[i] ?? ''}
                      </td>
                      <td>
                        <Select
                          value={mapping[i] ?? ''}
                          onValueChange={(value) => setMap(i, value as TradeField | '')}
                          ariaLabel={`映射 CSV 列 ${h}`}
                          className={'csv-map-select' + (mapping[i] ? ' is-mapped' : '')}
                          options={[
                            { value: '', label: '— 忽略 —' },
                            ...TRADE_FIELD_LIST.map((field) => ({
                              value: field.key,
                              label: `${field.label} (${field.key})${field.required ? ' *' : ''}`,
                              disabled: usedFields.has(field.key) && mapping[i] !== field.key,
                            })),
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && <p className="csv-error">{error}</p>}
            <div className="csv-actions">
              <button className="csv-btn csv-btn-ghost" onClick={reset} type="button">
                重新选择文件
              </button>
              <button
                className="csv-btn csv-btn-primary"
                onClick={handlePreview}
                disabled={Object.keys(mapping).length === 0}
                type="button"
              >
                预览导入 <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <div className="csv-preview-area">
            <p className="csv-preview-summary">
              共 {previews.length} 行：
              <span className="csv-ok">{previews.filter((p) => p.errors.length === 0).length} 行有效</span>
              {' · '}
              <span className="csv-bad">{previews.filter((p) => p.errors.length > 0).length} 行有误</span>
              {duplicateCount > 0 && (
                <>
                  {' · '}
                  <span className="csv-dup-count">{duplicateCount} 行疑似重复</span>
                </>
              )}
            </p>
            {duplicateCount > 0 && (
              <label className="csv-dup-toggle">
                <SelectionBox
                  checked={skipDuplicates}
                  alwaysVisible
                  label="跳过明显重复正文"
                  onToggle={() => setSkipDuplicates((value) => !value)}
                />
                <span>跳过明显重复正文，默认开启</span>
              </label>
            )}
            <div className="csv-preview-table-wrap">
              <table className="csv-preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>状态</th>
                    <th>标的</th>
                    <th>方向</th>
                    <th>入场</th>
                    <th>出场</th>
                    <th>盈亏</th>
                    <th>日期</th>
                    <th>问题</th>
                  </tr>
                </thead>
                <tbody>
                  {previews.slice(0, 20).map((p) => {
                    const dup = duplicateByRow[p.rowIndex]
                    return (
                      <tr
                        key={p.rowIndex}
                        className={
                          p.errors.length > 0 ? 'csv-row-err' : dup ? 'csv-row-dup' : ''
                        }
                      >
                        <td>{p.rowIndex + 1}</td>
                        <td>
                          {p.errors.length === 0 ? (
                            dup ? (
                              <AlertCircle size={14} className="csv-dup" />
                            ) : (
                              <CheckCircle size={14} className="csv-ok" />
                            )
                          ) : (
                            <AlertCircle size={14} className="csv-bad" />
                          )}
                        </td>
                        <td>{p.trade.symbol ?? ''}</td>
                        <td>{p.trade.side ?? ''}</td>
                        <td>{p.trade.entry ?? ''}</td>
                        <td>{p.trade.exit ?? ''}</td>
                        <td>{p.trade.pnl ?? ''}</td>
                        <td>{p.trade.openedAt ?? ''}</td>
                        <td className="csv-err-cell">
                          {p.errors.join('; ')}
                          {dup && (
                            <span className="csv-dup-msg">
                              {p.errors.length ? ' · ' : ''}
                              与 {dup.tradeRef} {duplicateReasonLabel(dup.reason)}
                              {skipDuplicates && (
                                <>
                                  {' · '}
                                  <button
                                    type="button"
                                    className="csv-dup-force"
                                    onClick={() =>
                                      setForceImportRows((prev) => ({
                                        ...prev,
                                        [p.rowIndex]: !prev[p.rowIndex],
                                      }))
                                    }
                                  >
                                    {forceImportRows[p.rowIndex] ? '取消仍导入' : '仍导入'}
                                  </button>
                                </>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {error && <p className="csv-error">{error}</p>}
            <div className="csv-actions">
              <button className="csv-btn csv-btn-ghost" onClick={() => setStep('map')} type="button">
                返回调整映射
              </button>
              <button
                className="csv-btn csv-btn-primary"
                onClick={handleImport}
                disabled={previews.filter(shouldImportPreview).length === 0}
                type="button"
              >
                确认导入
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && (
          <div className="csv-done-area">
            <CheckCircle size={40} className="csv-ok" />
            <p>导入完成！</p>
            <div className="csv-actions">
              <button className="csv-btn csv-btn-primary" onClick={reset} type="button">
                导入其他文件
              </button>
              <button className="csv-btn csv-btn-ghost" onClick={onClose} type="button">
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
