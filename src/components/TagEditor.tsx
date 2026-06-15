import { useState, useRef, useEffect, useMemo, type KeyboardEvent } from 'react'
import { Tag, X } from 'lucide-react'
import './TagEditor.css'

export function TagEditor({
  tags,
  onAdd,
  onRemove,
  suggestions = [],
}: {
  tags: string[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
  /** 已有标签列表，用于输入时 autocomplete */
  suggestions?: string[]
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
    if (t && !tags.includes(t)) onAdd(t)
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

  return (
    <div className="tag-editor">
      {tags.map((t) => (
        <span className="tag-chip" key={t}>
          {t}
          <button
            type="button"
            className="tag-chip-remove"
            title="移除标签"
            onClick={() => onRemove(t)}
          >
            <X size={11} />
          </button>
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
