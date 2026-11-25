import { useMemo, useState } from 'react'
import { StrategyIcon } from '@/components/StrategyIcon'
import type { Strategy } from '@/data/strategies'
import {
  MAX_PINNED_SIDEBAR_ITEMS,
  SIDEBAR_CAPABILITY_LABELS,
  SIDEBAR_CAPABILITY_WORKSPACES,
  SIDEBAR_QUICK_WORKSPACE_LABELS,
  resolveCapabilityRoute,
  setCapabilityWorkspaceEnabled,
  sidebarTargetKey,
  systemCapabilityWorkspaces,
  type SidebarCapabilityId,
  type SidebarQuickWorkspace,
  type SidebarTarget,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import { isSavedViewInWorkspace } from '@/lib/workspaceViews'
import { REVIEW_CASE_SCOPE_LABELS } from '@/lib/reviewCaseScope'
import type { SidebarTargetSources } from '@/components/sidebar/SidebarWorkspaceEditor'

type CatalogItem = {
  label: string
  domain: string
  detail?: string
  target: SidebarTarget
  strategy?: Strategy
}

type CapabilityItem = {
  id: SidebarCapabilityId
  label: string
  workspaces: readonly SidebarQuickWorkspace[]
}

type CatalogGroup =
  | { kind: 'capability'; label: string; items: CapabilityItem[] }
  | { kind: 'simple'; label: string; items: CatalogItem[] }

const CASE_VIEWS: CatalogItem[] = [
  { label: REVIEW_CASE_SCOPE_LABELS.exemplar, domain: '案例库', target: { kind: 'case-view', scope: 'exemplar' } },
  { label: REVIEW_CASE_SCOPE_LABELS.focus, domain: '案例库', target: { kind: 'case-view', scope: 'focus' } },
  { label: REVIEW_CASE_SCOPE_LABELS.mistakes, domain: '案例库', target: { kind: 'case-view', scope: 'mistakes' } },
  { label: REVIEW_CASE_SCOPE_LABELS.missed, domain: '案例库', target: { kind: 'case-view', scope: 'missed' } },
  { label: REVIEW_CASE_SCOPE_LABELS.unreviewed, domain: '案例库', target: { kind: 'case-view', scope: 'unreviewed' } },
  { label: REVIEW_CASE_SCOPE_LABELS.reviewed, domain: '案例库', target: { kind: 'case-view', scope: 'reviewed' } },
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

  const groups = useMemo<CatalogGroup[]>(() => {
    const tradeViews = sources.savedViews
      .filter((view) => isSavedViewInWorkspace(view, 'trade'))
      .map((view) => ({
        label: view.name,
        domain: '交易日志',
        target: { kind: 'saved-view' as const, viewId: view.id },
      }))
    const paperViews = sources.savedViews
      .filter((view) => isSavedViewInWorkspace(view, 'paper'))
      .map((view) => ({
        label: view.name,
        domain: '交易日志 · 模拟',
        detail: '模拟',
        target: { kind: 'saved-view' as const, viewId: view.id },
      }))
    const caseSavedViews = sources.savedViews
      .filter((view) => isSavedViewInWorkspace(view, 'case'))
      .map((view) => ({
        label: view.name,
        domain: '案例库',
        target: { kind: 'saved-view' as const, viewId: view.id },
      }))

    return [
      {
        kind: 'capability',
        label: '工作区能力',
        items: [
          {
            id: 'active',
            label: SIDEBAR_CAPABILITY_LABELS.active,
            workspaces: SIDEBAR_CAPABILITY_WORKSPACES.active,
          },
        ],
      },
      {
        kind: 'simple',
        label: '交易日志',
        items: [...tradeViews, ...paperViews],
      },
      {
        kind: 'simple',
        label: '案例库',
        items: [...CASE_VIEWS, ...caseSavedViews],
      },
      {
        kind: 'simple',
        label: '策略',
        items: sources.strategies.map((strategy) => ({
          label: strategy.name,
          strategy,
          domain: '交易日志 · 策略',
          target: { kind: 'strategy' as const, strategyId: strategy.id },
        })),
      },
    ]
  }, [sources.savedViews, sources.strategies])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchesQuery = (...parts: string[]) => {
    if (!normalizedQuery) return true
    return parts.some((part) => part.toLocaleLowerCase().includes(normalizedQuery))
  }
  const visibleGroups = normalizedQuery ? groups.map<CatalogGroup>((group) => {
    if (group.kind === 'capability') return {
      ...group,
      items: group.items.filter(item => matchesQuery(
        item.label, group.label, ...item.workspaces.map(workspace => SIDEBAR_QUICK_WORKSPACE_LABELS[workspace]),
      )),
    }
    return { ...group, items: group.items.filter(item => matchesQuery(item.label, item.domain, group.label)) }
  }).filter(group => group.items.length > 0) : groups

  const setItems = (next: SidebarWorkspaceItem[]) => {
    onChange(reindex(next))
  }

  const toggleSimpleTarget = (catalogItem: CatalogItem) => {
    const key = sidebarTargetKey(catalogItem.target)
    const existing = byTarget.get(key)
    setCapacityMessage('')
    if (!existing) {
      const placement = pinnedCount >= MAX_PINNED_SIDEBAR_ITEMS ? 'overflow' : 'pinned'
      if (placement === 'overflow') {
        setCapacityMessage('常驻已满，已放入「更多」。可返回上一层改回常驻或删除。')
      }
      setItems([
        ...items,
        { id: key, target: { ...catalogItem.target }, placement, order: items.length },
      ])
      return
    }
    if (existing.placement === 'pinned') {
      setItems(items.map((item) => (
        item.id === existing.id ? { ...item, placement: 'overflow' } : item
      )))
      return
    }
    setItems(items.filter((item) => item.id !== existing.id))
  }

  const toggleCapabilityWorkspace = (
    capabilityId: SidebarCapabilityId,
    workspace: SidebarQuickWorkspace,
    enabled: boolean,
  ) => {
    setCapacityMessage('')
    const next = setCapabilityWorkspaceEnabled(items, capabilityId, workspace, enabled)
    if (capabilityId === 'missed' && !enabled && next === items) {
      setCapacityMessage('至少保留一个包含来源')
      return
    }
    const key = `system:${capabilityId}`
    if (!byTarget.has(key) && next.some((item) => item.id === key && item.placement === 'overflow')) {
      setCapacityMessage('常驻已满，已放入「更多」。可返回上一层改回常驻或删除。')
    }
    setItems(next)
  }

  const stateOf = (existing: SidebarWorkspaceItem | undefined) => {
    if (existing?.placement === 'pinned') return '常驻'
    if (existing?.placement === 'overflow') return '更多'
    return '未添加'
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
      {visibleGroups.length === 0 && <p className="sb-editor-empty" role="status">没有匹配的项目</p>}
      <div className="sb-target-groups">
        {visibleGroups.map((group) => {
          if (group.kind === 'capability') {
            return (
              <section key={group.label} className="sb-target-group" aria-label={group.label}>
                <h4>{group.label}</h4>
                {group.items.map((capability) => {
                    const scopeLabel = capability.id === 'missed' ? '包含范围' : '可见工作区'
                    const existing = byTarget.get(`system:${capability.id}`)
                    const enabled = existing && existing.target.kind === 'system'
                      ? new Set(systemCapabilityWorkspaces(existing.target))
                      : new Set<SidebarQuickWorkspace>()
                    const state = stateOf(existing)
                    const stateClass =
                      state === '常驻' ? 'is-pinned' : state === '更多' ? 'is-overflow' : 'is-idle'
                    return (
                      <div key={capability.id} className="sb-capability-block">
                        <div className="sb-capability-heading">
                          <span className="sb-capability-title">{capability.label}</span>
                          <span className={`sb-target-row-state ${stateClass}`}>{state}</span>
                        </div>
                        <p className="sb-capability-hint">
                          {scopeLabel}
                        </p>
                        <div
                          className="sb-capability-options"
                          role="group"
                          aria-label={`${capability.label}${scopeLabel}`}
                        >
                          {capability.workspaces.map((workspace) => {
                            if (!resolveCapabilityRoute(capability.id, workspace)) return null
                            const checked = enabled.has(workspace)
                            return (
                              <label
                                key={`${capability.id}:${workspace}`}
                                className={`sb-capability-option${checked ? ' is-checked' : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) => toggleCapabilityWorkspace(
                                    capability.id,
                                    workspace,
                                    event.target.checked,
                                  )}
                                />
                                <span className="sb-capability-option-label">
                                  {SIDEBAR_QUICK_WORKSPACE_LABELS[workspace]}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
              </section>
            )
          }

          return (
            <section key={group.label} className="sb-target-group" aria-label={group.label}>
              <h4>{group.label}</h4>
              {group.items.length === 0 ? (
                <p className="sb-editor-empty">暂无可添加项</p>
              ) : (
                group.items.map((catalogItem) => {
                  const current = byTarget.get(sidebarTargetKey(catalogItem.target))
                  const state = stateOf(current)
                  const stateClass =
                    state === '常驻' ? 'is-pinned' : state === '更多' ? 'is-overflow' : 'is-idle'
                  const actionHint =
                    state === '未添加' ? '点击添加' : state === '常驻' ? '点击改到更多' : '点击移除'
                  return (
                    <button
                      type="button"
                      key={sidebarTargetKey(catalogItem.target)}
                      className={`sb-target-row ${stateClass}`}
                      aria-label={`${catalogItem.label}（${catalogItem.domain}）：${state}，${actionHint}`}
                      onClick={() => toggleSimpleTarget(catalogItem)}
                    >
                      {catalogItem.strategy && (
                        <StrategyIcon icon={catalogItem.strategy.icon} color={catalogItem.strategy.color} variant="nav" />
                      )}
                      <span className="sb-target-row-text">
                        <span className="sb-target-row-label">{catalogItem.label}</span>
                        {catalogItem.detail && <span className="sb-target-row-domain">{catalogItem.detail}</span>}
                      </span>
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
