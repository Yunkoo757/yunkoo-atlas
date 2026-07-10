import { createPortal } from 'react-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Image } from 'lucide-react'
import type { CaseImage } from '@/data/case'
import { useStore } from '@/store/useStore'
import { getStorage } from '@/storage'
import { toast } from '@/lib/toast'
import { STATUS_META, TRADE_KIND_META, type Trade } from '@/data/trades'
import { REVIEW_STATUS_META } from '@/lib/reviewAnalytics'
import { Tooltip } from '@/components/ui/Tooltip'
import { Select } from '@/components/ui/Select'

interface PendingImage {
  blob: Blob
  mime: string
  previewUrl: string
}

export function NewCaseModal() {
  const navigate = useNavigate()
  const open = useStore((s) => s.caseModalOpen)
  const context = useStore((s) => s.caseModalContext)
  const addCase = useStore((s) => s.addCase)
  const disputeTypes = useStore((s) => s.disputeTypes)
  const setCaseModalOpen = useStore((s) => s.setCaseModalOpen)
  const trades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const [disputeTypeId, setDisputeTypeId] = useState(disputeTypes[0]?.id ?? '')
  const [verdict, setVerdict] = useState('是')
  const [confidence, setConfidence] = useState<30 | 50 | 70 | 90>(70)
  const [images, setImages] = useState<PendingImage[]>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  const sourceTrade = trades.find((t) => t.id === context?.sourceTradeId)
  const sourceStrategy = sourceTrade
    ? strategies.find((s) => s.id === sourceTrade.strategyId)
    : undefined

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setDisputeTypeId(disputeTypes[0]?.id ?? '')
      setVerdict(disputeTypes[0]?.options[0] ?? '是')
      setConfidence(70)
      setImages([])
      setNote(buildSourceNote(sourceTrade, sourceStrategy?.name))
    } else {
      setImages((prev) => {
        prev.forEach((img) => URL.revokeObjectURL(img.previewUrl))
        return []
      })
    }
  }, [open, disputeTypes, sourceTrade, sourceStrategy?.name])

  // Global paste handler
  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!open) return
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile()
        if (blob) {
          const previewUrl = URL.createObjectURL(blob)
          setImages((prev) => [...prev, { blob, mime: item.type, previewUrl }])
        }
      }
    }
  }, [open])

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file)
        setImages((prev) => [...prev, { blob: file, mime: file.type, previewUrl }])
      }
    }
  }, [])

  const removeImage = (idx: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[idx].previewUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  if (!open) return null

  const dt = disputeTypes.find((d) => d.id === disputeTypeId)
  const options = dt?.options ?? ['是', '不是']

  const handleSave = async () => {
    setSaving(true)
    try {
      // Save images to storage
      const savedImages: CaseImage[] = []
      for (let i = 0; i < images.length; i++) {
        const { blob, mime } = images[i]
        try {
          const fileId = await getStorage().saveAsset(blob, mime)
          savedImages.push({ fileId, order: i })
        } catch (err) {
          console.error('[case] save image failed', err)
        }
      }

      // Clean up preview URLs
      images.forEach((img) => URL.revokeObjectURL(img.previewUrl))

      const now = new Date().toISOString()
      const id = crypto.randomUUID()
      const sourceTags = sourceTrade
        ? [...new Set([...sourceTrade.tags, ...sourceTrade.mistakeTags])]
        : []
      addCase({
        id,
        disputeTypeId,
        initialVerdict: verdict,
        confidence,
        images: savedImages,
        note: note.trim() || undefined,
        tags: sourceTags.length ? sourceTags : undefined,
        linkedTradeIds: sourceTrade ? [sourceTrade.id] : undefined,
        createdAt: now,
        updatedAt: now,
      })
      toast(savedImages.length > 0 ? `判例已创建（${savedImages.length} 张截图）` : '判例已创建')
      setImages([])
      setCaseModalOpen(false)
      navigate(`/cases?case=${id}`)
    } catch {
      toast('创建失败')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="ncm-overlay" onMouseDown={() => setCaseModalOpen(false)}>
      <div className="ncm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ncm-head">
          <span className="ncm-head-title">新建判例</span>
          <button className="ncm-close" onClick={() => setCaseModalOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="ncm-body">

        {sourceTrade && (
          <div className="ncm-source">
            <div className="ncm-source-main">
              <span className="ncm-source-ref">{sourceTrade.ref}</span>
              <span className="ncm-source-symbol">{sourceTrade.symbol}</span>
              <span className="ncm-source-side">
                {sourceTrade.side === 'long' ? '做多' : '做空'}
              </span>
            </div>
            <div className="ncm-source-meta">
              <span>{sourceStrategy?.name ?? '未设置策略'}</span>
              <span>{STATUS_META[sourceTrade.status].label}</span>
              <span>{TRADE_KIND_META[sourceTrade.tradeKind].label}</span>
              <span>复盘 {REVIEW_STATUS_META[sourceTrade.reviewStatus].label}</span>
            </div>
          </div>
        )}

        <div className="ncm-field">
          <span className="ncm-label">纠纷类型</span>
          <Select
            className="ncm-select"
            value={disputeTypeId}
            ariaLabel="纠纷类型"
            onValueChange={(value) => {
              setDisputeTypeId(value)
              const selected = disputeTypes.find((d) => d.id === value)
              if (selected) setVerdict(selected.options[0])
            }}
            options={disputeTypes.map((disputeType) => ({
              value: disputeType.id,
              label: disputeType.name,
            }))}
          />
        </div>

        <div className="ncm-field">
          <span className="ncm-label">初始裁决</span>
          <div className="ncm-btn-group">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={'ncm-btn' + (verdict === opt ? ' is-on' : '')}
                onClick={() => setVerdict(opt)}
              >
                {opt}
              </button>
            ))}
            <button
              type="button"
              className={'ncm-btn' + (verdict === '暂不确定' ? ' is-on' : '')}
              onClick={() => setVerdict('暂不确定')}
            >
              暂不确定
            </button>
          </div>
        </div>

        <div className="ncm-field">
          <span className="ncm-label">信心度</span>
          <div className="ncm-btn-group">
            {([30, 50, 70, 90] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={'ncm-btn' + (confidence === c ? ' is-on' : '')}
                onClick={() => setConfidence(c)}
              >
                {c}%
              </button>
            ))}
          </div>
        </div>

        <div className="ncm-field">
          <span className="ncm-label">判断依据</span>
          <textarea
            className="ncm-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="记录为什么这样裁决，后续复盘时可以继续修正…"
            rows={sourceTrade ? 5 : 4}
          />
          <span className="ncm-field-hint">建议写清触发条件、反证点和需要复看的截图位置。</span>
        </div>

        {/* Image drop zone */}
        <div className="ncm-field">
          <span className="ncm-label">截图</span>
          <div
            ref={dropRef}
            className="ncm-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {images.length === 0 ? (
              <div className="ncm-drop-hint">
                <Image size={20} />
                <span>粘贴或拖入截图 (Ctrl+V)</span>
              </div>
            ) : (
              <div className="ncm-images">
                {images.map((img, i) => (
                  <div className="ncm-thumb" key={i}>
                    <img src={img.previewUrl} alt={`截图 ${i + 1}`} />
                    <Tooltip content="移除" label={`移除截图 ${i + 1}`}>
                      <button
                        className="ncm-thumb-remove"
                        aria-label={`移除截图 ${i + 1}`}
                        onClick={() => removeImage(i)}
                      >
                        <X size={12} />
                      </button>
                    </Tooltip>
                  </div>
                ))}
                <div className="ncm-drop-more" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
                  <span>+</span>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>

        <div className="ncm-foot">
          <button className="ncm-cancel" onClick={() => setCaseModalOpen(false)}>取消</button>
          <button className="ncm-submit" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '创建判例'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function buildSourceNote(
  trade: Trade | undefined,
  strategyName: string | undefined,
): string {
  if (!trade) return ''
  const lines = [
    `来源交易：${trade.ref} · ${trade.symbol} · ${trade.side === 'long' ? '做多' : '做空'}`,
    `策略：${strategyName ?? '未设置策略'}；状态：${STATUS_META[trade.status].label}；复盘：${REVIEW_STATUS_META[trade.reviewStatus].label}`,
  ]
  if (trade.tags.length) lines.push(`交易标签：${trade.tags.join(' / ')}`)
  if (trade.mistakeTags.length) lines.push(`错误 / 违规：${trade.mistakeTags.join(' / ')}`)
  lines.push('争议点：')
  lines.push('反证点：')
  return lines.join('\n')
}
