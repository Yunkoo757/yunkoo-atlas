import type { Trade, TradeKind } from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { isHiddenWhenClosedFilter } from '@/lib/tradeStatus'
import { matchesTradeFacets } from '@/lib/tradeView'
import { filterTrades, parseTradeFacets } from '@/lib/workbenchTrades'
import {
  pathWithWorkbenchMode,
  workbenchModeFromPathname,
} from '@/lib/routeContext'

export type WorkbenchEmptyState = {
  kind: 'library' | 'workspace' | 'filtered'
  title: string
  hint: string
  action: 'create' | 'reset'
  actionLabel: string
}

export function resolveWorkbenchEmptyState(options: {
  totalCount: number
  workspaceCount: number
  visibleCount: number
  recordKind?: TradeKind
}): WorkbenchEmptyState | null {
  if (options.visibleCount > 0) return null
  if (options.totalCount === 0) {
    return {
      kind: 'library',
      title: '还没有任何记录',
      hint: '新建第一条记录，开始积累你的复盘样本。',
      action: 'create',
      actionLabel: options.recordKind === 'case'
        ? '新建案例记录'
        : options.recordKind === 'paper'
          ? '新建模拟交易'
          : '新建交易',
    }
  }

  const recordLabel = options.recordKind === 'case'
    ? '案例记录'
    : options.recordKind === 'paper'
      ? '模拟交易'
      : '交易'
  if (options.workspaceCount === 0) {
    return {
      kind: 'workspace',
      title: `还没有${recordLabel}`,
      hint: `新建第一条${recordLabel}，开始积累复盘样本。`,
      action: 'create',
      actionLabel: `新建${recordLabel}`,
    }
  }

  return {
    kind: 'filtered',
    title: `没有符合当前条件的${recordLabel}`,
    hint: '当前视图、筛选或显示偏好隐藏了已有记录。',
    action: 'reset',
    actionLabel: `查看全部${recordLabel}`,
  }
}

export function getWorkbenchResetPath(pathname: string, recordKind?: TradeKind): string {
  const root = recordKind === 'case'
    ? '/review-cases'
    : recordKind === 'paper'
      ? '/sim'
      : '/list'
  return pathWithWorkbenchMode(root, workbenchModeFromPathname(pathname))
}

export function shouldResetWorkbenchHideClosed(options: {
  hideClosed: boolean
  trades: Trade[]
  filter: ListFilter
  starredIds: string[]
  search: string | URLSearchParams
}): boolean {
  if (!options.hideClosed) return false
  if (options.filter.type === 'missed' || options.filter.tradeKind === 'case') return false

  const facets = parseTradeFacets(options.search)
  if (facets.status && isHiddenWhenClosedFilter(facets.status)) return false

  return filterTrades(options.trades, options.filter, options.starredIds).some(
    (trade) => isHiddenWhenClosedFilter(trade.status) && matchesTradeFacets(trade, facets),
  )
}
