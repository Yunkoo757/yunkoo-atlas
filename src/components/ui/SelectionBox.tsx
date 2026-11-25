import { ICON_SM } from '@/icons/iconSize'
import { CheckMark } from '@/icons/StateIcons'
import './SelectionBox.css'

type SelectionBoxProps = {
  checked: boolean
  onToggle: () => void
  label: string
  /** 全选条等场景始终可见；列表行默认悬停才显 */
  alwaysVisible?: boolean
  className?: string
}

/** 统一勾选：列表与批量操作共用的 18×18 勾选框 */
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
      <CheckMark checked={checked} size={ICON_SM} />
    </button>
  )
}
