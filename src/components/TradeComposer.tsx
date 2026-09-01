import { ICON_2XL, ICON_SM, ICON_XL } from '@/icons/iconSize'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Plus, X } from '@/icons/appIcons'
import { Select } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { SymbolIcon } from '@/components/SymbolIcon'
import { currentLiveStageIdForWrite, useStore } from '@/store/useStore'
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
  type TradeStatus,
} from '@/data/trades'
import { collectSymbolOptions } from '@/lib/symbolIcons'
import {
  SESSION_PRESETS,
  getSessionSelectValue,
  normalizeSession,
} from '@/lib/tradeView'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { defaultTradeKindForPath } from '@/lib/tradeKind'
import { applyCaseClassificationMutation } from '@/lib/reviewCaseClassification'
import { commitComposerTradeBatch } from '@/lib/tradeComposerCommit'
import { addDaysToCurrentTradingDay, getTradingDayKey } from '@/lib/periods'
import { trackPendingStorageOperation } from '@/storage/pendingOperations'
import { MAX_WEB_JOURNAL_ENTRY_BYTES } from '@/lib/webJournalArchiveContract'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { ModalShell } from '@/components/ui/ModalShell'
import './TradeComposer.css'

const CASE_TYPES: CaseType[] = ['exemplar', 'mistake', 'ambiguous', 'missed']

interface UploadedImage {
  id: string
  file: File
  preview: string
}

function composerSnapshot(input: {
  symbol: string
  side: TradeSide
  timeframe: string
  session: string
  openedAt: string
  strategyId: string
  kind: TradeKind
  status: Extract<TradeStatus, 'planned' | 'missed'>
  entry: string
  size: string
  stopLoss: string
  quickText: string
  caseType: CaseType
  imageIds: string[]
}): string {
  return JSON.stringify(input)
}

function textToNoteHtml(value: string): string {
  const escaped = value.trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  return escaped ? `<p>${escaped.replace(/\n/g, '<br>')}</p>` : ''
}

function optionalNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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
  const strategies = useStore((s) => s.strategies)
  const symbolCatalog = useStore((s) => s.symbolCatalog)
  const symbolIcons = useStore((s) => s.symbolIcons)
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
  const [kind, setKind] = useState<TradeKind>('live')
  const [status, setStatus] = useState<Extract<TradeStatus, 'planned' | 'missed'>>('planned')
  const [entry, setEntry] = useState('')
  const [size, setSize] = useState('')
  const [stopLoss, setStopLoss] = useState('')
  const [quickText, setQuickText] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [caseType, setCaseType] = useState<CaseType>('exemplar')
  const [images, setImages] = useState<UploadedImage[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const submittingRef = useRef(false)
  const caseTypeDirtyRef = useRef(false)
  const baselineRef = useRef('')
  const defaultKind = defaultTradeKindForPath(location.pathname)
  const activeKind = editing?.tradeKind ?? kind
  const recordLabel = activeKind === 'case' ? '案例' : '交易'
  const isNew = !editing
  const isTradeQuickNew = isNew && activeKind !== 'case'

  useEffect(() => {
    if (!open) return
    caseTypeDirtyRef.current = false
  }, [open])

  useEffect(() => {
    if (!open) return
    const nextSymbol = editing?.symbol ?? defaultSymbol
    const nextSide = editing?.side ?? 'long'
    const nextTimeframe = resolveTimeframe(editing?.timeframe)
    const nextSession = editing ? getSessionSelectValue(editing) : ''
    const nextOpenedAt = editing?.openedAt.slice(0, 10) ?? defaultTradingDay()
    const nextStrategyId = editing?.strategyId ?? strategies[0]?.id ?? ''
    const nextKind = editing?.tradeKind ?? requestedKind ?? defaultKind
    const nextStatus = editing?.status === 'missed' ? 'missed' : 'planned'
    const nextEntry = editing?.entry ? String(editing.entry) : ''
    const nextSize = editing?.size ? String(editing.size) : ''
    const nextStopLoss = editing?.stopLoss ? String(editing.stopLoss) : ''
    const nextCaseType = editing?.caseType ??
      (editing?.status === 'missed'
        ? 'missed'
        : editing?.reviewCategory === 'mistake'
          ? 'mistake'
          : editing?.reviewCategory === 'ambiguous'
            ? 'ambiguous'
            : 'exemplar')
    setSymbol(nextSymbol)
    setSide(nextSide)
    setTimeframe(nextTimeframe)
    setSession(nextSession)
    setOpenedAt(nextOpenedAt)
    setStrategyId(nextStrategyId)
    setKind(nextKind)
    setStatus(nextStatus)
    setEntry(nextEntry)
    setSize(nextSize)
    setStopLoss(nextStopLoss)
    setQuickText('')
    setShowMore(Boolean(editing))
    setCaseType(nextCaseType)
    setDiscardConfirmOpen(false)
    baselineRef.current = composerSnapshot({
      symbol: nextSymbol,
      side: nextSide,
      timeframe: nextTimeframe,
      session: nextSession,
      openedAt: nextOpenedAt,
      strategyId: nextStrategyId,
      kind: nextKind,
      status: nextStatus,
      entry: nextEntry,
      size: nextSize,
      stopLoss: nextStopLoss,
      quickText: '',
      caseType: nextCaseType,
      imageIds: [],
    })
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
      setKind('live')
      setStatus('planned')
      setEntry('')
      setSize('')
      setStopLoss('')
      setQuickText('')
      setShowMore(false)
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
      toast('单张原图超过 32 MB，无法加入资料库；请缩小图片后重试')
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
      const now = new Date()

      const fields = {
        symbol: symbol.trim().toUpperCase(),
        side,
        timeframe: resolveTimeframe(timeframe),
        session: normalizeSession(session),
        strategyId,
        openedAt,
        entry: Number(entry) || 0,
        size: Number(size) || 0,
        stopLoss: optionalNumber(stopLoss),
      }
      const newTradeId = crypto.randomUUID()
      const recordedAt = now.toISOString()
      const result = await commitComposerTradeBatch({
        targetTradeId: editing?.id ?? newTradeId,
        images: images.map((image) => ({
          file: image.file,
          mime: image.file.type || 'image/png',
        })),
        buildTrade: (state, imageHtml) => {
          const textHtml = textToNoteHtml(quickText)
          const appendedNote = [textHtml, imageHtml].filter(Boolean).join('\n')
          if (editing) {
            const latest = state.trades.find((item) => item.id === editing.id)
            if (!latest) return null
            const candidate: Trade = {
              ...latest,
              ...fields,
              note: [latest.note, appendedNote].filter(Boolean).join('\n'),
            }
            if (kind !== 'case') return candidate
            if (!caseTypeDirtyRef.current) return candidate
            const classified = applyCaseClassificationMutation(candidate, { caseType })
            return candidate.reviewCategory === 'focus' || candidate.reviewStatus === 'focus'
              ? { ...classified.trade, isFocusCase: true }
              : classified.trade
          }
          const candidate: Trade = {
            id: newTradeId,
            ref: getNextRef(state.trades, kind),
            status,
            conviction: 'medium',
            tradeKind: kind,
            ...(kind === 'paper'
              ? {}
              : { liveStageId: currentLiveStageIdForWrite(state) }),
            tags: [],
            mistakeTags: [],
            reviewStatus: 'unreviewed',
            reviewCategory: 'normal',
            ...(kind === 'case'
              ? {
                  masteryState: 'new' as const,
                  nextReviewAt: addDaysToCurrentTradingDay(now, tradingDayStartHour, 3),
                }
              : {}),
            exit: null,
            pnl: null,
            rMultiple: null,
            recordedAt,
            closedAt: null,
            note: appendedNote,
            ...fields,
          }
          return kind === 'case'
            ? applyCaseClassificationMutation(candidate, { caseType }).trade
            : candidate
        },
      })
      const trade = result.trade

      if (!trade) {
        toast(`该${recordLabel}已不存在，未保存本次修改`)
        close()
        return
      }

      close()
      if (!editing && trade.tradeKind === 'case') {
        navigate(tradeDetailPath(trade), {
          state: tradeDetailNavState({
            pathname: location.pathname,
            search: location.search,
          }),
        })
        toast('已创建案例')
        return
      }
      toast(editing ? '已保存' : '已记录', {
        label: '打开记录',
        onClick: () => navigate(tradeDetailPath(trade)),
      })
    })().catch((error) => {
      console.error('[TradeComposer] quick create failed', error)
      toast('保存失败，交易和本次截图均未写入；请重试')
    }).finally(() => {
      submittingRef.current = false
      setSubmitting(false)
    })
    return trackPendingStorageOperation(operation)
  }

  const requestClose = () => {
    if (submittingRef.current) return
    const current = composerSnapshot({
      symbol,
      side,
      timeframe,
      session,
      openedAt,
      strategyId,
      kind,
      status,
      entry,
      size,
      stopLoss,
      quickText,
      caseType,
      imageIds: images.map((image) => image.id),
    })
    if (current === baselineRef.current) close()
    else setDiscardConfirmOpen(true)
  }

  if (!open) return null

  return (
    <>
    <ModalShell
      title={editing ? `编辑${TRADE_KIND_META[editing.tradeKind].label}` : `新建${recordLabel}`}
      busy={submitting}
      panelClassName="composer-modal"
      bodyClassName="composer-body-quick"
      footerClassName="composer-footer-quick"
      initialFocusSelector=".composer-input-symbol .ui-select-trigger"
      onClose={requestClose}
      footer={(
        <>
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
              {submitting ? '保存中…' : editing ? '保存' : isTradeQuickNew ? '保存记录' : `创建${recordLabel}`}
            </Button>
          </div>
        </>
      )}
    >
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
                  icon: <SymbolIcon symbol={preset} overrides={symbolIcons} size={ICON_2XL} />,
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

          {isNew ? (
            <div className="composer-quick-context">
              <label htmlFor="composer-quick-text">一句话（可选）</label>
              <input
                id="composer-quick-text"
                data-composer-quick-text
                value={quickText}
                placeholder="记录当下看到的机会或判断"
                onChange={(event) => setQuickText(event.target.value)}
              />
            </div>
          ) : null}

          {showMore ? <div className="composer-parameter-grid">
            {isTradeQuickNew ? (
              <div className="composer-essential-field">
                <span className="composer-essential-label">记录类型</span>
                <Select
                  value={activeKind}
                  onValueChange={(value) => setKind(value as Extract<TradeKind, 'live' | 'paper'>)}
                  ariaLabel="记录类型"
                  options={[
                    { value: 'live', label: '实盘' },
                    { value: 'paper', label: '模拟盘' },
                  ]}
                />
              </div>
            ) : null}
            {isTradeQuickNew ? (
              <div className="composer-essential-field">
                <span className="composer-essential-label">状态</span>
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value as Extract<TradeStatus, 'planned' | 'missed'>)}
                  ariaLabel="记录状态"
                  options={[
                    { value: 'planned', label: '计划中' },
                    { value: 'missed', label: '错过机会' },
                  ]}
                />
              </div>
            ) : null}
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
            {isTradeQuickNew ? <>
              <label className="composer-essential-field">
                <span className="composer-essential-label">入场价</span>
                <input inputMode="decimal" value={entry} placeholder="可选" onChange={(event) => setEntry(event.target.value)} />
              </label>
              <label className="composer-essential-field">
                <span className="composer-essential-label">仓位</span>
                <input inputMode="decimal" value={size} placeholder="可选" onChange={(event) => setSize(event.target.value)} />
              </label>
              <label className="composer-essential-field">
                <span className="composer-essential-label">止损价</span>
                <input inputMode="decimal" value={stopLoss} placeholder="可选" onChange={(event) => setStopLoss(event.target.value)} />
              </label>
            </> : null}
            {activeKind === 'case' ? (
              <div className="composer-essential-field">
                <span className="composer-essential-label">案例类型</span>
                <Select
                  value={caseType}
                  onValueChange={(value) => {
                    const nextCaseType = value as CaseType
                    if (nextCaseType === caseType) return
                    caseTypeDirtyRef.current = true
                    setCaseType(nextCaseType)
                  }}
                  ariaLabel="案例类型"
                  options={CASE_TYPES.map((value) => ({
                    value,
                    label: CASE_TYPE_META[value].label,
                  }))}
                />
              </div>
            ) : null}
          </div> : null}

          <div className="composer-archive-row">
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
                <Plus size={ICON_XL} />
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
                      <X size={ICON_SM} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {isNew ? (
            <Button type="button" variant="ghost" className="composer-more-toggle" onClick={() => setShowMore((value) => !value)}>
              {showMore ? '收起更多信息' : '更多信息'}
            </Button>
          ) : null}
    </ModalShell>
    {discardConfirmOpen ? (
      <ModalShell
        title="放弃未保存的修改？"
        description="字段和本次添加的截图尚未保存。"
        size="compact"
        onClose={() => setDiscardConfirmOpen(false)}
        footer={(
          <>
            <Button variant="bordered" data-autofocus onClick={() => setDiscardConfirmOpen(false)}>
              继续编辑
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDiscardConfirmOpen(false)
                close()
              }}
            >
              放弃修改
            </Button>
          </>
        )}
      />
    ) : null}
    </>
  )
}
