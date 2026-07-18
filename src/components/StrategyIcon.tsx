import type { StrategyIconId } from '@/data/strategies'
import { getStrategyIcon } from '@/data/strategies'
import { ICON_TILE, iconTileGlyphSize, softIconBackground } from '@/icons/iconSize'
import './StrategyIcon.css'

export function StrategyIcon({
  icon,
  color,
  size = ICON_TILE,
  className = '',
  variant = 'default',
}: {
  icon: StrategyIconId
  color: string
  /** A1：外框 tile 边长（默认 16）；内嵌字形按 0.75 缩放 */
  size?: number
  className?: string
  /** nav：侧栏等导航场景，弱化色块背景 */
  variant?: 'default' | 'nav'
}) {
  const Icon = getStrategyIcon(icon)
  const isNav = variant === 'nav'
  const glyph = isNav ? size : iconTileGlyphSize(size)
  return (
    <span
      className={
        'strategy-icon' + (isNav ? ' strategy-icon--nav' : '') + (className ? ` ${className}` : '')
      }
      style={
        isNav
          ? { width: size, height: size, color }
          : {
              width: size,
              height: size,
              background: softIconBackground(color),
              color,
            }
      }
    >
      <Icon size={glyph} />
    </span>
  )
}

export function StrategyLabel({
  strategyId,
  strategies,
  size = ICON_TILE,
}: {
  strategyId: string
  strategies: { id: string; name: string; icon: StrategyIconId; color: string }[]
  /** A1：tile 边长，与 SymbolIcon 对齐 */
  size?: number
}) {
  const s = strategies.find((x) => x.id === strategyId)
  if (!s) {
    return (
      <span className="strategy-label strategy-label-fallback">
        <span
          className="strategy-icon is-placeholder"
          style={{ width: size, height: size }}
          aria-hidden
        />
        <span>未分类</span>
      </span>
    )
  }
  return (
    <span className="strategy-label" title={s.name}>
      <StrategyIcon icon={s.icon} color={s.color} size={size} />
      <span>{s.name}</span>
    </span>
  )
}
