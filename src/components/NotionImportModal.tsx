import { useState, useRef } from 'react'
import { Upload, X, ArrowRight, CheckCircle, AlertCircle, FileText, Image } from 'lucide-react'
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
import { getStorage } from '@/storage'
import { toast } from '@/lib/toast'
import { Tooltip } from '@/components/ui/Tooltip'
import './NotionImportModal.css'

interface Props {
  open: boolean
  onClose: () => void
}

type Step = 'upload' | 'preview' | 'importing' | 'done'

export function NotionImportModal({ open, onClose }: Props) {
  const strategies = useStore((s) => s.strategies)
  const trades = useStore((s) => s.trades)
  const upsertTrade = useStore((s) => s.upsertTrade)
  const addStrategy = useStore((s) => s.addStrategy)

  const [step, setStep] = useState<Step>('upload')
  const [result, setResult] = useState<NotionImportResult | null>(null)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [imported, setImported] = useState(0)
  const [importedImages, setImportedImages] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('')
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)

    try {
      // 判断文件类型
      if (file.name.endsWith('.zip')) {
        // ZIP 包：解析 Markdown + 图片
        const buffer = await file.arrayBuffer()
        const r = await parseNotionZip(buffer, strategies)
        if (r.totalRows === 0) {
          setError('ZIP 文件中未找到有效的交易记录（.md 文件为空或无交易数据）')
          return
        }
        setResult(r)
      } else {
        // CSV 文件：纯数据（无图片）
        const text = await file.text()
        const r = parseNotionCsv(text, strategies)
        if (r.totalRows === 0) {
          setError('CSV 文件为空或格式不正确')
          return
        }
        setResult(r)
      }
      setStep('preview')
    } catch (err) {
      console.error('[NotionImport] parse error', err)
      setError('无法解析文件，请确认是 Notion 导出的 .zip 或 CSV 文件')
    }
  }

  const handleImport = async () => {
    if (!result) return

    setStep('importing')

    const { trades: newTrades, strategies: newStrategies } = executeNotionImport(
      result.previews,
      strategies,
      trades,
    )
    const importablePreviews = getImportableNotionPreviews(result.previews)

    // 1. 创建新策略
    const existingIds = new Set(strategies.map((s) => s.id))
    for (const s of newStrategies) {
      if (!existingIds.has(s.id)) {
        addStrategy(s)
      }
    }

    // 2. 导入图片到 storage
    let totalImages = 0
    const storage = getStorage()
    const imageAssetMap = new Map<number, string[]>() // rowIndex → assetIds

    for (const preview of result.previews) {
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

    // 3. 写入交易（按正文占位顺序注入图片，保持图文交错）
    for (let i = 0; i < newTrades.length; i++) {
      const trade = newTrades[i]!
      const preview = importablePreviews[i]
      if (preview) {
        const assetIds = imageAssetMap.get(preview.rowIndex) ?? []
        trade.note = applyNotionImageAssetsToNote(trade.note || '', assetIds)
      }
      upsertTrade(trade)
    }

    setImported(newTrades.length)
    setStep('done')

    const parts = [`${newTrades.length} 笔交易`]
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
    if (fileRef.current) fileRef.current.value = ''
  }

  if (!open) return null

  return (
    <div className="nim-overlay" onMouseDown={onClose}>
      <div className="nim-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="nim-header">
          <h2>从 Notion 导入交易</h2>
          <button className="nim-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="nim-upload-area">
            <Upload size={32} strokeWidth={1.5} />
            <p>选择 Notion 导出的文件</p>
            <p className="nim-upload-hint">
              <strong>.zip</strong> — Markdown & CSV 导出（推荐，含截图离线导入）
              <br />
              <strong>.csv</strong> — 仅数据库 CSV（快速导入，无图片）
            </p>
            <p className="nim-upload-note">
              提示：Notion 右上角 ⋯ → 导出 → 格式选择「Markdown & CSV」→ 勾选「包含子页面」
              <br />
              下载 .zip 后直接导入，截图会自动离线保存到本地库。
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,.csv"
              onChange={handleFile}
              className="nim-file-input"
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
                    <PreviewRow key={p.rowIndex} preview={p} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="nim-actions">
              <button className="nim-btn nim-btn-ghost" onClick={reset} type="button">
                重新选择文件
              </button>
              <button
                className="nim-btn nim-btn-primary"
                onClick={handleImport}
                disabled={result.validRows === 0}
                type="button"
              >
                确认导入{result.totalImages > 0 ? `（含 ${result.totalImages} 张截图）` : ''} <ArrowRight size={16} />
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

function PreviewRow({ preview }: { preview: NotionTradePreview }) {
  const t = preview.trade
  const hasError = preview.errors.length > 0
  const hasWarning = preview.warnings.length > 0

  return (
    <tr className={hasError ? 'nim-row-err' : hasWarning ? 'nim-row-warn' : ''}>
      <td>{preview.rowIndex + 1}</td>
      <td>
        {hasError ? (
          <AlertCircle size={14} className="nim-bad" />
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
        {hasWarning && !hasError ? preview.warnings.join('; ') : ''}
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
