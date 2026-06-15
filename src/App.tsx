import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useStore } from './store/useStore'
import { Sidebar } from './components/Sidebar'
import { CommandPalette } from './components/CommandPalette'
import { TradeComposer } from './components/TradeComposer'
import { ListView } from './views/ListView'
import { BoardView } from './views/BoardView'
import { Dashboard } from './views/Dashboard'
import { DetailView } from './views/DetailView'
import './App.css'

function TradesPage() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const view: 'list' | 'board' = pathname === '/board' ? 'board' : 'list'
  const setView = (v: 'list' | 'board') => navigate('/' + v)

  return view === 'list' ? (
    <ListView view={view} onView={setView} />
  ) : (
    <BoardView view={view} onView={setView} onOpen={(id) => navigate(`/trade/${id}`)} />
  )
}

function Shell() {
  const [cmdkOpen, setCmdkOpen] = useState(false)
  const openComposer = useStore((s) => s.openComposer)
  const composerOpen = useStore((s) => s.composerOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdkOpen((o) => !o)
        return
      }
      // 全局 C 新建（不在输入/编辑区、无修饰键、命令面板关闭时）
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cmdkOpen, composerOpen, openComposer])

  return (
    <div className="app-shell">
      <Sidebar onOpenSearch={() => setCmdkOpen(true)} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/list" replace />} />
          <Route path="/list" element={<TradesPage />} />
          <Route path="/board" element={<TradesPage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/trade/:id" element={<DetailView />} />
        </Routes>
      </main>
      <CommandPalette open={cmdkOpen} onClose={() => setCmdkOpen(false)} />
      <TradeComposer />
    </div>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  )
}
