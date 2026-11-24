import { isComposingKey } from '@/lib/keyboardComposition'
import { useRef } from 'react'
import { Search, X } from '@/icons/appIcons'
import { ICON_SM } from '@/icons/iconSize'
import './SearchField.css'

type SearchFieldProps = {
  label: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  size?: 'sm' | 'md'
  className?: string
}

export function SearchField({ label, placeholder = label, value, onChange, size = 'md', className = '' }: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className={`ui-search-field ui-search-field-${size} ${className}`}>
      <label>
        <Search size={ICON_SM} aria-hidden />
        <input
          ref={input}
          type="search"
          aria-label={label}
          placeholder={placeholder}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !value || isComposingKey(event.nativeEvent)) return
            event.preventDefault()
            event.stopPropagation()
            onChange('')
          }}
        />
      </label>
      {value && (
        <button type="button" className="ui-search-clear" aria-label="清除搜索" onClick={() => {
          onChange('')
          input.current?.focus()
        }}>
          <X size={ICON_SM} aria-hidden />
        </button>
      )}
    </div>
  )
}
