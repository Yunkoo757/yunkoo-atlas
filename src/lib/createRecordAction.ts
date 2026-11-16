import { newTradeKindForPath } from '@/lib/tradeKind'
import { backtestProjectIdForPath } from '@/lib/backtestProjects'
import { createQuickNote } from '@/data/quickNotes'
import { useStore } from '@/store/useStore'

export function resolveCreateRecordAction(pathname: string, search = '') {
  if (pathname === '/notes' || pathname.startsWith('/notes/')) return { kind: 'note' as const, label: '新建随记', actionId: 'global.newQuickNote' }
  if (pathname.startsWith('/review-cases')) return { kind: 'case' as const, label: '新建案例', actionId: 'global.newCase' }
  const kind = newTradeKindForPath(pathname, search)
  return { kind, label: kind === 'backtest' ? '新建回测记录' : kind === 'paper' ? '新建模拟交易' : '新建交易', actionId: 'global.newTrade' }
}

export function createRecordForContext(pathname: string, search: string, navigate: (path: string) => void) {
  const action = resolveCreateRecordAction(pathname, search)
  const store = useStore.getState()
  if (action.kind === 'note') {
    const note = createQuickNote()
    store.upsertQuickNote(note)
    navigate(`/notes/${encodeURIComponent(note.id)}`)
  } else {
    store.openComposer(null, action.kind, backtestProjectIdForPath(pathname, store.trades))
  }
}
