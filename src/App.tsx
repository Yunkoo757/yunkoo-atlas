import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useNavigate,
  useLocation,
  useParams,
} from 'react-router-dom'
import { Suspense, lazy, useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from './store/useStore'
import { useShortcutStore } from './store/shortcutStore'
import {
  bootstrapStorage,
  getStorage,
  isStorageHydrated,
  publishDurableStoreRefresh,
} from './storage'
import { disablePersistWrites, flushPersistNow, hasPendingChanges, setPreFlushCallback } from './storage/persist'
import { flushNoteDraftsToStore, hasPendingNoteDrafts } from './storage/noteDrafts'
import { flushStorageBeforeCutover } from './storage/cutover'
import { shouldPreventAppUnload } from './storage/unloadGuard'
import { isElectron } from './storage/runtime'
import { WelcomeScreen } from './components/WelcomeScreen'
import { Sidebar } from './components/Sidebar'
import { TradeWorkspaceContext } from './components/TradeWorkspaceContext'
import { AppFrame } from './components/ui/AppFrame'
import { StageRolloverBanner } from './components/StageRolloverBanner'
import { CommandPalette } from './components/CommandPalette'
import { TradeComposer } from './components/TradeComposer'
import { TradeCloseDialog } from './components/TradeCloseDialog'
import { TradeOpenRiskDialog } from './components/TradeOpenRiskDialog'
import { ToastHost } from './components/Toast'
import { Button } from './components/ui/Button'
import { InlineStatus, type InlineStatusTone } from './components/ui/InlineStatus'
import { ModalShell } from './components/ui/ModalShell'
import type { WindowsCloseChoice } from './types/journalBridge'
import { toast } from './lib/toast'
import { AsyncGeneration } from './lib/asyncGeneration'
import { ImageLightbox } from './components/ImageLightbox'
import { WebStorageGuard } from './components/WebStorageGuard'
import { DelayedRouteFallback, RouteErrorBoundary, RouteNotFound } from './components/RouteState'
import { LoadingIndicator } from './icons/LoadingIndicator'
import { ICON_XL } from './icons/iconSize'
import { TradesPage } from './views/TradesPage'
import { SettingsLayout } from './views/settings/SettingsLayout'
import { TradeTrashView } from './views/TradeTrashView'
import { StrategyHeader } from './components/StrategyHeader'
import { getStrategyName } from './lib/strategies'
import {
  normalizeTradeWorkspaceSearch,
  parseTradeWorkspaceQuery,
  resolveTradeWorkspaceListFilter,
  tradeWorkspacePageFromSearch,
} from './lib/tradeWorkspaceQuery'
import { normalizeReviewCaseScope } from './lib/reviewCaseScope'
import { getTradingDayKey, isValidPeriodSlug, parseLocalDate, PERIOD_LABELS } from './lib/periods'
import { routeWithSearch } from './lib/tradeView'
import { listPathFromLegacyTablePath } from './lib/routeContext'
import { useShortcutHost } from './shortcuts/ShortcutHost'
import { cleanExpiredTradeTrash } from './lib/trashCleanup'
import { lockBottomChrome, unlockBottomChrome } from './lib/toast'
import { parseAnalysisScope } from './lib/analysisScope'
import {
  hasCombinedStrategySources,
  parseStrategySourcesSearch,
} from './lib/sidebarWorkspace'
import { weekStartFor } from './data/weeklyReviews'
import {
  classifyUncertainStageRolloverSnapshot,
  createStageRolloverCheck,
  executeDueStageRollover,
  reconcileCommittedStageRollover,
  STAGE_MANAGEMENT_OPEN_EVENT,
} from './lib/stageRolloverCommit'
import { STORAGE_RECOVERY_REQUIRED_EVENT, notifyStorageRecoveryRequired } from './lib/storageRecovery'
import { createForegroundStageRolloverScheduler } from './lib/stageRolloverScheduler'
import './App.css'

const CLOSE_SAVE_RECEIPT_MS = 560

const checkDueStageRollover = createStageRolloverCheck(async () => {
  if (!isElectron() || !isStorageHydrated()) return { kind: 'not-scheduled' }
  const result = await executeDueStageRollover({
    captureLatest: () => {
      const state = useStore.getState()
      const now = new Date()
      return {
        state,
        currentTradingDayKey: getTradingDayKey(now, state.display.tradingDayStartHour),
      }
    },
    flushBeforeCommit: async () => {
      const complete = await flushNoteDraftsToStore()
      if (!complete) throw new Error('笔记中的图片尚未保存完成')
      await flushStorageBeforeCutover()
    },
    commitDurably: (input) => window.journalBridge!.commitStageRollover(input),
    recoverAfterCommitError: async (input) => classifyUncertainStageRolloverSnapshot(
      input,
      await getStorage().loadSnapshot(),
    ),
    postpone: async (scheduled) => {
      const previous = useStore.getState().scheduledStageRollover
      useStore.getState().publishPostponedRollover(scheduled)
      try {
        await flushPersistNow()
      } catch (error) {
        useStore.setState({ scheduledStageRollover: previous })
        try { await flushPersistNow() } catch { /* 保留旧 UI 状态并由错误提示要求用户重试。 */ }
        throw error
      }
    },
    publish: (authoritative) => reconcileCommittedStageRollover(authoritative, {
      reloadAuthoritativeSnapshot: () => getStorage().loadSnapshot(),
      publishDurableSnapshot: async (snapshot, publish) => {
        const { applySnapshotToStore } = await import('./lib/importExport')
        publishDurableStoreRefresh(() => {
          applySnapshotToStore(snapshot)
          useStore.getState().publishCommittedStageRollover(publish)
        })
      },
    }),
    enterRecoveryRequired: (message) => {
      disablePersistWrites()
      notifyStorageRecoveryRequired(message)
    },
  })
  if (result.kind === 'committed') {
    toast('已安全切换到新的实盘阶段', { dedupeKey: 'stage-rollover-committed' })
  } else if (result.kind === 'postponed') {
    toast('阶段切换条件尚未满足，已顺延到下周', { dedupeKey: 'stage-rollover-postponed' })
  } else if (result.kind === 'failed') {
    toast(result.message, { tone: 'error', dedupeKey: `stage-rollover-${result.reason}` })
  }
  return result
})

function currentBusinessWeek(): string {
  const state = useStore.getState()
  const tradingDayKey = getTradingDayKey(new Date(), state.display.tradingDayStartHour)
  return weekStartFor(parseLocalDate(tradingDayKey))
}

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
  const tone: InlineStatusTone = state.phase === 'saving'
    ? 'progress'
    : state.phase === 'saved'
      ? 'success'
      : 'error'

  return (
    <div className={`app-close-save is-${state.phase}`}>
      <InlineStatus
        className="app-close-save-panel"
        tone={tone}
        title={message}
        detail={state.phase === 'error' ? state.message : undefined}
        action={state.phase === 'error' ? (
          <>
            <Button size="sm" onClick={onDismiss}>继续使用</Button>
            <Button size="sm" variant="primary" onClick={onRetry}>重试退出</Button>
          </>
        ) : undefined}
      />
    </div>
  )
}

export function WindowsClosePrompt({
  remember,
  onRememberChange,
  onChoose,
}: {
  remember: boolean
  onRememberChange: (remember: boolean) => void
  onChoose: (choice: WindowsCloseChoice) => void
}) {
  return (
    <ModalShell
      title="关闭 Trader Atlas"
      description="选择关闭主窗口后软件在 Windows 中的行为。"
      size="compact"
      dismissible={false}
      onClose={() => {}}
      footer={(
        <>
          <Button variant="bordered" onClick={() => onChoose('quit')}>彻底退出</Button>
          <Button data-autofocus variant="primary" onClick={() => onChoose('tray')}>隐藏到托盘</Button>
        </>
      )}
    >
      <InlineStatus
        tone="info"
        title="隐藏后仍会继续保护和自动备份本地资料库"
        detail="你可以从系统托盘重新打开；选择彻底退出会先完成安全保存。"
      />
      <label className="app-windows-close-remember">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => onRememberChange(event.currentTarget.checked)}
        />
        <span>记住此选择，可在“设置 → 显示”中修改</span>
      </label>
    </ModalShell>
  )
}

const Dashboard = lazy(() =>
  import('./views/Dashboard').then((module) => ({ default: module.Dashboard })),
)
const DetailView = lazy(() =>
  import('./views/DetailView').then((module) => ({ default: module.DetailView })),
)
function LegacyLiveArchiveRedirect() {
  const location = useLocation()
  const { archiveId } = useParams()
  const params = new URLSearchParams(location.search)
  if (archiveId) {
    params.set('archiveReason', 'missing')
    params.set('requestedKey', archiveId)
  }
  const search = params.toString()
  return (
    <Navigate
      to={{ pathname: '/live-history', search: search ? `?${search}` : '' }}
      replace
    />
  )
}
const ImportDataHealthView = lazy(() =>
  import('./views/ImportDataHealthView').then((module) => ({ default: module.ImportDataHealthView })),
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
const RiskManagementSettingsPanel = lazy(() =>
  import('./views/settings/RiskManagementSettingsPanel').then((module) => ({ default: module.RiskManagementSettingsPanel })),
)
const RiskDataRepairView = lazy(() =>
  import('./views/settings/RiskDataRepairView').then((module) => ({ default: module.RiskDataRepairView })),
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
const StageOwnershipRepairView = lazy(() =>
  import('./views/StageOwnershipRepairView').then((module) => ({ default: module.StageOwnershipRepairView })),
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

export function TradeLogPage() {
  const { search } = useLocation()
  const { pathname } = useLocation()
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const legacyPage = tradeWorkspacePageFromSearch(search)
  const normalized = normalizeTradeWorkspaceSearch(search, liveStages, currentLiveStageId)
  const normalizedSearch = normalized.toString()
  if (legacyPage) {
    return <Navigate to={{
      pathname: legacyPage === 'stats' ? '/dashboard' : '/weekly-review',
      search: normalizedSearch ? `?${normalizedSearch}` : '',
    }} replace />
  }
  if (normalizedSearch !== new URLSearchParams(search).toString()) {
    return <Navigate to={{ pathname, search: normalizedSearch ? `?${normalizedSearch}` : '' }} replace />
  }
  const query = parseTradeWorkspaceQuery(normalized, liveStages, currentLiveStageId)
  const filter = resolveTradeWorkspaceListFilter(query)
  return (
    <TradesPage
      title="交易日志"
      filter={filter}
      listPath="/list"
      header={<TradeWorkspaceContext page="log" />}
    />
  )
}

function StatisticsPage() {
  return <Dashboard header={<TradeWorkspaceContext page="stats" />} />
}

function WeeklyReviewPage() {
  return <WeeklyReviewView header={<TradeWorkspaceContext page="review" />} />
}

function LegacyTradeLogRedirect({
  section,
  scope,
  source,
  filter,
}: {
  section?: 'stats' | 'reviews'
  scope?: 'history'
  source?: 'paper'
  filter?: 'active' | 'starred' | 'missed' | 'incomplete'
}) {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  if (section) {
    params.delete('section')
    const query = params.toString()
    return <Navigate to={{
      pathname: section === 'stats' ? '/dashboard' : '/weekly-review',
      search: query ? `?${query}` : '',
    }} replace />
  }
  if (scope) params.set('scope', scope)
  if (source) params.set('source', source)
  if (filter) params.set('filter', filter)
  const query = params.toString()
  return <Navigate to={{ pathname: '/list', search: query ? `?${query}` : '' }} replace />
}

export function StrategyPage() {
  const { id } = useParams()
  const { search } = useLocation()
  const strategies = useStore((s) => s.strategies)
  const currentLiveStageId = useStore((s) => s.currentLiveStageId)
  const strategyId = id ?? ''
  const listPath = `/strategy/${encodeURIComponent(strategyId)}`
  const title = getStrategyName(strategies, strategyId)
  const parsedScope = parseAnalysisScope(search)
  const analysisScope = parsedScope.explicit ? parsedScope.scope : undefined
  const strategySources = parseStrategySourcesSearch(search)
  const combinedSources = !analysisScope && hasCombinedStrategySources(strategySources)
  const params = new URLSearchParams(search)
  const liveRouteApplies = analysisScope?.kind !== 'paper'
  const requestedStage = params.get('liveStage')
  const hasLegacyScope = params.has('statsCycle') || params.has('liveCycle')
  if (
    !combinedSources && (
      (liveRouteApplies && requestedStage !== 'current')
      || (!liveRouteApplies && requestedStage !== null)
      || hasLegacyScope
    )
  ) {
    params.delete('statsCycle')
    params.delete('liveCycle')
    if (liveRouteApplies) params.set('liveStage', 'current')
    else params.delete('liveStage')
    const query = params.toString()
    return <Navigate to={`${listPath}${query ? `?${query}` : ''}`} replace />
  }
  const filter = analysisScope
    ? { type: 'strategy' as const, strategyId, analysisScope }
    : combinedSources
      ? {
          type: 'strategy' as const,
          strategyId,
          strategySources,
          liveStageId: currentLiveStageId,
        }
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

export function PeriodPage() {
  const { slug } = useParams()
  const location = useLocation()
  if (!slug || !isValidPeriodSlug(slug)) {
    const requestedPath = `${location.pathname}${location.search}`
    return (
      <main className="route-state" data-invalid-period role="alert">
        <h1 className="route-state-title">范围不存在</h1>
        <p>无法识别范围“{requestedPath}”，原请求未被改写。</p>
        <p>请选择有效范围，或返回今日交易日志。</p>
        <Link to="/period/today">返回今日</Link>
      </main>
    )
  }
  const listPath = `/period/${slug}`
  return (
    <TradesPage
      title={PERIOD_LABELS[slug]}
      filter={{ type: 'period', period: slug, tradeKind: 'live' }}
      listPath={listPath}
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
  if (error instanceof Error && /invalid display|sidebar|snapshot/i.test(error.message)) {
    return '本地显示配置无法识别（可能来自旧版侧栏项），请重试；若仍失败请从备份恢复。'
  }
  return '本地资料库暂时无法打开，请重试。'
}

async function waitForUiFonts(): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => window.setTimeout(resolve, 1200)),
    ])
  }
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
      >
        <StageRolloverBanner />
        <RouteErrorBoundary resetKey={`${location.pathname}${location.search}`}>
          <Suspense fallback={<DelayedRouteFallback />}>
            <Routes>
          <Route path="/" element={<Navigate to="/list" replace />} />
          <Route
            path="/list"
            element={<TradeLogPage />}
          />
          <Route
            path="/board"
            element={<TradeLogPage />}
          />
          <Route path="/active" element={<LegacyTradeLogRedirect filter="active" />} />
          <Route path="/active/board" element={<LegacyTradeLogRedirect filter="active" />} />
          <Route path="/inbox" element={<Navigate to="/active" replace />} />
          <Route path="/inbox/board" element={<Navigate to="/active/board" replace />} />
          <Route path="/my-trades" element={<Navigate to="/list" replace />} />
          <Route path="/my-trades/board" element={<Navigate to="/board" replace />} />
          <Route path="/favorites" element={<LegacyTradeLogRedirect filter="starred" />} />
          <Route path="/favorites/board" element={<LegacyTradeLogRedirect filter="starred" />} />
          <Route path="/missed" element={<LegacyTradeLogRedirect filter="missed" />} />
          <Route path="/missed/board" element={<LegacyTradeLogRedirect filter="missed" />} />
          <Route path="/period/:slug" element={<PeriodPage />} />
          <Route path="/period/:slug/board" element={<PeriodPage />} />
          <Route path="/today-record" element={<LegacyTradeLogRedirect filter="incomplete" />} />
          <Route path="/notes" element={<QuickNotesView />} />
          <Route path="/notes/:id" element={<QuickNotesView />} />
          <Route path="/today-record/board" element={<Navigate to="/today-record" replace />} />
          <Route path="/sim" element={<LegacyTradeLogRedirect source="paper" />} />
          <Route path="/sim/board" element={<LegacyTradeLogRedirect source="paper" />} />
          <Route path="/review-cases" element={<ReviewCasesPage />} />
          <Route path="/review-cases/board" element={<ReviewCasesPage />} />
          <Route path="/review-cases/:scope" element={<ReviewCasesPage />} />
          <Route path="/review-cases/:scope/board" element={<ReviewCasesPage />} />
          <Route path="/review-session" element={<ReviewSessionView />} />
          <Route path="/weekly-review" element={<WeeklyReviewPage />} />
          <Route path="/paper" element={<Navigate to="/sim" replace />} />
          <Route path="/paper/board" element={<Navigate to="/sim/board" replace />} />
          <Route path="/practice" element={<Navigate to="/sim" replace />} />
          <Route path="/practice/board" element={<Navigate to="/sim/board" replace />} />
          <Route path="/strategy/:id" element={<StrategyPage />} />
          <Route path="/strategy/:id/board" element={<StrategyPage />} />
          <Route path="/dashboard" element={<StatisticsPage />} />
          <Route path="/live-history" element={<LegacyTradeLogRedirect scope="history" />} />
          <Route path="/live-history/board" element={<LegacyTradeLogRedirect scope="history" />} />
          <Route path="/live-archive" element={<LegacyLiveArchiveRedirect />} />
          <Route path="/live-archive/:archiveId" element={<LegacyLiveArchiveRedirect />} />
          <Route path="/import-data-health" element={<ImportDataHealthView />} />
          <Route path="/trade/:id" element={<DetailView />} />
          <Route path="/cases" element={<Navigate to="/review-cases" replace />} />
          <Route path="/trash" element={<Navigate to="/trade-trash" replace />} />
          <Route path="/trade-trash" element={<TradeTrashView />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="profile" replace />} />
            <Route path="profile" element={<ProfileSettingsPanel />} />
            <Route path="shortcuts" element={<ShortcutsPanel />} />
            <Route path="strategies" element={<StrategiesPanel />} />
            <Route path="risk" element={<RiskManagementSettingsPanel />} />
            <Route path="risk/data-repair" element={<RiskDataRepairView />} />
            <Route path="tags" element={<TagPresetsPanel />} />
            <Route path="symbols" element={<SymbolsPanel />} />
            <Route path="review-templates" element={<ReviewTemplatesPanel />} />
            <Route path="dispute-types" element={<Navigate to="/settings/tags" replace />} />
            <Route path="display" element={<DisplaySettingsPanel />} />
            <Route path="data" element={<DataSettingsPanel />} />
            <Route path="data/stage-ownership-repair" element={<StageOwnershipRepairView />} />
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
      <TradeOpenRiskDialog />
      <ImageLightbox />
      <ToastHost />
    </>
  )
}

export function App() {
  const [ready, setReady] = useState(false)
  const [needsWelcome, setNeedsWelcome] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [storageRecoveryRequired, setStorageRecoveryRequired] = useState(false)
  const [retryingStorage, setRetryingStorage] = useState(false)
  const [recoveringStorage, setRecoveringStorage] = useState(false)
  const [closeSaveState, setCloseSaveState] = useState<CloseSaveState>({ phase: 'idle' })
  const [windowsClosePromptOpen, setWindowsClosePromptOpen] = useState(false)
  const [rememberWindowsClose, setRememberWindowsClose] = useState(false)
  const closeSaveGeneration = useRef(new AsyncGeneration())
  const storageRecoveryReloadAuthorized = useRef(false)

  useEffect(() => {
    if (closeSaveState.phase === 'idle') unlockBottomChrome()
    else lockBottomChrome()
  }, [closeSaveState.phase])

  useEffect(() => {
    const enterRecoveryRequired = (message: string) => {
      disablePersistWrites()
      setStorageRecoveryRequired(true)
      setStorageError(message)
      setReady(false)
      document.documentElement.dataset.uiSettled = '1'
    }
    const onRecoveryRequired = (event: Event) => {
      enterRecoveryRequired(
        event instanceof CustomEvent && typeof event.detail === 'string'
          ? event.detail
          : '阶段切换结果无法安全确认，已停止继续保存。',
      )
    }
    const unsubscribeStorageRecovery = window.journalBridge?.onStorageRecoveryRequired?.((state) => {
      enterRecoveryRequired(state.message)
    })
    window.addEventListener(STORAGE_RECOVERY_REQUIRED_EVENT, onRecoveryRequired)
    return () => {
      window.removeEventListener(STORAGE_RECOVERY_REQUIRED_EVENT, onRecoveryRequired)
      unsubscribeStorageRecovery?.()
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      // Electron: check if library needs initialization
      if (isElectron()) {
        try {
          const bridge = (window as any).journalBridge
          const status = await bridge.getLibraryStatus()
          if (status.kind === 'unset') {
            setNeedsWelcome(true)
            setReady(true) // show UI (welcome screen) but don't bootstrap yet
            return
          }
          if (status.kind !== 'ready') {
            setStorageError(`${status.reason}（${status.configuredPath}）`)
            setReady(false)
            document.documentElement.dataset.uiSettled = '1'
            return
          }
        } catch (e) {
          console.error('Library status check failed', e)
          setStorageError(storageBootstrapErrorMessage(e))
          setReady(false)
          document.documentElement.dataset.uiSettled = '1'
          return
        }
      }
      // Normal bootstrap
      await bootstrapStorage()
      await checkDueStageRollover()

      // 等字体就绪再亮屏，避免 Inter swap 导致列表从左到右重排
      await waitForUiFonts()

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
      await checkDueStageRollover()
      await waitForUiFonts()
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
      await checkDueStageRollover()
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

  const handleStorageRecovery = async () => {
    const bridge = window.journalBridge
    if (!bridge?.recoverStorage) {
      setStorageError('当前桌面运行时无法启动资料库恢复')
      return
    }
    setRecoveringStorage(true)
    storageRecoveryReloadAuthorized.current = true
    try {
      const result = await bridge.recoverStorage()
      if (!result.ok) {
        storageRecoveryReloadAuthorized.current = false
        setStorageError(result.message)
      }
      // 成功时由主进程在 fresh storage 激活后刷新 renderer；当前页面不得自行 reload。
    } catch (error) {
      storageRecoveryReloadAuthorized.current = false
      setStorageError(storageBootstrapErrorMessage(error))
    } finally {
      setRecoveringStorage(false)
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
    const rolloverScheduler = createForegroundStageRolloverScheduler({
      capture: () => {
        const state = useStore.getState()
        return {
          visible: document.visibilityState === 'visible',
          tradingDayStartHour: state.display.tradingDayStartHour,
          scheduledStageRollover: state.scheduledStageRollover,
        }
      },
      checkDue: checkDueStageRollover,
      reportError: (error) => console.error('Scheduled stage rollover check failed', error),
    })
    rolloverScheduler.start()
    const unsubscribeRolloverBoundary = useStore.subscribe((state, previous) => {
      if (
        state.scheduledStageRollover !== previous.scheduledStageRollover
        || state.currentLiveStageId !== previous.currentLiveStageId
        || state.liveStages !== previous.liveStages
        || state.display.tradingDayStartHour !== previous.display.tradingDayStartHour
      ) {
        rolloverScheduler.notifyBoundaryChange()
      }
    })
    let lastVisibleBusinessWeek = currentBusinessWeek()
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (
        !storageRecoveryReloadAuthorized.current &&
        shouldPreventAppUnload(hasPendingChanges(), hasPendingNoteDrafts())
      ) {
        e.preventDefault()
        e.returnValue = ''
      }
      // 恢复路径已经锁住旧 storage；主进程激活 fresh disk 实例后发起的 reload
      // 既不能被 beforeunload 拦住，也不能再从旧 renderer 排队一次 flush。
      if (!storageRecoveryReloadAuthorized.current) safeFlush()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        safeFlush()
        rolloverScheduler.notifyBoundaryChange()
      } else if (document.visibilityState === 'visible') {
        const visibleBusinessWeek = currentBusinessWeek()
        if (visibleBusinessWeek !== lastVisibleBusinessWeek) {
          lastVisibleBusinessWeek = visibleBusinessWeek
        }
        rolloverScheduler.notifyForeground()
      }
    }
    const onWindowFocus = () => rolloverScheduler.notifyForeground()
    const onStageManagementOpen = () => { void checkDueStageRollover() }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener(STAGE_MANAGEMENT_OPEN_EVENT, onStageManagementOpen)

    // Electron 主进程关闭前触发 flush
    if (isElectron()) {
      let unsubscribeBeforeClose: (() => void) | undefined
      let unsubscribeCloseError: (() => void) | undefined
      let unsubscribeAutoBackupFailure: (() => void) | undefined
      let unsubscribeWindowsCloseExplanation: (() => void) | undefined
      let unsubscribeWindowsClosePreferenceError: (() => void) | undefined
      try {
        const bridge = (window as any).journalBridge
        if (bridge?.onBeforeClose) {
          unsubscribeBeforeClose = bridge.onBeforeClose(async () => {
            const generation = closeSaveGeneration.current.begin()
            lockBottomChrome()
            setCloseSaveState({ phase: 'saving' })
            // 给状态至少一帧绘制时间，避免快速落盘时提示从未真正出现。
            await waitForCloseFeedback(48)
            try {
              if (isStorageHydrated()) await flushPersistNow()
              if (!closeSaveGeneration.current.isCurrent(generation)) return
              setCloseSaveState({ phase: 'saved' })
              await waitForCloseFeedback(CLOSE_SAVE_RECEIPT_MS)
              if (!closeSaveGeneration.current.isCurrent(generation)) return
            } catch (error) {
              if (!closeSaveGeneration.current.isCurrent(generation)) return
              setCloseSaveState({
                phase: 'error',
                message: error instanceof Error ? error.message : '请检查磁盘空间后重试。',
              })
              throw error
            }
          })
        }
        if (bridge?.onAutoBackupFailure) {
          unsubscribeAutoBackupFailure = bridge.onAutoBackupFailure(() => {
            toast('自动备份失败，请检查磁盘空间或在设置中手动创建备份', {
              tone: 'error',
              dedupeKey: 'automatic-backup-failure',
            })
          })
        }
        if (bridge?.onWindowsClosePreferenceError) {
          unsubscribeWindowsClosePreferenceError = bridge.onWindowsClosePreferenceError((message: string) => {
            toast(message, { tone: 'error', dedupeKey: 'windows-close-preference-save' })
          })
        }
        if (bridge?.onCloseSaveError) {
          unsubscribeCloseError = bridge.onCloseSaveError((message: string) => {
            closeSaveGeneration.current.invalidate()
            lockBottomChrome()
            // 错误回执已覆盖底部通知，不再额外 toast，避免双条重叠
            setCloseSaveState({ phase: 'error', message })
          })
        }
        if (bridge?.onWindowsCloseExplanation) {
          unsubscribeWindowsCloseExplanation = bridge.onWindowsCloseExplanation(() => {
            setRememberWindowsClose(false)
            setWindowsClosePromptOpen(true)
          })
        }
      } catch { /* bridge not available */ }

      return () => {
        setPreFlushCallback(null)
        rolloverScheduler.stop()
        unsubscribeRolloverBoundary()
        window.removeEventListener('beforeunload', onBeforeUnload)
        window.removeEventListener('focus', onWindowFocus)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        window.removeEventListener(STAGE_MANAGEMENT_OPEN_EVENT, onStageManagementOpen)
        unsubscribeBeforeClose?.()
        unsubscribeCloseError?.()
        unsubscribeAutoBackupFailure?.()
        unsubscribeWindowsCloseExplanation?.()
        unsubscribeWindowsClosePreferenceError?.()
      }
    }

    return () => {
      setPreFlushCallback(null)
      rolloverScheduler.stop()
      unsubscribeRolloverBoundary()
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener(STAGE_MANAGEMENT_OPEN_EVENT, onStageManagementOpen)
    }
  }, [])

  if (storageError) {
    return (
      <div className="app-storage-error">
        <InlineStatus
          className="app-storage-error-card"
          tone="error"
          title={(
            <>
              <span className="app-storage-error-eyebrow">
                {storageRecoveryRequired ? '本地资料库需要重新打开' : '本地资料库未打开'}
              </span>
              <h1>已停止进入工作区，避免覆盖现有数据</h1>
            </>
          )}
          detail={(
            <>
              <span>{storageError}</span>
              <small>
                {storageRecoveryRequired
                  ? '主进程将从磁盘重新建立资料库实例；软件不会用当前界面的旧状态继续保存。'
                  : '软件不会在加载失败时创建空数据或继续保存。'}
              </small>
            </>
          )}
          action={(
            <div className="app-storage-error-actions">
              {storageRecoveryRequired ? (
                <Button
                  size="lg"
                  variant="primary"
                  onClick={() => void handleStorageRecovery()}
                  disabled={recoveringStorage}
                >
                  {recoveringStorage ? '正在重新打开…' : '重新打开资料库'}
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="primary"
                  onClick={() => void handleStorageRetry()}
                  disabled={retryingStorage}
                >
                  {retryingStorage ? '正在重试…' : '重试打开'}
                </Button>
              )}
              {isElectron() && !storageRecoveryRequired && (
                <Button
                  size="lg"
                  variant="bordered"
                  onClick={() => {
                    setStorageError(null)
                    setNeedsWelcome(true)
                    setReady(true)
                  }}
                >
                  选择其他资料库
                </Button>
              )}
            </div>
          )}
        />
      </div>
    )
  }

  if (needsWelcome) {
    return <WelcomeScreen onReady={handleWelcomeReady} />
  }

  if (!ready) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <LoadingIndicator size={ICON_XL} aria-hidden />
        <span>加载资料库…</span>
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
      {windowsClosePromptOpen ? (
        <WindowsClosePrompt
          remember={rememberWindowsClose}
          onRememberChange={setRememberWindowsClose}
          onChoose={(choice) => {
            setWindowsClosePromptOpen(false)
            const bridge = window.journalBridge
            if (bridge) void bridge.resolveWindowsClose(choice, rememberWindowsClose)
          }}
        />
      ) : null}
      {!isElectron() ? <WebStorageGuard /> : null}
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
