import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  BookOpen,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Image,
  ListTodo,
  RotateCcw,
  SlidersHorizontal,
} from '@/icons/appIcons'
import {
  REVIEW_CATEGORY_META,
  TRADE_KIND_META,
  type Trade,
} from '@/data/trades'
import { Editor } from '@/editor/Editor'
import { fmtDate, fmtMoney, fmtR } from '@/lib/format'
import { getStrategyName } from '@/lib/strategies'
import {
  DEFAULT_REVIEW_SESSION_FILTERS,
  buildReviewAssessmentPatch,
  buildReviewSessionPool,
  clearReviewSessionStorage,
  hasEffectiveReviewContent,
  loadReviewSession,
  reconcileReviewSession,
  reviewSessionKeyAction,
  saveReviewSession,
  shuffleReviewSessionIds,
  type ReviewSessionAssessment,
  type ReviewSessionFilters,
  type ReviewSessionSnapshot,
} from '@/lib/reviewSession'
import type { ReviewCaseScope } from '@/lib/reviewCaseScope'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { resolveNoteForDisplayResult } from '@/storage/assets'
import { getStorage } from '@/storage/bootstrap'
import { useShortcutStore } from '@/store/shortcutStore'
import { useStore } from '@/store/useStore'
import './ReviewSessionView.css'

type RestoreStatus = 'loading' | 'ready' | 'unavailable'
type ResolvedNoteState = {
  tradeId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  html: string
}
type ReviewImage = { src: string; alt: string }
type ReviewNotePresentation = { bodyHtml: string; images: ReviewImage[] }

const CASE_SCOPE_OPTIONS: Array<{ value: ReviewCaseScope; label: string }> = [
  { value: 'all', label: '全部案例' },
  { value: 'mistakes', label: '错题' },
  { value: 'focus', label: '重点' },
  { value: 'unreviewed', label: '待复看' },
  { value: 'reviewed', label: '已掌握' },
]

const ASSESSMENT_OPTIONS: Array<{
  value: ReviewSessionAssessment
  label: string
  hint: string
  key: string
}> = [
  { value: 'unfamiliar', label: '还没掌握', hint: '3 天后再看', key: '1' },
  { value: 'recheck', label: '基本理解', hint: '7 天后复看', key: '2' },
  { value: 'mastered', label: '已经掌握', hint: '完成本条', key: '3' },
]

const EMPTY_NOTE_STATE: ResolvedNoteState = {
  tradeId: null,
  status: 'idle',
  html: '',
}

export function splitReviewNoteHtml(html: string): ReviewNotePresentation {
  if (!html || typeof document === 'undefined') return { bodyHtml: html, images: [] }
  const template = document.createElement('template')
  template.innerHTML = html
  const images = [...template.content.querySelectorAll<HTMLImageElement>('img')]
    .filter((image) => Boolean(image.src || image.getAttribute('src')))
    .map((image, index) => ({
      src: image.src || image.getAttribute('src') || '',
      alt: image.alt.trim() || `交易截图 ${index + 1}`,
    }))

  template.content.querySelectorAll('img').forEach((image) => image.remove())
  template.content.querySelectorAll('p, figure').forEach((node) => {
    if (!node.textContent?.trim() && !node.querySelector('video, iframe, table')) node.remove()
  })
  return { bodyHtml: template.innerHTML.trim(), images }
}

export function ReviewSessionView() {
  const navigate = useNavigate()
  const trades = useStore((state) => state.trades)
  const strategies = useStore((state) => state.strategies)
  const starredIds = useStore((state) => state.starredIds)
  const updateTradeData = useStore((state) => state.updateTradeData)
  const starred = useMemo(() => new Set(starredIds), [starredIds])
  const [filters, setFilters] = useState<ReviewSessionFilters>(DEFAULT_REVIEW_SESSION_FILTERS)
  const [session, setSession] = useState<ReviewSessionSnapshot | null>(null)
  const [libraryId, setLibraryId] = useState<string | null>(null)
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>('loading')
  const [persistenceWarning, setPersistenceWarning] = useState(false)
  const [resolvedNote, setResolvedNote] = useState<ResolvedNoteState>(EMPTY_NOTE_STATE)
  const latestTradesRef = useRef(trades)
  const latestStarredRef = useRef(starred)
  const focusAfterTransitionRef = useRef(false)
  latestTradesRef.current = trades
  latestStarredRef.current = starred

  const pool = useMemo(
    () => buildReviewSessionPool(trades, filters, starred),
    [filters, starred, trades],
  )
  const tradeById = useMemo(
    () => new Map(trades.filter((trade) => !trade.deletedAt).map((trade) => [trade.id, trade])),
    [trades],
  )
  const current = session && session.cursor < session.ids.length
    ? tradeById.get(session.ids[session.cursor] ?? '')
    : undefined
  const roundEnded = Boolean(session && session.cursor >= session.ids.length)
  const assessedCount = session ? Object.keys(session.assessments).length : 0

  useEffect(() => {
    let cancelled = false
    void getStorage().getManifest().then((manifest) => {
      if (cancelled) return
      const stored = loadReviewSession(manifest.libraryId)
      const restored = stored
        ? reconcileReviewSession(stored, latestTradesRef.current, latestStarredRef.current)
        : null
      setLibraryId(manifest.libraryId)
      if (restored) {
        setFilters(restored.filters)
        setSession(restored)
      } else if (stored) {
        clearReviewSessionStorage(manifest.libraryId)
      }
      setRestoreStatus('ready')
    }).catch(() => {
      if (cancelled) return
      setRestoreStatus('unavailable')
      setPersistenceWarning(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!libraryId || !session || restoreStatus !== 'ready') return
    if (!saveReviewSession(libraryId, session)) setPersistenceWarning(true)
  }, [libraryId, restoreStatus, session])

  useEffect(() => {
    if (!session || session.cursor >= session.ids.length || current) return
    setSession((value) => value ? {
      ...value,
      cursor: Math.min(value.cursor + 1, value.ids.length),
    } : value)
  }, [current, session])

  useEffect(() => {
    if (!current) {
      setResolvedNote(EMPTY_NOTE_STATE)
      return
    }
    if (!hasEffectiveReviewContent(current.note)) {
      setResolvedNote({ tradeId: current.id, status: 'ready', html: '' })
      return
    }

    let cancelled = false
    setResolvedNote({ tradeId: current.id, status: 'loading', html: '' })
    void resolveNoteForDisplayResult(current.note, getStorage()).then((result) => {
      if (!cancelled) setResolvedNote({ tradeId: current.id, status: 'ready', html: result.html })
    }).catch(() => {
      if (!cancelled) setResolvedNote({ tradeId: current.id, status: 'error', html: '' })
    })
    return () => { cancelled = true }
  }, [current?.id, current?.note])

  const advance = useCallback(() => {
    focusAfterTransitionRef.current = true
    setSession((value) => value ? {
      ...value,
      cursor: Math.min(value.cursor + 1, value.ids.length),
    } : value)
  }, [])

  const assess = useCallback((assessment: ReviewSessionAssessment) => {
    if (!current) return
    updateTradeData(current.id, buildReviewAssessmentPatch(current, assessment))
    focusAfterTransitionRef.current = true
    setSession((value) => value ? {
      ...value,
      cursor: Math.min(value.cursor + 1, value.ids.length),
      assessments: { ...value.assessments, [current.id]: assessment },
    } : value)
  }, [current, updateTradeData])

  useEffect(() => {
    if (!focusAfterTransitionRef.current) return
    focusAfterTransitionRef.current = false
    const frame = requestAnimationFrame(() => {
      const selector = roundEnded
        ? '[data-review-session-finished-focus]'
        : current
          ? '[data-review-session-focus]'
          : '[data-review-session-start-focus]'
      document.querySelector<HTMLElement>(selector)?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [current, roundEnded, session?.cursor])

  useEffect(() => {
    if (!session || roundEnded || !current) return
    const onKeyDown = (event: KeyboardEvent) => {
      const action = reviewSessionKeyAction(event)
      if (!action) return
      const shortcutState = useShortcutStore.getState()
      const appState = useStore.getState()
      if (
        shortcutState.lightbox ||
        shortcutState.cmdkOpen ||
        shortcutState.dataIOOpen ||
        appState.composerOpen ||
        appState.closeTradeRequest
      ) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (action === 'skip') advance()
      else assess(action)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [advance, assess, current, roundEnded, session])

  const start = () => {
    const ids = shuffleReviewSessionIds(pool.map((trade) => trade.id))
    if (ids.length === 0) return
    focusAfterTransitionRef.current = true
    setSession({ ids, cursor: 0, filters, assessments: {} })
  }

  const clearActiveSession = (nextFilters = filters) => {
    focusAfterTransitionRef.current = true
    if (libraryId) clearReviewSessionStorage(libraryId)
    setFilters(nextFilters)
    setSession(null)
    setResolvedNote(EMPTY_NOTE_STATE)
  }

  const reshuffle = () => {
    if (!session) return
    const nextPool = buildReviewSessionPool(trades, session.filters, starred)
    if (nextPool.length === 0) {
      clearActiveSession(session.filters)
      return
    }
    focusAfterTransitionRef.current = true
    setSession({
      ids: shuffleReviewSessionIds(nextPool.map((trade) => trade.id)),
      cursor: 0,
      filters: session.filters,
      assessments: {},
    })
  }

  const openDetail = () => {
    if (!current) return
    if (libraryId && session) saveReviewSession(libraryId, session)
    navigate(tradeDetailPath(current), {
      state: tradeDetailNavState({
        pathname: '/review-session',
        search: '',
        anchorTradeId: current.id,
      }),
    })
  }

  if (restoreStatus === 'loading') {
    return (
      <div className="review-session-loading" role="status" aria-live="polite">
        <RotateCcw size={20} aria-hidden />
        <span>正在恢复复盘会话…</span>
      </div>
    )
  }

  return (
    <div className="review-session-view">
      <header className="review-session-topbar">
        <button type="button" className="review-session-back" onClick={() => navigate('/today-record')}>
          <ChevronLeft size={16} aria-hidden />
          <span>退出复盘</span>
        </button>
        <div className="review-session-heading">
          <RotateCcw size={16} aria-hidden />
          <strong>随机复盘</strong>
        </div>
        {session && !roundEnded ? (
          <div className="review-session-topbar-end">
            <span className="review-session-assessed">已评 {assessedCount}</span>
            <span className="review-session-progress" aria-live="polite">
              {session.cursor + 1} / {session.ids.length}
            </span>
            <button type="button" onClick={() => clearActiveSession(session.filters)}>结束本轮</button>
          </div>
        ) : <span />}
      </header>

      {persistenceWarning ? (
        <div className="review-session-warning" role="status">
          本轮仍可继续，但刷新或打开详情后可能无法自动恢复。
        </div>
      ) : null}

      {!session ? (
        <ReviewSessionStart filters={filters} poolSize={pool.length} onChange={setFilters} onStart={start} />
      ) : roundEnded ? (
        <ReviewSessionFinished session={session} onReshuffle={reshuffle} onAdjust={() => clearActiveSession(session.filters)} />
      ) : !current ? (
        <div className="review-session-loading" role="status">正在跳过已删除的记录…</div>
      ) : (
        <ReviewSessionItem
          trade={current}
          strategyName={getStrategyName(strategies, current.strategyId)}
          note={resolvedNote.tradeId === current.id ? resolvedNote : EMPTY_NOTE_STATE}
          onAssess={assess}
          onSkip={advance}
          onOpenDetail={openDetail}
        />
      )}
    </div>
  )
}

function ReviewSessionStart({
  filters,
  poolSize,
  onChange,
  onStart,
}: {
  filters: ReviewSessionFilters
  poolSize: number
  onChange: (filters: ReviewSessionFilters) => void
  onStart: () => void
}) {
  const patchFilters = (patch: Partial<ReviewSessionFilters>) => onChange({ ...filters, ...patch })
  const noSources = !filters.includeCases && !filters.includeAccountTrades

  return (
    <main className="review-session-start" data-review-session-start-focus tabIndex={-1}>
      <div className="review-session-intro">
        <span className="review-session-eyebrow">完全随机 · 直接阅读</span>
        <h1>随机打开一组过去的交易</h1>
        <p>完整查看交易信息、复盘笔记和截图，再按真实理解程度评估。每轮随机排序且不重复。</p>
      </div>

      <fieldset className="review-session-source-grid">
        <legend>随机范围</legend>
        <label className={filters.includeCases ? 'is-selected' : undefined}>
          <input type="checkbox" checked={filters.includeCases} onChange={(event) => patchFilters({ includeCases: event.target.checked })} />
          <BookOpen size={19} aria-hidden />
          <span><strong>案例记录</strong><small>优秀范例、错题与待复看案例</small></span>
        </label>
        <label className={filters.includeAccountTrades ? 'is-selected' : undefined}>
          <input type="checkbox" checked={filters.includeAccountTrades} onChange={(event) => patchFilters({ includeAccountTrades: event.target.checked })} />
          <ListTodo size={19} aria-hidden />
          <span><strong>账户交易</strong><small>实盘与模拟交易日志</small></span>
        </label>
      </fieldset>

      <div className="review-session-options">
        <label>
          <span>案例范围</span>
          <select value={filters.caseScope} disabled={!filters.includeCases} onChange={(event) => patchFilters({ caseScope: event.target.value as ReviewCaseScope })}>
            {CASE_SCOPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="review-session-content-toggle">
          <input type="checkbox" checked={filters.requireContent} onChange={(event) => patchFilters({ requireContent: event.target.checked })} />
          <Image size={17} aria-hidden />
          <span>仅含有效图文</span>
        </label>
      </div>

      <div className="review-session-start-footer">
        <div>
          <strong>{noSources ? '请选择至少一个来源' : `可随机复盘 ${poolSize} 条`}</strong>
          <span>{poolSize === 0 && !noSources ? '当前条件没有可复盘记录，请放宽筛选。' : '进入后直接显示完整内容，不再翻面。'}</span>
        </div>
        <button type="button" className="review-session-primary" disabled={noSources || poolSize === 0} onClick={onStart}>
          随机开始
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>
    </main>
  )
}

function metricTone(value: number | null | undefined): 'zero' | 'positive' | 'negative' {
  return value == null || value === 0 ? 'zero' : value > 0 ? 'positive' : 'negative'
}

function ReviewSessionItem({
  trade,
  strategyName,
  note,
  onAssess,
  onSkip,
  onOpenDetail,
}: {
  trade: Trade
  strategyName: string
  note: ResolvedNoteState
  onAssess: (assessment: ReviewSessionAssessment) => void
  onSkip: () => void
  onOpenDetail: () => void
}) {
  const rTone = metricTone(trade.rMultiple)
  const pnlTone = metricTone(trade.pnl)
  return (
    <main className="review-session-stage" data-review-session-focus tabIndex={-1}>
      <article className="review-session-workspace" aria-label={`${trade.symbol} 随机复盘`}>
        <header className="review-session-item-header">
          <div className="review-session-item-identity">
            <div className="review-session-item-badges">
              <span>{TRADE_KIND_META[trade.tradeKind].label}</span>
              {trade.reviewCategory !== 'normal' ? <span>{REVIEW_CATEGORY_META[trade.reviewCategory].label}</span> : null}
            </div>
            <div>
              <span className="review-session-card-ref">{trade.ref}</span>
              <h1>{trade.symbol}</h1>
              <p>{strategyName}</p>
            </div>
          </div>
          <div className="review-session-item-meta">
            <span>{trade.side === 'long' ? '做多' : '做空'}</span>
            <span>{fmtDate(trade.recordedAt ?? trade.openedAt)}</span>
            <span className={`is-${rTone}`}>{fmtR(trade.rMultiple)}</span>
            {trade.pnl != null ? <span className={`is-${pnlTone}`}>{fmtMoney(trade.pnl)}</span> : null}
            <button type="button" onClick={onOpenDetail}>打开详情</button>
          </div>
        </header>

        <ReviewSessionNote note={note} />

        <footer className="review-session-assessment">
          <div>
            <strong>这套做法你掌握到什么程度？</strong>
            <span>选择后记录掌握度并进入下一条</span>
          </div>
          <div className="review-session-assessment-actions">
            {ASSESSMENT_OPTIONS.map((option) => (
              <button key={option.value} type="button" className={`is-${option.value}`} onClick={() => onAssess(option.value)}>
                <span>{option.label}</span>
                <small>{option.hint}</small>
                <kbd>{option.key}</kbd>
              </button>
            ))}
            <button type="button" className="review-session-skip" onClick={onSkip}>跳过 <kbd>N</kbd></button>
          </div>
        </footer>
      </article>
    </main>
  )
}

function ReviewSessionNote({ note }: { note: ResolvedNoteState }) {
  const presentation = useMemo(() => splitReviewNoteHtml(note.html), [note.html])
  const imageSources = useMemo(() => presentation.images.map((image) => image.src), [presentation.images])
  const hasBody = hasEffectiveReviewContent(presentation.bodyHtml)

  if (note.status === 'loading' || note.status === 'idle') {
    return <div className="review-session-note-state" role="status">正在载入完整复盘…</div>
  }
  if (note.status === 'error') {
    return (
      <div className="review-session-note-state is-error" role="alert">
        <AlertCircle size={18} aria-hidden />
        <span>本条图文暂时无法读取，你仍可评估或跳过。</span>
      </div>
    )
  }
  if (!hasBody && presentation.images.length === 0) {
    return (
      <div className="review-session-note-state">
        <Image size={20} aria-hidden />
        <span>暂无复盘笔记</span>
      </div>
    )
  }

  return (
    <section className={`review-session-content${hasBody && presentation.images.length > 0 ? ' has-split-content' : ''}`} aria-label="完整复盘内容">
      {presentation.images.length > 0 ? (
        <div className={`review-session-gallery is-${presentation.images.length === 1 ? 'single' : 'multiple'}`} aria-label={`交易截图，共 ${presentation.images.length} 张`}>
          {presentation.images.map((image, index) => (
            <button
              type="button"
              key={`${image.src}-${index}`}
              onClick={() => useShortcutStore.getState().openLightbox(imageSources, index)}
              aria-label={`放大查看${image.alt}`}
            >
              <img src={image.src} alt={image.alt} />
              <span>{index + 1} / {presentation.images.length}</span>
            </button>
          ))}
        </div>
      ) : null}
      {hasBody ? (
        <div className="review-session-note-copy">
          <Editor content={presentation.bodyHtml} onChange={() => {}} readOnly allowImages={false} ariaLabel="只读复盘笔记" />
        </div>
      ) : null}
    </section>
  )
}

function ReviewSessionFinished({
  session,
  onReshuffle,
  onAdjust,
}: {
  session: ReviewSessionSnapshot
  onReshuffle: () => void
  onAdjust: () => void
}) {
  const results = Object.values(session.assessments)
  const counts = {
    unfamiliar: results.filter((value) => value === 'unfamiliar').length,
    recheck: results.filter((value) => value === 'recheck').length,
    mastered: results.filter((value) => value === 'mastered').length,
    skipped: session.ids.length - results.length,
  }
  return (
    <main className="review-session-finished" data-review-session-finished-focus tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">
      <span className="review-session-finished-icon"><CheckCircle size={26} aria-hidden /></span>
      <span className="review-session-eyebrow">本轮完成</span>
      <h1>已复盘 {session.ids.length} 条交易</h1>
      <p>掌握度已经写回记录，需要复看的内容会按计划重新出现。</p>
      <div className="review-session-result-grid">
        <span><strong>{counts.unfamiliar}</strong><small>还没掌握</small></span>
        <span><strong>{counts.recheck}</strong><small>基本理解</small></span>
        <span><strong>{counts.mastered}</strong><small>已经掌握</small></span>
        <span><strong>{counts.skipped}</strong><small>跳过</small></span>
      </div>
      <div className="review-session-finished-actions">
        <button type="button" className="review-session-primary" onClick={onReshuffle}><RotateCcw size={16} aria-hidden />再随机一轮</button>
        <button type="button" onClick={onAdjust}><SlidersHorizontal size={16} aria-hidden />调整范围</button>
      </div>
    </main>
  )
}
