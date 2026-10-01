import type { Trade } from '@/data/trades'

export type RecordActionId = 'edit' | 'copy' | 'extract-case' | 'star' | 'focus-case' | 'delete'

export type RecordActionDescriptor = Readonly<{
  id: RecordActionId
  label: string
  danger?: boolean
}>

export function buildRecordActionDescriptors(
  trade: Pick<Trade, 'tradeKind'>,
  options: { starred: boolean },
): RecordActionDescriptor[] {
  const isCase = trade.tradeKind === 'case'
  const isBacktest = trade.tradeKind === 'backtest'
  return [
    { id: 'edit', label: isCase ? '编辑案例' : isBacktest ? '编辑回测记录' : '编辑交易' },
    { id: 'copy', label: isCase ? '复制案例' : isBacktest ? '复制为待确认记录' : '复制为新计划' },
    ...(isCase ? [] : [{ id: 'extract-case' as const, label: '提炼为案例' }]),
    ...(isCase
      ? [{ id: 'focus-case' as const, label: options.starred ? '取消重点' : '设为重点案例' }]
      : [{ id: 'star' as const, label: options.starred ? '取消星标' : '加入星标' }]),
    { id: 'delete', label: isCase ? '删除案例' : isBacktest ? '删除回测记录' : '删除交易', danger: true },
  ]
}

export function getBatchCopyActionLabel(
  trades: ReadonlyArray<Pick<Trade, 'tradeKind'>>,
): string {
  if (trades.length > 0 && trades.every(trade => trade.tradeKind === 'backtest')) return '复制为待确认记录'
  const hasCases = trades.some((trade) => trade.tradeKind === 'case')
  const hasAccountTrades = trades.some((trade) => trade.tradeKind !== 'case')
  if (hasCases && hasAccountTrades) return '复制所选记录'
  return hasCases ? '复制案例' : '复制为新计划'
}

