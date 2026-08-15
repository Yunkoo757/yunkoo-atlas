import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { Dashboard } from '@/views/Dashboard'
import { LiveArchiveView } from '@/views/LiveArchiveView'

function LocationProbe() {
  const location = useLocation()
  return <output data-keyboard-route>{location.pathname}</output>
}

const archivedTrade: Trade = {
  id: 'keyboard-archive-trade', ref: 'TRD-KEYBOARD-ARCHIVE', symbol: 'BTCUSDT', side: 'long', status: 'win', conviction: 'medium', strategyId: 'keyboard', tradeKind: 'live', tags: [], mistakeTags: [], reviewStatus: 'reviewed', reviewCategory: 'normal', entry: 100, exit: 110, size: 1, pnl: 100, rMultiple: 1, resultSource: 'imported', openedAt: '2026-01-15', closedAt: '2026-01-15', closedTradingDayKey: '2026-01-15', note: '',
}

useStore.setState({
  trades: [archivedTrade],
  livePerformanceCycles: [
    { id: 'keyboard-archive', name: '实盘-2026-01-01', startTradingDayKey: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'keyboard-current', name: '实盘-2026-02-01', startTradingDayKey: '2026-02-01', createdAt: '2026-02-01T00:00:00.000Z' },
  ],
})

const root = document.getElementById('root')
if (!root) throw new Error('缺少键盘夹具挂载节点')
createRoot(root).render(
  <HashRouter>
    <Routes>
      <Route path="/dashboard" element={<><Dashboard /><LocationProbe /></>} />
      <Route path="/live-history" element={<><LiveArchiveView /><LocationProbe /></>} />
    </Routes>
  </HashRouter>,
)
