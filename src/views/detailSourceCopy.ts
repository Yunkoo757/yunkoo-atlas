import type { Trade } from '@/data/trades'

export type TradeDetailSourceCopy = {
  breadcrumb: string
  backAriaLabel: string
  returnDestinationLabel: string
}

export function resolveTradeDetailSourceCopy(options: {
  fromPathname?: string | null
  returnPathname: string
  tradeKind?: Trade['tradeKind']
}): TradeDetailSourceCopy {
  if (options.fromPathname === '/settings/risk/data-repair') {
    return {
      breadcrumb: '风险数据修复中心',
      backAriaLabel: '返回修复中心',
      returnDestinationLabel: '修复中心',
    }
  }

  const fromMissedOpportunities = options.fromPathname === '/missed'
  const fromLiveArchive = options.fromPathname === '/live-history'
    || options.fromPathname === '/live-history/board'
    || options.fromPathname === '/live-archive'
    || options.fromPathname?.startsWith('/live-archive/')
  const fromWeeklyReview = options.returnPathname === '/weekly-review'
  const breadcrumb = fromMissedOpportunities
    ? '错过的机会'
    : fromLiveArchive
      ? '历史实盘'
      : fromWeeklyReview
        ? '周复盘'
        : options.tradeKind === 'case'
          ? '案例记录'
          : options.tradeKind === 'paper'
            ? '模拟'
            : '交易日志'
  const backAriaLabel = fromMissedOpportunities
    ? '返回错过的机会'
    : fromLiveArchive
      ? '返回历史实盘'
      : fromWeeklyReview
        ? '返回周复盘'
        : '返回列表'
  const returnDestinationLabel = fromMissedOpportunities
    ? '错过的机会'
    : fromLiveArchive
      ? '历史实盘'
      : fromWeeklyReview
        ? '周复盘'
        : options.tradeKind === 'case'
          ? '案例记录'
          : '交易日志'

  return { breadcrumb, backAriaLabel, returnDestinationLabel }
}
