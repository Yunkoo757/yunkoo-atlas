import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { X, ImagePlus } from '@/icons/appIcons'
import { Select } from '@/components/ui/Select'
import { SymbolIcon } from '@/components/SymbolIcon'
import { useStore } from '@/store/useStore'
import {
  CASE_TYPE_META,
  TIMEFRAME_PRESETS,
  TRADE_KIND_META,
  DEFAULT_TIMEFRAME,
  resolveTimeframe,
  type CaseType,
  type Trade,
  type TradeKind,
  type TradeSide,
} from '@/data/trades'
import { collectSymbolOptions, DEFAULT_SYMBOL_CATALOG } from '@/lib/symbolIcons'
import {
  SESSION_PRESETS,
  getSessionSelectValue,
  normalizeSession,
} from '@/lib/tradeView'
import { tradeDetailPath } from '@/lib/tradeRoute'
import { defaultTradeKindForPath } from '@/lib/tradeKind'
import { formatYmd } from '@/lib/periods'
import { assetUrl, getStorage } from '@/storage'
import './TradeComposer.css'

const CASE_TYPES: CaseType[] = ['exemplar', 'mistake', 'ambiguous', 'missed']

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
  const symbolCatalog = useStore((s) => s.symbolCatalog)
  const symbolIcons = useStore((s) => s.symbolIcons)
  const upsert = useStore((s) => s.upsertTrade)
  const close = useStore((s) => s.closeComposer)

  const symbolOptions = useMemo(
    () => collectSymbolOptions(symbolCatalog, [], editing?.symbol ? [editing.symbol] : []),
    [symbolCatalog, editing?.symbol],
  )
  const defaultSymbol = symbolOptions[0] ?? DEFAULT_SYMBOL_CATALOG[0]

  const [symbol, setSymbol] = useState(defaultSymbol)
  const [side, setSide] = useState<TradeSide>('long')
  const [timeframe, setTimeframe] = useState<string>(DEFAULT_TIMEFRAME)
  const [session, setSession] = useState('')
  const [openedAt, setOpenedAt] = useState(() => formatYmd(new Date()))
  const [strategyId, setStrategyId] = useState('')
  const [caseType, setCaseType] = useState<CaseType>('exemplar')
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
    setSymbol(editing?.symbol ?? defaultSymbol)
    setSide(editing?.side ?? 'long')
    setTimeframe(resolveTimeframe(editing?.timeframe))
    setSession(editing ? getSessionSelectValue(editing) : '')
    setOpenedAt(editing?.openedAt.slice(0, 10) ?? formatYmd(new Date()))
    setStrategyId(editing?.strategyId ?? strategies[0]?.id ?? '')
    setCaseType(
      editing?.caseType ??
        (editing?.status === 'missed'
          ? 'missed'
          : editing?.reviewCategory === 'mistake'
            ? 'mistake'
            : editing?.reviewCategory === 'ambiguous'
              ? 'ambiguous'
              : 'exemplar'),
    )
  }, [open, editing, strategies, defaultSymbol])

  // 重置状态
  useEffect(() => {
    if (!open) {
      images.forEach((img) => URL.revokeObjectURL(img.preview))
      setSymbol(defaultSymbol)
      setSide('long')
      setTimeframe(DEFAULT_TIMEFRAME)
      setSession('')
      setOpenedAt(formatYmd(new Date()))
      setStrategyId('')
      setCaseType('exemplar')
      setImages([])
      setIsDragging(false)
    }
  }, [open, defaultSymbol])

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
    const nextReview = new Date()
    nextReview.setDate(nextReview.getDate() + 3)
    const legacyReviewCategory =
      caseType === 'mistake' ? 'mistake' : caseType === 'ambiguous' ? 'ambiguous' : 'normal'

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
        reviewCategory: kind === 'case' ? legacyReviewCategory : 'normal',
        ...(kind === 'case'
          ? {
              caseType,
              masteryState: 'new' as const,
              nextReviewAt: nextReview.toISOString().slice(0, 10),
            }
          : {}),
        entry: 0,
        exit: null,
        stopLoss: null,
        size: 0,
        pnl: null,
        rMultiple: null,
        openedAt,
        recordedAt: new Date().toISOString(),
        closedAt: null,
        note: '',
      }),
      symbol: symbol.trim().toUpperCase(),
      side,
      timeframe: resolveTimeframe(timeframe),
      session: normalizeSession(session),
      strategyId,
      openedAt,
      note,
      reviewCategory:
        kind === 'case' ? legacyReviewCategory : editing?.reviewCategory ?? 'normal',
      ...(kind === 'case' ? { caseType } : {}),
    }

    upsert(trade)
    close()

    // 自动跳转详情页
    navigate(tradeDetailPath(trade))
  }

  if (!open) return null

  return createPortal(
    <div className="composer-overlay" role="presentation" onMouseDown={close}>
      <div
        className="composer-modal composer-quick"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-composer-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.stopPropagation()
            close()
            return
          }
          if (event.key !== 'Tab') return

          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), [role="button"][tabindex="0"]',
            ),
          ).filter((element) => element.offsetParent !== null)
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (!first || !last) return

          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div className="composer-header">
          <h3 id="trade-composer-title">
            {editing ? `编辑${TRADE_KIND_META[editing.tradeKind].label}` : `新建${recordLabel}`}
          </h3>
          <button className="composer-close" onClick={close} aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="composer-body-quick">
          <section className="composer-identity" aria-label={`${recordLabel}身份`}>
            <div className="composer-field-quick">
              <label>{recordLabel}品种</label>
              <Select
                ref={inputRef}
                value={symbol}
                onValueChange={setSymbol}
                ariaLabel={`${recordLabel}品种`}
                className="composer-input-quick"
                options={symbolOptions.map((preset) => ({
                  value: preset,
                  label:
                    editing &&
                    editing.symbol === preset &&
                    !symbolCatalog.includes(preset)
                      ? `${preset}（历史）`
                      : preset,
                  icon: <SymbolIcon symbol={preset} overrides={symbolIcons} size={14} />,
                }))}
              />
            </div>
            <div className="composer-essential-field">
              <span className="composer-essential-label">方向</span>
              <div className="composer-side-control" role="group" aria-label="交易方向">
                <button
                  type="button"
                  className={`is-long${side === 'long' ? ' is-on' : ''}`}
                  aria-pressed={side === 'long'}
                  onClick={() => setSide('long')}
                >
                  做多
                </button>
                <button
                  type="button"
                  className={`is-short${side === 'short' ? ' is-on' : ''}`}
                  aria-pressed={side === 'short'}
                  onClick={() => setSide('short')}
                >
                  做空
                </button>
              </div>
            </div>
          </section>

          <section className="composer-attributes-section" aria-labelledby="composer-parameters-title">
            <h4 id="composer-parameters-title">交易参数</h4>
            <div className="composer-trade-essentials composer-parameter-grid">
              <div className="composer-essential-field">
                <span className="composer-essential-label">波段级别</span>
                <Select
                  value={timeframe || DEFAULT_TIMEFRAME}
                  onValueChange={setTimeframe}
                  ariaLabel="参与波段级别"
                  options={TIMEFRAME_PRESETS.map((preset) => ({
                    value: preset,
                    label: preset,
                  }))}
                />
              </div>
              <div className="composer-essential-field">
                <span className="composer-essential-label">交易时段</span>
                <Select
                  value={session}
                  onValueChange={setSession}
                  ariaLabel="交易时段"
                  placeholder="未设置"
                  options={[
                    { value: '', label: '未设置' },
                    ...SESSION_PRESETS.map((preset) => ({
                      value: preset.value,
                      label: preset.label,
                    })),
                  ]}
                />
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
            </div>
          </section>

          <section className="composer-attributes-section" aria-labelledby="composer-archive-title">
            <h4 id="composer-archive-title">归档信息</h4>
            <div className={`composer-trade-essentials${activeKind === 'case' ? ' composer-archive-grid' : ''}`}>
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
              {activeKind === 'case' && (
                <div className="composer-essential-field">
                  <span className="composer-essential-label">案例类型</span>
                  <Select
                    value={caseType}
                    onValueChange={(value) => setCaseType(value as CaseType)}
                    ariaLabel="案例类型"
                    options={CASE_TYPES.map((value) => ({
                      value,
                      label: CASE_TYPE_META[value].label,
                    }))}
                  />
                </div>
              )}
            </div>
          </section>

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
