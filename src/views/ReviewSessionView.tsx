import { ICON_2XL, ICON_LG, ICON_MD, ICON_XL } from '@/icons/iconSize'
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
  MoreHorizontal,
  RotateCcw,
  SlidersHorizontal,
} from '@/icons/appIcons'
import {
  REVIEW_CATEGORY_META,
  STATUS_META,
  TRADE_KIND_META,
  type Trade,
} from '@/data/trades'
import { Editor } from '@/editor/Editor'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Kbd } from '@/components/ui/Kbd'
import { Menu } from '@/components/Menu'
import { ModalShell } from '@/components/ui/ModalShell'
import { Select } from '@/components/ui/Select'
import { fmtDate, fmtMoney, fmtR } from '@/lib/format'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import { formatTradeCashPnl } from '@/lib/cashCurrency'
import { getStrategyName } from '@/lib/strategies'
import type { LiveStage } from '@/lib/liveStages'
import {
  settleReviewImageGroup,
  type ReviewImageCandidate,
  type ReviewImageSlot,
} from '@/lib/reviewImageReadiness'
import {
  DEFAULT_REVIEW_SESSION_FILTERS,
  buildReviewAssessmentPatch,
  buildReviewSessionPool,
  clearReviewSessionStorage,
  getReviewSessionContent,
  hasEffectiveReviewContent,
  loadReviewSession,
  loadReviewSessionFilters,
  normalizeReviewStageSource,
  REVIEW_STAGE_SOURCE_LABELS,
  reconcileReviewSession,
  reviewStageSourceLabel,
  reviewFiltersForNextRound,
  saveReviewSession,
  saveReviewSessionFilters,
  shuffleReviewSessionIds,
  type ReviewSessionAssessment,
  type ReviewSessionFilters,
  type ReviewSessionSnapshot,
  type ReviewStageSource,
} from '@/lib/reviewSession'
import {
  buildReviewPoolCandidateIndex,
  buildSystemReviewPool,
  normalizeReviewPoolLayout,
  type ReviewPoolRef,
  type SystemReviewPoolId,
} from '@/lib/reviewPools'
import { REVIEW_CASE_SCOPE_LABELS, type ReviewCaseScope } from '@/lib/reviewCaseScope'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { tradeHomeHref } from '@/lib/tradeWorkspaceQuery'
import { toast } from '@/lib/toast'
import { resolveNoteForDisplayResult } from '@/storage/assets'
import { getStorage } from '@/storage/bootstrap'
import { useShortcutStore } from '@/store/shortcutStore'
import {
  registerShortcutHandlers,
  type ShortcutHandlerMap,
} from '@/shortcuts/engine'
import { useShortcutHint } from '@/shortcuts/useShortcutHint'
import { useStore } from '@/store/useStore'
import { ReviewPoolManagerModal } from './ReviewPoolManagerModal'
import './ReviewSessionView.css'

type RestoreStatus = 'loading' | 'ready' | 'unavailable'
type ResolvedNoteState = {
  tradeId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  html: string
}
type ReviewNotePresentation = { bodyHtml: string; images: ReviewImageCandidate[] }

const CASE_SCOPE_OPTIONS: Array<{ value: ReviewCaseScope; label: string }> = [
  { value: 'all', label: '全部案例' },
  { value: 'exemplar', label: REVIEW_CASE_SCOPE_LABELS.exemplar },
  { value: 'mistakes', label: REVIEW_CASE_SCOPE_LABELS.mistakes },
  { value: 'missed', label: REVIEW_CASE_SCOPE_LABELS.missed },
  { value: 'focus', label: REVIEW_CASE_SCOPE_LABELS.focus },
  { value: 'unreviewed', label: REVIEW_CASE_SCOPE_LABELS.unreviewed },
  { value: 'reviewed', label: REVIEW_CASE_SCOPE_LABELS.reviewed },
]

const REVIEW_TIMING_OPTIONS = [
  { value: 'due', label: '到期案例' },
  { value: 'all', label: '全部案例（含未到期与已掌握）' },
]

const REVIEW_STAGE_SOURCE_OPTIONS = [
  { value: 'current-and-history', label: REVIEW_STAGE_SOURCE_LABELS['current-and-history'] },
  { value: 'current', label: REVIEW_STAGE_SOURCE_LABELS.current },
  { value: 'all-history', label: REVIEW_STAGE_SOURCE_LABELS['all-history'] },
  { value: 'custom', label: '自选阶段' },
]

const SYSTEM_REVIEW_POOL_META: ReadonlyArray<{
  id: SystemReviewPoolId
  label: string
  hint: string
}> = [
  { id: 'all', label: '全部内容', hint: '案例与全部已结束交易' },
  { id: 'cases', label: '只看案例', hint: '完整案例知识库' },
  { id: 'losses', label: '亏损日志', hint: '已结束的亏损实盘与模拟盘' },
  { id: 'wins', label: '盈利日志', hint: '已结束的盈利实盘与模拟盘' },
  { id: 'missed', label: '错过机会', hint: '日志与案例中的错过机会' },
  { id: 'boosted', label: '近期多看', hint: '你主动加入近期多看的内容' },
]

const SYSTEM_REVIEW_POOL_META_BY_ID = new Map(
  SYSTEM_REVIEW_POOL_META.map((pool) => [pool.id, pool]),
)

type ReviewPoolStartItem = {
  ref: ReviewPoolRef
  label: string
  hint: string
  count: number
}

const SYSTEM_POOL_SESSION_FILTERS: ReviewSessionFilters = {
  ...DEFAULT_REVIEW_SESSION_FILTERS,
  includeCases: true,
  includeLiveTrades: true,
  includePaperTrades: true,
  reviewTiming: 'all',
  stageSource: 'current-and-history',
}

const ASSESSMENT_OPTIONS: Array<{
  actionId: string
  value: ReviewSessionAssessment
  label: string
  hint: string
}> = [
  { actionId: 'reviewSession.unfamiliar', value: 'unfamiliar', label: '还没掌握', hint: '3 天后再看' },
  { actionId: 'reviewSession.recheck', value: 'recheck', label: '基本理解', hint: '7 天后复看' },
  { actionId: 'reviewSession.mastered', value: 'mastered', label: '已经掌握', hint: '完成本条' },
]

const EMPTY_NOTE_STATE: ResolvedNoteState = {
  tradeId: null,
  status: 'idle',
  html: '',
}

function stageSourceSelectValue(stageSource: ReviewStageSource): string {
  return typeof stageSource === 'object' ? 'custom' : stageSource
}

function haveSameReviewFilters(left: ReviewSessionFilters, right: ReviewSessionFilters): boolean {
  if (
    left.includeCases !== right.includeCases ||
    left.includeLiveTrades !== right.includeLiveTrades ||
    left.includePaperTrades !== right.includePaperTrades ||
    left.caseScope !== right.caseScope ||
    left.requireContent !== right.requireContent ||
    left.reviewTiming !== right.reviewTiming
  ) return false
  if (typeof left.stageSource !== 'object' || typeof right.stageSource !== 'object') {
    return left.stageSource === right.stageSource
  }
  return left.stageSource.stageIds.join('\u0000') === right.stageSource.stageIds.join('\u0000')
}

function reviewStageOriginLabel(
  trade: Trade,
  liveStages: readonly LiveStage[],
  currentLiveStageId: string,
): string {
  if (trade.tradeKind === 'paper') return '模拟盘'
  const stage = liveStages.find((candidate) => candidate.id === trade.liveStageId)
  return stage?.id === currentLiveStageId && stage.status === 'current'
    ? '当前阶段'
    : stage?.name ?? '未知阶段'
}

export function createReviewSessionShortcutHandlers({
  current,
  onAssess,
  onSkip,
  onBack,
}: {
  current: Pick<Trade, 'tradeKind'> | undefined
  onAssess: (assessment: ReviewSessionAssessment) => void
  onSkip: () => void
  onBack: () => void
}): ShortcutHandlerMap {
  const assessCase = (assessment: ReviewSessionAssessment) => {
    if (current?.tradeKind === 'case') onAssess(assessment)
  }
  return {
    'reviewSession.unfamiliar': () => assessCase('unfamiliar'),
    'reviewSession.recheck': () => assessCase('recheck'),
    'reviewSession.mastered': () => assessCase('mastered'),
    'reviewSession.skip': onSkip,
    'reviewSession.back': onBack,
  }
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
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const strategies = useStore((state) => state.strategies)
  const starredIds = useStore((state) => state.starredIds)
  const subscribedIds = useStore((state) => state.subscribedIds)
  const reviewPoolPresets = useStore((state) => state.reviewPoolPresets)
  const reviewPoolLayout = useStore((state) => state.reviewPoolLayout)
  const saveReviewPoolPreset = useStore((state) => state.saveReviewPoolPreset)
  const removeReviewPoolPreset = useStore((state) => state.removeReviewPoolPreset)
  const setReviewPoolLayout = useStore((state) => state.setReviewPoolLayout)
  const privacyMode = useStore((state) => state.display.privacyMode)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const rememberedTradeSearch = useStore((state) => state.display.workspaceMemory?.trade?.search ?? '')
  const legacyCashCurrencyAssumption = useStore((state) => state.profile.legacyCashCurrencyAssumption)
  const updateTradeData = useStore((state) => state.updateTradeData)
  const starred = useMemo(() => new Set(starredIds), [starredIds])
  const subscribed = useMemo(() => new Set(subscribedIds), [subscribedIds])
  const businessDateAnchor = useBusinessDateAnchor()
  const [filters, setFilters] = useState<ReviewSessionFilters>(DEFAULT_REVIEW_SESSION_FILTERS)
  const [settingsDraft, setSettingsDraft] = useState<ReviewSessionFilters | null>(null)
  const [poolManagerOpen, setPoolManagerOpen] = useState(false)
  const [pendingFilters, setPendingFilters] = useState<ReviewSessionFilters | null>(null)
  const [pendingFiltersBusy, setPendingFiltersBusy] = useState(false)
  const [session, setSession] = useState<ReviewSessionSnapshot | null>(null)
  const [libraryId, setLibraryId] = useState<string | null>(null)
  const [restoreStatus, setRestoreStatus] = useState<RestoreStatus>('loading')
  const [persistenceWarning, setPersistenceWarning] = useState(false)
  const [resolvedNote, setResolvedNote] = useState<ResolvedNoteState>(EMPTY_NOTE_STATE)
  const latestTradesRef = useRef(trades)
  const latestStarredRef = useRef(starred)
  const focusAfterTransitionRef = useRef(false)
  const focusSettingsApplyAfterCancelRef = useRef(false)
  const pendingFiltersApplyRef = useRef(false)
  const pendingFiltersFrameRef = useRef<number | null>(null)
  const sessionRef = useRef(session)
  latestTradesRef.current = trades
  latestStarredRef.current = starred
  sessionRef.current = session

  const exitReviewSession = useCallback(() => {
    navigate(tradeHomeHref(rememberedTradeSearch))
  }, [navigate, rememberedTradeSearch])

  const pool = useMemo(
    () => buildReviewSessionPool(
      trades,
      filters,
      starred,
      businessDateAnchor.currentTradingDayKey,
      tradingDayStartHour,
      { liveStages, currentLiveStageId },
    ),
    [businessDateAnchor.currentTradingDayKey, currentLiveStageId, filters, liveStages, starred, trades, tradingDayStartHour],
  )
  const poolIndex = useMemo(() => buildReviewPoolCandidateIndex(
    trades,
    reviewPoolPresets,
    {
      subscribedIds: subscribed,
      stageContext: { liveStages, currentLiveStageId },
    },
  ), [currentLiveStageId, liveStages, reviewPoolPresets, subscribed, trades])
  const systemPools = poolIndex.system
  const customPools = poolIndex.custom
  const homePools = useMemo<ReviewPoolStartItem[]>(() => {
    const layout = normalizeReviewPoolLayout(
      reviewPoolLayout,
      reviewPoolPresets.map((preset) => preset.id),
    )
    return layout.homeOrder.flatMap((ref): ReviewPoolStartItem[] => {
      if (ref.kind === 'system') {
        const meta = SYSTEM_REVIEW_POOL_META_BY_ID.get(ref.id)
        return meta ? [{ ref, label: meta.label, hint: meta.hint, count: systemPools[ref.id].length }] : []
      }
      const preset = reviewPoolPresets.find((candidate) => candidate.id === ref.id)
      return preset ? [{
        ref,
        label: preset.name,
        hint: '自定义复盘池',
        count: customPools.get(ref.id)?.length ?? 0,
      }] : []
    })
  }, [customPools, reviewPoolLayout, reviewPoolPresets, systemPools])
  const settingsPoolSize = useMemo(
    () => settingsDraft ? buildReviewSessionPool(
      trades,
      settingsDraft,
      starred,
      businessDateAnchor.currentTradingDayKey,
      tradingDayStartHour,
      { liveStages, currentLiveStageId },
    ).length : 0,
    [businessDateAnchor.currentTradingDayKey, currentLiveStageId, liveStages, settingsDraft, starred, trades, tradingDayStartHour],
  )
  const tradeById = useMemo(
    () => new Map(trades.filter((trade) => !trade.deletedAt).map((trade) => [trade.id, trade])),
    [trades],
  )
  const current = session && session.cursor < session.ids.length
    ? tradeById.get(session.ids[session.cursor] ?? '')
    : undefined
  const hasExplicitEmptySelection = Boolean(
    session &&
    session.ids.length === 0 &&
    typeof session.filters.stageSource === 'object' &&
    session.filters.stageSource.stageIds.length === 0,
  )
  const roundEnded = Boolean(
    session && !hasExplicitEmptySelection && session.cursor >= session.ids.length,
  )
  const assessedCount = session ? Object.keys(session.assessments).length : 0

  useEffect(() => {
    let cancelled = false
    void getStorage().getManifest().then((manifest) => {
      if (cancelled) return
      const stored = loadReviewSession(manifest.libraryId)
      const restored = stored
        ? reconcileReviewSession(
          stored,
          latestTradesRef.current,
          latestStarredRef.current,
          businessDateAnchor.currentTradingDayKey,
          tradingDayStartHour,
          { liveStages, currentLiveStageId },
        )
        : null
      setLibraryId(manifest.libraryId)
      if (restored) {
        setFilters(restored.filters)
        setSession(restored)
      } else {
        if (stored) clearReviewSessionStorage(manifest.libraryId)
        const remembered = loadReviewSessionFilters(manifest.libraryId)
        if (remembered) setFilters(remembered)
      }
      setRestoreStatus('ready')
    }).catch(() => {
      if (cancelled) return
      setRestoreStatus('unavailable')
      setPersistenceWarning(true)
    })
    return () => { cancelled = true }
  }, [businessDateAnchor.currentTradingDayKey, tradingDayStartHour])

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
    const content = getReviewSessionContent(current)
    if (!hasEffectiveReviewContent(content)) {
      setResolvedNote({ tradeId: current.id, status: 'ready', html: '' })
      return
    }

    let cancelled = false
    setResolvedNote({ tradeId: current.id, status: 'loading', html: '' })
    void resolveNoteForDisplayResult(content, getStorage()).then((result) => {
      if (!cancelled) setResolvedNote({ tradeId: current.id, status: 'ready', html: result.html })
    }).catch(() => {
      if (!cancelled) setResolvedNote({ tradeId: current.id, status: 'error', html: '' })
    })
    return () => { cancelled = true }
  }, [current?.id, current?.note, current?.sourceNoteHtml, current?.tradeKind])

  const advance = useCallback(() => {
    focusAfterTransitionRef.current = true
    setSession((value) => value ? {
      ...value,
      cursor: Math.min(value.cursor + 1, value.ids.length),
    } : value)
  }, [])

  const rewind = useCallback(() => {
    const value = sessionRef.current
    if (!value || value.cursor <= 0) return
    const prevCursor = value.cursor - 1
    const prevId = value.ids[prevCursor]
    if (!prevId) return
    const hadAssessment = value.assessments[prevId] != null
    const hasUndoReference = Object.prototype.hasOwnProperty.call(
      value.assessmentActionIds ?? {},
      prevId,
    )
    const actionId = value.assessmentActionIds?.[prevId]
    if (
      hadAssessment &&
      (!hasUndoReference || (typeof actionId === 'string' && !useStore.getState().undo(actionId)))
    ) {
      toast('该评估之后目标字段已变化，无法安全撤销')
      return
    }
    const assessments = { ...value.assessments }
    const assessmentActionIds = { ...(value.assessmentActionIds ?? {}) }
    delete assessments[prevId]
    delete assessmentActionIds[prevId]
    focusAfterTransitionRef.current = true
    setSession({
      ...value,
      cursor: prevCursor,
      assessments,
      assessmentActionIds,
    })
  }, [])

  const assess = useCallback((assessment: ReviewSessionAssessment) => {
    if (!current || current.tradeKind !== 'case') return
    const previousActionId = useStore.getState().undoStack.at(-1)?.actionId
    updateTradeData(current.id, buildReviewAssessmentPatch(
      current,
      assessment,
      businessDateAnchor.now,
      tradingDayStartHour,
    ))
    const latestActionId = useStore.getState().undoStack.at(-1)?.actionId
    const actionId = latestActionId !== previousActionId ? latestActionId : null
    focusAfterTransitionRef.current = true
    setSession((value) => value ? {
      ...value,
      cursor: Math.min(value.cursor + 1, value.ids.length),
      assessments: { ...value.assessments, [current.id]: assessment },
      assessmentActionIds: { ...(value.assessmentActionIds ?? {}), [current.id]: actionId },
    } : value)
    if (actionId) {
      toast('已记录评估', {
        label: '撤销',
        onClick: () => {
          if (!useStore.getState().undo(actionId)) {
            toast('该评估之后目标字段已变化，无法安全撤销')
            return
          }
          setSession((value) => {
            if (!value) return value
            const assessments = { ...value.assessments }
            const assessmentActionIds = { ...(value.assessmentActionIds ?? {}) }
            delete assessments[current.id]
            delete assessmentActionIds[current.id]
            return { ...value, assessments, assessmentActionIds }
          })
        },
      })
    } else {
      toast('已记录评估')
    }
  }, [businessDateAnchor.now, current, tradingDayStartHour, updateTradeData])

  const extractCurrentAsCase = useCallback(() => {
    if (!current || current.tradeKind === 'case') return
    const result = useStore.getState().createReviewCaseFromTrade(current.id)
    if (result.status !== 'created') {
      toast(result.status === 'source-is-case' ? '案例不能再次提炼' : '原交易已不存在')
      return
    }
    toast('已提炼为案例')
  }, [current])

  useEffect(() => {
    if (!focusAfterTransitionRef.current) return
    focusAfterTransitionRef.current = false
    if (settingsDraft) return
    const frame = requestAnimationFrame(() => {
      const selector = roundEnded
        ? '[data-review-session-finished-focus]'
        : current
          ? '[data-review-session-focus]'
          : '[data-review-session-start-focus]'
      document.querySelector<HTMLElement>(selector)?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [current, roundEnded, session?.cursor, settingsDraft])

  useEffect(() => {
    if (!focusSettingsApplyAfterCancelRef.current || pendingFilters || !settingsDraft) return
    focusSettingsApplyAfterCancelRef.current = false
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-review-settings-apply]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [pendingFilters, settingsDraft])

  useEffect(() => () => {
    if (pendingFiltersFrameRef.current !== null) {
      cancelAnimationFrame(pendingFiltersFrameRef.current)
    }
  }, [])

  useEffect(() => registerShortcutHandlers({
    'reviewSession.exit': exitReviewSession,
  }), [exitReviewSession])

  useEffect(() => {
    if (!session || roundEnded || !current) return
    return registerShortcutHandlers(createReviewSessionShortcutHandlers({
      current,
      onAssess: assess,
      onSkip: advance,
      onBack: rewind,
    }))
  }, [advance, assess, current, rewind, roundEnded, session])

  const rememberFilters = (nextFilters: ReviewSessionFilters) => {
    setFilters(nextFilters)
    if (libraryId && !saveReviewSessionFilters(libraryId, nextFilters)) setPersistenceWarning(true)
  }

  const start = () => {
    const ids = shuffleReviewSessionIds(pool.map((trade) => trade.id))
    if (ids.length === 0) return
    focusAfterTransitionRef.current = true
    rememberFilters(filters)
    setSession({ ids, cursor: 0, filters, assessments: {} })
  }

  const startSystemPool = (poolId: SystemReviewPoolId) => {
    const ids = shuffleReviewSessionIds(systemPools[poolId].map((trade) => trade.id))
    if (ids.length === 0) return
    focusAfterTransitionRef.current = true
    setSession({
      ids,
      cursor: 0,
      filters: SYSTEM_POOL_SESSION_FILTERS,
      systemPoolId: poolId,
      assessments: {},
    })
  }

  const startHomePool = (poolRef: ReviewPoolRef) => {
    if (poolRef.kind === 'system') {
      startSystemPool(poolRef.id)
      return
    }
    const ids = shuffleReviewSessionIds((customPools.get(poolRef.id) ?? []).map((trade) => trade.id))
    if (ids.length === 0) return
    focusAfterTransitionRef.current = true
    setSession({
      ids,
      cursor: 0,
      filters: SYSTEM_POOL_SESSION_FILTERS,
      customPoolId: poolRef.id,
      assessments: {},
    })
  }

  const clearActiveSession = (nextFilters = filters) => {
    focusAfterTransitionRef.current = true
    if (libraryId) clearReviewSessionStorage(libraryId)
    rememberFilters(nextFilters)
    setSession(null)
    setResolvedNote(EMPTY_NOTE_STATE)
  }

  const openSettings = (next = filters) => setSettingsDraft({ ...next })

  const applySettings = () => {
    if (!settingsDraft) return
    const nextFilters: ReviewSessionFilters = {
      ...settingsDraft,
      stageSource: normalizeReviewStageSource(settingsDraft.stageSource, liveStages),
    }
    if (session && session.ids.length > 0 && !roundEnded && !haveSameReviewFilters(session.filters, nextFilters)) {
      setPendingFilters(nextFilters)
      return
    }
    rememberFilters(nextFilters)
    setSettingsDraft(null)
    if (session?.ids.length === 0) {
      if (libraryId) clearReviewSessionStorage(libraryId)
      setSession(null)
      setResolvedNote(EMPTY_NOTE_STATE)
    }
  }

  const cancelPendingFilters = () => {
    if (pendingFiltersBusy) return
    focusSettingsApplyAfterCancelRef.current = true
    setPendingFilters(null)
  }

  const confirmPendingFilters = () => {
    if (!pendingFilters || pendingFiltersApplyRef.current) return
    const nextFilters = pendingFilters
    pendingFiltersApplyRef.current = true
    setPendingFiltersBusy(true)
    pendingFiltersFrameRef.current = requestAnimationFrame(() => {
      pendingFiltersFrameRef.current = null
      const nextPool = buildReviewSessionPool(
        trades,
        nextFilters,
        starred,
        businessDateAnchor.currentTradingDayKey,
        tradingDayStartHour,
        { liveStages, currentLiveStageId },
      )
      focusAfterTransitionRef.current = true
      rememberFilters(nextFilters)
      setSettingsDraft(null)
      setPendingFilters(null)
      if (
        nextPool.length === 0 &&
        !(typeof nextFilters.stageSource === 'object' && nextFilters.stageSource.stageIds.length === 0)
      ) {
        if (libraryId) clearReviewSessionStorage(libraryId)
        setSession(null)
        setResolvedNote(EMPTY_NOTE_STATE)
      } else {
        setSession({
          ids: shuffleReviewSessionIds(nextPool.map((trade) => trade.id)),
          cursor: 0,
          filters: nextFilters,
          assessments: {},
        })
      }
      pendingFiltersApplyRef.current = false
      setPendingFiltersBusy(false)
    })
  }

  const reshuffle = () => {
    if (!session) return
    const nextFilters = reviewFiltersForNextRound(session)
    const nextPool = session.systemPoolId
      ? buildSystemReviewPool(trades, session.systemPoolId, subscribed)
      : session.customPoolId
        ? customPools.get(session.customPoolId) ?? []
        : buildReviewSessionPool(
        trades,
        nextFilters,
        starred,
        businessDateAnchor.currentTradingDayKey,
        tradingDayStartHour,
        { liveStages, currentLiveStageId },
      )
    if (nextPool.length === 0) {
      clearActiveSession(nextFilters)
      return
    }
    focusAfterTransitionRef.current = true
    rememberFilters(nextFilters)
    setSession({
      ids: shuffleReviewSessionIds(nextPool.map((trade) => trade.id)),
      cursor: 0,
      filters: nextFilters,
      systemPoolId: session.systemPoolId,
      customPoolId: session.customPoolId,
      assessments: {},
    })
  }

  const adjustFinishedSession = () => {
    if (!session) return
    const previousFilters = { ...reviewFiltersForNextRound(session) }
    clearActiveSession(previousFilters)
    setSettingsDraft(previousFilters)
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
        <RotateCcw size={ICON_XL} aria-hidden />
        <span>正在恢复复盘会话…</span>
      </div>
    )
  }

  return (
    <div className="review-session-view">
      <header className="review-session-topbar">
        <Button type="button" variant="ghost" className="review-session-back" onClick={exitReviewSession}>
          <ChevronLeft size={ICON_MD} aria-hidden />
          <span>{session && session.ids.length > 0 ? '退出复盘' : '返回'}</span>
        </Button>
        <div className="review-session-heading">
          <RotateCcw size={ICON_MD} aria-hidden />
          <strong>随机复盘</strong>
        </div>
        {session && session.ids.length > 0 && !roundEnded ? (
          <div className="review-session-topbar-end">
            <span className="review-session-assessed">已评 {assessedCount}</span>
            <span className="review-session-progress" aria-live="polite">
              {session.cursor + 1} / {session.ids.length}
            </span>
            <Button type="button" variant="bordered" onClick={() => openSettings(session.filters)}>调整范围</Button>
            <Button type="button" variant="bordered" onClick={() => clearActiveSession(reviewFiltersForNextRound(session))}>结束本轮</Button>
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
          globalCandidateCount={systemPools.all.length}
          homePools={homePools}
          onOpenSettings={openSettings}
          onOpenManager={() => setPoolManagerOpen(true)}
          onStartPool={startHomePool}
          onStart={start}
        />
      ) : hasExplicitEmptySelection ? (
        <ReviewSessionEmptySelection onAdjust={() => openSettings(session.filters)} />
      ) : roundEnded ? (
        <ReviewSessionFinished
          session={session}
          onBack={rewind}
          onReshuffle={reshuffle}
          onAdjust={adjustFinishedSession}
        />
      ) : !current ? (
        <div className="review-session-loading" role="status">正在跳过已删除的记录…</div>
      ) : (
        <ReviewSessionItem
          trade={current}
          strategyName={getStrategyName(strategies, current.strategyId)}
          note={resolvedNote.tradeId === current.id ? resolvedNote : EMPTY_NOTE_STATE}
          onAssess={assess}
          onExtractCase={extractCurrentAsCase}
          onSkip={advance}
          onBack={session.cursor > 0 ? rewind : undefined}
          onOpenDetail={openDetail}
          privacyMode={privacyMode}
          legacyCashCurrencyAssumption={legacyCashCurrencyAssumption}
          originLabel={reviewStageOriginLabel(current, liveStages, currentLiveStageId)}
        />
      )}
      {settingsDraft && pendingFilters ? (
        <ReviewSessionRegenerationConfirmation
          filters={pendingFilters}
          busy={pendingFiltersBusy}
          onCancel={cancelPendingFilters}
          onConfirm={confirmPendingFilters}
        />
      ) : settingsDraft ? (
        <ReviewSessionSettingsModal
          filters={settingsDraft}
          liveStages={liveStages}
          currentLiveStageId={currentLiveStageId}
          hasActiveSession={Boolean(session && session.ids.length > 0 && !roundEnded)}
          activeStageSource={session && session.ids.length > 0 && !roundEnded ? session.filters.stageSource : null}
          poolSize={settingsPoolSize}
          onChange={setSettingsDraft}
          onApply={applySettings}
          onClose={() => setSettingsDraft(null)}
        />
      ) : poolManagerOpen ? (
        <ReviewPoolManagerModal
          presets={reviewPoolPresets}
          layout={reviewPoolLayout}
          strategies={strategies}
          onSavePreset={saveReviewPoolPreset}
          onRemovePreset={removeReviewPoolPreset}
          onChangeLayout={setReviewPoolLayout}
          onClose={() => setPoolManagerOpen(false)}
        />
      ) : null}
    </div>
  )
}

function ReviewSessionStart({
  filters,
  poolSize,
  globalCandidateCount,
  homePools,
  onOpenSettings,
  onOpenManager,
  onStartPool,
  onStart,
}: {
  filters: ReviewSessionFilters
  poolSize: number
  globalCandidateCount: number
  homePools: readonly ReviewPoolStartItem[]
  onOpenSettings: () => void
  onOpenManager: () => void
  onStartPool: (poolRef: ReviewPoolRef) => void
  onStart: () => void
}) {
  const hasEmptyStageSelection = typeof filters.stageSource === 'object' && filters.stageSource.stageIds.length === 0
  const emptyMessage = hasEmptyStageSelection
    ? '尚未选择实盘阶段'
    : globalCandidateCount === 0
    ? '还没有可复盘的案例或实盘交易'
    : '当前复盘设置下没有可复盘内容，请调整复盘设置'
  const emptyHint = globalCandidateCount === 0
    ? '先返回交易日志补充内容，或新建交易。'
    : '全局仍有候选内容，可以调整复盘设置或管理复盘池。'

  return (
    <section className="review-session-start" data-review-session-start-focus tabIndex={-1}>
      <div className="review-session-intro">
        <h1>随机复盘</h1>
      </div>

      <fieldset className="review-session-presets" aria-label="复盘池">
        <div className="review-session-preset-list">
          {homePools.map((preset) => (
            <button
              key={`${preset.ref.kind}:${preset.ref.id}`}
              type="button"
              disabled={preset.count === 0}
              onClick={() => onStartPool(preset.ref)}
            >
              <strong>{preset.label} · {preset.count}</strong>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="review-session-start-footer">
        <div>
          <strong>{poolSize > 0 ? `可随机复盘 ${poolSize} 条` : emptyMessage}</strong>
          <span>{poolSize > 0 ? reviewStageSourceLabel(filters.stageSource) : emptyHint}</span>
        </div>
        <div className="review-session-start-actions">
          {poolSize > 0 ? (
            <Button type="button" variant="primary" size="lg" onClick={onStart}>
              开始复盘
              <ChevronRight size={ICON_MD} aria-hidden />
            </Button>
          ) : globalCandidateCount > 0 ? (
            <Button type="button" variant="primary" size="lg" onClick={onOpenSettings}>调整复盘设置</Button>
          ) : null}
          <Menu
            align="right"
            trigger={<Button type="button" variant="ghost"><MoreHorizontal size={ICON_MD} aria-hidden />更多</Button>}
            options={[
              { value: 'manager', label: '管理复盘池', icon: <BookOpen size={ICON_MD} /> },
              { value: 'settings', label: '复盘设置', icon: <SlidersHorizontal size={ICON_MD} /> },
            ]}
            onSelect={(value) => {
              if (value === 'manager') onOpenManager()
              if (value === 'settings') onOpenSettings()
            }}
          />
        </div>
      </div>
    </section>
  )
}

function ReviewSessionSettingsModal({
  filters,
  liveStages,
  currentLiveStageId,
  hasActiveSession,
  activeStageSource,
  poolSize,
  onChange,
  onApply,
  onClose,
}: {
  filters: ReviewSessionFilters
  liveStages: readonly LiveStage[]
  currentLiveStageId: string
  hasActiveSession: boolean
  activeStageSource: ReviewStageSource | null
  poolSize: number
  onChange: (filters: ReviewSessionFilters) => void
  onApply: () => void
  onClose: () => void
}) {
  const patchFilters = (patch: Partial<ReviewSessionFilters>) => onChange({ ...filters, ...patch })
  const noSources = !filters.includeCases && !filters.includeLiveTrades && !filters.includePaperTrades
  const orderedStages = [...liveStages]
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  const selectedStageIds = typeof filters.stageSource === 'object'
    ? new Set(filters.stageSource.stageIds)
    : new Set<string>()

  const changeStageSource = (value: string) => {
    patchFilters({
      stageSource: value === 'custom'
        ? { stageIds: [] }
        : value as Exclude<ReviewStageSource, { stageIds: string[] }>,
    })
  }

  const toggleStage = (stageId: string, selected: boolean) => {
    const nextIds = new Set(selectedStageIds)
    if (selected) nextIds.add(stageId)
    else nextIds.delete(stageId)
    patchFilters({
      stageSource: normalizeReviewStageSource(
        { stageIds: [...nextIds] },
        orderedStages,
      ),
    })
  }

  return (
    <ModalShell
      title="复盘设置"
      description={hasActiveSession
        ? '应用新范围会重新生成当前轮次，并在确认后丢弃本轮进度。'
        : '只影响接下来开启的这一轮复盘。'}
      size="compact"
      onClose={onClose}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
        <Button
          type="button"
          variant="primary"
          data-review-settings-apply
          disabled={noSources}
          onClick={onApply}
        >应用设置</Button>
      </>}
    >
      {activeStageSource ? (
        <p
          className="review-session-active-source"
          data-active-stage-source={stageSourceSelectValue(activeStageSource)}
        >
          当前轮次：{reviewStageSourceLabel(activeStageSource)}
        </p>
      ) : null}
      <div className="review-session-stage-source-filter">
        <label>
          <span>阶段来源</span>
          <Select
            className="review-session-stage-source-select"
            value={stageSourceSelectValue(filters.stageSource)}
            ariaLabel="阶段来源"
            options={REVIEW_STAGE_SOURCE_OPTIONS}
            onValueChange={changeStageSource}
          />
        </label>
        {typeof filters.stageSource === 'object' ? (
          <fieldset className="review-session-stage-options">
            <legend>选择一个或多个实盘阶段</legend>
            {orderedStages.map((stage) => (
              <label className="review-session-stage-option" key={stage.id}>
                <input
                  type="checkbox"
                  checked={selectedStageIds.has(stage.id)}
                  onChange={(event) => toggleStage(stage.id, event.target.checked)}
                />
                <span>
                  <strong>{stage.name} · {stage.id === currentLiveStageId && stage.status === 'current' ? '当前阶段' : '已归档'}</strong>
                  <small>{stage.startsOn}{stage.endsOn ? ` — ${stage.endsOn}` : ' — 至今'}</small>
                </span>
              </label>
            ))}
            {filters.stageSource.stageIds.length === 0 ? (
              <p>尚未选择实盘阶段；不会自动扩大到其他阶段。</p>
            ) : null}
          </fieldset>
        ) : null}
      </div>
      <fieldset className="review-session-settings-sources">
        <legend>随机范围</legend>
        <label className={filters.includeCases ? 'is-selected' : undefined}>
          <input
            type="checkbox"
            checked={filters.includeCases}
            onChange={(event) => patchFilters({ includeCases: event.target.checked })}
          />
          <BookOpen size={ICON_XL} aria-hidden />
          <span><strong>案例库</strong><small>全部历史案例，不随新实盘阶段清空</small></span>
        </label>
        <label className={filters.includeLiveTrades ? 'is-selected' : undefined}>
          <input
            type="checkbox"
            checked={filters.includeLiveTrades}
            onChange={(event) => patchFilters({ includeLiveTrades: event.target.checked, includeAccountTrades: false })}
          />
          <ListTodo size={ICON_XL} aria-hidden />
          <span><strong>实盘交易</strong><small>所选阶段内已结束或已错过的实盘记录</small></span>
        </label>
        <label className={filters.includePaperTrades ? 'is-selected' : undefined}>
          <input
            type="checkbox"
            checked={filters.includePaperTrades}
            onChange={(event) => patchFilters({ includePaperTrades: event.target.checked, includeAccountTrades: false })}
          />
          <ListTodo size={ICON_XL} aria-hidden />
          <span><strong>模拟盘</strong><small>全部已结束或已错过的模拟记录，不受实盘阶段限制</small></span>
        </label>
      </fieldset>
      <div className="review-session-settings-options">
        <label className="review-session-timing-filter">
          <span>时间范围</span>
          <Select
            className="review-session-timing-select"
            value={filters.reviewTiming}
            disabled={!filters.includeCases}
            ariaLabel="复盘时间范围"
            options={REVIEW_TIMING_OPTIONS}
            onValueChange={(value) => patchFilters({ reviewTiming: value as ReviewSessionFilters['reviewTiming'] })}
          />
        </label>
        <label className="review-session-case-scope">
          <span>案例范围</span>
          <Select
            className="review-session-scope-select"
            value={filters.caseScope}
            disabled={!filters.includeCases}
            ariaLabel="案例范围"
            options={CASE_SCOPE_OPTIONS}
            onValueChange={(value) => patchFilters({ caseScope: value as ReviewCaseScope })}
          />
        </label>
        <label className="review-session-content-toggle">
          <input
            type="checkbox"
            checked={filters.requireContent}
            onChange={(event) => patchFilters({ requireContent: event.target.checked })}
          />
          <Image size={ICON_LG} aria-hidden />
          <span>仅含有效图文</span>
        </label>
      </div>
      <p className="review-session-settings-count" role="status">
        {noSources ? '请选择至少一个来源' : `当前设置可复盘 ${poolSize} 条`}
      </p>
    </ModalShell>
  )
}

function ReviewSessionRegenerationConfirmation({
  filters,
  busy,
  onCancel,
  onConfirm,
}: {
  filters: ReviewSessionFilters
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const formId = 'review-session-regeneration-confirm-form'

  return (
    <ModalShell
      title="重新生成当前轮次？"
      description="应用新的复盘范围会重新生成随机队列。"
      size="compact"
      busy={busy}
      initialFocusSelector="[data-review-regeneration-cancel]"
      onClose={onCancel}
      footer={<>
        <Button
          type="button"
          variant="bordered"
          data-review-regeneration-cancel
          disabled={busy}
          onClick={onCancel}
        >保留当前轮次</Button>
        <Button
          type="submit"
          form={formId}
          variant="primary"
          busy={busy}
          disabled={busy}
        >重新生成轮次</Button>
      </>}
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm()
        }}
      >
        <p className="review-session-active-source">本轮已评进度会被丢弃，且无法从本轮恢复。</p>
        <p className="review-session-settings-count">新阶段来源：{reviewStageSourceLabel(filters.stageSource)}</p>
      </form>
    </ModalShell>
  )
}

function ReviewSessionEmptySelection({ onAdjust }: { onAdjust: () => void }) {
  return (
    <section className="review-session-empty-selection" data-review-session-start-focus tabIndex={-1} role="status">
      <span className="review-session-eyebrow">自选阶段</span>
      <h1>尚未选择实盘阶段</h1>
      <p>原先选择的阶段已不存在，或当前没有选择任何阶段。范围保持为空，不会自动扩大。</p>
      <Button type="button" variant="primary" onClick={onAdjust}>重新选择阶段</Button>
    </section>
  )
}

function metricTone(value: number | null | undefined): 'zero' | 'positive' | 'negative' {
  return value == null || value === 0 ? 'zero' : value > 0 ? 'positive' : 'negative'
}

function ReviewSessionAssessmentButton({
  option,
  onAssess,
}: {
  option: (typeof ASSESSMENT_OPTIONS)[number]
  onAssess: (assessment: ReviewSessionAssessment) => void
}) {
  const shortcut = useShortcutHint(option.actionId, `${option.label}，${option.hint}`)
  return (
    <button
      type="button"
      className={`is-${option.value}`}
      aria-label={shortcut.ariaLabel}
      aria-keyshortcuts={shortcut.hint ?? undefined}
      onClick={() => onAssess(option.value)}
    >
      <span>{option.label}</span>
      <small>{option.hint}</small>
      {shortcut.hint ? <Kbd>{shortcut.hint}</Kbd> : null}
    </button>
  )
}

function ReviewSessionItem({
  trade,
  strategyName,
  note,
  onAssess,
  onExtractCase,
  onSkip,
  onBack,
  onOpenDetail,
  privacyMode,
  legacyCashCurrencyAssumption,
  originLabel,
}: {
  trade: Trade
  strategyName: string
  note: ResolvedNoteState
  onAssess: (assessment: ReviewSessionAssessment) => void
  onExtractCase: () => void
  onSkip: () => void
  onBack?: () => void
  onOpenDetail: () => void
  privacyMode: boolean
  legacyCashCurrencyAssumption: import('@/storage/types').LegacyCashCurrencyAssumption | null
  originLabel: string
}) {
  const rTone = metricTone(trade.rMultiple)
  const rawPnlTone = metricTone(trade.pnl)
  const pnlTone = privacyMode ? 'zero' : rawPnlTone
  const skipShortcut = useShortcutHint(
    'reviewSession.skip',
    trade.tradeKind === 'case' ? '跳过' : '下一条',
  )
  const backShortcut = useShortcutHint('reviewSession.back')
  return (
    <section className="review-session-stage" data-review-session-focus tabIndex={-1}>
      <article className="review-session-workspace" aria-label={`${trade.symbol} 随机复盘`}>
        <header className="review-session-item-header">
          <div className="review-session-item-primary">
            <Chip size="sm" variant="soft">{TRADE_KIND_META[trade.tradeKind].label}</Chip>
            <span className="review-session-origin">来源 · {originLabel}</span>
            <h1>{trade.symbol}</h1>
            <Chip size="sm" variant="outline">
              {trade.tradeKind === 'case'
                ? REVIEW_CATEGORY_META[trade.reviewCategory].label
                : STATUS_META[trade.status].label}
            </Chip>
          </div>
          <div className="review-session-summary" aria-label="当前记录摘要">
            <span className="review-session-card-ref">{trade.ref}</span>
            <span>{strategyName}</span>
            <span>{trade.side === 'long' ? '做多' : '做空'}</span>
            <span>{fmtDate(trade.recordedAt ?? trade.openedAt)}</span>
            <span className={`is-${rTone}`}>{fmtR(trade.rMultiple)}</span>
            {trade.pnl != null ? <span className={`is-${pnlTone}`}>{formatTradeCashPnl(trade, legacyCashCurrencyAssumption, privacyMode)}</span> : null}
            <Button type="button" variant="bordered" onClick={onOpenDetail}>打开详情</Button>
          </div>
        </header>

        <ReviewSessionNote note={note} />

        {trade.tradeKind === 'case' ? (
          <footer className="review-session-assessment">
            <div>
              <strong>这套做法你掌握到什么程度？</strong>
              <span>选择后记录掌握度并进入下一条</span>
            </div>
            <div className="review-session-assessment-actions">
              {ASSESSMENT_OPTIONS.map((option) => (
                <ReviewSessionAssessmentButton
                  key={option.value}
                  option={option}
                  onAssess={onAssess}
                />
              ))}
              <button
                type="button"
                className="review-session-skip"
                aria-label={skipShortcut.ariaLabel}
                aria-keyshortcuts={skipShortcut.hint ?? undefined}
                onClick={onSkip}
              >
                跳过 {skipShortcut.hint ? <Kbd>{skipShortcut.hint}</Kbd> : null}
              </button>
              {onBack ? (
                <button
                  type="button"
                  className="review-session-skip"
                  aria-label={backShortcut.ariaLabel}
                  aria-keyshortcuts={backShortcut.hint ?? undefined}
                  onClick={onBack}
                >
                  上一条 {backShortcut.hint ? <Kbd>{backShortcut.hint}</Kbd> : null}
                </button>
              ) : null}
            </div>
          </footer>
        ) : (
          <footer className="review-session-assessment is-account-trade">
            <div>
              <strong>把这笔交易沉淀成可复看的知识</strong>
              <span>账户交易不记录案例掌握度</span>
            </div>
            <div className="review-session-assessment-actions review-session-account-actions">
              <button type="button" onClick={onExtractCase}>提炼为案例</button>
              <button
                type="button"
                className="review-session-skip"
                aria-label={skipShortcut.ariaLabel}
                aria-keyshortcuts={skipShortcut.hint ?? undefined}
                onClick={onSkip}
              >
                下一条 {skipShortcut.hint ? <Kbd>{skipShortcut.hint}</Kbd> : null}
              </button>
            </div>
          </footer>
        )}
      </article>
    </section>
  )
}

function ReviewSessionNote({ note }: { note: ResolvedNoteState }) {
  const presentation = useMemo(() => splitReviewNoteHtml(note.html), [note.html])
  const [settledImages, setSettledImages] = useState<{
    tradeId: string | null
    status: 'idle' | 'loading' | 'ready'
    slots: ReviewImageSlot[]
  }>({ tradeId: null, status: 'idle', slots: [] })
  const hasBody = hasEffectiveReviewContent(presentation.bodyHtml)
  const imagesReady = settledImages.tradeId === note.tradeId && settledImages.status === 'ready'

  useEffect(() => {
    if (note.status !== 'ready' || presentation.images.length === 0) {
      setSettledImages({ tradeId: note.tradeId, status: 'idle', slots: [] })
      return
    }
    let current = true
    setSettledImages({ tradeId: note.tradeId, status: 'loading', slots: [] })
    void settleReviewImageGroup(presentation.images).then((slots) => {
      if (current) setSettledImages({ tradeId: note.tradeId, status: 'ready', slots })
    })
    return () => { current = false }
  }, [note.tradeId, note.status, presentation.images])

  if (note.status === 'loading' || note.status === 'idle') {
    return <div className="review-session-reading review-session-note-state" role="status">正在载入完整复盘…</div>
  }
  if (note.status === 'error') {
    return (
      <div className="review-session-reading review-session-note-state is-error" role="alert">
        <AlertCircle size={ICON_LG} aria-hidden />
        <span>本条图文暂时无法读取，你仍可评估或跳过。</span>
      </div>
    )
  }
  if (!hasBody && presentation.images.length === 0) {
    return (
      <div className="review-session-reading review-session-note-state">
        <Image size={ICON_XL} aria-hidden />
        <span>暂无复盘笔记</span>
      </div>
    )
  }

  return (
    <section className={`review-session-reading review-session-content${hasBody && presentation.images.length > 0 ? ' has-split-content' : ''}`} aria-label="完整复盘内容">
      {presentation.images.length > 0 ? (
        <div
          className={`review-session-gallery is-${presentation.images.length === 1 ? 'single' : 'multiple'}`}
          aria-label={`交易截图，共 ${presentation.images.length} 张`}
          aria-busy={!imagesReady}
        >
          {!imagesReady ? (
            <span className="review-session-gallery-status" role="status">交易截图载入中…</span>
          ) : null}
          {imagesReady ? settledImages.slots.map((slot, index) => (
            slot.status === 'ready' ? (
              <button
                className="review-session-gallery-slot is-ready"
                type="button"
                key={`${slot.src}-${index}`}
                onClick={(event) => {
                  const readySources = settledImages.slots
                    .filter((candidate) => candidate.status === 'ready')
                    .map((candidate) => candidate.src)
                  const lightboxIndex = settledImages.slots
                    .slice(0, index + 1)
                    .filter((candidate) => candidate.status === 'ready').length - 1
                  const rect = event.currentTarget.querySelector('img')?.getBoundingClientRect()
                  useShortcutStore.getState().openLightbox(
                    readySources,
                    lightboxIndex,
                    undefined,
                    rect ? {
                      x: rect.x,
                      y: rect.y,
                      width: rect.width,
                      height: rect.height,
                      borderRadius: Number.parseFloat(getComputedStyle(event.currentTarget).borderRadius) || 0,
                    } : undefined,
                  )
                }}
                aria-label={`放大查看${slot.alt}`}
              >
                <img src={slot.src} alt={slot.alt} />
                <span>{index + 1} / {presentation.images.length}</span>
              </button>
            ) : (
              <div className="review-session-gallery-slot is-error" key={`${slot.src}-${index}`} role="img" aria-label={`${slot.alt}加载失败`}>
                <AlertCircle size={ICON_LG} aria-hidden />
                <span>图片暂时无法显示</span>
              </div>
            )
          )) : presentation.images.map((image, index) => (
            <div className="review-session-gallery-slot is-loading" key={`${image.src}-${index}`} aria-hidden="true" />
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
  onBack,
  onReshuffle,
  onAdjust,
}: {
  session: ReviewSessionSnapshot
  onBack: () => void
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
  const completionMessage = results.length > 0
    ? '掌握度已经写回记录，需要复看的内容会按计划重新出现。'
    : '本轮没有写入案例掌握度，浏览进度只保留在本轮会话中。'
  return (
    <section className="review-session-finished" data-review-session-finished-focus tabIndex={-1} role="status" aria-live="polite" aria-atomic="true">
      <span className="review-session-finished-icon"><CheckCircle size={ICON_2XL} aria-hidden /></span>
      <span className="review-session-eyebrow">本轮完成</span>
      <h1>已复盘 {session.ids.length} 条交易</h1>
      <p>{completionMessage}</p>
      <div className="review-session-result-grid">
        <span><strong>{counts.unfamiliar}</strong><small>还没掌握</small></span>
        <span><strong>{counts.recheck}</strong><small>基本理解</small></span>
        <span><strong>{counts.mastered}</strong><small>已经掌握</small></span>
        <span><strong>{counts.skipped}</strong><small>跳过</small></span>
      </div>
      <div className="review-session-finished-actions">
        <Button type="button" variant="bordered" onClick={onBack}><ChevronLeft size={ICON_MD} aria-hidden />上一条</Button>
        <Button type="button" variant="primary" size="lg" onClick={onReshuffle}><RotateCcw size={ICON_MD} aria-hidden />再随机一轮</Button>
        <Button type="button" variant="bordered" onClick={onAdjust}><SlidersHorizontal size={ICON_MD} aria-hidden />重新设置</Button>
      </div>
    </section>
  )
}
