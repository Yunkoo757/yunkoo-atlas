import { create } from 'zustand'
import {
  type Trade,
  type TradeStatus,
  type Conviction,
  type TradeSide,
  type TradeComment,
} from '@/data/trades'
import { type Strategy } from '@/data/strategies'
import {
  DEFAULT_DISPLAY,
  normalizeDisplay,
  type DisplayPrefs,
} from '@/lib/tradeFilters'
import { type UserProfile } from '@/storage/types'
import type { ExportPayload } from '@/lib/importExport'
import { mergeImportPayload } from '@/lib/importExport'
import { appendActivity, createActivity } from '@/lib/activities'
import { isTerminal } from '@/lib/tradeStatus'
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
import {
  normalizeSidebarWorkspaceItems,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'

type TradeUpsertSlice = {
  trades: Trade[]
  strategies: Strategy[]
  symbolCatalog: string[]
  tagPresets: string[]
  mistakeTagPresets: string[]
}

function upsertTradeIntoSlice(s: TradeUpsertSlice, trade: Trade): TradeUpsertSlice {
  const exists = s.trades.some((t) => t.id === trade.id)
  const strategyId = trade.strategyId || s.strategies[0]?.id || 'uncategorized'
  let normalized: Trade = promoteTradeNotionMeta(
    promoteTradeSession(
      normalizeReviewFields({
        ...trade,
        strategyId,
        tradeKind: trade.tradeKind ?? 'live',
        comments: trade.comments ?? [],
        activities: trade.activities,
      }),
    ),
  )
  const symbolKey = normalizeSymbol(normalized.symbol)
  const symbolCatalog =
    symbolKey && !s.symbolCatalog.includes(symbolKey)
      ? normalizeSymbolCatalog([...s.symbolCatalog, symbolKey])
      : s.symbolCatalog
  const tagPresets = mergeTagPresets(s.tagPresets, normalized.tags)
  const mistakeTagPresets = mergeTagPresets(s.mistakeTagPresets, normalized.mistakeTags)
  if (!exists) {
    const withCreate = createActivity(normalized)
    return {
      trades: [withCreate, ...s.trades],
      strategies: s.strategies,
      symbolCatalog,
      tagPresets,
      mistakeTagPresets,
    }
  }
  const prev = s.trades.find((t) => t.id === trade.id)
  if (prev && prev.status !== normalized.status) {
    normalized = appendActivity(normalized, {
      kind: 'status',
      status: normalized.status,
      timestamp: new Date().toISOString(),
    })
  }
  return {
    trades: s.trades.map((t) => (t.id === trade.id ? normalized : t)),
    strategies: s.strategies,
    symbolCatalog,
    tagPresets,
    mistakeTagPresets,
  }
}

interface State {
  trades: Trade[]
  strategies: Strategy[]
  selectedId: string | null
  composerOpen: boolean
  composerTrade: Trade | null
  undoStack: { id: string; prev: Trade }[][]
  redoStack: { id: string; prev: Trade }[][]
  pushUndo: (snapshots: { id: string; prev: Trade }[]) => void
  undo: () => void
  redo: () => void
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
  saveTradeView: (view: SavedTradeView) => void
  renameTradeView: (id: string, name: string) => void
  removeTradeView: (id: string) => void
  togglePinTradeView: (id: string) => void
  setSymbolIconPreset: (symbol: string, presetId: string | null) => void
  setSymbolIconCustom: (symbol: string, dataUrl: string | null) => void
  clearSymbolIcon: (symbol: string) => void
  addSymbolToCatalog: (symbol: string) => void
  removeSymbolFromCatalog: (symbol: string) => void
  setAvatar: (avatarId: string | null) => void
  setCustomAvatar: (dataUrl: string | null) => void
  setDisplayName: (name: string) => void
  hydrateProfile: (profile?: UserProfile) => void
  setStatus: (id: string, status: TradeStatus) => void
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
        | 'side'
        | 'openedAt'
        | 'closedAt'
        | 'stopLoss'
        | 'missReason'
        | 'tradeKind'
        | 'mistakeTags'
        | 'reviewStatus'
        | 'reviewCategory'
        | 'timeframe'
        | 'session'
        | 'psychology'
        | 'narrative'
      >
    >,
  ) => void
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
  restoreTrade: (id: string) => void
  purgeTrade: (id: string) => void
  openComposer: (trade?: Trade | null) => void
  closeComposer: () => void
  select: (id: string | null) => void
  getById: (id: string) => Trade | undefined
  getStrategy: (id: string) => Strategy | undefined
  isStarred: (id: string) => boolean
  isSubscribed: (id: string) => boolean
  isPinnedStrategy: (id: string) => boolean
  importData: (payload: ExportPayload) => void
}

export const useStore = create<State>()((set, get) => ({
      trades: [],
      strategies: [],
      selectedId: null,
      composerOpen: false,
      composerTrade: null,
      undoStack: [],
      redoStack: [],
      pushUndo: (snapshots) =>
        set((s) => ({
          undoStack: [...s.undoStack.slice(-49), snapshots],
          redoStack: [],
        })),
      undo: () =>
        set((s) => {
          if (s.undoStack.length === 0) return s
          const snapshots = s.undoStack[s.undoStack.length - 1]
          const redoSnaps = snapshots.map(({ id }) => ({
            id,
            prev: s.trades.find((t) => t.id === id) ?? snapshots.find((x) => x.id === id)!.prev,
          }))
          return {
            trades: s.trades.map((t) => {
              const snap = snapshots.find((x) => x.id === t.id)
              return snap ? snap.prev : t
            }),
            undoStack: s.undoStack.slice(0, -1),
            redoStack: [...s.redoStack, redoSnaps],
          }
        }),
      redo: () =>
        set((s) => {
          if (s.redoStack.length === 0) return s
          const snapshots = s.redoStack[s.redoStack.length - 1]
          const undoSnaps = snapshots.map(({ id }) => ({
            id,
            prev: s.trades.find((t) => t.id === id) ?? snapshots.find((x) => x.id === id)!.prev,
          }))
          return {
            trades: s.trades.map((t) => {
              const snap = snapshots.find((x) => x.id === t.id)
              return snap ? snap.prev : t
            }),
            redoStack: s.redoStack.slice(0, -1),
            undoStack: [...s.undoStack, undoSnaps],
          }
        }),
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      tagPresets: [],
      mistakeTagPresets: [],
      display: DEFAULT_DISPLAY,
      profile: { avatarId: null, displayName: 'Yunkoo' },
      savedTradeViews: [],
      symbolIcons: {},
      symbolCatalog: [...DEFAULT_SYMBOL_CATALOG],
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
      setAvatar: (avatarId) =>
        set((s) => ({
          profile: { ...s.profile, avatarId, customAvatarDataUrl: null },
        })),
      setCustomAvatar: (dataUrl) =>
        set((s) => ({
          profile: { ...s.profile, customAvatarDataUrl: dataUrl, avatarId: null },
        })),
      setDisplayName: (displayName) =>
        set((s) => ({ profile: { ...s.profile, displayName: displayName.trim() || 'Yunkoo' } })),
      hydrateProfile: (profile) =>
        set((s) => ({
          profile: profile
            ? {
                avatarId: profile.avatarId ?? null,
                displayName: profile.displayName || 'Yunkoo',
                customAvatarDataUrl: profile.customAvatarDataUrl ?? null,
              }
            : s.profile,
        })),
      setStatus: (id, status) =>
        set((s) => ({
          undoStack: s.undoStack.length < 50 ? [...s.undoStack, [{ id, prev: s.trades.find((t) => t.id === id)! }]] : s.undoStack,
          redoStack: [],
          trades: s.trades.map((t) => {
            if (t.id !== id) return t
            if (t.status === status) return t
            const closed = isTerminal(status)
            const updated = {
              ...t,
              status,
              closedAt: closed
                ? t.closedAt ?? new Date().toISOString().slice(0, 10)
                : null,
              missReason: status === 'missed' ? t.missReason : undefined,
            }
            return appendActivity(updated, {
              kind: 'status',
              status,
              timestamp: new Date().toISOString(),
            })
          }),
        })),
      setConviction: (id, conviction) =>
        set((s) => ({
          trades: s.trades.map((t) => (t.id === id ? { ...t, conviction } : t)),
        })),
      setSide: (id, side) =>
        set((s) => ({
          trades: s.trades.map((t) => (t.id === id ? { ...t, side } : t)),
        })),
      setStrategy: (id, strategyId) =>
        set((s) => ({
          trades: s.trades.map((t) => (t.id === id ? { ...t, strategyId } : t)),
        })),
      setTags: (id, tags) =>
        set((s) => {
          const nextTags = [...new Set(tags.map((x) => x.trim()).filter(Boolean))]
          return {
            tagPresets: mergeTagPresets(s.tagPresets, nextTags),
            trades: s.trades.map((t) =>
              t.id === id ? { ...t, tags: nextTags } : t,
            ),
          }
        }),
      addTag: (id, tag) => {
        const trimmed = tag.trim()
        if (!trimmed) return
        set((s) => ({
          tagPresets: mergeTagPresets(s.tagPresets, [trimmed]),
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
          const nextMistakePresets = patch.mistakeTags
            ? mergeTagPresets(s.mistakeTagPresets, patch.mistakeTags)
            : s.mistakeTagPresets
          return {
            undoStack: s.undoStack.length < 50 ? [...s.undoStack, [{ id, prev: s.trades.find((t) => t.id === id)! }]] : s.undoStack,
            redoStack: [],
            mistakeTagPresets: nextMistakePresets,
            trades: s.trades.map((t) => {
              if (t.id !== id) return t
              return { ...t, ...patch }
            }),
          }
        }),
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
          let slice: TradeUpsertSlice = {
            trades: s.trades,
            strategies: s.strategies,
            symbolCatalog: s.symbolCatalog,
            tagPresets: s.tagPresets,
            mistakeTagPresets: s.mistakeTagPresets,
          }
          for (const trade of trades) {
            slice = upsertTradeIntoSlice(slice, trade)
          }
          return slice
        }),
      removeTrade: (id) =>
        set((s) => ({
          undoStack: s.undoStack.length < 50 ? [...s.undoStack, [{ id, prev: s.trades.find((t) => t.id === id)! }]] : s.undoStack,
          redoStack: [],
          trades: s.trades.map((t) =>
            t.id === id ? { ...t, deletedAt: new Date().toISOString() } : t
          ),
        })),
      restoreTrade: (id) =>
        set((s) => ({
          trades: s.trades.map((t) =>
            t.id === id ? { ...t, deletedAt: undefined } : t
          ),
        })),
      purgeTrade: (id) =>
        set((s) => ({
          trades: s.trades.filter((t) => t.id !== id),
          starredIds: s.starredIds.filter((x) => x !== id),
          subscribedIds: s.subscribedIds.filter((x) => x !== id),
        })),
      openComposer: (trade = null) =>
        set({ composerOpen: true, composerTrade: trade }),
      closeComposer: () => set({ composerOpen: false, composerTrade: null }),
      select: (id) => set({ selectedId: id }),
      getById: (id) => get().trades.find((t) => t.id === id),
      getStrategy: (id) => get().strategies.find((s) => s.id === id),
      isStarred: (id) => get().starredIds.includes(id),
      isSubscribed: (id) => get().subscribedIds.includes(id),
      isPinnedStrategy: (id) => get().pinnedStrategyIds.includes(id),
      importData: (payload) => set((s) => mergeImportPayload(s, payload)),
    }))
