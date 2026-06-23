import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
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
  CircleDot,
  X,
  Keyboard,
  Gavel,
} from 'lucide-react'
import { tradeDetailPath } from '@/lib/tradeRoute'
import { getStrategyName, countTradesByStrategy, sortStrategies } from '@/lib/strategies'
import { StrategyIcon } from '@/components/StrategyIcon'
import { collectAllTags } from '@/lib/tags'
import { matchesSearchQuery } from '@/lib/tradeFilters'
import { CALENDAR_PERIODS, PERIOD_LABELS } from '@/lib/periods'
import { useStore } from '@/store/useStore'
import { getShortcutHint } from '@/shortcuts/ShortcutHost'
import { formatCaseId, deriveOutcome, getDisputeType } from '@/data/case'
import { StatusIcon, SideTag } from '@/components/StatusIcon'
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

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const trades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const cases = useStore((s) => s.cases)
  const disputeTypes = useStore((s) => s.disputeTypes)
  const openComposer = useStore((s) => s.openComposer)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands = useMemo<Cmd[]>(() => {
    const go = (to: string) => () => {
      navigate(to)
      onClose()
    }
    const viewNav: Cmd[] = [
      { id: 'n-list', group: '导航', icon: <ListTodo size={16} />, label: '全部交易', hint: '实盘', run: go('/list') },
      { id: 'n-active', group: '导航', icon: <CircleDot size={16} />, label: '进行中', hint: '计划 + 持仓', run: go('/active') },
      { id: 'n-dash', group: '导航', icon: <BarChart3 size={16} />, label: '仪表盘', run: go('/dashboard') },
      { id: 'n-fav', group: '导航', icon: <Star size={16} />, label: '星标交易', run: go('/favorites') },
      { id: 'n-missed', group: '导航', icon: <Ban size={16} />, label: '错过的机会', run: go('/missed') },
      { id: 'n-sim', group: '导航', icon: <FlaskConical size={16} />, label: '模拟回测', run: go('/sim') },
    ]
    const periodNav: Cmd[] = CALENDAR_PERIODS.map((slug) => ({
      id: 'n-period-' + slug,
      group: '时间',
      icon: <Calendar size={16} />,
      label: PERIOD_LABELS[slug],
      keywords: `period ${slug}`,
      run: go(`/period/${slug}`),
    }))
    const strategyNav: Cmd[] = sortStrategies(strategies, []).map((s) => {
      const count = countTradesByStrategy(trades, s.id)
      return {
        id: 'strat-' + s.id,
        group: '策略',
        icon: <StrategyIcon icon={s.icon} color={s.color} size={16} variant="nav" />,
        label: s.name,
        hint: `${count} 笔交易`,
        keywords: `strategy ${s.name}`,
        run: go(`/strategy/${s.id}`),
      }
    })
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
      { id: 'a-new', group: '操作', icon: <Plus size={16} />, label: '新建交易', hint: getShortcutHint('global.newTrade') ?? 'C', run: () => { onClose(); openComposer() } },
    ]
    const tradeCmds: Cmd[] = trades.map((t) => {
      const stratName = getStrategyName(strategies, t.strategyId)
      return {
      id: 't-' + t.id,
      group: '交易',
      icon: <StatusIcon status={t.status} size={16} />,
      label: `${t.symbol} · ${stratName}`,
      hint: t.ref,
      keywords: `${t.ref} ${t.symbol} ${stratName} ${t.tags.join(' ')}`,
      run: go(tradeDetailPath(t)),
    }})
    const tagCmds: Cmd[] = collectAllTags(trades).map((tag) => {
      const count = trades.filter((t) => t.tags.includes(tag)).length
      const first = trades.find((t) => t.tags.includes(tag))
      return {
        id: 'tag-' + tag,
        group: '标签',
        icon: <Tag size={16} />,
        label: tag,
        hint: `${count} 笔交易`,
        keywords: tag,
        run: first ? go(tradeDetailPath(first)) : () => {},
      }
    })
    const caseCmds: Cmd[] = cases.map((c) => {
      const dt = getDisputeType(c.disputeTypeId, disputeTypes)
      const outcome = deriveOutcome(c, dt)
      return {
        id: 'case-' + c.id,
        group: '判例',
        icon: <Gavel size={16} />,
        label: `${formatCaseId(c.id)} · ${dt?.name ?? '未知'}`,
        hint: `${outcome} · ${c.confidence}%`,
        keywords: `${formatCaseId(c.id)} ${dt?.name ?? ''} ${c.tags?.join(' ') ?? ''}`,
        run: go(`/cases?case=${c.id}`),
      }
    })
    return [...viewNav, ...periodNav, ...strategyNav, ...settingsNav, ...actions, ...tagCmds, ...caseCmds, ...tradeCmds]
  }, [trades, strategies, cases, disputeTypes, navigate, onClose, openComposer])

  const filtered = useMemo(() => {
    if (!q.trim()) return commands
    return commands.filter((c) =>
      matchesSearchQuery(q, c.label, c.hint, c.keywords),
    )
  }, [q, commands])

  // 打开时重置
  useEffect(() => {
    if (open) {
      setQ('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => setActive(0), [q])

  // 选中项滚动可见
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.cmdk-item.is-active')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      filtered[active]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // 分组渲染
  let lastGroup = ''
  let flatIndex = -1

  return createPortal(
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <div className={'cmdk-input-row' + (q ? ' has-value' : '')}>
          <Search size={16} className="cmdk-search-icon" />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="搜索交易、跳转视图…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <button
            className="cmdk-clear"
            onClick={() => { setQ(''); inputRef.current?.focus() }}
            tabIndex={-1}
            aria-label="清除搜索"
          >
            <X size={14} />
          </button>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="cmdk-empty">没有匹配项</div>
          )}
          {filtered.map((c) => {
            flatIndex++
            const idx = flatIndex
            const showHeader = c.group !== lastGroup
            lastGroup = c.group
            return (
              <div key={c.id}>
                {showHeader && <div className="cmdk-group">{c.group}</div>}
                <button
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
        </div>
      </div>
    </div>,
    document.body,
  )
}
