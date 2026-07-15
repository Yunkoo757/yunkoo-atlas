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
import { Suspense, lazy, useEffect, useState, useCallback, type ReactNode } from 'react'
import { useStore } from './store/useStore'
import { useShortcutStore } from './store/shortcutStore'
import { bootstrapStorage } from './storage'
import { flushPersistNow, hasPendingChanges, setPreFlushCallback } from './storage/persist'
import { flushNoteDraftsToStore } from './storage/noteDrafts'
import { isStorageHydrated } from './storage'
import { isElectron } from './storage/runtime'
import { WelcomeScreen } from './components/WelcomeScreen'
import { Sidebar } from './components/Sidebar'
import { MobileNavigation } from './components/MobileNavigation'
import { AppFrame } from './components/ui/AppFrame'
import { CommandPalette } from './components/CommandPalette'
import { TradeComposer } from './components/TradeComposer'
import { TradeCloseDialog } from './components/TradeCloseDialog'
import { ToastHost } from './components/Toast'
import { ImageLightbox } from './components/ImageLightbox'
import { DelayedRouteFallback, RouteErrorBoundary, RouteNotFound } from './components/RouteState'
import { LinearGridLoaderIcon } from './icons/linear'
import { ICON_XL } from './icons/iconSize'
import { ListView } from './views/ListView'
import { BoardView } from './views/BoardView'
import { TableView } from './views/TableView'
import { SettingsLayout } from './views/settings/SettingsLayout'
import { ShortcutsPanel } from './views/settings/ShortcutsPanel'
import { DisplaySettingsPanel } from './views/settings/DisplaySettingsPanel'
import { DataSettingsPanel } from './views/settings/DataSettingsPanel'
import { ProfileSettingsPanel } from './views/settings/ProfileSettingsPanel'
import { TagPresetsPanel } from './views/settings/TagPresetsPanel'
import { SymbolsPanel } from './views/settings/SymbolsPanel'
import { UpdatesSettingsPanel } from './views/settings/UpdatesSettingsPanel'
import { TradeTrashView } from './views/TradeTrashView'
import { TodayWorkspace } from './views/TodayWorkspace'
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
import { toast } from './lib/toast'
import { rememberTradeReturnAnchor } from './hooks/useTradeReturnAnchor'
import './App.css'

const Dashboard = lazy(() =>
  import('./views/Dashboard').then((module) => ({ default: module.Dashboard })),
)
const DetailView = lazy(() =>
  import('./views/DetailView').then((module) => ({ default: module.DetailView })),
)
const StrategiesPanel = lazy(() =>
  import('./views/settings/StrategiesPanel').then((module) => ({ default: module.StrategiesPanel })),
)

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
  return <TodayWorkspace />
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
  const location = useLocation()
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
      <AppFrame
        sidebar={<Sidebar onOpenSearch={() => setCmdkOpen(true)} />}
        mobileNavigation={<MobileNavigation onOpenSearch={() => setCmdkOpen(true)} />}
      >
        <RouteErrorBoundary resetKey={`${location.pathname}${location.search}`}>
          <Suspense fallback={<DelayedRouteFallback />}>
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
          <Route path="/today-record/board" element={<Navigate to="/today-record" replace />} />
          <Route path="/today-record/table" element={<Navigate to="/today-record" replace />} />
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
            <Route path="updates" element={<UpdatesSettingsPanel />} />
          </Route>
          <Route path="/strategies" element={<Navigate to="/settings/strategies" replace />} />
            <Route path="*" element={<RouteNotFound />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </AppFrame>
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
      />
      <TradeComposer />
      <TradeCloseDialog />
      <ImageLightbox />
      <ToastHost />
    </>
  )
}

export function App() {
  const [ready, setReady] = useState(false)
  const [needsWelcome, setNeedsWelcome] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [retryingStorage, setRetryingStorage] = useState(false)

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

      // 等字体就绪再亮屏，避免 Inter swap 导致列表从左到右重排
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => window.setTimeout(resolve, 1200)),
        ])
      }

      setReady(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.documentElement.dataset.uiSettled = '1'
          scheduleExpiredTrashCleanup()
        })
      })
    }

    init().catch((e) => {
      console.error('Storage bootstrap failed', e)
      setStorageError(e instanceof Error ? e.message : String(e))
      setReady(false)
      document.documentElement.dataset.uiSettled = '1'
    })
  }, [])

  const handleWelcomeReady = async () => {
    setNeedsWelcome(false)
    setReady(false)
    document.documentElement.removeAttribute('data-ui-settled')
    try {
      await bootstrapStorage()
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => window.setTimeout(resolve, 1200)),
        ])
      }
    } catch (e) {
      console.error('Storage bootstrap failed after welcome', e)
      setStorageError(e instanceof Error ? e.message : String(e))
      setReady(false)
      document.documentElement.dataset.uiSettled = '1'
      return
    }
    setReady(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.dataset.uiSettled = '1'
      })
    })
  }

  const handleStorageRetry = async () => {
    setRetryingStorage(true)
    setStorageError(null)
    document.documentElement.removeAttribute('data-ui-settled')
    try {
      await bootstrapStorage()
      setReady(true)
      requestAnimationFrame(() => {
        document.documentElement.dataset.uiSettled = '1'
        scheduleExpiredTrashCleanup()
      })
    } catch (error) {
      console.error('Storage bootstrap retry failed', error)
      setStorageError(error instanceof Error ? error.message : String(error))
      document.documentElement.dataset.uiSettled = '1'
    } finally {
      setRetryingStorage(false)
    }
  }

  useEffect(() => {
    setPreFlushCallback(async () => {
      const complete = await flushNoteDraftsToStore()
      if (!complete) throw new Error('笔记中的图片尚未保存完成')
    })
    const safeFlush = () => {
      // hydrate 完成前禁止 flush，避免空默认 store 覆盖 iCloud 库
      if (!isStorageHydrated()) return
      flushPersistNow().catch(() => {})
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasPendingChanges()) {
        e.preventDefault()
        e.returnValue = ''
      }
      safeFlush()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        safeFlush()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onVisibilityChange)

    // Electron 主进程关闭前触发 flush
    if (isElectron()) {
      let unsubscribeCloseError: (() => void) | undefined
      try {
        const bridge = (window as any).journalBridge
        if (bridge?.onBeforeClose) {
          bridge.onBeforeClose(async () => {
            if (!isStorageHydrated()) return
            await flushPersistNow()
          })
        }
        if (bridge?.onCloseSaveError) {
          unsubscribeCloseError = bridge.onCloseSaveError((message: string) => toast(message))
        }
      } catch { /* bridge not available */ }

      return () => {
        setPreFlushCallback(null)
        window.removeEventListener('beforeunload', onBeforeUnload)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        unsubscribeCloseError?.()
      }
    }

    return () => {
      setPreFlushCallback(null)
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  if (storageError) {
    return (
      <div className="app-storage-error" role="alert" aria-live="assertive">
        <div className="app-storage-error-card">
          <span className="app-storage-error-eyebrow">本地交易库未打开</span>
          <h1>已停止进入工作区，避免覆盖现有数据</h1>
          <p>{storageError}</p>
          <div className="app-storage-error-actions">
            <button type="button" onClick={() => void handleStorageRetry()} disabled={retryingStorage}>
              {retryingStorage ? '正在重试…' : '重试打开'}
            </button>
            {isElectron() && (
              <button
                type="button"
                className="is-secondary"
                onClick={() => {
                  setStorageError(null)
                  setNeedsWelcome(true)
                  setReady(true)
                }}
              >
                选择其他资料库
              </button>
            )}
          </div>
          <small>软件不会在加载失败时创建空数据或继续保存。</small>
        </div>
      </div>
    )
  }

  if (needsWelcome) {
    return <WelcomeScreen onReady={handleWelcomeReady} />
  }

  if (!ready) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <LinearGridLoaderIcon variant="scope" size={ICON_XL} aria-hidden />
        <span>加载本地库…</span>
      </div>
    )
  }

  const Router = isElectron() ? HashRouter : BrowserRouter
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Shell />
    </Router>
  )
}

function scheduleExpiredTrashCleanup(): void {
  const run = () => {
    const state = useStore.getState()
    void cleanExpiredTradeTrash(state.trades, state.purgeTrades)
  }
  globalThis.setTimeout(run, 1_000)
}
