import { isValidPeriodSlug, PERIOD_LABELS } from '@/lib/periods'
import { isBoardPath } from '@/lib/routeContext'
import { normalizeSavedViewPath } from '@/lib/savedTradeViews'

export type TradeDetailSourceCopy = {
  breadcrumb: string
  backAriaLabel: string
  returnDestinationLabel: string
}

function source(breadcrumb: string, destination = breadcrumb): TradeDetailSourceCopy {
  return { breadcrumb, backAriaLabel: `返回${destination}`, returnDestinationLabel: destination }
}

const destinations: Record<string, string> = {
  '/dashboard': '统计分析',
  '/review-session': '随机复盘',
  '/weekly-review': '周复盘',
  '/settings/risk': '风险管理',
  '/missed': '错过机会',
  '/favorites': '星标交易',
  '/active': '进行中',
  '/today-record': '待补全',
  '/live-history': '历史实盘',
}

export function resolveTradeDetailSourceCopy(returnPathname: string): TradeDetailSourceCopy {
  const path = returnPathname.replace(/\/+$/, '')
  if (path.startsWith('/notes/')) return source('随记', '来源随记')
  if (path === '/backtests' || path.startsWith('/backtests/')) return source('回测项目')
  if (path === '/settings/risk/data-repair') return source('风险数据修复中心', '修复中心')
  if (path === '/live-archive' || path.startsWith('/live-archive/')) return source('历史实盘')

  const listPath = normalizeSavedViewPath(path)
  const destination = destinations[listPath]
  if (destination) return source(destination)

  const board = isBoardPath(path)
  if (listPath === '/review-cases' || listPath.startsWith('/review-cases/')) return source(board ? '案例看板' : '案例库')
  if (listPath === '/sim') return source(board ? '模拟看板' : '模拟交易')
  if (listPath.startsWith('/period/')) {
    const period = listPath.slice('/period/'.length)
    if (isValidPeriodSlug(period)) return source(PERIOD_LABELS[period] + (board ? '看板' : '交易'))
  }
  return source(board ? '交易看板' : '交易日志')
}
