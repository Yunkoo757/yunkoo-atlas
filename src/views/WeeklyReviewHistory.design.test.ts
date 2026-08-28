import { readFileSync } from 'node:fs'
import path from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function weeklyCss(): string {
  return readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8').replace(/\r\n?/g, '\n')
}

function ruleBlock(css: string, selector: string): string {
  const start = css.indexOf(selector)
  assert(start >= 0, `缺少选择器 ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(start, close + 1)
}

export function testWeeklyHistoryRailUsesReadableDesktopWidth(): void {
  const shell = ruleBlock(weeklyCss(), '.wr-shell {')
  assert(
    /grid-template-columns:\s*minmax\(200px,\s*220px\)\s+minmax\(0,\s*1fr\)/.test(shell),
    '周复盘左栏桌面宽度必须约 220px，并保留可用最小宽度',
  )
  assert(!/grid-template-columns:\s*148px/.test(weeklyCss()), '左栏不得再使用 148px 固定列')
}

export function testWeeklyHistoryItemsDoNotWrapDateOrStatus(): void {
  const css = weeklyCss()
  assert(css.includes('.wr-history-week'), '周标识必须有独立 class')
  assert(css.includes('.wr-history-stage'), '阶段名必须有独立 class')
  assert(
    /white-space:\s*nowrap/.test(ruleBlock(css, '.wr-history-week')),
    '周标识/日期不得逐字换行',
  )
  assert(
    /white-space:\s*nowrap/.test(ruleBlock(css, '.wr-history-stage')) ||
      /white-space:\s*nowrap/.test(ruleBlock(css, '.wr-history-state')),
    '阶段名或短状态必须禁止逐字换行',
  )
}

export function testWeeklyHistoryActiveStateIsLightweight(): void {
  const active = ruleBlock(weeklyCss(), '.wr-history button.is-active')
  assert(active.includes('var(--bg-selected)'), '当前周必须使用轻量选中底色')
  assert(!/border:\s*[1-9]/.test(active), '当前周不得使用额外厚边框')
}

export function testWeeklyHistoryThisWeekLabelIsCurrentStageOnly(): void {
  const source = readFileSync(path.resolve('src/views/WeeklyReviewView.tsx'), 'utf8')
  assert(
    source.includes('weekLabel(item.week, currentWeek, item.liveStageId === currentLiveStageId)'),
    '只有当前实盘阶段的当前周才能显示本周',
  )
}

export function testOpeningHistoricalReviewDoesNotRescopeTheHistoryRail(): void {
  const source = readFileSync(path.resolve('src/views/WeeklyReviewView.tsx'), 'utf8')
  assert(
    source.includes("const selectedReviewStage = workspaceQuery.stage === 'current'"),
    '周复盘历史栏必须由显式阶段筛选决定范围',
  )
  assert(
    !source.includes("requestedContextReview?.liveStageId"),
    '打开历史复盘详情不得反向切换阶段并重算左侧列表',
  )
}

export function testWeeklyHistoryAndHeadUseTypeTokens(): void {
  const css = weeklyCss()
  const history = [
    ruleBlock(css, '.wr-history-title'),
    ruleBlock(css, '.wr-history button {'),
    ruleBlock(css, '.wr-page-head h1'),
    ruleBlock(css, '.wr-section-head h2'),
  ].join('\n')
  assert(!history.includes('--fs-sm'), '周复盘左栏和页头不得混用 --fs-sm')
  assert(!history.includes('--fs-mini') || history.includes('--type-metadata'), '描述级文字应落到 type token')
  assert(history.includes('--type-page-title-size') || weeklyCss().includes('--type-page-title-size'), '页头必须使用页面标题 token')
}
