import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ListTodo,
  BarChart3,
  Plus,
  CornerDownLeft,
  Search,
  Star,
  Settings2,
  Tag,
  HardDriveDownload,
  Ban,
  Calendar,
  FlaskConical,
  Clock,
  X,
  Keyboard,
  BookOpen,
  RotateCcw,
} from '@/icons/appIcons'
import { tradeDetailPath } from '@/lib/tradeRoute'
import { sortStrategies } from '@/lib/strategies'
import { StrategyIcon } from '@/components/StrategyIcon'
import { matchesSearchQuery } from '@/lib/tradeFilters'
import { isAccountTrade } from '@/lib/tradeKind'
import { collectLimitedCommandMatches } from '@/lib/commandPaletteSearch'
import { CALENDAR_PERIODS, PERIOD_LABELS } from '@/lib/periods'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { getShortcutHintModel } from '@/shortcuts/hints'
import { resolveShortcutWorkspaceHref } from '@/shortcuts/workspaceActions'
import { StatusIcon } from '@/components/StatusIcon'
import { newTradeKindForPath } from '@/lib/tradeKind'
import './CommandPalette.css'

interface Cmd {
  id: string
  group: string
  icon: React.ReactNode
  label: string
  hint?: string
  keywords?: string
  run: () => void
}

const MAX_SEARCH_RESULTS = 60

interface TagCommandCandidate {
  kind: 'live' | 'paper' | 'case'
  path: string
  group: string
  unit: string
  tag: string
  count: number
}

export function CommandPalette({
  open,
  onClose,
  returnFocusTo,
}: {
  open: boolean
  onClose: () => void
  returnFocusTo?: HTMLElement | null
}) {
  if (!open) return null
  return <CommandPaletteDialog onClose={onClose} returnFocusTo={returnFocusTo} />
}

function CommandPaletteDialog({
  onClose,
  returnFocusTo,
}: {
  onClose: () => void
  returnFocusTo?: HTMLElement | null
}) {
  const [q, setQ] = useState('')
  const deferredQuery = useDeferredValue(q)
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const trades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const display = useStore((s) => s.display)
  const openComposer = useStore((s) => s.openComposer)
  const shortcutBindings = useShortcutStore((s) => s.bindings)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const returnFocusFrameRef = useRef<number | null>(null)

  const searchResult = useMemo(() => {
    const go = (to: string) => () => {
      navigate(to)
      onClose()
    }
    const shortcutHint = (actionId: string) =>
      getShortcutHintModel(actionId, shortcutBindings).hint ?? undefined
    const viewNav: Cmd[] = [
      { id: 'n-today', group: '导航', icon: <Calendar size={16} />, label: '今日工作台', hint: shortcutHint('nav.today'), run: go('/today-record') },
      { id: 'n-list', group: '导航', icon: <ListTodo size={16} />, label: '交易记录', hint: shortcutHint('nav.list'), run: go(resolveShortcutWorkspaceHref('trade', display, strategies)) },
      { id: 'n-review-cases', group: '导航', icon: <BookOpen size={16} />, label: '案例记录', hint: shortcutHint('nav.reviewCases'), run: go(resolveShortcutWorkspaceHref('case', display, strategies)) },
      { id: 'n-review-session', group: '导航', icon: <RotateCcw size={16} />, label: '随机复盘', keywords: '随机 抽卡 复盘', hint: '抽卡浏览交易与案例', run: go('/review-session') },
      { id: 'n-active', group: '导航', icon: <Clock size={16} />, label: '进行中', hint: shortcutHint('nav.active'), run: go('/active') },
      { id: 'n-dash', group: '导航', icon: <BarChart3 size={16} />, label: '仪表盘', hint: shortcutHint('nav.dashboard'), run: go('/dashboard') },
      { id: 'n-fav', group: '导航', icon: <Star size={16} />, label: '星标交易', hint: shortcutHint('nav.favorites'), run: go('/favorites') },
      { id: 'n-missed', group: '导航', icon: <Ban size={16} />, label: '错过的机会', hint: shortcutHint('nav.missed'), run: go('/missed') },
      { id: 'n-sim', group: '导航', icon: <FlaskConical size={16} />, label: '模拟回测', hint: shortcutHint('nav.sim'), run: go('/sim') },
    ]
    const periodNav: Cmd[] = CALENDAR_PERIODS.map((slug) => ({
      id: 'n-period-' + slug,
      group: '时间',
      icon: <Calendar size={16} />,
      label: PERIOD_LABELS[slug],
      keywords: `period ${slug}`,
      run: go(`/period/${slug}`),
    }))
    const settingsNav: Cmd[] = [
      { id: 'n-strat', group: '设置', icon: <Settings2 size={16} />, label: '编辑策略', run: go('/settings/strategies') },
      { id: 'n-settings', group: '设置', icon: <Keyboard size={16} />, label: '键盘快捷键', run: go('/settings/shortcuts') },
      {
        id: 'a-io',
        group: '设置',
        icon: <HardDriveDownload size={16} />,
        label: '导入/导出数据',
        keywords: '备份 恢复 backup export import',
        run: () => { onClose(); navigate('/settings/data') },
      },
    ]
    const actions: Cmd[] = [
      { id: 'a-new', group: '操作', icon: <Plus size={16} />, label: '新建交易', hint: shortcutHint('global.newTrade'), run: () => { onClose(); openComposer(null, newTradeKindForPath(pathname)) } },
      { id: 'a-new-case', group: '操作', icon: <BookOpen size={16} />, label: '新建案例记录', hint: shortcutHint('global.newCase'), run: () => { onClose(); openComposer(null, 'case') } },
    ]

    const query = deferredQuery.trim()
    if (!query) {
      const commands = [...actions, ...viewNav, ...settingsNav]
      return { commands, total: commands.length }
    }

    const fixedCommands = [...viewNav, ...periodNav, ...settingsNav, ...actions]
      .filter((command) => matchesSearchQuery(query, command.label, command.hint, command.keywords))
    const commands = fixedCommands.slice(0, MAX_SEARCH_RESULTS)
    let total = fixedCommands.length

    const searchableTrades = trades.filter((trade) => !trade.deletedAt)

    const strategyCounts = new Map<string, number>()
    for (const trade of searchableTrades) {
      if (!isAccountTrade(trade)) continue
      strategyCounts.set(trade.strategyId, (strategyCounts.get(trade.strategyId) ?? 0) + 1)
    }
    const strategyMatches = collectLimitedCommandMatches(
      sortStrategies(strategies, []),
      query,
      (strategy) => [strategy.name, `strategy ${strategy.name}`],
      (strategy): Cmd => ({
        id: 'strat-' + strategy.id,
        group: '策略',
        icon: <StrategyIcon icon={strategy.icon} color={strategy.color} size={16} variant="nav" />,
        label: strategy.name,
        hint: `${strategyCounts.get(strategy.id) ?? 0} 笔交易`,
        keywords: `strategy ${strategy.name}`,
        run: go(`/strategy/${strategy.id}`),
      }),
      MAX_SEARCH_RESULTS - commands.length,
    )
    commands.push(...strategyMatches.items)
    total += strategyMatches.total

    const tagWorkspaces = [
      { kind: 'live', path: '/list', group: '交易标签', unit: '笔交易' },
      { kind: 'paper', path: '/sim', group: '模拟标签', unit: '笔模拟交易' },
      { kind: 'case', path: '/review-cases', group: '案例标签', unit: '个案例' },
    ] as const
    const tagCandidates: TagCommandCandidate[] = []
    for (const workspace of tagWorkspaces) {
      const counts = new Map<string, number>()
      for (const trade of searchableTrades) {
        if (trade.tradeKind !== workspace.kind) continue
        for (const tag of trade.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
      for (const [tag, count] of counts) {
        tagCandidates.push({ ...workspace, tag, count })
      }
    }
    const tagMatches = collectLimitedCommandMatches(
      tagCandidates,
      query,
      (candidate) => [candidate.tag],
      (candidate): Cmd => {
        const { tag } = candidate
        return {
          id: `tag-${candidate.kind}-${tag}`,
          group: candidate.group,
          icon: <Tag size={16} />,
          label: tag,
          hint: `${candidate.count} ${candidate.unit}`,
          keywords: tag,
          run: go(`${candidate.path}?${new URLSearchParams({ tag }).toString()}`),
        }
      },
      MAX_SEARCH_RESULTS - commands.length,
    )
    commands.push(...tagMatches.items)
    total += tagMatches.total

    const strategyNames = new Map(strategies.map((strategy) => [strategy.id, strategy.name]))
    const resolveStrategyName = (strategyId: string | undefined) =>
      (strategyId ? strategyNames.get(strategyId) : undefined) ?? '未分类'
    const tradeMatches = collectLimitedCommandMatches(
      searchableTrades,
      query,
      (trade) => {
        const strategyName = resolveStrategyName(trade.strategyId)
        return [trade.ref, trade.symbol, strategyName, trade.tags.join(' ')]
      },
      (trade): Cmd => {
        const strategyName = resolveStrategyName(trade.strategyId)
        return {
          id: 't-' + trade.id,
          group: '交易',
          icon: <StatusIcon status={trade.status} size={16} />,
          label: `${trade.symbol} · ${strategyName}`,
          hint: trade.ref,
          keywords: `${trade.ref} ${trade.symbol} ${strategyName} ${trade.tags.join(' ')}`,
          run: go(tradeDetailPath(trade)),
        }
      },
      MAX_SEARCH_RESULTS - commands.length,
    )
    commands.push(...tradeMatches.items)
    total += tradeMatches.total

    return { commands, total }
  }, [trades, strategies, display, shortcutBindings, pathname, navigate, onClose, openComposer, deferredQuery])

  const commands = searchResult.commands
  const hasMore = searchResult.total > commands.length
  const queryPending = q.trim() !== deferredQuery.trim()
  const visibleCommands = queryPending ? [] : commands
  const activeOptionId = visibleCommands[active]
    ? `${listboxId}-option-${active}`
    : undefined

  useEffect(() => {
    if (returnFocusFrameRef.current !== null) {
      cancelAnimationFrame(returnFocusFrameRef.current)
      returnFocusFrameRef.current = null
    }
    returnFocusRef.current = returnFocusTo ?? (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    )
    return () => {
      const target = returnFocusRef.current
      returnFocusFrameRef.current = requestAnimationFrame(() => {
        returnFocusFrameRef.current = null
        if (target?.isConnected) target.focus()
      })
    }
  }, [])

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  useEffect(() => setActive(0), [q])

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, visibleCommands.length - 1)))
  }, [visibleCommands.length])

  // 选中项滚动可见
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.cmdk-item.is-active')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(0, visibleCommands.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      visibleCommands[active]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // 分组渲染
  let lastGroup = ''
  let flatIndex = -1

  return createPortal(
    <div className="cmdk-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="搜索与命令"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.stopPropagation()
            onClose()
            return
          }
          if (event.key !== 'Tab') return

          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'input:not(:disabled), button:not(:disabled):not([tabindex="-1"])',
            ),
          ).filter((element) => element.offsetParent !== null)
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (!first || !last) return

          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div className={'cmdk-input-row' + (q ? ' has-value' : '')}>
          <Search size={16} className="cmdk-search-icon" />
          <input
            ref={inputRef}
            className="cmdk-input"
            role="combobox"
            aria-label="搜索与命令"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            placeholder="搜索交易、跳转视图…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          {q ? (
            <button
              type="button"
              className="cmdk-clear"
              onClick={() => { setQ(''); inputRef.current?.focus() }}
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        <div
          id={listboxId}
          className="cmdk-list"
          ref={listRef}
          role="listbox"
          aria-label="命令结果"
        >
          {visibleCommands.length === 0 && !queryPending && (
            <div className="cmdk-empty" role="status">没有匹配项</div>
          )}
          {visibleCommands.map((c) => {
            flatIndex++
            const idx = flatIndex
            const showHeader = c.group !== lastGroup
            lastGroup = c.group
            return (
              <div key={c.id} role="presentation">
                {showHeader && <div className="cmdk-group" role="presentation">{c.group}</div>}
                <button
                  id={`${listboxId}-option-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={idx === active}
                  tabIndex={-1}
                  className={'cmdk-item' + (idx === active ? ' is-active' : '')}
                  onMouseMove={() => setActive(idx)}
                  onClick={() => c.run()}
                >
                  <span className="cmdk-item-icon">{c.icon}</span>
                  <span className="cmdk-item-label">{c.label}</span>
                  {c.hint && <span className="cmdk-item-hint">{c.hint}</span>}
                  {idx === active && (
                    <CornerDownLeft size={13} className="cmdk-item-enter" />
                  )}
                </button>
              </div>
            )
          })}
          {(queryPending || hasMore) && (
            <div className="cmdk-result-note" role="status">
              {queryPending
                ? '正在筛选…'
                : `显示前 ${commands.length} 项，共 ${searchResult.total} 项 · 继续输入可缩小范围`}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
