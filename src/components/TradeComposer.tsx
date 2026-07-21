import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, X } from '@/icons/appIcons'
import { Select } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
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
import { collectSymbolOptions } from '@/lib/symbolIcons'
import {
  SESSION_PRESETS,
  getSessionSelectValue,
  normalizeSession,
} from '@/lib/tradeView'
import { tradeDetailPath } from '@/lib/tradeRoute'
import { defaultTradeKindForPath } from '@/lib/tradeKind'
import { prepareExistingComposerTrade } from '@/lib/tradeComposerSave'
import { formatYmd, getTradingDayKey } from '@/lib/periods'
import { assetUrl, getStorage } from '@/storage'
import { trackPendingStorageOperation } from '@/storage/pendingOperations'
import { MAX_WEB_JOURNAL_ENTRY_BYTES } from '@/lib/webJournalArchiveContract'
import { toast } from '@/lib/toast'
import { useExitClone } from '@/components/ui/useExitClone'
import { Button } from '@/components/ui/Button'
import { useShortcutStore } from '@/store/shortcutStore'
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
  const requestedKind = useStore((s) => s.composerKind)
  const trades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const symbolCatalog = useStore((s) => s.symbolCatalog)
  const symbolIcons = useStore((s) => s.symbolIcons)
  const upsert = useStore((s) => s.upsertTrade)
  const close = useStore((s) => s.closeComposer)
  const tradingDayStartHour = useStore((s) => s.display.tradingDayStartHour)

  const symbolOptions = useMemo(
    () => collectSymbolOptions(symbolCatalog, [], editing?.symbol ? [editing.symbol] : []),
    [symbolCatalog, editing?.symbol],
  )
  const defaultSymbol = symbolOptions[0] ?? ''
  const defaultTradingDay = () => getTradingDayKey(new Date(), tradingDayStartHour)

  const [symbol, setSymbol] = useState(defaultSymbol)
  const [side, setSide] = useState<TradeSide>('long')
  const [timeframe, setTimeframe] = useState<string>(DEFAULT_TIMEFRAME)
  const [session, setSession] = useState('')
  const [openedAt, setOpenedAt] = useState(() =>
    getTradingDayKey(new Date(), useStore.getState().display.tradingDayStartHour),
  )
  const [strategyId, setStrategyId] = useState('')
  const [caseType, setCaseType] = useState<CaseType>('exemplar')
  const [images, setImages] = useState<UploadedImage[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const exitRef = useExitClone<HTMLDivElement>(open)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const submittingRef = useRef(false)
  const defaultKind = defaultTradeKindForPath(location.pathname)
  const activeKind = editing?.tradeKind ?? requestedKind ?? defaultKind
  const recordLabel = activeKind === 'case' ? '案例记录' : '交易'

  useEffect(() => {
    if (submitting) dialogRef.current?.setAttribute('inert', '')
    else dialogRef.current?.removeAttribute('inert')
  }, [submitting])

  useEffect(() => {
    if (!open) return
    useShortcutStore.getState().acquireModalOverlay()
    return () => useShortcutStore.getState().releaseModalOverlay()
  }, [open])

  useEffect(() => {
    if (!open) return
    setSymbol(editing?.symbol ?? defaultSymbol)
    setSide(editing?.side ?? 'long')
    setTimeframe(resolveTimeframe(editing?.timeframe))
    setSession(editing ? getSessionSelectValue(editing) : '')
    setOpenedAt(editing?.openedAt.slice(0, 10) ?? defaultTradingDay())
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
  }, [open, editing, strategies, defaultSymbol, tradingDayStartHour])

  // 重置状态
  useEffect(() => {
    if (!open) {
      images.forEach((img) => URL.revokeObjectURL(img.preview))
      setSymbol(defaultSymbol)
      setSide('long')
      setTimeframe(DEFAULT_TIMEFRAME)
      setSession('')
      setOpenedAt(defaultTradingDay())
      setStrategyId('')
      setCaseType('exemplar')
      setImages([])
      setIsDragging(false)
    }
  }, [open, defaultSymbol, tradingDayStartHour])

  // 处理粘贴图片
  useEffect(() => {
    if (!open) return

    const handlePaste = async (e: ClipboardEvent) => {
      if (submittingRef.current) return
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
    if (submittingRef.current) return
    if (file.size > MAX_WEB_JOURNAL_ENTRY_BYTES) {
      toast('单张原图超过 32 MB，无法加入交易库；请缩小图片后重试')
      return
    }
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
    if (submittingRef.current) return

    const files = e.dataTransfer.files
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        await addImage(file)
      }
    }
  }

  // 快速创建
  const saveImagesForNote = async (): Promise<string> => {
    if (images.length === 0) return ''

    const storage = getStorage()
    const imgTags: string[] = []
    for (const img of images) {
      const assetId = await storage.saveAsset(img.file, img.file.type || 'image/png')
      imgTags.push(`<img src="${assetUrl(assetId)}" />`)
    }

    const intro = editing
      ? ''
      : `<p>已上传 ${images.length} 张截图，请在下方补充详细信息。</p>`
    return [intro, imgTags.join('\n')].filter(Boolean).join('\n')
  }

  const handleQuickCreate = () => {
    if (submittingRef.current) return
    if (!symbol.trim()) {
      toast('请先选择交易品种')
      return
    }
    submittingRef.current = true
    setSubmitting(true)

    const operation = (async () => {
      const kind = activeKind
      const nextReview = new Date()
      nextReview.setDate(nextReview.getDate() + 3)
      const legacyReviewCategory: Trade['reviewCategory'] =
        caseType === 'mistake' ? 'mistake' : caseType === 'ambiguous' ? 'ambiguous' : 'normal'

      const fields = {
        symbol: symbol.trim().toUpperCase(),
        side,
        timeframe: resolveTimeframe(timeframe),
        session: normalizeSession(session),
        strategyId,
        openedAt,
        ...(kind === 'case' ? { caseType, reviewCategory: legacyReviewCategory } : {}),
      }
      const trade = editing
        ? await prepareExistingComposerTrade({
            id: editing.id,
            fields,
            saveImages: saveImagesForNote,
            getLatest: (id) => useStore.getState().trades.find((item) => item.id === id),
          })
        : {
            id: crypto.randomUUID(),
            ref: getNextRef(trades, kind),
            status: 'planned',
            conviction: 'medium',
            tradeKind: kind,
            tags: [],
            mistakeTags: [],
            reviewStatus: 'unreviewed',
            reviewCategory: kind === 'case' ? legacyReviewCategory : 'normal',
            ...(kind === 'case'
              ? {
                  caseType,
                  masteryState: 'new' as const,
                  nextReviewAt: formatYmd(nextReview),
                }
              : {}),
            entry: 0,
            exit: null,
            stopLoss: null,
            size: 0,
            pnl: null,
            rMultiple: null,
            recordedAt: new Date().toISOString(),
            closedAt: null,
            note: await saveImagesForNote(),
            ...fields,
          } satisfies Trade

      if (!trade) {
        toast(`该${recordLabel}已不存在，未保存本次修改`)
        close()
        return
      }

      upsert(trade)
      close()

      // 自动跳转详情页
      navigate(tradeDetailPath(trade))
    })().finally(() => {
      submittingRef.current = false
      setSubmitting(false)
    })
    return trackPendingStorageOperation(operation)
  }

  const requestClose = () => {
    if (!submittingRef.current) close()
  }

  if (!open) return null

  return createPortal(
    <div ref={exitRef} className="composer-overlay" role="presentation" onMouseDown={requestClose}>
      <div
        ref={dialogRef}
        className="composer-modal composer-quick"
        role="dialog"
        aria-modal="true"
        aria-busy={submitting}
        aria-labelledby="trade-composer-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.stopPropagation()
            requestClose()
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
          <button type="button" className="composer-close" onClick={requestClose} aria-label="关闭" disabled={submitting}>
            <X size={18} />
          </button>
        </div>

        <div className="composer-body-quick">
          <section className="composer-hero" aria-label={`${recordLabel}身份`}>
            <div className="composer-field-quick">
              <label>品种</label>
              <Select
                value={symbol}
                onValueChange={setSymbol}
                ariaLabel={`${recordLabel}品种`}
                className="composer-input-quick composer-input-symbol"
                options={symbolOptions.map((preset) => ({
                  value: preset,
                  label:
                    editing &&
                    editing.symbol === preset &&
                    !symbolCatalog.includes(preset)
                      ? `${preset}（历史）`
                      : preset,
                  icon: <SymbolIcon symbol={preset} overrides={symbolIcons} size={22} />,
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

          <div className="composer-parameter-grid">
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
            <div className="composer-essential-field">
              <span className="composer-essential-label">交易日期</span>
              <DatePicker
                value={openedAt}
                onValueChange={setOpenedAt}
                ariaLabel="交易日期"
                required
              />
            </div>
          </div>

          <div className={`composer-archive-row${activeKind === 'case' ? ' is-case' : ''}`}>
            <div className="composer-essential-field">
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

          <div className="composer-media">
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
              className={`composer-drop-zone${isDragging ? ' is-dragging' : ''}`}
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
              aria-label="拖入或粘贴图表截图"
            >
              <span className="composer-drop-zone-icon" aria-hidden>
                <Plus size={20} />
              </span>
              <span>
                {images.length > 0
                  ? `已添加 ${images.length} 张，继续拖入或粘贴`
                  : '拖入或粘贴图表截图'}
              </span>
            </div>
            {images.length > 0 && (
              <div className="composer-images-preview">
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
        </div>

        <div className="composer-footer-quick">
          {!editing && (
            <span className="composer-footer-hint">
              状态默认「计划中」，价格与仓位可稍后在详情补充
            </span>
          )}
          <div className="composer-footer-actions">
            <Button variant="bordered" size="lg" onClick={requestClose} disabled={submitting}>
              取消
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="composer-btn-primary"
              onClick={handleQuickCreate}
              disabled={!symbol.trim() || submitting}
            >
              {submitting ? '保存中…' : editing ? '保存' : `创建${recordLabel}`}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
