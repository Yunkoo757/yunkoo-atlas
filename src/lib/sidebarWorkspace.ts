import type { SidebarNavId } from '@/lib/sidebarNav'
import type { ReviewCaseScope } from '@/lib/tradeFilters'

export type SidebarTarget =
  | { kind: 'system'; id: SidebarNavId }
  | { kind: 'saved-view'; viewId: string }
  | { kind: 'strategy'; strategyId: string }
  | { kind: 'case-view'; scope: Exclude<ReviewCaseScope, 'all'> }

export type SidebarWorkspaceItem = {
  id: string
  target: SidebarTarget
  placement: 'pinned' | 'overflow'
  order: number
}

export const MAX_PINNED_SIDEBAR_ITEMS = 8

const SYSTEM_IDS: readonly SidebarNavId[] = ['active', 'favorites', 'missed', 'paper']
const CASE_SCOPES: readonly Exclude<ReviewCaseScope, 'all'>[] = [
  'focus',
  'mistakes',
  'unreviewed',
  'reviewed',
]

export function sidebarTargetKey(target: SidebarTarget): string {
  switch (target.kind) {
    case 'system':
      return `system:${target.id}`
    case 'saved-view':
      return `saved-view:${target.viewId}`
    case 'strategy':
      return `strategy:${target.strategyId}`
    case 'case-view':
      return `case-view:${target.scope}`
  }
}

function normalizeTarget(value: unknown): SidebarTarget | null {
  if (!value || typeof value !== 'object') return null
  const target = value as Record<string, unknown>

  if (target.kind === 'system' && SYSTEM_IDS.includes(target.id as SidebarNavId)) {
    return { kind: 'system', id: target.id as SidebarNavId }
  }
  if (target.kind === 'saved-view' && typeof target.viewId === 'string' && target.viewId.trim()) {
    return { kind: 'saved-view', viewId: target.viewId }
  }
  if (target.kind === 'strategy' && typeof target.strategyId === 'string' && target.strategyId.trim()) {
    return { kind: 'strategy', strategyId: target.strategyId }
  }
  if (
    target.kind === 'case-view' &&
    CASE_SCOPES.includes(target.scope as Exclude<ReviewCaseScope, 'all'>)
  ) {
    return { kind: 'case-view', scope: target.scope as Exclude<ReviewCaseScope, 'all'> }
  }
  return null
}

export function normalizeSidebarWorkspaceItems(value: unknown): SidebarWorkspaceItem[] {
  if (!Array.isArray(value)) return []

  const normalized = value.flatMap((candidate, inputIndex) => {
    if (!candidate || typeof candidate !== 'object') return []
    const item = candidate as Record<string, unknown>
    const target = normalizeTarget(item.target)
    if (
      !target ||
      typeof item.id !== 'string' ||
      !item.id.trim() ||
      (item.placement !== 'pinned' && item.placement !== 'overflow') ||
      typeof item.order !== 'number' ||
      !Number.isFinite(item.order)
    ) {
      return []
    }
    return [
      {
        item: {
          id: item.id,
          target,
          placement: item.placement,
          order: item.order,
        } satisfies SidebarWorkspaceItem,
        inputIndex,
      },
    ]
  })

  normalized.sort((a, b) => a.item.order - b.item.order || a.inputIndex - b.inputIndex)

  const seen = new Set<string>()
  let pinnedCount = 0
  return normalized.flatMap(({ item }) => {
    const key = sidebarTargetKey(item.target)
    if (seen.has(key)) return []
    seen.add(key)
    let placement = item.placement
    if (placement === 'pinned') {
      if (pinnedCount >= MAX_PINNED_SIDEBAR_ITEMS) placement = 'overflow'
      pinnedCount += 1
    }
    return [{ ...item, placement, order: seen.size - 1 }]
  })
}

export function migrateSidebarPins(pins: readonly SidebarNavId[]): SidebarWorkspaceItem[] {
  return normalizeSidebarWorkspaceItems(
    pins.map((id, order) => ({
      id: `system:${id}`,
      target: { kind: 'system' as const, id },
      placement: 'pinned' as const,
      order,
    })),
  )
}
