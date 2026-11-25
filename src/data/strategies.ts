import type { AppIcon } from '@/icons/appIcons'
import { createDefaultStrategies } from '@/config/defaultProfile'
import { AnalyticsNavIcon } from '@/icons/NavigationIcons'
import { RiskNavIcon } from '@/icons/SettingsIcons'
import {
  AimIcon, CurveIcon, DefenseIcon, HeatIcon, LaunchIcon, MomentumIcon,
  NewsIcon, PrecisionIcon, ReversionIcon, StrataIcon, TrendIcon, VolatilityIcon,
} from '@/icons/StrategyIcons'

export type StrategyIconId = typeof STRATEGY_ICON_OPTIONS[number]['id']

export interface Strategy {
  id: string
  name: string
  icon: StrategyIconId
  color: string
}

export const STRATEGY_ICON_OPTIONS = [
  { id: 'trending-up', label: '趋势', Icon: TrendIcon },
  { id: 'arrow-left-right', label: '回归', Icon: ReversionIcon },
  { id: 'activity', label: '波动', Icon: VolatilityIcon },
  { id: 'newspaper', label: '新闻', Icon: NewsIcon },
  { id: 'zap', label: '闪电', Icon: MomentumIcon },
  { id: 'target', label: '目标', Icon: AimIcon },
  { id: 'layers', label: '分层', Icon: StrataIcon },
  { id: 'bar-chart-2', label: '图表', Icon: AnalyticsNavIcon },
  { id: 'flame', label: '热点', Icon: HeatIcon },
  { id: 'rocket', label: '火箭', Icon: LaunchIcon },
  { id: 'shield', label: '防守', Icon: DefenseIcon },
  { id: 'line-chart', label: '曲线', Icon: CurveIcon },
  { id: 'crosshair', label: '精准', Icon: PrecisionIcon },
  { id: 'gauge', label: '仪表', Icon: RiskNavIcon },
] as const

export { STRATEGY_COLOR_PRESETS } from './strategyColors'

export const DEFAULT_STRATEGIES: Strategy[] = createDefaultStrategies()

const ICON_MAP = new Map<StrategyIconId, AppIcon>(
  STRATEGY_ICON_OPTIONS.map(({ id, Icon }) => [id, Icon]),
)

export function getStrategyIcon(icon: StrategyIconId): AppIcon {
  return ICON_MAP.get(icon) ?? AimIcon
}

export function slugifyStrategyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || `strategy-${Date.now()}`
}
