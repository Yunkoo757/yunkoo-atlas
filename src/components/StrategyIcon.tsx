import type { Strategy, StrategyIconId } from '@/data/strategies'
import { getStrategyIcon } from '@/data/strategies'
import { strategyGlyphColor } from '@/data/strategyColors'
import { ICON_TILE } from '@/icons/iconSize'
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
  /** A1：图标边长，字形在 24 单位画布内自带光学留白 */
  size?: number
  className?: string
  /** 导航和密集列表中的字形跟随当前文字状态。 */
  variant?: 'default' | 'nav'
}) {
  const Icon = getStrategyIcon(icon)
  const isNav = variant === 'nav'
  return (
    <span
      aria-hidden
      className={
        'strategy-icon' + (isNav ? ' is-nav' : '') + (className ? ` ${className}` : '')
      }
      style={{ width: size, height: size, color: isNav ? undefined : strategyGlyphColor(color) }}
    >
      <Icon size={size} />
    </span>
  )
}

export function strategySelectOption(strategy: Strategy) {
  return {
    value: strategy.id,
    label: strategy.name,
    icon: <StrategyIcon icon={strategy.icon} color={strategy.color} />,
  }
}

export function StrategyLabel({
  strategyId,
  strategies,
  size = ICON_TILE,
  variant,
}: {
  strategyId: string
  strategies: Strategy[]
  variant?: 'default' | 'nav'
  /** A1：tile 边长，与 SymbolIcon 对齐 */
  size?: number
}) {
  const s = strategies.find((x) => x.id === strategyId)
  if (!s) {
    return (
      <span className="strategy-label strategy-label-fallback">
        <span
          className="strategy-icon"
          style={{ width: size, height: size }}
          aria-hidden
        />
        <span>未分类</span>
      </span>
    )
  }
  return (
    <span className="strategy-label">
      <StrategyIcon icon={s.icon} color={s.color} size={size} variant={variant} />
      <span>{s.name}</span>
    </span>
  )
}
