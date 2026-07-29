import { useCallback, useMemo, useRef } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Topbar } from '@/components/Topbar'
import { MissedOpportunityFilters } from '@/components/trades/MissedOpportunityFilters'
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
import './MissedOpportunitiesView.css'

const EMPTY_SELECTION = new Set<string>()

const SOURCE_LABELS: Record<MissedOpportunitySource, string> = {
  trade: '交易日志',
  paper: '模拟盘',
  case: '案例记录',
}

export function MissedOpportunitiesView() {
  const trades = useStore((state) => state.trades)
  const strategies = useStore((state) => state.strategies)
  const symbolCatalog = useStore((state) => state.symbolCatalog)
  const sidebarWorkspaceItems = useStore((state) => state.display.sidebarWorkspaceItems)
  const replaceSidebarWorkspaceItems = useStore((state) => state.replaceSidebarWorkspaceItems)
  const businessDateAnchor = useBusinessDateAnchor()
  const [searchParams, setSearchParams] = useSearchParams()
  const listScrollRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  useTradeReturnAnchor()
  const existingScope = sidebarWorkspaceItems.find(
    (item) => item.target.kind === 'system' && item.target.id === 'missed',
  )
  const sources: MissedOpportunitySource[] = existingScope?.target.kind === 'system'
    ? systemCapabilityWorkspaces(existingScope.target)
    : [...MISSED_OPPORTUNITY_SOURCES]
  const summary = buildMissedOpportunitySummary(trades, sources)
  const filters = parseMissedOpportunityFilters(searchParams)
  const visibleItems = filterMissedOpportunityItems(summary.items, filters, businessDateAnchor)
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

  const toggleSource = (source: MissedOpportunitySource) => {
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
      return
    }
    replaceSidebarWorkspaceItems(next)
  }

  const clearFilters = () => setSearchParams(new URLSearchParams(), { replace: true })

  return (
    <>
      <Topbar
        title="错过的机会"
        subtitle="来自你选择的工作区"
        showDisplay={false}
      />
      <main className="missed-view">
        <section className="missed-scope" data-missed-scope={sources.join(',')} aria-labelledby="missed-scope-title">
          <div className="missed-scope-heading">
            <div>
              <h2 id="missed-scope-title">管理包含范围</h2>
              <p>选择哪些工作区长期汇总到这里；当前临时筛选会保留。</p>
            </div>
            <div className="missed-total" data-missed-total={visibleItems.length}>
              <strong>{visibleItems.length}</strong>
              <span>条去重机会</span>
            </div>
          </div>
          <div className="missed-scope-actions" role="group" aria-label="错过机会包含范围">
            {MISSED_OPPORTUNITY_SOURCES.map((source) => (
              <button
                type="button"
                key={source}
                aria-pressed={sources.includes(source)}
                onClick={() => toggleSource(source)}
              >
                {SOURCE_LABELS[source]} {summary.rawCounts[source]}
              </button>
            ))}
          </div>
          {summary.rawTotal > summary.aggregateTotal ? (
            <p className="missed-merge-note">跨工作区关联项已合并</p>
          ) : null}
          <span className="missed-live" aria-live="polite">
            当前显示 {visibleItems.length} 条错过机会
          </span>
        </section>

        <MissedOpportunityFilters trades={trades} symbolCatalog={symbolCatalog} />

        <section className="missed-content" aria-label="错过机会结果" ref={listScrollRef}>
          {summary.rawTotal === 0 ? (
            <div className="missed-empty">
              <h2>所选来源暂无错过记录</h2>
              <p>可以前往当前包含的工作区查看或补充原始记录。</p>
              <ul>
                {sources.includes('trade') ? (
                  <li>交易日志中暂无错过记录。<Link to="/list">前往交易日志</Link></li>
                ) : null}
                {sources.includes('paper') ? (
                  <li>模拟盘中暂无错过记录。<Link to="/sim">前往模拟盘</Link></li>
                ) : null}
                {sources.includes('case') ? (
                  <li>案例记录中暂无错过记录。<Link to="/review-cases">前往案例记录</Link></li>
                ) : null}
              </ul>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="missed-empty">
              <h2>当前筛选下没有记录</h2>
              <button type="button" onClick={clearFilters}>清除筛选</button>
            </div>
          ) : (
            <div className="missed-results" data-missed-results aria-label="当前错过机会">
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
                renderRow={(trade, context) => (
                  <MissedOpportunityRow
                    item={itemByPrimaryId.get(trade.id)!}
                    strategies={strategies}
                    focused={context.focused}
                    symbolIcons={context.symbolIcons}
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
