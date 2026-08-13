export const DEFAULT_WINDOW_BOUNDS = { width: 1280, height: 860 } as const
export const MIN_WINDOW_BOUNDS = { width: 960, height: 640 } as const

export type PersistedWindowState = {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized: boolean
}

export type DisplayBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type WindowBounds = DisplayBounds

export function resolveWindowMinimumBounds(
  restored: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: Math.min(MIN_WINDOW_BOUNDS.width, Math.max(1, Math.round(restored.width))),
    height: Math.min(MIN_WINDOW_BOUNDS.height, Math.max(1, Math.round(restored.height))),
  }
}

type WindowBoundsInput = {
  x?: number
  y?: number
  width: number
  height: number
}

export type WindowSizePresetId =
  | 'default'
  | 'comfort'
  | 'large'
  | 'fhd'
  | 'maximized'

export type WindowSizePreset = {
  id: WindowSizePresetId
  label: string
  description: string
  width?: number
  height?: number
  maximize?: boolean
}

export const WINDOW_SIZE_PRESETS: readonly WindowSizePreset[] = [
  {
    id: 'default',
    label: '1280 × 860',
    description: '默认工作尺寸，适合多数笔记本',
    width: 1280,
    height: 860,
  },
  {
    id: 'comfort',
    label: '1440 × 900',
    description: '更宽的日常视图',
    width: 1440,
    height: 900,
  },
  {
    id: 'large',
    label: '1600 × 1000',
    description: '大屏阅读与对照编辑',
    width: 1600,
    height: 1000,
  },
  {
    id: 'fhd',
    label: '1920 × 1080',
    description: '全高清窗口尺寸',
    width: 1920,
    height: 1080,
  },
  {
    id: 'maximized',
    label: '最大化',
    description: '占满当前显示器工作区',
    maximize: true,
  },
] as const

const PRESET_MATCH_TOLERANCE_PX = 2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function intersects(a: DisplayBounds, b: DisplayBounds): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

function intersectionArea(a: DisplayBounds, b: DisplayBounds): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

function squaredCenterDistance(a: DisplayBounds, b: DisplayBounds): number {
  const dx = a.x + a.width / 2 - (b.x + b.width / 2)
  const dy = a.y + a.height / 2 - (b.y + b.height / 2)
  return dx * dx + dy * dy
}

/**
 * 把已保存窗口完整放回某个显示器工作区。
 * 工作区小于产品最小尺寸时以工作区为准，避免标题栏或退出入口落到屏幕外。
 */
export function fitBoundsToWorkArea(
  saved: WindowBoundsInput,
  workAreas: DisplayBounds[],
  minimum: { width: number; height: number },
): WindowBounds {
  const width = Math.max(1, Math.round(saved.width))
  const height = Math.max(1, Math.round(saved.height))
  if (workAreas.length === 0) {
    return {
      x: Math.round(saved.x ?? 0),
      y: Math.round(saved.y ?? 0),
      width: Math.max(minimum.width, width),
      height: Math.max(minimum.height, height),
    }
  }

  const hasPosition = isFiniteNumber(saved.x) && isFiniteNumber(saved.y)
  const candidate: DisplayBounds = {
    x: Math.round(saved.x ?? workAreas[0]!.x),
    y: Math.round(saved.y ?? workAreas[0]!.y),
    width,
    height,
  }
  const ranked = [...workAreas].sort((left, right) => {
    const overlap = intersectionArea(candidate, right) - intersectionArea(candidate, left)
    if (overlap !== 0) return overlap
    return squaredCenterDistance(candidate, left) - squaredCenterDistance(candidate, right)
  })
  const workArea = hasPosition ? ranked[0]! : workAreas[0]!
  const fittedWidth = workArea.width < minimum.width
    ? workArea.width
    : clamp(width, minimum.width, workArea.width)
  const fittedHeight = workArea.height < minimum.height
    ? workArea.height
    : clamp(height, minimum.height, workArea.height)
  const centeredX = workArea.x + Math.round((workArea.width - fittedWidth) / 2)
  const centeredY = workArea.y + Math.round((workArea.height - fittedHeight) / 2)
  const x = hasPosition
    ? clamp(candidate.x, workArea.x, workArea.x + workArea.width - fittedWidth)
    : centeredX
  const y = hasPosition
    ? clamp(candidate.y, workArea.y, workArea.y + workArea.height - fittedHeight)
    : centeredY

  return { x, y, width: fittedWidth, height: fittedHeight }
}

/** 规范化窗口状态，并把已移出屏幕的坐标丢弃 */
export function normalizeWindowState(
  raw: unknown,
  displays: DisplayBounds[],
): PersistedWindowState {
  const source =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  const width = isFiniteNumber(source.width)
    ? clamp(Math.round(source.width), MIN_WINDOW_BOUNDS.width, 10_000)
    : DEFAULT_WINDOW_BOUNDS.width
  const height = isFiniteNumber(source.height)
    ? clamp(Math.round(source.height), MIN_WINDOW_BOUNDS.height, 10_000)
    : DEFAULT_WINDOW_BOUNDS.height
  const isMaximized = source.isMaximized === true

  if (!isFiniteNumber(source.x) || !isFiniteNumber(source.y) || displays.length === 0) {
    return { width, height, isMaximized }
  }

  const x = Math.round(source.x)
  const y = Math.round(source.y)
  const windowBounds = { x, y, width, height }
  const visible = displays.some((display) => intersects(windowBounds, display))
  if (!visible) {
    return { width, height, isMaximized }
  }

  return { x, y, width, height, isMaximized }
}

export function matchWindowSizePreset(state: {
  width: number
  height: number
  isMaximized: boolean
}): WindowSizePresetId | null {
  if (state.isMaximized) return 'maximized'
  const matched = WINDOW_SIZE_PRESETS.find(
    (preset) =>
      !preset.maximize &&
      preset.width != null &&
      preset.height != null &&
      Math.abs(preset.width - state.width) <= PRESET_MATCH_TOLERANCE_PX &&
      Math.abs(preset.height - state.height) <= PRESET_MATCH_TOLERANCE_PX,
  )
  return matched?.id ?? null
}

export function resolveWindowSizePreset(
  presetId: string,
): WindowSizePreset | null {
  return WINDOW_SIZE_PRESETS.find((preset) => preset.id === presetId) ?? null
}

/** 在工作区内应用目标宽高，必要时收缩并保证仍可见 */
export function fitWindowSizeToWorkArea(
  target: { width: number; height: number },
  current: DisplayBounds,
  workArea: DisplayBounds,
): DisplayBounds {
  const width = clamp(
    Math.round(target.width),
    MIN_WINDOW_BOUNDS.width,
    workArea.width,
  )
  const height = clamp(
    Math.round(target.height),
    MIN_WINDOW_BOUNDS.height,
    workArea.height,
  )
  let x = current.x
  let y = current.y
  if (x + width > workArea.x + workArea.width) {
    x = workArea.x + workArea.width - width
  }
  if (y + height > workArea.y + workArea.height) {
    y = workArea.y + workArea.height - height
  }
  x = Math.max(workArea.x, x)
  y = Math.max(workArea.y, y)
  return { x, y, width, height }
}
