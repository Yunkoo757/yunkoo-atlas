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
import { SettingsLayout } from './views/settings/SettingsLayout'
import { TradeTrashView } from './views/TradeTrashView'
import { TodayWorkspace } from './views/TodayWorkspace'
import { StrategyHeader } from './components/StrategyHeader'
import type { WorkbenchView } from './components/Topbar'
import { getStrategyName } from './lib/strategies'
import type { ListFilter, ReviewCaseScope } from './lib/tradeFilters'
import { isValidPeriodSlug } from './lib/periods'
import { tradeDetailPath, tradeDetailNavState } from './lib/tradeRoute'
import { routeWithSearch } from './lib/tradeView'
import { listPathFromLegacyTablePath, workbenchModeFromPathname } from './lib/routeContext'
import { useShortcutHost } from './shortcuts/ShortcutHost'
import { cleanExpiredTradeTrash } from './lib/trashCleanup'
import { lockBottomChrome, unlockBottomChrome } from './lib/toast'
import { rememberTradeReturnAnchor } from './hooks/useTradeReturnAnchor'
import { parseAnalysisScope } from './lib/analysisScope'
import './App.css'

const CLOSE_SAVE_RECEIPT_MS = 560

type CloseSaveState =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'saved' }
  | { phase: 'error'; message: string }

function waitForCloseFeedback(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function CloseSaveReceipt({
  state,
  onDismiss,
  onRetry,
}: {
  state: CloseSaveState
  onDismiss: () => void
  onRetry: () => void
}) {
  if (state.phase === 'idle') return null

  const message = state.phase === 'saving'
    ? '正在安全保存…'
    : state.phase === 'saved'
      ? '已安全保存'
      : '保存未完成，已取消退出'

  return (
    <div
      className={`app-close-save app-close-save--${state.phase}`}
      role={state.phase === 'error' ? 'alert' : 'status'}
      aria-live={state.phase === 'error' ? 'assertive' : 'polite'}
    >
      <div className="app-close-save-panel">
        <span className="app-close-save-mark" aria-hidden />
        <div className="app-close-save-copy">
          <strong>{message}</strong>
          {state.phase === 'error' && <span>{state.message}</span>}
        </div>
        {state.phase === 'error' && (
          <div className="app-close-save-actions">
            <button type="button" onClick={onDismiss}>继续使用</button>
            <button type="button" className="is-primary" onClick={onRetry}>重试退出</button>
          </div>
        )}
      </div>
    </div>
  )
}

const Dashboard = lazy(() =>
  import('./views/Dashboard').then((module) => ({ default: module.Dashboard })),
)
const DetailView = lazy(() =>
  import('./views/DetailView').then((module) => ({ default: module.DetailView })),
)
const ReviewSessionView = lazy(() =>
  import('./views/ReviewSessionView').then((module) => ({ default: module.ReviewSessionView })),
)
const WeeklyReviewView = lazy(() =>
  import('./views/WeeklyReviewView').then((module) => ({ default: module.WeeklyReviewView })),
)
const StrategiesPanel = lazy(() =>
  import('./views/settings/StrategiesPanel').then((module) => ({ default: module.StrategiesPanel })),
)
const QuickNotesView = lazy(() =>
  import('./views/QuickNotesView').then((module) => ({ default: module.QuickNotesView })),
)
const ShortcutsPanel = lazy(() =>
  import('./views/settings/ShortcutsPanel').then((module) => ({ default: module.ShortcutsPanel })),
)
const DisplaySettingsPanel = lazy(() =>
  import('./views/settings/DisplaySettingsPanel').then((module) => ({ default: module.DisplaySettingsPanel })),
)
const DataSettingsPanel = lazy(() =>
  import('./views/settings/DataSettingsPanel').then((module) => ({ default: module.DataSettingsPanel })),
)
const ProfileSettingsPanel = lazy(() =>
  import('./views/settings/ProfileSettingsPanel').then((module) => ({ default: module.ProfileSettingsPanel })),
)
const TagPresetsPanel = lazy(() =>
  import('./views/settings/TagPresetsPanel').then((module) => ({ default: module.TagPresetsPanel })),
)
const SymbolsPanel = lazy(() =>
  import('./views/settings/SymbolsPanel').then((module) => ({ default: module.SymbolsPanel })),
)
const UpdatesSettingsPanel = lazy(() =>
  import('./views/settings/UpdatesSettingsPanel').then((module) => ({ default: module.UpdatesSettingsPanel })),
)
const ReviewTemplatesPanel = lazy(() =>
  import('./views/settings/ReviewTemplatesPanel').then((module) => ({ default: module.ReviewTemplatesPanel })),
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
  const view: WorkbenchView = workbenchModeFromPathname(pathname)
  const setView = (v: WorkbenchView) => {
    const target = v === 'board' ? boardPath : listPath
    navigate(routeWithSearch(target, search))
  }
  return view === 'list' ? (
    <ListView title={title} view={view} onView={setView} filter={filter} header={header} />
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
  const { search } = useLocation()
  const strategies = useStore((s) => s.strategies)
  const strategyId = id ?? ''
  const listPath = `/strategy/${encodeURIComponent(strategyId)}`
  const title = getStrategyName(strategies, strategyId)
  const parsedScope = parseAnalysisScope(search)
  const analysisScope = parsedScope.explicit ? parsedScope.scope : undefined
  const filter = analysisScope
    ? { type: 'strategy' as const, strategyId, analysisScope }
    : { type: 'strategy' as const, strategyId, tradeKind: 'live' as const }
  return (
    <TradesPage
      title={title}
      filter={filter}
      listPath={listPath}
      header={<StrategyHeader strategyId={strategyId} analysisScope={analysisScope} search={search} />}
    />
  )
}

function PeriodPage() {
  const { slug } = useParams()
  if (!slug || !isValidPeriodSlug(slug)) {
    return <Navigate to="/period/today" replace />
  }
  const listPath = `/period/${slug}`
  return (
    <TradesPage
      title="交易日志"
      filter={{ type: 'period', period: slug, tradeKind: 'live' }}
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

function LegacyRouteFallback() {
  const { pathname, search } = useLocation()
  const listPath = listPathFromLegacyTablePath(pathname)
  if (listPath) return <Navigate to={routeWithSearch(listPath, search)} replace />
  return <RouteNotFound />
}

function storageBootstrapErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'VersionError') {
    return '本地数据版本不兼容，请刷新页面或更新应用后重试。'
  }
  return '本地交易库暂时无法打开，请重试。'
}

function Shell() {
  const [cmdkOpen, setCmdkOpen] = useState(false)
  const [cmdkReturnFocus, setCmdkReturnFocus] = useState<HTMLElement | null>(null)
  const location = useLocation()
  const setCmdkOpenStore = useShortcutStore((s) => s.setCmdkOpen)

  const toggleCmdk = useCallback(() => {
    setCmdkReturnFocus(null)
    setCmdkOpen((o) => !o)
  }, [])
  const openCmdk = useCallback((returnFocusTo?: HTMLElement | null) => {
    setCmdkReturnFocus(returnFocusTo ?? null)
    setCmdkOpen(true)
  }, [])

  useEffect(() => {
    setCmdkOpenStore(cmdkOpen)
  }, [cmdkOpen, setCmdkOpenStore])

  useShortcutHost({
    onToggleCmdk: toggleCmdk,
  })

  return (
    <>
      <AppFrame
        sidebar={<Sidebar onOpenSearch={() => openCmdk()} />}
        mobileNavigation={<MobileNavigation onOpenSearch={openCmdk} />}
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
          <Route path="/inbox" element={<Navigate to="/active" replace />} />
          <Route path="/inbox/board" element={<Navigate to="/active/board" replace />} />
          <Route path="/my-trades" element={<Navigate to="/list" replace />} />
          <Route path="/my-trades/board" element={<Navigate to="/board" replace />} />
          <Route
            path="/favorites"
            element={<TradesPage title="交易日志" filter={{ type: 'starred' }} listPath="/favorites" />}
          />
          <Route
            path="/favorites/board"
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
          <Route path="/period/:slug" element={<PeriodPage />} />
          <Route path="/period/:slug/board" element={<PeriodPage />} />
          <Route path="/today-record" element={<TodayRecordPage />} />
          <Route path="/notes" element={<QuickNotesView />} />
          <Route path="/notes/:id" element={<QuickNotesView />} />
          <Route path="/today-record/board" element={<Navigate to="/today-record" replace />} />
          <Route path="/sim" element={<SimPage />} />
          <Route path="/sim/board" element={<SimPage />} />
          <Route path="/review-cases" element={<ReviewCasesPage />} />
          <Route path="/review-cases/board" element={<ReviewCasesPage />} />
          <Route path="/review-cases/:scope" element={<ReviewCasesPage />} />
          <Route path="/review-cases/:scope/board" element={<ReviewCasesPage />} />
          <Route path="/review-session" element={<ReviewSessionView />} />
          <Route path="/weekly-review" element={<WeeklyReviewView />} />
          <Route path="/paper" element={<Navigate to="/sim" replace />} />
          <Route path="/paper/board" element={<Navigate to="/sim/board" replace />} />
          <Route path="/practice" element={<Navigate to="/sim" replace />} />
          <Route path="/practice/board" element={<Navigate to="/sim/board" replace />} />
          <Route path="/strategy/:id" element={<StrategyPage />} />
          <Route path="/strategy/:id/board" element={<StrategyPage />} />
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
            <Route path="review-templates" element={<ReviewTemplatesPanel />} />
            <Route path="dispute-types" element={<Navigate to="/settings/tags" replace />} />
            <Route path="display" element={<DisplaySettingsPanel />} />
            <Route path="data" element={<DataSettingsPanel />} />
            <Route path="updates" element={<UpdatesSettingsPanel />} />
          </Route>
          <Route path="/strategies" element={<Navigate to="/settings/strategies" replace />} />
            <Route path="*" element={<LegacyRouteFallback />} />
            </Routes>
          </Suspense>
        </RouteErrorBoundary>
      </AppFrame>
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        returnFocusTo={cmdkReturnFocus}
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
  const [closeSaveState, setCloseSaveState] = useState<CloseSaveState>({ phase: 'idle' })

  useEffect(() => {
    if (closeSaveState.phase === 'idle') unlockBottomChrome()
    else lockBottomChrome()
  }, [closeSaveState.phase])

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
      setStorageError(storageBootstrapErrorMessage(e))
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
      setStorageError(storageBootstrapErrorMessage(e))
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
      setStorageError(storageBootstrapErrorMessage(error))
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
      // hydrate 完成前禁止 flush，避免空默认 store 覆盖磁盘资料库
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
      let unsubscribeBeforeClose: (() => void) | undefined
      let unsubscribeCloseError: (() => void) | undefined
      try {
        const bridge = (window as any).journalBridge
        if (bridge?.onBeforeClose) {
          unsubscribeBeforeClose = bridge.onBeforeClose(async () => {
            lockBottomChrome()
            setCloseSaveState({ phase: 'saving' })
            // 给状态至少一帧绘制时间，避免快速落盘时提示从未真正出现。
            await waitForCloseFeedback(48)
            try {
              if (isStorageHydrated()) await flushPersistNow()
              setCloseSaveState({ phase: 'saved' })
              await waitForCloseFeedback(CLOSE_SAVE_RECEIPT_MS)
            } catch (error) {
              setCloseSaveState({
                phase: 'error',
                message: error instanceof Error ? error.message : '请检查磁盘空间后重试。',
              })
              throw error
            }
          })
        }
        if (bridge?.onCloseSaveError) {
          unsubscribeCloseError = bridge.onCloseSaveError((message: string) => {
            lockBottomChrome()
            // 错误回执已覆盖底部通知，不再额外 toast，避免双条重叠
            setCloseSaveState({ phase: 'error', message })
          })
        }
      } catch { /* bridge not available */ }

      return () => {
        setPreFlushCallback(null)
        window.removeEventListener('beforeunload', onBeforeUnload)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        unsubscribeBeforeClose?.()
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
                选择其他交易库
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
    <>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Shell />
      </Router>
      <CloseSaveReceipt
        state={closeSaveState}
        onDismiss={() => setCloseSaveState({ phase: 'idle' })}
        onRetry={() => {
          const bridge = window.journalBridge
          if (bridge?.requestClose) void bridge.requestClose()
        }}
      />
    </>
  )
}

let expiredTrashCleanupTimer: ReturnType<typeof globalThis.setTimeout> | undefined

function scheduleExpiredTrashCleanup(): void {
  if (expiredTrashCleanupTimer !== undefined) {
    globalThis.clearTimeout(expiredTrashCleanupTimer)
  }
  expiredTrashCleanupTimer = globalThis.setTimeout(() => {
    expiredTrashCleanupTimer = undefined
    const state = useStore.getState()
    void cleanExpiredTradeTrash(state.trades, state.purgeTrades).catch((error) => {
      console.error('Expired trash cleanup failed', error)
    })
  }, 1_000)
}
