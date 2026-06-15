import { useParams, Link } from 'react-router-dom'
import { useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Link2,
  MoreHorizontal,
  Star,
  Bell,
  Copy,
  Tag,
  Box,
  ArrowUp,
  Paperclip,
  Plus,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Editor } from '@/editor/Editor'
import { Menu } from '@/components/Menu'
import { IconButton } from '@/components/IconButton'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import {
  STATUS_META,
  CONVICTION_META,
  type TradeStatus,
  type Conviction,
} from '@/data/trades'
import { fmtMoney, fmtR, fmtPrice, fmtDate } from '@/lib/format'
import './DetailView.css'

const STATUS_OPTS: TradeStatus[] = ['planned', 'open', 'win', 'breakeven', 'loss']
const CONV_OPTS: Conviction[] = ['urgent', 'high', 'medium', 'low']

export function DetailView() {
  const { id } = useParams()
  const trade = useStore((s) => s.trades.find((t) => t.id === id))
  const updateNote = useStore((s) => s.updateNote)
  const setStatus = useStore((s) => s.setStatus)
  const setConviction = useStore((s) => s.setConviction)
  const [comment, setComment] = useState('')

  if (!trade) return <div className="dv-empty">未找到该交易</div>

  return (
    <>
      {/* 顶栏 44px / 圆形 28px 按钮 */}
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
          <IconButton title="复制链接">
            <Link2 size={15} />
          </IconButton>
          <IconButton title="收藏">
            <Star size={15} />
          </IconButton>
          <IconButton title="订阅">
            <Bell size={15} />
          </IconButton>
          <IconButton title="更多">
            <MoreHorizontal size={15} />
          </IconButton>
        </div>
      </header>

      <div className="dv-body">
        <div className="dv-main">
          <div className="dv-main-inner">
            <h1 className="dv-title">
              {trade.symbol}
              <SideTag side={trade.side} />
            </h1>

            <Editor
              content={trade.note}
              onChange={(html) => updateNote(trade.id, html)}
            />

            {/* 活动流 */}
            <section className="dv-activity">
              <ul className="dv-feed">
                <FeedItem dot="create">
                  你 <b>创建</b>了这笔交易 · {fmtDate(trade.openedAt)}
                </FeedItem>
                {trade.closedAt && (
                  <FeedItem dot="status">
                    你将状态改为 <b>{STATUS_META[trade.status].label}</b> ·{' '}
                    {fmtDate(trade.closedAt)}
                  </FeedItem>
                )}
              </ul>

              {/* 评论框：附件 + 圆形发送 */}
              <div className="dv-comment">
                <div className="dv-comment-avatar">Y</div>
                <div className="dv-comment-box">
                  <textarea
                    className="dv-comment-input"
                    placeholder="留下复盘评论…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={1}
                  />
                  <div className="dv-comment-bar">
                    <button className="dv-comment-attach" title="附件">
                      <Paperclip size={15} />
                    </button>
                    <button
                      className="dv-comment-send"
                      disabled={!comment.trim()}
                      onClick={() => setComment('')}
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

        {/* 右侧：折叠分组面板 */}
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
            <button className="dv-pitem">
              <SideTag side={trade.side} />
              <span>{trade.strategy}</span>
            </button>
          </Section>

          <Section title="交易数据">
            <DataRow label="入场" value={fmtPrice(trade.entry)} />
            <DataRow label="出场" value={trade.exit ? fmtPrice(trade.exit) : '—'} />
            <DataRow label="仓位" value={String(trade.size)} />
            <DataRow
              label="盈亏"
              value={trade.status === 'planned' ? '—' : fmtMoney(trade.pnl)}
              color={
                trade.pnl > 0
                  ? 'var(--pos)'
                  : trade.pnl < 0
                    ? 'var(--neg)'
                    : undefined
              }
            />
            <DataRow
              label="R 倍数"
              value={trade.status === 'planned' ? '—' : fmtR(trade.rMultiple)}
            />
          </Section>

          <Section title="时间">
            <DataRow label="开仓" value={fmtDate(trade.openedAt)} />
            <DataRow
              label="平仓"
              value={trade.closedAt ? fmtDate(trade.closedAt) : '—'}
            />
          </Section>

          <Section title="标签">
            <div className="dv-tags-row">
              {trade.tags.map((t) => (
                <span className="dv-tag" key={t}>
                  {t}
                </span>
              ))}
              <button className="dv-pitem dv-pitem-ghost">
                <Tag size={16} />
                <span>添加标签</span>
              </button>
            </div>
          </Section>

          <Section title="项目">
            <button className="dv-pitem dv-pitem-ghost">
              <Box size={16} />
              <span>{trade.strategy}</span>
            </button>
          </Section>

          <div className="dv-props-foot">
            <button className="dv-copy-id">
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

function FeedItem({
  dot,
  children,
}: {
  dot: 'create' | 'status'
  children: React.ReactNode
}) {
  return (
    <li className="dv-feed-item">
      <span className={'dv-feed-dot dv-feed-dot-' + dot} />
      <span className="dv-feed-text">{children}</span>
    </li>
  )
}
