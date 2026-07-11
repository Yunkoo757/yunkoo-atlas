import { useEffect, useRef, useState } from 'react'
import { GripVertical, Trash2 } from '@/icons/appIcons'
import type { Strategy } from '@/data/strategies'
import type { SavedTradeView } from '@/lib/savedTradeViews'
import { DEFAULT_SIDEBAR_PINS } from '@/lib/sidebarNav'
import {
  MAX_PINNED_SIDEBAR_ITEMS,
  migrateSidebarPins,
  normalizeSidebarWorkspaceItems,
  resolveSidebarWorkspaceItem,
  type SidebarWorkspaceItem,
} from '@/lib/sidebarWorkspace'
import { SidebarTargetPicker } from '@/components/sidebar/SidebarTargetPicker'

export type SidebarTargetSources = {
  savedViews: SavedTradeView[]
  strategies: Strategy[]
}

export type SidebarWorkspaceEditorProps = {
  items: SidebarWorkspaceItem[]
  sources: SidebarTargetSources
  onCommit: (items: SidebarWorkspaceItem[]) => void
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

function moveItem(items: SidebarWorkspaceItem[], itemId: string, targetId: string): SidebarWorkspaceItem[] {
  const fromIndex = items.findIndex((item) => item.id === itemId)
  const targetIndex = items.findIndex((item) => item.id === targetId)
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return items
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(targetIndex, 0, moved)
  return reindex(next)
}

export function SidebarWorkspaceEditor({
  items,
  sources,
  onCommit,
  onCancel,
  variant = 'popover',
  initialSection = 'pinned',
}: SidebarWorkspaceEditorProps) {
  const [draft, setDraft] = useState<SidebarWorkspaceItem[]>(() =>
    items.map((item) => ({ ...item, target: { ...item.target } })),
  )
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [removal, setRemoval] = useState<Removal | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmDefaults, setConfirmDefaults] = useState(false)
  const [capacityMessage, setCapacityMessage] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)
  const overflowSectionRef = useRef<HTMLElement>(null)
  const pinnedItems = draft.filter((item) => item.placement === 'pinned')
  const overflowItems = draft.filter((item) => item.placement === 'overflow')
  const pinnedCount = pinnedItems.length

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  useEffect(() => {
    if (pickerOpen || initialSection !== 'overflow') return
    overflowSectionRef.current?.scrollIntoView({ block: 'nearest' })
  }, [initialSection, pickerOpen])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

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
    const next = moveItem(draft, itemId, targetId)
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

  const renderRow = (
    item: SidebarWorkspaceItem,
    indexInGroup: number,
    group: SidebarWorkspaceItem[],
    placement: 'pinned' | 'overflow',
  ) => {
    const resolved = resolveSidebarWorkspaceItem(item, sources)
    const descriptionId = `sidebar-sort-description-${item.id}`
    return (
      <div
        key={item.id}
        className="sb-editor-item"
        data-sidebar-item
        data-sidebar-placement={item.placement}
        draggable={variant !== 'mobile-fullscreen'}
        onDragStart={(event) => {
          setDraggedId(item.id)
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', item.id)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          const sourceId = draggedId ?? event.dataTransfer.getData('text/plain')
          applyMove(sourceId, item.id, placement)
          setDraggedId(null)
        }}
      >
        <button
          type="button"
          className="sb-editor-sort-handle"
          aria-label={`排序 ${resolved.label}`}
          aria-describedby={descriptionId}
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
          <GripVertical size={15} aria-hidden="true" />
        </button>
        <span id={descriptionId} className="sb-screen-reader">
          {placement === 'pinned' ? '常驻' : '更多'}第 {indexInGroup + 1} 项，共 {group.length}{' '}
          项。使用 Alt + 上/下方向键排序
        </span>
        <span className="sb-editor-item-label" data-sidebar-item-label>
          {resolved.label}
        </span>
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
        <button type="button" onClick={() => togglePlacement(item)}>
          {item.placement === 'pinned' ? '移至更多' : '常驻侧栏'}
        </button>
        <button
          type="button"
          aria-label={`删除 ${resolved.label}`}
          onClick={() => removeItem(item, resolved.label)}
        >
          <Trash2 size={14} />
        </button>
      </div>
    )
  }

  return (
    <section
      id={SIDEBAR_WORKSPACE_EDITOR_ID}
      className={`sb-workspace-editor${variant === 'mobile-fullscreen' ? ' is-mobile-fullscreen' : ''}`}
      role="dialog"
      aria-modal={variant === 'mobile-fullscreen' ? 'true' : undefined}
      aria-labelledby={SIDEBAR_WORKSPACE_EDITOR_TITLE_ID}
      data-mobile-fullscreen={variant === 'mobile-fullscreen' ? 'true' : undefined}
      onKeyDown={(event) => {
        if (variant !== 'mobile-fullscreen' || event.key !== 'Tab') return
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled)',
          ),
        ).filter((element) => element.offsetParent !== null)
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!first || !last) return

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <header className="sb-workspace-editor-header">
        <h2 id={SIDEBAR_WORKSPACE_EDITOR_TITLE_ID} ref={titleRef} tabIndex={-1}>
          管理我的空间
        </h2>
        <span data-sidebar-capacity>
          常驻 {pinnedCount} / 8
          {overflowItems.length > 0 ? ` · 更多 ${overflowItems.length}` : ''}
        </span>
      </header>
      <span className="sb-screen-reader" aria-live="polite">
        {announcement}
      </span>
      {pickerOpen ? (
        <SidebarTargetPicker
          items={draft}
          sources={sources}
          onChange={setDraft}
          onBack={() => setPickerOpen(false)}
        />
      ) : (
        <>
          <p className="sb-editor-help">
            常驻最多 8 项会直接出现在侧栏；超出项在「更多」，可随时改回常驻或删除。
            {variant === 'mobile-fullscreen' ? ' 使用上移 / 下移排序。' : ' 组内可拖动或 Alt + ↑/↓ 排序。'}
          </p>
          <div className="sb-editor-list">
            <section className="sb-editor-group" aria-label="常驻侧栏">
              <header className="sb-editor-group-header">
                <h3>常驻侧栏</h3>
                <span>
                  {pinnedCount} / {MAX_PINNED_SIDEBAR_ITEMS}
                </span>
              </header>
              {pinnedItems.length === 0 ? (
                <p className="sb-editor-empty">暂无常驻项。可从下方「更多」改回，或浏览添加。</p>
              ) : (
                pinnedItems.map((item, index) => renderRow(item, index, pinnedItems, 'pinned'))
              )}
            </section>
            <section
              ref={overflowSectionRef}
              className="sb-editor-group"
              aria-label="更多"
              data-sidebar-editor-overflow
            >
              <header className="sb-editor-group-header">
                <h3>更多</h3>
                <span>{overflowItems.length}</span>
              </header>
              {overflowItems.length === 0 ? (
                <p className="sb-editor-empty">
                  暂无。常驻满 8 项后再添加，会进入这里——不会丢，可在此改回常驻或删除。
                </p>
              ) : (
                overflowItems.map((item, index) => renderRow(item, index, overflowItems, 'overflow'))
              )}
            </section>
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
          <button type="button" className="sb-editor-browse" onClick={() => setPickerOpen(true)}>
            浏览可添加项目
          </button>
          <div className="sb-editor-defaults">
            {confirmDefaults ? (
              <>
                <span>确认恢复默认项目？当前草稿将被替换。</span>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(migrateSidebarPins(DEFAULT_SIDEBAR_PINS))
                    setRemoval(null)
                    setConfirmDefaults(false)
                  }}
                >
                  确认恢复默认
                </button>
                <button type="button" aria-label="取消恢复默认" onClick={() => setConfirmDefaults(false)}>
                  取消
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDefaults(true)}>
                恢复默认
              </button>
            )}
          </div>
          <footer className="sb-editor-actions">
            <button type="button" onClick={onCancel}>
              取消
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => onCommit(normalizeSidebarWorkspaceItems(draft))}
            >
              完成
            </button>
          </footer>
        </>
      )}
    </section>
  )
}
