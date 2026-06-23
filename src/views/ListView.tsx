import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Star, Bell, Calendar } from 'lucide-react'
import { Topbar } from '@/components/Topbar'
import { EmptyState } from '@/components/EmptyState'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import { StrategyIcon, StrategyLabel } from '@/components/StrategyIcon'
import { getStrategyName } from '@/lib/strategies'
import { useStore } from '@/store/useStore'
import type { Strategy } from '@/data/strategies'
import { tradeDetailPath } from '@/lib/tradeRoute'
import { STATUS_META, type TradeStatus, type Trade } from '@/data/trades'
import { REVIEW_STATUS_META } from '@/lib/reviewAnalytics'
import {
  filterTrades,
  applyDisplayPrefs,
  type ListFilter,
} from '@/lib/tradeFilters'
import { fmtMoney, fmtR, fmtDate } from '@/lib/format'
import { UserAvatar } from '@/components/UserAvatar'
import { toast } from '@/lib/toast'
import { transitionTradeStatus, toggleTradeDone } from '@/lib/tradeTransition'
import { STATUS_ORDER, isRowDone } from '@/lib/tradeStatus'
import { getTradesPageSubtitle } from '@/lib/pageCopy'
import {
  classifyDateBucket,
  formatDateBucket,
  compareDateBucket,
  type DateBucket,
} from '@/lib/periods'
import { useListContextSync } from '@/shortcuts/useListContextSync'
import './ListView.css'

export function ListView({
  title = '交易',
  view,
  onView,
  filter = { type: 'all' },
  header,
}: {
  title?: string
  view: 'list' | 'board'
  onView: (v: 'list' | 'board') => void
  filter?: ListFilter
  header?: ReactNode
}) {
  const trades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const sortedStrategies = useMemo(
    () => [...strategies].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [strategies],
  )
  const display = useStore((s) => s.display)
  const starredIds = useStore((s) => s.starredIds)
  const subscribedIds = useStore((s) => s.subscribedIds)
  const openComposer = useStore((s) => s.openComposer)
  const setStatus = useStore((s) => s.setStatus)
  const updateTradeData = useStore((s) => s.updateTradeData)
  const removeTrade = useStore((s) => s.removeTrade)
  const toggleStar = useStore((s) => s.toggleStar)
  const isStarred = useStore((s) => s.isStarred)
  const [ctx, setCtx] = useState<CtxState | null>(null)
  const transition = {
    updateTradeData,
    setStatus,
    toast,
  }

  useListContextSync(filter)

  const visible = useMemo(() => {
    const filtered = filterTrades(trades, filter, starredIds)
    return applyDisplayPrefs(filtered, display, filter)
  }, [trades, filter, starredIds, display])

  const [focusIdx, setFocusIdx] = useState(-1)
  const navigate = useNavigate()
  const focusId = focusIdx >= 0 && focusIdx < visible.length ? visible[focusIdx].id : null

  // 键盘导航
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (visible.length === 0) return
      if (e.key === 'j') { e.preventDefault(); setFocusIdx((i) => Math.min(i + 1, visible.length - 1)) }
      else if (e.key === 'k') { e.preventDefault(); setFocusIdx((i) => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter' && focusIdx >= 0 && visible[focusIdx]) {
        e.preventDefault()
        navigate(tradeDetailPath(visible[focusIdx]))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, focusIdx, navigate])

  // 列表变化时重置焦点
  useEffect(() => { setFocusIdx(-1) }, [visible.length])

  const onRowContext = (e: React.MouseEvent, t: Trade) => {
    e.preventDefault()
    setCtx({
      x: e.clientX,
      y: e.clientY,
      items: buildTradeCtxItems(t, {
        setStatus,
        changeStatus: (s) => transitionTradeStatus(t, s, transition),
        openComposer,
        removeTrade,
        toggleStar,
        isStarred,
      }),
    })
  }

  const groups = useMemo(() => {
    if (display.groupByDate && !display.groupByStrategy) {
      const map = new Map<string, { trades: Trade[]; ts: number }>()
      visible.forEach((t) => {
        const bucket = classifyDateBucket(t.openedAt)
        const key = typeof bucket === 'object'
          ? `${bucket.year}-${String(bucket.month).padStart(2, '0')}`
          : bucket
        const ts = new Date(t.openedAt).getTime()
        if (!map.has(key)) map.set(key, { trades: [], ts })
        map.get(key)!.trades.push(t)
        // 保留最早的时间戳用于排序
        if (ts < map.get(key)!.ts) map.get(key)!.ts = ts
      })
      return [...map.entries()]
        .sort((a, b) => {
          const bucketA = a[0].startsWith('20') // YYYY-MM format
            ? { year: Number(a[0].slice(0, 4)), month: Number(a[0].slice(5)) } as const
            : a[0] as DateBucket
          const bucketB = b[0].startsWith('20')
            ? { year: Number(b[0].slice(0, 4)), month: Number(b[0].slice(5)) } as const
            : b[0] as DateBucket
          return compareDateBucket(bucketA, bucketB, a[1].ts, b[1].ts)
        })
        .map(([key, { trades: items }]) => {
          const bucket: DateBucket = key.startsWith('20')
            ? { year: Number(key.slice(0, 4)), month: Number(key.slice(5)) }
            : key as DateBucket
          return {
            kind: 'date' as const,
            date: formatDateBucket(bucket as DateBucket),
            items,
          }
        })
        .filter((g) => display.showEmptyGroups || g.items.length > 0)
    }

    if (display.groupByStrategy) {
      const map = new Map<string, Trade[]>()
      sortedStrategies.forEach((s) => map.set(s.id, []))
      visible.forEach((t) => {
        if (!map.has(t.strategyId)) map.set(t.strategyId, [])
        map.get(t.strategyId)!.push(t)
      })
      const orderedIds = [
        ...sortedStrategies.map((s) => s.id),
        ...[...map.keys()].filter((id) => !sortedStrategies.some((s) => s.id === id)),
      ]
      return orderedIds
        .map((strategyId) => ({
          kind: 'strategy' as const,
          strategyId,
          items: map.get(strategyId) ?? [],
        }))
        .filter((g) => display.showEmptyGroups || g.items.length > 0)
    }

    const map = new Map<TradeStatus, Trade[]>()
    STATUS_ORDER.forEach((s) => map.set(s, []))
    visible.forEach((t) => {
      if (!map.has(t.status)) map.set(t.status, [])
      map.get(t.status)!.push(t)
    })
    return STATUS_ORDER.map((s) => ({
      kind: 'status' as const,
      status: s,
      items: map.get(s) ?? [],
    })).filter((g) => display.showEmptyGroups || g.items.length > 0)
  }, [
    visible,
    display.showEmptyGroups,
    display.groupByStrategy,
    display.groupByDate,
    sortedStrategies,
  ])

  let rowIndex = 0

  const emptyHint =
    filter.type === 'active'
      ? '暂无进行中的交易（计划中或持仓中）。'
      : filter.type === 'starred'
          ? '还没有星标交易，在详情页点击星标即可添加。'
          : filter.type === 'strategy'
            ? `「${getStrategyName(strategies, filter.strategyId)}」策略下暂无交易。`
            : filter.type === 'missed'
              ? '还没有记录错过的机会。'
              : filter.type === 'period'
                ? '该时间段内没有按开仓日匹配的交易。'
                : '记录你的第一笔交易，开始构建你的复盘日志。'

  const subtitle = getTradesPageSubtitle(filter)

  return (
    <>
      <Topbar title={title} subtitle={subtitle} view={view} onView={onView} />
      <div className="list-scroll">
        {groups.length === 0 ? (
          <EmptyState
            title="还没有交易"
            hint={emptyHint}
            action={
              <button className="empty-btn" onClick={() => openComposer()}>
                <Plus size={15} />
                <span>新建交易</span>
              </button>
            }
          />
        ) : (
          groups.map((g) => (
            <section
              key={
                g.kind === 'strategy'
                  ? g.strategyId
                  : g.kind === 'date'
                    ? g.date
                    : g.status
              }
              className="lv-group"
            >
              <div className="lv-group-header">
                {g.kind === 'strategy' ? (
                  <>
                    {(() => {
                      const s = strategies.find((x) => x.id === g.strategyId)
                      return s ? (
                        <StrategyIcon icon={s.icon} color={s.color} size={13} />
                      ) : (
                        <StatusIcon status="planned" size={15} />
                      )
                    })()}
                    <span className="lv-group-title">
                      {getStrategyName(strategies, g.strategyId)}
                    </span>
                  </>
                ) : g.kind === 'date' ? (
                  <>
                    <Calendar size={13} className="lv-group-cal" aria-hidden />
                    <span className="lv-group-title">{g.date}</span>
                  </>
                ) : (
                  <>
                    <StatusIcon status={g.status} size={15} />
                    <span className="lv-group-title">{STATUS_META[g.status].label}</span>
                  </>
                )}
                <span className="lv-group-count">{g.items.length}</span>
                <button
                  className="lv-group-add"
                  title="新建交易"
                  aria-label="新建交易"
                  onClick={() => openComposer()}
                >
                  <Plus size={15} />
                </button>
              </div>
              {g.items.map((t) => (
                <Row
                  key={t.id}
                  t={t}
                  index={rowIndex++}
                  strategies={strategies}
                  starred={isStarred(t.id)}
                  followed={subscribedIds.includes(t.id)}
                  onToggleStar={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleStar(t.id)
                  }}
                  onContext={onRowContext}
                  onToggleDone={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleTradeDone(t, transition)
                  }}
                  focused={t.id === focusId}
                />
              ))}
            </section>
          ))
        )}
      </div>
      <ContextMenu state={ctx} onClose={() => setCtx(null)} />
    </>
  )
}

function Row({
  t,
  index,
  onContext,
  onToggleDone,
  onToggleStar,
  strategies,
  starred,
  followed,
  focused,
}: {
  t: Trade
  index: number
  focused: boolean
  onContext: (e: React.MouseEvent, t: Trade) => void
  onToggleDone: (e: React.MouseEvent) => void
  onToggleStar: (e: React.MouseEvent) => void
  strategies: Strategy[]
  starred: boolean
  followed: boolean
}) {
  const done = isRowDone(t.status)
  const showPnl = t.status !== 'planned' && t.status !== 'open'
  const visibleTags = t.tags.slice(0, 2)
  const hiddenTagCount = Math.max(0, t.tags.length - visibleTags.length)
  return (
    <Link
      to={tradeDetailPath(t)}
      className={'lv-row' + (focused ? ' is-focused' : '')}
      style={{ animationDelay: `${Math.min(index, 16) * 22}ms` }}
      onContextMenu={(e) => onContext(e, t)}
    >
      <span className="lv-check" onClick={onToggleDone}>
        <span className={'lv-check-box' + (done ? ' is-done' : '')} />
      </span>
      <span className="lv-conviction">
        <ConvictionIcon conviction={t.conviction} />
      </span>
      <span className="lv-status">
        <StatusIcon status={t.status} />
      </span>
      <span className="lv-symbol">{t.symbol}</span>
      <span className="lv-side">
        <SideTag side={t.side} />
      </span>
      <span className="lv-title">
        <StrategyLabel strategyId={t.strategyId} strategies={strategies} size={14} />
      </span>
      <div className="lv-spacer" />
      <div className="lv-tags">
        {visibleTags.map((tag) => (
          <span className="lv-tag" key={tag}>
            {tag}
          </span>
        ))}
        {hiddenTagCount > 0 && <span className="lv-tag lv-tag-more">+{hiddenTagCount}</span>}
        {t.reviewStatus !== 'unreviewed' && (
          <span className={'lv-review lv-review-' + t.reviewStatus}>
            {REVIEW_STATUS_META[t.reviewStatus].label}
          </span>
        )}
        {t.mistakeTags.slice(0, 2).map((tag) => (
          <span className="lv-mistake" key={tag}>
            {tag}
          </span>
        ))}
      </div>
      <span
        className="lv-pnl"
        style={{ color: t.pnl > 0 ? 'var(--pos)' : t.pnl < 0 ? 'var(--neg)' : 'var(--text-tertiary)' }}
      >
        {showPnl ? fmtMoney(t.pnl) : '—'}
      </span>
      <span className="lv-r">{showPnl ? fmtR(t.rMultiple) : ''}</span>
      <UserAvatar className="lv-avatar" />
      <span className="lv-date">{fmtDate(t.openedAt)}</span>
      {followed && (
        <Bell size={12} className="lv-followed" aria-label="已置顶关注" />
      )}
      <button
        type="button"
        className={'lv-star' + (starred ? ' is-starred' : '')}
        title={starred ? '取消星标' : '星标'}
        aria-label={starred ? '取消星标' : '星标'}
        onClick={onToggleStar}
      >
        <Star size={13} fill={starred ? 'currentColor' : 'none'} />
      </button>
    </Link>
  )
}
