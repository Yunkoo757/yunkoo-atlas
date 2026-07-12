/**
 * 与 `tokens.css` 中 `--icon-*` 对齐的数值尺寸。
 * SVG 组件需要 number；CSS 布局用 var(--icon-*)。
 */
export const ICON_XS = 12
export const ICON_SM = 14
export const ICON_MD = 16
export const ICON_LG = 18
export const ICON_XL = 20
export const ICON_2XL = 22
export const ICON_HERO = 40

/** 编辑器 BubbleMenu 等紧凑工具条 */
export const ICON_TOOLBAR = ICON_SM

/** A1：列表/筛选等内容标外框 */
export const ICON_TILE = ICON_MD

/** A1：软色底透明度（与 --icon-tile-tint 一致） */
export const ICON_TILE_TINT = 20

/** 内容标内字形 ≈ tile × 0.75 */
export function iconTileGlyphSize(tile = ICON_TILE): number {
  return Math.max(10, Math.round(tile * 0.75))
}

/** 品牌色 → A1 软色底 */
export function softIconBackground(color: string, tint = ICON_TILE_TINT): string {
  return `color-mix(in srgb, ${color} ${tint}%, transparent)`
}
