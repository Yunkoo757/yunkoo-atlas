/** 灯箱画布变换：光标锚定缩放 + 平移。 */

export const LIGHTBOX_MIN_SCALE = 0.25
export const LIGHTBOX_MAX_SCALE = 8
export const LIGHTBOX_ZOOM_STEP = 1.12

export type LightboxView = {
  scale: number
  tx: number
  ty: number
}

export const LIGHTBOX_VIEW_RESET: LightboxView = { scale: 1, tx: 0, ty: 0 }

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
