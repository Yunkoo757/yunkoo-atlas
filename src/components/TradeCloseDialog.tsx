import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, X } from '@/icons/appIcons'
import type { TradeStatus } from '@/data/trades'
import { pnlToStatus } from '@/lib/tradeCalc'
import {
  parsePrimaryCloseResultMode,
  prepareTradeClose,
  resolveInitialCloseResultMode,
  type CloseOutcome,
  type CloseResultMode,
  type PrimaryCloseResultMode,
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

const PRIMARY_RESULT_MODES: Array<{ value: PrimaryCloseResultMode; label: string }> = [
  { value: 'pnl', label: '盈亏金额' },
  { value: 'r', label: 'R 倍数' },
]

const PRIMARY_RESULT_MODE_STORAGE_KEY = 'yunkoo-atlas:trade-close-primary-result-mode'

function readRememberedPrimaryResultMode(): PrimaryCloseResultMode | null {
  if (typeof window === 'undefined') return null
  try {
    return parsePrimaryCloseResultMode(window.localStorage.getItem(PRIMARY_RESULT_MODE_STORAGE_KEY))
  } catch {
    return null
  }
}

function rememberPrimaryResultMode(mode: CloseResultMode): void {
  const primaryMode = parsePrimaryCloseResultMode(mode)
  if (!primaryMode || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PRIMARY_RESULT_MODE_STORAGE_KEY, primaryMode)
  } catch {
    // 本机偏好不可写时不应阻塞平仓。
  }
}

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
  const breakevenButtonRef = useRef<HTMLButtonElement>(null)
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
  const [detailsOpen, setDetailsOpen] = useState(false)
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
    const nextMode = resolveInitialCloseResultMode(trade, readRememberedPrimaryResultMode())
    setOutcome(nextOutcome)
    setResultMode(nextMode)
    setExit(trade.exit == null ? '' : String(trade.exit))
    setPnl(trade.pnl == null ? '' : String(Math.abs(trade.pnl)))
    setRMultiple(trade.rMultiple == null ? '' : String(Math.abs(trade.rMultiple)))
    setClosedAt(trade.closedAt ?? toLocalDate())
    setDetailsOpen(nextMode === 'price')
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

  useEffect(() => {
    if (!request || !trade || resultMode === 'price' || outcome !== 'breakeven') return
    const frame = requestAnimationFrame(() => breakevenButtonRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [request, trade?.id, resultMode, outcome])

  const previewResult = useMemo(() => {
    if (!trade) return null
    return prepareTradeClose(trade, {
      outcome,
      resultMode,
      value: parseOptionalNumber(resultMode === 'r' ? rMultiple : pnl),
      exit: parseOptionalNumber(exit),
      closedAt,
    })
  }, [trade, outcome, resultMode, exit, pnl, rMultiple, closedAt])

  if (!request || !trade) return null

  const chooseResultMode = (mode: CloseResultMode) => {
    setResultMode(mode)
    rememberPrimaryResultMode(mode)
    if (mode === 'price') setDetailsOpen(true)
    setError('')
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = prepareTradeClose(trade, {
      outcome,
      resultMode,
      value: parseOptionalNumber(resultMode === 'r' ? rMultiple : pnl),
      exit: parseOptionalNumber(exit),
      closedAt,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    completeTradeClose(trade.id, result.status, result.patch)
    toast(`${trade.ref} 已平仓，可稍后复盘`)
  }

  const preview = previewResult?.ok ? previewResult : null
  const displayedOutcome = resultMode === 'price' ? preview?.status ?? null : outcome
  const previewError = resultMode === 'price' && exit.trim() && previewResult && !previewResult.ok
    ? previewResult.error
    : ''
  const effectiveError = error || previewError
  const feedbackId = 'trade-close-result-feedback'
  const summary = (() => {
    if (effectiveError) return effectiveError
    if (resultMode === 'price') {
      if (!preview) return null
      return `按价格判定为${OUTCOMES.find((item) => item.value === preview.status)?.label ?? ''} · ${fmtR(preview.patch.rMultiple ?? null)}`
    }
    if (!preview || outcome === 'breakeven') return null
    return resultMode === 'pnl'
      ? `将记录 ${fmtMoney(preview.patch.pnl ?? null)}`
      : `将记录 ${fmtR(preview.patch.rMultiple ?? null)}`
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
                  ref={item.value === 'breakeven' ? breakevenButtonRef : undefined}
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
            <div className="trade-close-result-heading">
              <span className="trade-close-label">结果数值</span>
              <div className="trade-close-modes" role="radiogroup" aria-label="主要结果依据">
                {PRIMARY_RESULT_MODES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={resultMode === item.value}
                    className={`trade-close-mode${resultMode === item.value ? ' is-active' : ''}`}
                    onClick={() => chooseResultMode(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="trade-close-primary-field">
              {resultMode === 'pnl' && outcome !== 'breakeven' ? (
                <input
                  aria-label="盈亏金额"
                  aria-describedby={error ? feedbackId : undefined}
                  aria-invalid={Boolean(error)}
                  inputMode="decimal"
                  value={pnl}
                  onChange={(event) => {
                    setPnl(event.target.value)
                    setError('')
                  }}
                  placeholder="输入金额绝对值，例如 500"
                  autoFocus
                />
              ) : null}
              {resultMode === 'r' && outcome !== 'breakeven' ? (
                <input
                  aria-label="R 倍数"
                  aria-describedby={error ? feedbackId : undefined}
                  aria-invalid={Boolean(error)}
                  inputMode="decimal"
                  value={rMultiple}
                  onChange={(event) => {
                    setRMultiple(event.target.value)
                    setError('')
                  }}
                  placeholder="输入 R 绝对值，例如 1.5"
                  autoFocus
                />
              ) : null}
              {resultMode !== 'price' && outcome === 'breakeven' ? (
                <span className="trade-close-zero-result">保本将直接记录为 0，无需填写</span>
              ) : null}
              {resultMode === 'price' ? (
                <span className="trade-close-price-selected">正在根据出场价计算结果与 R</span>
              ) : null}
            </div>
          </section>

          {summary ? (
            <div
              id={feedbackId}
              className={`trade-close-summary${effectiveError ? ' is-error' : ''}`}
              role={effectiveError ? 'alert' : 'status'}
            >
              {summary}
            </div>
          ) : null}

          <section className={`trade-close-details${detailsOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="trade-close-details-trigger"
              aria-expanded={detailsOpen}
              aria-controls="trade-close-details-content"
              onClick={() => setDetailsOpen((open) => !open)}
            >
              <span>更多平仓信息</span>
              <ChevronDown size={14} aria-hidden />
            </button>

            {detailsOpen ? (
              <div id="trade-close-details-content" className="trade-close-details-content">
                <div className="trade-close-price-option">
                  <div>
                    <strong>按出场价计算</strong>
                    <span>根据入场价与初始止损计算结果和 R</span>
                  </div>
                  <button
                    type="button"
                    className={resultMode === 'price' ? 'is-active' : ''}
                    aria-pressed={resultMode === 'price'}
                    onClick={() => chooseResultMode('price')}
                  >
                    {resultMode === 'price' ? '已选择' : '使用'}
                  </button>
                </div>

                <div className="trade-close-fields">
                  <label>
                    <span>平仓日期</span>
                    <input type="date" value={closedAt} onChange={(event) => setClosedAt(event.target.value)} required />
                  </label>
                  <label>
                    <span>{resultMode === 'price' ? '出场价' : '出场价 · 可选'}</span>
                    <input
                      aria-describedby={resultMode === 'price' && effectiveError ? feedbackId : undefined}
                      aria-invalid={Boolean(resultMode === 'price' && effectiveError)}
                      inputMode="decimal"
                      value={exit}
                      onChange={(event) => {
                        setExit(event.target.value)
                        setError('')
                      }}
                      placeholder={resultMode === 'price' ? '用于计算结果与 R' : '仅记录，不参与换算'}
                      autoFocus={resultMode === 'price'}
                    />
                  </label>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <footer className="trade-close-footer">
          <span>执行数据可稍后补充</span>
          <div>
            <button type="button" className="trade-close-secondary" onClick={cancelTradeClose}>取消</button>
            <button type="submit" className="trade-close-primary">确认平仓</button>
          </div>
        </footer>
      </form>
    </div>
  )
}
