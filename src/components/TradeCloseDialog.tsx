import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { X } from '@/icons/appIcons'
import type { TradeStatus } from '@/data/trades'
import { pnlToStatus } from '@/lib/tradeCalc'
import {
  prepareTradeClose,
  type CloseOutcome,
  type CloseResultMode,
} from '@/lib/tradeClose'
import { fmtMoney, fmtR } from '@/lib/format'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import './TradeCloseDialog.css'

const OUTCOMES: Array<{ value: CloseOutcome; label: string }> = [
  { value: 'win', label: '盈利' },
  { value: 'breakeven', label: '保本' },
  { value: 'loss', label: '亏损' },
]

const RESULT_MODES: Array<{ value: CloseResultMode; label: string }> = [
  { value: 'pnl', label: '手动填写' },
  { value: 'price', label: '出场价格' },
]

function toLocalDate(value = new Date()): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function initialOutcome(
  status: TradeStatus,
  targetStatus: CloseOutcome | undefined,
  pnl: number | null,
  rMultiple: number | null,
): CloseOutcome {
  if (targetStatus) return targetStatus
  if (status === 'win' || status === 'loss' || status === 'breakeven') return status
  if (pnl != null) return pnlToStatus(pnl)
  if (rMultiple != null) return pnlToStatus(rMultiple)
  return 'win'
}

export function TradeCloseDialog() {
  const request = useStore((state) => state.closeTradeRequest)
  const trade = useStore((state) =>
    request ? state.trades.find((item) => item.id === request.tradeId) : undefined,
  )
  const cancelTradeClose = useStore((state) => state.cancelTradeClose)
  const completeTradeClose = useStore((state) => state.completeTradeClose)
  const [outcome, setOutcome] = useState<CloseOutcome>('win')
  const [resultMode, setResultMode] = useState<CloseResultMode>('pnl')
  const [exit, setExit] = useState('')
  const [pnl, setPnl] = useState('')
  const [rMultiple, setRMultiple] = useState('')
  const [closedAt, setClosedAt] = useState(toLocalDate())
  const [error, setError] = useState('')

  useEffect(() => {
    if (!request) return
    const target = request.returnFocus
    return () => {
      requestAnimationFrame(() => {
        if (target?.isConnected) target.focus()
      })
    }
  }, [request])

  useEffect(() => {
    if (!trade || !request) return
    const nextOutcome = initialOutcome(
      trade.status,
      request.targetStatus,
      trade.pnl,
      trade.rMultiple,
    )
    const nextMode = trade.resultSource === 'price' ? 'price' : 'pnl'
    setOutcome(nextOutcome)
    setResultMode(nextMode)
    setExit(trade.exit == null ? '' : String(trade.exit))
    setPnl(trade.pnl == null ? '' : String(Math.abs(trade.pnl)))
    setRMultiple(trade.rMultiple == null ? '' : String(Math.abs(trade.rMultiple)))
    setClosedAt(trade.closedAt ?? toLocalDate())
    setError('')
  }, [trade?.id, request?.targetStatus])

  useEffect(() => {
    if (!request) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelTradeClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [request, cancelTradeClose])

  const previewResult = useMemo(() => {
    if (!trade) return null
    return prepareTradeClose(trade, {
      outcome,
      resultMode,
      pnl: parseOptionalNumber(pnl),
      rMultiple: parseOptionalNumber(rMultiple),
      exit: parseOptionalNumber(exit),
      closedAt,
    })
  }, [trade, outcome, resultMode, exit, pnl, rMultiple, closedAt])

  if (!request || !trade) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = prepareTradeClose(trade, {
      outcome,
      resultMode,
      pnl: parseOptionalNumber(pnl),
      rMultiple: parseOptionalNumber(rMultiple),
      exit: parseOptionalNumber(exit),
      closedAt,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    completeTradeClose(trade.id, result.status, result.patch)
    toast(`${trade.ref} 已平仓，已加入待复盘`)
  }

  const preview = previewResult?.ok ? previewResult : null
  const displayedOutcome = resultMode === 'price' ? preview?.status ?? null : outcome
  const summary = (() => {
    if (error) return error
    if (!preview) {
      if (resultMode === 'price') {
        if (exit.trim() && previewResult && !previewResult.ok) return previewResult.error
        return '输入出场价后将按价格方向判断结果，不会自动生成盈亏金额。'
      }
      if (outcome === 'breakeven') return '将记录为保本，无需再填写 0。'
      return '至少填写盈亏金额或 R 倍数中的一项；两项都会保存。'
    }
    if (resultMode === 'price') {
      return preview.patch.rMultiple == null
        ? `按价格判定为${OUTCOMES.find((item) => item.value === preview.status)?.label ?? ''}；缺少有效初始止损，R 将留空。`
        : `按价格判定为${OUTCOMES.find((item) => item.value === preview.status)?.label ?? ''} · ${fmtR(preview.patch.rMultiple)}`
    }
    const values = [
      preview.patch.pnl == null ? null : fmtMoney(preview.patch.pnl),
      preview.patch.rMultiple == null ? null : fmtR(preview.patch.rMultiple),
    ].filter(Boolean)
    return `将记录 ${values.join(' · ')}`
  })()

  return (
    <div
      className="trade-close-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancelTradeClose()
      }}
    >
      <form
        className="trade-close-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-close-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled)',
            ),
          ).filter((element) => element.getClientRects().length > 0)
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
        <header className="trade-close-header">
          <div>
            <span className="trade-close-eyebrow">{trade.ref} · {trade.symbol}</span>
            <h2 id="trade-close-title">完成平仓</h2>
          </div>
          <button type="button" className="trade-close-dismiss" aria-label="关闭" onClick={cancelTradeClose}>
            <X size={16} />
          </button>
        </header>

        <div className="trade-close-body">
          <section className="trade-close-section">
            <span className="trade-close-label">交易结果</span>
            <div className="trade-close-outcomes" role="radiogroup" aria-label="交易结果">
              {OUTCOMES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={displayedOutcome === item.value}
                  className={`trade-close-outcome is-${item.value}${displayedOutcome === item.value ? ' is-active' : ''}${resultMode === 'price' ? ' is-derived' : ''}`}
                  disabled={resultMode === 'price'}
                  onClick={() => {
                    setOutcome(item.value)
                    setError('')
                  }}
                >
                  <span aria-hidden />
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <section className="trade-close-section">
            <span className="trade-close-label">记录依据</span>
            <div className="trade-close-modes" role="radiogroup" aria-label="记录依据">
              {RESULT_MODES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={resultMode === item.value}
                  className={`trade-close-mode${resultMode === item.value ? ' is-active' : ''}`}
                  onClick={() => {
                    setResultMode(item.value)
                    setError('')
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <div className="trade-close-fields">
            {resultMode !== 'price' && outcome !== 'breakeven' ? (
              <label>
                <span>盈亏金额 · 输入绝对值</span>
                <input
                  aria-label="盈亏金额"
                  inputMode="decimal"
                  value={pnl}
                  onChange={(event) => {
                    setPnl(event.target.value)
                    setError('')
                  }}
                  placeholder="例如 500"
                  autoFocus
                />
              </label>
            ) : null}
            {resultMode !== 'price' && outcome !== 'breakeven' ? (
              <label>
                <span>R 倍数 · 输入绝对值</span>
                <input
                  aria-label="R 倍数"
                  inputMode="decimal"
                  value={rMultiple}
                  onChange={(event) => {
                    setRMultiple(event.target.value)
                    setError('')
                  }}
                  placeholder="例如 1.5"
                />
              </label>
            ) : null}
            {resultMode !== 'price' && outcome === 'breakeven' ? (
              <div className="trade-close-zero-result">
                <span>结果数值</span>
                <strong>0 · 无需填写</strong>
              </div>
            ) : null}
            <label>
              <span>平仓日期</span>
              <input type="date" value={closedAt} onChange={(event) => setClosedAt(event.target.value)} required />
            </label>
            <label className={resultMode === 'price' ? 'trade-close-price-exit' : undefined}>
              <span>{resultMode === 'price' ? '出场价' : '出场价 · 可选'}</span>
              <input
                inputMode="decimal"
                value={exit}
                onChange={(event) => {
                  setExit(event.target.value)
                  setError('')
                }}
                placeholder={resultMode === 'price' ? '用于判断结果与价格 R' : '仅记录，不参与换算'}
                autoFocus={resultMode === 'price'}
              />
            </label>
          </div>

          <div className={`trade-close-summary${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>
            {summary}
          </div>
        </div>

        <footer className="trade-close-footer">
          <span>保存后进入「待复盘」</span>
          <div>
            <button type="button" className="trade-close-secondary" onClick={cancelTradeClose}>取消</button>
            <button type="submit" className="trade-close-primary">保存并待复盘</button>
          </div>
        </footer>
      </form>
    </div>
  )
}
