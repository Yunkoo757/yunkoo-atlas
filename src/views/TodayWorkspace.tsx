import { ICON_MD } from '@/icons/iconSize'
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, BookOpen, CheckCircle, Clock, Plus } from '@/icons/appIcons'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { Topbar } from '@/components/Topbar'
import { TradeRow } from '@/components/trades/TradeRow'
import { TradeListColumns } from '@/components/trades/TradeListColumns'
import type { Trade } from '@/data/trades'
import { fmtMoney } from '@/lib/format'
import { toast } from '@/lib/toast'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { transitionTradeStatus } from '@/lib/tradeTransition'
import { buildTodayClosedMetrics, getTodayWorkflowBuckets } from '@/lib/tradeWorkflow'
import { rememberTradeReturnAnchor, useTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { useStore } from '@/store/useStore'
import { RiskStatusStrip } from '@/components/RiskStatusStrip'
import { Button } from '@/components/ui/Button'
import { filterStageOwnedRecords } from '@/lib/stageArchive'
import './TodayWorkspace.css'

function dateLabel(date: string): string {
  const value = new Date(`${date}T00:00:00`)
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(value)
}

const WORKFLOW_GROUPS = [
  {
    key: 'active',
    title: '进行中的交易',
    description: '继续执行持仓与到期计划。',
    icon: Clock,
  },
  {
    key: 'resultPending',
    title: '待补交易结果',
    description: '补齐盈亏或 R，恢复统计完整性。',
    icon: AlertCircle,
  },
  {
    key: 'reviewPending',
    title: '待完成复盘',
    description: '记录判断、偏差与下一次行动。',
    icon: BookOpen,
  },
] as const

type QueueFilter = 'all' | 'active' | 'resultPending' | 'reviewPending'

type TodayHeadingTab = 'all' | 'open' | 'results' | 'review'

type QueueCounts = {
  all: number
  open: number
  results: number
  review: number
}

type TodayPrimaryAction = {
  kind: Exclude<QueueFilter, 'all'> | 'create'
  label: string
}

export function resolveTodayPrimaryAction(counts: {
  active: number
  resultPending: number
  reviewPending: number
}): TodayPrimaryAction {
  if (counts.resultPending > 0) return { kind: 'resultPending', label: '补齐交易结果' }
  if (counts.reviewPending > 0) return { kind: 'reviewPending', label: '完成交易复盘' }
  if (counts.active > 0) return { kind: 'active', label: '继续当前交易' }
  return { kind: 'create', label: '新建交易' }
}

export function todayHeadingForTab(tab: TodayHeadingTab, counts: QueueCounts): string {
  if (tab === 'open') return `${counts.open} 项进行中`
  if (tab === 'results') return `${counts.results} 项等待结果`
  if (tab === 'review') return `${counts.review} 项待复盘`
  return counts.all > 0 ? `还有 ${counts.all} 项需要处理` : '今日没有交易待办'
}

const QUEUE_TABS: ReadonlyArray<{ key: QueueFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'resultPending', label: '待结果' },
  { key: 'reviewPending', label: '待复盘' },
]

export function TodayWorkspace() {
  const trades = useStore((state) => state.trades)
  const strategies = useStore((state) => state.strategies)
  const symbolIcons = useStore((state) => state.symbolIcons)
  const starredIds = useStore((state) => state.starredIds)
  const openComposer = useStore((state) => state.openComposer)
  const setStatus = useStore((state) => state.setStatus)
  const requestTradeClose = useStore((state) => state.requestTradeClose)
  const requestTradeOpen = useStore((state) => state.requestTradeOpen)
  const removeTrade = useStore((state) => state.removeTrade)
  const toggleStar = useStore((state) => state.toggleStar)
  const isStarred = useStore((state) => state.isStarred)
  const toggleCaseFocus = useStore((state) => state.toggleCaseFocus)
  const isCaseFocused = useStore((state) => state.isCaseFocused)
  const privacyMode = useStore((state) => state.display.privacyMode)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const legacyCashCurrencyAssumption = useStore((state) => state.profile.legacyCashCurrencyAssumption)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const [contextMenu, setContextMenu] = useState<CtxState | null>(null)
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all')
  const navigate = useNavigate()
  const location = useLocation()
  const today = useLocalDateKey()
  const currentStageTrades = useMemo(
    () => filterStageOwnedRecords(trades, { kind: 'current', stageId: currentLiveStageId }),
    [currentLiveStageId, trades],
  )
  const buckets = useMemo(
    () => getTodayWorkflowBuckets(currentStageTrades, today, tradingDayStartHour),
    [currentStageTrades, today, tradingDayStartHour],
  )
  const todayMetrics = useMemo(
    () => buildTodayClosedMetrics(
      currentStageTrades,
      today,
      tradingDayStartHour,
      legacyCashCurrencyAssumption,
    ),
    [currentStageTrades, today, tradingDayStartHour, legacyCashCurrencyAssumption],
  )
  const visibleWorkflowGroups = useMemo(
    () => queueFilter === 'all'
      ? WORKFLOW_GROUPS
      : WORKFLOW_GROUPS.filter((group) => group.key === queueFilter),
    [queueFilter],
  )
  const visibleActionCount = queueFilter === 'all' ? buckets.actionCount : buckets[queueFilter].length
  const queueCounts: QueueCounts = {
    all: buckets.actionCount,
    open: buckets.active.length,
    results: buckets.resultPending.length,
    review: buckets.reviewPending.length,
  }
  const primaryAction = resolveTodayPrimaryAction({
    active: buckets.active.length,
    resultPending: buckets.resultPending.length,
    reviewPending: buckets.reviewPending.length,
  })
  const headingTab: TodayHeadingTab = queueFilter === 'active'
    ? 'open'
    : queueFilter === 'resultPending'
      ? 'results'
      : queueFilter === 'reviewPending'
        ? 'review'
        : 'all'
  const starredIdSet = useMemo(() => new Set(starredIds), [starredIds])
  // 队列 tab 只更新筛选状态，不再用 scrollIntoView 跳转到模糊的分组目标。
  useTradeReturnAnchor()

  const openTrade = (trade: Trade) => {
    const from = {
      pathname: location.pathname,
      search: location.search,
      anchorTradeId: trade.id,
    }
    rememberTradeReturnAnchor(from)
    navigate(tradeDetailPath(trade), { state: tradeDetailNavState(from) })
  }

  const runPrimaryAction = () => {
    if (primaryAction.kind === 'create') {
      openComposer()
      return
    }
    const trade = buckets[primaryAction.kind][0]
    if (trade) openTrade(trade)
  }

  const openContextMenu = (event: React.MouseEvent, trade: Trade) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      originElement: event.currentTarget as HTMLElement,
      items: buildTradeCtxItems(trade, {
        setStatus,
        requestTradeOpen,
        changeStatus: (status) => transitionTradeStatus(trade, status, {
          setStatus,
          requestTradeOpen,
          requestTradeClose,
          toast,
        }),
        openComposer,
        removeTrade,
        createReviewCase: (source) => {
          const result = useStore.getState().createReviewCaseFromTrade(source.id)
          if (result.status !== 'created') {
            toast(result.status === 'source-is-case' ? '案例不能再次提炼' : '原交易已不存在')
            return
          }
          toast('已提炼为案例')
          openTrade(result.reviewCase)
        },
        toggleStar,
        isStarred,
        toggleCaseFocus,
        isCaseFocused,
      }),
    })
  }

  const selectQueueFilter = (filter: QueueFilter) => {
    setQueueFilter(filter)
  }

  const handleQueueTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex + QUEUE_TABS.length - 1) % QUEUE_TABS.length
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % QUEUE_TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = QUEUE_TABS.length - 1
    if (nextIndex == null) return

    event.preventDefault()
    const nextFilter = QUEUE_TABS[nextIndex]!.key
    selectQueueFilter(nextFilter)
    document.getElementById(`today-queue-tab-${nextFilter}`)?.focus()
  }

  return (
    <>
      <Topbar
        title="今日工作台"
        subtitle={`${dateLabel(today)} · 交易日`}
        showDisplay={false}
        titleAsHeading={false}
      />
      <div className="today-workspace-scroll">
        <div className="today-workspace-inner">
          <section
            className="today-focus"
            aria-labelledby="today-focus-title"
            data-has-workflow-actions={primaryAction.kind !== 'create'}
          >
            <div>
              <span className="today-focus-eyebrow">行动队列</span>
              <h1 id="today-focus-title">
                {todayHeadingForTab(headingTab, queueCounts)}
              </h1>
              <p>
                {buckets.actionCount > 0
                  ? buckets.historicalActionCount > 0
                    ? `其中 ${buckets.historicalActionCount} 项来自此前遗留；先补齐结果，再完成复盘。`
                    : '按执行、结果、复盘的顺序完成闭环；统计会自动保持可信。'
                  : '没有遗留的平仓结果或复盘任务，可以开始记录新机会。'}
              </p>
            </div>
            <div className="today-focus-actions">
              <Link
                to="/settings/risk"
                className="ui-btn ui-btn-primary ui-btn-lg today-risk-action is-triggered"
                data-today-risk-action
              >
                处理风险
              </Link>
              <Link
                to="/settings/risk"
                className="ui-btn ui-btn-primary ui-btn-lg today-risk-action is-unready"
                data-today-risk-action
              >
                处理风险状态
              </Link>
              {primaryAction.kind !== 'create' ? (
                <Button
                  data-today-primary-action
                  variant="primary"
                  size="lg"
                  className="today-workflow-primary"
                  onClick={runPrimaryAction}
                >
                  {primaryAction.label}
                </Button>
              ) : null}
              <Button
                data-today-primary-action={primaryAction.kind === 'create' ? '' : undefined}
                variant={primaryAction.kind === 'create' ? 'primary' : 'bordered'}
                size="lg"
                className="today-create-trade"
                onClick={() => openComposer()}
              >
                <Plus size={ICON_MD} />
                新建交易
              </Button>
            </div>
          </section>

          <RiskStatusStrip currentTradingDayKey={today} density="workbench" />

          <section className="today-action-queue" data-today-action-queue aria-label="行动队列">
            <div className="today-queue-tabs" role="tablist" aria-label="行动队列筛选">
              {QUEUE_TABS.map(({ key, label }, index) => {
                const count = key === 'all' ? buckets.actionCount : buckets[key].length
                return (
                  <button
                    key={key}
                    id={`today-queue-tab-${key}`}
                    type="button"
                    role="tab"
                    aria-selected={queueFilter === key}
                    aria-controls="today-queue-panel"
                    tabIndex={queueFilter === key ? 0 : -1}
                    className={queueFilter === key ? 'is-selected' : undefined}
                    onClick={() => selectQueueFilter(key)}
                    onKeyDown={(event) => handleQueueTabKeyDown(event, index)}
                  >
                    {label}<strong>{count}</strong>
                  </button>
                )
              })}
            </div>

            <div id="today-queue-panel" role="tabpanel" aria-labelledby={`today-queue-tab-${queueFilter}`}>
              {visibleActionCount === 0 ? (
                <div className="today-queue-empty">当前筛选下没有待处理事项</div>
              ) : (
                <>
                  <TradeListColumns className="today-trade-columns" />
                  <div className="today-workflow-groups">
                    {visibleWorkflowGroups.map(({ key, title, description, icon: Icon }) => {
                    const items = buckets[key]
                    if (items.length === 0) return null
                    return (
                      <section className="today-workflow-group" key={key}>
                        <header>
                          <span className="today-group-icon"><Icon size={ICON_MD} /></span>
                          <div>
                            <h2>{title}</h2>
                            <p>{description}</p>
                          </div>
                        </header>
                        <div className="today-workflow-list">
                          {items.map((trade) => (
                            <TradeRow
                              key={trade.id}
                              trade={trade}
                              strategies={strategies}
                              symbolIcons={symbolIcons}
                              focused={false}
                              selected={false}
                              selectable={false}
                              starred={trade.tradeKind === 'case' ? trade.isFocusCase === true : starredIdSet.has(trade.id)}
                              onOpen={openTrade}
                              onSelect={() => {}}
                              onToggleStar={(item) => item.tradeKind === 'case' ? toggleCaseFocus(item.id) : toggleStar(item.id)}
                              onContextMenu={openContextMenu}
                            />
                          ))}
                        </div>
                      </section>
                    )
                    })}
                  </div>
                </>
              )}
            </div>
          </section>

          {todayMetrics.closedCount > 0 ? (
            <section className="today-stats" aria-label="今日战绩">
              <div className="today-stats-head">
                <div>
                  <span className="today-stats-title">今日战绩</span>
                  <p className="today-stats-sub">
                    {`实盘 · 按平仓日${
                      todayMetrics.pnlCount > 0 ? ` · 基于 ${todayMetrics.pnlCount} 笔有金额` : ''
                    }`}
                  </p>
                </div>
                <Link to="/dashboard?kind=live&range=this-week" className="today-stats-link">
                  查看本周分析
                </Link>
              </div>
              <div className="today-stats-metrics">
                <div className="today-stats-metric">
                  <span>今日平仓</span>
                  <strong>{todayMetrics.closedCount}</strong>
                </div>
                <div className="today-stats-metric">
                  <span>胜率</span>
                  <strong>
                    {todayMetrics.winRate == null ? '—' : `${todayMetrics.winRate.toFixed(0)}%`}
                  </strong>
                </div>
                <div className="today-stats-metric">
                  <span>净盈亏</span>
                  <strong
                    className={
                      privacyMode || todayMetrics.pnlCount === 0 || todayMetrics.totalPnl === 0
                        ? undefined
                        : todayMetrics.totalPnl > 0
                          ? 'is-pos'
                          : 'is-neg'
                    }
                  >
                    {todayMetrics.pnlCount === 0 ? '—' : fmtMoney(todayMetrics.totalPnl, 'USD', privacyMode)}
                  </strong>
                  {todayMetrics.closedCount > todayMetrics.pnlCount ? (
                    <small>含 {todayMetrics.closedCount - todayMetrics.pnlCount} 笔待补金额未计入</small>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {buckets.completedToday.length > 0 ? (
            <section className="today-workflow-group today-completed is-completed">
              <header>
                <span className="today-group-icon"><CheckCircle size={ICON_MD} /></span>
                <div>
                  <h2>今日已完成</h2>
                  <p>今天已完成结果与复盘，不再需要处理的记录。</p>
                </div>
              </header>
              <div className="today-workflow-list">
                {buckets.completedToday.map((trade) => (
                  <TradeRow
                    key={trade.id}
                    trade={trade}
                    strategies={strategies}
                    symbolIcons={symbolIcons}
                    focused={false}
                    selected={false}
                    selectable={false}
                    starred={trade.tradeKind === 'case' ? trade.isFocusCase === true : starredIdSet.has(trade.id)}
                    onOpen={openTrade}
                    onSelect={() => {}}
                    onToggleStar={(item) => item.tradeKind === 'case' ? toggleCaseFocus(item.id) : toggleStar(item.id)}
                    onContextMenu={openContextMenu}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </>
  )
}
