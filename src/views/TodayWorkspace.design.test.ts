import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8').replace(/\r\n?/g, '\n')
}

function rule(source: string, selector: string): string {
  return source.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'))?.[1] ?? ''
}

export function testTodayWorkspaceKeepsReadableControlsAndType(): void {
  const today = read('src/views/TodayWorkspace.css')

  if (!rule(today, '\\.today-queue-tabs button').includes('min-height: 32px')) {
    throw new Error('today queue tabs must keep the 32px regular-control contract')
  }
  if (!rule(today, '\\.today-focus \\.empty-btn').includes('min-height: 36px')) {
    throw new Error('today primary action must keep the 36px control contract')
  }
  if (!rule(today, '\\.today-queue-tabs button').includes('font-size: 13px')) {
    throw new Error('today queue controls must keep 13px core text')
  }
  if (!rule(today, '\\.today-stats-link').includes('font-size: var(--type-row-size)')) {
    throw new Error('today stats link must keep 13px actionable text')
  }
  if (today.includes('var(--type-caption-size)')) {
    throw new Error('today workspace core styles must not consume the 11px caption token')
  }
}

export function testTodayWorkspaceKeepsMobileQueueAndPrimaryActionSafe(): void {
  const today = read('src/views/TodayWorkspace.css')
  const tabletStart = today.indexOf('@media (max-width: 899px)')
  const mobileStart = today.indexOf('@media (max-width: 768px)')
  const tablet = tabletStart === -1 || mobileStart === -1 ? '' : today.slice(tabletStart, mobileStart)
  const mobile = mobileStart === -1 ? '' : today.slice(mobileStart)
  const mobilePrimaryAction = rule(mobile, '\\.today-focus \\.empty-btn')

  if (!tablet.includes('.today-queue-tabs') || !tablet.includes('overflow-x: auto')) {
    throw new Error('today queue tabs must scroll horizontally below 899px instead of compressing into three columns')
  }
  if (!mobilePrimaryAction.includes('min-height: 44px')) {
    throw new Error('today primary action must reach 44px on mobile')
  }
  if (!mobile.includes('overflow-x: hidden')) {
    throw new Error('today workspace must prevent horizontal overflow below 768px')
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
