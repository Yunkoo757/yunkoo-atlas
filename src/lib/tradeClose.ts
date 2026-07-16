import type { Trade, TradeStatus } from '@/data/trades'
import { calcPriceResult, calcRFromPrices, pnlToStatus } from '@/lib/tradeCalc'

export type CloseOutcome = Extract<TradeStatus, 'win' | 'loss' | 'breakeven'>
export type CloseResultMode = 'pnl' | 'r' | 'price'

export type TradeCloseInput = {
  outcome: CloseOutcome
  resultMode: CloseResultMode
  pnl: number | null
  rMultiple: number | null
  exit: number | null
  closedAt: string
}

export type TradeClosePatch = Partial<
  Pick<Trade, 'exit' | 'pnl' | 'rMultiple' | 'resultSource' | 'initialStopLoss' | 'closedAt' | 'reviewStatus' | 'reviewedAt'>
>

export type TradeCloseResult =
  | { ok: true; status: CloseOutcome; patch: TradeClosePatch }
  | { ok: false; error: string }

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 将平仓表单收敛为一份自洽的数据补丁。只有可以证明结果的数据才允许进入统计。
 */
export function prepareTradeClose(trade: Trade, input: TradeCloseInput): TradeCloseResult {
  const exit = finiteOrNull(input.exit)
  const pnlInput = finiteOrNull(input.pnl)
  const rInput = finiteOrNull(input.rMultiple)
  let pnl: number | null = null
  let rMultiple: number | null = null
  let resultSource: Trade['resultSource']
  let outcome = input.outcome

  if (input.resultMode === 'pnl' || input.resultMode === 'r') {
    if (input.outcome === 'breakeven') {
      pnl = 0
      rMultiple = 0
      resultSource = 'imported'
    } else {
      if (pnlInput === 0 || rInput === 0) {
        return { ok: false, error: '非保本交易的结果数值必须大于 0' }
      }
      if (pnlInput == null && rInput == null) {
        return { ok: false, error: '请至少填写盈亏金额或 R 倍数' }
      }
      const direction = input.outcome === 'loss' ? -1 : 1
      pnl = pnlInput == null ? null : direction * Math.abs(pnlInput)
      rMultiple = rInput == null ? null : direction * Math.abs(rInput)
      resultSource = pnl != null && rMultiple != null
        ? 'imported'
        : pnl != null
          ? 'pnl'
          : 'r'
    }
  } else if (input.resultMode === 'price') {
    if (exit == null) return { ok: false, error: '请填写出场价' }
    const priceResult = calcPriceResult(trade.side, trade.entry, exit)
    if (priceResult == null) return { ok: false, error: '入场价或出场价无效，请核对后再保存' }
    pnl = null
    const initialStopLoss = trade.initialStopLoss ?? trade.stopLoss ?? null
    rMultiple = calcRFromPrices(trade.side, trade.entry, exit, initialStopLoss)
    resultSource = rMultiple == null ? undefined : 'price'
    outcome = pnlToStatus(priceResult)
  }

  return {
    ok: true,
    status: outcome,
    patch: {
      exit,
      pnl,
      rMultiple,
      resultSource,
      initialStopLoss: input.resultMode === 'price'
        ? trade.initialStopLoss ?? trade.stopLoss ?? null
        : trade.initialStopLoss,
      closedAt: input.closedAt,
      reviewStatus: 'unreviewed',
      reviewedAt: null,
    },
  }
}
