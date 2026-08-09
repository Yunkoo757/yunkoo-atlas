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

  assert(resolveTradeCashCurrencyFact(legacyMissing, assumption).source === 'legacy-assumption', '缺字段旧记录应使用资料库假设')
  assert(resolveTradeCashCurrencyFact(legacyMissing, assumption).currency === 'USD', '缺字段旧记录应解析为 USD')
  assert(resolveTradeCashCurrencyFact(explicitNull, assumption).currency === null, '显式 null 不得被假设覆盖')
  assert(resolveTradeCashCurrencyFact(explicitCny, assumption).currency === 'CNY', '显式 CNY 不得被假设覆盖')
  assert(!Object.prototype.hasOwnProperty.call(legacyMissing, 'cashCurrency'), '解析不得回写旧记录的原始币种事实')
}

export function testUsdEligibilityAndTotalsShareOneCurrencyFactRule(): void {
  const trades = [
    trade('usd', 100, 'USD'),
    trade('cny', 700, 'CNY'),
    trade('legacy', 50, undefined, false),
    trade('unknown', 80, null),
    trade('invalid', 90, 'US'),
  ]

  assert(eligibleUsdPnlIds(trades, null).join(',') === 'usd', '无假设时只有显式 USD 可进入总计')
  assert(eligibleUsdPnlIds(trades, assumption).join(',') === 'usd,legacy', '假设仅应加入真正缺字段旧记录')
  const summary = summarizeUsdPnl(trades, assumption)
  assert(summary.pnlCount === 2 && summary.totalPnl === 150, '共享 USD 汇总必须排除 CNY、显式 null 与非法币种')
}

export function testSingleTradeCashPresentationExplainsLegacyAssumption(): void {
  assert(
    formatTradeCashPnl(trade('legacy', 50, undefined, false), assumption) === '+$50 · 按资料库假设作为 USD',
    '单笔旧记录必须明确说明 USD 来自资料库假设',
  )
  assert(formatTradeCashPnl(trade('null', 80, null), assumption) === '+80 · 币种未知', '显式 null 必须继续显示币种未知')
  assert(formatTradeCashPnl(trade('cny', 700, 'CNY'), assumption) === '+CN¥700', '显式 CNY 必须展示自身币种')
}
