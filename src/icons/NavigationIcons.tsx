import { createLucideIcon } from 'lucide-react'

// Drawn for the 16px navigation rail on the same 24-unit grid as utility icons.
const outline = { strokeWidth: 'var(--icon-stroke-width)' }
const ink = { fill: 'currentColor', stroke: 'none' }

export const JournalNavIcon = createLucideIcon('AtlasJournal', [
  ['rect', { ...outline, x: '4.5', y: '3.75', width: '15', height: '16.5', rx: '2.6', key: 'cover' }],
  ['path', { ...outline, d: 'M8.5 4.5v15 M12 9h4.25 M12 13h2.5', key: 'ledger' }],
])

export const AnalyticsNavIcon = createLucideIcon('AtlasAnalytics', [
  ['rect', { ...ink, x: '4', y: '11', width: '3.75', height: '8', rx: '1.25', key: 'first' }],
  ['rect', { ...ink, x: '10', y: '4.5', width: '3.75', height: '14.5', rx: '1.25', key: 'second' }],
  ['rect', { ...ink, x: '16', y: '8', width: '3.75', height: '11', rx: '1.25', key: 'third' }],
])

export const PeriodReviewNavIcon = createLucideIcon('AtlasPeriodReview', [
  ['rect', { ...outline, x: '3.75', y: '5.75', width: '16.5', height: '14.5', rx: '3', key: 'page' }],
  ['path', { ...outline, d: 'M8 3.5v4.75 M16 3.5v4.75', key: 'binding' }],
  ['rect', { ...ink, x: '7.5', y: '12.25', width: '8.75', height: '3', rx: '1.4', key: 'period' }],
])

export const CaseLibraryNavIcon = createLucideIcon('AtlasCaseLibrary', [
  ['path', { ...outline, d: 'M6 5.5h9.25a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 15V8A2.5 2.5 0 0 1 6 5.5Z M8.25 20.5H16a4.75 4.75 0 0 0 4.75-4.75V10', key: 'cards' }],
  ['path', { ...outline, d: 'M7 9.5h4', key: 'index' }],
])

export const PracticeNavIcon = createLucideIcon('AtlasPractice', [
  ['path', { ...outline, d: 'M3.5 5v5h5 M4 9.5a8.2 8.2 0 1 1 .75 7.25', key: 'replay' }],
  ['path', { ...ink, d: 'M10.75 9.5q0-.85.75-.4l4.1 2.45q.75.45 0 .9l-4.1 2.45q-.75.45-.75-.4Z', key: 'play' }],
])

export const NoteNavIcon = createLucideIcon('AtlasNote', [
  ['path', { ...outline, d: 'M6.75 3.75h10.5A2.5 2.5 0 0 1 19.75 6.25v7.5L13 20.25H6.75a2.5 2.5 0 0 1-2.5-2.5V6.25a2.5 2.5 0 0 1 2.5-2.5Z M13 20v-4a2.25 2.25 0 0 1 2.25-2.25h4', key: 'fold' }],
  ['path', { ...outline, d: 'M8 8.5h6.75', key: 'line' }],
])

export const BacktestNavIcon = createLucideIcon('AtlasBacktest', [
  ['path', { ...outline, d: 'M3.25 7a2.75 2.75 0 0 1 2.75-2.75h3.5l2.75 3h5.5A2.75 2.75 0 0 1 20.5 10v7A2.75 2.75 0 0 1 17.75 19.75H6A2.75 2.75 0 0 1 3.25 17Z', key: 'folder' }],
  ['path', { ...outline, d: 'm7.25 14.75 3.25-3 2.5 2 3.25-3', key: 'trace' }],
])
