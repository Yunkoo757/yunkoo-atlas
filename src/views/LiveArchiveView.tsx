import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Topbar } from '@/components/Topbar'
import type { ReviewCaseScope } from '@/lib/tradeFilters'
import { pathWithWorkbenchMode, workbenchModeFromPathname } from '@/lib/routeContext'
import {
  buildStageArchiveSummary,
  matchesStageScope,
  resolveStageScope,
  type StageScope,
} from '@/lib/stageArchive'
import type { LiveStage } from '@/lib/liveStages'
import { useStore } from '@/store/useStore'
import { TradesPage } from '@/views/TradesPage'
import './LiveArchiveView.css'

const REVIEW_CASE_SCOPES: ReviewCaseScope[] = ['all', 'focus', 'mistakes', 'unreviewed', 'reviewed']
const ARCHIVE_TABS = ['overview', 'live', 'cases', 'weekly', 'risk'] as const
type ArchiveTab = (typeof ARCHIVE_TABS)[number]

const TAB_LABELS: Record<ArchiveTab, string> = {
  overview: '概览',
  live: '实盘记录',
  cases: '关联案例',
  weekly: '周复盘',
  risk: '风险记录',
}

function selectedStageKey(scope: StageScope): string {
  return scope.kind === 'stage' ? scope.stageId : 'all-history'
}

function ArchiveNavigation({
  stages,
  selectedKey,
  tab,
  onStage,
  onTab,
  notice,
}: {
  stages: readonly LiveStage[]
  selectedKey: string
  tab: ArchiveTab
  onStage: (stageId: string) => void
  onTab: (tab: ArchiveTab) => void
  notice: string | null
}) {
  const archived = [...stages]
    .filter((stage) => stage.status === 'archived')
    .sort((left, right) => right.sequence - left.sequence)
  return (
    <div className="live-archive-navigation">
      {notice ? <div className="list-context-notice" role="status" aria-live="polite">{notice}</div> : null}
      <nav className="live-archive-stage-rail" aria-label="历史实盘阶段">
        <button
          type="button"
          className={selectedKey === 'all-history' ? 'is-active' : ''}
          aria-pressed={selectedKey === 'all-history'}
          data-live-stage-id="all-history"
          onClick={() => onStage('all-history')}
        >
          全部历史
        </button>
        {archived.map((stage) => (
          <button
            key={stage.id}
            type="button"
            className={selectedKey === stage.id ? 'is-active' : ''}
            aria-pressed={selectedKey === stage.id}
            data-live-stage-id={stage.id}
            onClick={() => onStage(stage.id)}
          >
            <span>{stage.name}</span>
            <small>{stage.startsOn} — {stage.endsOn}</small>
          </button>
        ))}
      </nav>
      <div className="live-archive-tab-list" role="tablist" aria-label="历史阶段内容">
        {ARCHIVE_TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? 'is-active' : ''}
            data-live-archive-tab={item}
            onClick={() => onTab(item)}
          >
            {TAB_LABELS[item]}
          </button>
        ))}
      </div>
    </div>
  )
}

function ArchiveOverview({ scope }: { scope: StageScope }) {
  const trades = useStore((state) => state.trades)
  const summary = useMemo(() => buildStageArchiveSummary(trades, scope), [scope, trades])
  const evaluated = summary.winCount + summary.lossCount + summary.breakevenCount
  const winRate = evaluated === 0 ? null : summary.winCount / evaluated * 100
  return (
    <section className="live-archive-panel" aria-label="历史阶段概览">
      <header><span>按当前已编辑历史事实实时重算</span><h2>阶段概览</h2></header>
      <div className="live-archive-summary-grid">
        <div><span>实盘记录</span><strong>{summary.tradeCount}</strong><small>{summary.closedCount} 笔已平仓</small></div>
        <div><span>净盈亏</span><strong>{summary.pnlCount ? `$${summary.totalPnl.toFixed(0)}` : '—'}</strong><small>{summary.pnlCount}/{summary.closedCount} 笔含盈亏</small></div>
        <div><span>胜率</span><strong>{winRate === null ? '—' : `${winRate.toFixed(0)}%`}</strong><small>{summary.winCount} 赢 · {summary.lossCount} 亏</small></div>
        <div><span>平均 R</span><strong>{summary.averageR === null ? '—' : summary.averageR.toFixed(2)}</strong><small>{summary.rCount}/{summary.closedCount} 笔含 R</small></div>
        <div><span>关联案例</span><strong>{summary.caseCount}</strong><small>按案例 stage 归属</small></div>
      </div>
    </section>
  )
}

function ArchiveWeekly({ scope }: { scope: StageScope }) {
  const reviews = useStore((state) => state.weeklyReviews)
  const scoped = useMemo(
    () => reviews
      .filter((review) => matchesStageScope(review, scope))
      .sort((left, right) => right.weekStart.localeCompare(left.weekStart)),
    [reviews, scope],
  )
  return (
    <section className="live-archive-panel" aria-label="历史周复盘">
      <header><span>完成时快照，不随交易编辑改写</span><h2>周复盘</h2></header>
      {scoped.length === 0 ? <p className="live-archive-empty">所选历史范围暂无周复盘。</p> : (
        <div className="live-archive-card-list">
          {scoped.map((review) => {
            const metrics = review.metricsSnapshot
            return (
              <article key={review.id} data-weekly-source={metrics ? 'snapshot' : 'unavailable'}>
                <div><strong>{review.weekStart} — {review.weekEnd}</strong><span>{review.status === 'completed' ? '已完成' : '草稿'}</span></div>
                {metrics ? (
                  <p>{metrics.tradeCount} 笔 · 胜率 {metrics.winRate === null ? '—' : `${metrics.winRate.toFixed(0)}%`} · 净盈亏 {metrics.pnlCount ? `$${metrics.totalPnl.toFixed(0)}` : '—'} · 平均 R {metrics.averageR?.toFixed(2) ?? '—'}</p>
                ) : <p>该复盘没有冻结指标快照。</p>}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ArchiveRisk({ scope }: { scope: StageScope }) {
  const preparations = useStore((state) => state.weeklyRiskPreparations)
  const policies = useStore((state) => state.riskPolicyVersions)
  const limits = useStore((state) => state.monthlyRiskLimits)
  const overrides = useStore((state) => state.riskOverrideEvents)
  const counts = [
    ['周准备', preparations.filter((item) => matchesStageScope(item, scope)).length],
    ['策略版本', policies.filter((item) => matchesStageScope(item, scope)).length],
    ['月度限额', limits.filter((item) => matchesStageScope(item, scope)).length],
    ['覆盖事件', overrides.filter((item) => matchesStageScope(item, scope)).length],
  ] as const
  return (
    <section className="live-archive-panel" aria-label="历史风险记录">
      <header><span>按 stage ID 读取归档风险事实</span><h2>风险记录</h2></header>
      <div className="live-archive-summary-grid is-risk">
        {counts.map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong><small>条记录</small></div>)}
      </div>
    </section>
  )
}

export function LiveArchiveView() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const requestedTab = searchParams.get('tab')
  const legacyCases = searchParams.get('view') === 'cases'
  const tab: ArchiveTab = ARCHIVE_TABS.includes(requestedTab as ArchiveTab)
    ? requestedTab as ArchiveTab
    : legacyCases ? 'cases' : 'overview'
  const scope = useMemo(
    () => resolveStageScope(searchParams.get('liveStage'), liveStages, currentLiveStageId, 'history'),
    [currentLiveStageId, liveStages, searchParams],
  )
  const selectedKey = selectedStageKey(scope)
  const requestedScope = searchParams.get('caseScope') as ReviewCaseScope | null
  const reviewCaseScope = requestedScope && REVIEW_CASE_SCOPES.includes(requestedScope) ? requestedScope : 'all'

  useEffect(() => {
    if (!location.pathname.startsWith('/live-archive')) return
    const requestedKey = location.pathname.split('/')[2]
    const next = new URLSearchParams(location.search)
    if (requestedKey) {
      next.set('archiveReason', 'missing')
      next.set('requestedKey', requestedKey)
    }
    navigate({ pathname: '/live-history', search: next.toString() }, { replace: true })
  }, [location.pathname, location.search, navigate])

  useEffect(() => {
    if (!location.pathname.startsWith('/live-history')) return
    const next = new URLSearchParams(location.search)
    let changed = false
    if (next.get('liveStage') !== selectedKey) {
      next.set('liveStage', selectedKey)
      changed = true
    }
    if (next.get('tab') !== tab) {
      next.set('tab', tab)
      changed = true
    }
    if (next.has('view')) {
      next.delete('view')
      changed = true
    }
    if (changed) navigate({ pathname: location.pathname, search: next.toString() }, { replace: true })
  }, [location.pathname, location.search, navigate, selectedKey, tab])

  const requestedKey = searchParams.get('requestedKey')
  const routeNotice = searchParams.get('archiveReason') === 'missing' && requestedKey
    ? `原历史范围“${requestedKey}”已合并到历史实盘。`
    : null
  const setStage = (stageId: string) => {
    const next = new URLSearchParams(location.search)
    next.set('liveStage', stageId)
    navigate({ pathname: location.pathname, search: next.toString() })
  }
  const setTab = (nextTab: ArchiveTab) => {
    const next = new URLSearchParams(location.search)
    next.set('tab', nextTab)
    next.delete('view')
    navigate({ pathname: location.pathname, search: next.toString() })
  }
  const navigation = (
    <ArchiveNavigation
      stages={liveStages}
      selectedKey={selectedKey}
      tab={tab}
      onStage={setStage}
      onTab={setTab}
      notice={routeNotice}
    />
  )

  if (tab === 'live' || tab === 'cases') {
    return (
      <TradesPage
        title="历史实盘"
        listPath="/live-history"
        filter={tab === 'cases'
          ? { type: 'all', tradeKind: 'case', reviewCaseScope, historicalLiveScope: 'cases' }
          : { type: 'all', tradeKind: 'live', historicalLiveScope: 'trades' }}
        header={navigation}
      />
    )
  }

  const mode = workbenchModeFromPathname(location.pathname)
  const setMode = (nextMode: 'list' | 'board') => navigate({
    pathname: pathWithWorkbenchMode('/live-history', nextMode),
    search: location.search,
  })
  return (
    <>
      <Topbar title="历史实盘" subtitle="按明确阶段浏览归档事实" view={mode} onView={setMode} />
      {navigation}
      <div className="live-archive-scroll">
        {tab === 'overview' ? <ArchiveOverview scope={scope} /> : null}
        {tab === 'weekly' ? <ArchiveWeekly scope={scope} /> : null}
        {tab === 'risk' ? <ArchiveRisk scope={scope} /> : null}
      </div>
    </>
  )
}
