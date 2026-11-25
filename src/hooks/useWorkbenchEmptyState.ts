import { useLocation, useNavigate } from 'react-router-dom'
import { getJournalFilterResetSearch } from '@/lib/journalFilterSearch'
import { getJournalViewState } from '@/lib/journalQuickViews'
import { pathWithWorkbenchMode, workbenchModeFromPathname } from '@/lib/routeContext'
import type { ListFilter } from '@/lib/tradeFilters'
import { sharedTradeWorkspaceSearch } from '@/lib/tradeWorkspaceQuery'
import {
  getWorkbenchResetPath,
  resolveWorkbenchEmptyState,
  shouldResetWorkbenchHideClosed,
} from '@/lib/workbenchEmptyState'
import { useStore } from '@/store/useStore'
import type { useWorkbenchVisibleTrades } from './useWorkbenchVisibleTrades'

export function useWorkbenchEmptyState(
  filter: ListFilter,
  workspace: ReturnType<typeof useWorkbenchVisibleTrades>,
  journal: boolean,
) {
  const navigate = useNavigate()
  const { pathname, search, state } = useLocation()
  const hideClosed = useStore(state => state.display.hideClosed)
  const sidebarItems = useStore(state => state.display.sidebarWorkspaceItems)
  const starredIds = useStore(state => state.starredIds)
  const savedViews = useStore(state => state.savedTradeViews)
  const setDisplay = useStore(state => state.setDisplay)
  const { totalCount, workspaceCount, visible, trades, businessDateAnchor } = workspace
  const emptyState = resolveWorkbenchEmptyState({
    totalCount, workspaceCount, visibleCount: visible.length, recordKind: filter.tradeKind,
  })
  function go(to: string, query = '', keepView = false) {
    navigate({ pathname: to, search: query }, {
      replace: true, state: keepView ? getJournalViewState(state) : undefined,
    })
  }

  if (emptyState?.kind !== 'filtered') return { emptyState, resetEmptyConditions: () => {} }

  const revealClosed = shouldResetWorkbenchHideClosed({
    hideClosed, trades, filter, starredIds, search, businessDateAnchor,
  })
  const caseLibrary = filter.tradeKind === 'case' && !filter.historicalLiveScope
  if (journal || caseLibrary) {
    const baseline = getJournalFilterResetSearch(pathname, search, sidebarItems, savedViews, state)
    const current = new URLSearchParams(search)
    current.sort()
    baseline.sort()
    if (baseline.toString() !== current.toString()) {
      return { emptyState, resetEmptyConditions: () => go(pathname, baseline.toString(), true) }
    }
    if (caseLibrary) return {
      emptyState: { ...emptyState, primaryAction: { ...emptyState.primaryAction, label: '查看全部案例' } },
      resetEmptyConditions: () => go(getWorkbenchResetPath(pathname, 'case')),
    }
    const label = revealClosed ? '显示已平仓交易' : '查看全部交易'
    return {
      emptyState: { ...emptyState, primaryAction: { ...emptyState.primaryAction, label } },
      resetEmptyConditions: () => revealClosed
        ? setDisplay({ hideClosed: false })
        : go(pathname, sharedTradeWorkspaceSearch(search)),
    }
  }

  function resetEmptyConditions() {
    if (revealClosed) setDisplay({ hideClosed: false })
    if (filter.historicalLiveScope) {
      const params = new URLSearchParams(search)
      for (const key of [...params.keys()]) {
        if (key !== 'liveStage' && key !== 'tab') params.delete(key)
      }
      go(pathWithWorkbenchMode('/live-history', workbenchModeFromPathname(pathname)), params.toString())
    } else {
      go(getWorkbenchResetPath(pathname, filter.tradeKind))
    }
  }
  return { emptyState, resetEmptyConditions }
}
