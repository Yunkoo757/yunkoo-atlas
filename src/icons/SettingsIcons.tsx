import { createLucideIcon } from 'lucide-react'

const outline = { strokeWidth: 'var(--icon-stroke-width)' }
const ink = { fill: 'currentColor', stroke: 'none' }

export const ProfileNavIcon = createLucideIcon('AtlasProfile', [
  ['circle', { ...outline, cx: '12', cy: '12', r: '8.25', key: 'frame' }],
  ['circle', { ...ink, cx: '12', cy: '9.25', r: '2.5', key: 'head' }],
  ['path', { ...outline, d: 'M6.5 17.75a6.1 6.1 0 0 1 11 0', key: 'shoulders' }],
])

export const ShortcutsNavIcon = createLucideIcon('AtlasShortcuts', [
  ['rect', { ...outline, x: '2.75', y: '5.75', width: '18.5', height: '12.5', rx: '2.75', key: 'board' }],
  ['path', { ...outline, d: 'M6.75 10h.5 M11.75 10h.5 M16.75 10h.5 M8.5 14.25h7', key: 'keys' }],
])

export const StrategiesNavIcon = createLucideIcon('AtlasStrategies', [
  ['path', { ...outline, d: 'M6.75 16.75V7.5 M6.75 15.5c0-5.5 9.5-2.5 9.5-8', key: 'branches' }],
  ['circle', { ...outline, cx: '6.75', cy: '5.5', r: '2', key: 'first' }],
  ['circle', { ...outline, cx: '16.25', cy: '5.5', r: '2', key: 'second' }],
  ['circle', { ...ink, cx: '6.75', cy: '18.25', r: '2.5', key: 'origin' }],
])

export const RiskNavIcon = createLucideIcon('AtlasRisk', [
  ['path', { ...outline, d: 'M5.75 18a8.25 8.25 0 1 1 12.5 0', key: 'dial' }],
  ['path', { ...outline, d: 'm11.5 14.25 3.75-4.5', key: 'needle' }],
])

export const TagsNavIcon = createLucideIcon('AtlasTags', [
  ['path', { ...outline, d: 'M4 5.75A1.75 1.75 0 0 1 5.75 4h5.75c.9 0 1.6.35 2.25 1L20 11.25a2.25 2.25 0 0 1 0 3.2L14.45 20a2.25 2.25 0 0 1-3.2 0L5 13.75c-.65-.65-1-1.35-1-2.25Z', key: 'tag' }],
  ['circle', { ...ink, cx: '8.5', cy: '8.5', r: '1.5', key: 'eye' }],
])

export const SymbolsNavIcon = createLucideIcon('AtlasSymbols', [
  ['path', { ...outline, d: 'M7.5 4v4 M7.5 15.75v4.5 M16.5 3.75v2.5 M16.5 13.75V19', key: 'wicks' }],
  ['rect', { ...outline, x: '5', y: '8', width: '5', height: '7.75', rx: '1', key: 'hollow' }],
  ['rect', { ...ink, x: '13.5', y: '6.25', width: '6', height: '7.5', rx: '1.25', key: 'filled' }],
])

export const ReviewTemplatesNavIcon = createLucideIcon('AtlasReviewTemplates', [
  ['rect', { ...outline, x: '4.5', y: '3.75', width: '15', height: '16.5', rx: '2.5', key: 'sheet' }],
  ['rect', { ...ink, x: '8', y: '7.25', width: '7.75', height: '2.5', rx: '1', key: 'heading' }],
  ['path', { ...outline, d: 'M8 13.25h8 M8 16.75h4.25', key: 'prompts' }],
])

export const DisplayNavIcon = createLucideIcon('AtlasDisplay', [
  ['rect', { ...outline, x: '3.25', y: '4.5', width: '17.5', height: '12.75', rx: '2.5', key: 'screen' }],
  ['path', { ...outline, d: 'M12 17.25v3 M8.5 20.25h7', key: 'stand' }],
])

export const DataNavIcon = createLucideIcon('AtlasData', [
  ['ellipse', { ...outline, cx: '12', cy: '6.75', rx: '7.75', ry: '3', key: 'top' }],
  ['path', { ...outline, d: 'M4.25 6.75v10.5c0 1.65 3.45 3 7.75 3s7.75-1.35 7.75-3V6.75 M4.25 12c0 1.65 3.45 3 7.75 3s7.75-1.35 7.75-3', key: 'stack' }],
])

export const UpdatesNavIcon = createLucideIcon('AtlasUpdates', [
  ['path', { ...outline, d: 'M12 3.75v10.5 M7.75 10.25 12 14.5l4.25-4.25 M3.75 15v2.25a2.5 2.5 0 0 0 2.5 2.5h11.5a2.5 2.5 0 0 0 2.5-2.5V15', key: 'download' }],
])
