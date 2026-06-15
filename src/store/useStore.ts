import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SEED_TRADES, type Trade, type TradeStatus, type Conviction } from '@/data/trades'

interface State {
  trades: Trade[]
  selectedId: string | null
  composerOpen: boolean
  composerTrade: Trade | null
  setStatus: (id: string, status: TradeStatus) => void
  setConviction: (id: string, conviction: Conviction) => void
  updateNote: (id: string, note: string) => void
  upsertTrade: (trade: Trade) => void
  removeTrade: (id: string) => void
  openComposer: (trade?: Trade | null) => void
  closeComposer: () => void
  select: (id: string | null) => void
  getById: (id: string) => Trade | undefined
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      trades: SEED_TRADES,
      selectedId: null,
      composerOpen: false,
      composerTrade: null,
      setStatus: (id, status) =>
        set((s) => ({
          trades: s.trades.map((t) => (t.id === id ? { ...t, status } : t)),
        })),
      setConviction: (id, conviction) =>
        set((s) => ({
          trades: s.trades.map((t) => (t.id === id ? { ...t, conviction } : t)),
        })),
      updateNote: (id, note) =>
        set((s) => ({
          trades: s.trades.map((t) => (t.id === id ? { ...t, note } : t)),
        })),
      upsertTrade: (trade) =>
        set((s) => {
          const exists = s.trades.some((t) => t.id === trade.id)
          return {
            trades: exists
              ? s.trades.map((t) => (t.id === trade.id ? trade : t))
              : [trade, ...s.trades],
          }
        }),
      removeTrade: (id) =>
        set((s) => ({ trades: s.trades.filter((t) => t.id !== id) })),
      openComposer: (trade = null) =>
        set({ composerOpen: true, composerTrade: trade }),
      closeComposer: () => set({ composerOpen: false, composerTrade: null }),
      select: (id) => set({ selectedId: id }),
      getById: (id) => get().trades.find((t) => t.id === id),
    }),
    {
      name: 'linear-journal',
      partialize: (s) => ({ trades: s.trades }),
    },
  ),
)
