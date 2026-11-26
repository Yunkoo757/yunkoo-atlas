import { hideNativeDragPreview } from '@/lib/dragPreview'
import { isComposingKey } from '@/lib/keyboardComposition'
import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { ChevronLeft, GripVertical, Plus, Trash2 } from '@/icons/appIcons'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { OverflowTooltip } from '@/components/ui/Tooltip'
import { useModalShortcutScope } from '@/components/ui/ModalShell'
import { StrategyIcon } from '@/components/StrategyIcon'
import type { Strategy } from '@/data/strategies'
import type { SavedTradeView } from '@/lib/savedTradeViews'
import {
  MAX_PINNED_SIDEBAR_ITEMS,
  isSidebarNavigationTarget,
  migrateSidebarPins,
  normalizeSidebarWorkspaceItems,
  reorderSidebarWorkspaceItem,
  resolveSidebarWorkspaceItem,
  sanitizeSidebarWorkspaceItems,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import { SidebarTargetPicker } from '@/components/sidebar/SidebarTargetPicker'
import {
  DEFAULT_PRIMARY_SIDEBAR_ORDER,
  DEFAULT_SIDEBAR_PINS,
  WORKSPACE_ICONS,
  normalizePrimarySidebarOrder,
  reorderPrimarySidebarItem,
  resolvePrimarySidebarNav,
  type PrimarySidebarNavId,
} from '@/lib/sidebarNav'

export type SidebarTargetSources = {
  savedViews: SavedTradeView[]
  strategies: Strategy[]
}

export type SidebarWorkspaceEditorProps = {
  items: SidebarWorkspaceItem[]
  primaryOrder: PrimarySidebarNavId[]
  sources: SidebarTargetSources
  onCommit: (items: SidebarWorkspaceItem[], primaryOrder: PrimarySidebarNavId[]) => void
  onCancel: () => void
  variant?: 'popover' | 'mobile-fullscreen'
  /** 打开时滚到对应分组，便于从侧栏「更多 · 管理」直达 */
  initialSection?: 'pinned' | 'overflow'
}

export const SIDEBAR_WORKSPACE_EDITOR_ID = 'sidebar-workspace-editor'
const SIDEBAR_WORKSPACE_EDITOR_TITLE_ID = 'sidebar-workspace-editor-title'

type Removal = {
  item: SidebarWorkspaceItem
  index: number
  label: string
}

function reindex(items: SidebarWorkspaceItem[]): SidebarWorkspaceItem[] {
  return items.map((item, order) => ({ ...item, order }))
}

export function SidebarWorkspaceEditor({
  items,
  primaryOrder,
  sources,
  onCommit,
  onCancel,
  variant = 'popover',
  initialSection = 'pinned',
}: SidebarWorkspaceEditorProps) {
  const [draft, setDraft] = useState<SidebarWorkspaceItem[]>(() =>
    sanitizeSidebarWorkspaceItems(items, sources)
      .map((item) => ({ ...item, target: { ...item.target } })),
  )
  const [primaryDraft, setPrimaryDraft] = useState<PrimarySidebarNavId[]>(() =>
    normalizePrimarySidebarOrder(primaryOrder),
  )
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [draggedPrimaryId, setDraggedPrimaryId] = useState<PrimarySidebarNavId | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [removal, setRemoval] = useState<Removal | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmDefaults, setConfirmDefaults] = useState(false)
  const [capacityMessage, setCapacityMessage] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const wasPicking = useRef(false)
  const restoreActionRef = useRef<HTMLButtonElement>(null)
  const wasConfirming = useRef(false)
  const overflowSectionRef = useRef<HTMLElement>(null)
  const navigationDraft = draft.filter((item) => isSidebarNavigationTarget(item.target))
  const pinnedItems = navigationDraft.filter((item) => item.placement === 'pinned')
  const overflowItems = navigationDraft.filter((item) => item.placement === 'overflow')
  const pinnedCount = pinnedItems.length
  const primaryItems = resolvePrimarySidebarNav(primaryDraft)
  useModalShortcutScope()

  useLayoutEffect(() => {
    if (!pickerOpen && wasPicking.current) {
      addButtonRef.current?.focus()
    } else {
      titleRef.current?.focus()
      if (!pickerOpen && initialSection === 'overflow') {
        overflowSectionRef.current?.scrollIntoView({ block: 'nearest' })
      }
    }
    wasPicking.current = pickerOpen
  }, [initialSection, pickerOpen])

  useLayoutEffect(() => {
    if (wasConfirming.current !== confirmDefaults) restoreActionRef.current?.focus()
    wasConfirming.current = confirmDefaults
  }, [confirmDefaults])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isComposingKey(event)) return
      event.preventDefault()
      if (pickerOpen) {
        setPickerOpen(false)
        return
      }
      if (confirmDefaults) {
        setConfirmDefaults(false)
        return
      }
      onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [confirmDefaults, onCancel, pickerOpen])

  const removeItem = (item: SidebarWorkspaceItem, label: string) => {
    const index = draft.findIndex((candidate) => candidate.id === item.id)
    setRemoval({ item: { ...item, target: { ...item.target } }, index, label })
    setDraft(reindex(draft.filter((candidate) => candidate.id !== item.id)))
  }

  const undoRemoval = () => {
    if (!removal) return
    const next = [...draft]
    next.splice(Math.min(removal.index, next.length), 0, removal.item)
    setDraft(reindex(next))
    setRemoval(null)
  }

  const togglePlacement = (item: SidebarWorkspaceItem) => {
    setCapacityMessage('')
    if (item.placement === 'pinned') {
      setDraft(
        draft.map((candidate) =>
          candidate.id === item.id ? { ...candidate, placement: 'overflow' } : candidate,
        ),
      )
      return
    }
    if (pinnedCount >= MAX_PINNED_SIDEBAR_ITEMS) {
      setCapacityMessage('常驻已满（8/8）。请先把某一项移至更多，再改回常驻。')
      return
    }
    setDraft(
      draft.map((candidate) =>
        candidate.id === item.id ? { ...candidate, placement: 'pinned' } : candidate,
      ),
    )
  }

  const moveByKeyboard = (itemId: string, direction: -1 | 1, placement: 'pinned' | 'overflow') => {
    const group = draft.filter((item) => item.placement === placement)
    const index = group.findIndex((item) => item.id === itemId)
    const target = group[index + direction]
    if (target) applyMove(itemId, target.id, placement)
  }

  const movePrimary = (itemId: PrimarySidebarNavId, targetId: PrimarySidebarNavId) => {
    if (itemId === targetId) return
    const next = reorderPrimarySidebarItem(primaryDraft, itemId, targetId)
    setPrimaryDraft(next)
    const moved = resolvePrimarySidebarNav(next).find((item) => item.id === itemId)
    if (!moved) return
    setAnnouncement(
      `${moved.label} 已移动到工作区第 ${next.indexOf(itemId) + 1} 项，共 ${next.length} 项`,
    )
  }

  const movePrimaryByKeyboard = (itemId: PrimarySidebarNavId, direction: -1 | 1) => {
    const index = primaryDraft.indexOf(itemId)
    const targetId = primaryDraft[index + direction]
    if (targetId) movePrimary(itemId, targetId)
  }

  const applyMove = (
    itemId: string,
    targetId: string,
    placement: 'pinned' | 'overflow',
  ) => {
    const source = draft.find((item) => item.id === itemId)
    const target = draft.find((item) => item.id === targetId)
    if (!source || !target || source.placement !== placement || target.placement !== placement) {
      return
    }
    const next = reorderSidebarWorkspaceItem(draft, itemId, targetId)
    if (next === draft) return
    setDraft(next)
    const moved = next.find((item) => item.id === itemId)
    if (!moved) return
    const label = resolveSidebarWorkspaceItem(moved, sources).label
    const group = next.filter((item) => item.placement === placement)
    setAnnouncement(
      `${label} 已移动到${placement === 'pinned' ? '常驻' : '更多'}第 ${group.indexOf(moved) + 1} 项，共 ${group.length} 项`,
    )
  }

  // The insertion edge mirrors the reorder functions, which insert at the target's index.
  const dropFeedback = (rowId: string, sourceIndex: number, rowIndex: number) => {
    const acceptsDrop = sourceIndex >= 0 && sourceIndex !== rowIndex
    return {
      'data-drag-source': sourceIndex === rowIndex || undefined,
      'data-drop-edge': acceptsDrop && dropTarget === rowId
        ? sourceIndex < rowIndex ? 'after' : 'before'
        : undefined,
      onDragOver(event: DragEvent<HTMLDivElement>) {
        if (!acceptsDrop) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDropTarget(rowId)
      },
      onDragLeave(event: DragEvent<HTMLDivElement>) {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        setDropTarget(current => current === rowId ? null : current)
      },
    }
  }

  const renderRow = (
    item: SidebarWorkspaceItem,
    indexInGroup: number,
    group: SidebarWorkspaceItem[],
    placement: 'pinned' | 'overflow',
  ) => {
    const resolved = resolveSidebarWorkspaceItem(item, sources)
    const Icon = WORKSPACE_ICONS[resolved.icon]
    const descriptionId = `sidebar-sort-description-${item.id.replace(/[^a-zA-Z0-9_-]+/g, '-')}`
    return (
      <div
        key={item.id}
        className="sb-editor-item"
        data-sidebar-item
        data-sidebar-placement={item.placement}
        {...dropFeedback(item.id, draggedId ? group.findIndex(row => row.id === draggedId) : -1, indexInGroup)}
        onDrop={(event) => {
          event.preventDefault()
          const sourceId = draggedId ?? event.dataTransfer.getData('text/plain')
          applyMove(sourceId, item.id, placement)
          setDraggedId(null)
          setDropTarget(null)
        }}
      >
        <button
          type="button"
          className="sb-editor-sort-handle"
          aria-label={`排序 ${resolved.label}`}
          aria-describedby={descriptionId}
          draggable={variant !== 'mobile-fullscreen'}
          onDragStart={(event) => {
            setDraggedId(item.id)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', item.id)
            hideNativeDragPreview(event.dataTransfer)
          }}
          onDragEnd={() => {
            setDraggedId(null)
            setDropTarget(null)
          }}
          onKeyDown={(event) => {
            if (event.altKey && event.key === 'ArrowUp') {
              event.preventDefault()
              moveByKeyboard(item.id, -1, placement)
            } else if (event.altKey && event.key === 'ArrowDown') {
              event.preventDefault()
              moveByKeyboard(item.id, 1, placement)
            } else if (event.key === 'Delete') {
              event.preventDefault()
              removeItem(item, resolved.label)
            }
          }}
        >
          <GripVertical size={ICON_SM} aria-hidden="true" />
        </button>
        <span id={descriptionId} className="sb-screen-reader">
          {placement === 'pinned' ? '常驻' : '更多'}第 {indexInGroup + 1} 项，共 {group.length}{' '}
          项。使用 Alt + 上/下方向键排序
        </span>
        {resolved.strategy ? (
          <StrategyIcon icon={resolved.strategy.icon} color={resolved.strategy.color} size={ICON_MD} variant="nav" />
        ) : (
          <Icon size={ICON_MD} aria-hidden />
        )}
        <OverflowTooltip text={resolved.label}>
          <span className="sb-editor-item-label" data-sidebar-item-label>
            {resolved.label}
          </span>
        </OverflowTooltip>
        {resolved.invalid ? <span className="sb-editor-invalid">已失效</span> : null}
        <span className="sb-editor-mobile-moves">
          <button
            type="button"
            aria-label={`上移 ${resolved.label}`}
            disabled={indexInGroup === 0}
            onClick={() => moveByKeyboard(item.id, -1, placement)}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`下移 ${resolved.label}`}
            disabled={indexInGroup === group.length - 1}
            onClick={() => moveByKeyboard(item.id, 1, placement)}
          >
            ↓
          </button>
        </span>
        <div className="sb-editor-row-actions">
          <Button size="sm" onClick={() => togglePlacement(item)}>
            {item.placement === 'pinned' ? '移至更多' : '常驻侧栏'}
          </Button>
          <Button
            size="sm"
            className="sb-editor-remove"
            aria-label={`删除 ${resolved.label}`}
            onClick={() => removeItem(item, resolved.label)}
          >
            <Trash2 size={ICON_SM} aria-hidden />
          </Button>
        </div>
      </div>
    )
  }

  const renderPrimaryRow = (
    item: (typeof primaryItems)[number],
    index: number,
  ) => {
    const Icon = item.icon
    const descriptionId = `sidebar-primary-sort-description-${item.id}`
    return (
      <div
        key={item.id}
        className="sb-editor-item"
        data-sidebar-primary-item={item.id}
        {...dropFeedback(item.id, draggedPrimaryId ? primaryDraft.indexOf(draggedPrimaryId) : -1, index)}
        onDrop={(event) => {
          event.preventDefault()
          const sourceId = (draggedPrimaryId ?? event.dataTransfer.getData('text/plain')) as PrimarySidebarNavId
          if (primaryDraft.includes(sourceId)) movePrimary(sourceId, item.id)
          setDraggedPrimaryId(null)
          setDropTarget(null)
        }}
      >
        <button
          type="button"
          className="sb-editor-sort-handle"
          aria-label={`排序 ${item.label}`}
          aria-describedby={descriptionId}
          draggable={variant !== 'mobile-fullscreen'}
          onDragStart={(event) => {
            setDraggedPrimaryId(item.id)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', item.id)
            hideNativeDragPreview(event.dataTransfer)
          }}
          onDragEnd={() => {
            setDraggedPrimaryId(null)
            setDropTarget(null)
          }}
          onKeyDown={(event) => {
            if (event.altKey && event.key === 'ArrowUp') {
              event.preventDefault()
              movePrimaryByKeyboard(item.id, -1)
            } else if (event.altKey && event.key === 'ArrowDown') {
              event.preventDefault()
              movePrimaryByKeyboard(item.id, 1)
            }
          }}
        >
          <GripVertical size={ICON_SM} aria-hidden="true" />
        </button>
        <span id={descriptionId} className="sb-screen-reader">
          工作区第 {index + 1} 项，共 {primaryItems.length} 项。使用 Alt + 上/下方向键排序
        </span>
        <Icon size={ICON_MD} aria-hidden />
        <span className="sb-editor-item-label">{item.label}</span>
        <span className="sb-editor-mobile-moves">
          <button
            type="button"
            aria-label={`上移 ${item.label}`}
            disabled={index === 0}
            onClick={() => movePrimaryByKeyboard(item.id, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`下移 ${item.label}`}
            disabled={index === primaryItems.length - 1}
            onClick={() => movePrimaryByKeyboard(item.id, 1)}
          >
            ↓
          </button>
        </span>
      </div>
    )
  }

  return (
    <section
      id={SIDEBAR_WORKSPACE_EDITOR_ID}
      className={`ui-popover-surface ui-popover-modal sb-workspace-editor${variant === 'mobile-fullscreen' ? ' is-mobile-fullscreen' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={SIDEBAR_WORKSPACE_EDITOR_TITLE_ID}
      data-mobile-fullscreen={variant === 'mobile-fullscreen' ? 'true' : undefined}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled)',
          ),
        ).filter((element) => element.offsetParent !== null)
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!first || !last) return

        if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <header className="sb-workspace-editor-header">
        <div className="sb-workspace-editor-title-row">
          {pickerOpen && (
            <IconButton
              label="返回管理列表"
              tooltip="返回管理列表"
              onClick={() => setPickerOpen(false)}
            >
              <ChevronLeft size={ICON_MD} aria-hidden="true" />
            </IconButton>
          )}
          <h2 id={SIDEBAR_WORKSPACE_EDITOR_TITLE_ID} ref={titleRef} tabIndex={-1}>
            {pickerOpen ? '添加项目' : '管理我的空间'}
          </h2>
          {pickerOpen ? (
            <span data-sidebar-capacity>常驻 {pinnedCount} / {MAX_PINNED_SIDEBAR_ITEMS}</span>
          ) : (
            <Button size="sm" variant="bordered" ref={addButtonRef} onClick={() => {
              setConfirmDefaults(false)
              setPickerOpen(true)
            }}>
              <Plus size={ICON_SM} aria-hidden />添加项目
            </Button>
          )}
        </div>
      </header>
      <span className="sb-screen-reader" aria-live="polite">
        {announcement}
      </span>
      <div className="sb-workspace-editor-body">
      {pickerOpen ? (
        <SidebarTargetPicker
          items={draft}
          sources={sources}
          onChange={setDraft}
        />
      ) : (
        <>
          <div className="sb-editor-list">
            <section className="sb-editor-group" aria-label="工作区导航">
              <header className="sb-editor-group-header">
                <h3>工作区导航</h3>
              </header>
              {primaryItems.map(renderPrimaryRow)}
            </section>
            <section className="sb-editor-group" aria-label="常驻侧栏">
              <header className="sb-editor-group-header">
                <h3>常驻侧栏</h3>
                <span data-sidebar-capacity>
                  {pinnedCount} / {MAX_PINNED_SIDEBAR_ITEMS}
                </span>
              </header>
              {pinnedItems.length === 0 ? (
                <p className="sb-editor-empty">暂无常驻项目</p>
              ) : (
                pinnedItems.map((item, index) => renderRow(item, index, pinnedItems, 'pinned'))
              )}
            </section>
            {(overflowItems.length > 0 || initialSection === 'overflow') && (
              <section
                ref={overflowSectionRef}
                className="sb-editor-group"
                aria-label="更多"
                data-sidebar-editor-overflow
              >
                <header className="sb-editor-group-header">
                  <h3>更多</h3>
                  {overflowItems.length > 0 && <span>{overflowItems.length}</span>}
                </header>
                {overflowItems.length === 0 ? (
                  <p className="sb-editor-empty">
                    暂无更多项目
                  </p>
                ) : (
                  overflowItems.map((item, index) => renderRow(item, index, overflowItems, 'overflow'))
                )}
              </section>
            )}
          </div>
          {removal ? (
            <p className="sb-editor-message" role="status">
              已移除 {removal.label} ·{' '}
              <button type="button" onClick={undoRemoval}>
                撤销
              </button>
            </p>
          ) : null}
          {capacityMessage ? (
            <p className="sb-editor-message" role="status">
              {capacityMessage}
            </p>
          ) : null}
        </>
      )}
      </div>
      <footer className="sb-editor-actions">
        {confirmDefaults && !pickerOpen ? (
          <>
            <span className="sb-editor-restore-message" role="status">确认恢复默认项目？当前草稿将被替换。</span>
            <Button size="sm" ref={restoreActionRef} aria-label="取消恢复默认" onClick={() => setConfirmDefaults(false)}>取消</Button>
            <Button size="sm" variant="bordered" onClick={() => {
              setDraft(migrateSidebarPins(DEFAULT_SIDEBAR_PINS))
              setPrimaryDraft([...DEFAULT_PRIMARY_SIDEBAR_ORDER])
              setRemoval(null)
              setCapacityMessage('')
              setConfirmDefaults(false)
            }}>确认恢复默认</Button>
          </>
        ) : (
          <>
            {!pickerOpen && (
              <>
                <Button className="sb-editor-restore" ref={restoreActionRef} size="sm" onClick={() => setConfirmDefaults(true)}>
                  恢复默认
                </Button>
                <Button variant="ghost" size="md" onClick={onCancel}>取消</Button>
              </>
            )}
            <Button
              variant="primary"
              size="md"
              className="is-primary"
              onClick={() => onCommit(normalizeSidebarWorkspaceItems(draft), primaryDraft)}
            >
              完成
            </Button>
          </>
        )}
      </footer>
    </section>
  )
}
