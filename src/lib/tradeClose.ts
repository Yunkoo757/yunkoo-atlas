import type { Trade, TradeStatus } from '@/data/trades'
import { calcPriceResult, calcRFromPrices, pnlToStatus } from '@/lib/tradeCalc'

export type CloseOutcome = Extract<TradeStatus, 'win' | 'loss' | 'breakeven'>
export type CloseResultMode = 'pnl' | 'r' | 'price'

export type TradeCloseInput = {
  outcome: CloseOutcome
  resultMode: CloseResultMode
  value: number | null
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
  const value = finiteOrNull(input.value)
  let pnl: number | null = null
  let rMultiple: number | null = null
  let resultSource: Trade['resultSource']
  let outcome = input.outcome

  if (input.resultMode === 'pnl') {
    resultSource = 'pnl'
    if (input.outcome === 'breakeven') {
      pnl = 0
    } else {
      if (value == null || value === 0) {
        return { ok: false, error: '请输入大于 0 的盈亏金额' }
      }
      pnl = input.outcome === 'loss' ? -Math.abs(value) : Math.abs(value)
    }
  } else if (input.resultMode === 'r') {
    resultSource = 'r'
    if (input.outcome === 'breakeven') {
      rMultiple = 0
    } else {
      if (value == null || value === 0) {
        return { ok: false, error: '请输入大于 0 的 R 倍数' }
      }
      rMultiple = input.outcome === 'loss' ? -Math.abs(value) : Math.abs(value)
    }
  } else if (input.resultMode === 'price') {
    resultSource = 'price'
    if (exit == null) return { ok: false, error: '请填写出场价' }
    const priceResult = calcPriceResult(trade.side, trade.entry, exit)
    if (priceResult == null) return { ok: false, error: '入场价或出场价无效，请核对后再保存' }
    pnl = null
    const initialStopLoss = trade.initialStopLoss ?? trade.stopLoss ?? null
    rMultiple = calcRFromPrices(trade.side, trade.entry, exit, initialStopLoss)
    if (rMultiple == null) {
      return { ok: false, error: '缺少有效初始止损，无法按价格计算 R；请改用盈亏金额或 R 倍数' }
    }
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
