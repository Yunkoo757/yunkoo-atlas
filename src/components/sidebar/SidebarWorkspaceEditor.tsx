import { useEffect, useState } from 'react'
import { GripVertical, Trash2 } from 'lucide-react'
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
}

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

export function SidebarWorkspaceEditor({ items, sources, onCommit, onCancel }: SidebarWorkspaceEditorProps) {
  const [draft, setDraft] = useState<SidebarWorkspaceItem[]>(() => items.map((item) => ({ ...item, target: { ...item.target } })))
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [removal, setRemoval] = useState<Removal | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmDefaults, setConfirmDefaults] = useState(false)
  const [capacityMessage, setCapacityMessage] = useState('')
  const pinnedCount = draft.filter((item) => item.placement === 'pinned').length

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
      setDraft(draft.map((candidate) => candidate.id === item.id ? { ...candidate, placement: 'overflow' } : candidate))
      return
    }
    if (pinnedCount >= MAX_PINNED_SIDEBAR_ITEMS) {
      setCapacityMessage('常驻项目已满，项目保留在更多')
      return
    }
    setDraft(draft.map((candidate) => candidate.id === item.id ? { ...candidate, placement: 'pinned' } : candidate))
  }

  const moveByKeyboard = (itemId: string, direction: -1 | 1) => {
    const index = draft.findIndex((item) => item.id === itemId)
    const target = draft[index + direction]
    if (target) setDraft((current) => moveItem(current, itemId, target.id))
  }

  return (
    <section className="sb-workspace-editor" aria-label="管理我的空间">
      <header className="sb-workspace-editor-header">
        <h2>管理我的空间</h2>
        <span data-sidebar-capacity>{pinnedCount} / 8</span>
      </header>
      {pickerOpen ? (
        <SidebarTargetPicker
          items={draft}
          sources={sources}
          onChange={setDraft}
          onBack={() => setPickerOpen(false)}
        />
      ) : (
        <>
          <p className="sb-editor-help">拖动排序，或使用 Alt + ↑ / ↓</p>
          <div className="sb-editor-list">
            {draft.map((item) => {
              const resolved = resolveSidebarWorkspaceItem(item, sources)
              return (
                <div
                  key={item.id}
                  className="sb-editor-item"
                  data-sidebar-item
                  draggable
                  tabIndex={0}
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
                    setDraft((current) => moveItem(current, sourceId, item.id))
                    setDraggedId(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.altKey && event.key === 'ArrowUp') {
                      event.preventDefault()
                      moveByKeyboard(item.id, -1)
                    } else if (event.altKey && event.key === 'ArrowDown') {
                      event.preventDefault()
                      moveByKeyboard(item.id, 1)
                    } else if (event.key === 'Delete') {
                      event.preventDefault()
                      removeItem(item, resolved.label)
                    }
                  }}
                >
                  <GripVertical size={15} aria-hidden="true" />
                  <span className="sb-editor-item-label" data-sidebar-item-label>{resolved.label}</span>
                  {resolved.invalid ? <span className="sb-editor-invalid">已失效</span> : null}
                  <button type="button" onClick={() => togglePlacement(item)}>
                    {item.placement === 'pinned' ? '移至更多' : '常驻侧栏'}
                  </button>
                  <button type="button" aria-label={`删除 ${resolved.label}`} onClick={() => removeItem(item, resolved.label)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
          {removal ? (
            <p className="sb-editor-message" role="status">
              已移除 {removal.label} · <button type="button" onClick={undoRemoval}>撤销</button>
            </p>
          ) : null}
          {capacityMessage ? <p className="sb-editor-message" role="status">{capacityMessage}</p> : null}
          <button type="button" className="sb-editor-browse" onClick={() => setPickerOpen(true)}>浏览可添加项目</button>
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
                <button type="button" aria-label="取消恢复默认" onClick={() => setConfirmDefaults(false)}>取消</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDefaults(true)}>恢复默认</button>
            )}
          </div>
          <footer className="sb-editor-actions">
            <button type="button" onClick={onCancel}>取消</button>
            <button type="button" className="is-primary" onClick={() => onCommit(normalizeSidebarWorkspaceItems(draft))}>完成</button>
          </footer>
        </>
      )}
    </section>
  )
}
