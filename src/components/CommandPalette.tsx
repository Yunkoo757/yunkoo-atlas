import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  ListTodo,
  LayoutGrid,
  BarChart3,
  Plus,
  CornerDownLeft,
  Search,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
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
  const openComposer = useStore((s) => s.openComposer)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands = useMemo<Cmd[]>(() => {
    const go = (to: string) => () => {
      navigate(to)
      onClose()
    }
    const nav: Cmd[] = [
      { id: 'n-list', group: '导航', icon: <ListTodo size={16} />, label: '交易列表', hint: 'G then L', run: go('/list') },
      { id: 'n-board', group: '导航', icon: <LayoutGrid size={16} />, label: '看板', hint: 'G then B', run: go('/board') },
      { id: 'n-dash', group: '导航', icon: <BarChart3 size={16} />, label: '仪表盘', hint: 'G then D', run: go('/dashboard') },
    ]
    const actions: Cmd[] = [
      { id: 'a-new', group: '操作', icon: <Plus size={16} />, label: '新建交易', hint: 'C', run: () => { onClose(); openComposer() } },
    ]
    const tradeCmds: Cmd[] = trades.map((t) => ({
      id: 't-' + t.id,
      group: '交易',
      icon: <StatusIcon status={t.status} size={16} />,
      label: `${t.symbol} · ${t.strategy}`,
      hint: t.ref,
      keywords: `${t.ref} ${t.symbol} ${t.strategy} ${t.tags.join(' ')}`,
      run: go(`/trade/${t.id}`),
    }))
    return [...nav, ...actions, ...tradeCmds]
  }, [trades, navigate, onClose, openComposer])

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return commands
    return commands.filter((c) =>
      (c.label + ' ' + (c.hint ?? '') + ' ' + (c.keywords ?? ''))
        .toLowerCase()
        .includes(k),
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
        <div className="cmdk-input-row">
          <Search size={16} className="cmdk-search-icon" />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="搜索交易、跳转视图…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
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
