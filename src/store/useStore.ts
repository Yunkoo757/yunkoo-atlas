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

interface State {
  trades: Trade[]
  strategies: Strategy[]
  selectedId: string | null
  composerOpen: boolean
  composerTrade: Trade | null
  starredIds: string[]
  subscribedIds: string[]
  pinnedStrategyIds: string[]
  display: DisplayPrefs
  tagPresets: string[]
  mistakeTagPresets: string[]
  profile: UserProfile
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
  addStrategy: (strategy: Strategy) => void
  updateStrategy: (id: string, patch: Partial<Omit<Strategy, 'id'>>) => void
  removeStrategy: (id: string, reassignToId?: string) => void
  upsertTrade: (trade: Trade) => void
  removeTrade: (id: string) => void
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
      starredIds: [],
      subscribedIds: [],
      pinnedStrategyIds: [],
      tagPresets: [],
      mistakeTagPresets: [],
      display: DEFAULT_DISPLAY,
      profile: { avatarId: null, displayName: 'Yunkoo' },
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
          trades: s.trades.map((t) => {
            if (t.id !== id || t.strategyId === strategyId) return t
            const updated = { ...t, strategyId }
            return appendActivity(updated, {
              kind: 'strategy',
              strategyId,
              fromStrategyId: t.strategyId,
              timestamp: new Date().toISOString(),
            })
          }),
        })),
      setTags: (id, tags) =>
        set((s) => ({
          trades: s.trades.map((t) =>
            t.id === id ? { ...t, tags: [...new Set(tags.map((x) => x.trim()).filter(Boolean))] } : t,
          ),
        })),
      addTag: (id, tag) => {
        const trimmed = tag.trim()
        if (!trimmed) return
        set((s) => ({
          trades: s.trades.map((t) => {
            if (t.id !== id || t.tags.includes(trimmed)) return t
            const updated = { ...t, tags: [...t.tags, trimmed] }
            return appendActivity(updated, {
              kind: 'tag',
              tag: trimmed,
              tagAction: 'add',
              timestamp: new Date().toISOString(),
            })
          }),
        }))
      },
      removeTag: (id, tag) => {
        set((s) => ({
          trades: s.trades.map((t) => {
            if (t.id !== id || !t.tags.includes(tag)) return t
            const updated = { ...t, tags: t.tags.filter((x) => x !== tag) }
            return appendActivity(updated, {
              kind: 'tag',
              tag,
              tagAction: 'remove',
              timestamp: new Date().toISOString(),
            })
          }),
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
        set((s) => ({
          trades: s.trades.map((t) => {
            if (t.id !== id) return t
            const updated = { ...t, ...patch }
            if (patch.tradeKind && patch.tradeKind !== t.tradeKind) {
              return appendActivity(updated, {
                kind: 'tradeKind',
                timestamp: new Date().toISOString(),
                fromTradeKind: t.tradeKind,
                toTradeKind: patch.tradeKind,
              })
            }
            return updated
          }),
        })),
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
          return { tagPresets: [...s.tagPresets, t].sort((a, b) => a.localeCompare(b, 'zh-CN')) }
        })
      },
      removeTagPreset: (tag) =>
        set((s) => ({ tagPresets: s.tagPresets.filter((p) => p !== tag) })),
      addMistakeTagPreset: (tag) => {
        const t = tag.trim()
        if (!t) return
        set((s) => {
          if (s.mistakeTagPresets.includes(t)) return s
          return { mistakeTagPresets: [...s.mistakeTagPresets, t].sort((a, b) => a.localeCompare(b, 'zh-CN')) }
        })
      },
      removeMistakeTagPreset: (tag) =>
        set((s) => ({ mistakeTagPresets: s.mistakeTagPresets.filter((p) => p !== tag) })),
      setDisplay: (patch) =>
        set((s) => ({ display: normalizeDisplay({ ...s.display, ...patch }) })),
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
      upsertTrade: (trade) =>
        set((s) => {
          const exists = s.trades.some((t) => t.id === trade.id)
          const strategyId =
            trade.strategyId || s.strategies[0]?.id || 'uncategorized'
          let normalized: Trade = normalizeReviewFields({
            ...trade,
            strategyId,
            tradeKind: trade.tradeKind ?? 'live',
            comments: trade.comments ?? [],
            activities: trade.activities,
          })
          if (!exists) {
            const withCreate = createActivity(normalized)
            return { trades: [withCreate, ...s.trades] }
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
          }
        }),
      removeTrade: (id) =>
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
