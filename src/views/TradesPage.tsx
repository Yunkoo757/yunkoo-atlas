import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { WorkbenchView } from '@/components/Topbar'
import { resultRepairAnchor } from '@/hooks/useResultRepairReturn'
import { rememberTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { workbenchModeFromPathname } from '@/lib/routeContext'
import { getJournalViewState } from '@/lib/journalQuickViews'
import { syncPrimaryWorkspaceMode } from '@/lib/workspaceViews'
import type { ListFilter } from '@/lib/tradeFilters'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { routeWithSearch } from '@/lib/tradeView'
import { useStore } from '@/store/useStore'
import { BoardView } from '@/views/BoardView'
import { ListView } from '@/views/ListView'

/** 列表与看板共用的交易工作台；业务模块只提供标题、路由和数据范围。 */
export function TradesPage({
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
  const { pathname, search, state: routeState } = useLocation()
  const boardPath = listPath === '/list' ? '/board' : `${listPath}/board`
  const view: WorkbenchView = workbenchModeFromPathname(pathname)
  const setView = (nextView: WorkbenchView) => {
    const state = useStore.getState()
    state.setDisplay({
      workspaceMemory: syncPrimaryWorkspaceMode(state.display.workspaceMemory, nextView),
    })
    const target = nextView === 'board' ? boardPath : listPath
    navigate(routeWithSearch(target, search), {
      state: listPath === '/list' ? getJournalViewState(routeState) : undefined,
    })
  }

  return view === 'list' ? (
    <ListView
      title={title}
      view={view}
      onView={setView}
      filter={filter}
      header={header}
      journal={listPath === '/list'}
    />
  ) : (
    <BoardView
      title={title}
      view={view}
      onView={setView}
      filter={filter}
      header={header}
      journal={listPath === '/list'}
      onOpen={(id, focusField) => {
        const trade = useStore.getState().trades.find((item) => item.id === id)
        const from = { pathname, search, ...getJournalViewState(routeState), anchorTradeId: focusField ? resultRepairAnchor(id) : id }
        rememberTradeReturnAnchor(from)
        navigate(trade ? tradeDetailPath(trade) : `/trade/${id}`, {
          state: tradeDetailNavState(from, { focusField }),
        })
      }}
    />
  )
}
