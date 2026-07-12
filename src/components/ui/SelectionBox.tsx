import { Check } from '@/icons/appIcons'
import './SelectionBox.css'

type SelectionBoxProps = {
  checked: boolean
  onToggle: () => void
  label: string
  /** 全选条等场景始终可见；列表行默认悬停才显 */
  alwaysVisible?: boolean
  className?: string
}

/** 统一勾选：18×18 描边方框 + Check 11（对齐 trade-row-check） */
export function SelectionBox({
  checked,
  onToggle,
  label,
  alwaysVisible = false,
  className = '',
}: SelectionBoxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={
        'selection-box' +
        (checked ? ' is-selected' : '') +
        (alwaysVisible ? ' is-always-on' : '') +
        (className ? ` ${className}` : '')
      }
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      {checked ? <Check size={11} /> : null}
    </button>
  )
}
