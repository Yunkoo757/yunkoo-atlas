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
import { AppFrame } from './components/ui/AppFrame'
import { CommandPalette } from './components/CommandPalette'
import { TradeComposer } from './components/TradeComposer'
import { ToastHost } from './components/Toast'
import { ImageLightbox } from './components/ImageLightbox'
import { ListView } from './views/ListView'
import { BoardView } from './views/BoardView'
import { TableView } from './views/TableView'
import { Dashboard } from './views/Dashboard'
import { DetailView } from './views/DetailView'
import { SettingsLayout } from './views/settings/SettingsLayout'
import { ShortcutsPanel } from './views/settings/ShortcutsPanel'
import { StrategiesPanel } from './views/settings/StrategiesPanel'
import { DisplaySettingsPanel } from './views/settings/DisplaySettingsPanel'
import { DataSettingsPanel } from './views/settings/DataSettingsPanel'
import { ProfileSettingsPanel } from './views/settings/ProfileSettingsPanel'
import { TagPresetsPanel } from './views/settings/TagPresetsPanel'
import { SymbolsPanel } from './views/settings/SymbolsPanel'
import { TradeTrashView } from './views/TradeTrashView'
import { StrategyHeader } from './components/StrategyHeader'
import type { WorkbenchView } from './components/Topbar'
import { getStrategyName } from './lib/strategies'
import type { ListFilter, ReviewCaseScope } from './lib/tradeFilters'
import { isValidPeriodSlug } from './lib/periods'
import { tradeDetailPath, tradeDetailNavState } from './lib/tradeRoute'
import { routeWithSearch } from './lib/tradeView'
import { workbenchModeFromPathname } from './lib/routeContext'
import { useShortcutHost } from './shortcuts/ShortcutHost'
import { cleanExpiredTradeTrash } from './lib/trashCleanup'
import { rememberTradeReturnAnchor } from './hooks/useTradeReturnAnchor'
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
  const { pathname, search } = useLocation()
  const boardPath = listPath === '/list' ? '/board' : `${listPath}/board`
  const tablePath = listPath === '/list' ? '/table' : `${listPath}/table`
  const view: WorkbenchView = workbenchModeFromPathname(pathname)
  const setView = (v: WorkbenchView) => {
    const target = v === 'board' ? boardPath : v === 'table' ? tablePath : listPath
    navigate(routeWithSearch(target, search))
  }
  return view === 'list' ? (
    <ListView title={title} view={view} onView={setView} filter={filter} header={header} />
  ) : view === 'table' ? (
    <TableView title={title} view={view} onView={setView} filter={filter} header={header} />
  ) : (
    <BoardView
      title={title}
      view={view}
      onView={setView}
      filter={filter}
      header={header}
      onOpen={(id) => {
        const t = useStore.getState().trades.find((x) => x.id === id)
        const from = { pathname, search, anchorTradeId: t?.id ?? id }
        rememberTradeReturnAnchor(from)
        navigate(t ? tradeDetailPath(t) : `/trade/${id}`, {
          state: tradeDetailNavState(from),
        })
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
      title="交易日志"
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

function TodayRecordPage() {
  return (
    <TradesPage
      title="今日记录"
      filter={{ type: 'period', period: 'today', tradeKind: 'live' }}
      listPath="/today-record"
    />
  )
}

function ReviewCasesPage() {
  const { scope: rawScope } = useParams()
  const scope = normalizeReviewCaseScope(rawScope)
  const listPath = scope === 'all' ? '/review-cases' : `/review-cases/${scope}`
  return (
    <TradesPage
      title="案例记录"
      filter={{ type: 'all', tradeKind: 'case', reviewCaseScope: scope }}
      listPath={listPath}
    />
  )
}

function normalizeReviewCaseScope(scope: string | undefined): ReviewCaseScope {
  if (scope === 'focus' || scope === 'mistakes' || scope === 'unreviewed' || scope === 'reviewed') {
    return scope
  }
  return 'all'
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
    <>
      <AppFrame sidebar={<Sidebar onOpenSearch={() => setCmdkOpen(true)} />}>
        <Routes>
          <Route path="/" element={<Navigate to="/list" replace />} />
          <Route
            path="/list"
            element={
              <TradesPage title="交易日志" filter={{ type: 'all', tradeKind: 'live' }} listPath="/list" />
            }
          />
          <Route
            path="/board"
            element={
              <TradesPage title="交易日志" filter={{ type: 'all', tradeKind: 'live' }} listPath="/list" />
            }
          />
          <Route
            path="/table"
            element={
              <TradesPage title="交易日志" filter={{ type: 'all', tradeKind: 'live' }} listPath="/list" />
            }
          />
          <Route
            path="/active"
            element={
              <TradesPage
                title="交易日志"
                filter={{ type: 'active', tradeKind: 'live' }}
                listPath="/active"
              />
            }
          />
          <Route
            path="/active/board"
            element={
              <TradesPage
                title="交易日志"
                filter={{ type: 'active', tradeKind: 'live' }}
                listPath="/active"
              />
            }
          />
          <Route
            path="/active/table"
            element={
              <TradesPage
                title="交易日志"
                filter={{ type: 'active', tradeKind: 'live' }}
                listPath="/active"
              />
            }
          />
          <Route path="/inbox" element={<Navigate to="/active" replace />} />
          <Route path="/inbox/board" element={<Navigate to="/active/board" replace />} />
          <Route path="/inbox/table" element={<Navigate to="/active/table" replace />} />
          <Route path="/my-trades" element={<Navigate to="/list" replace />} />
          <Route path="/my-trades/board" element={<Navigate to="/board" replace />} />
          <Route path="/my-trades/table" element={<Navigate to="/table" replace />} />
          <Route
            path="/favorites"
            element={<TradesPage title="交易日志" filter={{ type: 'starred' }} listPath="/favorites" />}
          />
          <Route
            path="/favorites/board"
            element={<TradesPage title="交易日志" filter={{ type: 'starred' }} listPath="/favorites" />}
          />
          <Route
            path="/favorites/table"
            element={<TradesPage title="交易日志" filter={{ type: 'starred' }} listPath="/favorites" />}
          />
          <Route
            path="/missed"
            element={
              <TradesPage title="交易日志" filter={{ type: 'missed' }} listPath="/missed" />
            }
          />
          <Route
            path="/missed/board"
            element={
              <TradesPage title="交易日志" filter={{ type: 'missed' }} listPath="/missed" />
            }
          />
          <Route
            path="/missed/table"
            element={
              <TradesPage title="交易日志" filter={{ type: 'missed' }} listPath="/missed" />
            }
          />
          <Route path="/period/:slug" element={<PeriodPage />} />
          <Route path="/period/:slug/board" element={<PeriodPage />} />
          <Route path="/period/:slug/table" element={<PeriodPage />} />
          <Route path="/today-record" element={<TodayRecordPage />} />
          <Route path="/today-record/board" element={<TodayRecordPage />} />
          <Route path="/today-record/table" element={<TodayRecordPage />} />
          <Route path="/sim" element={<SimPage />} />
          <Route path="/sim/board" element={<SimPage />} />
          <Route path="/sim/table" element={<SimPage />} />
          <Route path="/review-cases" element={<ReviewCasesPage />} />
          <Route path="/review-cases/board" element={<ReviewCasesPage />} />
          <Route path="/review-cases/table" element={<ReviewCasesPage />} />
          <Route path="/review-cases/:scope" element={<ReviewCasesPage />} />
          <Route path="/review-cases/:scope/board" element={<ReviewCasesPage />} />
          <Route path="/review-cases/:scope/table" element={<ReviewCasesPage />} />
          <Route path="/paper" element={<Navigate to="/sim" replace />} />
          <Route path="/paper/board" element={<Navigate to="/sim/board" replace />} />
          <Route path="/paper/table" element={<Navigate to="/sim/table" replace />} />
          <Route path="/practice" element={<Navigate to="/sim" replace />} />
          <Route path="/practice/board" element={<Navigate to="/sim/board" replace />} />
          <Route path="/practice/table" element={<Navigate to="/sim/table" replace />} />
          <Route path="/strategy/:id" element={<StrategyPage />} />
          <Route path="/strategy/:id/board" element={<StrategyPage />} />
          <Route path="/strategy/:id/table" element={<StrategyPage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trade/:id" element={<DetailView />} />
          <Route path="/cases" element={<Navigate to="/list" replace />} />
          <Route path="/trash" element={<Navigate to="/trade-trash" replace />} />
          <Route path="/trade-trash" element={<TradeTrashView />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ProfileSettingsPanel />} />
            <Route path="shortcuts" element={<ShortcutsPanel />} />
            <Route path="strategies" element={<StrategiesPanel />} />
            <Route path="tags" element={<TagPresetsPanel />} />
            <Route path="symbols" element={<SymbolsPanel />} />
            <Route path="dispute-types" element={<Navigate to="/settings/tags" replace />} />
            <Route path="display" element={<DisplaySettingsPanel />} />
            <Route path="data" element={<DataSettingsPanel />} />
          </Route>
          <Route path="/strategies" element={<Navigate to="/settings/strategies" replace />} />
          <Route path="*" element={<Navigate to="/list" replace />} />
        </Routes>
      </AppFrame>
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
      />
      <TradeComposer />
      <ImageLightbox />
      <ToastHost />
    </>
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

      // Clean expired trash (30+ days old deleted records)
      const state = useStore.getState()
      await cleanExpiredTradeTrash(state.trades, state.purgeTrade)

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
