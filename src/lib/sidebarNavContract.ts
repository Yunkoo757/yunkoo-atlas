export type PrimarySidebarNavId = 'today' | 'quickNotes' | 'trades' | 'reviewCases' | 'weeklyReview' | 'reviewSession' | 'dashboard'
export type SidebarNavId = 'active' | 'favorites' | 'missed' | 'paper'

export const PRIMARY_NAV_ITEMS = [
  { id: 'trades', to: '/list', label: '交易日志' },
  { id: 'dashboard', to: '/dashboard', label: '统计分析' },
  { id: 'weeklyReview', to: '/weekly-review', label: '周期复盘' },
  { id: 'reviewCases', to: '/review-cases', label: '案例库' },
  { id: 'reviewSession', to: '/review-session', label: '随机复盘' },
] as const satisfies readonly { id: PrimarySidebarNavId; to: string; label: string }[]

export const SECONDARY_NAV_ITEMS = [
  { id: 'active', to: '/active', label: '进行中' },
  { id: 'favorites', to: '/favorites', label: '星标交易' },
  { id: 'missed', to: '/missed', label: '错过的机会' },
  { id: 'paper', to: '/sim', label: '模拟盘' },
] as const satisfies readonly { id: SidebarNavId; to: string; label: string }[]

export const DEFAULT_PRIMARY_SIDEBAR_ORDER: PrimarySidebarNavId[] = PRIMARY_NAV_ITEMS.map(
  (item) => item.id,
)

export const DEFAULT_SIDEBAR_PINS: SidebarNavId[] = SECONDARY_NAV_ITEMS.map((item) => item.id)

export function normalizePrimarySidebarOrder(input: unknown): PrimarySidebarNavId[] {
  const valid = new Set<PrimarySidebarNavId>(DEFAULT_PRIMARY_SIDEBAR_ORDER)
  const ordered = Array.isArray(input)
    ? input.filter((id): id is PrimarySidebarNavId => typeof id === 'string' && valid.has(id as PrimarySidebarNavId))
    : []
  return [...new Set(ordered), ...DEFAULT_PRIMARY_SIDEBAR_ORDER.filter((id) => !ordered.includes(id))]
}

export function reorderPrimarySidebarItem(
  input: unknown,
  sourceId: PrimarySidebarNavId,
  targetId: PrimarySidebarNavId,
): PrimarySidebarNavId[] {
  const order = normalizePrimarySidebarOrder(input)
  if (sourceId === targetId || !order.includes(sourceId) || !order.includes(targetId)) return order
  const fromIndex = order.indexOf(sourceId)
  const toIndex = order.indexOf(targetId)
  const next = [...order]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}
