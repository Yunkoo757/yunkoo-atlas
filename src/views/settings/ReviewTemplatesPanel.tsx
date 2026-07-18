import { useEffect, useState } from 'react'
import { FileText, GripVertical, Plus, Trash2 } from '@/icons/appIcons'
import { useStore } from '@/store/useStore'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/lib/toast'
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
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const selected = templates.find((template) => template.id === selectedId) ?? templates[0] ?? null

  useEffect(() => {
    if (selected?.id !== selectedId) setSelectedId(selected?.id ?? null)
  }, [selected?.id, selectedId])

  const handleAdd = () => {
    const id = addTemplate()
    setSelectedId(id)
  }

  const handleRemove = () => {
    if (!selected) return
    const index = templates.findIndex((template) => template.id === selected.id)
    const next = templates[index + 1] ?? templates[index - 1] ?? null
    removeTemplate(selected.id)
    setSelectedId(next?.id ?? null)
    toast(`已删除起稿模板「${selected.name}」`)
  }

  const moveTemplateByKeyboard = (id: string, direction: -1 | 1) => {
    const index = templates.findIndex((template) => template.id === id)
    const target = templates[index + direction]
    if (!target) return
    reorderTemplates(id, target.id)
  }

  return (
    <div className="settings-page review-templates-panel">
      <div className="settings-page-head review-templates-head">
        <div>
          <h1 className="settings-page-title">复盘起稿</h1>
          <p className="settings-page-desc">
            为不同交易场景保存多个开头框架。拖动左侧模板可调整起稿菜单顺序，插入后仍可自由修改。
          </p>
        </div>
        <button type="button" className="dio-btn dio-btn-primary" onClick={handleAdd}>
          <Plus size={14} aria-hidden />
          新建模板
        </button>
      </div>

      <section className="review-pin-setting" aria-labelledby="review-pin-setting-title">
        <div>
          <h2 id="review-pin-setting-title">详情页开头</h2>
          <p>统一决定所有交易的开头叙述是否在浏览截图时保持可见。</p>
        </div>
        <div className="review-pin-options" role="radiogroup" aria-label="详情页开头显示方式">
          <button
            type="button"
            role="radio"
            aria-checked={reviewContextPinned}
            className={reviewContextPinned ? 'is-active' : ''}
            onClick={() => setDisplay({ reviewContextPinned: true })}
          >
            全部固定
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!reviewContextPinned}
            className={!reviewContextPinned ? 'is-active' : ''}
            onClick={() => setDisplay({ reviewContextPinned: false })}
          >
            全部不固定
          </button>
        </div>
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
                    const row = event.currentTarget.closest('.review-template-list-item')
                    if (row) event.dataTransfer.setDragImage(row, 12, 17)
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
                  <GripVertical size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  className="review-template-select"
                  onClick={() => setSelectedId(template.id)}
                >
                  <FileText size={14} aria-hidden />
                  <span>{template.name}</span>
                </button>
              </div>
            ))}
          </nav>

          <section className="review-template-editor" aria-label={`编辑${selected.name}`}>
            <div className="review-template-field-head">
              <label htmlFor="review-template-name">模板名称</label>
              <Tooltip content="删除模板" label={`删除模板「${selected.name}」`} asChild>
                <button
                  type="button"
                  className="review-template-delete"
                  aria-label={`删除模板「${selected.name}」`}
                  onClick={handleRemove}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </Tooltip>
            </div>
            <input
              id="review-template-name"
              className="review-template-name"
              value={selected.name}
              maxLength={40}
              onChange={(event) => updateTemplate(selected.id, { name: event.target.value })}
              onBlur={(event) => {
                if (!event.target.value.trim()) updateTemplate(selected.id, { name: '未命名模板' })
              }}
            />

            <label className="review-template-content-label" htmlFor="review-template-content">
              起稿内容
              <span>每行插入为一个段落，冒号前的文字会自动加粗</span>
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
          </section>
        </div>
      ) : (
        <button type="button" className="review-template-empty" onClick={handleAdd}>
          <FileText size={20} aria-hidden />
          <strong>还没有复盘起稿模板</strong>
          <span>新建一个模板，把重复的盘面叙述结构保存下来。</span>
        </button>
      )}
    </div>
  )
}
