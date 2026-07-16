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
  buildReviewSessionPool,
  clearReviewSessionStorage,
  hasEffectiveReviewContent,
  loadReviewSession,
  reconcileReviewSession,
  reviewSessionKeyAction,
  saveReviewSession,
  shuffleReviewSessionIds,
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

const CASE_SCOPE_OPTIONS: Array<{ value: ReviewCaseScope; label: string }> = [
  { value: 'all', label: '全部案例' },
  { value: 'mistakes', label: '错题' },
  { value: 'focus', label: '重点' },
  { value: 'unreviewed', label: '待复看' },
  { value: 'reviewed', label: '已掌握' },
]

const EMPTY_NOTE_STATE: ResolvedNoteState = {
  tradeId: null,
  status: 'idle',
  html: '',
}

export function ReviewSessionView() {
  const navigate = useNavigate()
  const trades = useStore((state) => state.trades)
  const strategies = useStore((state) => state.strategies)
  const starredIds = useStore((state) => state.starredIds)
  const starred = useMemo(() => new Set(starredIds), [starredIds])
  const [filters, setFilters] = useState<ReviewSessionFilters>(DEFAULT_REVIEW_SESSION_FILTERS)
  const [session, setSession] = useState<ReviewSessionSnapshot | null>(null)
  const [libraryId, setLibraryId] = useState<string | null>(null)
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>('loading')
  const [persistenceWarning, setPersistenceWarning] = useState(false)
  const [resolvedNote, setResolvedNote] = useState<ResolvedNoteState>(EMPTY_NOTE_STATE)
  const latestTradesRef = useRef(trades)
  const latestStarredRef = useRef(starred)
  const focusCardAfterTransitionRef = useRef(false)
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
      flipped: false,
    } : value)
  }, [current, session])

  useEffect(() => {
    if (!current || !session?.flipped) {
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
  }, [current?.id, current?.note, session?.flipped])

  const next = useCallback(() => {
    focusCardAfterTransitionRef.current = true
    setSession((value) => value ? {
      ...value,
      cursor: Math.min(value.cursor + 1, value.ids.length),
      flipped: false,
    } : value)
  }, [])

  const toggleFlip = useCallback(() => {
    focusCardAfterTransitionRef.current = true
    setSession((value) => value && value.cursor < value.ids.length
      ? { ...value, flipped: !value.flipped }
      : value)
  }, [])

  useEffect(() => {
    if (!focusCardAfterTransitionRef.current) return
    focusCardAfterTransitionRef.current = false
    const frame = requestAnimationFrame(() => {
      const selector = roundEnded
        ? '[data-review-session-finished-focus]'
        : current
          ? '[data-review-session-focus]'
          : '[data-review-session-start-focus]'
      const target = document.querySelector<HTMLElement>(selector)
      target?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [current, roundEnded, session?.flipped])

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
      ) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      if (action === 'flip') toggleFlip()
      else next()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [current, next, roundEnded, session, toggleFlip])

  const start = () => {
    const ids = shuffleReviewSessionIds(pool.map((trade) => trade.id))
    if (ids.length === 0) return
    focusCardAfterTransitionRef.current = true
    setSession({ ids, cursor: 0, filters, flipped: false })
  }

  const clearActiveSession = (nextFilters = filters) => {
    focusCardAfterTransitionRef.current = true
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
    focusCardAfterTransitionRef.current = true
    setSession({
      ids: shuffleReviewSessionIds(nextPool.map((trade) => trade.id)),
      cursor: 0,
      filters: session.filters,
      flipped: false,
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
        <ReviewSessionStart
          filters={filters}
          poolSize={pool.length}
          onChange={setFilters}
          onStart={start}
        />
      ) : roundEnded ? (
        <ReviewSessionFinished
          count={session.ids.length}
          onReshuffle={reshuffle}
          onAdjust={() => clearActiveSession(session.filters)}
        />
      ) : !current ? (
        <div className="review-session-loading" role="status">正在跳过已删除的记录…</div>
      ) : session.flipped ? (
        <ReviewSessionBack
          trade={current}
          strategyName={getStrategyName(strategies, current.strategyId)}
          note={resolvedNote.tradeId === current.id ? resolvedNote : EMPTY_NOTE_STATE}
          onFlip={toggleFlip}
          onNext={next}
          onOpenDetail={openDetail}
        />
      ) : (
        <ReviewSessionFront
          trade={current}
          strategyName={getStrategyName(strategies, current.strategyId)}
          onFlip={toggleFlip}
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
        <span className="review-session-eyebrow">回忆优先 · 只读浏览</span>
        <h1>从过去的交易里，抽一轮复盘卡</h1>
        <p>先回忆自己的判断，再翻面核对笔记。会话不会修改交易或案例。</p>
      </div>

      <fieldset className="review-session-source-grid">
        <legend>选择牌池</legend>
        <label className={filters.includeCases ? 'is-selected' : undefined}>
          <input
            type="checkbox"
            checked={filters.includeCases}
            onChange={(event) => patchFilters({ includeCases: event.target.checked })}
          />
          <BookOpen size={19} aria-hidden />
          <span><strong>案例记录</strong><small>优秀范例、错题与待复看案例</small></span>
        </label>
        <label className={filters.includeAccountTrades ? 'is-selected' : undefined}>
          <input
            type="checkbox"
            checked={filters.includeAccountTrades}
            onChange={(event) => patchFilters({ includeAccountTrades: event.target.checked })}
          />
          <ListTodo size={19} aria-hidden />
          <span><strong>账户交易</strong><small>实盘与模拟交易日志</small></span>
        </label>
      </fieldset>

      <div className="review-session-options">
        <label>
          <span>案例范围</span>
          <select
            value={filters.caseScope}
            disabled={!filters.includeCases}
            onChange={(event) => patchFilters({ caseScope: event.target.value as ReviewCaseScope })}
          >
            {CASE_SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="review-session-content-toggle">
          <input
            type="checkbox"
            checked={filters.requireContent}
            onChange={(event) => patchFilters({ requireContent: event.target.checked })}
          />
          <Image size={17} aria-hidden />
          <span>仅含有效图文</span>
        </label>
      </div>

      <div className="review-session-start-footer">
        <div>
          <strong>{noSources ? '请选择至少一个来源' : `将开始 ${poolSize} 张`}</strong>
          <span>{poolSize === 0 && !noSources ? '当前条件没有可复盘记录，请放宽筛选。' : '开始后会随机排序，本轮不重复。'}</span>
        </div>
        <button type="button" className="review-session-primary" disabled={noSources || poolSize === 0} onClick={onStart}>
          开始复盘
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>
    </main>
  )
}

function ReviewSessionFront({
  trade,
  strategyName,
  onFlip,
}: {
  trade: Trade
  strategyName: string
  onFlip: () => void
}) {
  const rTone = metricTone(trade.rMultiple)
  const pnlTone = metricTone(trade.pnl)
  return (
    <main className="review-session-stage" data-review-session-focus tabIndex={-1}>
      <button
        type="button"
        className="review-session-card is-front"
        onClick={onFlip}
        aria-labelledby="review-session-front-kind review-session-front-ref review-session-front-symbol review-session-front-strategy review-session-front-meta"
        aria-describedby="review-session-front-prompt"
      >
        <div className="review-session-card-badges" id="review-session-front-kind">
          <span>{TRADE_KIND_META[trade.tradeKind].label}</span>
          {trade.reviewCategory !== 'normal' ? <span>{REVIEW_CATEGORY_META[trade.reviewCategory].label}</span> : null}
        </div>
        <div className="review-session-card-center">
          <span className="review-session-card-ref" id="review-session-front-ref">{trade.ref}</span>
          <h1 id="review-session-front-symbol">{trade.symbol}</h1>
          <p id="review-session-front-strategy">{strategyName}</p>
          <div className="review-session-card-meta" id="review-session-front-meta">
            <span>{trade.side === 'long' ? '做多' : '做空'}</span>
            <span>{fmtDate(trade.recordedAt ?? trade.openedAt)}</span>
            <span className={`is-${rTone}`}>{fmtR(trade.rMultiple)}</span>
            {trade.pnl != null ? <span className={`is-${pnlTone}`}>{fmtMoney(trade.pnl)}</span> : null}
          </div>
        </div>
        <div className="review-session-recall-prompt" id="review-session-front-prompt">
          <strong>先回忆，再翻面</strong>
          <span>当时的依据、执行偏差与可复用结论是什么？</span>
          <kbd>Space</kbd>
        </div>
      </button>
    </main>
  )
}

function metricTone(value: number | null | undefined): 'zero' | 'positive' | 'negative' {
  return value == null || value === 0 ? 'zero' : value > 0 ? 'positive' : 'negative'
}

function ReviewSessionBack({
  trade,
  strategyName,
  note,
  onFlip,
  onNext,
  onOpenDetail,
}: {
  trade: Trade
  strategyName: string
  note: ResolvedNoteState
  onFlip: () => void
  onNext: () => void
  onOpenDetail: () => void
}) {
  return (
    <main className="review-session-stage" data-review-session-focus tabIndex={-1}>
      <article className="review-session-card is-back" aria-label={`${trade.symbol} 复盘答案`}>
        <header className="review-session-answer-header">
          <div>
            <span>{trade.ref} · {TRADE_KIND_META[trade.tradeKind].label}</span>
            <h1>{trade.symbol}</h1>
            <p>{strategyName}</p>
          </div>
          <button type="button" onClick={onOpenDetail}>打开详情</button>
        </header>
        <section className="review-session-note" aria-label="复盘笔记">
          {note.status === 'loading' ? (
            <div className="review-session-note-state" role="status">正在载入图文笔记…</div>
          ) : note.status === 'error' ? (
            <div className="review-session-note-state is-error" role="alert">
              <AlertCircle size={18} aria-hidden />
              <span>本张笔记暂时无法读取，你仍可继续下一张。</span>
            </div>
          ) : note.html ? (
            <Editor
              content={note.html}
              onChange={() => {}}
              readOnly
              allowImages={false}
              ariaLabel="只读复盘笔记"
            />
          ) : (
            <div className="review-session-note-state">
              <Image size={20} aria-hidden />
              <span>暂无复盘笔记</span>
            </div>
          )}
        </section>
        <footer className="review-session-card-actions">
          <button type="button" onClick={onFlip}>再看正面 <kbd>Space</kbd></button>
          <button type="button" className="review-session-primary" onClick={onNext}>
            下一张 <kbd>N</kbd><ChevronRight size={15} aria-hidden />
          </button>
        </footer>
      </article>
    </main>
  )
}

function ReviewSessionFinished({
  count,
  onReshuffle,
  onAdjust,
}: {
  count: number
  onReshuffle: () => void
  onAdjust: () => void
}) {
  return (
    <main
      className="review-session-finished"
      data-review-session-finished-focus
      tabIndex={-1}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="review-session-finished-icon"><CheckCircle size={26} aria-hidden /></span>
      <span className="review-session-eyebrow">本轮完成</span>
      <h1>已浏览 {count} 张复盘卡</h1>
      <p>本轮不会写入熟练度或修改任何交易记录。</p>
      <div>
        <button type="button" className="review-session-primary" onClick={onReshuffle}>
          <RotateCcw size={16} aria-hidden />再洗一轮
        </button>
        <button type="button" onClick={onAdjust}>
          <SlidersHorizontal size={16} aria-hidden />调整筛选
        </button>
      </div>
    </main>
  )
}
