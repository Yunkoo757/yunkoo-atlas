import { createPortal } from 'react-dom'
import { useEffect, useState, useRef } from 'react'
import { useShortcutStore } from '@/store/shortcutStore'
import { X } from '@/icons/appIcons'
import {
  STRATEGY_COLOR_PRESETS,
  STRATEGY_ICON_OPTIONS,
  type Strategy,
  type StrategyIconId,
  slugifyStrategyName,
} from '@/data/strategies'
import { StrategyIcon } from '@/components/StrategyIcon'
import { Tooltip } from '@/components/ui/Tooltip'
import { useExitClone } from '@/components/ui/useExitClone'
import './StrategyFormModal.css'

export function StrategyFormModal({
  open,
  initial,
  existingNames,
  onClose,
  onSave,
}: {
  open: boolean
  initial: Strategy | null
  existingNames: string[]
  onClose: () => void
  onSave: (data: Omit<Strategy, 'id'>, id?: string) => void
}) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<StrategyIconId>('target')
  const [color, setColor] = useState<string>(STRATEGY_COLOR_PRESETS[0])
  const nameInputRef = useRef<HTMLInputElement>(null)
  const exitRef = useExitClone<HTMLDivElement>(open)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setIcon(initial?.icon ?? 'target')
      setColor(initial?.color ?? STRATEGY_COLOR_PRESETS[0])
      // 状态初始化后再聚焦，避免 autoFocus 与 useEffect 设值竞争导致焦点丢失
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          nameInputRef.current?.focus()
        })
      })
    }
  }, [open, initial])

  useEffect(() => {
    if (!open) return
    useShortcutStore.getState().acquireModalOverlay()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      useShortcutStore.getState().releaseModalOverlay()
    }
  }, [open, onClose])

  if (!open) return null

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

  return createPortal(
    <div ref={exitRef} className="sfm-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="sfm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="strategy-form-title"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), [contenteditable="true"]',
            ),
          ).filter((element) => element.offsetParent !== null)
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (!first || !last) return

          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div className="sfm-head">
          <h2 id="strategy-form-title">{initial ? '编辑策略' : '新建策略'}</h2>
          <button className="sfm-close" onClick={onClose} aria-label="关闭策略表单">
            <X size={16} />
          </button>
        </div>

        <div className="sfm-body">
          <label className="sfm-field">
            <span className="sfm-label">名称</span>
            <input
              ref={nameInputRef}
              className="sfm-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如 Breakout、波段趋势"
            />
            {nameTaken && <span className="sfm-error">名称已存在</span>}
          </label>

          <div className="sfm-field">
            <span className="sfm-label">图标</span>
            <div className="sfm-icon-grid">
              {STRATEGY_ICON_OPTIONS.map(({ id, label, Icon }) => (
                <Tooltip content={label} label={label} key={id}>
                  <button
                    type="button"
                    className={'sfm-icon-opt' + (icon === id ? ' is-on' : '')}
                    aria-label={label}
                    onClick={() => setIcon(id)}
                    style={
                      icon === id
                        ? {
                            background: `color-mix(in srgb, ${color} 24%, transparent)`,
                            color,
                            borderColor: color,
                          }
                        : undefined
                    }
                  >
                    <Icon size={18} />
                  </button>
                </Tooltip>
              ))}
            </div>
          </div>

          <div className="sfm-field">
            <span className="sfm-label">配色</span>
            <div className="sfm-color-grid">
              {STRATEGY_COLOR_PRESETS.map((c) => (
                <Tooltip content={c} label={`选择配色 ${c}`} key={c}>
                  <button
                    type="button"
                    className={'sfm-color-opt' + (color === c ? ' is-on' : '')}
                    style={{ background: c }}
                    aria-label={`选择配色 ${c}`}
                    onClick={() => setColor(c)}
                  />
                </Tooltip>
              ))}
            </div>
            <div className="sfm-preview">
              <StrategyIcon icon={icon} color={color} size={18} />
              <span style={{ color }}>{trimmed || '预览'}</span>
            </div>
          </div>
        </div>

        <div className="sfm-foot">
          <button type="button" className="ui-btn ui-btn-bordered ui-btn-lg" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-primary ui-btn-lg"
            disabled={!trimmed || !!nameTaken}
            onClick={save}
          >
            {initial ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function uniqueStrategyId(name: string, existing: Strategy[]): string {
  let base = slugifyStrategyName(name)
  if (!existing.some((s) => s.id === base)) return base
  let i = 2
  while (existing.some((s) => s.id === `${base}-${i}`)) i++
  return `${base}-${i}`
}
