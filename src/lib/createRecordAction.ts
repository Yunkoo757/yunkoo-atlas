import type { NavigateOptions } from 'react-router-dom'
import type { Trade } from '@/data/trades'
import { findTradeByRouteParam } from '@/lib/tradeRoute'
import { parseTradeFacets } from '@/lib/workbenchTrades'
import { newTradeKindForPath } from '@/lib/tradeKind'
import { backtestProjectIdForPath, type BacktestProject } from '@/lib/backtestProjects'
import { noteDraftKey, hasNoteDraft } from '@/storage/noteDrafts'
import { hasPendingStorageOperations } from '@/storage/pendingOperations'
import { createQuickNote } from '@/data/quickNotes'
import { useStore } from '@/store/useStore'

export type ComposerGroup = { strategyId?: string; month?: string; status?: 'planned' | 'missed' }

function detailRecord(pathname: string, trades: Trade[]) {
  if (!pathname.startsWith('/trade/')) return undefined
  const trade = findTradeByRouteParam(trades, pathname.slice('/trade/'.length))
  return trade && !trade.deletedAt ? trade : undefined
}

export function resolveCreateRecordAction(pathname: string, search = '', trades: Trade[] = []) {
  if (pathname === '/notes' || pathname.startsWith('/notes/')) return { kind: 'note' as const, label: '新建随记', actionId: 'global.newQuickNote' }
  const detail = detailRecord(pathname, trades)
  if (pathname.startsWith('/review-cases') || detail?.tradeKind === 'case') return { kind: 'case' as const, label: '新建案例', actionId: 'global.newCase' }
  const kind = detail?.tradeKind ?? newTradeKindForPath(pathname, search)
  return { kind, label: kind === 'backtest' ? '新建回测记录' : kind === 'paper' ? '新建模拟交易' : '新建交易', actionId: 'global.newTrade' }
}

export function composerDefaultsForWorkspace(pathname: string, search: string) {
  const strategyRoute = /^\/strategy\/([^/]+)/.exec(pathname)
  const cases = /^\/review-cases(?:\/([^/]+))?/.exec(pathname)
  const backtest = pathname.startsWith('/backtests/')
  const workbench = strategyRoute || cases || backtest || pathname === '/list' || pathname === '/board'
  const params = new URLSearchParams(workbench ? search : '')
  const facets = parseTradeFacets(params)
  const caseType = facets.caseType ?? (cases?.[1] === 'mistakes' ? 'mistake' : cases?.[1] === 'missed' ? 'missed' : undefined)
  return {
    strategyId: strategyRoute?.[1] ?? facets.strategyId,
    symbol: facets.symbol,
    side: facets.side,
    status: facets.status === 'missed' || params.get('view') === 'missed' || (backtest && params.get('records') === 'missed') ? 'missed' as const : 'planned' as const,
    caseType,
  }
}

export function isRecordCreationArchived(pathname: string, trades: readonly Trade[], projects: readonly BacktestProject[]) {
  const projectId = backtestProjectIdForPath(pathname, trades)
  return projectId !== null && projects.some(project => project.id === projectId && Boolean(project.archivedAt))
}

type NavigateToRecord = (path: string, options?: NavigateOptions) => void

export function createAndOpenQuickNote(navigate: NavigateToRecord, pathname: string) {
  const store = useStore.getState()
  const blank = !hasPendingStorageOperations() && store.quickNotes.find(note =>
    note.titleMode === 'auto' && !note.pinned && !note.contentHtml && note.createdAt === note.updatedAt &&
    !hasNoteDraft(noteDraftKey('quickNote', note.id)),
  )
  const note = blank || createQuickNote()
  const path = `/notes/${encodeURIComponent(note.id)}`
  navigate(path, { replace: pathname === path, state: { focusNewNote: note.id } })
  if (!blank) store.upsertQuickNote(note)
}

export function createRecordForContext(pathname: string, search: string, navigate: NavigateToRecord, group?: ComposerGroup) {
  const store = useStore.getState()
  const action = resolveCreateRecordAction(pathname, search, store.trades)
  if (action.kind === 'note') {
    createAndOpenQuickNote(navigate, pathname)
  } else {
    store.openComposer(null, action.kind, backtestProjectIdForPath(pathname, store.trades), group)
  }
}
