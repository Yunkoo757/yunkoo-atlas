import { create } from 'zustand'
import {
  isReviewCompleted,
  type Trade,
  type TradeStatus,
  type Conviction,
  type TradeSide,
  type TradeKind,
  type TradeComment,
} from '@/data/trades'
import { type Strategy } from '@/data/strategies'
import {
  DEFAULT_DISPLAY,
  normalizeDisplay,
  type DisplayPrefs,
} from '@/lib/tradeFilters'
import type { PersistedSnapshot, UserProfile } from '@/storage/types'
import {
  DEFAULT_REVIEW_POOL_LAYOUT,
  normalizeReviewPoolLayout,
  type ReviewPoolLayout,
  type ReviewPoolPreset,
} from '@/lib/reviewPools'
import type { ExportPayload } from '@/lib/importTypes'
import {
  createDefaultReviewTemplates,
  createReviewTemplate,
  normalizeReviewTemplates,
  type ReviewTemplate,
} from '@/data/reviewTemplates'
import { mergeImportPayload } from '@/lib/importMerge'
import { appendActivity, createActivity } from '@/lib/activities'
import { isActive, isExecutedClosed, isTerminal } from '@/lib/tradeStatus'
import { normalizeReviewFields } from '@/lib/reviewAnalytics'
import { promoteTradeSession, promoteTradeNotionMeta } from '@/lib/tradeView'
import {
  normalizeSavedTradeViews,
  type SavedTradeView,
} from '@/lib/savedTradeViews'
import {
  normalizeSymbol,
  type SymbolIconsMap,
  DEFAULT_SYMBOL_CATALOG,
  normalizeSymbolCatalog,
} from '@/lib/symbolIcons'
import { mergeTagPresets } from '@/lib/tags'
import { normalizeTradeMetrics, resolveTradeResultSource } from '@/lib/tradeTruth'
import { DEFAULT_TRADING_DAY_START_HOUR, getTradingDayKey } from '@/lib/periods'
import { closedTradingDayKeyFromClosedAt } from '@/lib/riskBudget'
import type { TradeClosePatch } from '@/lib/tradeClose'
import {
  completeWeeklyReviewCandidate,
  normalizeWeeklyReviews,
  reopenCompletedReview,
  type WeeklyReview,
} from '@/data/weeklyReviews'
import { normalizeInitialStopLoss, prepareTradeResultEdit } from '@/lib/tradeResult'
import {
  normalizeSidebarWorkspaceItems,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import {
  DEFAULT_USER_DISPLAY_NAME,
  createDefaultStrategies,
} from '@/config/defaultProfile'
import { reorderByKey } from '@/lib/reorder'
import {
  normalizeQuickNotes,
  type QuickNote,
} from '@/data/quickNotes'
import {
  assertValidLiveStageState,
  createInitialLiveStage,
  getCurrentLiveStage,
  normalizeLiveStageName,
  type LiveStage,
  type ScheduledStageRollover,
} from '@/lib/liveStages'
import { scheduleStageRollover } from '@/lib/stageRollover'
import { stageContainsWeeklyReviewPeriod } from '@/lib/weeklyReviewPeriod'
import type { StageRolloverPublishState } from '@/types/journalBridge'
import {
  assignPendingStageOwnership as applyPendingStageOwnership,
  rollbackAssignedStageOwnership as applyOwnershipRollback,
  type AssignPendingStageOwnershipRequest,
  type RollbackAssignedStageOwnershipRequest,
} from '@/lib/stageOwnershipRepair'

import {
  applyUndoAction,
  buildUndoAction,
  type UndoAction,
} from '@/lib/tradeUndo'
import { transitionTradeKind as applyTradeKindTransition } from '@/lib/tradeKind'
import type {
  MonthlyRiskLimit,
  RiskOverrideEvent,
  RiskPolicyDraft,
  RiskPolicyVersion,
  WeeklyRiskPreparation,
} from '@/data/riskManagement'
import {
  confirmWeeklyRiskPreparation as confirmRiskPolicyState,
  confirmRiskPolicyBaseline,
  ensureRiskPeriodRecords as ensureRiskPolicyPeriodRecords,
  type ConfirmWeeklyRiskPreparationInput,
  type RiskPolicyState,
} from '@/lib/riskPolicy'
import {
  requestTradeOpenCandidate,
  requiresFirstOpenGate,
  type PendingTradeOpenRequest,
  type TradeOpenRequestResult,
} from '@/lib/tradeOpenRiskGate'
import type { RiskGatedTradeOpenCommitResult } from '@/lib/riskGatedTradeOpenCommit'
import { buildReviewCaseFromTrade, getNextReviewCaseRef } from '@/lib/reviewCases'
import {
  applyCaseClassificationMutation,
  containsCaseClassificationMutation,
} from '@/lib/reviewCaseClassification'
import type {
  CommitCopiedCloseDateCleanupResult,
  CommitCopiedCloseDateUndoResult,
  CopiedCloseDatePersistenceBoundary,
} from '@/lib/importDataHealth'

export interface StorePendingTradeOpenRequest extends PendingTradeOpenRequest {
  returnFocus: HTMLElement | null
}

export type SetTradeStatusResult = TradeOpenRequestResult | 'updated' | 'unchanged'

export type CreateReviewCaseResult =
  | { status: 'created'; reviewCase: Trade }
  | { status: 'missing-source' | 'source-is-case' }

export interface ImportDataHealthStoreDependencies {
  boundary: CopiedCloseDatePersistenceBoundary
  persistSnapshot: (snapshot: import('@/storage/types').PersistedSnapshot) => Promise<void>
}

function sameRiskPolicyDraft(left: RiskPolicyDraft, right: RiskPolicyDraft): boolean {
  return left.capitalBase === right.capitalBase &&
    left.riskPercent === right.riskPercent &&
    left.riskAmount === right.riskAmount &&
    left.dailyLossLimitR === right.dailyLossLimitR &&
    left.weeklyLossLimitR === right.weeklyLossLimitR &&
    left.monthlyLossLimitRDefault === right.monthlyLossLimitRDefault &&
    left.disciplineText === right.disciplineText
}

export type TradeUpsertSlice = {
  trades: Trade[]
  strategies: Strategy[]
  symbolCatalog: string[]
  tagPresets: string[]
  mistakeTagPresets: string[]
}

const EXECUTION_RESULT_KEYS = ['side', 'entry', 'exit', 'stopLoss', 'size'] as const
const REVIEW_SENSITIVE_RESULT_KEYS = [
  'status',
  ...EXECUTION_RESULT_KEYS,
  'pnl',
  'rMultiple',
] as const

function sameResultSemanticValue(left: unknown, right: unknown): boolean {
  return left === right || (left == null && right == null)
}

function reopenReviewAfterResultChange(previous: Trade, next: Trade): Trade {
  if (!isReviewCompleted(previous.reviewStatus)) return next
  const previousInitialRisk = previous.initialStopLoss ?? previous.stopLoss ?? null
  const nextInitialRisk = next.initialStopLoss ?? next.stopLoss ?? null
  const changed =
    REVIEW_SENSITIVE_RESULT_KEYS.some(
      (key) => !sameResultSemanticValue(previous[key], next[key]),
    ) ||
    !sameResultSemanticValue(previousInitialRisk, nextInitialRisk) ||
    resolveTradeResultSource(previous) !== resolveTradeResultSource(next)
  return changed
    ? { ...next, reviewStatus: 'unreviewed', reviewedAt: null }
    : next
}

function reconcileExistingExecutionEdit(previous: Trade, next: Trade): Trade {
  const patch: Partial<Pick<Trade, (typeof EXECUTION_RESULT_KEYS)[number]>> = {}
  for (const key of EXECUTION_RESULT_KEYS) {
    if (!Object.is(previous[key], next[key])) {
      Object.assign(patch, { [key]: next[key] })
    }
  }
  if (Object.keys(patch).length === 0) return next

  const result = prepareTradeResultEdit({
    ...previous,
    status: next.status,
    pnl: next.pnl,
    rMultiple: next.rMultiple,
    resultSource: next.resultSource,
  }, { kind: 'execution', patch })
  return {
    ...next,
    ...result.patch,
    ...(result.status && isExecutedClosed(next.status) ? { status: result.status } : {}),
  }
}

function appendBoundedHistory(stack: readonly UndoAction[], action: UndoAction): UndoAction[] {
  return [...stack.slice(-49), action]
}

let undoActionSequence = 0

function nextUndoActionId(): string {
  undoActionSequence += 1
  return `undo-${Date.now().toString(36)}-${undoActionSequence.toString(36)}`
}

function createStoreUndoAction(
  label: string,
  before: readonly Trade[],
  after: readonly Trade[],
): UndoAction | null {
  return buildUndoAction({
    actionId: nextUndoActionId(),
    label,
    createdAt: new Date().toISOString(),
    before,
    after,
  })
}

/** 发布失败时只同步本流程已经耐久提交的交易，并保留会话内其他撤销历史。 */
export function recoverCopiedCloseDateCleanupToStore(
  snapshot: PersistedSnapshot,
  action: UndoAction,
): void {
  useStore.setState((state) => ({
    trades: [...snapshot.trades],
    undoStack: state.undoStack.some((candidate) => candidate.actionId === action.actionId)
      ? state.undoStack
      : appendBoundedHistory(state.undoStack, action),
    redoStack: state.redoStack,
  }))
}

/** 撤销发布失败时按耐久结果完成同一 action 的栈迁移，不执行整库切换 reset。 */
export function recoverCopiedCloseDateUndoToStore(
  snapshot: PersistedSnapshot,
  action: UndoAction,
): void {
  useStore.setState((state) => ({
    trades: [...snapshot.trades],
    undoStack: state.undoStack.filter((candidate) => candidate.actionId !== action.actionId),
    redoStack: state.redoStack.some((candidate) => candidate.actionId === action.actionId)
      ? state.redoStack
      : appendBoundedHistory(state.redoStack, action),
  }))
}

function freezeUpsertedClosedTradingDay(
  previous: Trade | undefined,
  trade: Trade,
  tradingDayStartHour: number,
): Trade {
  if (trade.tradeKind !== 'live' || !isExecutedClosed(trade.status)) return trade
  const shouldCalculate =
    !previous ||
    !isExecutedClosed(previous.status) ||
    previous.closedTradingDayKey === undefined ||
    previous.closedAt !== trade.closedAt
  if (!shouldCalculate) {
    return { ...trade, closedTradingDayKey: previous.closedTradingDayKey }
  }
  return {
    ...trade,
    closedTradingDayKey:
      closedTradingDayKeyFromClosedAt(trade.closedAt, tradingDayStartHour) ?? undefined,
  }
}

function withoutLiveStageForPaper(trade: Trade): Trade {
  if (trade.tradeKind !== 'paper') return trade
  const { liveStageId: _liveStageId, ...paper } = trade as Trade & { liveStageId?: unknown }
  return paper as Trade
}

function upsertTradeIntoSlice(
  s: TradeUpsertSlice,
  trade: Trade,
  tradingDayStartHour: number,
): TradeUpsertSlice {
  const previousTrade = s.trades.find((t) => t.id === trade.id)
  if (previousTrade && (trade.tradeKind ?? 'live') !== previousTrade.tradeKind) return s
  trade = withoutLiveStageForPaper(trade)
  if (previousTrade && previousTrade.tradeKind !== 'paper' && trade.tradeKind !== 'paper') {
    trade = { ...trade, liveStageId: previousTrade.liveStageId }
  }
  const strategies = s.strategies.length > 0 ? s.strategies : createDefaultStrategies()
  const strategyId = strategies.some((strategy) => strategy.id === trade.strategyId)
    ? trade.strategyId
    : strategies[0]?.id ?? 'uncategorized'
  let normalized: Trade = normalizeInitialStopLoss(normalizeTradeMetrics(promoteTradeNotionMeta(
    promoteTradeSession(
      normalizeReviewFields({
        ...trade,
        strategyId,
        tradeKind: trade.tradeKind ?? 'live',
        comments: trade.comments ?? [],
        activities: trade.activities,
      }),
    ),
  )))
  normalized = freezeUpsertedClosedTradingDay(previousTrade, normalized, tradingDayStartHour)
  if (previousTrade) {
    normalized = reopenReviewAfterResultChange(
      previousTrade,
      reconcileExistingExecutionEdit(previousTrade, normalized),
    )
  }
  const symbolKey = normalizeSymbol(normalized.symbol)
  const symbolCatalog =
    !previousTrade && symbolKey && !s.symbolCatalog.includes(symbolKey)
      ? normalizeSymbolCatalog([...s.symbolCatalog, symbolKey])
      : s.symbolCatalog
  if (!previousTrade) {
    const withCreate = createActivity(normalized)
    return {
      trades: [withCreate, ...s.trades],
      strategies,
      symbolCatalog,
      tagPresets: s.tagPresets,
      mistakeTagPresets: s.mistakeTagPresets,
    }
  }
  const prev = previousTrade
  if (prev && prev.status !== normalized.status) {
    normalized = appendActivity(normalized, {
      kind: 'status',
      status: normalized.status,
      timestamp: new Date().toISOString(),
    })
  }
  return {
    trades: s.trades.map((t) => (t.id === trade.id ? normalized : t)),
    strategies,
    symbolCatalog,
    tagPresets: s.tagPresets,
    mistakeTagPresets: s.mistakeTagPresets,
  }
}

function upsertWouldBypassFirstOpenGate(existing: Trade | undefined, incoming: Trade): boolean {
  if ((incoming.tradeKind ?? 'live') !== 'live' || incoming.status !== 'open') {
    return false
  }
  return existing
    ? requiresFirstOpenGate({ ...existing, deletedAt: undefined })
    : true
}

/** 纯计算批量写入结果，供需要先落盘、再发布到 store 的原子导入流程复用。 */
export function applyTradeUpsertsToSlice(
  initial: TradeUpsertSlice,
  trades: Trade[],
  tradingDayStartHour = DEFAULT_TRADING_DAY_START_HOUR,
  currentLiveStageId?: string,
): TradeUpsertSlice {
  let slice = initial
  for (const trade of trades) {
    const existing = slice.trades.find((candidate) => candidate.id === trade.id)
    const owned = existing || !currentLiveStageId
      ? withoutLiveStageForPaper(trade)
      : trade.tradeKind === 'paper'
        ? withoutLiveStageForPaper(trade)
        : { ...trade, liveStageId: currentLiveStageId }
    slice = upsertTradeIntoSlice(slice, owned, tradingDayStartHour)
  }
  return slice
}

function upsertRequiresOpenGate(
  state: State,
  existing: Trade | undefined,
  incoming: Trade,
): boolean {
  if ((incoming.tradeKind ?? 'live') !== 'live' || incoming.status !== 'open') return false
  if (existing?.status === 'open') return false
  return upsertWouldBypassFirstOpenGate(existing, incoming)
}

function openTargetsAnotherLiveStage(
  existing: Trade | undefined,
  incoming: Trade,
  currentLiveStageId: string,
): boolean {
  return incoming.status === 'open' &&
    existing?.tradeKind === 'live' &&
    existing.liveStageId !== currentLiveStageId
}

function updateOwnedNoteActivity(trade: Trade, note: string): Trade {
  if (trade.note === note) return trade
  const now = new Date().toISOString()
  const activities = [...(trade.activities ?? [])]
  const last = activities[activities.length - 1]
  if (last?.kind === 'note') {
    activities[activities.length - 1] = { ...last, timestamp: now }
    return { ...trade, note, activities }
  }
  return appendActivity({ ...trade, note }, { kind: 'note', timestamp: now })
}

interface State {
  trades: Trade[]
  liveStages: LiveStage[]
  currentLiveStageId: string
  scheduledStageRollover: ScheduledStageRollover | null
  weeklyReviews: WeeklyReview[]
  weeklyRiskPreparations: WeeklyRiskPreparation[]
  riskPolicyVersions: RiskPolicyVersion[]
  monthlyRiskLimits: MonthlyRiskLimit[]
  riskOverrideEvents: RiskOverrideEvent[]
  quickNotes: QuickNote[]
  strategies: Strategy[]
  selectedId: string | null
  composerOpen: boolean
  composerTrade: Trade | null
  /** 仅用于显式“新建交易/案例”动作；null 时仍按当前页面推断。 */
  composerKind: TradeKind | null
  closeTradeRequest: {
    tradeId: string
    targetStatus?: Extract<TradeStatus, 'win' | 'loss' | 'breakeven'>
    returnFocus?: HTMLElement | null
  } | null
  pendingTradeOpenRequest: StorePendingTradeOpenRequest | null
  riskSetupTradeOpenRequest: {
    tradeId: string
    returnFocus?: HTMLElement | null
    reason?: 'risk-setup' | 'not-current-stage'
  } | null
  undoStack: UndoAction[]
  redoStack: UndoAction[]
  undo: (actionId?: string) => boolean
  redo: (actionId?: string) => boolean
  cleanupCopiedCloseDates: (
    tradeIds: readonly string[],
    dependencies?: ImportDataHealthStoreDependencies,
  ) => Promise<CommitCopiedCloseDateCleanupResult & { actionId?: string }>
  undoCopiedCloseDateCleanup: (
    actionId: string,
    dependencies?: ImportDataHealthStoreDependencies,
  ) => Promise<CommitCopiedCloseDateUndoResult>
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: DisplayPrefs
  tagPresets: string[]
  mistakeTagPresets: string[]
  profile: UserProfile
  savedTradeViews: SavedTradeView[]
  symbolIcons: SymbolIconsMap
  symbolCatalog: string[]
  reviewTemplates: ReviewTemplate[]
  reviewPoolPresets: ReviewPoolPreset[]
  reviewPoolLayout: ReviewPoolLayout
  saveReviewPoolPreset: (preset: ReviewPoolPreset) => void
  removeReviewPoolPreset: (id: string) => void
  setReviewPoolLayout: (layout: ReviewPoolLayout) => void
  saveTradeView: (view: SavedTradeView) => void
  renameTradeView: (id: string, name: string) => void
  removeTradeView: (id: string) => void
  togglePinTradeView: (id: string) => void
  setSymbolIconPreset: (symbol: string, presetId: string | null) => void
  setSymbolIconCustom: (symbol: string, dataUrl: string | null) => void
  clearSymbolIcon: (symbol: string) => void
  addSymbolToCatalog: (symbol: string) => void
  removeSymbolFromCatalog: (symbol: string) => void
  setSymbolCatalogOrder: (symbols: string[]) => void
  addReviewTemplate: () => string
  updateReviewTemplate: (id: string, patch: Partial<Pick<ReviewTemplate, 'name' | 'content'>>) => void
  removeReviewTemplate: (id: string) => void
  reorderReviewTemplates: (sourceId: string, targetId: string) => void
  setAvatar: (avatarId: string | null) => void
  setCustomAvatar: (dataUrl: string | null) => void
  setDisplayName: (name: string) => void
  hydrateProfile: (profile?: UserProfile) => void
  saveWeeklyRiskDraft: (weekStart: string, draft: RiskPolicyDraft, updatedAt: string) => void
  confirmWeeklyRiskPreparation: (
    input: Omit<ConfirmWeeklyRiskPreparationInput, 'hasClosedLiveTradeOnDay'>,
  ) => void
  saveRiskBaseline: (
    input: Omit<ConfirmWeeklyRiskPreparationInput, 'hasClosedLiveTradeOnDay'>,
  ) => void
  ensureRiskPeriodRecords: (tradingDay: string) => void
  scheduleLiveStageRollover: (currentTradingDayKey: string, now: string) => void
  cancelLiveStageRollover: () => void
  renameLiveStage: (id: string, name: string) => boolean
  publishPostponedRollover: (scheduled: ScheduledStageRollover) => void
  publishCommittedStageRollover: (publish: StageRolloverPublishState) => void
  assignPendingStageOwnership: (
    request: AssignPendingStageOwnershipRequest,
  ) => RollbackAssignedStageOwnershipRequest & AssignPendingStageOwnershipRequest
  rollbackAssignedStageOwnership: (request: RollbackAssignedStageOwnershipRequest) => RollbackAssignedStageOwnershipRequest
  setStatus: (id: string, status: TradeStatus) => SetTradeStatusResult
  requestTradeOpen: (id: string, returnFocus?: HTMLElement | null) => TradeOpenRequestResult
  cancelTradeOpen: () => void
  confirmTradeOpen: (reason: string) => Promise<RiskGatedTradeOpenCommitResult>
  rehydrateRiskGateFromStorage: () => Promise<void>
  completeTradeClose: (
    id: string,
    status: Extract<TradeStatus, 'win' | 'loss' | 'breakeven'>,
    patch: TradeClosePatch,
  ) => void
  setConviction: (id: string, conviction: Conviction) => void
  setSide: (id: string, side: TradeSide) => void
  setStrategy: (id: string, strategyId: string) => void
  setTags: (id: string, tags: string[]) => void
  addTag: (id: string, tag: string) => void
  removeTag: (id: string, tag: string) => void
  updateNote: (id: string, note: string) => void
  updateTradeData: (
    id: string,
    patch: Partial<
      Pick<
        Trade,
        | 'entry'
        | 'exit'
        | 'size'
        | 'pnl'
        | 'rMultiple'
        | 'resultSource'
        | 'side'
        | 'openedAt'
        | 'closedAt'
        | 'stopLoss'
        | 'initialStopLoss'
        | 'missReason'
        | 'mistakeTags'
        | 'reviewStatus'
        | 'reviewedAt'
        | 'reviewCategory'
        | 'timeframe'
        | 'session'
        | 'psychology'
        | 'narrative'
        | 'caseType'
        | 'masteryState'
        | 'nextReviewAt'
        | 'isFocusCase'
      >
    >,
  ) => void
  transitionTradeKind: (id: string, target: TradeKind) => boolean
  addComment: (id: string, text: string) => void
  removeComment: (id: string, commentId: string) => void
  toggleStar: (id: string) => void
  toggleCaseFocus: (id: string) => void
  toggleSubscribe: (id: string) => void
  togglePinStrategy: (id: string) => void
  addTagPreset: (tag: string) => void
  removeTagPreset: (tag: string) => void
  addMistakeTagPreset: (tag: string) => void
  removeMistakeTagPreset: (tag: string) => void
  setDisplay: (patch: Partial<DisplayPrefs>) => void
  replaceSidebarWorkspaceItems: (items: SidebarWorkspaceItem[]) => void
  addStrategy: (strategy: Strategy) => void
  updateStrategy: (id: string, patch: Partial<Omit<Strategy, 'id'>>) => void
  removeStrategy: (id: string, reassignToId?: string) => void
  upsertTrade: (trade: Trade) => SetTradeStatusResult
  /** 单次 setState 批量 upsert，避免 N 次订阅/persist 风暴 */
  upsertTrades: (trades: Trade[]) => SetTradeStatusResult
  /** CSV／历史资料导入专用；调用方必须是明确的非交互恢复流程。 */
  upsertTradesFromNonInteractiveImport: (trades: Trade[]) => void
  removeTrade: (id: string) => void
  removeTrades: (ids: string[]) => void
  restoreTrade: (id: string) => void
  restoreTrades: (ids: string[]) => void
  purgeTrade: (id: string) => TradePurgeResult
  purgeTrades: (ids: string[]) => TradePurgeResult
  createReviewCaseFromTrade: (sourceId: string) => CreateReviewCaseResult
  openComposer: (trade?: Trade | null, kind?: TradeKind | null) => void
  closeComposer: () => void
  requestTradeClose: (
    tradeId: string,
    targetStatus?: Extract<TradeStatus, 'win' | 'loss' | 'breakeven'>,
  ) => void
  cancelTradeClose: () => void
  select: (id: string | null) => void
  getById: (id: string) => Trade | undefined
  getStrategy: (id: string) => Strategy | undefined
  isStarred: (id: string) => boolean
  isCaseFocused: (id: string) => boolean
  isSubscribed: (id: string) => boolean
  isPinnedStrategy: (id: string) => boolean
  importData: (payload: ExportPayload) => void
  upsertWeeklyReview: (review: WeeklyReview) => void
  updateWeeklyReview: (
    id: string,
    patch: Partial<Omit<
      WeeklyReview,
      | 'id'
      | 'liveStageId'
      | 'weekStart'
      | 'weekEnd'
      | 'createdAt'
      | 'updatedAt'
      | 'status'
      | 'metricsSnapshot'
      | 'evidenceSnapshot'
      | 'riskSnapshot'
      | 'completedAt'
    >>,
  ) => void
  completeWeeklyReview: (id: string) => void
  reopenWeeklyReview: (id: string) => void
  upsertQuickNote: (note: QuickNote) => void
  updateQuickNote: (id: string, patch: Partial<Pick<QuickNote, 'title' | 'titleMode' | 'contentHtml' | 'pinned'>>) => void
  removeQuickNote: (id: string) => void
}

export interface TradePurgeResult {
  purgedIds: string[]
  blockedIds: string[]
}

function frozenReviewEvidenceTradeIds(review: WeeklyReview): Set<string> {
  return new Set([
    ...(review.evidenceSnapshot?.trades.map((trade) => trade.id) ?? []),
    ...(review.evidenceSnapshot?.missedTrades.map((trade) => trade.id) ?? []),
    ...(review.riskSnapshot?.overrideEvents.map((event) => event.tradeId) ?? []),
  ])
}

function tradePurgeBlockers(
  state: Pick<State, 'trades' | 'weeklyReviews' | 'riskOverrideEvents'>,
  candidateIds: ReadonlySet<string>,
): Set<string> {
  const blocked = new Set<string>()
  for (const trade of state.trades) {
    if (
      trade.tradeKind === 'case' &&
      typeof trade.liveStageId !== 'string' &&
      typeof trade.sourceTradeId === 'string' &&
      candidateIds.has(trade.sourceTradeId)
    ) blocked.add(trade.sourceTradeId)
  }
  for (const event of state.riskOverrideEvents) {
    if (typeof event.liveStageId !== 'string' && candidateIds.has(event.tradeId)) {
      blocked.add(event.tradeId)
    }
  }
  for (const review of state.weeklyReviews) {
    const directIds = [
      ...review.highlightTradeIds,
      ...review.mistakeTradeIds,
      ...review.followUpTradeIds,
    ]
    const allReviewTradeIds = [
      ...directIds,
      ...(review.evidenceSnapshot?.trades.map((trade) => trade.id) ?? []),
      ...(review.evidenceSnapshot?.missedTrades.map((trade) => trade.id) ?? []),
      ...(review.riskSnapshot?.overrideEvents.map((event) => event.tradeId) ?? []),
    ]
    if (typeof review.liveStageId !== 'string') {
      for (const id of allReviewTradeIds) {
        if (candidateIds.has(id)) blocked.add(id)
      }
      continue
    }
    if (review.status !== 'completed') continue
    const frozenIds = frozenReviewEvidenceTradeIds(review)
    for (const id of directIds) {
      if (candidateIds.has(id) && !frozenIds.has(id)) blocked.add(id)
    }
  }
  return blocked
}

function scrubDraftReviewTradeReferences(
  reviews: readonly WeeklyReview[],
  purgedIds: ReadonlySet<string>,
): WeeklyReview[] {
  let changed = false
  const next = reviews.map((review) => {
    if (review.status === 'completed') return review
    const highlightTradeIds = review.highlightTradeIds.filter((id) => !purgedIds.has(id))
    const mistakeTradeIds = review.mistakeTradeIds.filter((id) => !purgedIds.has(id))
    const followUpTradeIds = review.followUpTradeIds.filter((id) => !purgedIds.has(id))
    if (
      highlightTradeIds.length === review.highlightTradeIds.length &&
      mistakeTradeIds.length === review.mistakeTradeIds.length &&
      followUpTradeIds.length === review.followUpTradeIds.length
    ) return review
    changed = true
    return { ...review, highlightTradeIds, mistakeTradeIds, followUpTradeIds }
  })
  return changed ? next : reviews as WeeklyReview[]
}

export function currentLiveStageIdForWrite(
  state: Pick<State, 'liveStages' | 'currentLiveStageId'>,
): string {
  return getCurrentLiveStage(state.liveStages, state.currentLiveStageId).id
}

function withCurrentStage(state: State, trade: Trade): Trade {
  if (trade.tradeKind === 'paper') return withoutLiveStageForPaper(trade)
  return { ...trade, liveStageId: currentLiveStageIdForWrite(state) }
}

function stageOwnedTradeForUpsert(state: State, trade: Trade): Trade {
  const previous = state.trades.find((candidate) => candidate.id === trade.id)
  if (!previous) return withCurrentStage(state, trade)
  if (trade.tradeKind === 'paper') return withCurrentStage(state, trade)
  if (previous.tradeKind === 'paper') return trade
  return { ...trade, liveStageId: previous.liveStageId }
}

const initialStageTimestamp = new Date().toISOString()
const initialStage = createInitialLiveStage(
  getTradingDayKey(new Date(), DEFAULT_TRADING_DAY_START_HOUR),
  initialStageTimestamp,
  'live-stage-initial',
)

export const useStore = create<State>()((set, get) => ({
      trades: [],
      liveStages: [initialStage],
      currentLiveStageId: initialStage.id,
      scheduledStageRollover: null,
      weeklyReviews: [],
      weeklyRiskPreparations: [],
      riskPolicyVersions: [],
      monthlyRiskLimits: [],
      riskOverrideEvents: [],
      quickNotes: [],
      strategies: [],
      selectedId: null,
      composerOpen: false,
      composerTrade: null,
      composerKind: null,
      closeTradeRequest: null,
      pendingTradeOpenRequest: null,
      riskSetupTradeOpenRequest: null,
      undoStack: [],
      redoStack: [],
      undo: (actionId) => {
        let succeeded = false
        set((s) => {
          const index = actionId
            ? s.undoStack.findIndex((action) => action.actionId === actionId)
            : s.undoStack.length - 1
          if (index < 0) return s
          const action = s.undoStack[index]!
          const applied = applyUndoAction(s.trades, action, 'undo')
          if (!applied.ok) return s
          succeeded = true
          return {
            trades: applied.trades,
            undoStack: s.undoStack.filter((_item, itemIndex) => itemIndex !== index),
            redoStack: appendBoundedHistory(s.redoStack, action),
          }
        })
        return succeeded
      },
      redo: (actionId) => {
        let succeeded = false
        set((s) => {
          const index = actionId
            ? s.redoStack.findIndex((action) => action.actionId === actionId)
            : s.redoStack.length - 1
          if (index < 0) return s
          const action = s.redoStack[index]!
          const applied = applyUndoAction(s.trades, action, 'redo')
          if (!applied.ok) return s
          succeeded = true
          return {
            trades: applied.trades,
            redoStack: s.redoStack.filter((_item, itemIndex) => itemIndex !== index),
            undoStack: appendBoundedHistory(s.undoStack, action),
          }
        })
        return succeeded
      },
      cleanupCopiedCloseDates: async (tradeIds, dependencies) => {
        let cleanupAction: UndoAction | null = null
        let cleanupActionId: string | undefined
        let cleanupBefore: Trade[] = []
        const [healthModule, persistModule, shortcutModule] = await Promise.all([
          import('@/lib/importDataHealth'),
          import('@/storage/persist'),
          import('@/store/shortcutStore'),
        ])
        let resolvedDependencies = dependencies
        if (!resolvedDependencies) {
          const [cutoverModule, storageModule] = await Promise.all([
            import('@/storage/cutover'),
            import('@/storage'),
          ])
          resolvedDependencies = {
            persistSnapshot: (snapshot) => storageModule.getStorage().commitImport(snapshot, []),
            boundary: {
              lockInteraction: cutoverModule.lockStorageCutoverInteraction,
              flushBeforeCommit: cutoverModule.flushStorageBeforeCutover,
              createVerifiedBackup: async () => {
                const bridge = storageModule.getJournalBridge()
                if (!bridge) throw new Error('历史日期清理只能在 Windows 或 macOS 客户端执行')
                const backupName = await bridge.createBackup()
                if (!backupName) throw new Error('无法创建清理前备份')
                const verification = await bridge.verifyBackup(backupName)
                if (verification.status !== 'verified') {
                  throw new Error(verification.error ?? '清理前备份验证失败')
                }
              },
              suspendPersist: persistModule.suspendPersist,
              resumePersist: persistModule.resumePersist,
              discardPendingAndResumePersist: persistModule.discardPendingAndResumePersist,
              recoverDurableSnapshot: (snapshot) => {
                if (!cleanupAction) throw new Error('耐久清理缺少可撤销 action')
                recoverCopiedCloseDateCleanupToStore(snapshot, cleanupAction)
              },
            },
          }
        }
        const result = await healthModule.commitCopiedCloseDateCleanupThroughBoundary({
          cleanup: {
            tradeIds,
            tradingDayStartHour: get().display.tradingDayStartHour,
            captureLatest: () => {
              const state = get()
              const selectedIds = new Set(tradeIds)
              cleanupBefore = state.trades.filter((trade) => selectedIds.has(trade.id))
              return {
                trades: state.trades,
                snapshot: persistModule.pickPersisted(
                  state,
                  shortcutModule.useShortcutStore.getState().bindings,
                ),
              }
            },
            persistSnapshot: async (snapshot) => {
              const selectedIds = new Set(tradeIds)
              const after = snapshot.trades.filter((trade) => selectedIds.has(trade.id))
              cleanupAction = createStoreUndoAction('清空污染平仓日', cleanupBefore, after)
              if (!cleanupAction) throw new Error('清理候选没有产生可撤销字段变化')
              cleanupActionId = cleanupAction.actionId
              await resolvedDependencies.persistSnapshot(snapshot)
            },
            publish: (trades) => {
              const action = cleanupAction
              if (!action) throw new Error('清理候选缺少已提交的可撤销 action')
              set((state) => ({
                trades,
                undoStack: appendBoundedHistory(state.undoStack, action),
                redoStack: [],
              }))
            },
          },
          boundary: resolvedDependencies.boundary,
        })
        return result.kind === 'committed'
          ? { ...result, actionId: cleanupActionId }
          : result
      },
      undoCopiedCloseDateCleanup: async (actionId, dependencies) => {
        const action = get().undoStack.find((candidate) =>
          candidate.actionId === actionId && candidate.label === '清空污染平仓日',
        )
        if (!action) return { kind: 'stale-action' }
        const [healthModule, persistModule, shortcutModule] = await Promise.all([
          import('@/lib/importDataHealth'),
          import('@/storage/persist'),
          import('@/store/shortcutStore'),
        ])
        let resolvedDependencies = dependencies
        if (!resolvedDependencies) {
          const [cutoverModule, storageModule] = await Promise.all([
            import('@/storage/cutover'),
            import('@/storage'),
          ])
          resolvedDependencies = {
            persistSnapshot: (snapshot) => storageModule.getStorage().commitImport(snapshot, []),
            boundary: {
              lockInteraction: cutoverModule.lockStorageCutoverInteraction,
              flushBeforeCommit: cutoverModule.flushStorageBeforeCutover,
              createVerifiedBackup: async () => {
                const bridge = storageModule.getJournalBridge()
                if (!bridge) throw new Error('历史日期撤销只能在 Windows 或 macOS 客户端执行')
                const backupName = await bridge.createBackup()
                if (!backupName) throw new Error('无法创建撤销前备份')
                const verification = await bridge.verifyBackup(backupName)
                if (verification.status !== 'verified') {
                  throw new Error(verification.error ?? '撤销前备份验证失败')
                }
              },
              suspendPersist: persistModule.suspendPersist,
              resumePersist: persistModule.resumePersist,
              discardPendingAndResumePersist: persistModule.discardPendingAndResumePersist,
              recoverDurableSnapshot: (snapshot) => recoverCopiedCloseDateUndoToStore(snapshot, action),
            },
          }
        }
        return healthModule.commitCopiedCloseDateUndoThroughBoundary({
          undo: {
            action,
            captureLatest: () => {
              const state = get()
              return {
                trades: state.trades,
                snapshot: persistModule.pickPersisted(
                  state,
                  shortcutModule.useShortcutStore.getState().bindings,
                ),
              }
            },
            persistSnapshot: resolvedDependencies.persistSnapshot,
            publish: (trades) => set((state) => ({
              trades,
              undoStack: state.undoStack.filter((candidate) => candidate.actionId !== actionId),
              redoStack: appendBoundedHistory(state.redoStack, action),
            })),
          },
          boundary: resolvedDependencies.boundary,
        })
      },
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      tagPresets: [],
      mistakeTagPresets: [],
      display: DEFAULT_DISPLAY,
      profile: {
        avatarId: null,
        displayName: DEFAULT_USER_DISPLAY_NAME,
        legacyCashCurrencyAssumption: null,
      },
      savedTradeViews: [],
      symbolIcons: {},
      symbolCatalog: [...DEFAULT_SYMBOL_CATALOG],
      reviewTemplates: createDefaultReviewTemplates(),
      reviewPoolPresets: [],
      reviewPoolLayout: normalizeReviewPoolLayout(DEFAULT_REVIEW_POOL_LAYOUT, []),
      saveReviewPoolPreset: (preset) => set((state) => {
        const reviewPoolPresets = [
          ...state.reviewPoolPresets.filter((item) => item.id !== preset.id),
          preset,
        ]
        return {
          reviewPoolPresets,
          reviewPoolLayout: normalizeReviewPoolLayout(
            state.reviewPoolLayout,
            reviewPoolPresets.map((item) => item.id),
          ),
        }
      }),
      removeReviewPoolPreset: (id) => set((state) => {
        const reviewPoolPresets = state.reviewPoolPresets.filter((item) => item.id !== id)
        return {
          reviewPoolPresets,
          reviewPoolLayout: normalizeReviewPoolLayout(
            state.reviewPoolLayout,
            reviewPoolPresets.map((item) => item.id),
          ),
        }
      }),
      setReviewPoolLayout: (layout) => set((state) => ({
        reviewPoolLayout: normalizeReviewPoolLayout(
          layout,
          state.reviewPoolPresets.map((item) => item.id),
        ),
      })),
      scheduleLiveStageRollover: (currentTradingDayKey, now) => set((state) => ({
        scheduledStageRollover: state.scheduledStageRollover ?? scheduleStageRollover(
          currentTradingDayKey,
          now,
          crypto.randomUUID(),
        ),
      })),
      cancelLiveStageRollover: () => set({ scheduledStageRollover: null }),
      renameLiveStage: (id, name) => {
        const normalizedName = name.trim()
        if (!normalizedName) return false
        const normalizedKey = normalizeLiveStageName(normalizedName)
        let renamed = false
        set((state) => {
          const target = state.liveStages.find((stage) => stage.id === id)
          if (
            !target ||
            target.name === normalizedName ||
            state.liveStages.some((stage) =>
              stage.id !== id && normalizeLiveStageName(stage.name) === normalizedKey,
            )
          ) return state
          const liveStages = state.liveStages.map((stage) =>
            stage.id === id ? { ...stage, name: normalizedName } : stage,
          )
          assertValidLiveStageState({ liveStages, currentLiveStageId: state.currentLiveStageId })
          renamed = true
          return { liveStages }
        })
        return renamed
      },
      publishPostponedRollover: (scheduled) => set({ scheduledStageRollover: scheduled }),
      publishCommittedStageRollover: (publish) => set({
        liveStages: publish.liveStages,
        currentLiveStageId: publish.currentLiveStageId,
        scheduledStageRollover: publish.scheduledStageRollover,
        pendingTradeOpenRequest: null,
        riskSetupTradeOpenRequest: null,
      }),
      assignPendingStageOwnership: (request) => {
        let rollbackRequest: RollbackAssignedStageOwnershipRequest & AssignPendingStageOwnershipRequest = {
          ...request,
          assignedLiveStageId: request.liveStageId,
        }
        set((state) => {
          if (request.entityType === 'weekly-review') {
            const review = state.weeklyReviews.find((candidate) => candidate.id === request.entityId)
            if (review) {
              rollbackRequest = {
                ...rollbackRequest,
                weeklyReviewPrevious: {
                  weekStart: review.weekStart,
                  weekEnd: review.weekEnd,
                  assignedWeekStart: request.correctedWeeklyPeriod?.weekStart ?? review.weekStart,
                  assignedWeekEnd: request.correctedWeeklyPeriod?.weekEnd ?? review.weekEnd,
                  ...(review.legacyPeriodQuarantine === true ? { legacyPeriodQuarantine: true as const } : {}),
                  pendingPolicyVersionIds: review.riskSnapshot?.policyVersions
                    .filter((policy) => policy.liveStageId === null)
                    .map((policy) => policy.id) ?? [],
                  pendingOverrideEventIds: review.riskSnapshot?.overrideEvents
                    .filter((event) => event.liveStageId === null)
                    .map((event) => event.id) ?? [],
                },
              }
            }
          }
          return applyPendingStageOwnership(state, request)
        })
        return rollbackRequest
      },
      rollbackAssignedStageOwnership: (request) => {
        set((state) => applyOwnershipRollback(state, request))
        return { ...request }
      },
      upsertWeeklyReview: (review) =>
        set((state) => {
          const currentLiveStageId = currentLiveStageIdForWrite(state)
          const existing = state.weeklyReviews.find((item) =>
            item.id === review.id || (
              item.liveStageId === currentLiveStageId &&
              item.weekStart === review.weekStart
            ),
          )
          const currentStage = state.liveStages.find((stage) => stage.id === currentLiveStageId)!
          const periodOwner = stageContainsWeeklyReviewPeriod(currentStage, review.weekStart, review.weekEnd)
            ? currentStage
            : [...state.liveStages]
                .filter((stage) => stageContainsWeeklyReviewPeriod(stage, review.weekStart, review.weekEnd))
                .sort((left, right) => right.sequence - left.sequence)[0]
          // 新建历史周复盘必须归入真正覆盖该周的阶段。跨阶段周没有合法
          // 单一归属时保持 null，进入显式待整理队列，绝不能生成无法落盘的快照。
          const ownedCandidate = existing
            ? { ...review, liveStageId: existing.liveStageId }
            : { ...review, liveStageId: periodOwner?.id ?? null }
          const owned = existing?.status === 'completed'
            ? {
                ...ownedCandidate,
                id: existing.id,
                liveStageId: existing.liveStageId,
                weekStart: existing.weekStart,
                weekEnd: existing.weekEnd,
                status: existing.status,
                metricsSnapshot: existing.metricsSnapshot,
                evidenceSnapshot: existing.evidenceSnapshot,
                riskSnapshot: existing.riskSnapshot,
                createdAt: existing.createdAt,
                completedAt: existing.completedAt,
              }
            : ownedCandidate
          return {
            weeklyReviews: normalizeWeeklyReviews([
              ...state.weeklyReviews.filter((item) =>
                item.id !== review.id && !(
                  item.liveStageId === owned.liveStageId &&
                  item.weekStart === owned.weekStart
                ),
              ),
              owned,
            ]),
          }
        }),
      updateWeeklyReview: (id, patch) =>
        set((state) => {
          const {
            id: _id,
            liveStageId: _liveStageId,
            weekStart: _weekStart,
            weekEnd: _weekEnd,
            createdAt: _createdAt,
            updatedAt: _updatedAt,
            status: _status,
            metricsSnapshot: _metricsSnapshot,
            evidenceSnapshot: _evidenceSnapshot,
            riskSnapshot: _riskSnapshot,
            completedAt: _completedAt,
            ...mutablePatch
          } = patch as Partial<WeeklyReview>
          return {
            weeklyReviews: normalizeWeeklyReviews(state.weeklyReviews.map((review) =>
              review.id === id
                ? { ...review, ...mutablePatch, updatedAt: new Date().toISOString() }
                : review,
            )),
          }
        }),
      completeWeeklyReview: (id) =>
        set((state) => ({
          weeklyReviews: completeWeeklyReviewCandidate(state, id).weeklyReviews,
        })),
      reopenWeeklyReview: (id) =>
        set((state) => ({
          weeklyReviews: normalizeWeeklyReviews(state.weeklyReviews.map((review) =>
            review.id === id ? reopenCompletedReview(review) : review,
          )),
        })),
      saveTradeView: (view) =>
        set((s) => ({
          savedTradeViews: normalizeSavedTradeViews([
            ...s.savedTradeViews.filter((item) => item.id !== view.id),
            view,
          ]),
        })),
      renameTradeView: (id, name) => {
        const trimmed = name.trim().slice(0, 24)
        if (!trimmed) return
        set((s) => ({
          savedTradeViews: s.savedTradeViews.map((view) =>
            view.id === id
              ? { ...view, name: trimmed, updatedAt: new Date().toISOString() }
              : view,
          ),
        }))
      },
      removeTradeView: (id) =>
        set((s) => ({
          savedTradeViews: s.savedTradeViews.filter((view) => view.id !== id),
          display: {
            ...s.display,
            sidebarWorkspaceItems: normalizeSidebarWorkspaceItems(
              s.display.sidebarWorkspaceItems.filter((item) => (
                item.target.kind !== 'saved-view' || item.target.viewId !== id
              )),
            ),
          },
        })),
      togglePinTradeView: (id) =>
        set((s) => {
          const target = s.savedTradeViews.find((view) => view.id === id)
          if (!target) return s
          const pinnedCount = s.savedTradeViews.filter((view) => view.pinned).length
          if (!target.pinned && pinnedCount >= 4) return s
          return {
            savedTradeViews: s.savedTradeViews.map((view) =>
              view.id === id
                ? { ...view, pinned: !view.pinned, updatedAt: new Date().toISOString() }
                : view,
            ),
          }
        }),
      setSymbolIconPreset: (symbol, presetId) => {
        const key = normalizeSymbol(symbol)
        if (!key) return
        set((s) => {
          const catalog = s.symbolCatalog.includes(key)
            ? s.symbolCatalog
            : normalizeSymbolCatalog([...s.symbolCatalog, key])
          if (!presetId) {
            const next = { ...s.symbolIcons }
            const current = next[key]
            if (!current?.customDataUrl) {
              delete next[key]
              return { symbolIcons: next, symbolCatalog: catalog }
            }
            next[key] = {
              ...current,
              presetId: null,
              updatedAt: new Date().toISOString(),
            }
            return { symbolIcons: next, symbolCatalog: catalog }
          }
          return {
            symbolCatalog: catalog,
            symbolIcons: {
              ...s.symbolIcons,
              [key]: {
                presetId,
                customDataUrl: null,
                updatedAt: new Date().toISOString(),
              },
            },
          }
        })
      },
      setSymbolIconCustom: (symbol, dataUrl) => {
        const key = normalizeSymbol(symbol)
        if (!key) return
        set((s) => {
          const catalog = s.symbolCatalog.includes(key)
            ? s.symbolCatalog
            : normalizeSymbolCatalog([...s.symbolCatalog, key])
          if (!dataUrl) {
            const next = { ...s.symbolIcons }
            const current = next[key]
            if (!current?.presetId) {
              delete next[key]
              return { symbolIcons: next, symbolCatalog: catalog }
            }
            next[key] = {
              ...current,
              customDataUrl: null,
              updatedAt: new Date().toISOString(),
            }
            return { symbolIcons: next, symbolCatalog: catalog }
          }
          return {
            symbolCatalog: catalog,
            symbolIcons: {
              ...s.symbolIcons,
              [key]: {
                presetId: null,
                customDataUrl: dataUrl,
                updatedAt: new Date().toISOString(),
              },
            },
          }
        })
      },
      clearSymbolIcon: (symbol) => {
        const key = normalizeSymbol(symbol)
        if (!key) return
        set((s) => {
          if (!(key in s.symbolIcons)) return s
          const next = { ...s.symbolIcons }
          delete next[key]
          return { symbolIcons: next }
        })
      },
      addSymbolToCatalog: (symbol) => {
        const key = normalizeSymbol(symbol)
        if (!key) return
        set((s) => {
          if (s.symbolCatalog.includes(key)) return s
          return { symbolCatalog: normalizeSymbolCatalog([...s.symbolCatalog, key]) }
        })
      },
      removeSymbolFromCatalog: (symbol) => {
        const key = normalizeSymbol(symbol)
        if (!key) return
        set((s) => ({
          symbolCatalog: s.symbolCatalog.filter((item) => item !== key),
        }))
      },
      setSymbolCatalogOrder: (symbols) =>
        set({ symbolCatalog: normalizeSymbolCatalog(symbols) }),
      addReviewTemplate: () => {
        const template = createReviewTemplate()
        set((s) => ({ reviewTemplates: [...s.reviewTemplates, template] }))
        return template.id
      },
      updateReviewTemplate: (id, patch) =>
        set((s) => ({
          reviewTemplates: normalizeReviewTemplates(s.reviewTemplates.map((template) =>
            template.id === id
              ? {
                  ...template,
                  ...patch,
                  name: patch.name === undefined
                    ? template.name
                    : patch.name.trim()
                      ? patch.name.slice(0, 40)
                      : template.name,
                }
              : template,
          )),
        })),
      upsertQuickNote: (note) =>
        set((state) => ({
          quickNotes: normalizeQuickNotes([
            ...state.quickNotes.filter((item) => item.id !== note.id),
            note,
          ]),
        })),
      updateQuickNote: (id, patch) =>
        set((state) => ({
          quickNotes: normalizeQuickNotes(state.quickNotes.map((note) =>
            note.id === id
              ? { ...note, ...patch, updatedAt: new Date().toISOString() }
              : note,
          )),
        })),
      removeQuickNote: (id) =>
        set((state) => ({ quickNotes: state.quickNotes.filter((note) => note.id !== id) })),
      removeReviewTemplate: (id) =>
        set((s) => ({ reviewTemplates: s.reviewTemplates.filter((template) => template.id !== id) })),
      reorderReviewTemplates: (sourceId, targetId) =>
        set((s) => ({
          reviewTemplates: reorderByKey(
            s.reviewTemplates,
            sourceId,
            targetId,
            (template) => template.id,
          ),
        })),
      setAvatar: (avatarId) =>
        set((s) => ({
          profile: { ...s.profile, avatarId, customAvatarDataUrl: null },
        })),
      setCustomAvatar: (dataUrl) =>
        set((s) => ({
          profile: { ...s.profile, customAvatarDataUrl: dataUrl, avatarId: null },
        })),
      setDisplayName: (displayName) =>
        set((s) => ({
          profile: {
            ...s.profile,
            displayName: displayName.trim() || DEFAULT_USER_DISPLAY_NAME,
          },
        })),
      hydrateProfile: (profile) =>
        set((s) => ({
          profile: profile
            ? {
                avatarId: profile.avatarId ?? null,
                displayName: profile.displayName || DEFAULT_USER_DISPLAY_NAME,
                customAvatarDataUrl: profile.customAvatarDataUrl ?? null,
                legacyCashCurrencyAssumption: profile.legacyCashCurrencyAssumption
                  ? { ...profile.legacyCashCurrencyAssumption }
                  : null,
              }
            : s.profile,
        })),
      saveWeeklyRiskDraft: (weekStart, draft, updatedAt) =>
        set((s) => {
          const currentLiveStageId = currentLiveStageIdForWrite(s)
          const id = `weekly-risk-preparation:${currentLiveStageId}:${weekStart}`
          const existing = s.weeklyRiskPreparations.find((item) =>
            item.liveStageId === currentLiveStageId && item.weekStart === weekStart,
          )
          const contentChanged = existing ? !sameRiskPolicyDraft(existing.draft, draft) : false
          const preparation: WeeklyRiskPreparation = {
            id,
            liveStageId: currentLiveStageId,
            weekStart,
            draft: { ...draft },
            reviewedAt: contentChanged ? null : existing?.reviewedAt ?? null,
            confirmedPolicyVersionId: contentChanged
              ? null
              : existing?.confirmedPolicyVersionId ?? null,
            createdAt: existing?.createdAt ?? updatedAt,
            updatedAt,
          }
          return {
            weeklyRiskPreparations: existing
              ? s.weeklyRiskPreparations.map((item) => item === existing ? preparation : item)
              : [...s.weeklyRiskPreparations, preparation],
          }
        }),
      confirmWeeklyRiskPreparation: (input) =>
        set((s) => {
          const currentLiveStageId = currentLiveStageIdForWrite(s)
          const riskState: RiskPolicyState = {
            currentLiveStageId,
            weeklyRiskPreparations: s.weeklyRiskPreparations,
            riskPolicyVersions: s.riskPolicyVersions,
            monthlyRiskLimits: s.monthlyRiskLimits,
            riskOverrideEvents: s.riskOverrideEvents,
          }
          const hasClosedLiveTradeOnDay = s.trades.some((trade) =>
            trade.tradeKind === 'live' &&
            trade.liveStageId === currentLiveStageId &&
            !trade.deletedAt &&
            isExecutedClosed(trade.status) &&
            (trade.closedTradingDayKey ?? closedTradingDayKeyFromClosedAt(
              trade.closedAt,
              s.display.tradingDayStartHour,
            )) === input.currentTradingDayKey,
          )
          const confirmed = confirmRiskPolicyState(riskState, {
            ...input,
            hasClosedLiveTradeOnDay,
          })
          return {
            ...ensureRiskPolicyPeriodRecords(confirmed, input.currentTradingDayKey),
            riskSetupTradeOpenRequest: null,
          }
        }),
      saveRiskBaseline: (input) =>
        set((s) => {
          const currentLiveStageId = currentLiveStageIdForWrite(s)
          const confirmed = confirmRiskPolicyBaseline({
            currentLiveStageId,
            weeklyRiskPreparations: s.weeklyRiskPreparations,
            riskPolicyVersions: s.riskPolicyVersions,
            monthlyRiskLimits: s.monthlyRiskLimits,
            riskOverrideEvents: s.riskOverrideEvents,
          }, { ...input, hasClosedLiveTradeOnDay: false })
          return {
            ...ensureRiskPolicyPeriodRecords(confirmed, input.currentTradingDayKey),
            riskSetupTradeOpenRequest: null,
          }
        }),
      ensureRiskPeriodRecords: (tradingDay) =>
        set((s) => ensureRiskPolicyPeriodRecords({
          currentLiveStageId: currentLiveStageIdForWrite(s),
          weeklyRiskPreparations: s.weeklyRiskPreparations,
          riskPolicyVersions: s.riskPolicyVersions,
          monthlyRiskLimits: s.monthlyRiskLimits,
          riskOverrideEvents: s.riskOverrideEvents,
        }, tradingDay)),
      setStatus: (id, status) => {
        const current = get().trades.find((trade) => trade.id === id)
        if (!current) return 'not-found'
        if (current.status === status) return 'unchanged'
        if (
          status === 'open' &&
          current.tradeKind === 'live' &&
          current.liveStageId !== get().currentLiveStageId
        ) return 'not-current-stage'
        if (
          status === 'open' &&
          current.tradeKind === 'live' &&
          requiresFirstOpenGate(current)
        ) {
          return 'requires-risk-gate'
        }
        let updatedStatus = false
        set((s) => {
          const previous = s.trades.find((t) => t.id === id)
          if (!previous || previous.status === status) return s
          const closed = isTerminal(status)
          const updated = appendActivity(reopenReviewAfterResultChange(previous, {
            ...previous,
            status,
            closedAt: closed
              ? previous.closedAt ?? getTradingDayKey(new Date(), s.display.tradingDayStartHour)
              : null,
            closedTradingDayKey: isExecutedClosed(status)
              ? previous.closedTradingDayKey ?? closedTradingDayKeyFromClosedAt(
                  previous.closedAt ?? getTradingDayKey(new Date(), s.display.tradingDayStartHour),
                  s.display.tradingDayStartHour,
                ) ?? undefined
              : undefined,
            missReason: status === 'missed' ? previous.missReason : undefined,
          }), {
            kind: 'status',
            status,
            timestamp: new Date().toISOString(),
          })
          const action = createStoreUndoAction('更新交易状态', [previous], [updated])
          if (!action) return s
          updatedStatus = true
          return {
            undoStack: appendBoundedHistory(s.undoStack, action),
            redoStack: [],
            trades: s.trades.map((trade) => (trade.id === id ? updated : trade)),
          }
        })
        return updatedStatus ? 'updated' : 'unchanged'
      },
      requestTradeOpen: (id, returnFocus) => {
        let result: TradeOpenRequestResult = 'not-found'
        set((s) => {
          const currentStage = getCurrentLiveStage(s.liveStages, s.currentLiveStageId)
          const candidate = requestTradeOpenCandidate({
            ...s,
            currentLiveStageId: currentStage.id,
            currentLiveStageStartsOn: currentStage.startsOn,
            currentTradingDayKey: getTradingDayKey(new Date(), s.display.tradingDayStartHour),
            tradingDayStartHour: s.display.tradingDayStartHour,
          }, id, { existingPending: s.pendingTradeOpenRequest })
          if (candidate.kind === 'not-found') return s
          if (candidate.kind === 'not-current-stage') {
            const active = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
            result = 'not-current-stage'
            return {
              riskSetupTradeOpenRequest: {
                tradeId: candidate.trade.id,
                returnFocus: returnFocus ?? active,
                reason: 'not-current-stage',
              },
              pendingTradeOpenRequest: null,
            }
          }
          if (candidate.kind === 'risk-setup-required') {
            const active = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
            result = 'requires-risk-setup'
            return {
              riskSetupTradeOpenRequest: {
                tradeId: candidate.trade.id,
                returnFocus: returnFocus ?? active,
                reason: 'risk-setup',
              },
              pendingTradeOpenRequest: null,
            }
          }
          if (candidate.kind === 'pending-exists') {
            result = 'pending-confirmation'
            return s
          }
          if (candidate.kind === 'confirmation-required') {
            const active = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null
            result = 'pending-confirmation'
            return {
              pendingTradeOpenRequest: {
                ...candidate.request,
                returnFocus: returnFocus ?? active,
              },
            }
          }
          result = 'opened'
          if (candidate.state === s) return s
          return { trades: candidate.state.trades }
        })
        return result
      },
      cancelTradeOpen: () => set({ pendingTradeOpenRequest: null, riskSetupTradeOpenRequest: null }),
      confirmTradeOpen: async (rawReason) => {
        const reason = rawReason.trim()
        if (reason.length > 500) {
          throw new Error('继续开仓原因最多 500 字')
        }
        const request = get().pendingTradeOpenRequest
        if (!request) return { kind: 'cancelled', reason: 'target-missing' }
        const [commitModule, persistModule, shortcutModule] = await Promise.all([
          import('@/lib/riskGatedTradeOpenCommit'),
          import('@/storage/persist'),
          import('@/store/shortcutStore'),
        ])
        const result = await commitModule.commitRiskGatedTradeOpen({
          request,
          reason,
          captureLatestState: () => {
            const state = get()
            return {
              state,
              snapshot: persistModule.pickPersisted(
                state,
                shortcutModule.useShortcutStore.getState().bindings,
              ),
              currentTradingDayKey: getTradingDayKey(
                new Date(),
                state.display.tradingDayStartHour,
              ),
            }
          },
          publish: (state) => set({ ...state, pendingTradeOpenRequest: null }),
        })
        if (result.kind === 'cancelled') {
          set({ pendingTradeOpenRequest: null })
        } else if (result.kind === 'needs-reconfirmation') {
          set({ pendingTradeOpenRequest: null })
          get().requestTradeOpen(request.tradeId, request.returnFocus)
        }
        return result
      },
      rehydrateRiskGateFromStorage: async () => {
        const { getStorage } = await import('@/storage/provider')
        const snapshot = await getStorage().loadSnapshot()
        if (!snapshot) throw new Error('存储中没有可恢复的风险开仓快照')
        assertValidLiveStageState(snapshot)
        set({
          trades: snapshot.trades,
          liveStages: snapshot.liveStages,
          currentLiveStageId: snapshot.currentLiveStageId,
          scheduledStageRollover: snapshot.scheduledStageRollover,
          weeklyRiskPreparations: snapshot.weeklyRiskPreparations,
          riskPolicyVersions: snapshot.riskPolicyVersions,
          monthlyRiskLimits: snapshot.monthlyRiskLimits,
          riskOverrideEvents: snapshot.riskOverrideEvents,
          pendingTradeOpenRequest: null,
          riskSetupTradeOpenRequest: null,
        })
      },
      completeTradeClose: (id, status, patch) =>
        set((s) => {
          const previous = s.trades.find((trade) => trade.id === id)
          if (!previous) return s
          const updated = {
            ...previous,
            ...patch,
            status,
            closedAt: patch.closedAt ?? previous.closedAt ?? getTradingDayKey(new Date(), s.display.tradingDayStartHour),
            closedTradingDayKey:
              Object.prototype.hasOwnProperty.call(patch, 'closedAt') || previous.closedTradingDayKey === undefined
                ? closedTradingDayKeyFromClosedAt(
                    patch.closedAt ?? previous.closedAt ?? getTradingDayKey(new Date(), s.display.tradingDayStartHour),
                    s.display.tradingDayStartHour,
                  ) ?? undefined
                : previous.closedTradingDayKey,
          }
          const reconciled = reopenReviewAfterResultChange(previous, updated)
          const withActivity = previous.status === status
            ? reconciled
            : appendActivity(reconciled, {
                kind: 'status',
                status,
                timestamp: new Date().toISOString(),
              })
          const action = createStoreUndoAction('完成交易平仓', [previous], [withActivity])
          if (!action) return { closeTradeRequest: null }
          return {
            undoStack: appendBoundedHistory(s.undoStack, action),
            redoStack: [],
            closeTradeRequest: null,
            trades: s.trades.map((trade) => (trade.id === id ? withActivity : trade)),
          }
        }),
      setConviction: (id, conviction) =>
        set((s) => ({
          trades: s.trades.map((t) => (t.id === id ? { ...t, conviction } : t)),
        })),
      setSide: (id, side) =>
        set((s) => ({
          trades: s.trades.map((t) => {
            if (t.id !== id || t.side === side) return t
            return reopenReviewAfterResultChange(
              t,
              reconcileExistingExecutionEdit(t, { ...t, side }),
            )
          }),
        })),
      setStrategy: (id, strategyId) =>
        set((s) => ({
          trades: s.trades.map((t) => (t.id === id ? { ...t, strategyId } : t)),
        })),
      setTags: (id, tags) =>
        set((s) => {
          const nextTags = [...new Set(tags.map((x) => x.trim()).filter(Boolean))]
          return {
            trades: s.trades.map((t) =>
              t.id === id ? { ...t, tags: nextTags } : t,
            ),
          }
        }),
      addTag: (id, tag) => {
        const trimmed = tag.trim()
        if (!trimmed) return
        set((s) => ({
          trades: s.trades.map((t) =>
            t.id === id && !t.tags.includes(trimmed) ? { ...t, tags: [...t.tags, trimmed] } : t,
          ),
        }))
      },
      removeTag: (id, tag) => {
        set((s) => ({
          trades: s.trades.map((t) =>
            t.id === id ? { ...t, tags: t.tags.filter((x) => x !== tag) } : t,
          ),
        }))
      },
      updateNote: (id, note) =>
        set((s) => {
          const source = s.trades.find((trade) => trade.id === id)
          if (!source) return s
          const updatedSource = updateOwnedNoteActivity(source, note)
          const withUpdatedSource = updatedSource === source
            ? s.trades
            : s.trades.map((trade) => trade.id === id ? updatedSource : trade)
          return withUpdatedSource === s.trades ? s : { trades: withUpdatedSource }
        }),
      updateTradeData: (id, patch) =>
        set((s) => {
          if ('tradeKind' in patch) return s
          const tradeIndex = s.trades.findIndex((trade) => trade.id === id)
          const previous = s.trades[tradeIndex]
          if (!previous) return s
          const reviewPatch = patch.reviewStatus === undefined
            ? {}
            : isReviewCompleted(patch.reviewStatus)
              ? {
                  reviewedAt: isReviewCompleted(previous.reviewStatus)
                    ? previous.reviewedAt ?? new Date().toISOString()
                    : new Date().toISOString(),
                }
              : { reviewedAt: null }
          const regularUpdated = reopenReviewAfterResultChange(previous, {
            ...previous,
            ...patch,
            ...reviewPatch,
            ...('closedAt' in patch
              ? {
                  closedTradingDayKey: closedTradingDayKeyFromClosedAt(
                    patch.closedAt ?? null,
                    s.display.tradingDayStartHour,
                  ) ?? undefined,
                }
              : {}),
          })
          let updated = regularUpdated
          if (
            previous.tradeKind === 'case' &&
            containsCaseClassificationMutation(patch as Record<string, unknown>)
          ) {
            const classified = applyCaseClassificationMutation({
              ...regularUpdated,
              reviewCategory: previous.reviewCategory,
              reviewStatus: previous.reviewStatus,
            }, patch)
            updated = previous.reviewCategory === 'focus' || previous.reviewStatus === 'focus'
              ? { ...classified.trade, isFocusCase: true }
              : classified.trade
          }
          const action = createStoreUndoAction('更新交易字段', [previous], [updated])
          if (!action) return s
          const trades = s.trades.slice()
          trades[tradeIndex] = updated
          return {
            undoStack: appendBoundedHistory(s.undoStack, action),
            redoStack: [],
            trades,
          }
        }),
      transitionTradeKind: (id, target) => {
        let changed = false
        set((s) => {
          const previous = s.trades.find((trade) => trade.id === id)
          if (!previous) return s
          const result = applyTradeKindTransition(previous, target)
          if (!result.ok || !result.changed) return s
          const transitioned = withCurrentStage(s, result.trade)
          const updated = appendActivity(transitioned, {
            kind: 'tradeKind',
            fromTradeKind: previous.tradeKind,
            toTradeKind: target,
            timestamp: new Date().toISOString(),
          })
          const action = createStoreUndoAction('切换交易类型', [previous], [updated])
          if (!action) return s
          changed = true
          return {
            undoStack: appendBoundedHistory(s.undoStack, action),
            redoStack: [],
            trades: s.trades.map((trade) => (trade.id === id ? updated : trade)),
          }
        })
        return changed
      },
      addComment: (id, text) => {
        const trimmed = text.trim()
        if (!trimmed) return
        const commentId = String(Date.now())
        const createdAt = new Date().toISOString()
        const comment: TradeComment = {
          id: commentId,
          text: trimmed,
          createdAt,
        }
        set((s) => ({
          trades: s.trades.map((t) => {
            if (t.id !== id) return t
            const updated = { ...t, comments: [...(t.comments ?? []), comment] }
            return appendActivity(updated, {
              id: commentId,
              kind: 'comment',
              commentId,
              text: trimmed,
              timestamp: createdAt,
            })
          }),
        }))
      },
      removeComment: (id, commentId) =>
        set((s) => ({
          trades: s.trades.map((t) =>
            t.id === id
              ? {
                  ...t,
                  comments: (t.comments ?? []).filter((c) => c.id !== commentId),
                  activities: (t.activities ?? []).filter(
                    (a) => !(a.kind === 'comment' && a.commentId === commentId),
                  ),
                }
              : t,
          ),
        })),
      toggleStar: (id) =>
        set((s) => {
          const trade = s.trades.find((item) => item.id === id)
          if (!trade || trade.tradeKind === 'case') return s
          return {
            starredIds: s.starredIds.includes(id)
              ? s.starredIds.filter((x) => x !== id)
              : [...s.starredIds, id],
          }
        }),
      toggleCaseFocus: (id) =>
        set((s) => ({
          trades: s.trades.map((trade) => trade.id === id && trade.tradeKind === 'case'
            ? { ...trade, isFocusCase: trade.isFocusCase !== true }
            : trade),
        })),
      toggleSubscribe: (id) =>
        set((s) => ({
          subscribedIds: s.subscribedIds.includes(id)
            ? s.subscribedIds.filter((x) => x !== id)
            : [...s.subscribedIds, id],
        })),
      togglePinStrategy: (id) =>
        set((s) => ({
          pinnedStrategyIds: s.pinnedStrategyIds.includes(id)
            ? s.pinnedStrategyIds.filter((x) => x !== id)
            : [...s.pinnedStrategyIds, id],
        })),
      addTagPreset: (tag) => {
        const t = tag.trim()
        if (!t) return
        set((s) => {
          if (s.tagPresets.includes(t)) return s
          return { tagPresets: mergeTagPresets(s.tagPresets, [t]) }
        })
      },
      removeTagPreset: (tag) =>
        set((s) => ({ tagPresets: s.tagPresets.filter((p) => p !== tag) })),
      addMistakeTagPreset: (tag) => {
        const t = tag.trim()
        if (!t) return
        set((s) => {
          if (s.mistakeTagPresets.includes(t)) return s
          return { mistakeTagPresets: mergeTagPresets(s.mistakeTagPresets, [t]) }
        })
      },
      removeMistakeTagPreset: (tag) =>
        set((s) => ({ mistakeTagPresets: s.mistakeTagPresets.filter((p) => p !== tag) })),
      setDisplay: (patch) =>
        set((s) => ({ display: normalizeDisplay({ ...s.display, ...patch }) })),
      replaceSidebarWorkspaceItems: (items) =>
        set((s) => ({
          display: {
            ...s.display,
            sidebarWorkspaceItems: normalizeSidebarWorkspaceItems(items),
          },
        })),
      addStrategy: (strategy) =>
        set((s) => {
          if (s.strategies.some((x) => x.id === strategy.id || x.name === strategy.name)) {
            return s
          }
          return { strategies: [...s.strategies, strategy] }
        }),
      updateStrategy: (id, patch) =>
        set((s) => ({
          strategies: s.strategies.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),
      removeStrategy: (id, reassignToId) =>
        set((s) => {
          if (s.strategies.length <= 1) return s
          const count = s.trades.filter((t) => t.strategyId === id).length
          if (count > 0 && !reassignToId) return s
          return {
            strategies: s.strategies.filter((x) => x.id !== id),
            pinnedStrategyIds: s.pinnedStrategyIds.filter((x) => x !== id),
            display: {
              ...s.display,
              sidebarWorkspaceItems: normalizeSidebarWorkspaceItems(
                s.display.sidebarWorkspaceItems.filter((item) => (
                  item.target.kind !== 'strategy' || item.target.strategyId !== id
                )),
              ),
            },
            trades:
              count > 0 && reassignToId
                ? s.trades.map((t) =>
                    t.strategyId === id ? { ...t, strategyId: reassignToId } : t,
                  )
                : s.trades,
          }
        }),
      upsertTrade: (trade) => {
        const existing = get().trades.find((item) => item.id === trade.id)
        if (openTargetsAnotherLiveStage(existing, trade, get().currentLiveStageId)) return 'not-current-stage'
        if (upsertRequiresOpenGate(get(), existing, trade)) return 'requires-risk-gate'
        set((s) => upsertTradeIntoSlice(
          s,
          stageOwnedTradeForUpsert(s, trade),
          s.display.tradingDayStartHour,
        ))
        return 'updated'
      },
      createReviewCaseFromTrade: (sourceId) => {
        let result: CreateReviewCaseResult = { status: 'missing-source' }
        set((state) => {
          const source = state.trades.find((trade) => trade.id === sourceId)
          if (!source) return state
          if (source.tradeKind === 'case') {
            result = { status: 'source-is-case' }
            return state
          }
          const reviewCase = buildReviewCaseFromTrade(source, {
            id: crypto.randomUUID(),
            ref: getNextReviewCaseRef(state.trades),
            now: new Date(),
            tradingDayStartHour: state.display.tradingDayStartHour,
          })
          const sourceStageId = source.tradeKind === 'paper'
            ? currentLiveStageIdForWrite(state)
            : source.liveStageId === undefined
              ? currentLiveStageIdForWrite(state)
              : source.liveStageId
          const ownedReviewCase = { ...reviewCase, liveStageId: sourceStageId } as Trade
          result = { status: 'created', reviewCase: ownedReviewCase }
          return upsertTradeIntoSlice(state, ownedReviewCase, state.display.tradingDayStartHour)
        })
        return result
      },
      upsertTrades: (trades) => {
        const currentState = get()
        const currentTrades = currentState.trades
        if (trades.some((trade) => openTargetsAnotherLiveStage(
          currentTrades.find((item) => item.id === trade.id),
          trade,
          currentState.currentLiveStageId,
        ))) return 'not-current-stage'
        if (trades.some((trade) => upsertRequiresOpenGate(
          currentState,
          currentTrades.find((item) => item.id === trade.id),
          trade,
        ))) return 'requires-risk-gate'
        if (trades.length === 0) return 'unchanged'
        set((s) => applyTradeUpsertsToSlice({
            trades: s.trades,
            strategies: s.strategies,
            symbolCatalog: s.symbolCatalog,
            tagPresets: s.tagPresets,
            mistakeTagPresets: s.mistakeTagPresets,
          },
          trades.map((trade) => stageOwnedTradeForUpsert(s, trade)),
          s.display.tradingDayStartHour,
          currentLiveStageIdForWrite(s),
        ))
        return 'updated'
      },
      upsertTradesFromNonInteractiveImport: (trades) =>
        set((s) => {
          if (trades.length === 0) return s
          return applyTradeUpsertsToSlice({
            trades: s.trades,
            strategies: s.strategies,
            symbolCatalog: s.symbolCatalog,
            tagPresets: s.tagPresets,
            mistakeTagPresets: s.mistakeTagPresets,
          },
          trades.map((trade) => stageOwnedTradeForUpsert(s, trade)),
          s.display.tradingDayStartHour,
          currentLiveStageIdForWrite(s),
        )
        }),
      removeTrade: (id) => get().removeTrades([id]),
      removeTrades: (ids) =>
        set((s) => {
          if (ids.length === 0) return s
          const idSet = new Set(ids)
          const deletedAt = new Date().toISOString()
          const before: Trade[] = []
          const after: Trade[] = []
          const trades = s.trades.map((trade) => {
            if (!idSet.has(trade.id) || trade.deletedAt) return trade
            const updated = { ...trade, deletedAt }
            before.push(trade)
            after.push(updated)
            return updated
          })
          const action = createStoreUndoAction('批量移入回收站', before, after)
          if (!action) return s
          return {
            undoStack: appendBoundedHistory(s.undoStack, action),
            redoStack: [],
            trades,
          }
        }),
      restoreTrade: (id) => get().restoreTrades([id]),
      restoreTrades: (ids) =>
        set((s) => {
          if (ids.length === 0) return s
          const idSet = new Set(ids)
          let changed = false
          const trades = s.trades.map((trade) => {
            if (!idSet.has(trade.id) || !trade.deletedAt) return trade
            changed = true
            return { ...trade, deletedAt: undefined }
          })
          return changed ? { trades } : s
        }),
      purgeTrade: (id) => get().purgeTrades([id]),
      purgeTrades: (ids) => {
        if (ids.length === 0) return { purgedIds: [], blockedIds: [] }
        const state = get()
        const existingIds = new Set(
          state.trades.filter((trade) => ids.includes(trade.id)).map((trade) => trade.id),
        )
        const blocked = tradePurgeBlockers(state, existingIds)
        const purgedIds = [...existingIds].filter((id) => !blocked.has(id))
        const blockedIds = [...existingIds].filter((id) => blocked.has(id))
        if (purgedIds.length === 0) return { purgedIds, blockedIds }
        const purged = new Set(purgedIds)
        set((s) => ({
          trades: s.trades.filter((trade) => !purged.has(trade.id)),
          weeklyReviews: scrubDraftReviewTradeReferences(s.weeklyReviews, purged),
          starredIds: s.starredIds.filter((id) => !purged.has(id)),
          subscribedIds: s.subscribedIds.filter((id) => !purged.has(id)),
        }))
        return { purgedIds, blockedIds }
      },
      openComposer: (trade = null, kind = null) => {
        // 防御：若被直接绑到 onClick，会收到 MouseEvent，不能当 Trade 用
        const safe =
          trade &&
          typeof trade === 'object' &&
          'id' in trade &&
          typeof (trade as Trade).id === 'string'
            ? (trade as Trade)
            : null
        set({
          composerOpen: true,
          composerTrade: safe,
          composerKind: safe?.tradeKind ?? kind,
        })
      },
      closeComposer: () => set({ composerOpen: false, composerTrade: null, composerKind: null }),
      requestTradeClose: (tradeId, targetStatus) => {
        const active =
          typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null
        // Menu 弹出层经 portal 挂到 body，需用 data-menu-id 回查 trigger
        const menuId =
          active?.closest<HTMLElement>('[data-menu-id]')?.dataset.menuId ?? null
        const menuRoot = menuId
          ? document.querySelector<HTMLElement>(`.menu-root[data-menu-id="${CSS.escape(menuId)}"]`)
          : active?.closest<HTMLElement>('.menu-root')
        const menuTrigger = menuRoot?.querySelector<HTMLElement>('.menu-trigger button')
        set({
          closeTradeRequest: {
            tradeId,
            targetStatus,
            returnFocus: menuTrigger ?? active,
          },
        })
      },
      cancelTradeClose: () => set({ closeTradeRequest: null }),
      select: (id) => set({ selectedId: id }),
      getById: (id) => get().trades.find((t) => t.id === id),
      getStrategy: (id) => get().strategies.find((s) => s.id === id),
      isStarred: (id) => get().starredIds.includes(id),
      isCaseFocused: (id) => get().trades.some((trade) => (
        trade.id === id && trade.tradeKind === 'case' && trade.isFocusCase === true
      )),
      isSubscribed: (id) => get().subscribedIds.includes(id),
      isPinnedStrategy: (id) => get().pinnedStrategyIds.includes(id),
      importData: (payload) => set((s) => mergeImportPayload(s, payload)),
    }))
