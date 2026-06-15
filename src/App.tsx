import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
  useParams,
} from 'react-router-dom'
import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from './store/useStore'
import { bootstrapStorage } from './storage'
import { flushPersistNow } from './storage/persist'
import { Sidebar } from './components/Sidebar'
import { CommandPalette } from './components/CommandPalette'
import { DataIOModal } from './components/DataIOModal'
import { TradeComposer } from './components/TradeComposer'
import { ToastHost } from './components/Toast'
import { ListView } from './views/ListView'
import { BoardView } from './views/BoardView'
import { Dashboard } from './views/Dashboard'
import { DetailView } from './views/DetailView'
import { StrategiesView } from './views/StrategiesView'
import { StrategyHeader } from './components/StrategyHeader'
import { getStrategyName } from './lib/strategies'
import type { ListFilter } from './lib/tradeFilters'
import { PERIOD_LABELS, isValidPeriodSlug } from './lib/periods'
import { MISSED_PAGE_TITLE } from './lib/pageCopy'
import { tradeDetailPath } from './lib/tradeRoute'
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

function KindPage({ kind, title }: { kind: 'paper' | 'practice'; title: string }) {
  const listPath = kind === 'paper' ? '/paper' : '/practice'
  return (
    <TradesPage
      title={title}
      filter={{ type: 'all', tradeKind: kind }}
      listPath={listPath}
    />
  )
}

function Shell() {
  const [cmdkOpen, setCmdkOpen] = useState(false)
  const [dataIOOpen, setDataIOOpen] = useState(false)
  const navigate = useNavigate()
  const openComposer = useStore((s) => s.openComposer)
  const composerOpen = useStore((s) => s.composerOpen)

  useEffect(() => {
    let pendingG = false
    let gTimer: ReturnType<typeof setTimeout> | null = null

    const clearG = () => {
      pendingG = false
      if (gTimer) {
        clearTimeout(gTimer)
        gTimer = null
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdkOpen((o) => !o)
        return
      }
      const t = e.target as HTMLElement
      const typing =
        t?.tagName === 'INPUT' ||
        t?.tagName === 'TEXTAREA' ||
        t?.isContentEditable
      if (
        e.key.toLowerCase() === 'c' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !typing &&
        !cmdkOpen &&
        !composerOpen
      ) {
        e.preventDefault()
        openComposer()
        return
      }

      if (typing || cmdkOpen || composerOpen) {
        clearG()
        return
      }

      const key = e.key.toLowerCase()
      if (!pendingG && key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        pendingG = true
        gTimer = setTimeout(clearG, 1500)
        return
      }
      if (pendingG) {
        e.preventDefault()
        clearG()
        if (key === 'l') navigate('/list')
        else if (key === 'b') navigate('/board')
        else if (key === 'd') navigate('/dashboard')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearG()
    }
  }, [cmdkOpen, composerOpen, openComposer, navigate])

  return (
    <div className="app-shell">
      <Sidebar
        onOpenSearch={() => setCmdkOpen(true)}
        onOpenDataIO={() => setDataIOOpen(true)}
      />
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
            path="/inbox"
            element={
              <TradesPage
                title="收件箱"
                filter={{ type: 'inbox', tradeKind: 'live' }}
                listPath="/inbox"
              />
            }
          />
          <Route
            path="/inbox/board"
            element={
              <TradesPage
                title="收件箱"
                filter={{ type: 'inbox', tradeKind: 'live' }}
                listPath="/inbox"
              />
            }
          />
          <Route
            path="/my-trades"
            element={
              <TradesPage
                title="我的交易"
                filter={{ type: 'mine', tradeKind: 'live' }}
                listPath="/my-trades"
              />
            }
          />
          <Route
            path="/my-trades/board"
            element={
              <TradesPage
                title="我的交易"
                filter={{ type: 'mine', tradeKind: 'live' }}
                listPath="/my-trades"
              />
            }
          />
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
          <Route path="/paper" element={<KindPage kind="paper" title="纸面" />} />
          <Route path="/paper/board" element={<KindPage kind="paper" title="纸面" />} />
          <Route path="/practice" element={<KindPage kind="practice" title="练习复盘" />} />
          <Route path="/practice/board" element={<KindPage kind="practice" title="练习复盘" />} />
          <Route path="/strategy/:id" element={<StrategyPage />} />
          <Route path="/strategy/:id/board" element={<StrategyPage />} />
          <Route path="/strategies" element={<StrategiesView />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </main>
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        onOpenDataIO={() => {
          setCmdkOpen(false)
          setDataIOOpen(true)
        }}
      />
      <DataIOModal open={dataIOOpen} onClose={() => setDataIOOpen(false)} />
      <TradeComposer />
      <ToastHost />
    </div>
  )
}

export function App() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    bootstrapStorage()
      .then(() => setReady(true))
      .catch((e) => {
        console.error('Storage bootstrap failed', e)
        setReady(true)
      })
  }, [])

  useEffect(() => {
    const onBeforeUnload = () => {
      void flushPersistNow()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  if (!ready) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <span className="app-loading-spinner" aria-hidden />
        <span>加载本地库…</span>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  )
}
