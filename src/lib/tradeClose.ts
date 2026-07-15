import type { Trade, TradeStatus } from '@/data/trades'
import { calcPriceResult, calcRFromPrices, pnlToStatus } from '@/lib/tradeCalc'

export type CloseOutcome = Extract<TradeStatus, 'win' | 'loss' | 'breakeven'>
export type CloseResultMode = 'pnl' | 'r' | 'price'
export type PrimaryCloseResultMode = Exclude<CloseResultMode, 'price'>

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

export function parsePrimaryCloseResultMode(value: unknown): PrimaryCloseResultMode | null {
  return value === 'pnl' || value === 'r' ? value : null
}

export function resolveInitialCloseResultMode(
  trade: Pick<Trade, 'pnl' | 'rMultiple' | 'resultSource'>,
  rememberedMode: unknown,
): CloseResultMode {
  if (trade.resultSource === 'price') return 'price'
  if (trade.resultSource === 'r') return 'r'
  if (trade.resultSource === 'pnl') return 'pnl'
  if (trade.pnl == null && trade.rMultiple != null) return 'r'
  return parsePrimaryCloseResultMode(rememberedMode) ?? 'pnl'
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
    resultSource = 'price'
    if (exit == null) return { ok: false, error: '请填写出场价' }
    const entry = finiteOrNull(trade.entry)
    if (entry == null) return { ok: false, error: '缺少有效入场价，无法按价格计算结果' }
    const priceResult = calcPriceResult(trade.side, entry, exit)
    if (priceResult == null) return { ok: false, error: '入场价或出场价无效，请核对后再保存' }
    pnl = null
    const initialStopLoss = trade.initialStopLoss ?? trade.stopLoss ?? null
    rMultiple = calcRFromPrices(trade.side, entry, exit, initialStopLoss)
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
