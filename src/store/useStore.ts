import { create } from 'zustand'
import {
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
import { type UserProfile } from '@/storage/types'
import type { ExportPayload } from '@/lib/importTypes'
import {
  createDefaultReviewTemplates,
  createReviewTemplate,
  normalizeReviewTemplates,
  type ReviewTemplate,
} from '@/data/reviewTemplates'
import { mergeImportPayload } from '@/lib/importMerge'
import { appendActivity, createActivity } from '@/lib/activities'
import { isExecutedClosed, isTerminal } from '@/lib/tradeStatus'
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
import { getTradingDayKey } from '@/lib/periods'
import type { TradeClosePatch } from '@/lib/tradeClose'
import {
  normalizeWeeklyReviews,
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
  applyUndoAction,
  buildUndoAction,
  type UndoAction,
} from '@/lib/tradeUndo'
import { transitionTradeKind as applyTradeKindTransition } from '@/lib/tradeKind'

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
  if (previous.reviewStatus !== 'reviewed') return next
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

function upsertTradeIntoSlice(s: TradeUpsertSlice, trade: Trade): TradeUpsertSlice {
  const previousTrade = s.trades.find((t) => t.id === trade.id)
  if (previousTrade && (trade.tradeKind ?? 'live') !== previousTrade.tradeKind) return s
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

/** 纯计算批量写入结果，供需要先落盘、再发布到 store 的原子导入流程复用。 */
export function applyTradeUpsertsToSlice(
  initial: TradeUpsertSlice,
  trades: Trade[],
): TradeUpsertSlice {
  let slice = initial
  for (const trade of trades) {
    slice = upsertTradeIntoSlice(slice, trade)
  }
  return slice
}

interface State {
  trades: Trade[]
  weeklyReviews: WeeklyReview[]
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
  undoStack: UndoAction[]
  redoStack: UndoAction[]
  undo: (actionId?: string) => boolean
  redo: (actionId?: string) => boolean
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
  setStatus: (id: string, status: TradeStatus) => void
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
      >
    >,
  ) => void
  transitionTradeKind: (id: string, target: TradeKind) => boolean
  addComment: (id: string, text: string) => void
  removeComment: (id: string, commentId: string) => void
  toggleStar: (id: string) => void
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
  upsertTrade: (trade: Trade) => void
  /** 单次 setState 批量 upsert，避免 N 次订阅/persist 风暴 */
  upsertTrades: (trades: Trade[]) => void
  removeTrade: (id: string) => void
  removeTrades: (ids: string[]) => void
  restoreTrade: (id: string) => void
  restoreTrades: (ids: string[]) => void
  purgeTrade: (id: string) => void
  purgeTrades: (ids: string[]) => void
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
  isSubscribed: (id: string) => boolean
  isPinnedStrategy: (id: string) => boolean
  importData: (payload: ExportPayload) => void
  upsertWeeklyReview: (review: WeeklyReview) => void
  updateWeeklyReview: (id: string, patch: Partial<Omit<WeeklyReview, 'id' | 'weekStart' | 'createdAt'>>) => void
  upsertQuickNote: (note: QuickNote) => void
  updateQuickNote: (id: string, patch: Partial<Pick<QuickNote, 'title' | 'contentHtml' | 'pinned'>>) => void
  removeQuickNote: (id: string) => void
}

export const useStore = create<State>()((set, get) => ({
      trades: [],
      weeklyReviews: [],
      quickNotes: [],
      strategies: [],
      selectedId: null,
      composerOpen: false,
      composerTrade: null,
      composerKind: null,
      closeTradeRequest: null,
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
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      tagPresets: [],
      mistakeTagPresets: [],
      display: DEFAULT_DISPLAY,
      profile: { avatarId: null, displayName: DEFAULT_USER_DISPLAY_NAME },
      savedTradeViews: [],
      symbolIcons: {},
      symbolCatalog: [...DEFAULT_SYMBOL_CATALOG],
      reviewTemplates: createDefaultReviewTemplates(),
      upsertWeeklyReview: (review) =>
        set((state) => ({
          weeklyReviews: normalizeWeeklyReviews([
            ...state.weeklyReviews.filter((item) => item.id !== review.id && item.weekStart !== review.weekStart),
            review,
          ]),
        })),
      updateWeeklyReview: (id, patch) =>
        set((state) => ({
          weeklyReviews: normalizeWeeklyReviews(state.weeklyReviews.map((review) =>
            review.id === id
              ? { ...review, ...patch, updatedAt: new Date().toISOString() }
              : review,
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
        set((s) => ({ savedTradeViews: s.savedTradeViews.filter((view) => view.id !== id) })),
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
              }
            : s.profile,
        })),
      setStatus: (id, status) =>
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
            missReason: status === 'missed' ? previous.missReason : undefined,
          }), {
            kind: 'status',
            status,
            timestamp: new Date().toISOString(),
          })
          const action = createStoreUndoAction('更新交易状态', [previous], [updated])
          if (!action) return s
          return {
            undoStack: appendBoundedHistory(s.undoStack, action),
            redoStack: [],
            trades: s.trades.map((trade) => (trade.id === id ? updated : trade)),
          }
        }),
      completeTradeClose: (id, status, patch) =>
        set((s) => {
          const previous = s.trades.find((trade) => trade.id === id)
          if (!previous) return s
          const updated = {
            ...previous,
            ...patch,
            status,
            closedAt: patch.closedAt ?? previous.closedAt ?? getTradingDayKey(new Date(), s.display.tradingDayStartHour),
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
        set((s) => ({
          trades: s.trades.map((t) => {
            if (t.id !== id || t.note === note) return t
            const now = new Date().toISOString()
            const activities = [...(t.activities ?? [])]
            const last = activities[activities.length - 1]
            if (last?.kind === 'note') {
              activities[activities.length - 1] = { ...last, timestamp: now }
              return { ...t, note, activities }
            }
            return appendActivity({ ...t, note }, {
              kind: 'note',
              timestamp: now,
            })
          }),
        })),
      updateTradeData: (id, patch) =>
        set((s) => {
          if ('tradeKind' in patch) return s
          const previous = s.trades.find((t) => t.id === id)
          if (!previous) return s
          const reviewPatch = patch.reviewStatus === undefined
            ? {}
            : patch.reviewStatus === 'reviewed'
              ? {
                  reviewedAt: previous.reviewStatus === 'reviewed'
                    ? previous.reviewedAt ?? new Date().toISOString()
                    : new Date().toISOString(),
                }
              : { reviewedAt: null }
          const updated = reopenReviewAfterResultChange(previous, {
            ...previous,
            ...patch,
            ...reviewPatch,
          })
          const action = createStoreUndoAction('更新交易字段', [previous], [updated])
          if (!action) return s
          return {
            undoStack: appendBoundedHistory(s.undoStack, action),
            redoStack: [],
            trades: s.trades.map((trade) => (trade.id === id ? updated : trade)),
          }
        }),
      transitionTradeKind: (id, target) => {
        let changed = false
        set((s) => {
          const previous = s.trades.find((trade) => trade.id === id)
          if (!previous) return s
          const result = applyTradeKindTransition(previous, target)
          if (!result.ok || !result.changed) return s
          const updated = appendActivity(result.trade, {
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
        set((s) => ({
          starredIds: s.starredIds.includes(id)
            ? s.starredIds.filter((x) => x !== id)
            : [...s.starredIds, id],
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
            trades:
              count > 0 && reassignToId
                ? s.trades.map((t) =>
                    t.strategyId === id ? { ...t, strategyId: reassignToId } : t,
                  )
                : s.trades,
          }
        }),
      upsertTrade: (trade) => set((s) => upsertTradeIntoSlice(s, trade)),
      upsertTrades: (trades) =>
        set((s) => {
          if (trades.length === 0) return s
          return applyTradeUpsertsToSlice({
            trades: s.trades,
            strategies: s.strategies,
            symbolCatalog: s.symbolCatalog,
            tagPresets: s.tagPresets,
            mistakeTagPresets: s.mistakeTagPresets,
          }, trades)
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
      purgeTrades: (ids) =>
        set((s) => {
          if (ids.length === 0) return s
          const idSet = new Set(ids)
          if (!s.trades.some((trade) => idSet.has(trade.id))) return s
          return {
            trades: s.trades.filter((trade) => !idSet.has(trade.id)),
            starredIds: s.starredIds.filter((id) => !idSet.has(id)),
            subscribedIds: s.subscribedIds.filter((id) => !idSet.has(id)),
          }
        }),
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
      isSubscribed: (id) => get().subscribedIds.includes(id),
      isPinnedStrategy: (id) => get().pinnedStrategyIds.includes(id),
      importData: (payload) => set((s) => mergeImportPayload(s, payload)),
    }))
