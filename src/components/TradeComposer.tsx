import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Menu } from '@/components/Menu'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import {
  STATUS_META,
  CONVICTION_META,
  STRATEGIES,
  type Trade,
  type TradeStatus,
  type Conviction,
  type TradeSide,
} from '@/data/trades'
import './TradeComposer.css'

const STATUS_OPTS: TradeStatus[] = ['planned', 'open', 'win', 'breakeven', 'loss']
const CONV_OPTS: Conviction[] = ['urgent', 'high', 'medium', 'low']

function blankTrade(): Trade {
  return {
    id: '',
    ref: '',
    symbol: '',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategy: STRATEGIES[0],
    tags: [],
    entry: 0,
    exit: null,
    size: 0,
    pnl: 0,
    rMultiple: 0,
    openedAt: new Date().toISOString().slice(0, 10),
    closedAt: null,
    note: '',
  }
}

export function TradeComposer() {
  const open = useStore((s) => s.composerOpen)
  const editing = useStore((s) => s.composerTrade)
  const trades = useStore((s) => s.trades)
  const upsert = useStore((s) => s.upsertTrade)
  const close = useStore((s) => s.closeComposer)

  const [form, setForm] = useState<Trade>(blankTrade())
  const [tagsText, setTagsText] = useState('')

  useEffect(() => {
    if (open) {
      const base = editing ?? blankTrade()
      setForm(base)
      setTagsText(base.tags.join(', '))
    }
  }, [open, editing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const set = <K extends keyof Trade>(k: K, v: Trade[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  const nextRef = () => {
    const nums = trades
      .map((t) => parseInt(t.ref.replace(/\D/g, ''), 10))
      .filter((n) => !isNaN(n))
    const max = nums.length ? Math.max(...nums) : 100
    return `TRD-${max + 1}`
  }

  const save = () => {
    if (!form.symbol.trim()) return
    const tags = tagsText
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const isClosed =
      form.status === 'win' || form.status === 'loss' || form.status === 'breakeven'
    const trade: Trade = {
      ...form,
      tags,
      id: form.id || String(Date.now()),
      ref: form.ref || nextRef(),
      closedAt: isClosed ? form.closedAt ?? form.openedAt : null,
    }
    upsert(trade)
    close()
  }

  return createPortal(
    <div className="tc-overlay" onMouseDown={close}>
      <div className="tc" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tc-head">
          <span className="tc-title">{editing ? '编辑交易' : '新建交易'}</span>
          <button className="tc-close" onClick={close}>
            <X size={16} />
          </button>
        </div>

        <div className="tc-body">
          <input
            className="tc-symbol"
            placeholder="标的，如 BTC/USDT"
            value={form.symbol}
            onChange={(e) => set('symbol', e.target.value)}
            autoFocus
          />

          {/* 属性药丸行 */}
          <div className="tc-pills">
            <Menu
              value={form.status}
              onSelect={(v) => set('status', v as TradeStatus)}
              options={STATUS_OPTS.map((s) => ({
                value: s,
                label: STATUS_META[s].label,
                icon: <StatusIcon status={s} size={16} />,
              }))}
              trigger={
                <button className="tc-pill">
                  <StatusIcon status={form.status} size={16} />
                  {STATUS_META[form.status].label}
                </button>
              }
            />
            <Menu
              value={form.conviction}
              onSelect={(v) => set('conviction', v as Conviction)}
              options={CONV_OPTS.map((c) => ({
                value: c,
                label: CONVICTION_META[c].label,
                icon: <ConvictionIcon conviction={c} size={16} />,
              }))}
              trigger={
                <button className="tc-pill">
                  <ConvictionIcon conviction={form.conviction} size={16} />
                  {CONVICTION_META[form.conviction].label}
                </button>
              }
            />
            <Menu
              value={form.side}
              onSelect={(v) => set('side', v as TradeSide)}
              options={[
                { value: 'long', label: '做多' },
                { value: 'short', label: '做空' },
              ]}
              trigger={
                <button className="tc-pill">
                  <SideTag side={form.side} />
                  {form.side === 'long' ? '做多' : '做空'}
                </button>
              }
            />
            <Menu
              value={form.strategy}
              onSelect={(v) => set('strategy', v)}
              options={STRATEGIES.map((s) => ({ value: s, label: s }))}
              trigger={<button className="tc-pill tc-pill-ghost">{form.strategy}</button>}
            />
          </div>

          {/* 数值网格 */}
          <div className="tc-grid">
            <Field label="入场">
              <input type="number" value={form.entry || ''} onChange={(e) => set('entry', +e.target.value)} />
            </Field>
            <Field label="出场">
              <input type="number" value={form.exit ?? ''} onChange={(e) => set('exit', e.target.value === '' ? null : +e.target.value)} />
            </Field>
            <Field label="仓位">
              <input type="number" value={form.size || ''} onChange={(e) => set('size', +e.target.value)} />
            </Field>
            <Field label="盈亏 ($)">
              <input type="number" value={form.pnl || ''} onChange={(e) => set('pnl', +e.target.value)} />
            </Field>
            <Field label="R 倍数">
              <input type="number" step="0.1" value={form.rMultiple || ''} onChange={(e) => set('rMultiple', +e.target.value)} />
            </Field>
            <Field label="开仓日">
              <input type="date" value={form.openedAt} onChange={(e) => set('openedAt', e.target.value)} />
            </Field>
          </div>

          <Field label="标签（逗号分隔）">
            <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="日内, 突破" />
          </Field>
        </div>

        <div className="tc-foot">
          <button className="tc-btn tc-btn-ghost" onClick={close}>
            取消
          </button>
          <button className="tc-btn tc-btn-primary" onClick={save} disabled={!form.symbol.trim()}>
            {editing ? '保存' : '创建交易'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="tc-field">
      <span className="tc-field-label">{label}</span>
      {children}
    </label>
  )
}
