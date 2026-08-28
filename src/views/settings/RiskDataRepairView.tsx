import { useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { useTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { useRiskDataIssues } from '@/hooks/useRiskDataIssues'
import { riskDataIssueReasonCopy } from '@/lib/riskUnknownReasonPresentation'
import { buildRiskDataRepairQueue, type RiskRepairGroup, type RiskRepairItem } from '@/lib/riskDataRepair'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { useStore } from '@/store/useStore'
import './RiskDataRepairView.css'

function RepairAction({ item, className, label, isNext = false }: {
  item: RiskRepairItem
  className: string
  label?: string
  isNext?: boolean
}) {
  const location = useLocation()
  const trades = useStore((state) => state.trades)
  if (item.actionKind === 'data-settings') {
    return <Link className={className} {...(isNext ? { 'data-risk-repair-next': true } : {})} to="/settings/data">{label ?? '调整核算起点'}</Link>
  }

  const trade = item.issue.tradeId ? trades.find((candidate) => candidate.id === item.issue.tradeId) : undefined
  if (!trade) return null
  return (
    <Link
      className={className}
      data-trade-primary-action
      {...(isNext ? { 'data-risk-repair-next': true } : {})}
      to={tradeDetailPath(trade)}
      state={tradeDetailNavState({
        pathname: '/settings/risk/data-repair',
        search: location.search,
        restoreSearch: location.search,
        anchorTradeId: trade.id,
      })}
    >
      {label ?? (item.actionKind === 'view-trade' ? '查看交易' : '打开交易')}
    </Link>
  )
}

function RepairRow({ item }: { item: RiskRepairItem }) {
  const trades = useStore((state) => state.trades)
  const trade = item.issue.tradeId ? trades.find((candidate) => candidate.id === item.issue.tradeId) : undefined
  const isGlobal = item.issue.severity === 'global'
  const title = isGlobal ? '全局设置' : trade?.ref ?? item.issue.tradeRef ?? '交易记录'
  const subtitle = isGlobal ? '修正设置后将重新核算当前风险周期。' : trade?.symbol
  const direction = trade ? (trade.side === 'long' ? '做多' : '做空') : null
  const closedDate = trade
    ? item.issue.tradingDayKey ?? trade.closedTradingDayKey ?? trade.closedAt?.slice(0, 10) ?? null
    : null

  return (
    <article className={`risk-repair-row is-${item.issue.severity}`} {...(!isGlobal && trade ? { 'data-trade-id': trade.id } : {})}>
      <div className="risk-repair-row-copy">
        <div className="risk-repair-row-title">
          <strong>{title}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
          {direction ? <span data-risk-repair-direction>{direction}</span> : null}
          {trade ? (
            <span data-risk-repair-close-date>
              {closedDate ? `平仓 ${closedDate}` : trade.closedAt ? '平仓日期无效' : '平仓日期待补'}
            </span>
          ) : null}
          {!isGlobal ? <small>{item.issue.severity === 'blocking' ? '阻断判断' : '影响完整度'}</small> : null}
        </div>
        <p>{item.issue.reasons.map(riskDataIssueReasonCopy).join('；')}</p>
        {item.retained ? (
          <small className="risk-repair-retained-note">历史风险规则不可回填，核对交易事实后仍会如实影响完整度。</small>
        ) : null}
      </div>
      <RepairAction item={item} className="risk-repair-action" />
    </article>
  )
}

function RepairGroup({ group, expanded, onOpen }: {
  group: RiskRepairGroup
  expanded: boolean
  onOpen: (key: string) => void
}) {
  const description = riskDataIssueReasonCopy(group.reason)
  return (
    <section className="risk-repair-group" data-risk-repair-group={group.key} data-expanded={expanded ? 'true' : 'false'}>
      <button
        type="button"
        className="risk-repair-group-toggle"
        aria-expanded={expanded}
        onClick={() => onOpen(group.key)}
      >
        <span>{description}</span>
        <small>{`${group.items.length} 项${group.retained ? ' · 历史风险规则不可回填' : ''}`}</small>
      </button>
      {expanded ? (
        <div className="risk-repair-group-items">
          {group.items.map((item) => <RepairRow key={item.issue.tradeId ?? item.primaryReason} item={item} />)}
        </div>
      ) : null}
    </section>
  )
}

function RepairBucket({ title, description, groups, activeGroup, onOpen }: {
  title: string
  description: string
  groups: RiskRepairGroup[]
  activeGroup: RiskRepairGroup | null
  onOpen: (key: string) => void
}) {
  if (groups.length === 0) return null
  return (
    <section className="settings-page-section risk-repair-bucket">
      <div className="settings-page-head">
        <h2 className="settings-section-title">{title}</h2>
        <p className="settings-section-desc">{description}</p>
      </div>
      <div className="risk-repair-groups">
        {groups.map((group) => (
          <RepairGroup key={group.key} group={group} expanded={activeGroup?.key === group.key} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

export function RiskDataRepairView() {
  const today = useLocalDateKey()
  const issues = useRiskDataIssues(today)
  const queue = useMemo(() => buildRiskDataRepairQueue(issues), [issues])
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedGroup = searchParams.get('group')
  const defaultGroup = queue.groups.find((group) => !group.retained) ?? queue.groups[0] ?? null
  const activeGroup = queue.groups.find((group) => group.key === requestedGroup) ?? defaultGroup
  useTradeReturnAnchor({
    resolveRestoreSearch: (tradeId, restoreSearch) => {
      const currentGroup = queue.groups.find((group) => (
        group.items.some((item) => item.issue.tradeId === tradeId)
      ))
      if (!currentGroup) return restoreSearch
      const next = new URLSearchParams(restoreSearch ?? '')
      next.set('group', currentGroup.key)
      return `?${next.toString()}`
    },
    onMissing: () => {
      const nextAction = document.querySelector<HTMLElement>('[data-risk-repair-next]')
      const heading = document.querySelector<HTMLElement>('[data-risk-data-repair-view] h1')
      ;(nextAction ?? heading)?.focus({ preventScroll: true })
    },
  })

  function openGroup(key: string) {
    const next = new URLSearchParams(searchParams)
    next.set('group', key)
    setSearchParams(next, { replace: true })
  }

  const priorityGroups = queue.groups.filter((group) => group.bucket === 'priority')
  const completenessGroups = queue.groups.filter((group) => group.bucket === 'completeness')

  return (
    <div className="settings-page settings-page--reading risk-data-repair-view" data-risk-data-repair-view>
      <div className="settings-page-head risk-repair-hero">
        <div>
          <Link className="risk-repair-back" to="/settings/risk">返回风险管理</Link>
          <h1 className="settings-page-title" tabIndex={-1}>风险数据修复中心</h1>
          <p className="settings-page-desc">集中处理影响风险判断与完整度的数据缺口；历史规则缺口会持续如实反映。</p>
          <div className="risk-repair-counts" data-risk-repair-counts aria-label="风险数据缺口摘要">
            <span>问题总数 {queue.counts.total}</span>
            <span>阻断判断 {queue.counts.blocking}</span>
            <span>影响完整度 {queue.counts.partial}</span>
          </div>
        </div>
        {queue.nextItem ? (
          <RepairAction
            item={queue.nextItem}
            className="risk-repair-action risk-repair-next"
            label={queue.nextItem.actionKind === 'data-settings' ? '调整核算起点' : '处理下一项'}
            isNext
          />
        ) : null}
      </div>

      {queue.retainedOnly ? (
        <p className="risk-repair-retained-conclusion" role="status">
          没有可直接修复的问题，仍有历史规则缺口影响完整度
        </p>
      ) : null}

      {queue.groups.length === 0 ? (
        <div className="risk-repair-complete">
          <strong>当前风险周期数据完整</strong>
          <span>暂无需要修复的数据缺口</span>
        </div>
      ) : (
        <>
          <RepairBucket
            title="优先处理"
            description="这些问题会阻断风险判断，或需要先调整全局核算设置。"
            groups={priorityGroups}
            activeGroup={activeGroup}
            onOpen={openGroup}
          />
          <RepairBucket
            title="补全数据"
            description="这些问题不阻断判断，但会持续影响风险数据完整度。"
            groups={completenessGroups}
            activeGroup={activeGroup}
            onOpen={openGroup}
          />
        </>
      )}
    </div>
  )
}
