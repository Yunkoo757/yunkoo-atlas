import { useState, useMemo, useRef } from 'react'
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
import { toast } from '@/lib/toast'
import { Select } from '@/components/ui/Select'
import './CsvImportModal.css'

interface Props {
  open: boolean
  onClose: () => void
}

export function CsvImportModal({ open, onClose }: Props) {
  const strategies = useStore((s) => s.strategies)
  const trades = useStore((s) => s.trades)
  const upsertTrade = useStore((s) => s.upsertTrade)

  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'done'>('upload')
  const [csvResult, setCsvResult] = useState<ReturnType<typeof parseCsv> | null>(null)
  const [mapping, setMapping] = useState<FieldMapping>({})
  const [previews, setPreviews] = useState<ImportPreview[]>([])
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const usedFields = useMemo(() => new Set(Object.values(mapping)), [mapping])

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('')
    const file = e.target.files?.[0]
    if (!file) return
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

  const handlePreview = () => {
    if (!csvResult) return
    const pre: ImportPreview[] = []
    for (let i = 0; i < csvResult.rows.length; i++) {
      pre.push(mapRowToTrade(csvResult.rows[i] ?? [], mapping, i, strategies))
    }
    setPreviews(pre)
    setStep('preview')
  }

  const handleImport = () => {
    const valid = previews.filter((p) => p.errors.length === 0)
    if (valid.length === 0) {
      setError('没有可导入的数据行，请修正映射或数据后重试')
      return
    }

    let maxRef = 0
    for (const t of trades) {
      const n = parseInt(t.ref.replace('TRD-', ''), 10)
      if (!isNaN(n) && n > maxRef) maxRef = n
    }

    let imported = 0
    for (const p of valid) {
      maxRef++
      const ref = `TRD-${maxRef}`
      const id = `trade-${Date.now()}-${maxRef}`
      const trade = finalizeTrade(p.trade, strategies, ref, id)
      if (trade) {
        upsertTrade(trade)
        imported++
      }
    }

    setStep('done')
    toast(`成功导入 ${imported} 笔交易`)
  }

  const reset = () => {
    setStep('upload')
    setCsvResult(null)
    setMapping({})
    setPreviews([])
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  if (!open) return null

  return (
    <div className="csv-modal-overlay" onClick={onClose}>
      <div className="csv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="csv-modal-header">
          <h2>导入 CSV 交易数据</h2>
          <button className="csv-modal-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="csv-upload-area">
            <Upload size={32} strokeWidth={1.5} />
            <p>选择 CSV 文件，支持逗号、分号、Tab 分隔</p>
            <p className="csv-upload-hint">
              自动识别中英文表头，如：标的/symbol、方向/side、入场价/entry 等
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={handleFile}
              className="csv-file-input"
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
            </p>
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
                  {previews.slice(0, 20).map((p) => (
                    <tr key={p.rowIndex} className={p.errors.length > 0 ? 'csv-row-err' : ''}>
                      <td>{p.rowIndex + 1}</td>
                      <td>
                        {p.errors.length === 0 ? (
                          <CheckCircle size={14} className="csv-ok" />
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
                      <td className="csv-err-cell">{p.errors.join('; ')}</td>
                    </tr>
                  ))}
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
                disabled={previews.filter((p) => p.errors.length === 0).length === 0}
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
            <CheckCircle size={40} strokeWidth={1.5} className="csv-ok" />
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
