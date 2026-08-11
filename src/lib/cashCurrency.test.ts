import type { Trade } from '@/data/trades'
import {
  eligibleUsdPnlIds,
  formatTradeCashPnl,
  resolveTradeCashCurrencyFact,
  summarizeUsdPnl,
} from '@/lib/cashCurrency'
import type { LegacyCashCurrencyAssumption } from '@/storage/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const assumption: LegacyCashCurrencyAssumption = {
  currency: 'USD',
  confirmedAt: '2026-08-09T04:00:00.000Z',
}

function trade(
  id: string,
  pnl: number,
  cashCurrency: string | null | undefined,
  explicitlyPresent = true,
): Trade {
  const value: Trade = {
    id,
    ref: id,
    symbol: 'FX',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 1,
    exit: 2,
    size: 1,
    pnl,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: '2026-08-03T08:00:00.000Z',
    closedAt: '2026-08-03T09:00:00.000Z',
    closedTradingDayKey: '2026-08-03',
    note: '',
  }
  if (explicitlyPresent) value.cashCurrency = cashCurrency
  return value
}

export function testCashCurrencyResolverOnlyAppliesLegacyUsdToMissingField(): void {
  const legacyMissing = trade('legacy', 50, undefined, false)
  const explicitNull = trade('null', 80, null)
  const explicitCny = trade('cny', 700, 'CNY')

  assert(resolveTradeCashCurrencyFact(legacyMissing, null).source === 'legacy-assumption', '缺字段旧记录应默认按 USD 解释')
  assert(resolveTradeCashCurrencyFact(legacyMissing, null).currency === 'USD', '缺字段旧记录应解析为 USD')
  assert(resolveTradeCashCurrencyFact(legacyMissing, assumption).currency === 'USD', '资料库假设字段不再改变缺字段默认口径')
  assert(resolveTradeCashCurrencyFact(explicitNull, null).currency === null, '显式 null 不得被默认覆盖')
  assert(resolveTradeCashCurrencyFact(explicitCny, null).currency === 'CNY', '显式 CNY 不得被默认覆盖')
  assert(!Object.prototype.hasOwnProperty.call(legacyMissing, 'cashCurrency'), '解析不得回写旧记录的原始币种事实')
}

export function testUsdEligibilityAndTotalsShareOneCurrencyFactRule(): void {
  const conflict = {
    ...trade('conflict', -10, 'USD'),
    status: 'win',
    rMultiple: -1,
    resultSource: 'imported',
  } as Trade
  const trades = [
    trade('usd', 100, 'USD'),
    trade('cny', 700, 'CNY'),
    trade('legacy', 50, undefined, false),
    trade('unknown', 80, null),
    trade('invalid', 90, 'US'),
    conflict,
  ]

  assert(eligibleUsdPnlIds(trades, null).join(',') === 'usd,legacy', '缺字段旧记录默认进入 USD 总计，显式 null/CNY/非法币种仍排除')
  assert(eligibleUsdPnlIds(trades, assumption).join(',') === 'usd,legacy', 'assumption 参数不得再分叉 USD 资格')
  const summary = summarizeUsdPnl(trades, null)
  assert(summary.pnlCount === 2 && summary.totalPnl === 150, '共享 USD 汇总必须排除 CNY、显式 null、非法币种与结果冲突')
  const conflictOnly = summarizeUsdPnl([conflict], null)
  assert(conflictOnly.pnlCount === 0 && conflictOnly.totalPnl === 0, '单独的 USD 结果冲突必须冻结为零覆盖、零总计')
}

export function testSingleTradeCashPresentationUsesResolvedCurrency(): void {
  assert(
    formatTradeCashPnl(trade('legacy', 50, undefined, false), null) === '+$50',
    '单笔旧记录默认展示为 USD，不再附加解释后缀',
  )
  assert(formatTradeCashPnl(trade('null', 80, null), null) === '+80', '显式 null 只展示数值，不附加币种未知标签')
  assert(formatTradeCashPnl(trade('cny', 700, 'CNY'), null) === '+CN¥700', '显式 CNY 必须展示自身币种')
}
