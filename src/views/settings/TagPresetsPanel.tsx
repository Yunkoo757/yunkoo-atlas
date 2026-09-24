import { ICON_SM } from '@/icons/iconSize'
import { useState } from 'react'
import { useStore } from '@/store/useStore'
import { X, Plus } from '@/icons/appIcons'
import { toast } from '@/lib/toast'
import { Tooltip } from '@/components/ui/Tooltip'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import './TagPresetsPanel.css'

export function TagPresetsPanel() {
  const tagPresets = useStore((s) => s.tagPresets)
  const mistakeTagPresets = useStore((s) => s.mistakeTagPresets)
  const addTagPreset = useStore((s) => s.addTagPreset)
  const removeTagPreset = useStore((s) => s.removeTagPreset)
  const addMistakeTagPreset = useStore((s) => s.addMistakeTagPreset)
  const removeMistakeTagPreset = useStore((s) => s.removeMistakeTagPreset)

  const [category, setCategory] = useState<'normal' | 'mistake'>('normal')
  return (
    <div className="settings-page settings-page--form tag-presets-panel">
      <div className="settings-page-head">
        <h1 className="settings-page-title">标签管理</h1>
      </div>
      <SegmentedControl label="标签分类" value={category} onChange={setCategory}
        options={[
          { value: 'normal', label: `普通标签 ${tagPresets.length}` },
          { value: 'mistake', label: `错误 / 违规 ${mistakeTagPresets.length}` },
        ]} />
      <div hidden={category !== 'normal'}>
        <TagSection title="普通标签" presets={tagPresets} onAdd={addTagPreset}
          onRemove={(tag) => { removeTagPreset(tag); toast(`已删除预置「${tag}」`) }} />
      </div>
      <div hidden={category !== 'mistake'}>
        <TagSection title="错误 / 违规标签" presets={mistakeTagPresets} onAdd={addMistakeTagPreset}
          onRemove={(tag) => { removeMistakeTagPreset(tag); toast(`已删除预置「${tag}」`) }} />
      </div>
    </div>
  )
}

function TagSection({
  title,
  presets,
  onAdd,
  onRemove,
}: {
  title: string
  presets: string[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
}) {
  const [input, setInput] = useState('')
  const [batch, setBatch] = useState('')
  const [query, setQuery] = useState('')
  const matches = presets.filter((tag) => tag.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

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
    for (const tag of new Set(lines)) {
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
    <section className="tag-section" aria-label={title}>

      {/* 单个添加 */}
      <div className="tag-add-row">
        <input
          type="text"
          className="tag-preset-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
          aria-label={`新增${title}`}
          placeholder="输入标签名…"
          maxLength={24}
        />
        <Button
          variant="bordered"
          onClick={handleAdd}
          disabled={!input.trim()}
          aria-label={`添加${title}`}
        >
          <Plus size={ICON_SM} />
          <span>添加</span>
        </Button>
      </div>

      {/* 批量添加 */}
      <details className="tag-batch">
        <summary className="tag-batch-summary">批量导入</summary>
        <textarea
          className="tag-batch-input"
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
          aria-label={`批量导入${title}`}
          placeholder="每行一个标签，或用逗号分隔"
          rows={4}
        />
        <Button
          variant="bordered"
          onClick={handleBatchAdd}
          disabled={!batch.trim()}
          aria-label={`导入${title}`}
        >
          导入
        </Button>
      </details>

      {presets.length >= 12 || query ? (
        <input className="tag-preset-input tag-search" type="search" aria-label={`搜索${title}`}
          placeholder="搜索标签" value={query} onChange={(event) => setQuery(event.target.value)} />
      ) : null}
      {/* 列表 */}
      {presets.length === 0 ? (
        <p className="tag-section-empty">暂无预置</p>
      ) : (
        <div className="tag-list">
          {matches.map((t) => (
            <span className="settings-tag-chip" key={t}>
              <span className="settings-tag-chip-label">{t}</span>
              <Tooltip content="删除" label={`删除「${t}」`}>
                <button
                  type="button"
                  className="settings-tag-chip-remove"
                  aria-label={`删除「${t}」`}
                  onClick={() => onRemove(t)}
                >
                  <X size={ICON_SM} />
                </button>
              </Tooltip>
            </span>
          ))}
        </div>
      )}
      {presets.length > 0 && matches.length === 0 ? <p className="tag-section-empty">没有匹配的标签</p> : null}
    </section>
  )
}
