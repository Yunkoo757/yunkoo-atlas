import { readFileSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { resolveTodayPrimaryAction, todayHeadingForTab } from '@/views/TodayWorkspace'

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8').replace(/\r\n?/g, '\n')
}

function rule(source: string, selector: string): string {
  return source.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'))?.[1] ?? ''
}

function assertRuleDeclaration(source: string, selector: string, property: string, expected: string, message: string): void {
  const actual = rule(source, selector).match(new RegExp(`${property}\\s*:\\s*([^;\\n]+)`))?.[1]?.trim()
  assert.equal(actual, expected, message)
}

export function testTodayHeadingFollowsActiveQueue(): void {
  const counts = { all: 10, open: 3, results: 1, review: 6 }
  assert.equal(todayHeadingForTab('all', counts), '还有 10 项需要处理')
  assert.equal(todayHeadingForTab('review', counts), '6 项待复盘')
  assert.equal(todayHeadingForTab('results', counts), '1 项等待结果')
  assert.equal(todayHeadingForTab('open', counts), '3 项进行中')
}

export function testTodayPrimaryActionFollowsWorkflowPriority(): void {
  assert.deepEqual(
    resolveTodayPrimaryAction({ active: 3, resultPending: 1, reviewPending: 6 }),
    { kind: 'resultPending', label: '补齐交易结果' },
    '待补结果必须优先于复盘和进行中交易',
  )
  assert.deepEqual(
    resolveTodayPrimaryAction({ active: 3, resultPending: 0, reviewPending: 6 }),
    { kind: 'reviewPending', label: '完成交易复盘' },
    '待复盘必须优先于进行中交易',
  )
  assert.deepEqual(
    resolveTodayPrimaryAction({ active: 3, resultPending: 0, reviewPending: 0 }),
    { kind: 'active', label: '继续当前交易' },
    '没有结果和复盘任务时必须继续进行中的交易',
  )
  assert.deepEqual(
    resolveTodayPrimaryAction({ active: 0, resultPending: 0, reviewPending: 0 }),
    { kind: 'create', label: '新建交易' },
    '没有交易待办时必须引导新建交易',
  )
}

export function testTodayQueueShowsRiskAndColumnContextBeforeRows(): void {
  const workspace = read('src/views/TodayWorkspace.tsx')
  const riskIndex = workspace.indexOf('<RiskStatusStrip')
  const queueIndex = workspace.indexOf('<section className="today-action-queue"')
  assert.ok(riskIndex > 0 && riskIndex < queueIndex, '风险摘要必须出现在行动队列之前')
  assert.ok(workspace.includes('<TradeListColumns'), '今日队列必须共享交易日志列标题')
}

export function testTodayWorkspaceKeepsReadableControlsAndType(): void {
  const today = read('src/views/TodayWorkspace.css')
  const workspace = read('src/views/TodayWorkspace.tsx')
  const button = read('src/components/ui/Button.css')
  const sharedButtonRule = button.match(/\.ui-btn,\s*\n[\s\S]*?\{([\s\S]*?)\n\}/m)?.[1] ?? ''

  if (!workspace.includes('<RiskStatusStrip')) {
    throw new Error('today workspace must retain the compact risk status strip')
  }

  assertRuleDeclaration(today, '\\.today-queue-tabs button', 'min-height', '32px', 'today queue tabs must keep the 32px regular-control contract')
  assertRuleDeclaration(today, '\\.today-queue-tabs button', 'font-size', 'var(--type-row-size)', 'today queue tabs must use the 13px Row role')
  assertRuleDeclaration(today, '\\.today-queue-tabs button', 'line-height', 'var(--type-row-line-height)', 'today queue tabs must use the 20px Row line height')
  assert.ok(workspace.includes('size="lg"'), 'today primary action must consume the shared 36px control size')
  assertRuleDeclaration(button, '\\.ui-btn-lg', 'height', 'var(--control-height-lg)', 'shared large button must keep the 36px control contract')
  assert.ok(sharedButtonRule.includes('font-size: var(--type-row-size)'), 'shared button must use the 13px Row role')
  assert.ok(sharedButtonRule.includes('line-height: var(--type-row-line-height)'), 'shared button must use the 20px Row line height')
  assertRuleDeclaration(today, '\\.today-stats-link', 'min-height', '32px', 'today stats link must keep the 32px actionable-control contract')
  assertRuleDeclaration(today, '\\.today-stats-link', 'font-size', 'var(--type-row-size)', 'today stats link must use the 13px Row role')
  assertRuleDeclaration(today, '\\.today-stats-link', 'line-height', 'var(--type-row-line-height)', 'today stats link must use the 20px Row line height')
  assertRuleDeclaration(today, '\\.today-stats-sub', 'font-size', 'var(--type-metadata-size)', 'today stats description must use the 12px Metadata role')
  assertRuleDeclaration(today, '\\.today-stats-sub', 'line-height', 'var(--type-metadata-line-height)', 'today stats description must use the 18px Metadata line height')
  assertRuleDeclaration(today, '\\.today-stats-title', 'font-size', 'var(--type-section-title-size)', 'today stats title must use the approved Section title role')
  assertRuleDeclaration(today, '\\.today-stats-title', 'font-weight', 'var(--font-weight-semibold)', 'today stats title must keep the semibold title hierarchy')
  if (today.includes('var(--type-caption-size)')) {
    throw new Error('today workspace core styles must not consume the 11px caption token')
  }
}

export function testTodayWorkspaceRejectsUnsupportedPhoneAndTouchBranches(): void {
  const today = read('src/views/TodayWorkspace.css')
  if (/@media[^\{]*max-width:\s*(?:[1-8]\d\d|899)px/.test(today)) {
    throw new Error('today workspace must not maintain unsupported phone-width branches')
  }
  if (/pointer:\s*coarse|hover:\s*none/.test(today)) {
    throw new Error('today workspace must not maintain touch-product branches')
  }
}

export function testTodayWorkspaceUsesAccessibleAccentAndSidebarLabelColors(): void {
  const sidebar = read('src/components/Sidebar.css')
  const tokens = read('src/styles/tokens.css')
  const weeklyReview = read('src/views/WeeklyReviewView.css')
  const sidebarLabel = rule(sidebar, '\\.sb-section-label')

  if (!sidebarLabel.includes('color: var(--sb-text)')) {
    throw new Error('sidebar section labels must use the full sidebar text token')
  }
  if (sidebarLabel.includes('color-mix')) {
    throw new Error('sidebar section labels must not lower contrast with transparent color mixing')
  }
  if (!tokens.includes('--accent: #5e6ad2')) {
    throw new Error('the Atlas accent must remain #5e6ad2')
  }
  if (!tokens.includes('--accent-text: #fff')) {
    throw new Error('accent text must be white for AA button contrast')
  }
  if (!tokens.includes('--accent-hover: color-mix(in srgb, var(--accent) 90%, black 10%)')) {
    throw new Error('accent hover must darken the original accent instead of mixing with white')
  }
  if (!tokens.includes('--accent-readable: color-mix(in srgb, var(--accent) 84%, white 16%)')) {
    throw new Error('small accent text must have a dedicated AA-readable token')
  }
  if (!weeklyReview.includes('.wr-trade-main:hover .wr-symbol { color: var(--accent-readable); }')) {
    throw new Error('weekly review hover text must use the readable accent text token')
  }
}

export function testTodayWorkspaceKeepsCompletedSectionSeparated(): void {
  const today = read('src/views/TodayWorkspace.css')

  if (!rule(today, '\\.today-completed').includes('margin-top:')) {
    throw new Error('today completed section must keep explicit top spacing')
  }
}

export function testTodayWorkspaceUsesDividersInsteadOfNestedDefaultSurfaces(): void {
  const today = read('src/views/TodayWorkspace.css')

  if (!rule(today, '\\.today-workflow-list').includes('border-top: 1px solid var(--border-subtle)')) {
    throw new Error('today action rows must stay organized by divider lines')
  }
}
