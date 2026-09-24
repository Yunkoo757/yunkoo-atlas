import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { useWorkbenchVisibleTrades } from './useWorkbenchVisibleTrades'

declare global { interface Window { __workbenchPreferenceIsolationTest: Promise<void> } }
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
async function settle() { await frame(); await frame() }

let latest: ReturnType<typeof useWorkbenchVisibleTrades>
let renders = 0
const visibleCount = () => latest.visible.length
function Harness() {
  const [tick, setTick] = useState(0)
  // A fresh, equivalent route filter must not cause another record pass either.
  latest = useWorkbenchVisibleTrades({ type: 'all', tradeKind: 'paper' })
  renders += 1
  return <button onClick={() => setTick(tick + 1)}>{latest.visible.length}</button>
}

async function run() {
  const original = useStore.getState()
  let dateReads = 0
  let recordReads = 0
  const trades: Trade[] = Array.from({ length: 5000 }, (_, i) => ({
    id: `isolation-${i}`, ref: `TRD-${i}`, symbol: 'EURUSD', strategyId: '', tags: [], mistakeTags: [],
    side: 'long', status: i % 2 ? 'open' : 'win', conviction: 'medium', reviewStatus: 'unreviewed',
    reviewCategory: 'normal', tradeKind: 'paper',
    get openedAt() { dateReads += 1; return `2026-09-${String(i % 28 + 1).padStart(2, '0')}` },
    get deletedAt() { recordReads += 1; return undefined },
    closedAt: null, entry: 1, exit: null, size: 1, pnl: null, rMultiple: null, note: '',
  }))
  useStore.setState({ trades, display: { ...original.display, hideClosed: false, sortBy: 'date', sortDirection: 'desc' } })
  const root = createRoot(document.getElementById('root')!)
  root.render(<MemoryRouter><Harness /></MemoryRouter>)
  try {
    await settle()
    await settle()
    assert(visibleCount() === 5000, 'initial records missing')
    const visible = latest.visible
    const initialRenders = renders
    dateReads = 0
    recordReads = 0
    for (const change of [
      { privacyMode: !original.display.privacyMode },
      { listRowDensity: 'comfortable' as const },
      { reviewContextPinned: !original.display.reviewContextPinned },
      { sidebarRiskScope: 'week' as const },
    ]) {
      useStore.setState({ display: { ...useStore.getState().display, ...change } })
      await settle()
    }
    assert(renders === initialRenders, `unrelated display preferences rerendered the workbench derivation: ${initialRenders} -> ${renders}, date reads ${dateReads}, record reads ${recordReads}`)
    assert(latest.visible === visible && dateReads === 0 && recordReads === 0, 'unrelated preferences rescanned or sorted records')
    document.querySelector('button')!.click()
    await settle()
    assert(latest.visible === visible && dateReads === 0 && recordReads === 0, 'equivalent filter object rescanned records')
    useStore.setState({ display: { ...useStore.getState().display, hideClosed: true } })
    await settle()
    assert(visibleCount() === 2500 && latest.visible.every((item) => item.status === 'open'), 'hideClosed must still update membership')
    useStore.setState({ display: { ...useStore.getState().display, sortDirection: 'asc' } })
    await settle()
    assert(latest.visible[0]!.openedAt <= latest.visible.at(-1)!.openedAt, 'sort direction must still update order')
  } finally {
    root.unmount()
    useStore.setState(original)
  }
}
window.__workbenchPreferenceIsolationTest = run()
