// 策略色标按身份使用。旧资料库仍以原始十六进制值保存预设选择。
export const STRATEGY_COLOR_OPTIONS = [
  { label: '靛蓝', color: '#99a5d6', legacy: '#5e6ad2' },
  { label: '叶绿', color: '#83ad86', legacy: '#27ae60' },
  { label: '兰紫', color: '#c093bd', legacy: '#bb6bd9' },
  { label: '杏橙', color: '#c99a72', legacy: '#f2994a' },
  { label: '冰青', color: '#83b4c5', legacy: '#56ccf2' },
  { label: '玫瑰', color: '#c58693', legacy: '#eb5757' },
  { label: '麦金', color: '#cbb371', legacy: '#f2c94c' },
  { label: '橄榄', color: '#b1b995', legacy: '#6fcf97' },
  { label: '雾紫', color: '#aa96ce', legacy: '#9b51e0' },
  { label: '湖蓝', color: '#7c9fc8', legacy: '#2f80ed' },
  { label: '陶棕', color: '#b3826e', legacy: '#e67e22' },
  { label: '松石', color: '#78b5a6', legacy: '#1abc9c' },
] as const

export const STRATEGY_COLOR_PRESETS = STRATEGY_COLOR_OPTIONS.map(option => option.color)

export function findStrategyColorOption(stored: string) {
  const color = stored.trim().toLowerCase()
  return STRATEGY_COLOR_OPTIONS.find(option => option.color === color || option.legacy === color)
}

export function strategyGlyphColor(stored: string): string {
  // 自定义色保留色相；极深的导入颜色仅在绘制小字形时抬高明度。
  return findStrategyColorOption(stored)?.color ?? `oklch(from ${stored} max(l, .68) c h / 1)`
}
