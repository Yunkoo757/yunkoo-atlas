import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DatePicker } from '@/components/ui/DatePicker'
import { STATUS_META, type Trade, type TradeStatus } from '@/data/trades'
import { StatusIcon } from '@/components/StatusIcon'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
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
import { closedTradingDayKeyFromClosedAt } from '@/lib/riskBudget'
import { parseYmd } from '@/components/ui/datePickerCalendar'
import { Button } from '@/components/ui/Button'
import { ModalShell } from '@/components/ui/ModalShell'
import './TradeCloseDialog.css'

const OUTCOMES = (['win', 'breakeven', 'loss'] as const).map((value) => ({
  value,
  label: STATUS_META[value].label,
  content: (
    <span className="trade-close-option">
      <StatusIcon status={value} animate={false} />
      {STATUS_META[value].label}
    </span>
  ),
}))

function toTradingDay(value = new Date(), startHour?: number): string {
  return getTradingDayKey(value, startHour)
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null
  return Number(value)
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
  const legacyCashCurrencyAssumption = useStore((state) => state.profile.legacyCashCurrencyAssumption)
  const [outcome, setOutcome] = useState<CloseOutcome>('win')
  const [pnl, setPnl] = useState('')
  const [rMultiple, setRMultiple] = useState('')
  const [closedAt, setClosedAt] = useState(() =>
    toTradingDay(new Date(), useStore.getState().display.tradingDayStartHour),
  )

  useEffect(() => {
    if (!trade || !request) return
    const nextOutcome = initialOutcome(
      trade.status,
      request.targetStatus,
      trade.pnl,
      trade.rMultiple,
    )
    setOutcome(nextOutcome)
    setPnl(trade.pnl == null ? '' : String(nextOutcome === 'breakeven' ? trade.pnl : Math.abs(trade.pnl)))
    setRMultiple(trade.rMultiple == null ? '' : String(nextOutcome === 'breakeven' ? trade.rMultiple : Math.abs(trade.rMultiple)))
    setClosedAt(trade.closedAt ?? (trade.tradeKind === 'backtest' ? trade.openedAt.slice(0, 10) : toTradingDay(new Date(), tradingDayStartHour)))
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

  if (!request || !trade || !previewResult) return null

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

  function changeOutcome(next: CloseOutcome) {
    // 保本记录实际正负数；另外两类按所选结果记录方向。
    if (outcome !== next && (next === 'breakeven' || outcome === 'breakeven')) {
      const sign = next === 'breakeven' && outcome === 'loss' ? -1 : 1
      const convert = (value: string) => value.trim() && Number.isFinite(Number(value))
        ? String(sign * Math.abs(Number(value)))
        : value
      setPnl(convert)
      setRMultiple(convert)
    }
    setOutcome(next)
  }

  // 日历只展示日期；历史平仓时刻在用户实际重选日期前保持原值。
  const parsedDay = closedTradingDayKeyFromClosedAt(closedAt, tradingDayStartHour)
  const frozenDay = trade.closedTradingDayKey
  const displayDay = parsedDay && trade.closedAt === closedAt && closedAt.includes('T') && frozenDay && parseYmd(frozenDay)
    ? frozenDay
    : parsedDay
  const preview = previewResult.ok && displayDay ? previewResult : null
  const hasInput = Boolean(pnl.trim() || rMultiple.trim())
  const invalidMetric = (value: string) => Boolean(value.trim()) &&
    (!Number.isFinite(Number(value)) || (outcome !== 'breakeven' && Number(value) === 0))
  const pnlInvalid = invalidMetric(pnl)
  const rInvalid = invalidMetric(rMultiple)
  const guidance = !displayDay ? '请选择有效的平仓日期' : !previewResult.ok ? previewResult.error : ''
  const showError = Boolean(guidance) && (!displayDay || hasInput)
  const values = preview ? [
    preview.patch.pnl == null ? null : formatTradeCashPnl(
      { ...trade, pnl: preview.patch.pnl }, legacyCashCurrencyAssumption, privacyMode,
    ),
    preview.patch.rMultiple == null ? null : fmtR(preview.patch.rMultiple),
  ].filter(Boolean).join(' · ') : ''

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!preview) {
      const invalidField = event.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?? event.currentTarget.querySelector<HTMLInputElement>('input[aria-label="盈亏金额"]')
      invalidField?.focus()
      return
    }
    commitClose(preview.status, preview.patch)
  }

  return (
    <ModalShell
      title="完成平仓"
      description={`${trade.symbol} · ${trade.ref}`}
      size="compact"
      panelClassName="trade-close-dialog"
      initialFocusSelector={trade.tradeKind === 'backtest' ? 'input[aria-label="R 倍数"]' : 'input[aria-label="盈亏金额"]'}
      returnFocusTo={request.returnFocus}
      onClose={cancelTradeClose}
      footer={(
        <>
          <Button variant="ghost" size="lg" onClick={cancelTradeClose}>取消</Button>
          <Button type="submit" form="trade-close-form" variant="primary" size="lg" disabled={!preview}>保存并待复盘</Button>
        </>
      )}
    >
      <form id="trade-close-form" className="trade-close-form" onSubmit={submit}>
        <div className="trade-close-fields">
          <div className="trade-close-field">
            <span>交易结果</span>
            <SegmentedControl
              className="trade-close-outcomes" label="交易结果" role="radiogroup" size="md"
              options={OUTCOMES} value={outcome} onChange={changeOutcome}
            />
          </div>
          <div className="trade-close-field trade-close-date-field">
            <span>平仓日期</span>
            <DatePicker
              value={displayDay ?? ''}
              onValueChange={setClosedAt}
              ariaLabel="平仓日期"
              ariaInvalid={!displayDay}
              ariaDescribedBy={displayDay ? undefined : 'trade-close-summary'}
              required
            />
          </div>
          <label className="trade-close-field">
            <span>盈亏金额</span>
            <input
              aria-label="盈亏金额"
              type={privacyMode ? 'password' : 'text'}
              autoComplete="off"
              inputMode="decimal"
              aria-describedby="trade-close-summary"
              aria-invalid={pnlInvalid || undefined}
              value={pnl}
              onChange={(event) => setPnl(event.target.value)}
              placeholder={outcome === 'breakeven' ? '例如 -2.5' : '例如 500'}
            />
          </label>
          <label className="trade-close-field">
            <span>R 倍数</span>
            <input
              aria-label="R 倍数"
              inputMode="decimal"
              aria-describedby="trade-close-summary"
              aria-invalid={rInvalid || undefined}
              value={rMultiple}
              onChange={(event) => setRMultiple(event.target.value)}
              placeholder={outcome === 'breakeven' ? '例如 -0.02' : '例如 1.5'}
            />
          </label>
        </div>
        <p
          id="trade-close-summary"
          className="trade-close-summary"
          role={showError ? 'alert' : 'status'}
        >
          {preview ? (
            <>
              {outcome === 'breakeven' && !hasInput ? '可正可负，留空将记录' : '将记录'}
              {' '}<strong>{values}</strong>
            </>
          ) : guidance}
        </p>
      </form>
    </ModalShell>
  )
}
