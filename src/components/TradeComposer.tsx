import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { X, Image as ImageIcon } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { TRADE_KIND_META, type Trade, type TradeKind } from '@/data/trades'
import { tradeDetailPath } from '@/lib/tradeRoute'
import { assetUrl, getStorage } from '@/storage'
import './TradeComposer.css'

const SYMBOL_PRESETS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AAPL', 'TSLA']

interface UploadedImage {
  id: string
  file: File
  preview: string
}

function defaultKindFromPath(pathname: string): TradeKind {
  if (pathname.startsWith('/review-cases')) {
    return 'case'
  }
  if (
    pathname.startsWith('/sim') ||
    pathname.startsWith('/paper') ||
    pathname.startsWith('/practice')
  ) {
    return 'paper'
  }
  return 'live'
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

  const [symbol, setSymbol] = useState('')
  const [images, setImages] = useState<UploadedImage[]>([])
  const [isDragging, setIsDragging] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const defaultKind = defaultKindFromPath(location.pathname)
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
    setSymbol(editing?.symbol ?? '')
  }, [open, editing])

  // 重置状态
  useEffect(() => {
    if (!open) {
      images.forEach((img) => URL.revokeObjectURL(img.preview))
      setSymbol('')
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

    const kind = defaultKind
    const strategyId = strategies.length > 0 ? strategies[0].id : ''
    const note = await saveImagesToNote(editing?.note ?? '')

    const trade: Trade = {
      ...(editing ?? {
        id: crypto.randomUUID(),
        ref: getNextRef(trades, kind),
        side: 'long',
        status: 'planned',
        conviction: 'medium',
        strategyId,
        tradeKind: kind,
        tags: [],
        mistakeTags: [],
        reviewStatus: 'unreviewed',
        entry: 0,
        exit: null,
        stopLoss: null,
        size: 0,
        pnl: 0,
        rMultiple: 0,
        openedAt: new Date().toISOString().slice(0, 10),
        closedAt: null,
        note: '',
      }),
      symbol: symbol.trim().toUpperCase(),
      note,
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
          <h3>{editing ? `编辑${TRADE_KIND_META[editing.tradeKind].label}` : `快速记录${recordLabel}`}</h3>
          <button className="composer-close" onClick={close} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="composer-body-quick">
          {/* 图片上传区域 */}
          <div
            ref={dropZoneRef}
            className={`composer-drop-zone ${isDragging ? 'is-dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <ImageIcon size={32} className="composer-drop-icon" />
            <div className="composer-drop-text">
              <strong>拖拽或粘贴截图</strong>
              <span>支持 Ctrl+V 粘贴多张图片</span>
            </div>
          </div>

          {/* 图片预览 */}
          {images.length > 0 && (
            <div className="composer-images-preview">
              {images.map((img) => (
                <div key={img.id} className="composer-image-thumb">
                  <img src={img.preview} alt="预览" />
                  <button
                    className="composer-image-remove"
                    onClick={() => removeImage(img.id)}
                    aria-label="删除图片"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 标的输入 */}
          <div className="composer-field-quick">
            <label>{recordLabel}品种</label>
            <input
              ref={inputRef}
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleQuickCreate()
                }
              }}
              placeholder="如: BTCUSDT, AAPL, EURUSD..."
              list="symbol-presets"
              className="composer-input-quick"
            />
            <datalist id="symbol-presets">
              {SYMBOL_PRESETS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="composer-footer-quick">
          <button className="composer-btn-secondary" onClick={close}>
            取消
          </button>
          <button
            className="composer-btn-primary"
            onClick={handleQuickCreate}
            disabled={!symbol.trim()}
          >
            {editing ? '保存' : `快速创建${recordLabel}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
