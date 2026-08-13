export const DESKTOP_VISUAL_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 960, height: 640 }),
  Object.freeze({ width: 1280, height: 860 }),
  Object.freeze({ width: 1440, height: 900 }),
  Object.freeze({ width: 1600, height: 1000 }),
  Object.freeze({ width: 1920, height: 1080 }),
])

export const DESKTOP_VISUAL_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'today', path: '/today-record', ready: '.today-workspace-inner' }),
  Object.freeze({ id: 'trades', path: '/list', ready: '.trade-list' }),
  Object.freeze({ id: 'detail', path: '/trade/TRD-131', ready: '.trade-detail-layout' }),
  Object.freeze({ id: 'dashboard', path: '/dashboard', ready: '.db-scroll' }),
  Object.freeze({ id: 'weekly', path: '/weekly-review', ready: '.wr-shell' }),
  Object.freeze({ id: 'review-session', path: '/review-session', ready: '.review-session-view' }),
  Object.freeze({ id: 'settings-data', path: '/settings/data', ready: '.settings-layout' }),
])
