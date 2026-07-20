/** 灯箱画布变换：光标锚定缩放 + 平移。 */

export const LIGHTBOX_MIN_SCALE = 0.25
export const LIGHTBOX_MAX_SCALE = 8
export const LIGHTBOX_ZOOM_STEP = 1.12

export type LightboxView = {
  scale: number
  tx: number
  ty: number
}

export type LightboxImageLayout = {
  width: number
  height: number
  fitScale: number
}

export type LightboxOrigin = {
  x: number
  y: number
  width: number
  height: number
  borderRadius: number
}

export type LightboxTransition = {
  x: number
  y: number
  scaleX: number
  scaleY: number
}

type LightboxImageLayoutInput = {
  naturalWidth: number
  naturalHeight: number
  viewportWidth: number
  viewportHeight: number
  devicePixelRatio: number
}

export const LIGHTBOX_VIEW_RESET: LightboxView = { scale: 1, tx: 0, ty: 0 }

export function calculateLightboxImageLayout({
  naturalWidth,
  naturalHeight,
  viewportWidth,
  viewportHeight,
  devicePixelRatio,
}: LightboxImageLayoutInput): LightboxImageLayout {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1
  const width = naturalWidth / ratio
  const height = naturalHeight / ratio
  const fitScale = Math.min(
    1,
    Math.max(1, viewportWidth - 64) / width,
    Math.max(1, viewportHeight - 64) / height,
  )
  return { width, height, fitScale }
}

export function clampLightboxScale(scale: number): number {
  return Math.min(LIGHTBOX_MAX_SCALE, Math.max(LIGHTBOX_MIN_SCALE, scale))
}

/**
 * 相对视口中心坐标系：原点在 viewport 中心。
 * client 坐标 → 相对中心偏移后，按光标锚定缩放。
 */
export function zoomLightboxAtCursor(
  view: LightboxView,
  clientX: number,
  clientY: number,
  viewportCenterX: number,
  viewportCenterY: number,
  factor: number,
): LightboxView {
  const next = clampLightboxScale(view.scale * factor)
  if (next === view.scale) return view

  const px = clientX - viewportCenterX
  const py = clientY - viewportCenterY
  const wx = (px - view.tx) / view.scale
  const wy = (py - view.ty) / view.scale
  return {
    scale: next,
    tx: px - wx * next,
    ty: py - wy * next,
  }
}

export function panLightboxView(view: LightboxView, dx: number, dy: number): LightboxView {
  return { ...view, tx: view.tx + dx, ty: view.ty + dy }
}

export function lightboxViewTransform(view: LightboxView): string {
  // 先以自身中心对齐视口中心，再施加平移与缩放
  return `translate(-50%, -50%) translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`
}

export function calculateLightboxTransition(
  origin: LightboxOrigin,
  target: { x: number; y: number; width: number; height: number },
  fitScale: number,
): LightboxTransition {
  const safeScale = fitScale > 0 ? fitScale : 1
  return {
    x: (origin.x + origin.width / 2 - (target.x + target.width / 2)) / safeScale,
    y: (origin.y + origin.height / 2 - (target.y + target.height / 2)) / safeScale,
    scaleX: origin.width / Math.max(1, target.width),
    scaleY: origin.height / Math.max(1, target.height),
  }
}

type LightboxResetHandler = () => void
type LightboxCloseHandler = () => void

let resetHandler: LightboxResetHandler | null = null
let closeHandler: LightboxCloseHandler | null = null

/** ImageLightbox 挂载时注册，供快捷键触发重置 */
export function registerLightboxResetHandler(handler: LightboxResetHandler): () => void {
  resetHandler = handler
  return () => {
    if (resetHandler === handler) resetHandler = null
  }
}

export function requestLightboxReset(): boolean {
  if (!resetHandler) return false
  resetHandler()
  return true
}

export function registerLightboxCloseHandler(handler: LightboxCloseHandler): () => void {
  closeHandler = handler
  return () => {
    if (closeHandler === handler) closeHandler = null
  }
}

export function requestLightboxClose(): boolean {
  if (!closeHandler) return false
  closeHandler()
  return true
}
