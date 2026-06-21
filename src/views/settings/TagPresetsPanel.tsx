import { useState } from 'react'
import { useStore } from '@/store/useStore'
import { Tag, X, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import './TagPresetsPanel.css'

export function TagPresetsPanel() {
  const tagPresets = useStore((s) => s.tagPresets)
  const mistakeTagPresets = useStore((s) => s.mistakeTagPresets)
  const addTagPreset = useStore((s) => s.addTagPreset)
  const removeTagPreset = useStore((s) => s.removeTagPreset)
  const addMistakeTagPreset = useStore((s) => s.addMistakeTagPreset)
  const removeMistakeTagPreset = useStore((s) => s.removeMistakeTagPreset)

  return (
    <div className="settings-page tag-presets-panel">
      <div className="settings-page-head">
        <h1 className="settings-page-title">标签管理</h1>
        <p className="settings-page-desc">
          预置标签会在标签编辑器顶部显示为快捷按钮，点击即可添加，减少重复输入。
        </p>
      </div>

      <TagSection
        title="普通标签"
        desc="用于交易分类，如「趋势跟随」「突破」「日内」等。"
        presets={tagPresets}
        onAdd={addTagPreset}
        onRemove={(tag) => {
          removeTagPreset(tag)
          toast(`已删除预置「${tag}」`)
        }}
      />

      <TagSection
        title="错误 / 违规标签"
        desc="用于复盘时标记交易错误，如「逆势交易」「过早止盈」「假突破」等。"
        presets={mistakeTagPresets}
        onAdd={addMistakeTagPreset}
        onRemove={(tag) => {
          removeMistakeTagPreset(tag)
          toast(`已删除预置「${tag}」`)
        }}
      />
    </div>
  )
}

function TagSection({
  title,
  desc,
  presets,
  onAdd,
  onRemove,
}: {
  title: string
  desc: string
  presets: string[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
}) {
  const [input, setInput] = useState('')
  const [batch, setBatch] = useState('')

  const handleAdd = () => {
    const trimmed = input.trim()
    if (!trimmed) return
    if (presets.includes(trimmed)) {
      toast('标签已存在')
      return
    }
    onAdd(trimmed)
    setInput('')
    toast(`已添加「${trimmed}」`)
  }

  const handleBatchAdd = () => {
    const lines = batch
      .split(/[\n,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    let added = 0
    for (const tag of lines) {
      if (!presets.includes(tag)) {
        onAdd(tag)
        added++
      }
    }
    setBatch('')
    if (added > 0) toast(`已批量添加 ${added} 个标签`)
    else toast('所有标签已存在')
  }

  return (
    <section className="tag-section">
      <h2 className="tag-section-title">{title}</h2>
      <p className="tag-section-desc">{desc}</p>

      {/* 单个添加 */}
      <div className="tag-add-row">
        <input
          type="text"
          className="tag-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
          placeholder="输入标签名…"
          maxLength={24}
        />
        <button
          type="button"
          className="dio-btn dio-btn-primary"
          onClick={handleAdd}
          disabled={!input.trim()}
        >
          <Plus size={14} />
          <span>添加</span>
        </button>
      </div>

      {/* 批量添加 */}
      <details className="tag-batch">
        <summary className="tag-batch-summary">批量导入</summary>
        <textarea
          className="tag-batch-input"
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
          placeholder="每行一个标签，或用逗号分隔"
          rows={4}
        />
        <button
          type="button"
          className="dio-btn"
          onClick={handleBatchAdd}
          disabled={!batch.trim()}
        >
          导入
        </button>
      </details>

      {/* 列表 */}
      {presets.length === 0 ? (
        <p className="tag-section-empty">暂无预置</p>
      ) : (
        <div className="tag-list">
          {presets.map((t) => (
            <span className="tag-chip" key={t}>
              <Tag size={12} />
              {t}
              <button
                type="button"
                className="tag-chip-remove"
                title={`删除「${t}」`}
                onClick={() => onRemove(t)}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}
