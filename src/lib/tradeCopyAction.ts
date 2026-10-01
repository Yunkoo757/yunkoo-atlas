import type { Trade } from '@/data/trades'
import { buildSafeTradeCopies } from '@/lib/tradeCopy'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'

export type TradeCopyActionResult =
  | Readonly<{ status: 'copied'; source: Trade; copy: Trade }>
  | Readonly<{ status: 'source-missing' }>
  | Readonly<{ status: 'failed'; reason?: 'project-archived' }>

export function copyTradeRecord(
  tradeId: string,
  options: {
    now?: Date
    createId?: () => string
  } = {},
): TradeCopyActionResult {
  const state = useStore.getState()
  const source = state.trades.find((trade) => trade.id === tradeId && !trade.deletedAt)
  if (!source) return { status: 'source-missing' }
  if (source.tradeKind === 'backtest' && state.backtestProjects.some(project => project.id === source.backtestProjectId && project.archivedAt)) {
    return { status: 'failed', reason: 'project-archived' }
  }

  try {
    const [copy] = buildSafeTradeCopies([source], state.trades, {
      now: options.now ?? new Date(),
      createId: options.createId ?? (() => crypto.randomUUID()),
    })
    if (!copy || state.upsertTrades([copy]) !== 'updated') return { status: 'failed' }
    return { status: 'copied', source, copy }
  } catch {
    return { status: 'failed' }
  }
}

export function copyTradeRecordWithFeedback(tradeId: string): TradeCopyActionResult {
  const result = copyTradeRecord(tradeId)
  if (result.status === 'source-missing') {
    toast('源记录已变更，无法复制', { tone: 'error' })
  } else if (result.status === 'failed') {
    toast(result.reason === 'project-archived' ? '项目已归档，请重新打开后复制' : '复制失败，请重试', { tone: 'error' })
  } else {
    toast(result.source.tradeKind === 'case' ? '已复制为新案例' : result.source.tradeKind === 'backtest' ? '已复制为待确认回测记录' : '已复制为新计划', {
      tone: 'success',
    })
  }
  return result
}

