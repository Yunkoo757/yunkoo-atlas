import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DatePicker } from '@/components/ui/DatePicker'
import type { Trade, TradeStatus } from '@/data/trades'
import { pnlToStatus } from '@/lib/tradeCalc'
import {
  prepareTradeClose,
  type CloseOutcome,
} from '@/lib/tradeClose'
import { fmtR } from '@/lib/format'
import { formatTradeCashPnl } from '@/lib/cashCurrency'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import { getTradingDayKey } from '@/lib/periods'
import { Button } from '@/components/ui/Button'
import { ModalShell } from '@/components/ui/ModalShell'
import { resolveLiveRecordBucket } from '@/lib/liveStatisticsArchive'
import { closedTradingDayKeyFromClosedAt } from '@/lib/riskBudget'
import './TradeCloseDialog.css'

const OUTCOMES: Array<{ value: CloseOutcome; label: string }> = [
  { value: 'win', label: '盈利' },
  { value: 'breakeven', label: '保本' },
  { value: 'loss', label: '亏损' },
]

function toTradingDay(value = new Date(), startHour?: number): string {
  return getTradingDayKey(value, startHour)
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
  const privacyMode = useStore((state) => state.display.privacyMode)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const livePerformanceCycles = useStore((state) => state.livePerformanceCycles)
  const legacyCashCurrencyAssumption = useStore((state) => state.profile.legacyCashCurrencyAssumption)
  const [outcome, setOutcome] = useState<CloseOutcome>('win')
  const [pnl, setPnl] = useState('')
  const [rMultiple, setRMultiple] = useState('')
  const [closedAt, setClosedAt] = useState(() =>
    toTradingDay(new Date(), useStore.getState().display.tradingDayStartHour),
  )
  const [error, setError] = useState('')
  const [archiveConfirm, setArchiveConfirm] = useState<{
    status: CloseOutcome
    patch: Partial<Trade>
  } | null>(null)

  useEffect(() => {
    if (!trade || !request) return
    const nextOutcome = initialOutcome(
      trade.status,
      request.targetStatus,
      trade.pnl,
      trade.rMultiple,
    )
    setOutcome(nextOutcome)
    setPnl(trade.pnl == null ? '' : String(Math.abs(trade.pnl)))
    setRMultiple(trade.rMultiple == null ? '' : String(Math.abs(trade.rMultiple)))
    setClosedAt(trade.closedAt ?? toTradingDay(new Date(), tradingDayStartHour))
    setError('')
    setArchiveConfirm(null)
  }, [trade?.id, request?.targetStatus, tradingDayStartHour])

  const previewResult = useMemo(() => {
    if (!trade) return null
    return prepareTradeClose(trade, {
      outcome,
      resultMode: 'pnl',
      pnl: parseOptionalNumber(pnl),
      rMultiple: parseOptionalNumber(rMultiple),
      closedAt,
    })
  }, [trade, outcome, pnl, rMultiple, closedAt])

  if (!request || !trade) return null

  const commitClose = (status: CloseOutcome, patch: Partial<Trade>) => {
    const previousActionId = useStore.getState().undoStack.at(-1)?.actionId
    completeTradeClose(trade.id, status, patch)
    const latestActionId = useStore.getState().undoStack.at(-1)?.actionId
    const actionId = latestActionId !== previousActionId ? latestActionId : undefined
    toast(`${trade.ref} 已平仓，已加入待复盘`, {
      label: '撤销',
      onClick: () => {
        if (actionId && useStore.getState().undo(actionId)) toast('已撤销平仓')
        else toast('目标交易之后已变化，无法安全撤销')
      },
    })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const result = prepareTradeClose(trade, {
      outcome,
      resultMode: 'pnl',
      pnl: parseOptionalNumber(pnl),
      rMultiple: parseOptionalNumber(rMultiple),
      closedAt,
    })
    if (!result.ok) {
      setError(result.error)
      return
    }
    const before = resolveLiveRecordBucket(trade, livePerformanceCycles, tradingDayStartHour)
    const after = resolveLiveRecordBucket({
      ...trade,
      ...result.patch,
      status: result.status,
      closedTradingDayKey: closedTradingDayKeyFromClosedAt(result.patch.closedAt ?? null, tradingDayStartHour) ?? undefined,
    }, livePerformanceCycles, tradingDayStartHour)
    if ((before === 'current' || before === 'archive') && before !== after) {
      setArchiveConfirm({ status: result.status, patch: result.patch })
      return
    }
    commitClose(result.status, result.patch)
  }

  const preview = previewResult?.ok ? previewResult : null
  const summary = (() => {
    if (error) return error
    if (!preview) {
      if (outcome === 'breakeven') return '将记录为保本，无需再填写 0。'
      if (previewResult && !previewResult.ok) return previewResult.error
      return '至少填写盈亏金额或 R 倍数中的一项；两项都会保存。'
    }
    const values = [
      preview.patch.pnl == null ? null : formatTradeCashPnl(
        { ...trade, pnl: preview.patch.pnl },
        legacyCashCurrencyAssumption,
        privacyMode,
      ),
      preview.patch.rMultiple == null ? null : fmtR(preview.patch.rMultiple),
    ].filter(Boolean)
    return `将记录 ${values.join(' · ')}`
  })()

  return (
    <ModalShell
      title="完成平仓"
      description={`${trade.ref} · ${trade.symbol}`}
      panelClassName="trade-close-dialog"
      bodyClassName="trade-close-body"
      footerClassName="trade-close-footer"
      initialFocusSelector=".trade-close-fields input:not(:disabled), .trade-close-outcome"
      returnFocusTo={request.returnFocus}
      onClose={cancelTradeClose}
      footer={(
        <>
          <span>保存后进入「待复盘」</span>
          <div>
            <Button type="button" variant="bordered" size="lg" onClick={() => {
              if (archiveConfirm) setArchiveConfirm(null)
              else cancelTradeClose()
            }}>取消</Button>
            {archiveConfirm ? (
              <Button type="button" variant="primary" size="lg" onClick={() => commitClose(archiveConfirm.status, archiveConfirm.patch)}>确认保存</Button>
            ) : (
              <Button type="submit" form="trade-close-form" variant="primary" size="lg" disabled={!preview}>保存并待复盘</Button>
            )}
          </div>
        </>
      )}
    >
      <form id="trade-close-form" className="trade-close-form" onSubmit={submit}>
          {archiveConfirm ? (
            <section className="trade-close-section" aria-live="polite">
              <span className="trade-close-label">归属将改变</span>
              <p>保存后将离开当前归档。交易与关联案例不会删除，系统会按平仓业务日重新归属。</p>
            </section>
          ) : (
            <>
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
            {outcome !== 'breakeven' ? (
              <label>
                <span>盈亏金额 · 输入绝对值</span>
                <input
                  aria-label="盈亏金额"
                  type={privacyMode ? 'password' : 'text'}
                  autoComplete="off"
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
            {outcome !== 'breakeven' ? (
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
            {outcome === 'breakeven' ? (
              <div className="trade-close-zero-result">
                <span>结果数值</span>
                <strong>0 · 无需填写</strong>
              </div>
            ) : null}
            <div className="trade-close-date-field">
              <span>平仓日期</span>
              <DatePicker value={closedAt} onValueChange={setClosedAt} ariaLabel="平仓日期" required />
            </div>
          </div>

          <div className={`trade-close-summary${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>
            {summary}
          </div>
            </>
          )}
      </form>
    </ModalShell>
  )
}
