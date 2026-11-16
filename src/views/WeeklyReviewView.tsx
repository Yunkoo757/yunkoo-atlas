import { buildWeeklyReviewHistory } from '@/lib/weeklyReviewHistory'
import { Button } from '@/components/ui/Button'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { PopoverSurface } from '@/components/ui/PopoverSurface'
import { AssetObjectUrlScope } from '@/storage/assetObjectUrls'
import { ICON_LG, ICON_MD, ICON_XL } from '@/icons/iconSize'
import { lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Link,
  UNSAFE_DataRouterContext,
  UNSAFE_NavigationContext,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { Editor } from '@/editor/Editor'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Target,
  TrendingUp,
} from '@/icons/appIcons'
import {
  buildWeeklyReviewMetrics,
  buildWeeklyReviewTradeSelection,
  buildWeeklyReviewTrend,
  aggregateWeeklyReviewScoresForWeek,
  createWeeklyReview,
  missingWeeklyReviewSnapshotCategories,
  missedTradesInWeek,
  resolveWeeklyReviewDataSource,
  summarizeWeeklyMistakeDimensions,
  WEEKLY_MISTAKE_DIMENSIONS,
  weeklyReviewScoreAverage,
  weekEndFor,
  weekStartFor,
  type WeeklyReview,
  type WeeklyReviewEvidenceTrade,
  type WeeklyCommitmentResult,
} from '@/data/weeklyReviews'
import { MISS_REASON_META, type MissReason, type Trade } from '@/data/trades'
import { fmtMoney, fmtR } from '@/lib/format'
import { formatTradeCashPnl } from '@/lib/cashCurrency'
import type { LegacyCashCurrencyAssumption } from '@/storage/types'
import { parseLocalDate, formatYmd } from '@/lib/periods'
import { toast } from '@/lib/toast'
import { getWeeklyReviewCompletionIssue } from '@/lib/weeklyReviewCompletion'
import {
  buildWeeklyReviewReturnSearch,
  buildWeeklyReviewSearch,
  resolveWeeklyReviewRouteState,
  type WeeklyReviewTab,
} from '@/lib/weeklyReviewRouteState'
import { Tooltip } from '@/components/ui/Tooltip'
import { InlineStatus } from '@/components/ui/InlineStatus'
import { IconButton } from '@/components/ui/IconButton'
import { Select } from '@/components/ui/Select'
import {
  tradeDetailNavState,
  tradeDetailPath,
  type TradeDetailFrom,
} from '@/lib/tradeRoute'
import { getWeeklyRiskStatus } from '@/lib/weeklyRiskPresentation'
import { WeeklyRiskEvidence } from '@/views/WeeklyRiskEvidence'
import { resolveNoteForDisplayResult } from '@/storage/assets'
import { getStorage } from '@/storage/bootstrap'
import {
  flushNoteDraftToStore,
  setNoteDraft,
  WEEKLY_REVIEW_DRAFT_PREFIX,
} from '@/storage/noteDrafts'
import { useStore } from '@/store/useStore'
import { parseTradeWorkspaceQuery } from '@/lib/tradeWorkspaceQuery'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import {
  peekTradeReturnRequest,
  rememberTradeReturnAnchor,
  useTradeReturnAnchor,
} from '@/hooks/useTradeReturnAnchor'
import {
  focusWeeklyIssue,
  getWeeklyVisualIssues,
  type WeeklyVisualIssue,
} from '@/lib/weeklyReviewVisualState'
import './WeeklyReviewView.css'

const WeeklyReviewScoreChart = lazy(() =>
  import('./WeeklyReviewScoreChart').then((module) => ({ default: module.WeeklyReviewScoreChart })),
)

const STRENGTH_TAGS = ['耐心等待', '计划内交易', '执行果断', '仓位克制', '及时止损', '复盘充分']
const SCORE_FIELDS = [
  { key: 'executionScore', fieldId: 'score-execution', label: '执行纪律' },
  { key: 'riskScore', fieldId: 'score-risk', label: '风险管理' },
  { key: 'emotionScore', fieldId: 'score-emotion', label: '情绪稳定' },
] as const
const SCORE_LEVELS = [
  { value: 1, label: '明显偏离' },
  { value: 2, label: '需要纠正' },
  { value: 3, label: '基本做到' },
  { value: 4, label: '执行良好' },
  { value: 5, label: '稳定执行' },
] as const
const COMMITMENT_RESULTS: { value: WeeklyCommitmentResult; label: string }[] = [
  { value: 'done', label: '做到' },
  { value: 'partial', label: '部分做到' },
  { value: 'missed', label: '未做到' },
  { value: 'not-applicable', label: '本周不适用' },
]
const SNAPSHOT_CATEGORY_LABELS = {
  metrics: '指标快照',
  evidence: '交易证据快照',
  risk: '风控快照',
}

const UNSAVED_CONTENT_ISSUE: WeeklyVisualIssue = {
  key: 'review-content-unsaved',
  sectionId: 'judgment',
  fieldId: 'review-content',
  message: '正文或图片尚未保存，请重试',
}

type ReviewPatch = Partial<Pick<
  WeeklyReview,
  | 'executionScore'
  | 'riskScore'
  | 'emotionScore'
  | 'strengthTags'
  | 'mistakeTags'
  | 'highlightTradeIds'
  | 'mistakeTradeIds'
  | 'followUpTradeIds'
  | 'contentHtml'
  | 'commitmentText'
  | 'commitmentCriteria'
  | 'previousCommitmentResult'
>>

function addDays(ymd: string, days: number): string {
  const next = parseLocalDate(ymd)
  next.setDate(next.getDate() + days)
  return formatYmd(next)
}

function formatWeekRange(start: string): string {
  const end = weekEndFor(start)
  const left = parseLocalDate(start)
  const right = parseLocalDate(end)
  return left.getMonth() === right.getMonth()
    ? `${left.getMonth() + 1}月${left.getDate()}日 – ${right.getDate()}日`
    : `${left.getMonth() + 1}月${left.getDate()}日 – ${right.getMonth() + 1}月${right.getDate()}日`
}

function weekLabel(start: string, currentWeek: string, isCurrentStage = false): string {
  if (isCurrentStage && start === currentWeek) return '本周'
  if (isCurrentStage && start === addDays(currentWeek, -7)) return '上周'
  return `${parseLocalDate(start).getMonth() + 1}月${parseLocalDate(start).getDate()}日`
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function WeeklyResultIssueLink({
  tradeId,
  trades,
  testId,
  children,
  detailFrom,
}: {
  tradeId: string | undefined
  trades: readonly Trade[]
  testId: string
  children: ReactNode
  detailFrom: (anchorTradeId: string) => TradeDetailFrom
}) {
  const trade = tradeId ? trades.find((item) => item.id === tradeId) : undefined
  if (!trade) return null
  const from = detailFrom(`weekly-trade:${trade.id}`)
  return (
    <Link
      className="wr-data-warning-link"
      data-weekly-result-link={testId}
      to={tradeDetailPath(trade)}
      state={tradeDetailNavState(from)}
      onClick={() => rememberTradeReturnAnchor(from)}
    >
      {children}
    </Link>
  )
}

function TradeEvidence({
  trade,
  review,
  onPatch,
  detailFrom,
  legacyCashCurrencyAssumption,
}: {
  trade: WeeklyReviewEvidenceTrade
  review: WeeklyReview
  onPatch: (patch: ReviewPatch) => void
  detailFrom: TradeDetailFrom
  legacyCashCurrencyAssumption: LegacyCashCurrencyAssumption | null
}) {
  const privacyMode = useStore((state) => state.display.privacyMode)
  const isMissedTrade = trade.status === 'missed'
  const result = isMissedTrade
    ? `错过 · ${MISS_REASON_META[trade.missReason ?? 'other'].label}`
    : typeof trade.pnl === 'number'
      ? formatTradeCashPnl(trade, legacyCashCurrencyAssumption, privacyMode)
      : fmtR(trade.rMultiple)
  const roleButtons = [
    { key: 'highlightTradeIds' as const, label: '做得好' },
    { key: 'mistakeTradeIds' as const, label: '犯错' },
    { key: 'followUpTradeIds' as const, label: '待研究' },
  ]
  return (
    <article className="wr-trade-row" data-trade-id={detailFrom.anchorTradeId}>
      <Link
        to={tradeDetailPath(trade)}
        state={tradeDetailNavState(detailFrom)}
        onClick={() => rememberTradeReturnAnchor(detailFrom)}
        className="wr-trade-main"
        data-trade-primary-action
      >
        <span className="wr-symbol">{trade.symbol}</span>
        <span>{trade.ref}</span>
        <span className={`wr-result ${isMissedTrade ? 'is-missed' : trade.status === 'loss' ? 'is-negative' : trade.status === 'win' ? 'is-positive' : ''}`}>
          {result}
        </span>
      </Link>
      {!isMissedTrade ? (
        <div className="wr-trade-roles" aria-label={`${trade.symbol} 复盘角色`}>
          {roleButtons.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={review[key].includes(trade.id)}
              onClick={() => onPatch({ [key]: toggleValue(review[key], trade.id) })}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function WeeklyReviewView({ header }: { header?: ReactNode } = {}) {
  const trades = useStore((state) => state.trades)
  const privacyMode = useStore((state) => state.display.privacyMode)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const legacyCashCurrencyAssumption = useStore((state) => state.profile.legacyCashCurrencyAssumption)
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const reviews = useStore((state) => state.weeklyReviews)
  const assignedReviews = useMemo(
    () => reviews.filter((review) => typeof review.liveStageId === 'string'),
    [reviews],
  )
  const upsertReview = useStore((state) => state.upsertWeeklyReview)
  const updateReview = useStore((state) => state.updateWeeklyReview)
  const completeWeeklyReview = useStore((state) => state.completeWeeklyReview)
  const reopenWeeklyReview = useStore((state) => state.reopenWeeklyReview)
  const businessDateAnchor = useBusinessDateAnchor()
  const currentWeek = weekStartFor(parseLocalDate(businessDateAnchor.currentTradingDayKey))
  const location = useLocation()
  const navigate = useNavigate()
  const workspaceQuery = useMemo(
    () => parseTradeWorkspaceQuery(location.search, liveStages, currentLiveStageId),
    [currentLiveStageId, liveStages, location.search],
  )
  const selectedReviewStage = workspaceQuery.stage === 'current'
    ? liveStages.find((stage) => stage.id === currentLiveStageId)
    : workspaceQuery.stage === 'all-history'
      ? [...liveStages].filter((stage) => stage.status === 'archived').sort((left, right) => right.sequence - left.sequence)[0]
      : liveStages.find((stage) => stage.id === workspaceQuery.stage)
  const selectedReviewStageId = selectedReviewStage?.id ?? currentLiveStageId
  const returnRequest = peekTradeReturnRequest(
    { pathname: location.pathname, search: location.search },
    location.state,
  )
  const verifiedReturnWeekRef = useRef<string | undefined>(undefined)
  const verifiedReturnReviewIdRef = useRef<string | undefined>(undefined)
  const requestedReturnWeek = returnRequest?.restoreSearch === undefined
    ? null
    : new URLSearchParams(returnRequest.restoreSearch).get('week')
  const requestedReturnReviewId = returnRequest?.restoreSearch === undefined
    ? null
    : new URLSearchParams(returnRequest.restoreSearch).get('review')
  if (requestedReturnWeek) verifiedReturnWeekRef.current = requestedReturnWeek
  if (requestedReturnReviewId) verifiedReturnReviewIdRef.current = requestedReturnReviewId
  const [returnRestoreActive, setReturnRestoreActive] = useState(Boolean(returnRequest))
  const allStages = workspaceQuery.stage === 'all'
  const historyItems = useMemo(() => buildWeeklyReviewHistory({
    trades, reviews: assignedReviews, stageIds: liveStages.map((stage) => stage.id),
    selectedStageId: selectedReviewStageId, currentWeek, tradingDayStartHour,
    currentTradingDayKey: businessDateAnchor.currentTradingDayKey, allStages,
  }), [trades, assignedReviews, liveStages, selectedReviewStageId, currentWeek, tradingDayStartHour, businessDateAnchor.currentTradingDayKey, allStages])
  const availableWeeks = useMemo(() => [...new Set(historyItems.map((item) => item.week))], [historyItems])
  const routeReviews = useMemo(() => allStages
    ? historyItems.map((item) => ({ id: item.routeId, weekStart: item.week, liveStageId: item.liveStageId }))
    : assignedReviews, [allStages, historyItems, assignedReviews])
  const routeResolution = useMemo(
    () => resolveWeeklyReviewRouteState(
      returnRequest?.restoreSearch ?? location.search,
      {
        currentWeek,
        availableWeeks,
        availableReviews: routeReviews.map((review) => ({
          id: review.id,
          weekStart: review.weekStart,
          liveStageId: review.liveStageId,
        })),
        currentLiveStageId: selectedReviewStageId,
        verifiedReturnWeek: verifiedReturnWeekRef.current,
        verifiedReturnReviewId: verifiedReturnReviewIdRef.current,
      },
    ),
    [routeReviews, availableWeeks, currentWeek, location.search, returnRequest?.restoreSearch, selectedReviewStageId],
  )
  const { selectedWeek, selectedReviewId, tab } = routeResolution.state
  const [editorHtml, setEditorHtml] = useState('')
  const [showAllEvidence, setShowAllEvidence] = useState(Boolean(returnRequest))
  const mainContentRef = useRef<HTMLElement>(null)
  const historyPickerRef = useRef<HTMLDetailsElement>(null)
  const evidenceRef = useRef<HTMLDetailsElement>(null)
  const riskRef = useRef<HTMLDetailsElement>(null)
  const openEvidence = useCallback((kind: 'evidence' | 'risk') => {
    const target = kind === 'evidence' ? evidenceRef.current : riskRef.current
    if (!target) return
    target.open = true
    target.querySelector('summary')?.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [])
  useEffect(() => {
    const closePicker = (event: PointerEvent | KeyboardEvent) => {
      const picker = historyPickerRef.current
      if (!picker?.open || event.defaultPrevented) return
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape' || document.querySelector('.ui-select-menu')) return
        picker.open = false
        picker.querySelector('summary')?.focus()
        event.preventDefault()
      } else if (event.target instanceof Element && !picker.contains(event.target) && !event.target.closest('[role="listbox"], [role="option"], [role="dialog"]')) {
        picker.open = false
      }
    }
    document.addEventListener('pointerdown', closePicker)
    document.addEventListener('keydown', closePicker)
    return () => {
      document.removeEventListener('pointerdown', closePicker)
      document.removeEventListener('keydown', closePicker)
    }
  }, [])
  const [overrideEventsOpen, setOverrideEventsOpen] = useState(false)
  const [trendLiveStageId, setTrendLiveStageId] = useState<string | undefined>(allStages ? undefined : selectedReviewStageId)
  useEffect(() => setTrendLiveStageId(allStages ? undefined : selectedReviewStageId), [allStages, selectedReviewStageId])
  const [visualIssues, setVisualIssues] = useState<WeeklyVisualIssue[]>([])
  const pendingIssueFocusRef = useRef<WeeklyVisualIssue | null>(null)
  const editorReadyRef = useRef(false)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const routeIntentGenerationRef = useRef(0)
  const dataRouterContext = useContext(UNSAFE_DataRouterContext)
  const navigationContext = useContext(UNSAFE_NavigationContext)

  useEffect(() => {
    const invalidatePendingRouteIntent = () => {
      routeIntentGenerationRef.current += 1
    }
    if (dataRouterContext) {
      return dataRouterContext.router.subscribe(invalidatePendingRouteIntent)
    }
    const navigator = navigationContext.navigator
    const originalPush = navigator.push
    const originalReplace = navigator.replace
    const originalGo = navigator.go
    const wrappedPush: typeof originalPush = (...args) => {
      invalidatePendingRouteIntent()
      originalPush(...args)
    }
    const wrappedReplace: typeof originalReplace = (...args) => {
      invalidatePendingRouteIntent()
      originalReplace(...args)
    }
    const wrappedGo: typeof originalGo = (...args) => {
      invalidatePendingRouteIntent()
      originalGo(...args)
    }
    navigator.push = wrappedPush
    navigator.replace = wrappedReplace
    navigator.go = wrappedGo
    window.addEventListener('popstate', invalidatePendingRouteIntent)
    window.addEventListener('hashchange', invalidatePendingRouteIntent)
    return () => {
      if (navigator.push === wrappedPush) navigator.push = originalPush
      if (navigator.replace === wrappedReplace) navigator.replace = originalReplace
      if (navigator.go === wrappedGo) navigator.go = originalGo
      window.removeEventListener('popstate', invalidatePendingRouteIntent)
      window.removeEventListener('hashchange', invalidatePendingRouteIntent)
    }
  }, [dataRouterContext, navigationContext.navigator])

  useEffect(() => () => {
    routeIntentGenerationRef.current += 1
  }, [])

  const handleReturnRestoreStart = useCallback((anchorId: string) => {
    setReturnRestoreActive(true)
    if (anchorId.startsWith('weekly-risk:')) {
      if (riskRef.current) riskRef.current.open = true
      setOverrideEventsOpen(true)
    } else if (evidenceRef.current) evidenceRef.current.open = true
  }, [])
  const handleReturnRestoreFinish = useCallback(() => {
    setReturnRestoreActive(false)
  }, [])
  const handleMissingReturnAnchor = useCallback(() => {
    const target = mainContentRef.current
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'start' })
    toast('原交易已不在当前复盘证据中')
  }, [])

  useTradeReturnAnchor({
    onRestoreStart: handleReturnRestoreStart,
    onRestoreFinish: handleReturnRestoreFinish,
    onMissing: handleMissingReturnAnchor,
  })

  useEffect(() => {
    if (!routeResolution.needsReplace || returnRestoreActive) return
    navigate(
      { pathname: location.pathname, search: routeResolution.canonicalSearch },
      { replace: true, state: location.state },
    )
  }, [
    location.pathname,
    location.state,
    navigate,
    returnRestoreActive,
    routeResolution.canonicalSearch,
    routeResolution.needsReplace,
  ])

  const selectedHistoryItem = selectedReviewId
    ? historyItems.find((item) => item.routeId === selectedReviewId)
    : historyItems.find((item) => item.week === selectedWeek && item.liveStageId === selectedReviewStageId)
  const storedReview = selectedReviewId
    ? assignedReviews.find((item) => item.id === selectedReviewId)
    : selectedHistoryItem?.review
  const reviewLiveStageId = storedReview?.liveStageId ?? selectedHistoryItem?.liveStageId ?? selectedReviewStageId
  const reviewStageName = liveStages.find((stage) => stage.id === reviewLiveStageId)?.name ?? '未知阶段'
  const review = storedReview ?? createWeeklyReview(selectedWeek, reviewLiveStageId)
  const reviewTrades = useMemo(
    () => trades.filter((trade) =>
      trade.tradeKind === 'live' && trade.liveStageId === reviewLiveStageId,
    ),
    [trades, reviewLiveStageId],
  )
  const weekTradeSelection = useMemo(
    () => buildWeeklyReviewTradeSelection(
      reviewTrades,
      selectedWeek,
      tradingDayStartHour,
      businessDateAnchor.currentTradingDayKey,
      legacyCashCurrencyAssumption,
    ),
    [reviewTrades, selectedWeek, tradingDayStartHour, businessDateAnchor.currentTradingDayKey, legacyCashCurrencyAssumption],
  )
  const weekTrades = weekTradeSelection.trades
  const weekMissedTrades = useMemo(
    () => missedTradesInWeek(
      reviewTrades,
      selectedWeek,
      tradingDayStartHour,
      null,
      businessDateAnchor.currentTradingDayKey,
    ),
    [reviewTrades, selectedWeek, tradingDayStartHour, businessDateAnchor.currentTradingDayKey],
  )
  const liveMetrics = useMemo(
    () => buildWeeklyReviewMetrics(
      weekTrades,
      weekMissedTrades,
      weekTradeSelection.pnlIds,
      weekTradeSelection,
    ),
    [weekTrades, weekMissedTrades, weekTradeSelection],
  )
  const reviewDataSource = review.status === 'completed'
    ? resolveWeeklyReviewDataSource(review)
    : 'live-recomputed'
  const missingSnapshotLabels = review.status === 'completed'
    ? missingWeeklyReviewSnapshotCategories(review).map((category) => SNAPSHOT_CATEGORY_LABELS[category])
    : []
  const usesCompleteSnapshot = reviewDataSource === 'complete-snapshot'
  const riskEvidenceAvailability = review.status === 'completed'
    ? review.riskSnapshot ? (usesCompleteSnapshot ? 'legacy' : 'incomplete-snapshot') : 'legacy'
    : 'draft'
  const metrics = usesCompleteSnapshot
    ? review.metricsSnapshot!
    : liveMetrics
  const evidenceTrades = usesCompleteSnapshot
    ? review.evidenceSnapshot!.trades
    : weekTrades
  const evidenceMissedTrades = usesCompleteSnapshot
    ? review.evidenceSnapshot!.missedTrades
    : weekMissedTrades
  const evidenceCount = evidenceTrades.length + evidenceMissedTrades.length
  const markedEvidenceIds = new Set([...review.highlightTradeIds, ...review.mistakeTradeIds, ...review.followUpTradeIds])
  const compactEvidence = evidenceCount > 6 && !showAllEvidence
  const displayedEvidenceTrades = compactEvidence ? evidenceTrades.filter((trade) => markedEvidenceIds.has(trade.id)) : evidenceTrades
  const displayedMissedTrades = compactEvidence ? evidenceMissedTrades.filter((trade) => markedEvidenceIds.has(trade.id)) : evidenceMissedTrades
  const evidenceCashCurrencyAssumption = usesCompleteSnapshot
    ? review.evidenceSnapshot?.legacyCashCurrencyAssumption ?? null
    : legacyCashCurrencyAssumption
  const customMistakeEvidence = Object.entries(metrics.mistakeTagCounts)
    .filter(([tag]) => !WEEKLY_MISTAKE_DIMENSIONS.includes(tag as typeof WEEKLY_MISTAKE_DIMENSIONS[number]))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
  const locked = review.status === 'completed'
  const previousReview = assignedReviews
    .filter((item) =>
      item.liveStageId === reviewLiveStageId &&
      item.weekStart < selectedWeek &&
      item.commitmentText.trim(),
    )
    .sort((left, right) => right.weekStart.localeCompare(left.weekStart))[0]

  const selectedHistoryIndex = historyItems.findIndex((item) => selectedReviewId
    ? item.routeId === selectedReviewId
    : item.week === selectedWeek && item.liveStageId === reviewLiveStageId)
  const olderHistoryItem = selectedHistoryIndex >= 0 ? historyItems[selectedHistoryIndex + 1] : undefined
  const newerHistoryItem = selectedHistoryIndex > 0 ? historyItems[selectedHistoryIndex - 1] : undefined
  const weeklyFieldIssues = useMemo(
    () => getWeeklyVisualIssues(review),
    [
      review.executionScore,
      review.riskScore,
      review.emotionScore,
      review.commitmentText,
      review.commitmentCriteria,
    ],
  )
  const completedRequiredFields = 5 - weeklyFieldIssues.length
  const sectionHasIssue = (sectionId: string) => visualIssues.some((issue) => issue.sectionId === sectionId)

  useEffect(() => {
    setVisualIssues([])
  }, [selectedReviewId, selectedWeek])

  useEffect(() => {
    const pendingIssue = pendingIssueFocusRef.current
    if (!pendingIssue) return
    pendingIssueFocusRef.current = null
    focusWeeklyIssue(pendingIssue)
  }, [visualIssues])

  useEffect(() => {
    setVisualIssues((previous) => {
      if (previous.length === 0) return previous
      const next = [
        ...previous.filter((issue) => issue.key === UNSAVED_CONTENT_ISSUE.key),
        ...weeklyFieldIssues,
      ]
      return next.length === previous.length && next.every((issue, index) => issue.key === previous[index]?.key)
        ? previous
        : next
    })
  }, [weeklyFieldIssues])

  const commitPatch = useCallback((patch: ReviewPatch) => {
    const existing = useStore.getState().weeklyReviews.find((item) =>
      item.weekStart === selectedWeek && item.liveStageId === reviewLiveStageId,
    )
    if (existing) updateReview(existing.id, patch)
    else upsertReview({ ...createWeeklyReview(selectedWeek, reviewLiveStageId), ...patch, updatedAt: new Date().toISOString() })
  }, [reviewLiveStageId, selectedWeek, updateReview, upsertReview])

  const draftId = `${WEEKLY_REVIEW_DRAFT_PREFIX}${review.id}`
  useEffect(() => {
    editorReadyRef.current = false
    setEditorHtml('')
    let cancelled = false
    const imageScope = new AssetObjectUrlScope()
    void resolveNoteForDisplayResult(review.contentHtml, getStorage(), imageScope).then((result) => {
      if (cancelled) return
      setEditorHtml(result.html)
      editorReadyRef.current = result.editable
      if (!result.editable) toast('周复盘中有图片附件缺失，正文已切换为只读')
    })
    return () => {
      cancelled = true
      imageScope.release()
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
      noteTimerRef.current = null
      void flushNoteDraftToStore(draftId)
    }
  }, [review.id])

  const onEditorChange = useCallback((html: string) => {
    setEditorHtml(html)
    if (!editorReadyRef.current) return
    const existing = useStore.getState().weeklyReviews.find((item) =>
      item.weekStart === selectedWeek && item.liveStageId === reviewLiveStageId,
    )
    if (!existing) upsertReview(createWeeklyReview(selectedWeek, reviewLiveStageId))
    setNoteDraft(`${WEEKLY_REVIEW_DRAFT_PREFIX}${review.id}`, html)
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(() => {
      noteTimerRef.current = null
      void flushNoteDraftToStore(`${WEEKLY_REVIEW_DRAFT_PREFIX}${review.id}`)
    }, 500)
  }, [review.id, reviewLiveStageId, selectedWeek, upsertReview])

  const replaceRouteState = useCallback((
    nextWeek: string,
    nextTab: WeeklyReviewTab,
    nextReviewId?: string,
  ) => {
    const search = buildWeeklyReviewSearch(
      location.search,
      { selectedWeek: nextWeek, ...(nextReviewId ? { selectedReviewId: nextReviewId } : {}), tab: nextTab },
      currentWeek,
    )
    navigate(
      { pathname: location.pathname, search },
      { replace: true, state: location.state },
    )
  }, [currentWeek, location.pathname, location.search, location.state, navigate])

  const detailFrom = useCallback((anchorTradeId: string): TradeDetailFrom => ({
    pathname: location.pathname,
    search: routeResolution.canonicalSearch,
    restoreSearch: buildWeeklyReviewReturnSearch(
      location.search,
      { selectedWeek, ...(selectedReviewId ? { selectedReviewId } : {}), tab },
    ),
    anchorTradeId,
  }), [location.pathname, location.search, routeResolution.canonicalSearch, selectedReviewId, selectedWeek, tab])

  const closeHistoryPicker = () => {
    const picker = historyPickerRef.current
    if (!picker?.open) return
    picker.open = false
    picker.querySelector('summary')?.focus({ preventScroll: true })
  }

  const changeReview = async (item: typeof historyItems[number]) => {
    const intentGeneration = ++routeIntentGenerationRef.current
    if (
      item.week === selectedWeek &&
      item.liveStageId === reviewLiveStageId
    ) { closeHistoryPicker(); return }
    const draftSaved = await flushNoteDraftToStore(draftId)
    if (intentGeneration !== routeIntentGenerationRef.current) return
    if (!draftSaved) {
      toast('正文尚未保存，请重试')
      return
    }
    const nextReviewId = item.week === currentWeek && item.liveStageId === currentLiveStageId
      ? undefined
      : allStages ? item.routeId : item.review?.id
    closeHistoryPicker()
    if (evidenceRef.current) evidenceRef.current.open = false
    if (riskRef.current) riskRef.current.open = false
    replaceRouteState(item.week, tab, nextReviewId)
  }

  const changeTab = (nextTab: WeeklyReviewTab) => {
    routeIntentGenerationRef.current += 1
    if (nextTab === tab) return
    replaceRouteState(selectedWeek, nextTab, selectedReviewId)
  }

  const completeReview = async () => {
    const draftSaved = await flushNoteDraftToStore(draftId)
    const latest = useStore.getState().weeklyReviews.find((item) =>
      item.weekStart === selectedWeek && item.liveStageId === reviewLiveStageId,
    ) ?? review
    const issue = getWeeklyReviewCompletionIssue(latest, draftSaved)
    if (issue) {
      const nextIssues = draftSaved
        ? getWeeklyVisualIssues(latest)
        : [UNSAVED_CONTENT_ISSUE, ...getWeeklyVisualIssues(latest)]
      pendingIssueFocusRef.current = nextIssues[0] ?? null
      setVisualIssues(nextIssues)
      return
    }
    setVisualIssues([])
    completeWeeklyReview(latest.id)
    toast('本周复盘已完成，指标已冻结')
  }

  const reopenReview = () => {
    reopenWeeklyReview(review.id)
    toast('已重新打开，本周指标恢复实时更新')
  }

  const year = parseLocalDate(selectedWeek).getFullYear()
  const yearReviews = assignedReviews
    .filter((item) => item.weekStart.startsWith(`${year}-`))
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart))
  const scopedYearReviews = trendLiveStageId === undefined
    ? yearReviews
    : yearReviews.filter((item) => item.liveStageId === trendLiveStageId)
  const trendData = buildWeeklyReviewTrend(yearReviews, trendLiveStageId)

  return (
    <>
      <header className="wr-toolbar"><span className="wr-toolbar-label">周期复盘</span>
        <details className="wr-record-picker" ref={historyPickerRef}>
          <summary aria-label={`选择复盘记录：${selectedWeek.slice(0, 4)}年 · ${formatWeekRange(selectedWeek)}，${reviewStageName}`}>
            <span>{selectedWeek.slice(0, 4)}年 · {formatWeekRange(selectedWeek)}</span>
            <small>{reviewStageName}</small>
            <ChevronDown size={ICON_MD} aria-hidden />
          </summary>
          <PopoverSurface kind="menu" className="wr-record-popup">
            {header}
        <div className="wr-history" aria-label="周复盘历史">
            <div className="wr-history-title">复盘记录</div>
            {historyItems.map((item) => {
              const stageName = liveStages.find((stage) => stage.id === item.liveStageId)?.name ?? '未知阶段'
              const isActive = selectedReviewId
                ? item.routeId === selectedReviewId
                : item.week === selectedWeek && item.liveStageId === reviewLiveStageId
              return (
                <button
                  key={item.key}
                  type="button"
                  className={isActive ? 'is-active' : ''}
                  data-review-week={item.week}
                  data-review-id={item.review?.id ?? ''}
                  aria-current={isActive ? 'page' : undefined}
                  data-review-stage-id={item.liveStageId}
                  data-review-week-state={item.review?.status ?? 'pending'}
                  aria-label={`${weekLabel(item.week, currentWeek, item.liveStageId === currentLiveStageId)} ${stageName} ${item.review?.status === 'completed' ? '已完成' : item.review ? '草稿' : '待补做'}`}
                  onClick={() => void changeReview(item)}
                >
                  <span className="wr-history-week">{weekLabel(item.week, currentWeek, item.liveStageId === currentLiveStageId)}</span>
                  <small className="wr-history-stage">{stageName}</small>
                  <i
                    className={item.review?.status === 'completed' ? 'is-complete' : item.review ? 'is-draft' : 'is-pending'}
                    aria-hidden
                  />
                </button>
              )
            })}
        </div>

          </PopoverSurface>
        </details>

        <div className="wr-document-actions">
          <SaveStatusIndicator />
          <nav className="wr-view-switch" aria-label="周期复盘视图">
            {tab === 'year' ? <Button id="weekly-review-tab-review" variant="ghost" size="sm" onClick={() => changeTab('review')}><ChevronLeft size={ICON_MD} />本周复盘</Button> : null}
            {tab === 'review' ? <Button id="weekly-review-tab-year" variant="ghost" size="sm" onClick={() => changeTab('year')}>年度趋势</Button> : null}
          </nav>
          {tab === 'review' ? <>
            <span className="wr-document-status" aria-label={locked ? '周复盘已完成' : `周复盘必填项已完成 ${completedRequiredFields} / 5`}>
              {locked ? <><Check size={ICON_MD} />已完成</> : `${completedRequiredFields}/5`}
            </span>
            {locked
              ? <button type="button" className="ui-btn ui-btn-ghost" onClick={reopenReview}><RotateCcw size={ICON_MD} />重新打开</button>
              : <button type="button" className="ui-btn ui-btn-primary" onClick={() => void completeReview()}><Check size={ICON_MD} />完成本周复盘</button>}
          </> : null}
        </div>
      </header>
      <div className="wr-shell">
        <section ref={mainContentRef} className="wr-main" aria-label="周复盘内容" data-review-stage-id={reviewLiveStageId} tabIndex={-1}>
          {tab === 'year' ? (
            <div id="weekly-review-panel-year" role="region" aria-label="年度趋势">
              <div className="wr-year"><header className="wr-page-head"><h1>年度趋势</h1></header>
                <div className="wr-trend-scope">
                  <span>阶段范围</span>
                  <Select
                    className="wr-trend-select"
                    ariaLabel="年度趋势阶段范围"
                    value={trendLiveStageId ?? ''}
                    onValueChange={(value) => setTrendLiveStageId(value || undefined)}
                    options={[
                      { value: '', label: '全部阶段' },
                      ...liveStages.map((stage) => ({ value: stage.id, label: stage.name })),
                    ]}
                  />
                </div>
                <YearTrend year={year} reviews={scopedYearReviews} data={trendData} />
              </div>
            </div>
          ) : (
            <div id="weekly-review-panel-review" role="region" aria-label="本周复盘" className="wr-content">
              {visualIssues.length > 0 ? (
                <InlineStatus
                  tone="error"
                  title="还需完成以下内容"
                  className="wr-issue-summary"
                  detail={(
                    <ul>
                      {visualIssues.map((issue) => (
                        <li key={issue.key}>
                          <button type="button" onClick={() => focusWeeklyIssue(issue)}>{issue.message}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                />
              ) : null}

              {review.status === 'completed' && !usesCompleteSnapshot ? (
                <InlineStatus
                  tone="warning"
                  title="部分历史指标不可用"
                  className="wr-snapshot-cta"
                  detail={`缺少完成时快照：${missingSnapshotLabels.join('、')}。重新打开后可按当前数据完成并冻结。`}
                  action={(
                    <button
                      type="button"
                      className="ui-btn ui-btn-bordered"
                      data-weekly-snapshot-cta
                      onClick={reopenReview}
                    >
                      重新打开
                    </button>
                  )}
                />
              ) : null}


              <header className="wr-page-head"><h1>本周判断</h1></header>
              <section className="wr-section wr-metrics" data-weekly-section="facts" data-invalid="false">

                <div className="wr-metric-grid">
                  <Metric label="平仓交易" value={`${metrics.tradeCount}`} hint={`${metrics.reviewedCount} 笔已复盘`} />
                  <Metric label="胜率" value={metrics.winRate === null ? '—' : `${metrics.winRate.toFixed(0)}%`} hint={`${metrics.winCount} 赢 · ${metrics.lossCount} 亏 · ${metrics.breakevenCount} 平`} />
                  <Metric label="净盈亏" value={metrics.pnlCount ? fmtMoney(metrics.totalPnl, 'USD', privacyMode) : '—'} tone={privacyMode ? undefined : metrics.totalPnl > 0 ? 'positive' : metrics.totalPnl < 0 ? 'negative' : undefined} hint={metrics.pnlCount < metrics.tradeCount ? `${metrics.pnlCount}/${metrics.tradeCount} 笔含盈亏` : undefined} />
                  <Metric label="平均 R" value={fmtR(metrics.averageR)} tone={(metrics.averageR ?? 0) > 0 ? 'positive' : (metrics.averageR ?? 0) < 0 ? 'negative' : undefined} hint={metrics.rCount < metrics.tradeCount ? `${metrics.rCount}/${metrics.tradeCount} 笔含 R` : undefined} />
                </div>
              <div className="wr-facts-context">
                <button type="button" className="ui-btn ui-btn-ghost" onClick={() => openEvidence('risk')}>风控明细{usesCompleteSnapshot && review.riskSnapshot ? ` · ${getWeeklyRiskStatus(review.riskSnapshot.weeklyOutcome).label}` : ''}<ChevronDown size={ICON_MD} /></button>
                {locked ? <small>{new Date(review.completedAt ?? '').toLocaleDateString('zh-CN')} · {usesCompleteSnapshot ? '完成周复盘时的数据' : '历史快照不完整'}</small> : null}
              </div>
                {metrics.missedCount > 0 ? (
                  <div className="wr-missed-summary">
                    <div>
                      <span>执行缺口</span>
                      <strong>错过机会 {metrics.missedCount}</strong>
                      <small>单独复盘，不计入平仓、胜率、盈亏与平均 R</small>
                    </div>
                    <p>
                      {Object.entries(metrics.missedReasonCounts)
                        .sort((left, right) => right[1] - left[1])
                        .map(([reason, count]) => (
                          <span key={reason}>{MISS_REASON_META[reason as MissReason]?.label ?? '其他'}<b>×{count}</b></span>
                        ))}
                    </p>
                  </div>
                ) : null}
                {metrics.conflictCount > 0 ? (
                  <p className="wr-data-warning">
                    有 {metrics.conflictCount} 笔结果口径冲突，未进入绩效计算。
                    <WeeklyResultIssueLink
                      tradeId={weekTradeSelection.conflictResultIds[0]}
                      trades={weekTrades}
                      testId="conflict"
                      detailFrom={detailFrom}
                    >
                      去核对
                    </WeeklyResultIssueLink>
                  </p>
                ) : null}
                {metrics.pendingResultCount > 0 ? (
                  <p className="wr-data-warning">
                    有 {metrics.pendingResultCount} 笔待补结果，未进入绩效计算。
                    <WeeklyResultIssueLink
                      tradeId={weekTradeSelection.missingResultIds[0]}
                      trades={weekTrades}
                      testId="pending"
                      detailFrom={detailFrom}
                    >
                      去补结果
                    </WeeklyResultIssueLink>
                  </p>
                ) : null}
              </section>

              <section className="wr-section" data-weekly-section="judgment" data-invalid={sectionHasIssue('judgment')}>

                <div className="wr-editor-wrap" data-weekly-field="review-content" data-invalid={sectionHasIssue('judgment')}>
                  <Editor
                    content={editorHtml}
                    onChange={onEditorChange}
                    noteDraftId={storedReview ? draftId : undefined}
                    readOnly={!editorReadyRef.current && Boolean(review.contentHtml)}
                    ariaLabel="周复盘正文"
                    placeholder="写下本周判断，粘贴截图…"
                  />
                </div>
              </section>

              <div className="wr-document-links">
                <button type="button" className="ui-btn ui-btn-ghost" onClick={() => openEvidence('evidence')}>查看 {evidenceCount} 笔交易</button>
              </div>
              <section className="wr-section wr-scores" data-weekly-section="scores" data-invalid={sectionHasIssue('scores')} aria-label="做法评分">
                <div className="wr-score-grid">
                  {SCORE_FIELDS.map(({ key, fieldId, label }) => (
                    <div className="wr-score-row" key={key} data-weekly-field={fieldId} data-invalid={visualIssues.some((issue) => issue.fieldId === fieldId)}>
                      <span>{label}</span>
                      <Select ariaLabel={label} value={review[key] === null ? '' : String(review[key])}
                        placeholder="未评分" onValueChange={(value) => commitPatch({ [key]: Number(value) })}
                        options={SCORE_LEVELS.map((level) => ({ value: String(level.value), label: `${level.value} · ${level.label}` }))} />
                    </div>
                  ))}
                </div>
              </section>
              <section className="wr-section wr-commitment" data-weekly-section="commitment" data-invalid={sectionHasIssue('commitment')}>
                <div className="wr-section-head"><h2>下周行动</h2></div>
                <label className="wr-action-input"><input aria-label="行动承诺" data-weekly-field="commitment-text" aria-invalid={visualIssues.some((issue) => issue.fieldId === 'commitment-text')} value={review.commitmentText} onChange={(event) => commitPatch({ commitmentText: event.target.value })} placeholder="例如：没有触发确认前不提前入场" /></label>
                <label>验收标准<input data-weekly-field="commitment-criteria" aria-invalid={visualIssues.some((issue) => issue.fieldId === 'commitment-criteria')} value={review.commitmentCriteria} onChange={(event) => commitPatch({ commitmentCriteria: event.target.value })} placeholder="例如：所有入场截图中都能看到确认信号" /></label>
              </section>

              <div className="wr-supplements">
                {previousReview ? <details className="wr-disclosure"><summary>上次行动</summary>
              {previousReview ? (
                <section className="wr-section wr-previous" data-weekly-section="previous-commitment" data-invalid="false">
                  <div className="wr-section-head"><div><h2>上次行动</h2></div><small>{formatWeekRange(previousReview.weekStart)}</small></div>
                  <div className="wr-previous-body">
                    <Target size={ICON_XL} />
                    <div><strong>{previousReview.commitmentText}</strong><p>{previousReview.commitmentCriteria}</p></div>
                    <div className="wr-result-choice">
                      {COMMITMENT_RESULTS.map((option) => (
                        <button key={option.value} type="button" aria-pressed={review.previousCommitmentResult === option.value} onClick={() => commitPatch({ previousCommitmentResult: option.value })}>{option.label}</button>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

                </details> : null}
                <details className="wr-disclosure"><summary>模式归因{review.strengthTags.length + review.mistakeTags.length > 0 ? ` · ${review.strengthTags.length + review.mistakeTags.length}` : ''}</summary>
              <section className="wr-section" data-weekly-section="patterns" data-invalid="false">
                <div className="wr-section-head"><div><h2>模式归因</h2></div></div>
                <TagGroup tone="strength" title="做得好的" options={STRENGTH_TAGS} selected={review.strengthTags} onChange={(strengthTags) => commitPatch({ strengthTags })} />
                <TagGroup
                  tone="correction"
                  title="需要纠正的"
                  options={[...WEEKLY_MISTAKE_DIMENSIONS]}
                  selected={review.mistakeTags}
                  onChange={(mistakeTags) => commitPatch({
                    mistakeTags: mistakeTags.filter((tag) => WEEKLY_MISTAKE_DIMENSIONS.includes(tag as typeof WEEKLY_MISTAKE_DIMENSIONS[number])),
                  })}
                  counts={metrics.mistakeTagCounts}
                />
                {customMistakeEvidence.length ? (
                  <div className="wr-evidence-tags">
                    <div><label>本周交易标签</label><small>仅作证据提示，不计入年度统计</small></div>
                    <p>{customMistakeEvidence.map(([tag, count]) => <span key={tag}>{tag}<b>×{count}</b></span>)}</p>
                  </div>
                ) : null}
              </section>

                </details>
                <details className="wr-disclosure wr-detail-evidence" ref={evidenceRef}>
                  <summary>交易证据 · {evidenceCount} 笔</summary>
              <section className="wr-section" data-weekly-section="evidence" data-invalid="false">

                {evidenceCount > 6 ? <button type="button" className="ui-btn ui-btn-ghost wr-evidence-toggle" aria-expanded={showAllEvidence} onClick={() => setShowAllEvidence((value) => !value)}>{showAllEvidence ? '只看已标记证据' : `查看和标记全部 ${evidenceCount} 笔交易`}</button> : null}
                {compactEvidence && displayedEvidenceTrades.length + displayedMissedTrades.length === 0 ? <p className="wr-empty">尚未标记关键证据。</p> : null}
                {evidenceTrades.length || evidenceMissedTrades.length ? (
                  <div className="wr-evidence-groups">
                    {displayedEvidenceTrades.length ? (
                      <div className="wr-evidence-group">
                        {displayedMissedTrades.length ? <div className="wr-evidence-group-title">已执行并平仓</div> : null}
                        <div className="wr-trade-list">
                          {displayedEvidenceTrades.map((trade) => (
                            <TradeEvidence
                              key={trade.id}
                              trade={trade}
                              review={review}
                              onPatch={(patch) => { if (compactEvidence) setShowAllEvidence(true); commitPatch(patch) }}
                              detailFrom={detailFrom(`weekly-trade:${trade.id}`)}
                              legacyCashCurrencyAssumption={evidenceCashCurrencyAssumption}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {displayedMissedTrades.length ? (
                      <div className="wr-evidence-group">
                        <div className="wr-evidence-group-title">错过机会 <small>仅作执行证据，不计入绩效</small></div>
                        <div className="wr-trade-list">
                          {displayedMissedTrades.map((trade) => (
                            <TradeEvidence
                              key={trade.id}
                              trade={trade}
                              review={review}
                              onPatch={(patch) => { if (compactEvidence) setShowAllEvidence(true); commitPatch(patch) }}
                              detailFrom={detailFrom(`weekly-trade:${trade.id}`)}
                              legacyCashCurrencyAssumption={evidenceCashCurrencyAssumption}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : <div className="wr-empty">本周没有实盘已平仓交易或错过机会。仍可记录无交易决策、观察与下周行动。</div>}
              </section>

                </details>
                <details className="wr-disclosure wr-detail-risk" ref={riskRef}>
                  <summary>风控明细</summary>
              <WeeklyRiskEvidence
                snapshot={usesCompleteSnapshot ? review.riskSnapshot : undefined}
                availability={riskEvidenceAvailability}
                detailSource={{
                  pathname: location.pathname,
                  search: routeResolution.canonicalSearch,
                  restoreSearch: buildWeeklyReviewReturnSearch(
                    location.search,
                    { selectedWeek, ...(selectedReviewId ? { selectedReviewId } : {}), tab },
                  ),
                }}
                overrideEventsOpen={overrideEventsOpen}
                onOverrideEventsOpenChange={setOverrideEventsOpen}
              />

                </details>
              </div>
              <div className="wr-document-paging">
                <IconButton label="上一条复盘" size="md" disabled={!olderHistoryItem} onClick={() => olderHistoryItem && void changeReview(olderHistoryItem)}><ChevronLeft size={ICON_MD} /></IconButton>
                <IconButton label="下一条复盘" size="md" disabled={!newerHistoryItem} onClick={() => newerHistoryItem && void changeReview(newerHistoryItem)}><ChevronRight size={ICON_MD} /></IconButton>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  )
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'positive' | 'negative' }) {
  return <Tooltip content={hint ?? label} label={label} focusable><div className="wr-metric"><span>{label}</span><strong className={tone ? `is-${tone}` : ''}>{value}</strong></div></Tooltip>
}

function TagGroup({ tone, title, options, selected, onChange, counts }: { tone: 'strength' | 'correction'; title: string; options: string[]; selected: string[]; onChange: (values: string[]) => void; counts?: Record<string, number> }) {
  return (
    <div className={`wr-tag-group is-${tone}`}><label>{title}</label><div>{options.map((option) => <button key={option} type="button" aria-pressed={selected.includes(option)} onClick={() => onChange(toggleValue(selected, option))}>{option}{counts?.[option] ? ` · ${counts[option]}` : ''}</button>)}</div></div>
  )
}

function YearTrend({ year, reviews, data }: { year: number; reviews: WeeklyReview[]; data: ReturnType<typeof buildWeeklyReviewTrend> }) {
  const completed = reviews.filter((review) => review.status === 'completed')
  const averages = completed.map(weeklyReviewScoreAverage).filter((score): score is number => score !== null)
  const average = averages.length ? averages.reduce((sum, score) => sum + score, 0) / averages.length : null
  const mistakes = Object.entries(summarizeWeeklyMistakeDimensions(reviews))
  const weekCount = getIsoWeek(`${year}-12-28`)
  const firstWeek = weekStartFor(new Date(year, 0, 4))

  if (completed.length === 0) {
    return (
      <div className="wr-year-body">
        <section className="wr-year-empty" aria-label="年度趋势尚未开始">
          <strong>年度趋势尚未开始</strong>
          <p>完成第一篇周复盘后查看。</p>
          {reviews.length > 0 ? <small>{reviews.length} 篇草稿尚未完成</small> : null}
        </section>
      </div>
    )
  }

  return (
    <div className="wr-year-body">
      <section className="wr-section wr-year-summary">
        <div><span>已完成</span><strong>{completed.length}</strong><small>周</small></div>
        <div><span>平均做法评分</span><strong>{average?.toFixed(1) ?? '—'}</strong><small>/ 5</small></div>
        <div><span>最常见错误</span><strong>{mistakes.sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'}</strong><small>固定分类</small></div>
      </section>
      <section className="wr-section">
        <div className="wr-section-head"><div><TrendingUp size={ICON_LG} /><h2>{year} 做法评分趋势</h2></div><small>完成周才进入年度统计</small></div>
        {data.length >= 2 ? (
          <Suspense fallback={(
            <div className="wr-chart wr-chart-loading" role="status" aria-live="polite">
              <span className="wr-chart-loading-label">正在载入评分趋势…</span>
              <div className="wr-chart-skeleton-grid" aria-hidden="true">
                <svg className="wr-chart-skeleton-line" viewBox="0 0 100 40" preserveAspectRatio="none">
                  <polyline points="0,31 18,25 34,28 51,16 68,20 84,9 100,13" />
                </svg>
              </div>
            </div>
          )}>
            <WeeklyReviewScoreChart data={data} />
          </Suspense>
        ) : data.length === 1 ? <div className="wr-trend-start"><p>再完成 1 次周复盘后，这里会显示评分变化。</p></div> : <div className="wr-empty">完成第一篇周复盘后，这里会出现年度趋势。</div>}
      </section>
      <section className="wr-section">
        <div className="wr-section-head"><div><span>{weekCount}</span><h2>全年复盘节奏</h2></div><small>颜色越亮，做法评分越高</small></div>
        <div className="wr-heatmap" style={{ '--week-count': weekCount, '--week-compact-columns': Math.ceil(weekCount / 2) } as CSSProperties}>
          {Array.from({ length: weekCount }, (_, index) => {
            const week = addDays(firstWeek, index * 7)
            const aggregate = aggregateWeeklyReviewScoresForWeek(reviews, week)
            const score = aggregate.averageScore
            const stageLabel = aggregate.completedCount > 1 ? ` · ${aggregate.completedCount} 个阶段聚合` : ''
            const tip = `${formatWeekRange(week)}${score ? ` · ${score.toFixed(1)} 分${stageLabel}` : ''}`
            return (
              <Tooltip key={week} content={tip} label={tip}>
                <i
                  style={{ '--level': score ? score / 5 : 0 } as CSSProperties}
                  className={aggregate.completedCount > 0 ? 'is-filled' : ''}
                />
              </Tooltip>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function getIsoWeek(ymd: string): number {
  const date = parseLocalDate(ymd)
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  return Math.ceil((((+utc - +yearStart) / 86400000) + 1) / 7)
}
