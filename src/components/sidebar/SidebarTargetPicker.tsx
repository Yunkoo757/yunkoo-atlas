import { useMemo, useState } from 'react'
import { SECONDARY_NAV } from '@/lib/sidebarNav'
import {
  MAX_PINNED_SIDEBAR_ITEMS,
  sidebarTargetKey,
  type SidebarTarget,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import type { SidebarTargetSources } from '@/components/sidebar/SidebarWorkspaceEditor'

type CatalogItem = {
  label: string
  target: SidebarTarget
}

type CatalogGroup = {
  label: string
  items: CatalogItem[]
}

const CASE_VIEWS: CatalogItem[] = [
  { label: '重点', target: { kind: 'case-view', scope: 'focus' } },
  { label: '错题', target: { kind: 'case-view', scope: 'mistakes' } },
  { label: '待复看', target: { kind: 'case-view', scope: 'unreviewed' } },
  { label: '已掌握', target: { kind: 'case-view', scope: 'reviewed' } },
]

function reindex(items: SidebarWorkspaceItem[]): SidebarWorkspaceItem[] {
  return items.map((item, order) => ({ ...item, order }))
}

export type SidebarTargetPickerProps = {
  items: SidebarWorkspaceItem[]
  sources: SidebarTargetSources
  onChange: (items: SidebarWorkspaceItem[]) => void
}

export function SidebarTargetPicker({ items, sources, onChange }: SidebarTargetPickerProps) {
  const [query, setQuery] = useState('')
  const [capacityMessage, setCapacityMessage] = useState('')
  const pinnedCount = items.filter((item) => item.placement === 'pinned').length
  const byTarget = new Map(items.map((item) => [sidebarTargetKey(item.target), item]))
  const groups = useMemo<CatalogGroup[]>(() => [
    {
      label: '系统快捷',
      items: SECONDARY_NAV.map((item) => ({
        label: item.label,
        target: { kind: 'system', id: item.id },
      })),
    },
    {
      label: '我的视图',
      items: sources.savedViews.map((view) => ({
        label: view.name,
        target: { kind: 'saved-view', viewId: view.id },
      })),
    },
    {
      label: '策略',
      items: sources.strategies.map((strategy) => ({
        label: strategy.name,
        target: { kind: 'strategy', strategyId: strategy.id },
      })),
    },
    { label: '案例视图', items: CASE_VIEWS },
  ], [sources.savedViews, sources.strategies])
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const toggleTarget = (catalogItem: CatalogItem) => {
    const key = sidebarTargetKey(catalogItem.target)
    const existing = byTarget.get(key)
    setCapacityMessage('')
    if (!existing) {
      const placement = pinnedCount >= MAX_PINNED_SIDEBAR_ITEMS ? 'overflow' : 'pinned'
      if (placement === 'overflow') {
        setCapacityMessage('常驻已满，已放入「更多」。可返回上一层改回常驻或删除。')
      }
      onChange(reindex([
        ...items,
        { id: key, target: { ...catalogItem.target }, placement, order: items.length },
      ]))
      return
    }
    if (existing.placement === 'pinned') {
      onChange(reindex(items.map((item) => item.id === existing.id ? { ...item, placement: 'overflow' } : item)))
      return
    }
    onChange(reindex(items.filter((item) => item.id !== existing.id)))
  }

  return (
    <div className="sb-target-picker">
      <label className="sb-target-picker-search">
        <span className="sb-screen-reader">搜索可添加项目</span>
        <input
          type="search"
          placeholder="搜索项目…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {capacityMessage ? <p className="sb-editor-message" role="status">{capacityMessage}</p> : null}
      <div className="sb-target-groups">
        {groups.map((group) => {
          const visibleItems = group.items.filter((item) =>
            !normalizedQuery || item.label.toLocaleLowerCase().includes(normalizedQuery),
          )
          if (visibleItems.length === 0 && normalizedQuery) return null
          return (
            <section key={group.label} className="sb-target-group" aria-label={group.label}>
              <h4>{group.label}</h4>
              {visibleItems.length === 0 ? (
                <p className="sb-editor-empty">暂无可添加项</p>
              ) : (
                visibleItems.map((catalogItem) => {
                  const current = byTarget.get(sidebarTargetKey(catalogItem.target))
                  const state = current?.placement === 'pinned'
                    ? '常驻'
                    : current?.placement === 'overflow'
                      ? '更多'
                      : '未添加'
                  const stateClass =
                    state === '常驻' ? 'is-pinned' : state === '更多' ? 'is-overflow' : 'is-idle'
                  const actionHint =
                    state === '未添加' ? '点击添加' : state === '常驻' ? '点击改到更多' : '点击移除'
                  return (
                    <button
                      type="button"
                      key={sidebarTargetKey(catalogItem.target)}
                      className={`sb-target-row ${stateClass}`}
                      aria-label={`${catalogItem.label}：${state}，${actionHint}`}
                      onClick={() => toggleTarget(catalogItem)}
                    >
                      <span className="sb-target-row-label">{catalogItem.label}</span>
                      <span className={`sb-target-row-state ${stateClass}`}>{state}</span>
                    </button>
                  )
                })
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
