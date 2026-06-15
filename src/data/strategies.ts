import type { LucideIcon } from 'lucide-react'
import {
  TrendingUp,
  ArrowLeftRight,
  Activity,
  Newspaper,
  Zap,
  Target,
  Layers,
  BarChart2,
  Flame,
  Rocket,
  Shield,
  LineChart,
  Crosshair,
  Gauge,
} from 'lucide-react'

export type StrategyIconId =
  | 'trending-up'
  | 'arrow-left-right'
  | 'activity'
  | 'newspaper'
  | 'zap'
  | 'target'
  | 'layers'
  | 'bar-chart-2'
  | 'flame'
  | 'rocket'
  | 'shield'
  | 'line-chart'
  | 'crosshair'
  | 'gauge'

export interface Strategy {
  id: string
  name: string
  icon: StrategyIconId
  color: string
  reviewTemplateHtml?: string
}

export const STRATEGY_ICON_OPTIONS: {
  id: StrategyIconId
  label: string
  Icon: LucideIcon
}[] = [
  { id: 'trending-up', label: '趋势', Icon: TrendingUp },
  { id: 'arrow-left-right', label: '回归', Icon: ArrowLeftRight },
  { id: 'activity', label: '波动', Icon: Activity },
  { id: 'newspaper', label: '新闻', Icon: Newspaper },
  { id: 'zap', label: '闪电', Icon: Zap },
  { id: 'target', label: '目标', Icon: Target },
  { id: 'layers', label: '分层', Icon: Layers },
  { id: 'bar-chart-2', label: '图表', Icon: BarChart2 },
  { id: 'flame', label: '热点', Icon: Flame },
  { id: 'rocket', label: '火箭', Icon: Rocket },
  { id: 'shield', label: '防守', Icon: Shield },
  { id: 'line-chart', label: '曲线', Icon: LineChart },
  { id: 'crosshair', label: '精准', Icon: Crosshair },
  { id: 'gauge', label: '仪表', Icon: Gauge },
]

export const STRATEGY_COLOR_PRESETS = [
  '#5e6ad2',
  '#27ae60',
  '#bb6bd9',
  '#f2994a',
  '#56ccf2',
  '#eb5757',
  '#f2c94c',
  '#6fcf97',
  '#9b51e0',
  '#2f80ed',
  '#e67e22',
  '#1abc9c',
] as const

export const DEFAULT_STRATEGIES: Strategy[] = [
  { id: 'breakout', name: 'Breakout', icon: 'trending-up', color: '#5e6ad2' },
  { id: 'mean-reversion', name: 'Mean Reversion', icon: 'arrow-left-right', color: '#bb6bd9' },
  { id: 'trend-following', name: 'Trend Following', icon: 'activity', color: '#27ae60' },
  { id: 'news-catalyst', name: 'News Catalyst', icon: 'newspaper', color: '#f2994a' },
  { id: 'scalp', name: 'Scalp', icon: 'zap', color: '#56ccf2' },
]

const ICON_MAP = Object.fromEntries(
  STRATEGY_ICON_OPTIONS.map((o) => [o.id, o.Icon]),
) as Record<StrategyIconId, LucideIcon>

export function getStrategyIcon(icon: StrategyIconId): LucideIcon {
  return ICON_MAP[icon] ?? Target
}

export function slugifyStrategyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || `strategy-${Date.now()}`
}
