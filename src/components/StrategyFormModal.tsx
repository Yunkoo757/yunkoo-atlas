import { createPortal } from 'react-dom'
import { useEffect, useState, useRef } from 'react'
import { X } from '@/icons/appIcons'
import {
  STRATEGY_COLOR_PRESETS,
  STRATEGY_ICON_OPTIONS,
  type Strategy,
  type StrategyIconId,
  slugifyStrategyName,
} from '@/data/strategies'
import { DEFAULT_REVIEW_TEMPLATE_HTML } from '@/lib/reviewTemplates'
import { StrategyIcon } from '@/components/StrategyIcon'
import { Tooltip } from '@/components/ui/Tooltip'
import { Editor } from '@/editor/Editor'
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
  const [reviewTemplateHtml, setReviewTemplateHtml] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setIcon(initial?.icon ?? 'target')
      setColor(initial?.color ?? STRATEGY_COLOR_PRESETS[0])
      setReviewTemplateHtml(initial?.reviewTemplateHtml ?? DEFAULT_REVIEW_TEMPLATE_HTML)
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
    onSave({ name: trimmed, icon, color, reviewTemplateHtml: reviewTemplateHtml.trim() || undefined }, initial?.id)
    onClose()
  }

  return createPortal(
    <div className="sfm-overlay" onMouseDown={onClose}>
      <div className="sfm" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sfm-head">
          <span>{initial ? '编辑策略' : '新建策略'}</span>
          <button className="sfm-close" onClick={onClose}>
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

          <div className="sfm-field">
            <span className="sfm-label">复盘结构</span>
            <div className="sfm-editor">
              <Editor
                content={reviewTemplateHtml}
                onChange={setReviewTemplateHtml}
                placeholder="写下复盘提纲；输入“- ”建立清单，“> ”插入引用"
              />
            </div>
          </div>
        </div>

        <div className="sfm-foot">
          <button className="sfm-btn sfm-btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="sfm-btn sfm-btn-primary"
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
