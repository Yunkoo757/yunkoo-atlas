import type { Trade, TradeStatus } from '@/data/trades'
import { calcPnl, calcRFromStop, pnlToStatus } from '@/lib/tradeCalc'

export type CloseOutcome = Extract<TradeStatus, 'win' | 'loss' | 'breakeven'>

export type TradeCloseInput = {
  outcome: CloseOutcome
  exit: number | null
  pnl: number | null
  rMultiple: number | null
  closedAt: string
}

export type TradeClosePatch = Partial<
  Pick<Trade, 'exit' | 'pnl' | 'rMultiple' | 'closedAt' | 'reviewStatus'>
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
  let pnl = finiteOrNull(input.pnl)
  let rMultiple = finiteOrNull(input.rMultiple)

  if (pnl == null && exit != null) {
    pnl = calcPnl(trade.side, trade.entry, exit, trade.size)
  }
  if (rMultiple == null && pnl != null) {
    rMultiple = calcRFromStop(trade.side, pnl, trade.entry, trade.stopLoss, trade.size)
  }

  if (pnl == null && rMultiple == null) {
    return { ok: false, error: '请填写盈亏、R 倍数，或提供可计算盈亏的出场价' }
  }

  const metricOutcomes = [pnl, rMultiple]
    .filter((value): value is number => value != null)
    .map(pnlToStatus)
  if (metricOutcomes.some((outcome) => outcome !== metricOutcomes[0])) {
    return { ok: false, error: '盈亏与 R 倍数方向不一致，请核对后再保存' }
  }
  if (metricOutcomes[0] !== input.outcome) {
    return { ok: false, error: '选择的结果与数值方向不一致，请核对后再保存' }
  }

  return {
    ok: true,
    status: input.outcome,
    patch: {
      exit,
      pnl,
      rMultiple,
      closedAt: input.closedAt,
      reviewStatus: 'unreviewed',
    },
  }
}

