import { createLucideIcon } from 'lucide-react'

// Match the optical bounds and rounded strokes of the 16px navigation symbols.
const outline = { strokeWidth: 'var(--icon-stroke-width)' }
const ink = { fill: 'currentColor', stroke: 'none' }

export const TrendIcon = createLucideIcon('AtlasTrend', [
  ['path', { ...outline, d: 'm3.75 17 5.5-6 4 3.75 6.5-7.5 M15 7.25h4.75V12', key: 'trend' }],
])

export const ReversionIcon = createLucideIcon('AtlasReversion', [
  ['path', { ...outline, d: 'M4 8h14 M15 4.75 18.5 8 15 11.25 M20 16H6 M9 12.75 5.5 16 9 19.25', key: 'return' }],
])

export const VolatilityIcon = createLucideIcon('AtlasVolatility', [
  ['path', { ...outline, d: 'M3.5 13h4l2.75-7.75L14 18.75l2.5-7.5h4', key: 'pulse' }],
])

export const NewsIcon = createLucideIcon('AtlasNews', [
  ['path', { ...outline, d: 'M20 19H6.25A2.25 2.25 0 0 1 4 16.75V6.5A1.5 1.5 0 0 1 5.5 5h11.25a1.5 1.5 0 0 1 1.5 1.5v10.75a1.75 1.75 0 1 0 3.5 0V10', key: 'paper' }],
  ['rect', { ...ink, x: '7', y: '8.5', width: '7.75', height: '2.75', rx: '.8', key: 'headline' }],
  ['path', { ...outline, d: 'M7.75 14.5h5', key: 'text' }],
])

export const MomentumIcon = createLucideIcon('AtlasMomentum', [
  ['path', { ...ink, d: 'M13.85 3.75c.55-.6 1.45-.12 1.2.65l-1.7 5.35h4.05c.9 0 1.25.78.68 1.47l-8 9.03c-.56.62-1.44.15-1.2-.65l1.72-6.12H6.65c-.86 0-1.23-.78-.65-1.44Z', key: 'bolt' }],
])

export const AimIcon = createLucideIcon('AtlasAim', [
  ['circle', { ...outline, cx: '12', cy: '12', r: '8', key: 'ring' }],
  ['circle', { ...ink, cx: '12', cy: '12', r: '3.2', key: 'bullseye' }],
])

export const StrataIcon = createLucideIcon('AtlasStrata', [
  ['path', { ...outline, d: 'm4 9 7.25-4.1a1.5 1.5 0 0 1 1.5 0L20 9l-7.25 4.1a1.5 1.5 0 0 1-1.5 0Z M4 14.25l7.25 4.1a1.5 1.5 0 0 0 1.5 0L20 14.25', key: 'layers' }],
])

export const HeatIcon = createLucideIcon('AtlasHeat', [
  ['path', { ...outline, d: 'M10.75 3.75c.7 4.5-5.5 6.4-5.5 11A6.6 6.6 0 0 0 12 20.5a6.65 6.65 0 0 0 6.75-6.75c0-2.2-1.1-4.2-2.75-5.85.2 2.15-.5 3.15-1.6 3.9.5-3.2-.6-5.95-3.65-8.05Z', key: 'flame' }],
])

export const LaunchIcon = createLucideIcon('AtlasLaunch', [
  ['path', { ...outline, d: 'M8.5 12.75C10 8.5 13.5 4.75 19.5 4.5c-.25 6-3.75 9.75-8.25 11.25Z M9.5 10.5l-3 .25-2.25 3.5 4.5-.5 M13.5 15l-.25 3-3.5 2.25.5-4.5 M6.75 17.25l-2 2', key: 'hull' }],
  ['circle', { ...ink, cx: '15.25', cy: '8.75', r: '1.4', key: 'window' }],
])

export const DefenseIcon = createLucideIcon('AtlasDefense', [
  ['path', { ...outline, d: 'M5 7.25c2.5-.3 4.9-1.1 7-2.75 2.1 1.65 4.5 2.45 7 2.75v5c0 4.1-3.15 6.75-7 8.25-3.85-1.5-7-4.15-7-8.25Z', key: 'shield' }],
])

export const CurveIcon = createLucideIcon('AtlasCurve', [
  ['path', { ...outline, d: 'M4.5 5.5v12A1.5 1.5 0 0 0 6 19h13.5 M8 14.25c3.75 0 2.75-4.5 5.75-4.5 2.75 0 3.25-1.25 5-4', key: 'curve' }],
])

export const PrecisionIcon = createLucideIcon('AtlasPrecision', [
  ['path', { ...outline, d: 'M9.25 4.5h-2A2.75 2.75 0 0 0 4.5 7.25v2 M14.75 4.5h2a2.75 2.75 0 0 1 2.75 2.75v2 M19.5 14.75v2a2.75 2.75 0 0 1-2.75 2.75h-2 M9.25 19.5h-2a2.75 2.75 0 0 1-2.75-2.75v-2', key: 'frame' }],
  ['circle', { ...ink, cx: '12', cy: '12', r: '2.25', key: 'point' }],
])
