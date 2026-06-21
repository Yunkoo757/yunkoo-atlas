import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { X } from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Menu } from '@/components/Menu'
import { TagEditor } from '@/components/TagEditor'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import { StrategyIcon } from '@/components/StrategyIcon'
import { getStrategyName } from '@/lib/strategies'
import { calcPnl, calcRSimple } from '@/lib/tradeCalc'
import { collectAllTags } from '@/lib/tags'
import {
  STATUS_META,
  CONVICTION_META,
  TRADE_KIND_META,
  MISS_REASON_META,
  type Trade,
  type TradeStatus,
  type Conviction,
  type TradeSide,
  type TradeKind,
  type MissReason,
  type ReviewStatus,
} from '@/data/trades'
import { REVIEW_STATUS_META } from '@/lib/reviewAnalytics'
import { STATUS_ORDER } from '@/lib/tradeStatus'
import { isTerminal } from '@/lib/tradeStatus'
import './TradeComposer.css'

const STATUS_OPTS: TradeStatus[] = STATUS_ORDER
const CONV_OPTS: Conviction[] = ['urgent', 'high', 'medium', 'low']
const KIND_OPTS: TradeKind[] = ['live', 'paper']
const MISS_OPTS: MissReason[] = ['hesitation', 'missed_setup', 'no_alert', 'rule_break', 'other']
const REVIEW_OPTS: ReviewStatus[] = ['unreviewed', 'reviewed', 'focus']
const SYMBOL_PRESETS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT']

function defaultKindFromPath(pathname: string): TradeKind {
  // /paper and /practice are legacy routes that redirect to /sim (kept for backward compat)
  if (
    pathname.startsWith('/sim') ||
    pathname.startsWith('/paper') ||
    pathname.startsWith('/practice')
  ) {
    return 'paper'
  }
  return 'live'
}

function blankTrade(strategyId: string, kind: TradeKind): Trade {
  return {
    id: '',
    ref: '',
    symbol: '',
    side: 'long',
    status: 'planned',
    conviction: 'medium',
    strategyId,
    tradeKind: kind,
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    entry: 0,
    exit: null,
    stopLoss: null,
    size: 0,
    pnl: 0,
    rMultiple: 0,
    openedAt: new Date().toISOString().slice(0, 10),
    closedAt: null,
    note: '',
  }
}

function noteToPlain(html: string): string {
  if (!html) return ''
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent?.trim() ?? ''
}

function plainToNote(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  return `<p>${trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`
}

export function TradeComposer() {
  const location = useLocation()
  const open = useStore((s) => s.composerOpen)
  const editing = useStore((s) => s.composerTrade)
  const trades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const upsert = useStore((s) => s.upsertTrade)
  const close = useStore((s) => s.closeComposer)
  const tagPresets = useStore((s) => s.tagPresets)
  const addTagPreset = useStore((s) => s.addTagPreset)
  const removeTagPreset = useStore((s) => s.removeTagPreset)

  const [form, setForm] = useState<Trade>(
    blankTrade(strategies[0]?.id ?? 'breakout', defaultKindFromPath(location.pathname)),
  )
  const [noteText, setNoteText] = useState('')
  const pnlTouched = useRef(false)
  const rTouched = useRef(false)

  const allTags = collectAllTags(trades)
  const allMistakeTags = [
    ...new Set(trades.flatMap((t) => t.mistakeTags ?? []).map((t) => t.trim()).filter(Boolean)),
  ]

  useEffect(() => {
    if (open) {
      const kind = editing?.tradeKind ?? defaultKindFromPath(location.pathname)
      const base = editing ?? blankTrade(strategies[0]?.id ?? 'breakout', kind)
      setForm(base)
      setNoteText(noteToPlain(base.note))
      pnlTouched.current = false
      rTouched.current = false
    }
  }, [open, editing, strategies, location.pathname])

  useEffect(() => {
    if (!open || pnlTouched.current) return
    const { side, entry, exit, size } = form
    if (exit == null || !entry || !size) return
    const suggested = calcPnl(side, entry, exit, size)
    if (suggested == null) return
    setForm((f) => {
      const next = { ...f, pnl: suggested }
      if (!rTouched.current) {
        const r = calcRSimple(suggested, entry, exit, size)
        if (r != null) next.rMultiple = r
      }
      return next
    })
  }, [open, form.side, form.entry, form.exit, form.size])

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
    const trade: Trade = {
      ...form,
      note: plainToNote(noteText),
      id: form.id || String(Date.now()),
      ref: form.ref || nextRef(),
      tradeKind: form.tradeKind ?? 'live',
      closedAt: isTerminal(form.status)
        ? form.closedAt ?? form.openedAt
        : null,
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
          <label className="tc-symbol-field">
            <span className="tc-symbol-label">标的</span>
            <input
              className="tc-symbol"
              placeholder="如 BTCUSDT"
              value={form.symbol}
              onChange={(e) => set('symbol', e.target.value)}
              autoFocus
            />
          </label>
          <div className="tc-symbol-presets" aria-label="标的预置">
            {SYMBOL_PRESETS.map((symbol) => (
              <button
                key={symbol}
                type="button"
                className={'tc-symbol-preset' + (form.symbol === symbol ? ' is-active' : '')}
                onClick={() => set('symbol', symbol)}
              >
                {symbol}
              </button>
            ))}
          </div>

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
              value={form.strategyId}
              onSelect={(v) => set('strategyId', v)}
              options={strategies.map((s) => ({
                value: s.id,
                label: s.name,
                icon: <StrategyIcon icon={s.icon} color={s.color} size={14} />,
              }))}
              trigger={
                <button className="tc-pill tc-pill-ghost">
                  {(() => {
                    const s = strategies.find((x) => x.id === form.strategyId)
                    return s ? (
                      <>
                        <StrategyIcon icon={s.icon} color={s.color} size={14} />
                        {s.name}
                      </>
                    ) : (
                      getStrategyName(strategies, form.strategyId)
                    )
                  })()}
                </button>
              }
            />
            <Menu
              value={form.tradeKind}
              onSelect={(v) => set('tradeKind', v as TradeKind)}
              options={KIND_OPTS.map((k) => ({
                value: k,
                label: TRADE_KIND_META[k].label,
              }))}
              trigger={
                <button className="tc-pill tc-pill-ghost">
                  {TRADE_KIND_META[form.tradeKind].label}
                </button>
              }
            />
            <Menu
              value={form.reviewStatus}
              onSelect={(v) => set('reviewStatus', v as ReviewStatus)}
              options={REVIEW_OPTS.map((s) => ({
                value: s,
                label: REVIEW_STATUS_META[s].label,
              }))}
              trigger={
                <button className="tc-pill tc-pill-ghost">
                  {REVIEW_STATUS_META[form.reviewStatus].label}
                </button>
              }
            />
            {form.status === 'missed' && (
              <Menu
                value={form.missReason ?? 'other'}
                onSelect={(v) => set('missReason', v as MissReason)}
                options={MISS_OPTS.map((r) => ({
                  value: r,
                  label: MISS_REASON_META[r].label,
                }))}
                trigger={
                  <button className="tc-pill tc-pill-ghost">
                    {MISS_REASON_META[form.missReason ?? 'other'].label}
                  </button>
                }
              />
            )}
          </div>

          {/* 数值网格 */}
          <div className="tc-grid">
            <Field label="入场">
              <input type="number" value={form.entry || ''} onChange={(e) => set('entry', +e.target.value)} />
            </Field>
            <Field label="出场">
              <input type="number" value={form.exit ?? ''} onChange={(e) => set('exit', e.target.value === '' ? null : +e.target.value)} />
            </Field>
            <Field label="止损">
              <input
                type="number"
                value={form.stopLoss ?? ''}
                onChange={(e) =>
                  set('stopLoss', e.target.value === '' ? null : +e.target.value)
                }
              />
            </Field>
            <Field label="仓位">
              <input type="number" value={form.size || ''} onChange={(e) => set('size', +e.target.value)} />
            </Field>
            <Field label="盈亏 ($)">
              <input
                type="number"
                value={form.pnl || ''}
                onChange={(e) => {
                  pnlTouched.current = true
                  set('pnl', +e.target.value)
                }}
              />
            </Field>
            <Field label="R 倍数">
              <input
                type="number"
                step="0.1"
                value={form.rMultiple || ''}
                onChange={(e) => {
                  rTouched.current = true
                  set('rMultiple', +e.target.value)
                }}
              />
            </Field>
            <Field label="开仓日">
              <input type="date" value={form.openedAt} onChange={(e) => set('openedAt', e.target.value)} />
            </Field>
            {isTerminal(form.status) && (
              <Field label="平仓日">
                <input
                  type="date"
                  value={form.closedAt ?? form.openedAt}
                  onChange={(e) => set('closedAt', e.target.value)}
                />
              </Field>
            )}
          </div>

          <Field label="标签">
            <TagEditor
              tags={form.tags}
              suggestions={allTags}
              presets={tagPresets}
              onAddPreset={addTagPreset}
              onRemovePreset={removeTagPreset}
              onAdd={(tag) =>
                setForm((f) => ({
                  ...f,
                  tags: f.tags.includes(tag) ? f.tags : [...f.tags, tag],
                }))
              }
              onRemove={(tag) =>
                setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }))
              }
            />
          </Field>

          <Field label="错误 / 违规标签">
            <TagEditor
              tags={form.mistakeTags}
              suggestions={allMistakeTags}
              onAdd={(tag) =>
                setForm((f) => ({
                  ...f,
                  mistakeTags: f.mistakeTags.includes(tag) ? f.mistakeTags : [...f.mistakeTags, tag],
                }))
              }
              onRemove={(tag) =>
                setForm((f) => ({
                  ...f,
                  mistakeTags: f.mistakeTags.filter((t) => t !== tag),
                }))
              }
            />
          </Field>

          <Field label="备注">
            <textarea
              className="tc-note"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="进场理由、止损计划、复盘要点…"
              rows={3}
            />
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
