import type { StrategyIconId } from '@/data/strategies'
import { getStrategyIcon } from '@/data/strategies'
import './StrategyIcon.css'

export function StrategyIcon({
  icon,
  color,
  size = 16,
  className = '',
  variant = 'default',
}: {
  icon: StrategyIconId
  color: string
  size?: number
  className?: string
  /** nav：侧栏等导航场景，弱化色块背景 */
  variant?: 'default' | 'nav'
}) {
  const Icon = getStrategyIcon(icon)
  const isNav = variant === 'nav'
  const box = isNav ? size : size + 8
  return (
    <span
      className={
        'strategy-icon' + (isNav ? ' strategy-icon--nav' : '') + (className ? ` ${className}` : '')
      }
      style={
        isNav
          ? { width: box, height: box }
          : {
              width: box,
              height: box,
              background: `color-mix(in srgb, ${color} 22%, transparent)`,
              color,
            }
      }
    >
      <Icon size={size} strokeWidth={isNav ? 1.75 : 2} />
    </span>
  )
}

export function StrategyLabel({
  strategyId,
  strategies,
  size = 14,
}: {
  strategyId: string
  strategies: { id: string; name: string; icon: StrategyIconId; color: string }[]
  size?: number
}) {
  const s = strategies.find((x) => x.id === strategyId)
  if (!s) return <span className="strategy-label-fallback">未分类</span>
  return (
    <span className="strategy-label">
      <StrategyIcon icon={s.icon} color={s.color} size={size - 2} />
      <span>{s.name}</span>
    </span>
  )
}
