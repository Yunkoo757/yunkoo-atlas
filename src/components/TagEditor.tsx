import { useState, useRef, useEffect, useMemo, type KeyboardEvent, type ReactNode } from 'react'
import { Tag, X, Plus } from 'lucide-react'
import { HoverPreview } from '@/components/HoverPreview'
import './TagEditor.css'

export function TagEditor({
  tags,
  onAdd,
  onRemove,
  suggestions = [],
  presets = [],
  onAddPreset,
  onRemovePreset,
  getTagPreview,
}: {
  tags: string[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
  /** 已有标签列表，用于输入时 autocomplete */
  suggestions?: string[]
  /** 预置标签 */
  presets?: string[]
  onAddPreset?: (tag: string) => void
  onRemovePreset?: (tag: string) => void
  getTagPreview?: (tag: string) => ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return []
    return suggestions.filter(
      (s) => !tags.includes(s) && s.toLowerCase().includes(q),
    )
  }, [value, suggestions, tags])

  const showDropdown = editing && matches.length > 0

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  useEffect(() => {
    setActiveIdx(0)
  }, [value])

  const commit = (tag?: string) => {
    const t = (tag ?? value).trim()
    if (t && !tags.includes(t)) {
      onAdd(t)
      // 手动录入默认写入预设，便于后续点选
      if (onAddPreset && !presets.includes(t)) onAddPreset(t)
    }
    setValue('')
    setEditing(false)
    setActiveIdx(0)
  }

  const onKey = (e: KeyboardEvent) => {
    if (showDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, matches.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' && matches[activeIdx]) {
        e.preventDefault()
        commit(matches[activeIdx])
        return
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (showDropdown && matches[activeIdx]) {
        commit(matches[activeIdx])
      } else {
        commit()
      }
    } else if (e.key === 'Escape') {
      setValue('')
      setEditing(false)
      setActiveIdx(0)
    }
  }

  const onBlur = (e: React.FocusEvent) => {
    if (wrapRef.current?.contains(e.relatedTarget as Node)) return
    commit()
  }

  const withPreview = (tag: string, node: ReactNode) => {
    const preview = getTagPreview?.(tag)
    if (!preview) return node
    return (
      <HoverPreview content={preview}>
        {node}
      </HoverPreview>
    )
  }

  return (
    <div className="tag-editor">
      {(presets.length > 0 || onAddPreset) && (
        <div className="tag-presets-row">
          {presets.map((p) => (
            <span key={p}>
              {withPreview(
                p,
                <span
                  className={'tag-preset-chip' + (tags.includes(p) ? ' is-used' : '')}
                >
                  <button
                    type="button"
                    className="tag-preset-label"
                    aria-label={`添加标签「${p}」`}
                    onClick={() => { if (!tags.includes(p)) onAdd(p) }}
                    disabled={tags.includes(p)}
                  >
                    {p}
                  </button>
                  {onRemovePreset && (
                    <button
                      type="button"
                      className="tag-preset-remove"
                      aria-label={`删除预置「${p}」`}
                      onClick={() => onRemovePreset(p)}
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>,
              )}
            </span>
          ))}
          {onAddPreset && editing && value.trim() && !presets.includes(value.trim()) && (
            <button
              type="button"
              className="tag-preset-add-btn"
              aria-label="添加为预置标签"
              onClick={() => { onAddPreset(value.trim()); setValue('') }}
            >
              <Plus size={12} />
              <span>预置</span>
            </button>
          )}
        </div>
      )}
      {tags.map((t) => (
        <span key={t}>
          {withPreview(
            t,
            <span className="tag-chip">
              {t}
              <button
                type="button"
                className="tag-chip-remove"
                aria-label={`移除标签「${t}」`}
                onClick={() => onRemove(t)}
              >
                <X size={11} />
              </button>
            </span>,
          )}
        </span>
      ))}
      {editing ? (
        <div className="tag-input-wrap" ref={wrapRef}>
          <input
            ref={inputRef}
            className="tag-input"
            value={value}
            placeholder="输入标签…"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            onBlur={onBlur}
            role="combobox"
            aria-expanded={showDropdown}
            aria-autocomplete="list"
          />
          {showDropdown && (
            <ul className="tag-suggest" role="listbox">
              {matches.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === activeIdx}
                    className={'tag-suggest-item' + (i === activeIdx ? ' is-active' : '')}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commit(s)}
                    onMouseEnter={() => setActiveIdx(i)}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button type="button" className="tag-add-btn" onClick={() => setEditing(true)}>
          <Tag size={14} />
          <span>添加标签</span>
        </button>
      )}
    </div>
  )
}
