import { MAX_REVIEW_TEMPLATES } from '@/data/reviewTemplates'
import { reviewTemplateParagraphs } from '@/lib/reviewTemplateDocument'
import { ICON_SM, ICON_XL } from '@/icons/iconSize'
import { useEffect, useState } from 'react'
import { FileText, GripVertical, Plus, Trash2 } from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import { IconButton } from '@/components/ui/IconButton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { toast } from '@/lib/toast'
import { hideNativeDragPreview } from '@/lib/dragPreview'
import { DisclosureSummary } from '@/components/ui/DisclosureSummary'
import './ReviewTemplatesPanel.css'

export function ReviewTemplatesPanel() {
  const templates = useStore((state) => state.reviewTemplates)
  const addTemplate = useStore((state) => state.addReviewTemplate)
  const updateTemplate = useStore((state) => state.updateReviewTemplate)
  const removeTemplate = useStore((state) => state.removeReviewTemplate)
  const reorderTemplates = useStore((state) => state.reorderReviewTemplates)
  const reviewContextPinned = useStore((state) => state.display.reviewContextPinned ?? true)
  const setDisplay = useStore((state) => state.setDisplay)
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null)
  const [nameDraft, setNameDraft] = useState<{ id: string; value: string } | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const selected = templates.find((template) => template.id === selectedId) ?? templates[0] ?? null

  useEffect(() => {
    if (selected?.id !== selectedId) setSelectedId(selected?.id ?? null)
  }, [selected?.id, selectedId])

  const handleAdd = () => {
    const id = addTemplate()
    if (id) setSelectedId(id)
  }

  const handleRemove = () => {
    if (!selected) return
    const index = templates.findIndex((template) => template.id === selected.id)
    const next = templates[index + 1] ?? templates[index - 1] ?? null
    const undo = removeTemplate(selected.id)
    if (!undo) return
    setSelectedId(next?.id ?? null)
    toast(`已删除起稿模板「${selected.name}」`, {
      tone: 'success',
      actionLabel: '撤销',
      onAction: () => {
        if (undo()) toast(`已恢复「${selected.name}」`, { tone: 'success' })
        else toast('模板列表已变化，未能恢复', { tone: 'warning' })
      },
    })
  }

  const moveTemplateByKeyboard = (id: string, direction: -1 | 1) => {
    const index = templates.findIndex((template) => template.id === id)
    const target = templates[index + direction]
    if (!target) return
    reorderTemplates(id, target.id)
  }

  return (
    <div className="settings-page settings-page--reading review-templates-panel">
      <div className="settings-page-head review-templates-head">
        <div>
          <h1 className="settings-page-title">复盘起稿</h1>
        </div>
        {selected && (templates.length < MAX_REVIEW_TEMPLATES ? <button type="button" className="dio-btn" onClick={handleAdd}>
          <Plus size={ICON_SM} aria-hidden />
          新建模板
        </button> : <span className="settings-page-desc">已达 {MAX_REVIEW_TEMPLATES} 个模板上限</span>)}
      </div>

      <section className="review-pin-setting" aria-labelledby="review-pin-setting-title">
        <div>
          <h2 id="review-pin-setting-title">复盘开头提示</h2>
          <p>固定后，盘面摘要等开头提示始终留在正文上方。</p>
        </div>
        <SegmentedControl
          label="复盘开头提示显示方式"
          role="radiogroup"
          size="md"
          value={reviewContextPinned ? 'pinned' : 'unpinned'}
          options={[{ value: 'pinned', label: '固定在顶部' }, { value: 'unpinned', label: '随正文滚动' }]}
          onChange={(value) => setDisplay({ reviewContextPinned: value === 'pinned' })}
        />
      </section>

      {selected ? (
        <div className="review-templates-workspace">
          <nav className="review-template-list" aria-label="复盘起稿模板">
            {templates.map((template, index) => (
              <div
                key={template.id}
                className={
                  'review-template-list-item' +
                  (template.id === selected.id ? ' is-active' : '') +
                  (draggedId === template.id ? ' is-dragging' : '') +
                  (dragOverId === template.id && draggedId !== template.id ? ' is-drag-over' : '')
                }
                onDragOver={(event) => {
                  if (!draggedId) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDragOverId(template.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const sourceId = draggedId ?? event.dataTransfer.getData('text/plain')
                  reorderTemplates(sourceId, template.id)
                  setDraggedId(null)
                  setDragOverId(null)
                }}
              >
                <button
                  type="button"
                  className="review-template-drag-handle"
                  draggable
                  disabled={templates.length < 2}
                  aria-label={`拖动调整「${template.name}」顺序；也可按 Alt 加上下方向键。第 ${index + 1} 项，共 ${templates.length} 项`}
                  onDragStart={(event) => {
                    setDraggedId(template.id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', template.id)
                    hideNativeDragPreview(event.dataTransfer)
                  }}
                  onDragEnd={() => {
                    setDraggedId(null)
                    setDragOverId(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.altKey && event.key === 'ArrowUp') {
                      event.preventDefault()
                      moveTemplateByKeyboard(template.id, -1)
                    } else if (event.altKey && event.key === 'ArrowDown') {
                      event.preventDefault()
                      moveTemplateByKeyboard(template.id, 1)
                    }
                  }}
                >
                  <GripVertical size={ICON_SM} aria-hidden />
                </button>
                <button
                  type="button"
                  className="review-template-select"
                  onClick={() => setSelectedId(template.id)}
                >
                  <FileText size={ICON_SM} aria-hidden />
                  <span>{template.name}</span>
                </button>
              </div>
            ))}
          </nav>

          <section className="review-template-editor" aria-label={`编辑${selected.name}`}>
            <label className="review-template-field-head" htmlFor="review-template-name">
              模板名称
            </label>
            <div className="review-template-name-row">
              <input
                id="review-template-name"
                className="review-template-name"
                value={nameDraft?.id === selected.id ? nameDraft.value : selected.name}
                maxLength={40}
                onChange={(event) => {
                  const name = event.target.value
                  setNameDraft({ id: selected.id, value: name })
                  if (name.trim()) updateTemplate(selected.id, { name })
                }}
                onBlur={() => setNameDraft(null)}
              />
              <IconButton
                className="review-template-delete"
                label={`删除模板「${selected.name}」`}
                tooltip="删除模板"
                onClick={handleRemove}
              >
                <Trash2 size={ICON_SM} aria-hidden />
              </IconButton>
            </div>

            <label className="review-template-content-label" htmlFor="review-template-content">
              起稿内容
            </label>
            <textarea
              id="review-template-content"
              className="review-template-content"
              value={selected.content}
              maxLength={4000}
              spellCheck={false}
              onChange={(event) => updateTemplate(selected.id, { content: event.target.value })}
              placeholder={'HTF 背景：\nMTF 触发：\nLTF 执行：\nTP 管理：'}
            />
            <details className="review-template-preview"><DisclosureSummary>预览起稿</DisclosureSummary>
              <div>{reviewTemplateParagraphs(selected.content).map((paragraph, index) => <p key={index}>{paragraph.content?.map((part, i) => part.marks?.some(mark => mark.type === 'bold') ? <strong key={i}>{part.text}</strong> : part.text) || <br />}</p>)}</div>
            </details>
          </section>
        </div>
      ) : (
        <button type="button" className="review-template-empty" onClick={handleAdd}>
          <FileText size={ICON_XL} aria-hidden />
          <strong>新建起稿模板</strong>
        </button>
      )}
    </div>
  )
}
