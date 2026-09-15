import { Button } from '@/components/ui/Button'
import { ICON_SM } from '@/icons/iconSize'
import { useState, useRef, useEffect, useMemo, useId, useLayoutEffect, type KeyboardEvent } from 'react'
import { Tag, X } from '@/icons/appIcons'
import './TagEditor.css'

export function TagEditor({
  tags,
  onAdd,
  onRemove,
  suggestions = [],
  presets = [],
  showPresets = true,
  tone = 'neutral',
}: {
  tone?: 'neutral' | 'diagnostic'
  tags: string[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
  /** 已有标签列表，用于输入时 autocomplete */
  suggestions?: string[]
  /** 预置标签 */
  presets?: string[]
  /** 是否常驻展示未选择的预置标签；详情侧栏使用按需搜索以节省空间 */
  showPresets?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const listId = useId()
  const addRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const availablePresets = useMemo(
    () => presets.filter((p) => !tags.includes(p)),
    [presets, tags],
  )

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return showPresets ? [] : suggestions.filter((s) => !tags.includes(s))
    return suggestions.filter(
      (s) => !tags.includes(s) && s.toLowerCase().includes(q),
    )
  }, [value, suggestions, tags, showPresets])

  const showDropdown = editing && matches.length > 0

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  useEffect(() => {
    setActiveIdx(0)
  }, [value])

  useLayoutEffect(() => {
    if (pendingFocus.current === null) return
    const name = pendingFocus.current
    pendingFocus.current = null
    const next = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('.tag-chip-remove') ?? [])
      .find(button => button.getAttribute('aria-label') === `移除标签「${name}」`)
    ;(next ?? addRef.current)?.focus({ preventScroll: true })
  }, [editing, tags])

  useEffect(() => {
    setActiveIdx(index => Math.min(index, Math.max(0, matches.length - 1)))
  }, [matches])

  useEffect(() => {
    if (showDropdown) document.getElementById(`${listId}-${activeIdx}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, showDropdown, listId, matches])

  const commit = (tag?: string, restoreFocus = true) => {
    if (restoreFocus) pendingFocus.current = ''
    const t = (tag ?? value).trim()
    if (t && !tags.includes(t)) {
      onAdd(t)
    }
    setValue('')
    setEditing(false)
    setActiveIdx(0)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
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
      e.preventDefault()
      pendingFocus.current = ''
      setValue('')
      setEditing(false)
      setActiveIdx(0)
    }
  }

  const onBlur = (e: React.FocusEvent) => {
    if (wrapRef.current?.contains(e.relatedTarget as Node)) return
    commit(undefined, false)
  }

  return (
    <div className="tag-editor" data-tone={tone} ref={rootRef}>
      <div className="tag-selected-row">
        {tags.map((t) => (
          <span key={t} className="tag-chip">
            <span className="tag-chip-label">{t}</span>
            <button
              type="button"
              className="tag-chip-remove"
              aria-label={`移除标签「${t}」`}
              onClick={() => {
                const index = tags.indexOf(t)
                pendingFocus.current = tags[index + 1] ?? tags[index - 1] ?? ''
                onRemove(t)
              }}
            >
              <X size={ICON_SM} />
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
              aria-label="输入标签"
              aria-controls={showDropdown ? listId : undefined}
              aria-activedescendant={showDropdown ? `${listId}-${Math.min(activeIdx, matches.length - 1)}` : undefined}
              aria-expanded={showDropdown}
              aria-autocomplete="list"
            />
            {showDropdown && (
              <ul className="tag-suggest" role="listbox" id={listId} aria-label="标签候选">
                {matches.map((s, i) => (
                  <li key={s}>
                    <button
                      type="button"
                      role="option"
                      id={`${listId}-${i}`}
                      tabIndex={-1}
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
          <Button ref={addRef} variant="ghost" size="sm" className="tag-add-btn" onClick={() => setEditing(true)}>
            <Tag size={ICON_SM} />
            <span>添加标签</span>
          </Button>
        )}
      </div>

      {showPresets && availablePresets.length > 0 ? (
        <div className="tag-presets-row" aria-label="可添加的预置标签">
          {availablePresets.map((p) => (
            <span key={p} className="tag-preset-chip">
              <button
                type="button"
                className="tag-preset-label"
                aria-label={`添加标签「${p}」`}
                onClick={() => { pendingFocus.current = ''; onAdd(p) }}
              >
                {p}
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
