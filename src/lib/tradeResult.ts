import type { Trade, TradeStatus } from '@/data/trades'
import { calcPriceResult, calcRFromFrozenPriceRisk, pnlToStatus } from '@/lib/tradeCalc'
import { resolveTradeResultSource } from '@/lib/tradeTruth'
import { isExecutedClosed } from '@/lib/tradeStatus'

type ExecutionPatch = Partial<Pick<Trade, 'side' | 'entry' | 'exit' | 'stopLoss' | 'size'>>

function validStopLoss(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0 ? value : null
}

/** 首次记录止损时冻结风险；旧记录第一次移动止损时优先保留移动前的值。 */
export function freezeInitialStopLossPatch(
  trade: Pick<Trade, 'stopLoss' | 'initialStopLoss'>,
  nextStopLoss: number | null | undefined,
): Partial<Pick<Trade, 'initialStopLoss'>> {
  if (validStopLoss(trade.initialStopLoss) != null) return {}
  const initialStopLoss = validStopLoss(trade.stopLoss) ?? validStopLoss(nextStopLoss)
  return initialStopLoss == null ? {} : { initialStopLoss }
}

/**
 * 为创建、导入及旧版记录补齐当前能确定的初始风险。
 * 旧版记录若曾移动止损但未保存 initialStopLoss，历史原值无法还原，只能以当前止损尽力迁移。
 */
export function normalizeInitialStopLoss<T extends Trade>(trade: T): T {
  const patch = freezeInitialStopLossPatch(trade, trade.stopLoss)
  return 'initialStopLoss' in patch ? { ...trade, ...patch } : trade
}

export type TradeResultEdit = {
  kind: 'execution'
  patch: ExecutionPatch
} | {
  kind: 'result'
  source: 'pnl' | 'r'
  value: number | null
}

export type TradeResultEditResult = {
  patch: Partial<Trade>
  status?: Extract<TradeStatus, 'win' | 'loss' | 'breakeven'>
}

/**
 * 收敛详情页对执行数据的修改，避免无关字段覆盖已确认的结果依据。
 */
export function prepareTradeResultEdit(
  trade: Trade,
  edit: TradeResultEdit,
): TradeResultEditResult {
  if (edit.kind === 'result') {
    const value = typeof edit.value === 'number' && Number.isFinite(edit.value)
      ? edit.value
      : null
    if (value == null) {
      const remaining = edit.source === 'pnl' ? trade.rMultiple : trade.pnl
      return {
        patch: edit.source === 'pnl'
          ? { pnl: null, resultSource: remaining == null ? undefined : 'r' }
          : { rMultiple: null, resultSource: remaining == null ? undefined : 'pnl' },
      }
    }
    const pairedValue = edit.source === 'pnl' ? trade.rMultiple : trade.pnl
    const keepPair = pairedValue != null && pnlToStatus(pairedValue) === pnlToStatus(value)
    return {
      patch: edit.source === 'pnl'
        ? {
            pnl: value,
            ...(keepPair ? {} : { rMultiple: null }),
            resultSource: keepPair ? 'imported' : 'pnl',
          }
        : {
            ...(keepPair ? {} : { pnl: null }),
            rMultiple: value,
            resultSource: keepPair ? 'imported' : 'r',
          },
      status: isExecutedClosed(trade.status) ? pnlToStatus(value) : undefined,
    }
  }
  if (resolveTradeResultSource(trade) === 'price') {
    const next = { ...trade, ...edit.patch }
    const priceResult = next.entry == null ? null : calcPriceResult(next.side, next.entry, next.exit ?? 0)
    const initialStopLossPatch = 'stopLoss' in edit.patch
      ? freezeInitialStopLossPatch(trade, edit.patch.stopLoss)
      : {}
    const initialStopLoss = initialStopLossPatch.initialStopLoss
      ?? next.initialStopLoss
      ?? next.stopLoss
    const rMultiple = next.entry == null ? null : calcRFromFrozenPriceRisk(next.entry, priceResult, initialStopLoss)
    return {
      patch: {
        ...edit.patch,
        ...initialStopLossPatch,
        pnl: null,
        rMultiple,
        resultSource: priceResult == null || rMultiple == null ? undefined : 'price',
      },
      status: priceResult == null || !isExecutedClosed(trade.status)
        ? undefined
        : pnlToStatus(priceResult),
    }
  }
  return {
    patch: {
      ...edit.patch,
      ...('stopLoss' in edit.patch
        ? freezeInitialStopLossPatch(trade, edit.patch.stopLoss)
        : {}),
    },
  }
}
