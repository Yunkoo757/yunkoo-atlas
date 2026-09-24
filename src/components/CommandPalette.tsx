import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ListTodo,
  BarChart3,
  Plus,
  CornerDownLeft,
  Search,
  Star,
  Bookmark,
  Settings2,
  Tag,
  HardDriveDownload,
  Ban,
  Calendar,
  CalendarDays,
  FlaskConical,
  Clock,
  X,
  Keyboard,
  BookOpen,
  RotateCcw,
  Maximize2,
  FileText,
} from '@/icons/appIcons'
import { findTradeByRouteParam, tradeDetailPath } from '@/lib/tradeRoute'
import { newTradeKindForPath } from '@/lib/tradeKind'
import { sortStrategies } from '@/lib/strategies'
import { StrategyIcon } from '@/components/StrategyIcon'
import { matchesSearchQuery } from '@/lib/tradeFilters'
import { collectLimitedCommandMatches } from '@/lib/commandPaletteSearch'
import { findDateSearchTrades, parseCommandDateQuery, type CommandSearchSession } from '@/lib/commandDateSearch'
import { findIndexedCommandMatches, indexCommandNote, indexCommandTrade } from './commandPaletteIndex'
import { textFromQuickNoteHtml } from '@/data/quickNotes'
import {
  normalizeSavedViewPath,
  savedViewSearch,
  suggestSavedViewName,
} from '@/lib/savedTradeViews'
import { Button } from '@/components/ui/Button'
import { OverflowTooltip } from '@/components/ui/Tooltip'
import { CALENDAR_PERIODS, PERIOD_LABELS } from '@/lib/periods'
import { STATUS_META, type TradeStatus } from '@/data/trades'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import { transitionTradeStatus } from '@/lib/tradeTransition'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { getShortcutHintModel } from '@/shortcuts/hints'
import { resolveShortcutWorkspaceHref } from '@/shortcuts/workspaceActions'
import { PRIMARY_NAV_LABELS } from '@/lib/sidebarNavContract'
import {
  resolveSharedTradeWorkspaceSearch,
  tradeHomeSearch,
} from '@/lib/tradeWorkspaceQuery'
import { StatusIcon } from '@/components/StatusIcon'
import './CommandPalette.css'

interface Cmd {
  id: string
  group: string
  icon: React.ReactNode
  label: string
  hint?: string
  date?: string
  source?: string
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
  onOpen,
}: {
  open: boolean
  onClose: () => void
  returnFocusTo?: HTMLElement | null
  onOpen?: () => void
}) {
  const location = useLocation()
  const remembered = useRef<CommandSearchSession | undefined>()
  const pendingReturn = useRef<CommandSearchSession | undefined>()
  const restoredKey = useRef<string | null>(null)
  const remember = useCallback((session: CommandSearchSession) => { remembered.current = session }, [])
  const rememberNavigation = useCallback((session: CommandSearchSession) => {
    remembered.current = session
    pendingReturn.current = session
  }, [])
  useEffect(() => {
    if (restoredKey.current === location.key) return
    restoredKey.current = location.key
    const explicit = (location.state as { restoreCommandSearch?: CommandSearchSession } | null)?.restoreCommandSearch
    const session = explicit ?? (pendingReturn.current?.origin.key === location.key ? pendingReturn.current : undefined)
    if (session) {
      remembered.current = session
      pendingReturn.current = undefined
      onOpen?.()
    }
  }, [location.key, location.state, onOpen])
  if (!open) return null
  return <CommandPaletteDialog onClose={onClose} returnFocusTo={returnFocusTo}
    initialSession={remembered.current} onRemember={remember} onNavigateResult={rememberNavigation} />
}

function CommandPaletteDialog({
  onClose,
  returnFocusTo,
  initialSession,
  onRemember,
  onNavigateResult,
}: {
  onClose: () => void
  returnFocusTo?: HTMLElement | null
  initialSession?: CommandSearchSession
  onRemember: (session: CommandSearchSession) => void
  onNavigateResult: (session: CommandSearchSession) => void
}) {
  const [q, setQ] = useState(initialSession?.query ?? '')
  const [limit, setLimit] = useState(initialSession?.limit ?? MAX_SEARCH_RESULTS)
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const requestClose = useCallback(() => {
    if (closeTimerRef.current !== null) return
    setClosing(true)
    closeTimerRef.current = window.setTimeout(onClose, 110)
  }, [onClose])
  const closeImmediately = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    onClose()
  }, [onClose])
  const deferredQuery = useDeferredValue(q)
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const location = useLocation()
  const { pathname, search } = location
  const origin = useRef({ pathname, search, key: location.key })
  const trades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const quickNotes = useStore((s) => s.quickNotes)
  const savedTradeViews = useStore((s) => s.savedTradeViews)
  const display = useStore((s) => s.display)
  const openComposer = useStore((s) => s.openComposer)
  const toggleStar = useStore((s) => s.toggleStar)
  const isStarred = useStore((s) => s.isStarred)
  const toggleCaseFocus = useStore((s) => s.toggleCaseFocus)
  const isCaseFocused = useStore((s) => s.isCaseFocused)
  const setStatus = useStore((s) => s.setStatus)
  const requestTradeClose = useStore((s) => s.requestTradeClose)
  const requestTradeOpen = useStore((s) => s.requestTradeOpen)
  const shortcutBindings = useShortcutStore((s) => s.bindings)
  const routeParam = pathname.startsWith('/trade/')
    ? decodeURIComponent(pathname.slice('/trade/'.length))
    : null
  const activeTrade = useMemo(() => routeParam
    ? findTradeByRouteParam(trades.filter((trade) => !trade.deletedAt), routeParam)
    : undefined, [trades, routeParam])
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const returnFocusFrameRef = useRef<number | null>(null)
  const sessionRef = useRef<CommandSearchSession>({ query: q, limit, scrollTop: 0, origin: origin.current })
  const dateQuery = useMemo(() => parseCommandDateQuery(deferredQuery), [deferredQuery])
  const textSearchEnabled = dateQuery.kind === 'text' && Boolean(deferredQuery.trim())
  const strategyNames = useMemo(() => new Map(strategies.map((strategy) => [strategy.id, strategy.name])), [strategies])
  const searchableTrades = useMemo(() => trades.filter((trade) => !trade.deletedAt), [trades])
  const tradeIndex = useMemo(() => textSearchEnabled
    ? searchableTrades.map((trade) => indexCommandTrade(trade, strategyNames.get(trade.strategyId) ?? '未分类'))
    : [], [searchableTrades, strategyNames, textSearchEnabled])
  const noteIndex = useMemo(() => textSearchEnabled ? quickNotes.map(indexCommandNote) : [], [quickNotes, textSearchEnabled])
  const matchingTrades = useMemo(() => dateQuery.kind === 'date'
    ? findDateSearchTrades(searchableTrades, dateQuery, strategyNames)
    : findIndexedCommandMatches(tradeIndex, deferredQuery), [dateQuery, searchableTrades, strategyNames, tradeIndex, deferredQuery])
  const matchingNotes = useMemo(() => findIndexedCommandMatches(noteIndex, deferredQuery), [noteIndex, deferredQuery])
  const { strategyCounts, tagCandidates } = useMemo(() => {
    const strategyCounts = new Map<string, number>()
    const tagWorkspaces = [
      { kind: 'live', path: '/list', group: '交易标签', unit: '笔交易' },
      { kind: 'paper', path: '/sim', group: '模拟盘标签', unit: '笔模拟盘记录' },
      { kind: 'case', path: '/review-cases', group: '案例标签', unit: '个案例' },
    ] as const
    const tagsByKind = new Map(tagWorkspaces.map(({ kind }) => [kind, new Map<string, number>()]))
    if (textSearchEnabled) for (const trade of searchableTrades) {
      if (trade.tradeKind === 'live') strategyCounts.set(trade.strategyId, (strategyCounts.get(trade.strategyId) ?? 0) + 1)
      const counts = tagsByKind.get(trade.tradeKind)
      if (counts) for (const tag of trade.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    const tagCandidates: TagCommandCandidate[] = tagWorkspaces.flatMap((workspace) =>
      [...tagsByKind.get(workspace.kind)!].map(([tag, count]) => ({ ...workspace, tag, count })),
    )
    return { strategyCounts, tagCandidates }
  }, [searchableTrades, textSearchEnabled])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  const searchResult = useMemo(() => {
    const go = (to: string) => () => {
      navigate(to)
      requestClose()
    }
    const shortcutHint = (actionId: string) =>
      getShortcutHintModel(actionId, shortcutBindings).hint ?? undefined
    const sharedTradeSearch = resolveSharedTradeWorkspaceSearch(
      pathname,
      search,
      display.workspaceMemory?.trade?.search ?? '',
    )
    const sharedViewHref = (view: 'active' | 'starred' | 'missed') => {
      const params = new URLSearchParams(sharedTradeSearch)
      params.set('view', view)
      return `/list?${params.toString()}`
    }
    const paperParams = new URLSearchParams(sharedTradeSearch)
    paperParams.set('kind', 'paper')
    const viewNav: Cmd[] = [
      { id: 'n-quick-notes', group: '导航', icon: <FileText size={ICON_MD} />, label: '随记', keywords: '笔记 灵感 杂谈 notebook', hint: shortcutHint('nav.quickNotes'), run: go('/notes') },
      { id: 'n-list', group: '导航', icon: <ListTodo size={ICON_MD} />, label: PRIMARY_NAV_LABELS.trades, hint: shortcutHint('nav.list'), run: go(resolveShortcutWorkspaceHref('trade', display, strategies, null, { pathname, search })) },
      { id: 'n-review-cases', group: '导航', icon: <BookOpen size={ICON_MD} />, label: PRIMARY_NAV_LABELS.reviewCases, hint: shortcutHint('nav.reviewCases'), run: go(resolveShortcutWorkspaceHref('case', display, strategies)) },
      { id: 'n-weekly-review', group: '导航', icon: <CalendarDays size={ICON_MD} />, label: PRIMARY_NAV_LABELS.weeklyReview, keywords: '每周 周总结 复盘', hint: shortcutHint('nav.weeklyReview'), run: go(`/weekly-review${sharedTradeSearch}`) },
      { id: 'n-judgment-desk', group: '导航', icon: <RotateCcw size={ICON_MD} />, label: PRIMARY_NAV_LABELS.judgmentDesk, keywords: '规则 判断 对照 素材', hint: shortcutHint('nav.judgmentDesk'), run: go('/judgment-desk') },
      { id: 'n-review-composer', group: '导航', icon: <RotateCcw size={ICON_MD} />, label: PRIMARY_NAV_LABELS.reviewComposer, keywords: '离线 复盘 组合 模拟', hint: shortcutHint('nav.reviewComposer'), run: go('/review-composer') },
      { id: 'n-review-session', group: '导航', icon: <RotateCcw size={ICON_MD} />, label: PRIMARY_NAV_LABELS.reviewSession, keywords: '随机 抽卡 复盘', hint: shortcutHint('nav.reviewSession'), run: go('/review-session') },
      { id: 'n-dash', group: '导航', icon: <BarChart3 size={ICON_MD} />, label: PRIMARY_NAV_LABELS.dashboard, hint: shortcutHint('nav.dashboard'), run: go(`/dashboard${sharedTradeSearch}`) },
      { id: 'n-active', group: '交易日志', icon: <Clock size={ICON_MD} />, label: '显示进行中交易', hint: shortcutHint('nav.active'), run: go(sharedViewHref('active')) },
      { id: 'n-fav', group: '交易日志', icon: <Star size={ICON_MD} />, label: '显示星标交易', hint: shortcutHint('nav.favorites'), run: go(sharedViewHref('starred')) },
      { id: 'n-missed', group: '交易日志', icon: <Ban size={ICON_MD} />, label: '显示错过机会', hint: shortcutHint('nav.missed'), run: go(sharedViewHref('missed')) },
      { id: 'n-sim', group: '交易日志', icon: <FlaskConical size={ICON_MD} />, label: '切换到模拟盘记录', hint: shortcutHint('nav.sim'), run: go(`/list?${paperParams.toString()}`) },
    ]
    const periodNav: Cmd[] = CALENDAR_PERIODS.map((slug) => ({
      id: 'n-period-' + slug,
      group: '时间',
      icon: <Calendar size={ICON_MD} />,
      label: PERIOD_LABELS[slug],
      keywords: `period ${slug}`,
      run: go(`/period/${slug}${tradeHomeSearch(sharedTradeSearch)}`),
    }))
    const settingsNav: Cmd[] = [
      { id: 'n-strat', group: '设置', icon: <Settings2 size={ICON_MD} />, label: '管理策略', run: go('/settings/strategies') },
      { id: 'n-settings', group: '设置', icon: <Keyboard size={ICON_MD} />, label: '键盘快捷键', run: go('/settings/shortcuts') },
      {
        id: 'a-io',
        group: '设置',
        icon: <HardDriveDownload size={ICON_MD} />,
        label: '导入/导出数据',
        keywords: '备份 恢复 backup export import',
        run: () => { requestClose(); navigate('/settings/data') },
      },
    ]
    const actions: Cmd[] = [
      { id: 'a-new', group: '操作', icon: <Plus size={ICON_MD} />, label: '记录交易', hint: shortcutHint('global.newTrade'), run: () => { requestClose(); openComposer(null, newTradeKindForPath(pathname, search)) } },
      { id: 'a-new-case', group: '操作', icon: <BookOpen size={ICON_MD} />, label: '新建案例', hint: shortcutHint('global.newCase'), run: () => { requestClose(); openComposer(null, 'case') } },
      { id: 'a-fullscreen', group: '操作', icon: <Maximize2 size={ICON_MD} />, label: '切换应用全屏', hint: shortcutHint('global.toggleFullscreen'), run: () => {
        requestClose()
        const bridge = window.journalBridge
        if (bridge?.toggleFullscreen) void bridge.toggleFullscreen()
        else if (document.fullscreenElement) void document.exitFullscreen()
        else if (document.fullscreenEnabled) void document.documentElement.requestFullscreen()
      } },
    ]

    const contextActions: Cmd[] = []
    if (activeTrade) {
      const starred = activeTrade.tradeKind === 'case'
        ? isCaseFocused(activeTrade.id)
        : isStarred(activeTrade.id)
      contextActions.push({
        id: activeTrade.tradeKind === 'case' ? 'a-toggle-case-focus' : 'a-toggle-star',
        group: '当前记录',
        icon: activeTrade.tradeKind === 'case' ? <Bookmark size={ICON_MD} /> : <Star size={ICON_MD} />,
        label: activeTrade.tradeKind === 'case'
          ? (starred ? '取消重点' : '设为重点案例')
          : (starred ? '取消星标' : '加入星标'),
        keywords: activeTrade.tradeKind === 'case' ? '重点 案例 focus' : '收藏 星标 star',
        run: () => {
          if (activeTrade.tradeKind === 'case') toggleCaseFocus(activeTrade.id)
          else toggleStar(activeTrade.id)
          requestClose()
          toast(activeTrade.tradeKind === 'case'
            ? (starred ? '已取消重点' : '已设为重点案例')
            : (starred ? '已取消星标' : '已加入星标'))
        },
      })
      for (const status of STATUS_ORDER) {
        if (status === activeTrade.status) continue
        contextActions.push({
          id: `a-status-${status}`,
          group: '当前记录',
          icon: <StatusIcon status={status} size={ICON_MD} />,
          label: `改为${STATUS_META[status].label}`,
          keywords: `状态 ${STATUS_META[status].label}`,
          run: () => {
            if (status === 'open') {
              const transientOpener = inputRef.current
              closeImmediately()
              requestAnimationFrame(() => requestTradeOpen(activeTrade.id, transientOpener))
              return
            }
            transitionTradeStatus(activeTrade, status as TradeStatus, {
              setStatus,
              requestTradeOpen,
              requestTradeClose,
              toast,
            })
            requestClose()
          },
        })
      }
    }

    const query = deferredQuery.trim()
    if (!query) {
      const commands = [...contextActions, ...actions, ...viewNav, ...settingsNav]
      return { commands, total: commands.length }
    }

    const resolveStrategyName = (strategyId: string | undefined) =>
      (strategyId ? strategyNames.get(strategyId) : undefined) ?? '未分类'
    const tradeCommand = (trade: (typeof trades)[number]): Cmd => ({
      id: 't-' + trade.id,
      group: dateQuery.kind === 'date' ? dateQuery.label : '交易',
      icon: <StatusIcon status={trade.status} size={ICON_MD} />,
      label: `${trade.symbol} · ${resolveStrategyName(trade.strategyId)}`,
      hint: trade.ref,
      date: trade.openedAt.slice(0, 10),
      source: trade.tradeKind === 'case' ? '案例' : trade.tradeKind === 'paper' ? '模拟盘' : '日志',
      run: () => {
        const session = { ...sessionRef.current, activeId: 't-' + trade.id, scrollTop: listRef.current?.scrollTop ?? 0 }
        onNavigateResult(session)
        navigate(tradeDetailPath(trade), { state: { commandSearch: session } })
        requestClose()
      },
    })
    if (dateQuery.kind === 'incomplete' || dateQuery.kind === 'invalid') return { commands: [], total: 0 }
    if (dateQuery.kind === 'date') {
      return { commands: matchingTrades.slice(0, limit).map(tradeCommand), total: matchingTrades.length }
    }

    const fixedCommands = [...contextActions, ...viewNav, ...periodNav, ...settingsNav, ...actions]
      .filter((command) => matchesSearchQuery(query, command.label, command.hint, command.keywords))
    const commands = fixedCommands.slice(0, limit)
    let total = fixedCommands.length

    const strategyMatches = collectLimitedCommandMatches(
      sortStrategies(strategies, []),
      query,
      (strategy) => [strategy.name, `strategy ${strategy.name}`],
      (strategy): Cmd => ({
        id: 'strat-' + strategy.id,
        group: '策略',
        icon: <StrategyIcon icon={strategy.icon} color={strategy.color} size={ICON_MD} variant="nav" />,
        label: strategy.name,
        hint: `${strategyCounts.get(strategy.id) ?? 0} 笔交易`,
        keywords: `strategy ${strategy.name}`,
        run: go(`/strategy/${strategy.id}`),
      }),
      limit - commands.length,
    )
    commands.push(...strategyMatches.items)
    total += strategyMatches.total

    const tagMatches = collectLimitedCommandMatches(
      tagCandidates,
      query,
      (candidate) => [candidate.tag],
      (candidate): Cmd => {
        const { tag } = candidate
        return {
          id: `tag-${candidate.kind}-${tag}`,
          group: candidate.group,
          icon: <Tag size={ICON_MD} />,
          label: tag,
          hint: `${candidate.count} ${candidate.unit}`,
          keywords: tag,
          run: go(`${candidate.path}?${new URLSearchParams({ tag }).toString()}`),
        }
      },
      limit - commands.length,
    )
    commands.push(...tagMatches.items)
    total += tagMatches.total

    commands.push(...matchingTrades.slice(0, Math.max(0, limit - commands.length)).map(tradeCommand))
    total += matchingTrades.length

    commands.push(...matchingNotes.slice(0, Math.max(0, limit - commands.length)).map((note): Cmd => ({
        id: 'note-' + note.id,
        group: '随记',
        icon: <FileText size={ICON_MD} />,
        label: note.title.trim() || '未命名随记',
        hint: textFromQuickNoteHtml(note.contentHtml).slice(0, 48) || undefined,
        keywords: '随记 笔记 灵感',
        run: go(`/notes/${note.id}`),
      })))
    total += matchingNotes.length

    const savedViewMatches = collectLimitedCommandMatches(
      savedTradeViews,
      query,
      (view) => [
        view.name,
        suggestSavedViewName(
          view.pathname,
          new URLSearchParams(view.search),
          view.search.strategyId
            ? strategyNames.get(view.search.strategyId)
            : undefined,
        ),
      ],
      (view): Cmd => ({
        id: 'saved-view-' + view.id,
        group: '保存的视图',
        icon: <Bookmark size={ICON_MD} />,
        label: view.name,
        hint: suggestSavedViewName(
          view.pathname,
          new URLSearchParams(view.search),
          view.search.strategyId
            ? strategyNames.get(view.search.strategyId)
            : undefined,
        ),
        keywords: '保存视图 筛选',
        run: go(`${normalizeSavedViewPath(view.pathname)}${savedViewSearch(view)}`),
      }),
      limit - commands.length,
    )
    commands.push(...savedViewMatches.items)
    total += savedViewMatches.total

    return { commands, total }
  }, [
    activeTrade,
    closeImmediately,
    deferredQuery,
    display,
    isStarred,
    isCaseFocused,
    navigate,
    openComposer,
    pathname,
    search,
    requestClose,
    requestTradeClose,
    requestTradeOpen,
    setStatus,
    shortcutBindings,
    strategies,
    toggleStar,
    toggleCaseFocus,
    trades,
    quickNotes,
    savedTradeViews,
    dateQuery,
    limit,
    onNavigateResult,
    strategyNames,
    strategyCounts,
    tagCandidates,
    matchingTrades,
    matchingNotes,
  ])

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

  const updateQuery = (value: string) => {
    setQ(value)
    setActive(0)
    setLimit(MAX_SEARCH_RESULTS)
    if (listRef.current) listRef.current.scrollTop = 0
  }

  useEffect(() => {
    const restoredActive = initialSession?.activeId
      ? commands.findIndex((command) => command.id === initialSession.activeId) : -1
    if (restoredActive >= 0) setActive(restoredActive)
    const frame = requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = initialSession?.scrollTop ?? 0
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (queryPending || closing) return
    sessionRef.current = { query: q, limit, activeId: visibleCommands[active]?.id, scrollTop: listRef.current?.scrollTop ?? 0, origin: origin.current }
    onRemember(sessionRef.current)
  }, [q, limit, active, visibleCommands, queryPending, closing, onRemember])

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, visibleCommands.length - 1)))
  }, [visibleCommands.length])

  // 选中项滚动可见
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.cmdk-item.is-active')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!queryPending && hasMore && active === visibleCommands.length - 1) {
        setLimit((current) => current + MAX_SEARCH_RESULTS)
        setActive(active + 1)
      } else setActive((a) => Math.min(a + 1, Math.max(0, visibleCommands.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      visibleCommands[active]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      requestClose()
    }
  }

  // 分组渲染
  let lastGroup = ''
  let flatIndex = -1

  return createPortal(
    <div className={`cmdk-overlay${closing ? ' is-closing' : ''}`} role="presentation" onMouseDown={requestClose}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="搜索与命令"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.stopPropagation()
            requestClose()
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
          <Search size={ICON_MD} className="cmdk-search-icon" />
          <input
            ref={inputRef}
            className="cmdk-input"
            role="combobox"
            aria-label="搜索与命令"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            placeholder="搜索交易、日期（如 202405）、跳转视图…"
            value={q}
            onChange={(e) => updateQuery(e.target.value)}
            aria-invalid={dateQuery.kind === 'invalid' && !queryPending || undefined}
            aria-describedby={q.trim() ? `${listboxId}-status` : undefined}
            onKeyDown={onKey}
          />
          {q ? (
            <button
              type="button"
              className="cmdk-clear"
              onClick={() => { updateQuery(''); inputRef.current?.focus() }}
              aria-label="清除搜索"
            >
              <X size={ICON_SM} />
            </button>
          ) : null}
        </div>
        <div
          id={listboxId}
          className="cmdk-list"
          ref={listRef}
          role="listbox"
          aria-label="命令结果"
          aria-busy={queryPending}
          onScroll={() => {
            sessionRef.current = { ...sessionRef.current, scrollTop: listRef.current?.scrollTop ?? 0 }
            onRemember(sessionRef.current)
          }}
        >
          {visibleCommands.length === 0 && !queryPending && (
            <div className="cmdk-empty" id={`${listboxId}-status`} role="status">
              {dateQuery.kind === 'incomplete' || dateQuery.kind === 'invalid' ? dateQuery.message
                : dateQuery.kind === 'date' ? `${dateQuery.label}没有匹配的记录` : '没有匹配项'}
            </div>
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
                  {c.date && <span className="cmdk-item-date">{c.date}</span>}
                  <OverflowTooltip text={c.label}>
                    <span className="cmdk-item-label">{c.label}</span>
                  </OverflowTooltip>
                  {c.source && <span className="cmdk-item-source">{c.source}</span>}
                  {c.hint ? (
                    <OverflowTooltip text={c.hint}>
                      <span className="cmdk-item-hint">{c.hint}</span>
                    </OverflowTooltip>
                  ) : null}
                  {idx === active && (
                    <CornerDownLeft size={ICON_SM} className="cmdk-item-enter" />
                  )}
                </button>
              </div>
            )
          })}
        </div>
          {(queryPending || visibleCommands.length > 0 && q.trim()) && (
            <div className="cmdk-result-note">
              <span id={`${listboxId}-status`} role="status">
              {queryPending
                ? '正在筛选…'
                : `已显示 ${commands.length} / ${searchResult.total} 项`}
              </span>
              {!queryPending && hasMore && <Button size="sm" onClick={() => {
                setLimit((current) => current + MAX_SEARCH_RESULTS)
                inputRef.current?.focus()
              }}>加载更多</Button>}
            </div>
          )}
      </div>
    </div>,
    document.body,
  )
}
