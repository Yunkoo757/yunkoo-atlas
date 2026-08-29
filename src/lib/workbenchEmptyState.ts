import type { Trade, TradeKind } from '@/data/trades'
import type { ListFilter } from '@/lib/tradeFilters'
import { isHiddenWhenClosedFilter } from '@/lib/tradeStatus'
import { matchesTradeFacets } from '@/lib/tradeView'
import { filterTrades, parseTradeFacets } from '@/lib/workbenchTrades'
import type { BusinessDateAnchor } from '@/lib/periods'
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
  primaryAction: WorkbenchEmptyAction
  secondaryActions: WorkbenchEmptyAction[]
}

export type WorkbenchEmptyAction = {
  id: 'create-trade' | 'create-case' | 'create-paper' | 'clear-filters' | 'import-backup' | 'configure-strategy'
  label: string
  intent: 'create' | 'reset' | 'link'
  href?: string
}

function createAction(recordKind?: TradeKind): WorkbenchEmptyAction {
  if (recordKind === 'case') {
    return { id: 'create-case', label: '新建案例', intent: 'create' }
  }
  if (recordKind === 'paper') {
    return { id: 'create-paper', label: '新建模拟盘记录', intent: 'create' }
  }
  return { id: 'create-trade', label: '新建第一笔交易', intent: 'create' }
}

export function resolveWorkbenchEmptyState(options: {
  totalCount: number
  workspaceCount: number
  visibleCount: number
  recordKind?: TradeKind
}): WorkbenchEmptyState | null {
  if (options.visibleCount > 0) return null
  const recordLabel = options.recordKind === 'case'
    ? '案例'
    : options.recordKind === 'paper'
      ? '模拟盘记录'
      : '交易'
  if (options.totalCount === 0) {
    const primaryAction = createAction(options.recordKind)
    return {
      kind: 'library',
      title: '还没有任何记录',
      hint: `新建${recordLabel}、导入备份或配置策略，开始建立交易库。`,
      action: 'create',
      actionLabel: `新建${recordLabel}`,
      primaryAction,
      secondaryActions: [
        { id: 'import-backup', label: '导入备份', intent: 'link', href: '/settings/data' },
        { id: 'configure-strategy', label: '配置策略', intent: 'link', href: '/settings/strategies' },
      ],
    }
  }

  if (options.workspaceCount === 0) {
    const primaryAction = createAction(options.recordKind)
    return {
      kind: 'workspace',
      title: `当前工作区暂无${recordLabel}`,
      hint: `其他阶段或类型已有记录，可直接新建${recordLabel}。`,
      action: 'create',
      actionLabel: `新建${recordLabel}`,
      primaryAction,
      secondaryActions: [],
    }
  }

  const primaryAction: WorkbenchEmptyAction = {
    id: 'clear-filters',
    label: '清除筛选',
    intent: 'reset',
  }
  return {
    kind: 'filtered',
    title: `没有符合当前条件的${recordLabel}`,
    hint: '当前视图、筛选或显示偏好隐藏了已有记录。',
    action: 'reset',
    actionLabel: `查看全部${recordLabel}`,
    primaryAction,
    secondaryActions: [],
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
  businessDateAnchor?: BusinessDateAnchor
}): boolean {
  if (!options.hideClosed) return false
  if (options.filter.type === 'missed' || options.filter.tradeKind === 'case') return false

  const facets = parseTradeFacets(options.search)
  if (facets.status && isHiddenWhenClosedFilter(facets.status)) return false

  const tradingDayStartHour = options.businessDateAnchor?.tradingDayStartHour
  return filterTrades(
    options.trades,
    options.filter,
    options.starredIds,
    tradingDayStartHour,
    options.businessDateAnchor,
  ).some(
    (trade) => isHiddenWhenClosedFilter(trade.status) && matchesTradeFacets(
      trade,
      facets,
      tradingDayStartHour,
      options.businessDateAnchor,
    ),
  )
}
