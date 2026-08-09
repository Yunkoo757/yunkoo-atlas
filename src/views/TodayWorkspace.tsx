import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, BookOpen, CheckCircle, Clock, Plus } from '@/icons/appIcons'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { Topbar } from '@/components/Topbar'
import { TradeRow } from '@/components/trades/TradeRow'
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
    description: '打开交易，继续执行持仓或已到期计划；未来计划会在到期日出现。',
    icon: Clock,
  },
  {
    key: 'resultPending',
    title: '待补交易结果',
    description: '打开交易，补齐盈亏或 R 倍数，纳入有效统计。',
    icon: AlertCircle,
  },
  {
    key: 'reviewPending',
    title: '待完成复盘',
    description: '打开交易，继续记录判断、执行偏差和下一次行动。',
    icon: BookOpen,
  },
] as const

type QueueFilter = 'all' | 'active' | 'resultPending' | 'reviewPending'

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
  const privacyMode = useStore((state) => state.display.privacyMode)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const [contextMenu, setContextMenu] = useState<CtxState | null>(null)
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all')
  const navigate = useNavigate()
  const location = useLocation()
  const today = useLocalDateKey()
  const buckets = useMemo(
    () => getTodayWorkflowBuckets(trades, today, tradingDayStartHour),
    [trades, today, tradingDayStartHour],
  )
  const todayMetrics = useMemo(
    () => buildTodayClosedMetrics(trades, today, tradingDayStartHour),
    [trades, today, tradingDayStartHour],
  )
  const visibleWorkflowGroups = useMemo(
    () => queueFilter === 'all'
      ? WORKFLOW_GROUPS
      : WORKFLOW_GROUPS.filter((group) => group.key === queueFilter),
    [queueFilter],
  )
  const visibleActionCount = queueFilter === 'all' ? buckets.actionCount : buckets[queueFilter].length
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

  const openContextMenu = (event: React.MouseEvent, trade: Trade) => {
    event.preventDefault()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
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
          <section className="today-focus" aria-labelledby="today-focus-title">
            <div>
              <span className="today-focus-eyebrow">行动队列</span>
              <h1 id="today-focus-title">
                {buckets.actionCount > 0
                  ? `还有 ${buckets.actionCount} 项需要处理`
                  : '今日没有交易待办'}
              </h1>
              <p>
                {buckets.actionCount > 0
                  ? buckets.historicalActionCount > 0
                    ? `其中 ${buckets.historicalActionCount} 项来自此前遗留；先补齐结果，再完成复盘。`
                    : '按执行、结果、复盘的顺序完成闭环；统计会自动保持可信。'
                  : '没有遗留的平仓结果或复盘任务，可以开始记录新机会。'}
              </p>
              <Link to="/settings/risk" className="today-risk-alert is-triggered">
                风险已超限 · 开仓前先查看
              </Link>
              <Link to="/settings/risk" className="today-risk-alert is-unready">
                风险状态待处理 · 前往设置
              </Link>
            </div>
            <button
              type="button"
              className={`empty-btn${buckets.actionCount > 0 ? ' is-secondary' : ''}`}
              onClick={() => openComposer()}
            >
              <Plus size={15} />
              新建交易
            </button>
          </section>

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
                <div className="today-workflow-groups">
                  {visibleWorkflowGroups.map(({ key, title, description, icon: Icon }) => {
                    const items = buckets[key]
                    if (items.length === 0) return null
                    return (
                      <section className="today-workflow-group" key={key}>
                        <header>
                          <span className="today-group-icon"><Icon size={15} /></span>
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
                              starred={starredIdSet.has(trade.id)}
                              onOpen={openTrade}
                              onSelect={() => {}}
                              onToggleStar={(item) => toggleStar(item.id)}
                              onContextMenu={openContextMenu}
                            />
                          ))}
                        </div>
                      </section>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          <RiskStatusStrip currentTradingDayKey={today} />

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
                <span className="today-group-icon"><CheckCircle size={15} /></span>
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
                    starred={starredIdSet.has(trade.id)}
                    onOpen={openTrade}
                    onSelect={() => {}}
                    onToggleStar={(item) => toggleStar(item.id)}
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
