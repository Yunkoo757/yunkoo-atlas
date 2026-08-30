import type { TradeKind } from '@/data/trades'
import { DEFAULT_PROFILE_DISPLAY } from '@/config/defaultProfile'
import type { CalendarPeriod } from '@/lib/periods'
import { DEFAULT_TRADING_DAY_START_HOUR, normalizeTradingDayStartHour } from '@/lib/periods'
import { parseAnalysisScope, type AnalysisScope } from '@/lib/analysisScope'
import type { ReviewCaseScope } from '@/lib/reviewCaseScope'
import {
  DEFAULT_PRIMARY_SIDEBAR_ORDER,
  DEFAULT_SIDEBAR_PINS,
  normalizePrimarySidebarOrder,
  type PrimarySidebarNavId,
  type SidebarNavId,
} from '@/lib/sidebarNavContract'
import { normalizeSidebarPins } from '@/lib/tradeKind'
import { listPathFromLegacyTablePath } from '@/lib/routeContext'
import {
  migrateSidebarPins,
  normalizeSidebarWorkspaceItems,
  type SidebarQuickWorkspace,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'

export type ListFilterType =
  | 'all'
  | 'active'
  | 'starred'
  | 'strategy'
  | 'period'
  | 'missed'
  | 'incomplete'

export interface ListFilter {
  type: ListFilterType
  strategyId?: string
  period?: CalendarPeriod
  /** 默认不过滤；主列表传 live，模拟页传 paper */
  tradeKind?: TradeKind
  /** 侧栏策略合并来源；只作用于策略页，不打穿交易日志三域隔离。 */
  strategySources?: SidebarQuickWorkspace[]
  /** 策略合并列表里，实盘只保留该阶段。 */
  liveStageId?: string
  /** 仅用于统计分析下钻：按平仓日、交易类型与日期范围锁定分析样本。 */
  analysisScope?: AnalysisScope
  reviewCaseScope?: ReviewCaseScope
  /** 历史实盘仍使用标准工作台；内容类型由此字段决定，stage 范围只由 liveStage 查询解析。 */
  historicalLiveScope?: 'trades' | 'cases'
}

/**
 * 普通日志时间范围与 Dashboard 绩效下钻属于不同的问题：前者看开仓记录，后者看可靠平仓结果。
 */
export function describeListFilterDateField(filter: ListFilter): '按开仓日' | '按可靠平仓日' {
  return filter.analysisScope ? '按可靠平仓日' : '按开仓日'
}

/** 普通交易日志保持 live 工作区；只有合法 kind/range 参数才启用 Dashboard 绩效下钻。 */
export function resolveTradeLogFilter(search: string | URLSearchParams): ListFilter {
  const parsed = parseAnalysisScope(search)
  return parsed.explicit
    ? { type: 'all', analysisScope: parsed.scope }
    : { type: 'all', tradeKind: 'live' }
}

export type { ReviewCaseScope } from '@/lib/reviewCaseScope'

export { applyDisplayPrefs, filterTrades } from '@/lib/workbenchTrades'

export type SidebarRiskScope = 'day' | 'week' | 'month'
export type ListRowDensity = 'compact' | 'comfortable'

export interface DisplayPrefs {
  hideClosed: boolean
  showEmptyGroups: boolean
  groupByStrategy: boolean
  groupByDate: boolean
  sortBy: 'date' | 'pnl' | 'conviction'
  sortDirection: 'asc' | 'desc'
  /** 直播/演示时隐藏所有现金盈亏与权益金额。 */
  privacyMode: boolean
  /** 是否显示键盘焦点高光。 */
  showKeyboardFocusRings: boolean
  /** 交易日志与案例库的桌面列表行距。 */
  listRowDensity: ListRowDensity
  /**
   * 交易日从本地几点开始（0–23）。
   * 未到该时刻仍算前一交易日；影响今日工作台、今日筛选与新建默认日期。
   */
  tradingDayStartHour: number
  /** 侧栏风险额度圆环默认观察的周期。 */
  sidebarRiskScope?: SidebarRiskScope
  /** 交易详情中是否默认固定开头的盘面叙述。 */
  reviewContextPinned?: boolean
  /** 工作台主导航的自定义顺序。 */
  sidebarPrimaryOrder?: PrimarySidebarNavId[]
  /** 旧版侧栏快捷入口偏好，保留用于兼容历史快照 */
  sidebarPins: SidebarNavId[]
  sidebarWorkspaceItems: SidebarWorkspaceItem[]
  /** 侧栏「交易日志 / 案例库」上次进入的工作区路由 */
  workspaceMemory?: {
    today?: { pathname: string; search: string }
    trade?: { pathname: string; search: string }
    case?: { pathname: string; search: string }
  }
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  hideClosed: DEFAULT_PROFILE_DISPLAY.hideClosed,
  showEmptyGroups: DEFAULT_PROFILE_DISPLAY.showEmptyGroups,
  groupByStrategy: DEFAULT_PROFILE_DISPLAY.groupMode === 'strategy',
  groupByDate: DEFAULT_PROFILE_DISPLAY.groupMode === 'date',
  sortBy: DEFAULT_PROFILE_DISPLAY.sortBy,
  sortDirection: DEFAULT_PROFILE_DISPLAY.sortDirection,
  privacyMode: false,
  showKeyboardFocusRings: false,
  listRowDensity: 'compact',
  tradingDayStartHour: DEFAULT_TRADING_DAY_START_HOUR,
  sidebarRiskScope: 'day',
  reviewContextPinned: true,
  sidebarPrimaryOrder: [...DEFAULT_PRIMARY_SIDEBAR_ORDER],
  sidebarPins: [...DEFAULT_SIDEBAR_PINS],
  sidebarWorkspaceItems: migrateSidebarPins(DEFAULT_SIDEBAR_PINS),
}

const SORT_BY = ['date', 'pnl', 'conviction'] as const
const SORT_DIRECTIONS = ['asc', 'desc'] as const
const SIDEBAR_RISK_SCOPES = ['day', 'week', 'month'] as const
const LIST_ROW_DENSITIES = ['compact', 'comfortable'] as const

function normalizeWorkspaceRoute(input: unknown): { pathname: string; search: string } | undefined {
  if (!input || typeof input !== 'object') return undefined
  const route = input as Record<string, unknown>
  if (typeof route.pathname !== 'string' || !route.pathname.startsWith('/')) return undefined
  return {
    pathname: listPathFromLegacyTablePath(route.pathname) ?? route.pathname,
    search: typeof route.search === 'string' ? route.search : '',
  }
}

function normalizeWorkspaceMemory(
  input: unknown,
): DisplayPrefs['workspaceMemory'] {
  if (!input || typeof input !== 'object') return undefined
  const memory = input as Record<string, unknown>
  const today = normalizeWorkspaceRoute(memory.today)
  const trade = normalizeWorkspaceRoute(memory.trade)
  const caseRoute = normalizeWorkspaceRoute(memory.case)
  if (trade) {
    const params = new URLSearchParams(trade.search)
    if (params.get('liveStage') === 'all-history') {
      params.set('liveStage', 'all')
      trade.search = `?${params.toString()}`
    }
  }
  if (!today && !trade && !caseRoute) return undefined
  return {
    ...(today ? { today } : {}),
    ...(trade ? { trade } : {}),
    ...(caseRoute ? { case: caseRoute } : {}),
  }
}

/** 合并旧版/残缺 display，避免缺字段导致渲染崩溃 */
export function normalizeDisplay(input?: Partial<DisplayPrefs> | null): DisplayPrefs {
  const d = input ?? {}
  const sortBy = SORT_BY.includes(d.sortBy as (typeof SORT_BY)[number])
    ? (d.sortBy as DisplayPrefs['sortBy'])
    : DEFAULT_DISPLAY.sortBy
  const sortDirection = SORT_DIRECTIONS.includes(
    d.sortDirection as (typeof SORT_DIRECTIONS)[number],
  )
    ? (d.sortDirection as DisplayPrefs['sortDirection'])
    : DEFAULT_DISPLAY.sortDirection
  const requestedGroupByDate = typeof d.groupByDate === 'boolean'
    ? d.groupByDate
    : DEFAULT_DISPLAY.groupByDate
  const requestedGroupByStrategy = typeof d.groupByStrategy === 'boolean'
    ? d.groupByStrategy
    : DEFAULT_DISPLAY.groupByStrategy
  const groupByDate = sortBy === 'date' && requestedGroupByDate
  const groupByStrategy = sortBy === 'date' && !groupByDate && requestedGroupByStrategy
  const sidebarPins = Array.isArray(d.sidebarPins)
    ? normalizeSidebarPins(d.sidebarPins)
    : [...DEFAULT_DISPLAY.sidebarPins]
  const sidebarWorkspaceItems = Object.prototype.hasOwnProperty.call(d, 'sidebarWorkspaceItems')
    ? normalizeSidebarWorkspaceItems(d.sidebarWorkspaceItems)
    : migrateSidebarPins(sidebarPins)
  const workspaceMemory = normalizeWorkspaceMemory(d.workspaceMemory)
  return {
    hideClosed: typeof d.hideClosed === 'boolean' ? d.hideClosed : DEFAULT_DISPLAY.hideClosed,
    showEmptyGroups:
      typeof d.showEmptyGroups === 'boolean' ? d.showEmptyGroups : DEFAULT_DISPLAY.showEmptyGroups,
    groupByStrategy,
    groupByDate,
    sortBy,
    sortDirection,
    privacyMode:
      typeof d.privacyMode === 'boolean' ? d.privacyMode : DEFAULT_DISPLAY.privacyMode,
    showKeyboardFocusRings:
      typeof d.showKeyboardFocusRings === 'boolean'
        ? d.showKeyboardFocusRings
        : DEFAULT_DISPLAY.showKeyboardFocusRings,
    listRowDensity: LIST_ROW_DENSITIES.includes(d.listRowDensity as ListRowDensity)
      ? d.listRowDensity as ListRowDensity
      : DEFAULT_DISPLAY.listRowDensity,
    tradingDayStartHour: normalizeTradingDayStartHour(d.tradingDayStartHour),
    sidebarRiskScope: SIDEBAR_RISK_SCOPES.includes(d.sidebarRiskScope as SidebarRiskScope)
      ? d.sidebarRiskScope
      : DEFAULT_DISPLAY.sidebarRiskScope,
    reviewContextPinned:
      typeof d.reviewContextPinned === 'boolean'
        ? d.reviewContextPinned
        : DEFAULT_DISPLAY.reviewContextPinned,
    sidebarPrimaryOrder: normalizePrimarySidebarOrder(d.sidebarPrimaryOrder),
    sidebarPins,
    sidebarWorkspaceItems,
    ...(workspaceMemory ? { workspaceMemory } : {}),
  }
}

/** 命令面板 / 搜索：查询词按空格分词，每词须在字段中命中 */
export function matchesSearchQuery(query: string, ...fields: (string | undefined)[]): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = fields.filter(Boolean).join(' ').toLowerCase()
  return tokens.every((t) => haystack.includes(t))
}
