import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { Topbar } from '@/components/Topbar'
import { MissedOpportunityFilters } from '@/components/trades/MissedOpportunityFilters'
import { MissedOpportunityScopeMenu } from '@/components/trades/MissedOpportunityScopeMenu'
import { MissedOpportunityRow } from '@/components/trades/MissedOpportunityRow'
import { TradeList } from '@/components/trades/TradeList'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import { rememberTradeReturnAnchor, useTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import {
  buildMissedOpportunitySummary,
  filterMissedOpportunityItems,
  MISSED_OPPORTUNITY_SOURCES,
  parseMissedOpportunityFilters,
  type MissedOpportunitySource,
} from '@/lib/missedOpportunities'
import {
  setCapabilityWorkspaceEnabled,
  systemCapabilityWorkspaces,
} from '@/lib/sidebarWorkspace'
import { toast } from '@/lib/toast'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { useStore } from '@/store/useStore'
import { filterStageOwnedRecords } from '@/lib/stageArchive'
import './MissedOpportunitiesView.css'

const EMPTY_SELECTION = new Set<string>()

const SOURCE_LABELS: Record<MissedOpportunitySource, string> = {
  trade: '交易日志',
  paper: '模拟盘',
}

export function MissedOpportunitiesView() {
  const trades = useStore((state) => state.trades)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const strategies = useStore((state) => state.strategies)
  const symbolCatalog = useStore((state) => state.symbolCatalog)
  const sidebarWorkspaceItems = useStore((state) => state.display.sidebarWorkspaceItems)
  const replaceSidebarWorkspaceItems = useStore((state) => state.replaceSidebarWorkspaceItems)
  const businessDateAnchor = useBusinessDateAnchor()
  const [searchParams, setSearchParams] = useSearchParams()
  const listScrollRef = useRef<HTMLDivElement>(null)
  const returnHeadingRef = useRef<HTMLHeadingElement>(null)
  const [returnStatus, setReturnStatus] = useState<string | null>(null)
  const scopeAnnouncementResultKey = useRef<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const handleMissingReturnAnchor = useCallback(() => {
    returnHeadingRef.current?.focus({ preventScroll: true })
    setReturnStatus('原记录已变化，已返回错过的机会列表')
  }, [])
  useTradeReturnAnchor({ onMissing: handleMissingReturnAnchor })
  const existingScope = sidebarWorkspaceItems.find(
    (item) => item.target.kind === 'system' && item.target.id === 'missed',
  )
  const configuredSources = existingScope?.target.kind === 'system'
    ? systemCapabilityWorkspaces(existingScope.target)
    : [...MISSED_OPPORTUNITY_SOURCES]
  const sources = MISSED_OPPORTUNITY_SOURCES.filter((source) => configuredSources.includes(source))
  const missedRecords = useMemo(
    () => [
      ...filterStageOwnedRecords(trades, { kind: 'current', stageId: currentLiveStageId })
        .filter((trade) => trade.tradeKind !== 'case'),
      ...trades.filter((trade) => trade.tradeKind === 'case'),
    ],
    [currentLiveStageId, trades],
  )
  const summary = buildMissedOpportunitySummary(missedRecords, sources)
  const filters = parseMissedOpportunityFilters(searchParams)
  const visibleItems = filterMissedOpportunityItems(summary.items, filters, businessDateAnchor)
  const visibleResultKey = JSON.stringify([
    sources,
    searchParams.toString(),
    visibleItems.map((item) => item.key),
  ])
  useEffect(() => {
    if (scopeAnnouncementResultKey.current === visibleResultKey) {
      scopeAnnouncementResultKey.current = null
      return
    }
    setReturnStatus(null)
  }, [visibleResultKey])
  const itemByPrimaryId = useMemo(
    () => new Map(visibleItems.map((item) => [item.primary.id, item])),
    [visibleItems],
  )

  const openSourceDetail = useCallback((target: (typeof trades)[number], anchorId: string) => {
    const from = {
      pathname: location.pathname,
      search: location.search,
      anchorTradeId: anchorId,
    }
    rememberTradeReturnAnchor(from)
    navigate(tradeDetailPath(target), { state: tradeDetailNavState(from) })
  }, [location.pathname, location.search, navigate])

  const toggleSource = (source: MissedOpportunitySource): boolean => {
    const previous = useStore.getState().display.sidebarWorkspaceItems
    const hasMissedScope = previous.some(
      (item) => item.target.kind === 'system' && item.target.id === 'missed',
    )
    const seeded = hasMissedScope
      ? previous
      : MISSED_OPPORTUNITY_SOURCES.reduce(
          (items, defaultSource) =>
            setCapabilityWorkspaceEnabled(items, 'missed', defaultSource, true),
          previous,
        )
    const next = setCapabilityWorkspaceEnabled(
      seeded,
      'missed',
      source,
      !sources.includes(source),
    )
    if (next === seeded) {
      toast('至少保留一个包含来源')
      return false
    }
    const nextSources = sources.includes(source)
      ? sources.filter((candidate) => candidate !== source)
      : [...sources, source]
    const nextVisibleItems = filterMissedOpportunityItems(
      buildMissedOpportunitySummary(missedRecords, nextSources).items,
      filters,
      businessDateAnchor,
    )
    scopeAnnouncementResultKey.current = JSON.stringify([
      nextSources,
      searchParams.toString(),
      nextVisibleItems.map((item) => item.key),
    ])
    replaceSidebarWorkspaceItems(next)
    setReturnStatus(`已更新包含范围：${nextSources.map((item) => SOURCE_LABELS[item]).join('、')}；当前显示 ${nextVisibleItems.length} 条错过机会`)
    return true
  }

  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true })
  const emptyContent = summary.rawTotal === 0 ? (
    <EmptyState
      className="missed-empty"
      variant="missing"
      title="所选工作区暂无错过记录"
      hint="可以前往已包含的工作区查看或补充原始记录。"
      action={(
        <div className="missed-empty-actions">
          {sources.includes('trade') ? <Link className="ui-btn ui-btn-bordered" to="/list">前往交易日志</Link> : null}
          {sources.includes('paper') ? <Link className="ui-btn ui-btn-bordered" to="/sim">前往模拟盘</Link> : null}
        </div>
      )}
    />
  ) : visibleItems.length === 0 ? (
    <EmptyState
      className="missed-empty"
      variant="filtered"
      title="没有符合当前筛选的机会"
      action={<button type="button" className="ui-btn ui-btn-bordered" onClick={clearFilters}>清除筛选</button>}
    />
  ) : null

  return (
    <>
      <Topbar
        title="错过的机会"
        showDisplay={false}
        showSaveStatus={false}
      />
      <main className="missed-view">
        <MissedOpportunityFilters
          trades={trades}
          symbolCatalog={symbolCatalog}
          resultCount={visibleItems.length}
          headingRef={returnHeadingRef}
          actions={(
            <MissedOpportunityScopeMenu
              sources={sources}
              rawCounts={summary.rawCounts}
              onToggle={toggleSource}
            />
          )}
        />
        <span className="missed-live" aria-live="polite">
          {returnStatus ?? `当前显示 ${visibleItems.length} 条错过机会`}
        </span>

        <section className="missed-content" aria-label="错过机会结果" ref={listScrollRef}>
          {emptyContent ?? (
            <div className="missed-results" data-missed-results aria-label="当前错过机会">
              {summary.rawTotal > summary.aggregateTotal ? (
                <p className="missed-merge-note">跨工作区关联项已合并</p>
              ) : null}
              <TradeList
                groups={[{
                  key: 'missed-opportunities',
                  items: visibleItems.map((item) => item.primary),
                }]}
                strategies={strategies}
                focusedId={null}
                selectedIds={EMPTY_SELECTION}
                starredIds={[]}
                scrollParentRef={listScrollRef}
                selectionEnabled={false}
                overscan={18}
                strategyStageScope={{ kind: 'current', stageId: currentLiveStageId }}
                renderRow={(trade, context) => (
                  <MissedOpportunityRow
                    item={itemByPrimaryId.get(trade.id)!}
                    strategies={strategies}
                    strategyStats={context.strategyStats}
                    focused={context.focused}
                    symbolIcons={context.symbolIcons}
                    ariaPosInSet={context.ariaPosInSet}
                    ariaSetSize={context.ariaSetSize}
                    ariaDescribedBy={context.ariaDescribedBy}
                    onOpen={openSourceDetail}
                  />
                )}
                onOpen={() => undefined}
                onSelect={() => undefined}
                onClearSelection={() => undefined}
                onToggleStar={() => undefined}
                onContextMenu={() => undefined}
                onCreate={() => undefined}
              />
            </div>
          )}
        </section>
      </main>
    </>
  )
}
