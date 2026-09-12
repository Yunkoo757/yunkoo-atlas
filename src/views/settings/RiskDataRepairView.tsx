import { HistoricalRiskBackfillPanel } from './HistoricalRiskBackfillPanel'
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
        {!item.retained ? <p>{item.issue.reasons.map(riskDataIssueReasonCopy).join('；')}</p> : null}
        {item.retained ? (
          <small className="risk-repair-retained-note">核对平仓日期；当时已有明确规则的，可通过上方入口补录。</small>
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
        <span>{description}{group.retained ? (group.bucket === 'priority' ? ' · 影响风险判断' : ' · 影响统计完整度') : ''}</span>
        <small>{group.items.length} 项</small>
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
        {description ? <p className="settings-section-desc">{description}</p> : null}
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
  const activeGroup = queue.groups.find((group) => group.key === requestedGroup) ?? null
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
    if (activeGroup?.key === key) next.delete('group')
    else next.set('group', key)
    setSearchParams(next, { replace: true })
  }

  const priorityGroups = queue.groups.filter((group) => group.bucket === 'priority' && !group.retained)
  const completenessGroups = queue.groups.filter((group) => group.bucket === 'completeness' && !group.retained)

  return (
    <div className="settings-page settings-page--reading risk-data-repair-view" data-risk-data-repair-view>
      <div className="settings-page-head risk-repair-hero">
        <div>
          <Link className="risk-repair-back" to="/settings/risk">返回风险管理</Link>
          <h1 className="settings-page-title" tabIndex={-1}>风险数据修复</h1>
          {queue.counts.total > 0 ? <div className="risk-repair-counts" data-risk-repair-counts aria-label="风险数据缺口摘要">
            <span>待处理 {queue.counts.total - queue.retainedCount} 项</span>
            <span>历史缺口 {queue.retainedCount} 项</span>
            <span>涉及 {new Set(queue.items.map((item) => item.issue.tradeId).filter(Boolean)).size} 笔交易</span>
          </div> : null}
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

      {queue.groups.length === 0 ? <div className="risk-repair-complete" role="status"><strong>当前风险周期数据完整</strong></div> : null}
      <HistoricalRiskBackfillPanel today={today} issues={issues} />

      {queue.groups.length > 0 ? (
        <>
          <RepairBucket
            title="优先处理"
            description=""
            groups={priorityGroups}
            activeGroup={activeGroup}
            onOpen={openGroup}
          />
          <RepairBucket
            title="补全数据"
            description=""
            groups={completenessGroups}
            activeGroup={activeGroup}
            onOpen={openGroup}
          />
          <RepairBucket
            title="历史缺口"
            description="可补录当时适用的规则；未补录的缺口仍影响风险判断。"
            groups={queue.groups.filter((group) => group.retained)}
            activeGroup={activeGroup}
            onOpen={openGroup}
          />
        </>
      ) : null}
    </div>
  )
}
