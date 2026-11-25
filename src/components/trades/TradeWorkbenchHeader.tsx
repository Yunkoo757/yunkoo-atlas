import { useMemo, useRef, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DisplayMenu, type JournalMenuAction } from '@/components/DisplayMenu'
import { ResultConflictRepair } from '@/components/ResultConflictRepair'
import { Topbar, WorkbenchViewSwitch, type WorkbenchView } from '@/components/Topbar'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { useResultRepairReturn } from '@/hooks/useResultRepairReturn'
import { filterStageTrades } from '@/lib/stageArchive'
import type { ListFilter } from '@/lib/tradeFilters'
import { collectWorkbenchResultRepairIds } from '@/lib/workbenchResultHealth'
import { useStore } from '@/store/useStore'
import { isElectron } from '@/storage'
import { TradeWorkspaceContext } from '@/components/TradeWorkspaceContext'
import { TradeFilters } from './TradeFilters'

type Props = {
  journal: boolean
  title: string
  view: WorkbenchView
  onView: (view: WorkbenchView) => void
  header?: ReactNode
  filter: ListFilter
  trades: Trade[]
  strategies: Strategy[]
  onOpenResult: (id: string) => void
  showFilters: boolean
}

export function TradeWorkbenchHeader({
  journal, title, view, onView, header, filter, trades, strategies, onOpenResult, showFilters,
}: Props) {
  const repairEntry = useResultRepairReturn()
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const storedTrades = useStore(state => state.trades)
  const pendingCount = useMemo(
    () => filter.tradeKind === 'live' && (journal || view === 'list')
      ? filterStageTrades(storedTrades, { kind: 'pending' }).length
      : 0,
    [filter.tradeKind, journal, storedTrades, view],
  )
  const resultRepairIds = useMemo(() => collectWorkbenchResultRepairIds(trades), [trades])
  const journalActions: JournalMenuAction[] = []
  if (journal && isElectron() && resultRepairIds.length > 0) journalActions.push({
    label: '核对交易结果', count: `${resultRepairIds.length} 笔`, opensDialog: true,
    onSelect: () => repairEntry.current?.reopen(),
  })
  if (journal && pendingCount > 0) journalActions.push({
    label: '处理待归属记录', count: `${pendingCount} 条`,
    onSelect: () => navigate('/settings/data/stage-ownership-repair'),
  })

  const notices = !journal && (pendingCount > 0 || resultRepairIds.length > 0) && (
    <div className="list-pending-entry">
      {pendingCount > 0 && (
        <Link data-pending-log-link className="list-pending-link" to="/settings/data/stage-ownership-repair"
          aria-label={`修复待归属记录，共 ${pendingCount} 条`}>
          {pendingCount} 条待归属
        </Link>
      )}
      {resultRepairIds.length > 0 && (
        <ResultConflictRepair ref={repairEntry} showCount ids={resultRepairIds} onOpenTrade={onOpenResult} />
      )}
    </div>
  )

  return <>
    {!journal && <Topbar title={title} view={view} onView={onView}>{notices}</Topbar>}
    {journal && <ResultConflictRepair ref={repairEntry} menuTrigger={menuTrigger} ids={resultRepairIds} onOpenTrade={onOpenResult} />}
    {header}
    {(journal || showFilters) && (
      <TradeFilters filter={filter} trades={trades} strategies={strategies} journal={journal}
        actions={journal && <TradeWorkspaceContext page="log" compact />}
        trailingActions={journal && <>
          <WorkbenchViewSwitch view={view} onView={onView} />
          <DisplayMenu view={view} showHideClosed={false} journalActions={journalActions} menuTrigger={menuTrigger} />
        </>}
      />
    )}
  </>
}
