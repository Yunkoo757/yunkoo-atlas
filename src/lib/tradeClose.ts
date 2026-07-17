import type { Trade, TradeStatus } from '@/data/trades'

export type CloseOutcome = Extract<TradeStatus, 'win' | 'loss' | 'breakeven'>
/** 手动填写盈亏与/或 R；不再支持按出入场价推导。 */
export type CloseResultMode = 'pnl' | 'r'

export type TradeCloseInput = {
  outcome: CloseOutcome
  resultMode: CloseResultMode
  pnl: number | null
  rMultiple: number | null
  closedAt: string
}

export type TradeClosePatch = Partial<
  Pick<Trade, 'pnl' | 'rMultiple' | 'resultSource' | 'initialStopLoss' | 'closedAt' | 'reviewStatus' | 'reviewedAt'>
>

export type TradeCloseResult =
  | { ok: true; status: CloseOutcome; patch: TradeClosePatch }
  | { ok: false; error: string }

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 将平仓表单收敛为一份自洽的数据补丁。只有可以证明结果的数据才允许进入统计。
 * 不再写入 exit；出入场价不参与平仓主路径。
 */
export function prepareTradeClose(_trade: Trade, input: TradeCloseInput): TradeCloseResult {
  const pnlInput = finiteOrNull(input.pnl)
  const rInput = finiteOrNull(input.rMultiple)
  let pnl: number | null = null
  let rMultiple: number | null = null
  let resultSource: Trade['resultSource']

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

  return {
    ok: true,
    status: input.outcome,
    patch: {
      pnl,
      rMultiple,
      resultSource,
      initialStopLoss: _trade.initialStopLoss,
      closedAt: input.closedAt,
      reviewStatus: 'unreviewed',
      reviewedAt: null,
    },
  }
}
