import { useMemo, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { DisplayMenu, type WorkbenchMenuAction } from '@/components/DisplayMenu'
import { ResultConflictRepair } from '@/components/ResultConflictRepair'
import { WorkbenchViewSwitch, type WorkbenchView } from '@/components/Topbar'
import type { Strategy } from '@/data/strategies'
import type { Trade } from '@/data/trades'
import { useResultRepairReturn } from '@/hooks/useResultRepairReturn'
import { filterStageTrades } from '@/lib/stageArchive'
import type { ListFilter } from '@/lib/tradeFilters'
import { collectWorkbenchResultRepairIds } from '@/lib/workbenchResultHealth'
import { useStore } from '@/store/useStore'
import { getDesktopPlatform, isElectron } from '@/storage/runtime'
import { Toolbar } from '@/components/ui/Toolbar'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
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
}

export function TradeWorkbenchHeader({
  journal, title, view, onView, header, filter, trades, strategies, onOpenResult,
}: Props) {
  const repairEntry = useResultRepairReturn()
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const navigate = useNavigate()
  const storedTrades = useStore(state => state.trades)
  const pendingCount = useMemo(
    () => filter.tradeKind === 'live'
      ? filterStageTrades(storedTrades, { kind: 'pending' }).length
      : 0,
    [filter.tradeKind, storedTrades],
  )
  const resultRepairIds = useMemo(() => collectWorkbenchResultRepairIds(trades), [trades])
  const actions: WorkbenchMenuAction[] = []
  if (isElectron() && resultRepairIds.length > 0) actions.push({
    label: '核对交易结果', count: `${resultRepairIds.length} 笔`, opensDialog: true,
    onSelect: () => repairEntry.current?.reopen(),
  })
  if (pendingCount > 0) actions.push({
    label: '处理待归属记录', count: `${pendingCount} 条`,
    onSelect: () => navigate('/settings/data/stage-ownership-repair'),
  })

  return <>
    {!getDesktopPlatform() && <Toolbar title={title} actions={<SaveStatusIndicator />} />}
    {filter.tradeKind !== 'case' && <ResultConflictRepair ref={repairEntry} menuTrigger={menuTrigger} ids={resultRepairIds} onOpenTrade={onOpenResult} />}
    {header}
    <TradeFilters filter={filter} trades={trades} strategies={strategies} journal={journal}
      actions={journal && <TradeWorkspaceContext page="log" compact />}
      trailingActions={<>
        <WorkbenchViewSwitch view={view} onView={onView} />
        <DisplayMenu view={view} showHideClosed={false} actions={actions} menuTrigger={menuTrigger}
          label={journal ? '日志选项' : filter.tradeKind === 'case' ? '案例库选项' : '视图显示选项'} />
      </>}
    />
  </>
}
