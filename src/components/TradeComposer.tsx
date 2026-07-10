import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { X, ImagePlus } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { useStore } from '@/store/useStore'
import {
  REVIEW_CATEGORY_META,
  TRADE_KIND_META,
  type ReviewCategory,
  type Trade,
  type TradeKind,
  type TradeSide,
} from '@/data/trades'
import { tradeDetailPath } from '@/lib/tradeRoute'
import { defaultTradeKindForPath } from '@/lib/tradeKind'
import { assetUrl, getStorage } from '@/storage'
import './TradeComposer.css'

const SYMBOL_PRESETS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'BTCUSDT', 'ETHUSDT']
const QUICK_CATEGORIES: ReviewCategory[] = ['normal', 'mistake', 'focus', 'ambiguous', 'recheck', 'mastered']

interface UploadedImage {
  id: string
  file: File
  preview: string
}

function getNextRef(trades: Trade[], kind: TradeKind): string {
  const prefix = kind === 'case' ? 'CAS' : 'TRD'
  const maxNum = trades.reduce((max, t) => {
    const match = t.ref.match(new RegExp(`^${prefix}-(\\d+)$`))
    return match ? Math.max(max, parseInt(match[1], 10)) : max
  }, 0)
  return `${prefix}-${maxNum + 1}`
}

export function TradeComposer() {
  const navigate = useNavigate()
  const location = useLocation()
  const open = useStore((s) => s.composerOpen)
  const editing = useStore((s) => s.composerTrade)
  const trades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const upsert = useStore((s) => s.upsertTrade)
  const close = useStore((s) => s.closeComposer)

  const [symbol, setSymbol] = useState(SYMBOL_PRESETS[0])
  const [side, setSide] = useState<TradeSide>('long')
  const [openedAt, setOpenedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [strategyId, setStrategyId] = useState('')
  const [reviewCategory, setReviewCategory] = useState<ReviewCategory>('normal')
  const [images, setImages] = useState<UploadedImage[]>([])
  const [isDragging, setIsDragging] = useState(false)

  const inputRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const defaultKind = defaultTradeKindForPath(location.pathname)
  const activeKind = editing?.tradeKind ?? defaultKind
  const recordLabel = activeKind === 'case' ? '案例记录' : '交易'

  // 自动聚焦
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setSymbol(editing?.symbol ?? SYMBOL_PRESETS[0])
    setSide(editing?.side ?? 'long')
    setOpenedAt(editing?.openedAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10))
    setStrategyId(editing?.strategyId ?? strategies[0]?.id ?? '')
    setReviewCategory(editing?.reviewCategory ?? 'normal')
  }, [open, editing, strategies])

  // 重置状态
  useEffect(() => {
    if (!open) {
      images.forEach((img) => URL.revokeObjectURL(img.preview))
      setSymbol(SYMBOL_PRESETS[0])
      setSide('long')
      setOpenedAt(new Date().toISOString().slice(0, 10))
      setStrategyId('')
      setReviewCategory('normal')
      setImages([])
      setIsDragging(false)
    }
  }, [open])

  // 处理粘贴图片
  useEffect(() => {
    if (!open) return

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) {
            await addImage(file)
          }
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [open])

  // 添加图片
  const addImage = async (file: File) => {
    const id = crypto.randomUUID()
    const preview = URL.createObjectURL(file)
    setImages((prev) => [...prev, { id, file, preview }])
  }

  // 删除图片
  const removeImage = (id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id)
      if (img) URL.revokeObjectURL(img.preview)
      return prev.filter((i) => i.id !== id)
    })
  }

  // 处理拖拽
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = e.dataTransfer.files
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        await addImage(file)
      }
    }
  }

  // 快速创建
  const saveImagesToNote = async (baseNote: string): Promise<string> => {
    if (images.length === 0) return baseNote

    const storage = getStorage()
    const imgTags: string[] = []
    for (const img of images) {
      const assetId = await storage.saveAsset(img.file, img.file.type || 'image/png')
      imgTags.push(`<img src="${assetUrl(assetId)}" />`)
    }

    const intro = editing
      ? ''
      : `<p>已上传 ${images.length} 张截图，请在下方补充详细信息。</p>`
    return [baseNote, intro, imgTags.join('\n')].filter(Boolean).join('\n')
  }

  const handleQuickCreate = async () => {
    if (!symbol.trim()) {
      alert('请输入交易品种')
      return
    }

    const kind = activeKind
    const note = await saveImagesToNote(editing?.note ?? '')

    const trade: Trade = {
      ...(editing ?? {
        id: crypto.randomUUID(),
        ref: getNextRef(trades, kind),
        side,
        status: 'planned',
        conviction: 'medium',
        strategyId,
        tradeKind: kind,
        tags: [],
        mistakeTags: [],
        reviewStatus: 'unreviewed',
        reviewCategory,
        entry: 0,
        exit: null,
        stopLoss: null,
        size: 0,
        pnl: 0,
        rMultiple: 0,
        openedAt,
        recordedAt: new Date().toISOString(),
        closedAt: null,
        note: '',
      }),
      symbol: symbol.trim().toUpperCase(),
      side,
      strategyId,
      openedAt,
      note,
      reviewCategory,
    }

    upsert(trade)
    close()

    // 自动跳转详情页
    navigate(tradeDetailPath(trade))
  }

  if (!open) return null

  return createPortal(
    <div className="composer-overlay" onMouseDown={close}>
      <div className="composer-modal composer-quick" onMouseDown={(e) => e.stopPropagation()}>
        <div className="composer-header">
          <h3>{editing ? `编辑${TRADE_KIND_META[editing.tradeKind].label}` : `新建${recordLabel}`}</h3>
          <button className="composer-close" onClick={close} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="composer-body-quick">
          <div className="composer-field-quick">
            <label>{recordLabel}品种</label>
            <Select
              ref={inputRef}
              value={symbol}
              onValueChange={setSymbol}
              ariaLabel={`${recordLabel}品种`}
              className="composer-input-quick"
              options={[
                ...(editing && !SYMBOL_PRESETS.includes(editing.symbol)
                  ? [{ value: editing.symbol, label: `${editing.symbol}（历史）` }]
                  : []),
                ...SYMBOL_PRESETS.map((preset) => ({ value: preset, label: preset })),
              ]}
            />
          </div>

          <div className="composer-trade-essentials">
            <div className="composer-essential-field">
              <span className="composer-essential-label">方向</span>
              <div className="composer-side-control" role="group" aria-label="交易方向">
                <button
                  type="button"
                  className={side === 'long' ? 'is-on' : ''}
                  aria-pressed={side === 'long'}
                  onClick={() => setSide('long')}
                >
                  做多
                </button>
                <button
                  type="button"
                  className={side === 'short' ? 'is-on' : ''}
                  aria-pressed={side === 'short'}
                  onClick={() => setSide('short')}
                >
                  做空
                </button>
              </div>
            </div>
            <label className="composer-essential-field">
              <span className="composer-essential-label">交易日期</span>
              <input
                type="date"
                value={openedAt}
                onChange={(event) => setOpenedAt(event.target.value)}
                aria-label="交易日期"
              />
            </label>
            <div className="composer-essential-field composer-essential-strategy">
              <span className="composer-essential-label">策略</span>
              <Select
                value={strategyId}
                onValueChange={setStrategyId}
                ariaLabel="交易策略"
                options={
                  strategies.length === 0
                    ? [{ value: '', label: '未设置' }]
                    : strategies.map((strategy) => ({
                        value: strategy.id,
                        label: strategy.name,
                      }))
                }
              />
            </div>
            <div className="composer-essential-field">
              <span className="composer-essential-label">复盘分类</span>
              <Select
                value={reviewCategory}
                onValueChange={(value) => setReviewCategory(value as ReviewCategory)}
                ariaLabel="复盘分类"
                options={QUICK_CATEGORIES.map((category) => ({
                  value: category,
                  label: REVIEW_CATEGORY_META[category].label,
                }))}
              />
            </div>
          </div>

          {images.length > 0 && (
            <div className="composer-images-preview composer-images-preview-body">
              {images.map((img) => (
                <div key={img.id} className="composer-image-thumb">
                  <img src={img.preview} alt="预览" />
                  <button
                    type="button"
                    className="composer-image-remove"
                    onClick={() => removeImage(img.id)}
                    aria-label="删除图片"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="composer-footer-quick">
          <div className="composer-attachments">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={async (event) => {
                for (const file of Array.from(event.target.files ?? [])) await addImage(file)
                event.target.value = ''
              }}
            />
            <div
              ref={dropZoneRef}
              className={`composer-drop-zone ${isDragging ? 'is-dragging' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              aria-label="添加截图"
            >
              <ImagePlus size={14} />
              <span>{images.length > 0 ? `${images.length} 张截图` : '添加截图'}</span>
            </div>
          </div>
          <div className="composer-footer-actions">
            <button className="composer-btn-secondary" onClick={close}>
              取消
            </button>
            <button
              className="composer-btn-primary"
              onClick={handleQuickCreate}
              disabled={!symbol.trim()}
            >
              {editing ? '保存' : `创建${recordLabel}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
