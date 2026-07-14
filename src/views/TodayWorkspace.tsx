import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, BookOpen, CheckCircle, Clock, Plus } from '@/icons/appIcons'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { EmptyState } from '@/components/EmptyState'
import { Topbar } from '@/components/Topbar'
import { TradeRow } from '@/components/trades/TradeRow'
import type { Trade } from '@/data/trades'
import { buildReviewCaseFromTrade, getNextReviewCaseRef } from '@/lib/reviewCases'
import { toast } from '@/lib/toast'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { transitionTradeStatus } from '@/lib/tradeTransition'
import { getTodayWorkflowBuckets } from '@/lib/tradeWorkflow'
import { rememberTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { useLocalDateKey } from '@/hooks/useLocalDateKey'
import { useStore } from '@/store/useStore'
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
    description: '继续执行持仓或已到期计划；未来计划会在到期日出现。',
    icon: Clock,
  },
  {
    key: 'resultPending',
    title: '待补交易结果',
    description: '补齐盈亏或 R 倍数后，才会进入有效统计。',
    icon: AlertCircle,
  },
  {
    key: 'reviewPending',
    title: '待完成复盘',
    description: '记录判断、执行偏差和下一次行动。',
    icon: BookOpen,
  },
] as const

export function TodayWorkspace() {
  const trades = useStore((state) => state.trades)
  const strategies = useStore((state) => state.strategies)
  const symbolIcons = useStore((state) => state.symbolIcons)
  const starredIds = useStore((state) => state.starredIds)
  const openComposer = useStore((state) => state.openComposer)
  const setStatus = useStore((state) => state.setStatus)
  const requestTradeClose = useStore((state) => state.requestTradeClose)
  const removeTrade = useStore((state) => state.removeTrade)
  const upsertTrade = useStore((state) => state.upsertTrade)
  const toggleStar = useStore((state) => state.toggleStar)
  const isStarred = useStore((state) => state.isStarred)
  const [contextMenu, setContextMenu] = useState<CtxState | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const today = useLocalDateKey()
  const buckets = useMemo(() => getTodayWorkflowBuckets(trades, today), [trades, today])
  const starredIdSet = useMemo(() => new Set(starredIds), [starredIds])

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
        changeStatus: (status) => transitionTradeStatus(trade, status, {
          setStatus,
          requestTradeClose,
          toast,
        }),
        openComposer,
        removeTrade,
        createReviewCase: (source) => {
          const reviewCase = buildReviewCaseFromTrade(source, {
            id: crypto.randomUUID(),
            ref: getNextReviewCaseRef(trades),
          })
          upsertTrade(reviewCase)
          toast('已提炼为可复看案例')
          openTrade(reviewCase)
        },
        toggleStar,
        isStarred,
      }),
    })
  }

  const hasAnything = buckets.actionCount > 0 || buckets.completedToday.length > 0
  const scrollToGroup = (key: string) => {
    document.getElementById(`today-${key}`)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  return (
    <>
      <Topbar title="今日工作台" subtitle={dateLabel(today)} showDisplay={false} />
      <div className="today-workspace-scroll">
        <div className="today-workspace-inner">
          <section className="today-focus" aria-labelledby="today-focus-title">
            <div>
              <span className="today-focus-eyebrow">行动队列</span>
              <h1 id="today-focus-title">
                {buckets.actionCount > 0
                  ? `还有 ${buckets.actionCount} 项需要处理`
                  : '今日交易已完成闭环'}
              </h1>
              <p>
                {buckets.actionCount > 0
                  ? buckets.historicalActionCount > 0
                    ? `其中 ${buckets.historicalActionCount} 项来自此前遗留；先补齐结果，再完成复盘。`
                    : '按执行、结果、复盘的顺序完成闭环；统计会自动保持可信。'
                  : '没有遗留的平仓结果或复盘任务，可以开始记录新机会。'}
              </p>
            </div>
            <button type="button" className="today-create" onClick={() => openComposer()}>
              <Plus size={15} />
              新建交易
            </button>
          </section>

          <nav className="today-queue-overview" aria-label="待处理事项概览">
            {WORKFLOW_GROUPS.map(({ key, title, icon: Icon }) => (
              <button
                key={key}
                type="button"
                className={buckets[key].length ? 'has-items' : ''}
                onClick={() => scrollToGroup(key)}
              >
                <Icon size={15} aria-hidden />
                <span>{title}</span>
                <strong>{buckets[key].length}</strong>
              </button>
            ))}
          </nav>

          {!hasAnything ? (
            <EmptyState
              title="今天没有待处理事项"
              hint="新的交易、待补结果和待复盘内容会集中出现在这里。"
            />
          ) : (
            <div className="today-workflow-groups">
              {WORKFLOW_GROUPS.map(({ key, title, description, icon: Icon }) => {
                const items = buckets[key]
                if (items.length === 0) return null
                return (
                  <section id={`today-${key}`} className="today-workflow-group" key={key}>
                    <header>
                      <span className="today-group-icon"><Icon size={15} /></span>
                      <div>
                        <h2>{title}<span>{items.length}</span></h2>
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

              {buckets.completedToday.length > 0 && (
                <section id="today-completed" className="today-workflow-group is-completed">
                  <header>
                    <span className="today-group-icon"><CheckCircle size={15} /></span>
                    <div>
                      <h2>今日已完成<span>{buckets.completedToday.length}</span></h2>
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
              )}
            </div>
          )}
        </div>
      </div>
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </>
  )
}
