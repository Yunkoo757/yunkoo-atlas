import type { Trade, TradeKind, TradeStatus } from '@/data/trades'
import { transitionTradeKind } from '@/lib/tradeKind'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function trade(tradeKind: TradeKind, status: TradeStatus): Trade {
  return {
    id: `${tradeKind}-${status}`,
    ref: 'TRD-KIND',
    symbol: 'BTCUSDT',
    side: 'long',
    status,
    conviction: 'medium',
    strategyId: 'strategy-1',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind,
    entry: 100,
    exit: null,
    size: 1,
    pnl: null,
    rMultiple: null,
    openedAt: '2026-07-22',
    closedAt: null,
    note: '',
  }
}

export function testTradeKindTransitionCoversTheFullThreeByThreeBySixMatrix(): void {
  const kinds: TradeKind[] = ['live', 'paper', 'case']
  const statuses: TradeStatus[] = ['planned', 'open', 'missed', 'win', 'loss', 'breakeven']
  let cases = 0
  for (const status of statuses) {
    for (const source of kinds) {
      for (const target of kinds) {
        cases += 1
        const current = trade(source, status)
        const result = transitionTradeKind(current, target)
        const shouldChange = status === 'planned' &&
          source !== target &&
          source !== 'case' &&
          target !== 'case'
        if (source === target) {
          assert(result.ok && !result.changed && result.trade === current, `${source}→${target}/${status} 必须是引用不变的 no-op`)
        } else if (shouldChange) {
          assert(result.ok && result.changed && result.trade.tradeKind === target, `${source}→${target}/${status} 应是唯一合法变化`)
        } else {
          assert(!result.ok && result.trade === current, `${source}→${target}/${status} 必须零修改拒绝`)
        }
      }
    }
  }
  assert(cases === 54, '转换矩阵必须覆盖 3×3×6 共 54 个组合')
}
// Quality-Scenario: T-KIND-MATRIX
