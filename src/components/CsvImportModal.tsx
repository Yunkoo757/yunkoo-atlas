import { ICON_HERO, ICON_MD, ICON_SM } from '@/icons/iconSize'
import { useEffect, useState, useMemo, useRef } from 'react'
import { InlineStatus } from '@/components/ui/InlineStatus'
import { ImportFileDrop } from './ImportFileDrop'
import { ArrowRight, CheckCircle } from '@/icons/appIcons'
import { ModalShell } from '@/components/ui/ModalShell'
import { Button } from '@/components/ui/Button'
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
import { formatTradeCashPnl } from '@/lib/cashCurrency'
import {
  buildContentSignature,
  buildLibraryContentIndex,
  createDuplicateLookupIndex,
  findObviousDuplicateIndexed,
  type DuplicateMatch,
} from '@/lib/tradeDuplicates'
import { getStorage } from '@/storage/provider'
import { toast } from '@/lib/toast'
import { flushPersistNow, withPersistSuspended } from '@/storage/persist'
import { Select } from '@/components/ui/Select'
import { SelectionBox } from '@/components/ui/SelectionBox'
import { normalizeSymbol } from '@/lib/symbolIcons'
import { ImportPreviewList, ImportPreviewRecord } from './ImportPreviewList'
import './CsvImportModal.css'

interface Props {
  open: boolean
  onClose: () => void
}

export function CsvImportModal({ open, onClose }: Props) {
  const strategies = useStore((s) => s.strategies)
  const trades = useStore((s) => s.trades)
  const upsertTradesFromNonInteractiveImport = useStore((s) => s.upsertTradesFromNonInteractiveImport)
  const rollbackFailedImportedTrades = useStore((s) => s.rollbackFailedImportedTrades)
  const privacyMode = useStore((s) => s.display.privacyMode)

  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'done'>('upload')
  const [csvResult, setCsvResult] = useState<ReturnType<typeof parseCsv> | null>(null)
  const [mapping, setMapping] = useState<FieldMapping>({})
  const [previews, setPreviews] = useState<ImportPreview[]>([])
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [duplicateByRow, setDuplicateByRow] = useState<Record<number, DuplicateMatch>>({})
  const [forceImportRows, setForceImportRows] = useState<Record<number, boolean>>({})
  const [duplicateScanState, setDuplicateScanState] = useState<'idle' | 'scanning' | 'done'>('idle')
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const importingRef = useRef(false)
  const requestGenerationRef = useRef(0)

  const usedFields = useMemo(() => new Set(Object.values(mapping)), [mapping])
  const duplicateCount = useMemo(() => Object.keys(duplicateByRow).length, [duplicateByRow])

  const invalidatePendingRequest = () => {
    requestGenerationRef.current += 1
  }

  useEffect(() => {
    if (!open) {
      invalidatePendingRequest()
      setStep('upload')
      setCsvResult(null)
      setMapping({})
      setPreviews([])
      setFileName('')
      setError('')
      setDuplicateByRow({})
      setForceImportRows({})
      setDuplicateScanState('idle')
    }
  }, [open])

  useEffect(() => () => invalidatePendingRequest(), [])

  const processFile = async (file: File) => {
    const requestGeneration = requestGenerationRef.current + 1
    requestGenerationRef.current = requestGeneration
    setError('')
    setFileName(file.name)
    setDuplicateByRow({})
    setForceImportRows({})
    setDuplicateScanState('idle')
    try {
      const text = await file.text()
      if (requestGenerationRef.current !== requestGeneration) return
      const result = parseCsv(text)
      if (result.headers.length === 0) {
        setError('CSV 文件为空或格式不正确')
        return
      }
      setCsvResult(result)
      setMapping(autoMapFields(result.headers))
      setStep('map')
    } catch {
      if (requestGenerationRef.current !== requestGeneration) return
      setError('无法读取文件，请确认是有效的 CSV 文件')
    }
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
    const requestGeneration = requestGenerationRef.current + 1
    requestGenerationRef.current = requestGeneration
    const pre: ImportPreview[] = []
    for (let i = 0; i < csvResult.rows.length; i++) {
      pre.push(mapRowToTrade(csvResult.rows[i] ?? [], mapping, i, strategies))
    }
    setPreviews(pre)
    setStep('preview')
    setForceImportRows({})
    setDuplicateScanState('scanning')
    setDuplicateByRow({})

    try {
      const storage = getStorage()
      const library = await buildLibraryContentIndex(trades, async (assetId) => {
        const rec = await storage.getAssetForExport(assetId)
        return rec?.data ?? null
      }, { includeImages: false })
      const duplicateIndex = createDuplicateLookupIndex(library)
      const next: Record<number, DuplicateMatch> = {}
      for (const row of pre) {
        if (requestGenerationRef.current !== requestGeneration) return
        if (row.errors.length > 0) continue
        const sig = buildContentSignature(row.trade.note ?? '', [])
        const match = findObviousDuplicateIndexed(sig, duplicateIndex)
        if (match) next[row.rowIndex] = match
      }
      if (requestGenerationRef.current !== requestGeneration) return
      setDuplicateByRow(next)
    } catch (err) {
      if (requestGenerationRef.current !== requestGeneration) return
      console.error('[CsvImport] duplicate scan failed', err)
      setDuplicateByRow({})
    } finally {
      if (requestGenerationRef.current === requestGeneration) {
        setDuplicateScanState('done')
      }
    }
  }

  const shouldImportPreview = (preview: ImportPreview) => {
    if (preview.errors.length > 0) return false
    const dup = duplicateByRow[preview.rowIndex]
    if (!dup) return true
    if (!skipDuplicates) return true
    return Boolean(forceImportRows[preview.rowIndex])
  }

  const handleImport = async () => {
    if (importingRef.current || duplicateScanState !== 'done') return
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

    importingRef.current = true
    setImporting(true)
    const existingTradeIds = new Set(useStore.getState().trades.map((trade) => trade.id))
    const insertedTradeIds = new Set(batch
      .filter((trade) => !existingTradeIds.has(trade.id))
      .map((trade) => trade.id))
    let insertedTrades: Trade[] = []
    const existingSymbols = new Set(useStore.getState().symbolCatalog)
    const insertedSymbols = new Set(
      batch
        .map((trade) => normalizeSymbol(trade.symbol))
        .filter((symbol) => symbol && !existingSymbols.has(symbol)),
    )

    setError('')
    try {
      await withPersistSuspended(() => {
        upsertTradesFromNonInteractiveImport(batch)
        insertedTrades = useStore.getState().trades.filter((trade) => insertedTradeIds.has(trade.id))
      })
    } catch (err) {
      console.error('[CsvImport] persist failed', err)
      rollbackFailedImportedTrades(insertedTrades)
      useStore.setState((state) => {
        const usedSymbols = new Set(state.trades.map((trade) => normalizeSymbol(trade.symbol)))
        return {
          symbolCatalog: state.symbolCatalog.filter(
            (symbol) => !insertedSymbols.has(symbol) || usedSymbols.has(symbol),
          ),
        }
      })
      // 首次失败留下的 pending 含导入批次；回滚后立即用最新 store 覆盖它。
      await flushPersistNow().catch((rollbackError) => {
        console.error('[CsvImport] rollback persist failed', rollbackError)
      })
      setError('导入失败，交易未能安全保存，请重试')
      return
    } finally {
      importingRef.current = false
      setImporting(false)
    }

    setStep('done')
    const skipped = skipDuplicates
      ? Object.keys(duplicateByRow).filter((row) => !forceImportRows[Number(row)]).length
      : 0
    const invalid = previews.length - skipped - imported
    const parts = [`成功导入 ${imported} 笔交易`]
    if (skipped > 0) parts.push(`跳过 ${skipped} 笔重复`)
    if (invalid > 0) parts.push(`${invalid} 行有误未导入`)
    toast(parts.join('，'), { tone: invalid > 0 ? 'warning' : 'success' })
  }

  const reset = () => {
    invalidatePendingRequest()
    importingRef.current = false
    setImporting(false)
    setStep('upload')
    setCsvResult(null)
    setMapping({})
    setPreviews([])
    setError('')
    setFileName('')
    setSkipDuplicates(true)
    setDuplicateByRow({})
    setForceImportRows({})
    setDuplicateScanState('idle')
    if (fileRef.current) fileRef.current.value = ''
  }

  if (!open) return null

  const requestClose = () => {
    if (importingRef.current) return
    reset()
    onClose()
  }

  const returnToMapping = () => {
    invalidatePendingRequest()
    setDuplicateByRow({})
    setForceImportRows({})
    setDuplicateScanState('idle')
    setStep('map')
  }

  const pickFile = () => fileRef.current?.click()

  const footer =
    step === 'upload' ? (
      <>
        {fileName ? <span className="import-file-status">{fileName}</span> : null}
        <Button variant="primary" size="lg" onClick={pickFile}>
          选择文件
        </Button>
      </>
    ) : step === 'map' ? (
      <>
        <Button variant="bordered" size="lg" onClick={reset}>
          重新选择文件
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={handlePreview}
          disabled={Object.keys(mapping).length === 0}
        >
          预览导入 <ArrowRight size={ICON_MD} />
        </Button>
      </>
    ) : step === 'preview' ? (
      <>
        <Button variant="bordered" size="lg" onClick={returnToMapping} disabled={importing}>
          返回调整映射
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={handleImport}
          disabled={
            importing ||
            duplicateScanState !== 'done' ||
            previews.filter(shouldImportPreview).length === 0
          }
        >
          {importing
            ? '正在导入…'
            : duplicateScanState === 'scanning'
              ? '正在检测重复…'
              : '确认导入'}
        </Button>
      </>
    ) : (
      <>
        <Button variant="bordered" size="lg" onClick={requestClose}>
          关闭
        </Button>
        <Button variant="primary" size="lg" onClick={reset}>
          导入其他文件
        </Button>
      </>
    )

  return (
    <ModalShell
      title="导入 CSV"
      description={step === 'upload' ? '支持中英文表头，自动匹配字段' : undefined}
      busy={importing}
      size={step === 'upload' || step === 'done' ? 'compact' : 'wide'}
      onClose={requestClose}
      footer={footer}
    >
        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="import-upload-area">
            <ImportFileDrop
              inputRef={fileRef}
              label="拖放或选择 CSV 文件"
              hint=".csv · .tsv · .txt"
              accept=".csv,.tsv,.txt"
              onFile={processFile}
            />
            {error && <InlineStatus tone="error" compact title={error} />}
          </div>
        )}

        {/* Step 2: Field Mapping */}
        {step === 'map' && csvResult && (
          <div className="csv-map-area">
            <p className="csv-map-hint">
              已匹配 {Object.keys(mapping).length} 列
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
            {error && <InlineStatus tone="error" compact title={error} />}
          </div>
        )}

        {/* Step 3: Preview */}
        {step === 'preview' && (
          <div className="csv-preview-area">
            <p className="csv-preview-summary">
              可导入 <strong>{previews.filter(shouldImportPreview).length}</strong> / {previews.length} 行
              {previews.some(row => row.errors.length > 0) && <> · {previews.filter(row => row.errors.length > 0).length} 行有误</>}
              {duplicateCount > 0 && <> · {duplicateCount} 行疑似重复</>}
            </p>
            {duplicateCount > 0 && (
              <label className="csv-dup-toggle">
                <SelectionBox
                  checked={skipDuplicates}
                  alwaysVisible
                  label="跳过明显重复正文"
                  onToggle={() => setSkipDuplicates((value) => !value)}
                />
                <span>跳过库内已有的明显重复正文</span>
              </label>
            )}
            <ImportPreviewList rows={previews}>{preview => (
              <ImportPreviewRecord
                trade={preview.trade} rowIndex={preview.rowIndex} privacyMode={privacyMode} errors={preview.errors}
                duplicate={duplicateByRow[preview.rowIndex]} forceImport={Boolean(forceImportRows[preview.rowIndex])}
                onToggleForce={skipDuplicates && !importing ? () => setForceImportRows(current => ({
                  ...current, [preview.rowIndex]: !current[preview.rowIndex],
                })) : undefined}
              >
                <dt>入场</dt><dd>{preview.trade.entry ?? '—'}</dd>
                <dt>出场</dt><dd>{preview.trade.exit ?? '—'}</dd>
                <dt>现金盈亏</dt><dd>{formatTradeCashPnl(preview.trade, null, privacyMode)}</dd>
              </ImportPreviewRecord>
            )}</ImportPreviewList>
            {error && <InlineStatus tone="error" compact title={error} />}
            {duplicateScanState === 'scanning' && (
              <p className="csv-preview-summary" role="status">正在检测重复记录…</p>
            )}
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && (
          <div className="import-done-area">
            <CheckCircle size={ICON_HERO} className="import-success-icon" />
            <p>导入完成</p>
          </div>
        )}
    </ModalShell>
  )
}
