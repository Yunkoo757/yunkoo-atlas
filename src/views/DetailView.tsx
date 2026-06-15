import { useParams, Link, useNavigate } from 'react-router-dom'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Link2,
  MoreHorizontal,
  Star,
  Bell,
  Copy,
  ArrowUp,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Editor } from '@/editor/Editor'
import { Menu } from '@/components/Menu'
import { IconButton } from '@/components/IconButton'
import { TagEditor } from '@/components/TagEditor'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import { StrategyIcon, StrategyLabel } from '@/components/StrategyIcon'
import type { Strategy } from '@/data/strategies'
import {
  STATUS_META,
  CONVICTION_META,
  TRADE_KIND_META,
  MISS_REASON_META,
  type TradeStatus,
  type Conviction,
  type TradeSide,
  type TradeKind,
  type MissReason,
  type ActivityEvent,
  type ActivityKind,
} from '@/data/trades'
import { fmtMoney, fmtR, fmtPrice, fmtDate, fmtDateTime } from '@/lib/format'
import { getStrategyName } from '@/lib/strategies'
import { getTradeActivities } from '@/lib/activities'
import { findTradeByRouteParam, tradeDetailPath } from '@/lib/tradeRoute'
import { collectAllTags } from '@/lib/tags'
import { toast } from '@/lib/toast'
import { syncStatusFromPnl } from '@/lib/tradeTransition'
import { STATUS_ORDER, isTerminal } from '@/lib/tradeStatus'
import { DEFAULT_REVIEW_TEMPLATE_HTML } from '@/lib/reviewTemplates'
import { getStorage, normalizeNoteForStorage, resolveNoteForDisplay } from '@/storage'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { useSaveStatus } from '@/store/saveStatus'
import './DetailView.css'

const STATUS_OPTS: TradeStatus[] = STATUS_ORDER
const CONV_OPTS: Conviction[] = ['urgent', 'high', 'medium', 'low']
const KIND_OPTS: TradeKind[] = ['live', 'paper', 'practice']
const MISS_OPTS: MissReason[] = ['hesitation', 'missed_setup', 'no_alert', 'rule_break', 'other']

export function DetailView() {
  const { id: routeParam } = useParams()
  const navigate = useNavigate()
  const trades = useStore((s) => s.trades)
  const trade = useMemo(
    () => findTradeByRouteParam(trades, routeParam),
    [trades, routeParam],
  )
  const updateNote = useStore((s) => s.updateNote)
  const updateTradeData = useStore((s) => s.updateTradeData)
  const setStatus = useStore((s) => s.setStatus)
  const setConviction = useStore((s) => s.setConviction)
  const setStrategy = useStore((s) => s.setStrategy)
  const strategies = useStore((s) => s.strategies)
  const setSide = useStore((s) => s.setSide)
  const addTag = useStore((s) => s.addTag)
  const removeTag = useStore((s) => s.removeTag)
  const addComment = useStore((s) => s.addComment)
  const removeComment = useStore((s) => s.removeComment)
  const toggleStar = useStore((s) => s.toggleStar)
  const toggleSubscribe = useStore((s) => s.toggleSubscribe)
  const openComposer = useStore((s) => s.openComposer)
  const removeTrade = useStore((s) => s.removeTrade)
  const starredIds = useStore((s) => s.starredIds)
  const subscribedIds = useStore((s) => s.subscribedIds)
  const [comment, setComment] = useState('')
  const [editorHtml, setEditorHtml] = useState('')
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!trade || !routeParam || routeParam === trade.ref) return
    navigate(tradeDetailPath(trade), { replace: true })
  }, [trade, routeParam, navigate])

  const persistEditorNote = useCallback(
    (html: string, tradeId: string) => {
      if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current)
      noteSaveTimer.current = setTimeout(async () => {
        const normalized = await normalizeNoteForStorage(html, getStorage())
        const current = useStore.getState().trades.find((t) => t.id === tradeId)
        if (current && normalized !== current.note) updateNote(tradeId, normalized)
      }, 400)
    },
    [updateNote],
  )

  useEffect(() => {
    if (!trade) return
    let cancelled = false
    resolveNoteForDisplay(trade.note, getStorage()).then((html) => {
      if (!cancelled) setEditorHtml(html)
    })
    return () => {
      cancelled = true
    }
  }, [trade?.id])

  useEffect(() => {
    return () => {
      if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current)
    }
  }, [])

  const onEditorChange = useCallback(
    (html: string) => {
      setEditorHtml(html)
      if (!trade?.id) return
      useSaveStatus.getState().setDirty()
      persistEditorNote(html, trade.id)
    },
    [trade?.id, persistEditorNote],
  )

  const starred = trade ? starredIds.includes(trade.id) : false
  const subscribed = trade ? subscribedIds.includes(trade.id) : false
  const allTags = useMemo(() => collectAllTags(trades), [trades])

  const feedItems = useMemo(() => {
    if (!trade) return []
    return getTradeActivities(trade).map((event) => ({
      event,
      node: renderActivity(event, strategies),
    }))
  }, [trade, strategies])

  if (!trade) {
    return (
      <>
        <header className="dv-topbar">
          <div className="dv-tb-left">
            <Link to="/list" className="dv-back">
              <ChevronLeft size={16} />
            </Link>
            <span className="dv-crumb">交易</span>
            <ChevronRight size={13} className="dv-crumb-sep" />
            <span className="dv-crumb dv-crumb-active">未找到</span>
          </div>
        </header>
        <div className="dv-empty">未找到该交易</div>
      </>
    )
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('链接已复制')
    } catch {
      toast('复制失败')
    }
  }

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(trade.ref)
      toast(`已复制 ${trade.ref}`)
    } catch {
      toast('复制失败')
    }
  }

  const sendComment = () => {
    if (!comment.trim()) return
    addComment(trade.id, comment)
    setComment('')
    toast('评论已发布')
  }

  const onDelete = () => {
    if (!window.confirm(`确定删除 ${trade.ref}？`)) return
    removeTrade(trade.id)
    toast('交易已删除')
    navigate('/list')
  }

  return (
    <>
      <header className="dv-topbar">
        <div className="dv-tb-left">
          <Link to="/list" className="dv-back">
            <ChevronLeft size={16} />
          </Link>
          <span className="dv-crumb">交易</span>
          <ChevronRight size={13} className="dv-crumb-sep" />
          <span className="dv-crumb dv-crumb-active">{trade.ref}</span>
        </div>
        <div className="dv-tb-right">
          <SaveStatusIndicator />
          <IconButton title="复制链接" onClick={copyLink}>
            <Link2 size={15} />
          </IconButton>
          <IconButton
            title={starred ? '取消收藏' : '收藏'}
            active={starred}
            onClick={() => {
              toggleStar(trade.id)
              toast(starred ? '已取消收藏' : '已加入收藏')
            }}
          >
            <Star size={15} fill={starred ? 'currentColor' : 'none'} />
          </IconButton>
          <IconButton
            title={subscribed ? '取消置顶关注' : '置顶关注'}
            active={subscribed}
            onClick={() => {
              toggleSubscribe(trade.id)
              toast(subscribed ? '已取消置顶关注' : '已加入关注列表')
            }}
          >
            <Bell size={15} fill={subscribed ? 'currentColor' : 'none'} />
          </IconButton>
          <Menu
            align="right"
            options={[
              { value: 'edit', label: '编辑交易', icon: <Pencil size={16} /> },
              { value: 'copy', label: '复制编号', icon: <Copy size={16} /> },
              { value: 'delete', label: '删除交易', icon: <Trash2 size={16} /> },
            ]}
            onSelect={(v) => {
              if (v === 'edit') openComposer(trade)
              else if (v === 'copy') copyRef()
              else if (v === 'delete') onDelete()
            }}
            trigger={
              <IconButton title="更多">
                <MoreHorizontal size={15} />
              </IconButton>
            }
          />
        </div>
      </header>

      <div className="dv-body">
        <div className="dv-main">
          <div className="dv-main-inner">
            <h1 className="dv-title">
              {trade.symbol}
              <SideTag side={trade.side} />
            </h1>

            {!trade.note.trim() && (
              <button
                type="button"
                className="dv-template-btn"
                onClick={() => {
                  const strat = strategies.find((s) => s.id === trade.strategyId)
                  const html = strat?.reviewTemplateHtml ?? DEFAULT_REVIEW_TEMPLATE_HTML
                  setEditorHtml(html)
                  if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current)
                  void normalizeNoteForStorage(html, getStorage()).then((normalized) => {
                    updateNote(trade.id, normalized)
                  })
                  toast('已填入复盘结构')
                }}
              >
                使用策略模板
              </button>
            )}

            <Editor
              content={editorHtml}
              onChange={onEditorChange}
            />

            <section className="dv-activity">
              <ul className="dv-feed">
                {feedItems.map(({ event, node }) => (
                  <FeedItem
                    key={event.id}
                    kind={event.kind}
                    deletable={event.kind === 'comment'}
                    onDelete={
                      event.kind === 'comment' && event.commentId
                        ? () => {
                            removeComment(trade.id, event.commentId!)
                            toast('评论已删除')
                          }
                        : undefined
                    }
                  >
                    {node}
                  </FeedItem>
                ))}
              </ul>

              <div className="dv-comment">
                <div className="dv-comment-avatar">Y</div>
                <div className="dv-comment-box">
                  <textarea
                    className="dv-comment-input"
                    placeholder="留下复盘评论…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendComment()
                      }
                    }}
                    rows={1}
                  />
                  <div className="dv-comment-bar">
                    <button
                      className="dv-comment-send"
                      disabled={!comment.trim()}
                      onClick={sendComment}
                      title="发送"
                    >
                      <ArrowUp size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <aside className="dv-props">
          <Section title="属性">
            <Menu
              value={trade.status}
              onSelect={(v) => setStatus(trade.id, v as TradeStatus)}
              options={STATUS_OPTS.map((s) => ({
                value: s,
                label: STATUS_META[s].label,
                icon: <StatusIcon status={s} size={16} />,
              }))}
              trigger={
                <button className="dv-pitem">
                  <StatusIcon status={trade.status} size={16} />
                  <span>{STATUS_META[trade.status].label}</span>
                </button>
              }
            />
            <Menu
              value={trade.conviction}
              onSelect={(v) => setConviction(trade.id, v as Conviction)}
              options={CONV_OPTS.map((c) => ({
                value: c,
                label: CONVICTION_META[c].label,
                icon: <ConvictionIcon conviction={c} size={16} />,
              }))}
              trigger={
                <button className="dv-pitem">
                  <ConvictionIcon conviction={trade.conviction} size={16} />
                  <span>信心度 {CONVICTION_META[trade.conviction].label}</span>
                </button>
              }
            />
            <Menu
              value={trade.side}
              onSelect={(v) => setSide(trade.id, v as TradeSide)}
              options={[
                { value: 'long', label: '做多' },
                { value: 'short', label: '做空' },
              ]}
              trigger={
                <button className="dv-pitem">
                  <SideTag side={trade.side} />
                  <span>{trade.side === 'long' ? '做多' : '做空'}</span>
                </button>
              }
            />
            <Menu
              value={trade.tradeKind}
              onSelect={(v) => updateTradeData(trade.id, { tradeKind: v as TradeKind })}
              options={KIND_OPTS.map((k) => ({
                value: k,
                label: TRADE_KIND_META[k].label,
              }))}
              trigger={
                <button className="dv-pitem dv-pitem-ghost">
                  <span>{TRADE_KIND_META[trade.tradeKind].label}</span>
                </button>
              }
            />
            {trade.status === 'missed' && (
              <Menu
                value={trade.missReason ?? 'other'}
                onSelect={(v) => updateTradeData(trade.id, { missReason: v as MissReason })}
                options={MISS_OPTS.map((r) => ({
                  value: r,
                  label: MISS_REASON_META[r].label,
                }))}
                trigger={
                  <button className="dv-pitem dv-pitem-ghost">
                    <span>错过原因 · {MISS_REASON_META[trade.missReason ?? 'other'].label}</span>
                  </button>
                }
              />
            )}
          </Section>

          <Section title="交易数据">
            <EditableDataRow
              label="入场"
              value={trade.entry}
              format={(v) => fmtPrice(v as number)}
              inputType="number"
              onSave={(v) => updateTradeData(trade.id, { entry: v as number })}
            />
            <EditableDataRow
              label="出场"
              value={trade.exit}
              format={(v) => (v == null ? '—' : fmtPrice(v as number))}
              inputType="number"
              nullable
              onSave={(v) => updateTradeData(trade.id, { exit: v as number | null })}
            />
            <EditableDataRow
              label="仓位"
              value={trade.size}
              format={String}
              inputType="number"
              onSave={(v) => updateTradeData(trade.id, { size: v as number })}
            />
            <EditableDataRow
              label="止损"
              value={trade.stopLoss ?? null}
              format={(v) => (v == null ? '—' : fmtPrice(v))}
              inputType="number"
              nullable
              onSave={(v) => updateTradeData(trade.id, { stopLoss: v })}
            />
            <EditableDataRow
              label="盈亏"
              value={trade.pnl}
              format={(v) =>
                trade.status === 'planned' || trade.status === 'open'
                  ? '—'
                  : fmtMoney(v as number)
              }
              inputType="number"
              color={
                trade.pnl > 0
                  ? 'var(--pos)'
                  : trade.pnl < 0
                    ? 'var(--neg)'
                    : undefined
              }
              onSave={(v) => {
                const pnl = v as number
                updateTradeData(trade.id, { pnl })
                syncStatusFromPnl(trade, pnl, setStatus)
              }}
            />
            <EditableDataRow
              label="R 倍数"
              value={trade.rMultiple}
              format={(v) =>
                trade.status === 'planned' || trade.status === 'open'
                  ? '—'
                  : fmtR(v as number)
              }
              inputType="number"
              step="0.1"
              onSave={(v) => updateTradeData(trade.id, { rMultiple: v as number })}
            />
          </Section>

          <Section title="时间">
            <EditableDateRow
              label="开仓"
              value={trade.openedAt}
              onSave={(v) => updateTradeData(trade.id, { openedAt: v })}
            />
            {isTerminal(trade.status) ? (
              <EditableDateRow
                label="平仓"
                value={trade.closedAt ?? trade.openedAt}
                onSave={(v) => updateTradeData(trade.id, { closedAt: v })}
              />
            ) : (
              <DataRow label="平仓" value="—" />
            )}
          </Section>

          <Section title="标签">
            <TagEditor
              tags={trade.tags}
              suggestions={allTags}
              onAdd={(tag) => addTag(trade.id, tag)}
              onRemove={(tag) => removeTag(trade.id, tag)}
            />
          </Section>

          <Section title="项目">
            <Menu
              value={trade.strategyId}
              onSelect={(v) => setStrategy(trade.id, v)}
              options={strategies.map((s) => ({
                value: s.id,
                label: s.name,
                icon: <StrategyIcon icon={s.icon} color={s.color} size={16} />,
              }))}
              trigger={
                <button className="dv-pitem dv-pitem-ghost">
                  <StrategyLabel strategyId={trade.strategyId} strategies={strategies} />
                </button>
              }
            />
            <Link to="/strategies" className="dv-strategy-manage">
              管理策略…
            </Link>
          </Section>

          <div className="dv-props-foot">
            <button className="dv-copy-id" onClick={copyRef}>
              <Copy size={13} />
              <span>复制 {trade.ref}</span>
            </button>
          </div>
        </aside>
      </div>
    </>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="dv-section">
      <button className="dv-section-head" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <ChevronDown
          size={13}
          className={'dv-section-chev' + (open ? '' : ' is-closed')}
        />
      </button>
      {open && <div className="dv-section-body">{children}</div>}
    </div>
  )
}

function EditableDataRow({
  label,
  value,
  format,
  inputType = 'text',
  step,
  nullable,
  color,
  onSave,
}: {
  label: string
  value: number | null
  format: (v: number | null) => string
  inputType?: 'number' | 'text'
  step?: string
  nullable?: boolean
  color?: string
  onSave: (v: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    setDraft(value == null ? '' : String(value))
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (nullable && draft.trim() === '') {
      if (value !== null) onSave(null)
      return
    }
    const num = parseFloat(draft)
    if (isNaN(num)) return
    if (num !== value) onSave(num)
  }

  if (editing) {
    return (
      <div className="dv-datarow dv-datarow-edit">
        <span className="dv-datarow-label">{label}</span>
        <input
          ref={inputRef}
          className="dv-datarow-input"
          type={inputType}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <button className="dv-datarow dv-datarow-btn" onClick={startEdit} type="button">
      <span className="dv-datarow-label">{label}</span>
      <span className="dv-datarow-value" style={color ? { color } : undefined}>
        {format(value)}
      </span>
    </button>
  )
}

function EditableDateRow({
  label,
  value,
  onSave,
}: {
  label: string
  value: string
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value.slice(0, 10))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const d = draft.slice(0, 10)
    if (d && d !== value.slice(0, 10)) onSave(d)
  }

  if (editing) {
    return (
      <div className="dv-datarow dv-datarow-edit">
        <span className="dv-datarow-label">{label}</span>
        <input
          ref={inputRef}
          className="dv-datarow-input"
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <button className="dv-datarow dv-datarow-btn" onClick={() => setEditing(true)} type="button">
      <span className="dv-datarow-label">{label}</span>
      <span className="dv-datarow-value">{fmtDate(value)}</span>
    </button>
  )
}

function DataRow({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="dv-datarow">
      <span className="dv-datarow-label">{label}</span>
      <span className="dv-datarow-value" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  )
}

function renderActivity(
  event: ActivityEvent,
  strategies: Strategy[],
): React.ReactNode {
  const time = fmtDateTime(event.timestamp)
  switch (event.kind) {
    case 'create':
      return (
        <>
          你 <b>创建</b>了这笔交易 · {fmtDate(event.timestamp)}
        </>
      )
    case 'status':
      return (
        <>
          你将状态改为 <b>{STATUS_META[event.status!].label}</b> · {time}
        </>
      )
    case 'strategy':
      return (
        <>
          你将策略改为 <b>{getStrategyName(strategies, event.strategyId)}</b> · {time}
        </>
      )
    case 'tag':
      return event.tagAction === 'remove' ? (
        <>
          你移除了标签 <b>{event.tag}</b> · {time}
        </>
      ) : (
        <>
          你添加了标签 <b>{event.tag}</b> · {time}
        </>
      )
    case 'comment':
      return (
        <>
          你 <b>评论</b>：{event.text} · {time}
        </>
      )
    case 'note':
      return (
        <>
          你 <b>更新了复盘笔记</b> · {time}
        </>
      )
    default:
      return null
  }
}

function FeedItem({
  kind,
  children,
  deletable,
  onDelete,
}: {
  kind: ActivityKind
  children: React.ReactNode
  deletable?: boolean
  onDelete?: () => void
}) {
  const handleContextMenu = (e: React.MouseEvent) => {
    if (!deletable || !onDelete) return
    e.preventDefault()
    if (window.confirm('删除这条评论？')) onDelete()
  }

  return (
    <li
      className={'dv-feed-item' + (deletable ? ' dv-feed-item-deletable' : '')}
      onContextMenu={handleContextMenu}
    >
      <span className={'dv-feed-dot dv-feed-dot-' + kind} />
      <span className="dv-feed-text">{children}</span>
      {deletable && onDelete && (
        <button
          type="button"
          className="dv-feed-delete"
          title="删除评论"
          onClick={onDelete}
        >
          <X size={13} />
        </button>
      )}
    </li>
  )
}
