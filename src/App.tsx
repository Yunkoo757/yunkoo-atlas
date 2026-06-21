import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
  useParams,
} from 'react-router-dom'
import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { useStore } from './store/useStore'
import { useShortcutStore } from './store/shortcutStore'
import { bootstrapStorage } from './storage'
import { flushPersistNow, hasPendingChanges } from './storage/persist'
import { isElectron } from './storage/runtime'
import { WelcomeScreen } from './components/WelcomeScreen'
import { Sidebar } from './components/Sidebar'
import { CommandPalette } from './components/CommandPalette'
import { TradeComposer } from './components/TradeComposer'
import { ToastHost } from './components/Toast'
import { ImageLightbox } from './components/ImageLightbox'
import { ListView } from './views/ListView'
import { BoardView } from './views/BoardView'
import { Dashboard } from './views/Dashboard'
import { DetailView } from './views/DetailView'
import { SettingsLayout } from './views/settings/SettingsLayout'
import { ShortcutsPanel } from './views/settings/ShortcutsPanel'
import { StrategiesPanel } from './views/settings/StrategiesPanel'
import { DisplaySettingsPanel } from './views/settings/DisplaySettingsPanel'
import { DataSettingsPanel } from './views/settings/DataSettingsPanel'
import { ProfileSettingsPanel } from './views/settings/ProfileSettingsPanel'
import { TagPresetsPanel } from './views/settings/TagPresetsPanel'
import { StrategyHeader } from './components/StrategyHeader'
import { getStrategyName } from './lib/strategies'
import type { ListFilter } from './lib/tradeFilters'
import { PERIOD_LABELS, isValidPeriodSlug } from './lib/periods'
import { MISSED_PAGE_TITLE } from './lib/pageCopy'
import { tradeDetailPath } from './lib/tradeRoute'
import { useShortcutHost } from './shortcuts/ShortcutHost'
import './App.css'

function TradesPage({
  title,
  filter = { type: 'all' },
  listPath,
  header,
}: {
  title: string
  filter?: ListFilter
  listPath: string
  header?: ReactNode
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const boardPath = listPath === '/list' ? '/board' : `${listPath}/board`
  const view: 'list' | 'board' = pathname === boardPath ? 'board' : 'list'
  const setView = (v: 'list' | 'board') => navigate(v === 'board' ? boardPath : listPath)

  return view === 'list' ? (
    <ListView title={title} view={view} onView={setView} filter={filter} header={header} />
  ) : (
    <BoardView
      title={title}
      view={view}
      onView={setView}
      filter={filter}
      onOpen={(id) => {
        const t = useStore.getState().trades.find((x) => x.id === id)
        navigate(t ? tradeDetailPath(t) : `/trade/${id}`)
      }}
    />
  )
}

function StrategyPage() {
  const { id } = useParams()
  const strategies = useStore((s) => s.strategies)
  const strategyId = id ?? ''
  const listPath = `/strategy/${strategyId}`
  const title = getStrategyName(strategies, strategyId)
  return (
    <TradesPage
      title={title}
      filter={{ type: 'strategy', strategyId }}
      listPath={listPath}
      header={<StrategyHeader strategyId={strategyId} />}
    />
  )
}

function PeriodPage() {
  const { slug } = useParams()
  const period = slug && isValidPeriodSlug(slug) ? slug : 'today'
  const listPath = `/period/${period}`
  return (
    <TradesPage
      title={PERIOD_LABELS[period]}
      filter={{ type: 'period', period, tradeKind: 'live' }}
      listPath={listPath}
    />
  )
}

function SimPage() {
  return (
    <TradesPage
      title="模拟"
      filter={{ type: 'all', tradeKind: 'paper' }}
      listPath="/sim"
    />
  )
}

function Shell() {
  const [cmdkOpen, setCmdkOpen] = useState(false)
  const navigate = useNavigate()
  const setCmdkOpenStore = useShortcutStore((s) => s.setCmdkOpen)

  const toggleCmdk = useCallback(() => setCmdkOpen((o) => !o), [])

  useEffect(() => {
    setCmdkOpenStore(cmdkOpen)
  }, [cmdkOpen, setCmdkOpenStore])

  useShortcutHost({
    onToggleCmdk: toggleCmdk,
  })

  return (
    <div className="app-shell">
      <Sidebar onOpenSearch={() => setCmdkOpen(true)} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/list" replace />} />
          <Route
            path="/list"
            element={
              <TradesPage title="交易" filter={{ type: 'all', tradeKind: 'live' }} listPath="/list" />
            }
          />
          <Route
            path="/board"
            element={
              <TradesPage title="交易" filter={{ type: 'all', tradeKind: 'live' }} listPath="/list" />
            }
          />
          <Route
            path="/active"
            element={
              <TradesPage
                title="进行中"
                filter={{ type: 'active', tradeKind: 'live' }}
                listPath="/active"
              />
            }
          />
          <Route
            path="/active/board"
            element={
              <TradesPage
                title="进行中"
                filter={{ type: 'active', tradeKind: 'live' }}
                listPath="/active"
              />
            }
          />
          <Route path="/inbox" element={<Navigate to="/active" replace />} />
          <Route path="/inbox/board" element={<Navigate to="/active/board" replace />} />
          <Route path="/my-trades" element={<Navigate to="/list" replace />} />
          <Route path="/my-trades/board" element={<Navigate to="/board" replace />} />
          <Route
            path="/favorites"
            element={<TradesPage title="星标交易" filter={{ type: 'starred' }} listPath="/favorites" />}
          />
          <Route
            path="/favorites/board"
            element={<TradesPage title="星标交易" filter={{ type: 'starred' }} listPath="/favorites" />}
          />
          <Route
            path="/missed"
            element={
              <TradesPage title={MISSED_PAGE_TITLE} filter={{ type: 'missed' }} listPath="/missed" />
            }
          />
          <Route
            path="/missed/board"
            element={
              <TradesPage title={MISSED_PAGE_TITLE} filter={{ type: 'missed' }} listPath="/missed" />
            }
          />
          <Route path="/period/:slug" element={<PeriodPage />} />
          <Route path="/period/:slug/board" element={<PeriodPage />} />
          <Route path="/sim" element={<SimPage />} />
          <Route path="/sim/board" element={<SimPage />} />
          <Route path="/paper" element={<Navigate to="/sim" replace />} />
          <Route path="/paper/board" element={<Navigate to="/sim/board" replace />} />
          <Route path="/practice" element={<Navigate to="/sim" replace />} />
          <Route path="/practice/board" element={<Navigate to="/sim/board" replace />} />
          <Route path="/strategy/:id" element={<StrategyPage />} />
          <Route path="/strategy/:id/board" element={<StrategyPage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trade/:id" element={<DetailView />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ProfileSettingsPanel />} />
            <Route path="shortcuts" element={<ShortcutsPanel />} />
            <Route path="strategies" element={<StrategiesPanel />} />
            <Route path="tags" element={<TagPresetsPanel />} />
            <Route path="display" element={<DisplaySettingsPanel />} />
            <Route path="data" element={<DataSettingsPanel />} />
          </Route>
          <Route path="/strategies" element={<Navigate to="/settings/strategies" replace />} />
          <Route path="*" element={<Navigate to="/list" replace />} />
        </Routes>
      </main>
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
      />
      <TradeComposer />
      <ImageLightbox />
      <ToastHost />
    </div>
  )
}

export function App() {
  const [ready, setReady] = useState(false)
  const [needsWelcome, setNeedsWelcome] = useState(false)

  useEffect(() => {
    const init = async () => {
      // Electron: check if library needs initialization
      if (isElectron()) {
        try {
          const bridge = (window as any).journalBridge
          const status = await bridge.getLibraryStatus()
          if (!status.initialized) {
            setNeedsWelcome(true)
            setReady(true) // show UI (welcome screen) but don't bootstrap yet
            return
          }
        } catch (e) {
          console.error('Library status check failed', e)
        }
      }
      // Normal bootstrap
      await bootstrapStorage()
      setReady(true)
    }

    init().catch((e) => {
      console.error('Storage bootstrap failed', e)
      setReady(true)
    })
  }, [])

  const handleWelcomeReady = async () => {
    setNeedsWelcome(false)
    setReady(false)
    try {
      await bootstrapStorage()
    } catch (e) {
      console.error('Storage bootstrap failed after welcome', e)
    }
    setReady(true)
  }

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasPendingChanges()) {
        e.preventDefault()
        e.returnValue = ''
      }
      flushPersistNow().catch(() => {})
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushPersistNow().catch(() => {})
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Electron 主进程关闭前触发 flush
    if (isElectron()) {
      try {
        const bridge = (window as any).journalBridge
        if (bridge?.onBeforeClose) {
          bridge.onBeforeClose(() => {
            flushPersistNow().catch(() => {})
          })
        }
      } catch { /* bridge not available */ }
    }

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  if (needsWelcome) {
    return <WelcomeScreen onReady={handleWelcomeReady} />
  }

  if (!ready) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <span className="app-loading-spinner" aria-hidden />
        <span>加载本地库…</span>
      </div>
    )
  }

  const Router = isElectron() ? HashRouter : BrowserRouter
  return (
    <Router>
      <Shell />
    </Router>
  )
}
