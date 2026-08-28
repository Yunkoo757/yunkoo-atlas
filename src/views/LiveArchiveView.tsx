import { useEffect, useMemo, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Topbar } from '@/components/Topbar'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import { describeDashboardResultHealth } from '@/lib/dashboardStats'
import { fmtMoney } from '@/lib/format'
import { PERFORMANCE_REPORT_CURRENCY } from '@/lib/performanceSelection'
import type { ReviewCaseScope } from '@/lib/tradeFilters'
import { pathWithWorkbenchMode, workbenchModeFromPathname } from '@/lib/routeContext'
import {
  buildStageArchiveOverview,
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
      <div
        className="live-archive-tab-list"
        role="tablist"
        aria-label="历史阶段内容"
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          const current = ARCHIVE_TABS.indexOf(tab)
          const offset = event.key === 'ArrowRight' ? 1 : -1
          const next = ARCHIVE_TABS[(current + offset + ARCHIVE_TABS.length) % ARCHIVE_TABS.length]
          onTab(next)
          requestAnimationFrame(() => document.getElementById(`live-archive-tab-${next}`)?.focus())
        }}
      >
        {ARCHIVE_TABS.map((item) => (
          <button
            key={item}
            id={`live-archive-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls={`live-archive-panel-${item}`}
            tabIndex={tab === item ? 0 : -1}
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
  const strategies = useStore((state) => state.strategies)
  const legacyCashCurrencyAssumption = useStore((state) => state.profile.legacyCashCurrencyAssumption)
  const privacyMode = useStore((state) => state.display.privacyMode)
  const anchor = useBusinessDateAnchor()
  const overview = useMemo(() => buildStageArchiveOverview({
    trades,
    strategies,
    stageScope: scope,
    anchor,
    legacyCashCurrencyAssumption,
  }), [anchor, legacyCashCurrencyAssumption, scope, strategies, trades])
  const { summary, performance, stats, strategyStats } = overview
  const excludedCurrencyLabel = [
    ...performance.excludedCurrencyCounts.map(({ currency, count }) => `${currency} ${count} 笔`),
    ...(performance.excludedUnknownCount > 0 ? [`未知币种 ${performance.excludedUnknownCount} 笔`] : []),
  ].join(' · ')
  const cashFactCount = performance.usdCoveredCount
    + performance.excludedCurrencyCounts.reduce((total, item) => total + item.count, 0)
    + performance.excludedUnknownCount
  const closeDayIssueCount = performance.missingCloseDayIds.length
    + performance.invalidCloseDayIds.length
    + performance.futureCloseDayIds.length
  return (
    <section className="live-archive-panel" aria-label="历史阶段概览">
      <header><span>按当前已编辑历史事实实时重算</span><h2>阶段概览</h2></header>
      <div className="live-archive-summary-grid">
        <div><span>实盘记录</span><strong>{summary.tradeCount}</strong><small>{summary.closedCount} 笔已平仓</small></div>
        <div><span>USD 净盈亏</span><strong data-archive-total-pnl>{stats.pnlCount ? fmtMoney(stats.totalPnl, PERFORMANCE_REPORT_CURRENCY, privacyMode) : '—'}</strong><small>{stats.pnlCount}/{summary.closedCount} 笔含 USD 盈亏</small></div>
        <div><span>胜率</span><strong>{stats.winRate === null ? '—' : `${stats.winRate.toFixed(0)}%`}</strong><small>{stats.winCount} 赢 · {stats.lossCount} 亏</small></div>
        <div><span>平均 R</span><strong>{stats.averageR === null ? '—' : stats.averageR.toFixed(2)}</strong><small>{stats.rCount}/{summary.closedCount} 笔含 R</small></div>
        <div><span>关联案例</span><strong>{summary.caseCount}</strong><small>按案例 stage 归属</small></div>
      </div>
      {summary.closedCount > 0 ? (
        <div className="live-archive-integrity" data-archive-result-health>
          <div><strong>数据完整度</strong><span>盈亏 {stats.pnlCount}/{summary.closedCount} · R {stats.rCount}/{summary.closedCount}</span></div>
          <span>{describeDashboardResultHealth({ conflictCount: performance.conflictResultIds.length, missingResultCount: performance.missingResultIds.length })}</span>
        </div>
      ) : null}
      {cashFactCount > 0 ? (
        <div className="live-archive-integrity" data-currency-merge-status={performance.currencyMergeStatus}>
          <div><strong>USD 现金汇总</strong><span>USD 覆盖 {performance.usdCoveredCount}/{cashFactCount} 笔</span></div>
          <span>{performance.currencyMergeStatus === 'usd-only'
            ? '仅合并 USD'
            : performance.currencyMergeStatus === 'no-usd-data'
              ? `暂无 USD 现金数据${excludedCurrencyLabel ? ` · 已排除 ${excludedCurrencyLabel}` : ''}`
              : `仅合并 USD · 已排除 ${excludedCurrencyLabel}`}</span>
        </div>
      ) : null}
      {closeDayIssueCount > 0 ? (
        <div className="live-archive-integrity has-conflict" data-archive-close-day-health>
          <strong>统计日期完整度</strong>
          <span>{closeDayIssueCount} 笔缺少、无效或晚于当前交易日的平仓日期，未计入表现指标</span>
        </div>
      ) : null}
      <div className="live-archive-breakdown">
        <h3>策略表现</h3>
        {strategyStats.length === 0 ? <p className="live-archive-empty">所选历史范围暂无可统计策略。</p> : (
          <div className="live-archive-card-list">
            {strategyStats.map((strategy) => (
              <article key={strategy.id} data-archive-strategy-id={strategy.id}>
                <div><strong>{strategy.name}</strong><span>{strategy.n}/{strategy.closedCount} 笔结果有效</span></div>
                <p>胜率 {strategy.winRate === null ? '—' : `${strategy.winRate.toFixed(0)}%`} · USD 盈亏 {strategy.pnlCount ? fmtMoney(strategy.totalPnl, PERFORMANCE_REPORT_CURRENCY, privacyMode) : '—'} · 平均 R {strategy.averageR?.toFixed(2) ?? '—'}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ArchiveWeekly({ scope }: { scope: StageScope }) {
  const reviews = useStore((state) => state.weeklyReviews)
  const privacyMode = useStore((state) => state.display.privacyMode)
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
                  <p>{metrics.tradeCount} 笔 · 胜率 {metrics.winRate === null ? '—' : `${metrics.winRate.toFixed(0)}%`} · USD 净盈亏 {metrics.pnlCount ? fmtMoney(metrics.totalPnl, PERFORMANCE_REPORT_CURRENCY, privacyMode) : '—'} · 平均 R {metrics.averageR?.toFixed(2) ?? '—'}</p>
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
  const privacyMode = useStore((state) => state.display.privacyMode)
  const scopedPreparations = preparations.filter((item) => matchesStageScope(item, scope)).sort((left, right) => right.weekStart.localeCompare(left.weekStart))
  const scopedPolicies = policies.filter((item) => matchesStageScope(item, scope)).sort((left, right) => right.effectiveTradingDay.localeCompare(left.effectiveTradingDay))
  const scopedLimits = limits.filter((item) => matchesStageScope(item, scope)).sort((left, right) => right.monthKey.localeCompare(left.monthKey))
  const scopedOverrides = overrides.filter((item) => matchesStageScope(item, scope)).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const counts = [['周准备', scopedPreparations.length], ['策略版本', scopedPolicies.length], ['月度限额', scopedLimits.length], ['覆盖事件', scopedOverrides.length]] as const
  const empty = counts.every(([, count]) => count === 0)
  return (
    <section className="live-archive-panel" aria-label="历史风险记录">
      <header><span>按 stage ID 读取归档风险事实</span><h2>风险记录</h2></header>
      <div className="live-archive-summary-grid is-risk">
        {counts.map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong><small>条记录</small></div>)}
      </div>
      {empty ? <p className="live-archive-empty">所选历史范围暂无风险记录。</p> : (
        <div className="live-archive-risk-sections">
          {scopedPreparations.length > 0 ? <section><h3>周准备</h3><div className="live-archive-card-list">{scopedPreparations.map((item) => (
            <article key={item.id} data-risk-preparation-id={item.id}>
              <div><strong>{item.weekStart}</strong><span>{item.reviewedAt ? '已复核' : '草稿'}</span></div>
              <p>本金 {fmtMoney(item.draft.capitalBase, PERFORMANCE_REPORT_CURRENCY, privacyMode)} · 单笔风险 {fmtMoney(item.draft.riskAmount, PERFORMANCE_REPORT_CURRENCY, privacyMode)} · 周上限 {item.draft.weeklyLossLimitR}R</p>
              <p>{item.draft.disciplineText || '未填写风险纪律'}</p>
            </article>
          ))}</div></section> : null}
          {scopedPolicies.length > 0 ? <section><h3>策略版本</h3><div className="live-archive-card-list">{scopedPolicies.map((item) => (
            <article key={item.id} data-risk-policy-id={item.id}>
              <div><strong>{item.effectiveTradingDay}</strong><span>风险 {item.riskPercent}%</span></div>
              <p>本金 {fmtMoney(item.capitalBase, PERFORMANCE_REPORT_CURRENCY, privacyMode)} · 单笔风险 {fmtMoney(item.riskAmount, PERFORMANCE_REPORT_CURRENCY, privacyMode)} · 日/周/月 {item.dailyLossLimitR}R / {item.weeklyLossLimitR}R / {item.monthlyLossLimitRDefault}R</p>
              <p>{item.disciplineText || '未填写风险纪律'}</p>
            </article>
          ))}</div></section> : null}
          {scopedLimits.length > 0 ? <section><h3>月度限额</h3><div className="live-archive-card-list">{scopedLimits.map((item) => (
            <article key={item.id} data-risk-limit-id={item.id}>
              <div><strong>{item.monthKey}</strong><span>{item.limitR}R</span></div>
              <p>来源策略版本 {item.sourcePolicyVersionId}</p>
            </article>
          ))}</div></section> : null}
          {scopedOverrides.length > 0 ? <section><h3>覆盖事件</h3><div className="live-archive-card-list">{scopedOverrides.map((item) => (
            <article key={item.id} data-risk-override-id={item.id}>
              <div><strong>{item.tradeIdentityAtDecision.ref} · {item.tradeIdentityAtDecision.symbol}</strong><span>{item.decisionType === 'triggered' ? '已触发' : '数据未知'}</span></div>
              <p>{item.tradingDayKeyAtDecision} · {item.reason || '未填写理由'}</p>
            </article>
          ))}</div></section> : null}
        </div>
      )}
    </section>
  )
}

export function LiveArchiveView({ header }: { header?: ReactNode } = {}) {
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
      <div id={`live-archive-panel-${tab}`} role="tabpanel" aria-labelledby={`live-archive-tab-${tab}`}>
        <TradesPage
          title="历史实盘"
          listPath="/live-history"
          filter={tab === 'cases'
            ? { type: 'all', tradeKind: 'case', reviewCaseScope, historicalLiveScope: 'cases' }
            : { type: 'all', tradeKind: 'live', historicalLiveScope: 'trades' }}
          header={navigation}
        />
      </div>
    )
  }

  const mode = workbenchModeFromPathname(location.pathname)
  const setMode = (nextMode: 'list' | 'board') => navigate({
    pathname: pathWithWorkbenchMode('/live-history', nextMode),
    search: location.search,
  })
  return (
    <>
      <Topbar title="历史实盘" view={mode} onView={setMode} />
      {header}
      {navigation}
      <div id={`live-archive-panel-${tab}`} role="tabpanel" aria-labelledby={`live-archive-tab-${tab}`} className="live-archive-scroll">
        {tab === 'overview' ? <ArchiveOverview scope={scope} /> : null}
        {tab === 'weekly' ? <ArchiveWeekly scope={scope} /> : null}
        {tab === 'risk' ? <ArchiveRisk scope={scope} /> : null}
      </div>
    </>
  )
}
