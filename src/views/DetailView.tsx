import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Link2,
  MoreHorizontal,
  Favorite,
  Star,
  Copy,
  Pencil,
  Trash2,
  RotateCcw,
  X,
  Send,
  BookOpen,
  AlertCircle,
  CheckCircle,
} from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import { Editor } from '@/editor/Editor'
import { Menu } from '@/components/Menu'
import { IconButton } from '@/components/IconButton'
import { Tooltip } from '@/components/ui/Tooltip'
import { ShortcutTooltip } from '@/components/ShortcutTooltip'
import { ModalShell } from '@/components/ui/ModalShell'
import { DatePicker } from '@/components/ui/DatePicker'
import { TagEditor } from '@/components/TagEditor'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import { SymbolIcon } from '@/components/SymbolIcon'
import { StrategyIcon, StrategyLabel } from '@/components/StrategyIcon'
import { UserAvatar } from '@/components/UserAvatar'
import type { Strategy } from '@/data/strategies'
import {
  STATUS_META,
  CONVICTION_META,
  TRADE_KIND_META,
  CASE_TYPE_META,
  MASTERY_STATE_META,
  MISS_REASON_META,
  TIMEFRAME_PRESETS,
  getTimeframeTone,
  resolveTimeframe,
  type TradeStatus,
  type Conviction,
  type TradeSide,
  type TradeKind,
  type MissReason,
  type CaseType,
  type MasteryState,
  type ActivityEvent,
  type ActivityKind,
  type Trade,
} from '@/data/trades'
import { fmtMoney, fmtR, fmtPrice, fmtDate, fmtDateTime } from '@/lib/format'
import { getStrategyName } from '@/lib/strategies'
import { getTradeActivities, partitionDisplayActivities, type DisplayActivityEvent } from '@/lib/activities'
import { findTradeByRouteParam, tradeDetailPath, resolveTradeDetailReturn, type TradeDetailLocationState } from '@/lib/tradeRoute'
import { tradeReturnLocationState } from '@/hooks/useTradeReturnAnchor'
import {
  SESSION_PRESETS,
  PSYCHOLOGY_PRESETS,
  NARRATIVE_PRESETS,
  getSessionSelectValue,
  getTradeSessionMeta,
  normalizeSession,
  normalizePsychology,
  normalizeNarrative,
} from '@/lib/tradeView'
import { toast } from '@/lib/toast'
import { STATUS_ORDER, isExecutedClosed, isTerminal } from '@/lib/tradeStatus'
import { getStorage } from '@/storage/bootstrap'
import { resolveNoteForDisplayResult } from '@/storage/assets'
import {
  flushNoteDraftsToStore,
  flushNoteDraftToStore,
  setNoteDraft,
} from '@/storage/noteDrafts'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { useSaveStatus } from '@/store/saveStatus'
import { buildReviewCaseFromTrade, getNextReviewCaseRef } from '@/lib/reviewCases'
import { resolveTradeTruth } from '@/lib/tradeTruth'
import { transitionTradeStatus } from '@/lib/tradeTransition'
import { prepareTradeResultEdit, type TradeResultEdit } from '@/lib/tradeResult'
import { evaluateReviewCompletion } from '@/lib/reviewCompletion'
import { formatYmd } from '@/lib/periods'
import { TradeDetailLayout } from '@/components/trades/TradeDetailLayout'
import { useShortcutStore } from '@/store/shortcutStore'
import { getDetailNavigation } from '@/shortcuts/listNav'
import { collectImageSrcsFromHtml } from '@/shortcuts/images'
import { loadDetailNote, type DetailNoteLoadResult } from '@/views/detailNoteLoad'
import './DetailView.css'

const FEED_VISIBLE = 8

const STATUS_OPTS: TradeStatus[] = STATUS_ORDER
const CONV_OPTS: Conviction[] = ['urgent', 'high', 'medium', 'low']
const KIND_OPTS: TradeKind[] = ['live', 'paper', 'case']
const MISS_OPTS: MissReason[] = ['hesitation', 'missed_setup', 'no_alert', 'rule_break', 'other']
const CASE_TYPE_OPTS: CaseType[] = ['exemplar', 'mistake', 'ambiguous', 'missed']
const MASTERY_OPTS: MasteryState[] = ['new', 'recheck', 'mastered']

function isPendingReviewTrade(trade: Trade): boolean {
  if (trade.deletedAt || trade.tradeKind === 'case' || trade.reviewStatus === 'reviewed') return false
  const truth = resolveTradeTruth(trade)
  return (
    truth.executionState === 'missed' ||
    (truth.executionState === 'closed' && truth.isResultComplete)
  )
}

function findNextPendingReviewId(
  fromId: string,
  orderedIds: string[],
  trades: Trade[],
): string | null {
  const byId = new Map(trades.map((item) => [item.id, item]))
  const start = orderedIds.indexOf(fromId)
  if (start < 0) return null
  for (let index = start + 1; index < orderedIds.length; index += 1) {
    const candidate = byId.get(orderedIds[index]!)
    if (candidate && isPendingReviewTrade(candidate)) return candidate.id
  }
  return null
}

export function DetailView() {
  const { id: routeParam } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const listContext = useShortcutStore((s) => s.listContext)
  const lightbox = useShortcutStore((s) => s.lightbox)
  const syncLightboxForOwner = useShortcutStore((s) => s.syncLightboxForOwner)
  const closeLightbox = useShortcutStore((s) => s.closeLightbox)
  const allTrades = useStore((s) => s.trades)
  const trades = useMemo(() => allTrades.filter((item) => !item.deletedAt), [allTrades])
  const trade = useMemo(
    () => findTradeByRouteParam(trades, routeParam),
    [trades, routeParam],
  )
  const deletedTrade = useMemo(() => {
    const record = findTradeByRouteParam(allTrades, routeParam)
    return record?.deletedAt ? record : undefined
  }, [allTrades, routeParam])
  const updateTradeData = useStore((s) => s.updateTradeData)
  const transitionTradeKind = useStore((s) => s.transitionTradeKind)
  const completeTradeClose = useStore((s) => s.completeTradeClose)
  const setStatus = useStore((s) => s.setStatus)
  const requestTradeClose = useStore((s) => s.requestTradeClose)
  const setConviction = useStore((s) => s.setConviction)
  const setStrategy = useStore((s) => s.setStrategy)
  const strategies = useStore((s) => s.strategies)
  const addTag = useStore((s) => s.addTag)
  const removeTag = useStore((s) => s.removeTag)
  const tagPresets = useStore((s) => s.tagPresets)
  const mistakeTagPresets = useStore((s) => s.mistakeTagPresets)
  const addComment = useStore((s) => s.addComment)
  const removeComment = useStore((s) => s.removeComment)
  const toggleStar = useStore((s) => s.toggleStar)
  const openComposer = useStore((s) => s.openComposer)
  const removeTrade = useStore((s) => s.removeTrade)
  const restoreTrade = useStore((s) => s.restoreTrade)
  const upsertTrade = useStore((s) => s.upsertTrade)
  const profile = useStore((s) => s.profile)
  const symbolIcons = useStore((s) => s.symbolIcons)
  const starredIds = useStore((s) => s.starredIds)
  const reviewTemplates = useStore((s) => s.reviewTemplates)
  const reviewContextPinned = useStore((s) => s.display.reviewContextPinned ?? true)
  const privacyMode = useStore((s) => s.display.privacyMode)
  const [comment, setComment] = useState('')
  const [editorHtml, setEditorHtml] = useState('')
  const [feedExpanded, setFeedExpanded] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [noteLoadAttempt, setNoteLoadAttempt] = useState(0)
  const [noteRetrying, setNoteRetrying] = useState(false)
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [reviewIssue, setReviewIssue] = useState<string | null>(null)
  const [noteLoad, setNoteLoad] = useState<{
    tradeId: string | null
    state: DetailNoteLoadResult | { status: 'loading' }
  }>({ tradeId: null, state: { status: 'loading' } })
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingHtmlRef = useRef<string | null>(null)
  const pendingTradeIdRef = useRef<string | null>(null)
  const noteResolvedRef = useRef(false)   // 初始内容是否已加载，防止空 onUpdate 覆盖真实笔记
  const commentRef = useRef<HTMLTextAreaElement>(null)

  /** 键入只更新本地草稿；idle 后再写入 trades，避免全量快照 thrash */
  const NOTE_IDLE_COMMIT_MS = 2000

  const adjustCommentHeight = useCallback(() => {
    const el = commentRef.current
    if (!el) return
    const prev = el.style.height
    el.style.height = 'auto'
    const h = Math.min(el.scrollHeight, 160)
    el.style.height = prev === `${h}px` ? prev : `${h}px`
  }, [])

  useEffect(() => {
    if (!trade || !routeParam || routeParam === trade.ref) return
    navigate(tradeDetailPath(trade), {
      replace: true,
      state: location.state,
    })
  }, [trade, routeParam, navigate, location.state])

  const from = (location.state as TradeDetailLocationState | null)?.from
  const detailReturn = useMemo(() => {
    return resolveTradeDetailReturn({
      from,
      listPath: listContext?.listPath,
      listSearch: listContext?.listSearch,
      tradeKind: trade?.tradeKind ?? deletedTrade?.tradeKind,
    })
  }, [from, listContext?.listPath, listContext?.listSearch, trade?.tradeKind, deletedTrade?.tradeKind])

  const persistEditorNote = useCallback((html: string, tradeId: string) => {
    pendingHtmlRef.current = html
    pendingTradeIdRef.current = tradeId
    setNoteDraft(tradeId, html)
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current)
    noteSaveTimer.current = setTimeout(() => {
      noteSaveTimer.current = null
      void flushNoteDraftToStore(tradeId)
    }, NOTE_IDLE_COMMIT_MS)
  }, [])

  useEffect(() => {
    if (!trade) return
    const preserveReadOnlyFallback =
      noteLoadAttempt > 0 && noteLoad.tradeId === trade.id && noteLoad.state.status === 'error'
    noteResolvedRef.current = false   // 切换交易时重置，阻止旧 onUpdate 写入空内容
    if (!preserveReadOnlyFallback) {
      setNoteRetrying(false)
      setNoteLoad({ tradeId: trade.id, state: { status: 'loading' } })
    }
    let cancelled = false
    void loadDetailNote(trade.note, async (html) => {
      if (cancelled) return html
      return resolveNoteForDisplayResult(html, getStorage())
    }, async () => {
      if (!(await flushNoteDraftsToStore())) return false
      return useStore.getState().trades.find((item) => item.id === trade.id)?.note ?? trade.note
    }).then((result) => {
      if (cancelled) return
      if (result.status === 'ready') {
        setEditorHtml(result.html)
        noteResolvedRef.current = true  // 标记初始内容已就绪，允许后续编辑触发保存
      }
      setNoteLoad({ tradeId: trade.id, state: result })
      setNoteRetrying(false)
    })
    return () => {
      cancelled = true
      if (noteSaveTimer.current) {
        clearTimeout(noteSaveTimer.current)
        noteSaveTimer.current = null
      }
      void flushNoteDraftToStore(trade.id)
    }
  }, [trade?.id, noteLoadAttempt])

  useLayoutEffect(() => {
    if (!trade || !lightbox) return
    if (!lightbox.ownerId) {
      syncLightboxForOwner(trade.id, lightbox.images)
      return
    }
    if (lightbox.ownerId !== trade.id) syncLightboxForOwner(trade.id, null)
  }, [trade?.id, lightbox?.ownerId, syncLightboxForOwner])

  useEffect(() => {
    if (!trade || !lightbox?.loading || lightbox.ownerId !== trade.id) return
    if (noteLoad.tradeId !== trade.id || noteLoad.state.status === 'loading') return
    if (noteLoad.state.status === 'error') {
      closeLightbox()
      toast(`${trade.ref} 的图片未能载入`)
      return
    }
    const images = collectImageSrcsFromHtml(editorHtml)
    if (images.length === 0) {
      closeLightbox()
      toast(`${trade.ref} 暂无图片`)
      return
    }
    syncLightboxForOwner(trade.id, images)
  }, [
    trade?.id,
    trade?.ref,
    lightbox?.loading,
    lightbox?.ownerId,
    noteLoad,
    editorHtml,
    closeLightbox,
    syncLightboxForOwner,
  ])

  useEffect(() => {
    return () => {
      if (noteSaveTimer.current) {
        clearTimeout(noteSaveTimer.current)
        noteSaveTimer.current = null
      }
      void flushNoteDraftsToStore()
    }
  }, [])

  const onEditorChange = useCallback(
    (html: string) => {
      setEditorHtml(html)
      setReviewIssue(null)
      if (!trade?.id) return
      if (!noteResolvedRef.current) return  // 初始内容尚未加载，拒绝保存空/占位内容
      useSaveStatus.getState().setDirty()
      persistEditorNote(html, trade.id)
    },
    [trade?.id, persistEditorNote],
  )

  const starred = trade ? starredIds.includes(trade.id) : false
  const detailNavigation = useMemo(
    () => getDetailNavigation(trades, listContext, trade),
    [trades, listContext, trade],
  )

  const navigateDetail = useCallback((targetId: string | null) => {
    if (!targetId) return
    const target = trades.find((item) => item.id === targetId)
    if (target) navigate(tradeDetailPath(target), { state: location.state })
  }, [trades, navigate, location.state])

  useEffect(() => {
    setActivityOpen(false)
    setFeedExpanded(false)
    setReviewIssue(null)
    setReviewSubmitting(false)
  }, [trade?.id])

  const activities = useMemo(
    () => (trade ? partitionDisplayActivities(getTradeActivities(trade)) : { comments: [], system: [] }),
    [trade],
  )

  const commentItems = useMemo(
    () => activities.comments.map((event) => ({
      event,
      node: trade ? renderActivity(event, strategies, trade.tradeKind) : null,
    })),
    [activities.comments, strategies, trade],
  )

  const systemFeedItems = useMemo(() => {
    const all = activities.system.map((event) => ({
      event,
      node: trade ? renderActivity(event, strategies, trade.tradeKind) : null,
    }))
    if (feedExpanded || all.length <= FEED_VISIBLE) return all
    return all.slice(-FEED_VISIBLE)
  }, [activities.system, strategies, trade, feedExpanded])

  const feedHiddenCount =
    feedExpanded || activities.system.length <= FEED_VISIBLE
      ? 0
      : activities.system.length - FEED_VISIBLE

  if (!trade) {
    const recordLabel =
      deletedTrade?.tradeKind === 'case'
        ? '案例记录'
        : deletedTrade?.tradeKind === 'paper'
          ? '模拟'
          : '交易日志'
    return (
      <>
        <header className="dv-topbar">
          <div className="dv-tb-left">
            <Link
              to={detailReturn}
              state={tradeReturnLocationState(from?.anchorTradeId)}
              className="dv-back"
              aria-label="返回列表"
            >
              <ChevronLeft size={16} />
            </Link>
            <span className="dv-crumb">{recordLabel}</span>
            <ChevronRight size={13} className="dv-crumb-sep" />
            <span className="dv-crumb dv-crumb-active">
              {deletedTrade ? '已移至回收站' : '未找到'}
            </span>
          </div>
        </header>
        <div className="dv-empty">
          <div className="dv-empty-card">
            <AlertCircle size={20} aria-hidden />
            <h1>{deletedTrade ? `该${recordLabel}已移至回收站` : `未找到该${recordLabel}`}</h1>
            <p>
              {deletedTrade
                ? '记录仍在安全保留期内，可前往回收站恢复。'
                : '它可能已被彻底删除，或当前链接已失效。'}
            </p>
            <div className="dv-empty-actions">
              <Link
                to={detailReturn}
                state={tradeReturnLocationState(from?.anchorTradeId)}
                className="ui-btn ui-btn-bordered"
              >
                返回{deletedTrade?.tradeKind === 'case' ? '案例记录' : '交易日志'}
              </Link>
              {deletedTrade && (
                <Link to="/trade-trash" className="empty-btn">
                  前往回收站
                </Link>
              )}
            </div>
          </div>
        </div>
      </>
    )
  }

  const activeNoteLoad = noteLoad.tradeId === trade.id
    ? noteLoad.state
    : { status: 'loading' as const }
  const noteEditorContent = activeNoteLoad.status === 'error'
      ? activeNoteLoad.fallbackHtml
      : editorHtml
  const reviewReadiness = evaluateReviewCompletion(editorHtml)

  const commitTradeResultEdit = (edit: TradeResultEdit) => {
    const result = prepareTradeResultEdit(trade, edit)
    if (result.status && isExecutedClosed(trade.status)) {
      completeTradeClose(trade.id, result.status, result.patch)
      return
    }
    updateTradeData(trade.id, result.patch)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('链接已复制')
    } catch {
      toast('复制失败，请重试')
    }
  }

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(trade.ref)
      toast(`已复制 ${trade.ref}`)
    } catch {
      toast('复制失败，请重试')
    }
  }

  const sendComment = () => {
    if (!comment.trim()) return
    addComment(trade.id, comment)
    setComment('')
    requestAnimationFrame(() => {
      const el = commentRef.current
      if (el) el.style.height = 'auto'
    })
    toast('复盘追记已保存')
  }

  const onDelete = () => {
    const deletedId = trade.id
    removeTrade(deletedId)
    toast('已移至回收站，30 天后自动清空', {
      label: '撤销',
      onClick: () => {
        restoreTrade(deletedId)
        toast('已从回收站恢复')
      },
    })
    navigate(detailReturn, { state: tradeReturnLocationState(from?.anchorTradeId) })
  }

  const createReviewCaseFromTrade = () => {
    if (trade.tradeKind === 'case') return
    const reviewCase = buildReviewCaseFromTrade(trade, {
      id: crypto.randomUUID(),
      ref: getNextReviewCaseRef(trades),
    })
    upsertTrade(reviewCase)
    toast('已提炼为案例')
    navigate(tradeDetailPath(reviewCase), { state: location.state })
  }

  const detailCrumb =
    trade.tradeKind === 'case'
      ? '案例记录'
      : trade.tradeKind === 'paper'
        ? '模拟'
        : '交易日志'
  const detailUnit = trade.tradeKind === 'case'
    ? '案例'
    : trade.tradeKind === 'paper'
      ? '模拟交易'
      : '交易'
  const truth = resolveTradeTruth(trade)
  const needsResult =
    trade.tradeKind !== 'case' && truth.executionState === 'closed' && !truth.isResultComplete
  const hasResultConflict = needsResult && truth.hasConflict
  const needsReview =
    trade.tradeKind !== 'case' &&
    trade.reviewStatus !== 'reviewed' &&
    (truth.executionState === 'missed' ||
      (truth.executionState === 'closed' && truth.isResultComplete))
  const reviewComplete =
    trade.tradeKind !== 'case' &&
    trade.reviewStatus === 'reviewed' &&
    (truth.executionState === 'missed' || truth.executionState === 'closed')
  const sourceTrade = trade.sourceTradeId
    ? trades.find((item) => item.id === trade.sourceTradeId)
    : undefined

  const completeReview = async () => {
    if (reviewSubmitting || activeNoteLoad.status !== 'ready' || !reviewReadiness.ready) return

    setReviewSubmitting(true)
    setReviewIssue(null)
    try {
      const noteSaved = await flushNoteDraftToStore(trade.id)
      if (!noteSaved) {
        const message = '笔记图片尚未保存，复盘状态未变更'
        setReviewIssue(message)
        toast(message)
        return
      }

      const latestNote = useStore.getState().trades.find((item) => item.id === trade.id)?.note ?? ''
      const latestReadiness = evaluateReviewCompletion(latestNote)
      if (!latestReadiness.ready) {
        const message = latestReadiness.reason === 'empty'
          ? '笔记已变为空白，请补充复盘内容后重试'
          : '请补充复盘结论、勾选检查项或加入截图证据'
        setReviewIssue(message)
        toast(message)
        return
      }

      updateTradeData(trade.id, { reviewStatus: 'reviewed' })
      const nextPendingId = findNextPendingReviewId(
        trade.id,
        detailNavigation?.orderedIds ?? useShortcutStore.getState().listContext?.orderedIds ?? [],
        useStore.getState().trades,
      )
      if (nextPendingId) {
        toast(`${trade.ref} 复盘已完成`, {
          label: '下一条待复盘',
          onClick: () => navigateDetail(nextPendingId),
        })
      } else {
        toast(`${trade.ref} 复盘已完成`)
      }
    } finally {
      setReviewSubmitting(false)
    }
  }

  const updateCaseMastery = (masteryState: MasteryState) => {
    const nextReview = new Date()
    nextReview.setDate(nextReview.getDate() + (masteryState === 'new' ? 3 : 7))
    updateTradeData(trade.id, {
      masteryState,
      nextReviewAt: masteryState === 'mastered' ? null : formatYmd(nextReview),
      reviewStatus: masteryState === 'mastered' ? 'reviewed' : 'unreviewed',
      reviewCategory:
        masteryState === 'mastered'
          ? 'mastered'
          : masteryState === 'recheck'
            ? 'recheck'
            : trade.caseType === 'mistake'
              ? 'mistake'
              : trade.caseType === 'ambiguous'
                ? 'ambiguous'
                : 'normal',
    })
  }

  const favoriteButton = (
    <IconButton
      title={starred ? '取消星标' : '星标'}
      active={starred}
      onClick={() => {
        toggleStar(trade.id)
        toast(starred ? '已取消星标' : '已加入星标')
      }}
    >
      {starred ? <Star size={16} /> : <Favorite size={16} />}
    </IconButton>
  )

  const moreMenu = (
    <Menu
      options={[
        { value: 'edit', label: trade.tradeKind === 'case' ? '编辑案例记录' : '编辑交易', icon: <Pencil size={16} /> },
        ...(trade.tradeKind === 'case'
          ? []
          : [{ value: 'review-case', label: '提炼为案例', icon: <BookOpen size={16} /> }]),
        ...(reviewComplete
          ? [{ value: 'reopen-review', label: '重新复盘', icon: <RotateCcw size={16} /> }]
          : []),
        { value: 'copy-link', label: '复制链接', icon: <Link2 size={16} /> },
        { value: 'copy', label: '复制编号', icon: <Copy size={16} /> },
        { value: 'delete', label: trade.tradeKind === 'case' ? '删除案例记录' : '删除交易', icon: <Trash2 size={16} /> },
      ]}
      onSelect={(v) => {
        if (v === 'edit') openComposer(trade)
        else if (v === 'review-case') createReviewCaseFromTrade()
        else if (v === 'reopen-review') updateTradeData(trade.id, { reviewStatus: 'unreviewed' })
        else if (v === 'copy-link') copyLink()
        else if (v === 'copy') copyRef()
        else if (v === 'delete') onDelete()
      }}
      trigger={
        <IconButton ariaLabel="更多" title="更多">
          <MoreHorizontal size={15} />
        </IconButton>
      }
    />
  )

  return (
    <TradeDetailLayout
      header={(
      <header className="dv-topbar">
        <div className="dv-tb-left">
          <Link
            to={detailReturn}
            state={tradeReturnLocationState(from?.anchorTradeId)}
            className="dv-back"
            aria-label="返回列表"
          >
            <ChevronLeft size={16} />
          </Link>
          <span className="dv-crumb">{detailCrumb}</span>
          <ChevronRight size={13} className="dv-crumb-sep" />
          <span className="dv-crumb dv-crumb-active">{trade.ref}</span>
          <div className="dv-detail-crumb-actions">
            {favoriteButton}
            {moreMenu}
          </div>
        </div>
        <div className="dv-tb-right">
          {reviewComplete && (
            <Tooltip
              asChild
              content={trade.reviewedAt ? `复盘完成于 ${fmtDateTime(trade.reviewedAt)}` : '复盘已完成'}
              label={trade.reviewedAt ? `复盘完成于 ${fmtDateTime(trade.reviewedAt)}` : '复盘已完成'}
            >
              <span className="dv-review-complete-meta">
                <CheckCircle size={13} aria-hidden />
                <span>已复盘</span>
              </span>
            </Tooltip>
          )}
          <SaveStatusIndicator />
          {detailNavigation && (
            <nav className="dv-detail-navigation" aria-label={`${detailUnit}导航`}>
              <span
                className="dv-detail-position"
                aria-label={`第 ${detailNavigation.index + 1} 个，共 ${detailNavigation.orderedIds.length} 个${detailUnit}`}
              >
                {detailNavigation.index + 1}
                <span aria-hidden>/</span>
                {detailNavigation.orderedIds.length}
              </span>
              <ShortcutTooltip actionId="trade.next" label={`下一个${detailUnit}`}>
                <button
                  type="button"
                  className="dv-detail-nav-button"
                  disabled={!detailNavigation.nextId}
                  onClick={() => navigateDetail(detailNavigation.nextId)}
                >
                  <ChevronDown size={14} />
                </button>
              </ShortcutTooltip>
              <ShortcutTooltip actionId="trade.prev" label={`上一个${detailUnit}`}>
                <button
                  type="button"
                  className="dv-detail-nav-button"
                  disabled={!detailNavigation.prevId}
                  onClick={() => navigateDetail(detailNavigation.prevId)}
                >
                  <ChevronUp size={14} />
                </button>
              </ShortcutTooltip>
            </nav>
          )}
        </div>
      </header>
      )}
      content={(
          <div className="dv-main-inner">
            <div className="dv-title-row">
              <h1 className="dv-title">
                <SymbolIcon symbol={trade.symbol} overrides={symbolIcons} size={22} />
                {trade.symbol}
                <SideTag side={trade.side} />
              </h1>
              {needsReview && !needsResult && (
                <Tooltip
                  asChild
                  content={
                    reviewSubmitting
                      ? '正在保存…'
                      : reviewIssue ?? (reviewReadiness.ready ? '完成复盘' : '完成前请留下结论、勾选检查项或加入截图证据')
                  }
                  label={reviewSubmitting ? '正在保存…' : '完成复盘'}
                >
                  <button
                    type="button"
                    className={
                      'dv-review-chip' +
                      (reviewReadiness.ready ? '' : ' is-muted') +
                      (reviewSubmitting ? ' is-busy' : '')
                    }
                    aria-label={reviewSubmitting ? '正在保存…' : '完成复盘'}
                    disabled={
                      activeNoteLoad.status !== 'ready' ||
                      !reviewReadiness.ready ||
                      reviewSubmitting
                    }
                    onClick={() => void completeReview()}
                  >
                    <span className="dv-review-chip-dot" aria-hidden />
                    {reviewSubmitting ? '正在保存…' : '完成复盘'}
                  </button>
                </Tooltip>
              )}
            </div>
            {trade.tradeKind === 'case' && trade.sourceTradeId && (
              <section className="dv-case-source" aria-label="案例来源">
                <BookOpen size={15} aria-hidden />
                <div>
                  <span>来源交易</span>
                  <strong>{sourceTrade ? `${sourceTrade.ref} · ${sourceTrade.symbol}` : '原交易已不存在'}</strong>
                </div>
                {sourceTrade && (
                  <button type="button" onClick={() => navigate(tradeDetailPath(sourceTrade), { state: location.state })}>
                    查看原交易
                  </button>
                )}
              </section>
            )}
            {needsResult && (
              <section
                className={
                  'dv-review-stage' +
                  ' is-result-pending' +
                  (hasResultConflict ? ' is-result-conflict' : '')
                }
                aria-label="交易闭环状态"
              >
                <span className="dv-review-stage-icon">
                  <AlertCircle size={16} />
                </span>
                <div className="dv-review-stage-copy">
                  <strong>
                    {hasResultConflict ? '交易结果存在冲突' : '交易结果待补齐'}
                  </strong>
                  <span aria-live="polite">
                    {hasResultConflict
                      ? '盈亏、R 倍数或结算状态方向不一致，请核对后重新确认。'
                      : '补充盈亏或 R 倍数后，才会计入统计。'}
                  </span>
                </div>
                <div className="dv-review-stage-actions">
                  <button
                    type="button"
                    onClick={() => requestTradeClose(
                      trade.id,
                      trade.status === 'win' || trade.status === 'loss' || trade.status === 'breakeven'
                        ? trade.status
                        : undefined,
                    )}
                  >
                    {hasResultConflict ? '修正结果' : '补齐结果'}
                  </button>
                </div>
              </section>
            )}
            <div
              className={'dv-document'
                + (activeNoteLoad.status === 'loading' ? ' is-note-loading' : '')
                + (activeNoteLoad.status === 'error' ? ' is-note-readonly' : '')}
            >
              <div className="dv-note-status">
                {activeNoteLoad.status === 'loading' && (
                  <div className="dv-note-load is-loading" role="status" aria-live="polite">
                    <span className="dv-note-load-indicator" aria-hidden />
                    <span>复盘笔记载入中…</span>
                  </div>
                )}
                {activeNoteLoad.status === 'error' && (
                  <div className="dv-note-load is-error" role="alert">
                    <AlertCircle size={16} aria-hidden />
                    <div>
                      <strong>复盘笔记未完整载入</strong>
                      <span>
                        {activeNoteLoad.reason === 'prepare'
                          ? '上一份笔记草稿尚未安全保存，当前内容已锁定；请重试载入。'
                          : '图片附件读取失败，正文已安全保留；当前为只读模式。'}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={noteRetrying}
                      onClick={() => {
                        setNoteRetrying(true)
                        setNoteLoadAttempt((value) => value + 1)
                      }}
                    >
                      <RotateCcw size={14} aria-hidden />
                      {noteRetrying ? '正在载入…' : '重新载入'}
                    </button>
                  </div>
                )}
              </div>
              <Editor
                content={noteEditorContent}
                onChange={onEditorChange}
                ariaLabel={trade.tradeKind === 'case' ? '案例复盘笔记' : '交易复盘笔记'}
                noteDraftId={trade.id}
                readOnly={activeNoteLoad.status !== 'ready'}
                reviewContextTools
                reviewTemplates={reviewTemplates}
                reviewContextPinned={reviewContextPinned}
                placeholder={
                  trade.tradeKind === 'case'
                    ? '写下案例复盘思路…'
                    : '写下复盘思路…'
                }
              />
            </div>

            <section className="dv-comments" aria-label="复盘追记">
              <h2 className="dv-comments-title">
                复盘追记{commentItems.length > 0 ? ` · ${commentItems.length}` : ''}
              </h2>
              {commentItems.length > 0 && (
                <ul className="dv-feed dv-comment-feed">
                  {commentItems.map(({ event, node }) => (
                    <FeedItem
                      key={event.id}
                      kind={event.kind}
                      deletable
                      onDelete={event.commentId ? () => {
                        removeComment(trade.id, event.commentId!)
                        toast('复盘追记已删除')
                      } : undefined}
                    >
                      {node}
                    </FeedItem>
                  ))}
                </ul>
              )}
              <div className="dv-comment">
                <UserAvatar className="dv-comment-avatar" />
                <div className={`dv-comment-box${comment.trim() ? ' has-value' : ''}`}>
                  <textarea
                    ref={commentRef}
                    className="dv-comment-input"
                    aria-label="新增复盘追记"
                    placeholder="补充观察…"
                    value={comment}
                    onChange={(event) => {
                      setComment(event.target.value)
                      adjustCommentHeight()
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        sendComment()
                      }
                    }}
                    rows={1}
                  />
                  <div className="dv-comment-bar">
                    <Tooltip content="保存追记" label="保存追记">
                      <button
                        type="button"
                        className="dv-comment-send"
                        disabled={!comment.trim()}
                        onClick={sendComment}
                        aria-label="保存追记"
                      >
                        <Send size={14} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </section>

            {activities.system.length > 0 && (
              <section className="dv-system-activity">
                <button
                  type="button"
                  className="dv-activity-toggle"
                  aria-expanded={activityOpen}
                  onClick={() => setActivityOpen((open) => !open)}
                >
                  <span>活动记录 · {activities.system.length}</span>
                  <ChevronDown size={13} className={activityOpen ? 'is-open' : ''} />
                </button>
                {activityOpen && (
                  <div className="dv-activity-panel">
                    {feedHiddenCount > 0 && (
                      <button type="button" className="dv-feed-more" onClick={() => setFeedExpanded(true)}>
                        展开更早的 {feedHiddenCount} 条
                      </button>
                    )}
                    <ul className="dv-feed">
                      {systemFeedItems.map(({ event, node }) => (
                        <FeedItem key={event.id} kind={event.kind}>{node}</FeedItem>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
          </div>
      )}
      properties={(
        <>
          <Section title="属性">
            <Menu
              value={trade.status}
              onSelect={(v) =>
                transitionTradeStatus(trade, v as TradeStatus, {
                  setStatus,
                  requestTradeClose,
                  toast,
                })
              }
              options={STATUS_OPTS.map((s) => ({
                value: s,
                label: STATUS_META[s].label,
                icon: <StatusIcon status={s} size={16} />,
              }))}
              trigger={
                <PropTrigger label="状态">
                  <StatusIcon status={trade.status} size={15} />
                  <span>{STATUS_META[trade.status].label}</span>
                </PropTrigger>
              }
            />
            <Menu
              value={trade.conviction}
              onSelect={(v) => setConviction(trade.id, v as Conviction)}
              options={CONV_OPTS.map((c) => ({
                value: c,
                label: CONVICTION_META[c].label,
                icon: <ConvictionIcon conviction={c} size={16} />,
              }))}
              trigger={
                <PropTrigger label="信心度">
                  <ConvictionIcon conviction={trade.conviction} size={15} />
                  <span>{CONVICTION_META[trade.conviction].label}</span>
                </PropTrigger>
              }
            />
            <Menu
              value={trade.side}
              onSelect={(v) => commitTradeResultEdit({
                kind: 'execution',
                patch: { side: v as TradeSide },
              })}
              options={[
                { value: 'long', label: '做多' },
                { value: 'short', label: '做空' },
              ]}
              trigger={
                <PropTrigger label="方向">
                  <SideTag side={trade.side} />
                  <span>{trade.side === 'long' ? '做多' : '做空'}</span>
                </PropTrigger>
              }
            />
            <Menu
              value={resolveTimeframe(trade.timeframe)}
              onSelect={(v) =>
                updateTradeData(trade.id, {
                  timeframe: resolveTimeframe(v),
                })
              }
              options={TIMEFRAME_PRESETS.map((preset) => ({
                value: preset,
                label: preset,
              }))}
              trigger={
                <PropTrigger label="波段级别">
                  <span
                    className={
                      'dv-prop-chip is-timeframe is-' +
                      getTimeframeTone(resolveTimeframe(trade.timeframe))
                    }
                  >
                    {resolveTimeframe(trade.timeframe)}
                  </span>
                </PropTrigger>
              }
            />
            <Menu
              value={getSessionSelectValue(trade)}
              onSelect={(v) =>
                updateTradeData(trade.id, {
                  session: normalizeSession(v),
                })
              }
              options={[
                { value: '', label: '未设置' },
                ...SESSION_PRESETS.map((preset) => ({
                  value: preset.value,
                  label: preset.label,
                })),
              ]}
              trigger={
                <PropTrigger label="交易时段">
                  {getSessionSelectValue(trade) ? (
                    <span
                      className={
                        'dv-prop-chip is-session is-' +
                        (getTradeSessionMeta(trade)?.kind ?? 'other')
                      }
                    >
                      {SESSION_PRESETS.find((p) => p.value === getSessionSelectValue(trade))
                        ?.label ?? getSessionSelectValue(trade)}
                    </span>
                  ) : (
                    <span className="dv-prop-empty">未设置</span>
                  )}
                </PropTrigger>
              }
            />
            <Menu
              value={trade.psychology ?? ''}
              onSelect={(v) =>
                updateTradeData(trade.id, {
                  psychology: normalizePsychology(v),
                })
              }
              options={[
                { value: '', label: '未设置' },
                ...PSYCHOLOGY_PRESETS.map((preset) => ({
                  value: preset.value,
                  label: preset.label,
                })),
              ]}
              trigger={
                <PropTrigger label="心理状态">
                  {trade.psychology ? (
                    <span className="dv-prop-chip is-neutral">
                      {PSYCHOLOGY_PRESETS.find((p) => p.value === trade.psychology)?.label ??
                        trade.psychology}
                    </span>
                  ) : (
                    <span className="dv-prop-empty">未设置</span>
                  )}
                </PropTrigger>
              }
            />
            <Menu
              value={trade.narrative ?? ''}
              onSelect={(v) =>
                updateTradeData(trade.id, {
                  narrative: normalizeNarrative(v),
                })
              }
              options={[
                { value: '', label: '未设置' },
                ...NARRATIVE_PRESETS.map((preset) => ({
                  value: preset.value,
                  label: preset.label,
                })),
              ]}
              trigger={
                <PropTrigger label="市场叙事">
                  {trade.narrative ? (
                    <span className="dv-prop-chip is-neutral">
                      {NARRATIVE_PRESETS.find((p) => p.value === trade.narrative)?.label ??
                        trade.narrative}
                    </span>
                  ) : (
                    <span className="dv-prop-empty">未设置</span>
                  )}
                </PropTrigger>
              }
            />
            <Menu
              value={trade.tradeKind}
              onSelect={(v) => transitionTradeKind(trade.id, v as TradeKind)}
              options={KIND_OPTS.map((k) => ({
                value: k,
                label: TRADE_KIND_META[k].label,
              }))}
              trigger={
                <PropTrigger label="类型">
                  <span className="dv-prop-chip is-neutral">
                    {TRADE_KIND_META[trade.tradeKind].label}
                  </span>
                </PropTrigger>
              }
            />
            {trade.tradeKind === 'case' && (
              <>
                <Menu
                  value={trade.caseType ?? 'exemplar'}
                  onSelect={(v) => updateTradeData(trade.id, { caseType: v as CaseType })}
                  options={CASE_TYPE_OPTS.map((value) => ({
                    value,
                    label: CASE_TYPE_META[value].label,
                  }))}
                  trigger={
                    <PropTrigger label="案例类型">
                      <span className="dv-prop-chip is-category">
                        {CASE_TYPE_META[trade.caseType ?? 'exemplar'].label}
                      </span>
                    </PropTrigger>
                  }
                />
                <Menu
                  value={trade.masteryState ?? 'new'}
                  onSelect={(v) => updateCaseMastery(v as MasteryState)}
                  options={MASTERY_OPTS.map((value) => ({
                    value,
                    label: MASTERY_STATE_META[value].label,
                  }))}
                  trigger={
                    <PropTrigger label="掌握状态">
                      <span className="dv-prop-chip is-neutral">
                        {MASTERY_STATE_META[trade.masteryState ?? 'new'].label}
                      </span>
                    </PropTrigger>
                  }
                />
              </>
            )}
            {trade.status === 'missed' && (
              <Menu
                value={trade.missReason ?? 'other'}
                onSelect={(v) => updateTradeData(trade.id, { missReason: v as MissReason })}
                options={MISS_OPTS.map((r) => ({
                  value: r,
                  label: MISS_REASON_META[r].label,
                }))}
                trigger={
                  <PropTrigger label="错过原因">
                    <span className="dv-prop-chip is-neutral">
                      {MISS_REASON_META[trade.missReason ?? 'other'].label}
                    </span>
                  </PropTrigger>
                }
              />
            )}
          </Section>

          <Section title="交易数据">
            <EditableDataRow
              label="仓位"
              value={trade.size}
              format={String}
              inputType="number"
              onSave={(v) => commitTradeResultEdit({
                kind: 'execution',
                patch: { size: v as number },
              })}
            />
            <EditableDataRow
              label="止损"
              value={trade.stopLoss ?? null}
              format={(v) => (v == null ? '—' : fmtPrice(v))}
              inputType="number"
              nullable
              onSave={(v) => commitTradeResultEdit({
                kind: 'execution',
                patch: { stopLoss: v as number | null },
              })}
            />
            <EditableDataRow
              label="盈亏"
              value={trade.pnl}
              format={(v) =>
                trade.status === 'planned' || trade.status === 'open'
                  ? '—'
                  : fmtMoney(v as number, privacyMode)
              }
              inputType="number"
              nullable
              color={
                privacyMode
                  ? undefined
                  : trade.pnl != null && trade.pnl > 0
                  ? 'var(--pos)'
                  : trade.pnl != null && trade.pnl < 0
                    ? 'var(--neg)'
                    : undefined
              }
              masked={privacyMode}
              onSave={(v) => commitTradeResultEdit({
                kind: 'result',
                source: 'pnl',
                value: v as number | null,
              })}
            />
            <EditableDataRow
              label="R 倍数"
              value={trade.rMultiple}
              format={(v) =>
                trade.status === 'planned' || trade.status === 'open'
                  ? '—'
                  : fmtR(v as number)
              }
              inputType="number"
              step="0.1"
              nullable
              color={
                trade.rMultiple != null && trade.rMultiple > 0
                  ? 'var(--pos)'
                  : trade.rMultiple != null && trade.rMultiple < 0
                    ? 'var(--neg)'
                    : undefined
              }
              onSave={(v) => commitTradeResultEdit({
                kind: 'result',
                source: 'r',
                value: v as number | null,
              })}
            />
          </Section>

          <Section title="时间" defaultOpen={false}>
            <EditableDateRow
              label="开仓"
              value={trade.openedAt}
              onSave={(v) => updateTradeData(trade.id, { openedAt: v })}
            />
            {isTerminal(trade.status) ? (
              <EditableDateRow
                label="平仓"
                value={trade.closedAt ?? trade.openedAt}
                onSave={(v) => updateTradeData(trade.id, { closedAt: v })}
              />
            ) : (
              <DataRow label="平仓" value="—" />
            )}
            {trade.tradeKind === 'case' && trade.masteryState !== 'mastered' && trade.nextReviewAt && (
              <EditableDateRow
                label="下次复看"
                value={trade.nextReviewAt}
                onSave={(value) => updateTradeData(trade.id, { nextReviewAt: value })}
              />
            )}
          </Section>

          <Section title="标签" defaultOpen={false}>
            <TagEditor
              tags={trade.tags}
              suggestions={tagPresets}
              presets={tagPresets}
              showPresets={false}
              onAdd={(tag) => addTag(trade.id, tag)}
              onRemove={(tag) => removeTag(trade.id, tag)}
            />
          </Section>

          <Section title="错误 / 违规">
            <TagEditor
              tags={trade.mistakeTags}
              suggestions={mistakeTagPresets}
              presets={mistakeTagPresets}
              showPresets={false}
              onAdd={(tag) =>
                updateTradeData(trade.id, {
                  mistakeTags: trade.mistakeTags.includes(tag)
                    ? trade.mistakeTags
                    : [...trade.mistakeTags, tag],
                })
              }
              onRemove={(tag) =>
                updateTradeData(trade.id, {
                  mistakeTags: trade.mistakeTags.filter((t) => t !== tag),
                })
              }
            />
          </Section>

          <Section title="策略" defaultOpen={false}>
            <Menu
              value={trade.strategyId}
              onSelect={(v) => setStrategy(trade.id, v)}
              options={strategies.map((s) => ({
                value: s.id,
                label: s.name,
                icon: <StrategyIcon icon={s.icon} color={s.color} size={16} />,
              }))}
              trigger={
                <button className="dv-pitem dv-pitem-ghost">
                  <StrategyLabel strategyId={trade.strategyId} strategies={strategies} />
                </button>
              }
            />
            <Link to="/settings/strategies" className="dv-strategy-manage">
              管理策略…
            </Link>
          </Section>

          <div className="dv-props-foot">
            <button className="dv-copy-id" onClick={copyRef}>
              <Copy size={13} />
              <span>复制 {trade.ref}</span>
            </button>
          </div>
        </>
      )}
    />
  )
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="dv-section">
      <button className="dv-section-head" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <ChevronDown
          size={13}
          className={'dv-section-chev' + (open ? '' : ' is-closed')}
        />
      </button>
      {open && <div className="dv-section-body">{children}</div>}
    </div>
  )
}

function PropTrigger({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <button type="button" className="dv-prop-row">
      <span className="dv-prop-label">{label}</span>
      <span className="dv-prop-value">{children}</span>
    </button>
  )
}

function EditableDataRow({
  label,
  value,
  format,
  inputType = 'text',
  step,
  nullable,
  color,
  masked = false,
  onSave,
}: {
  label: string
  value: number | null
  format: (v: number | null) => string
  inputType?: 'number' | 'text'
  step?: string
  nullable?: boolean
  color?: string
  masked?: boolean
  onSave: (v: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    if (masked) return
    setDraft(value == null ? '' : String(value))
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (nullable && draft.trim() === '') {
      if (value !== null) onSave(null)
      return
    }
    const num = parseFloat(draft)
    if (isNaN(num)) return
    if (num !== value) onSave(num)
  }

  if (editing) {
    return (
      <div className="dv-datarow dv-datarow-edit">
        <span className="dv-datarow-label">{label}</span>
        <input
          ref={inputRef}
          className="dv-datarow-input"
          aria-label={label}
          type={inputType}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              e.stopPropagation()
              setEditing(false)
            }
          }}
        />
      </div>
    )
  }

  return masked ? (
    <Tooltip asChild content="直播模式下已隐藏盈亏金额" label="直播模式下已隐藏盈亏金额">
      <button
        className="dv-datarow dv-datarow-btn"
        onClick={startEdit}
        type="button"
        aria-disabled
      >
        <span className="dv-datarow-label">{label}</span>
        <span className="dv-datarow-value" style={color ? { color } : undefined}>
          {format(value)}
        </span>
      </button>
    </Tooltip>
  ) : (
    <button
      className="dv-datarow dv-datarow-btn"
      onClick={startEdit}
      type="button"
    >
      <span className="dv-datarow-label">{label}</span>
      <span className="dv-datarow-value" style={color ? { color } : undefined}>
        {format(value)}
      </span>
    </button>
  )
}

function EditableDateRow({
  label,
  value,
  onSave,
}: {
  label: string
  value: string
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value.slice(0, 10))
  if (editing) {
    return (
      <div className="dv-datarow dv-datarow-edit">
        <span className="dv-datarow-label">{label}</span>
        <DatePicker
          className="dv-date-picker"
          ariaLabel={label}
          value={draft}
          autoFocus
          autoOpen
          onOpenChange={(open) => {
            if (!open) setEditing(false)
          }}
          onValueChange={(next) => {
            setDraft(next)
            if (next && next !== value.slice(0, 10)) onSave(next)
            setEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <button className="dv-datarow dv-datarow-btn" onClick={() => setEditing(true)} type="button">
      <span className="dv-datarow-label">{label}</span>
      <span className="dv-datarow-value">{fmtDate(value)}</span>
    </button>
  )
}

function DataRow({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="dv-datarow">
      <span className="dv-datarow-label">{label}</span>
      <span className="dv-datarow-value" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  )
}


function renderActivity(
  event: DisplayActivityEvent,
  strategies: Strategy[],
  tradeKind: TradeKind,
): React.ReactNode {
  const time = fmtDateTime(event.timestamp)
  switch (event.kind) {
    case 'create':
      return (
        <>
          你 <b>创建</b>了{tradeKind === 'case' ? '这条案例记录' : '这笔交易'} · {fmtDate(event.timestamp)}
        </>
      )
    case 'status':
      return (
        <>
          你将状态改为 <b>{STATUS_META[event.status!].label}</b> · {time}
        </>
      )
    case 'strategy':
      return (
        <>
          你将策略改为 <b>{getStrategyName(strategies, event.strategyId)}</b> · {time}
        </>
      )
    case 'tag':
      return event.tagAction === 'remove' ? (
        <>
          你移除了标签 <b>{event.tag}</b> · {time}
        </>
      ) : (
        <>
          你添加了标签 <b>{event.tag}</b> · {time}
        </>
      )
    case 'comment':
      return (
        <>
          你补充了 <b>复盘追记</b>：{event.text} · {time}
        </>
      )
    case 'note': {
      const edits = event.noteEditCount ?? 1
      return (
        <>
          你 <b>更新了复盘笔记</b>
          {edits > 1 ? `（${edits} 次）` : ''} · {time}
        </>
      )
    }
    case 'tradeKind': {
      const fromLabel = event.fromTradeKind ? TRADE_KIND_META[event.fromTradeKind]?.label : ''
      const toLabel = event.toTradeKind ? TRADE_KIND_META[event.toTradeKind]?.label : ''
      return (
        <>
          你将类型从 <b>{fromLabel}</b> 改为 <b>{toLabel}</b> · {time}
        </>
      )
    }
    default:
      return null
  }
}

function FeedItem({
  kind,
  children,
  deletable,
  onDelete,
}: {
  kind: ActivityKind
  children: React.ReactNode
  deletable?: boolean
  onDelete?: () => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const handleContextMenu = (e: React.MouseEvent) => {
    if (!deletable || !onDelete) return
    e.preventDefault()
    setDeleteOpen(true)
  }

  return (
    <>
      <li
        className={'dv-feed-item' + (deletable ? ' dv-feed-item-deletable' : '')}
        onContextMenu={handleContextMenu}
      >
        <span className={'dv-feed-dot dv-feed-dot-' + kind} />
        <span className="dv-feed-text">{children}</span>
        {deletable && onDelete && (
          <Tooltip content="删除追记" label="删除追记">
            <button
              type="button"
              className="dv-feed-delete"
              aria-label="删除追记"
              onClick={() => setDeleteOpen(true)}
            >
              <X size={13} />
            </button>
          </Tooltip>
        )}
      </li>
      {deleteOpen && onDelete ? (
        <ModalShell
          title="删除这条复盘追记？"
          description="删除后无法恢复。"
          size="compact"
          onClose={() => setDeleteOpen(false)}
          footer={(
            <>
              <button
                type="button"
                className="ui-btn ui-btn-bordered"
                data-autofocus
                onClick={() => setDeleteOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-danger-solid"
                onClick={() => {
                  setDeleteOpen(false)
                  onDelete()
                }}
              >
                删除追记
              </button>
            </>
          )}
        />
      ) : null}
    </>
  )
}
