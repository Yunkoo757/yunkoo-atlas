import { ICON_LG } from '@/icons/iconSize'
import { useId, useState } from 'react'
import {
  STRATEGY_ICON_OPTIONS,
  type Strategy,
  type StrategyIconId,
  slugifyStrategyName,
} from '@/data/strategies'
import { STRATEGY_COLOR_OPTIONS, findStrategyColorOption } from '@/data/strategyColors'
import { StrategyIcon } from '@/components/StrategyIcon'
import { Tooltip } from '@/components/ui/Tooltip'
import { DialogSaveButton } from '@/components/ui/DialogSaveButton'
import { ModalShell } from '@/components/ui/ModalShell'
import './StrategyFormModal.css'

export function StrategyFormModal({
  initial,
  existingNames,
  onClose,
  onSave,
}: {
  initial: Strategy | null
  existingNames: string[]
  onClose: () => void
  onSave: (data: Omit<Strategy, 'id'>, id?: string) => void
}) {
  const formId = useId()
  const nameErrorId = useId()
  const [name, setName] = useState(initial?.name ?? '')
  const [icon, setIcon] = useState<StrategyIconId>(initial?.icon ?? 'target')
  const initialColor = initial?.color ?? STRATEGY_COLOR_OPTIONS[0].color
  const [color, setColor] = useState(initialColor)
  const initialOption = findStrategyColorOption(initialColor)
  const options = initialOption
    ? STRATEGY_COLOR_OPTIONS
    : [...STRATEGY_COLOR_OPTIONS, { label: '自定义色', color: initialColor }]
  const selectedColor = findStrategyColorOption(color)?.color ?? color

  const trimmed = name.trim()
  const nameTaken =
    trimmed &&
    existingNames.some(
      (n) => n.toLowerCase() === trimmed.toLowerCase() && n !== initial?.name,
    )

  const save = () => {
    if (!trimmed || nameTaken) return
    onSave({ name: trimmed, icon, color }, initial?.id)
    onClose()
  }

  return (
    <ModalShell
      title={initial ? '编辑策略' : '新建策略'}
      size="compact"
      bodyClassName="sfm-body"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="ui-btn ui-btn-bordered ui-btn-lg" onClick={onClose}>
            取消
          </button>
          <DialogSaveButton type="submit" form={formId} disabled={!trimmed || !!nameTaken}>
            {initial ? '保存' : '创建'}
          </DialogSaveButton>
        </>
      )}
    >
          <form id={formId} onSubmit={event => { event.preventDefault(); save() }}>
            <label className="sfm-field">
              <span className="sfm-label">名称</span>
              <input
                className="sfm-input"
                aria-invalid={nameTaken || undefined}
                aria-describedby={nameTaken ? nameErrorId : undefined}
                data-autofocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如 Breakout、波段趋势"
              />
              {nameTaken && <span id={nameErrorId} className="sfm-error" role="alert">名称已存在</span>}
            </label>
          </form>

          <div className="sfm-field">
            <span className="sfm-label">图标</span>
            <div className="sfm-icon-grid" role="group" aria-label="图标">
              {STRATEGY_ICON_OPTIONS.map(({ id, label, Icon }) => (
                <Tooltip content={label} label={label} key={id}>
                  <button
                    type="button"
                    className={'sfm-icon-opt' + (icon === id ? ' is-on' : '')}
                    aria-label={label}
                    aria-pressed={icon === id}
                    onClick={() => setIcon(id)}
                  >
                    <Icon size={ICON_LG} aria-hidden />
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>

          <div className="sfm-field">
            <span className="sfm-label">配色</span>
            <div className="sfm-color-grid" role="group" aria-label="配色">
              {options.map(option => (
                <Tooltip asChild content={option.label} label={option.label} key={option.color}>
                  <button
                    type="button"
                    className="sfm-color-opt"
                    aria-label={option.label}
                    aria-pressed={selectedColor === option.color}
                    onClick={() => setColor(option.color === initialOption?.color ? initialColor : option.color)}
                  >
                    <span className="sfm-color-dot" style={{ backgroundColor: option.color }} />
                  </button>
                </Tooltip>
              ))}
            </div>
            <div className="sfm-preview">
              <StrategyIcon icon={icon} color={color} size={ICON_LG} />
              <span>{trimmed || '预览'}</span>
            </div>
          </div>
    </ModalShell>
  )
}

export function uniqueStrategyId(name: string, existing: Strategy[]): string {
  let base = slugifyStrategyName(name)
  if (!existing.some((s) => s.id === base)) return base
  let i = 2
  while (existing.some((s) => s.id === `${base}-${i}`)) i++
  return `${base}-${i}`
}
