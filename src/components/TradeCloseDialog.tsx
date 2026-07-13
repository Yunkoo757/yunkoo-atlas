import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { X } from '@/icons/appIcons'
import type { TradeStatus } from '@/data/trades'
import { calcPnl, calcRFromStop, pnlToStatus } from '@/lib/tradeCalc'
import { prepareTradeClose, type CloseOutcome } from '@/lib/tradeClose'
import { fmtMoney, fmtR } from '@/lib/format'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import './TradeCloseDialog.css'

const OUTCOMES: Array<{ value: CloseOutcome; label: string }> = [
  { value: 'win', label: '盈利' },
  { value: 'breakeven', label: '保本' },
  { value: 'loss', label: '亏损' },
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
  const updateTradeData = useStore((state) => state.updateTradeData)
  const setStatus = useStore((state) => state.setStatus)
  const [outcome, setOutcome] = useState<CloseOutcome>('win')
  const [exit, setExit] = useState('')
  const [pnl, setPnl] = useState('')
  const [rMultiple, setRMultiple] = useState('')
  const [closedAt, setClosedAt] = useState(toLocalDate())
  const [error, setError] = useState('')

  useEffect(() => {
    if (!trade || !request) return
    setOutcome(initialOutcome(trade.status, request.targetStatus, trade.pnl, trade.rMultiple))
    setExit(trade.exit == null ? '' : String(trade.exit))
    setPnl(trade.pnl == null ? '' : String(trade.pnl))
    setRMultiple(trade.rMultiple == null ? '' : String(trade.rMultiple))
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

  const calculated = useMemo(() => {
    if (!trade) return { pnl: null, r: null }
    const parsedExit = parseOptionalNumber(exit)
    const explicitPnl = parseOptionalNumber(pnl)
    const nextPnl = explicitPnl ?? (
      parsedExit == null ? null : calcPnl(trade.side, trade.entry, parsedExit, trade.size)
    )
    return {
      pnl: nextPnl,
      r: parseOptionalNumber(rMultiple) ?? (
        nextPnl == null
          ? null
          : calcRFromStop(trade.side, nextPnl, trade.entry, trade.stopLoss, trade.size)
      ),
    }
  }, [trade, exit, pnl, rMultiple])

  if (!request || !trade) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = prepareTradeClose(trade, {
      outcome,
      exit: parseOptionalNumber(exit),
      pnl: parseOptionalNumber(pnl),
      rMultiple: parseOptionalNumber(rMultiple),
      closedAt,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    updateTradeData(trade.id, result.patch)
    setStatus(trade.id, result.status)
    cancelTradeClose()
    toast(`${trade.ref} 已平仓，已加入待复盘`)
  }

  return (
    <div
      className="trade-close-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancelTradeClose()
      }}
    >
      <form className="trade-close-dialog" role="dialog" aria-modal="true" aria-labelledby="trade-close-title" onSubmit={submit}>
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
                  aria-checked={outcome === item.value}
                  className={`trade-close-outcome is-${item.value}${outcome === item.value ? ' is-active' : ''}`}
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

          <div className="trade-close-fields">
            <label>
              <span>出场价</span>
              <input inputMode="decimal" value={exit} onChange={(event) => setExit(event.target.value)} placeholder="可选，用于自动计算" autoFocus />
            </label>
            <label>
              <span>平仓日期</span>
              <input type="date" value={closedAt} onChange={(event) => setClosedAt(event.target.value)} required />
            </label>
            <label>
              <span>盈亏金额</span>
              <input inputMode="decimal" value={pnl} onChange={(event) => setPnl(event.target.value)} placeholder={calculated.pnl == null ? '至少填写一项结果' : fmtMoney(calculated.pnl)} />
            </label>
            <label>
              <span>R 倍数</span>
              <input inputMode="decimal" value={rMultiple} onChange={(event) => setRMultiple(event.target.value)} placeholder={calculated.r == null ? '至少填写一项结果' : fmtR(calculated.r)} />
            </label>
          </div>

          <div className={`trade-close-summary${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>
            {error || (
              calculated.pnl != null || calculated.r != null
                ? `将记录 ${fmtMoney(calculated.pnl)} · ${fmtR(calculated.r)}`
                : '填写盈亏或 R 倍数即可；有完整价格时会自动计算。'
            )}
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

