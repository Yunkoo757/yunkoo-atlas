import { normalizeSavedViewPath, savedViewSearch, searchParamsToRecord, type SavedTradeView } from '@/lib/savedTradeViews'
import type { SidebarWorkspaceItem } from '@/lib/sidebarWorkspace'
import {
  filterViewsBySidebarCapabilities,
  getWorkspacePrimaryViews,
  isSavedViewInWorkspace,
  type WorkspaceKind,
  type WorkspaceViewTarget,
} from '@/lib/workspaceViews'

type ViewGroup = {
  label: string
  items: WorkspaceViewTarget[]
}

const TRADE_MORE_GROUPS: ViewGroup[] = [
  {
    label: '时间',
    items: [
      { id: 'today', label: '今日', pathname: '/today-record' },
      { id: 'last-week', label: '上周', pathname: '/period/last-week' },
      { id: 'last-month', label: '上月', pathname: '/period/last-month' },
    ],
  },
  {
    label: '结果',
    items: [
      { id: 'win', label: '盈利', pathname: '/list', search: '?status=win' },
      { id: 'breakeven', label: '保本', pathname: '/list', search: '?status=breakeven' },
    ],
  },
  {
    label: '状态',
    items: [
      { id: 'active', label: '进行中', pathname: '/active' },
    ],
  },
  {
    label: '交易时段',
    items: [
      { id: 'london', label: '伦敦盘', pathname: '/list', search: '?session=london' },
      { id: 'new-york', label: '纽约盘', pathname: '/list', search: '?session=new-york' },
      { id: 'asia', label: '亚盘', pathname: '/list', search: '?session=asia' },
      { id: 'outside', label: '盘外时段', pathname: '/list', search: '?session=outside' },
      { id: 'other', label: '其他时段', pathname: '/list', search: '?session=other' },
    ],
  },
]

const PAPER_MORE_GROUPS: ViewGroup[] = [
  {
    label: '时间',
    items: [
      { id: 'paper-week', label: '本周', pathname: '/sim', search: '?period=this-week' },
      { id: 'paper-month', label: '本月', pathname: '/sim', search: '?period=this-month' },
    ],
  },
  {
    label: '结果',
    items: [
      { id: 'paper-win', label: '盈利', pathname: '/sim', search: '?status=win' },
      { id: 'paper-breakeven', label: '保本', pathname: '/sim', search: '?status=breakeven' },
      { id: 'paper-missed', label: '错过机会', pathname: '/sim', search: '?status=missed' },
    ],
  },
  {
    label: '交易时段',
    items: [
      { id: 'paper-london', label: '伦敦盘', pathname: '/sim', search: '?session=london' },
      { id: 'paper-new-york', label: '纽约盘', pathname: '/sim', search: '?session=new-york' },
      { id: 'paper-asia', label: '亚盘', pathname: '/sim', search: '?session=asia' },
      { id: 'paper-outside', label: '盘外时段', pathname: '/sim', search: '?session=outside' },
      { id: 'paper-other', label: '其他时段', pathname: '/sim', search: '?session=other' },
    ],
  },
]

const HISTORICAL_TRADE_MORE_GROUPS: ViewGroup[] = [
  {
    label: '结果',
    items: [
      { id: 'win', label: '盈利', pathname: '/live-history', search: '?status=win' },
      { id: 'breakeven', label: '保本', pathname: '/live-history', search: '?status=breakeven' },
      { id: 'missed', label: '错过机会', pathname: '/live-history', search: '?status=missed' },
    ],
  },
  {
    label: '交易时段',
    items: [
      { id: 'london', label: '伦敦盘', pathname: '/live-history', search: '?session=london' },
      { id: 'new-york', label: '纽约盘', pathname: '/live-history', search: '?session=new-york' },
      { id: 'asia', label: '亚盘', pathname: '/live-history', search: '?session=asia' },
      { id: 'outside', label: '盘外时段', pathname: '/live-history', search: '?session=outside' },
      { id: 'other', label: '其他时段', pathname: '/live-history', search: '?session=other' },
    ],
  },
]

export function getMoreViewGroups(kind: WorkspaceKind, sidebarWorkspaceItems?: readonly SidebarWorkspaceItem[]): ViewGroup[] {
  return (kind === 'trade'
    ? TRADE_MORE_GROUPS
    : kind === 'historical-trade'
      ? HISTORICAL_TRADE_MORE_GROUPS
      : kind === 'paper'
        ? PAPER_MORE_GROUPS
        : []
  )
    .map((group) => ({
      ...group,
      items: filterViewsBySidebarCapabilities(kind, group.items, sidebarWorkspaceItems),
    }))
    .filter((group) => group.items.length > 0)
}

export type JournalViewState = {
  journalView: { type: 'builtin' | 'saved'; id: string }
}

type JournalView = WorkspaceViewTarget & { saved?: SavedTradeView }

export const JOURNAL_ROUTE_VIEW_LABELS: Readonly<Record<string, string>> = {
  active: '进行中', starred: '星标交易', missed: '错过机会', incomplete: '待补全',
}

export function getJournalViewState(state: unknown): JournalViewState | undefined {
  if (!state || typeof state !== 'object' || !('journalView' in state)) return
  const value = state.journalView
  if (!value || typeof value !== 'object' || !('id' in value) || !('type' in value)) return
  if (typeof value.id === 'string' && (value.type === 'builtin' || value.type === 'saved')) {
    return { journalView: { type: value.type, id: value.id } }
  }
}

/** 统一日志的快捷视图留在当前列表或看板，旧页面入口仍使用原版目标。 */
export function journalBuiltinTarget(target: WorkspaceViewTarget): WorkspaceViewTarget {
  if (target.pathname === '/list') return target
  const params = new URLSearchParams(target.search)
  if (target.pathname.startsWith('/period/')) params.set('period', target.pathname.slice('/period/'.length))
  else if (target.pathname === '/today-record') params.set('period', 'today')
  else if (target.pathname === '/active') params.set('view', 'active')
  else if (target.pathname !== '/sim') return target
  return { ...target, pathname: '/list', search: params.toString() }
}

function journalSavedTarget(saved: SavedTradeView): JournalView {
  const pathname = normalizeSavedViewPath(saved.pathname)
  const params = new URLSearchParams(savedViewSearch(saved))
  if (pathname === '/sim') params.set('kind', 'paper')
  return { id: saved.id, label: saved.name, pathname: pathname === '/sim' ? '/list' : pathname, search: params.toString(), saved }
}

function comparableJournalQuery(search: string | undefined): URLSearchParams {
  const params = new URLSearchParams(search)
  if (!params.has('kind')) params.set('kind', 'live')
  if (!params.has('liveStage')) params.set('liveStage', 'current')
  return params
}

export function resolveJournalView(
  kind: WorkspaceKind,
  pathname: string,
  search: string,
  sidebarItems: readonly SidebarWorkspaceItem[] | undefined,
  savedViews: readonly SavedTradeView[],
  state?: unknown,
): JournalView | undefined {
  const path = normalizeSavedViewPath(pathname)
  const params = comparableJournalQuery(search)
  const named = [...getWorkspacePrimaryViews(kind, sidebarItems), ...getMoreViewGroups(kind, sidebarItems).flatMap(group => group.items)]
    .map(journalBuiltinTarget)
  const currentView = params.get('view')
  if (currentView && JOURNAL_ROUTE_VIEW_LABELS[currentView] && !named.some(item => new URLSearchParams(item.search).get('view') === currentView)) {
    named.push({ id: `view-${currentView}`, label: JOURNAL_ROUTE_VIEW_LABELS[currentView], pathname: '/list', search: `view=${currentView}` })
  }
  const saved = savedViews.filter(view => isSavedViewInWorkspace(view, kind)).map(journalSavedTarget)
  const requested = getJournalViewState(state)?.journalView
  const selected = requested?.type === 'saved'
    ? saved.find(view => view.id === requested.id)
    : named.find(view => view.id === requested?.id)
  const fits = (view: JournalView) => {
    const baseline = view.saved ? comparableJournalQuery(view.search) : new URLSearchParams(view.search)
    return view.pathname === path && [...baseline].every(([key, value]) => params.get(key) === value)
  }
  // 只有点选过的视图才能按其基线匹配附加条件，旧链接必须完全匹配才认作保存视图。
  if (selected && fits(selected)) return selected
  const exactQuery = JSON.stringify(searchParamsToRecord(params))
  const savedMatch = saved.find(view => view.pathname === path
    && JSON.stringify(searchParamsToRecord(comparableJournalQuery(view.search))) === exactQuery)
  if (savedMatch) return savedMatch
  const matches = named.filter(view => view.id !== 'all' && fits(view))
  return matches.find(view => currentView && new URLSearchParams(view.search).get('view') === currentView)
    ?? matches[0]
    ?? named.find(view => view.id === 'all' && view.pathname === path)
}
