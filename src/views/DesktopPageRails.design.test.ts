import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8').replace(/\r\n?/g, '\n')
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testSettingsPagesOwnOneCenteredContentRail(): void {
  const css = read('src/views/settings/SettingsLayout.css')
  assert(
    css.includes('--settings-content-width: var(--page-rail-form)'),
    '设置页必须消费语义化表单内容轨道',
  )
  assert(css.includes('.settings-aside'), '设置页必须为解释或预览保留可选辅助轨道')
  assert(css.includes('margin: 0 auto'), '设置内容必须在宽桌面窗口中保持居中')
  assert(!css.includes('safe-area-inset'), '桌面设置页不得保留手机安全区布局')
}

export function testCoreDesktopPagesConsumeSemanticRails(): void {
  const contracts = [
    ['src/views/Dashboard.css', '--page-rail-wide'],
    ['src/views/TodayWorkspace.css', '--page-rail-standard'],
    ['src/views/WeeklyReviewView.css', '--page-rail-reading'],
    ['src/views/DetailView.css', '--page-rail-standard'],
    ['src/views/settings/SettingsLayout.css', '--page-rail-form'],
  ] as const
  for (const [file, token] of contracts) {
    const css = read(file)
    assert(css.includes(`var(${token})`), `${file} 必须消费 ${token}`)
  }
}

export function testReviewWorkspaceUsesContentDrivenReadingHeight(): void {
  const view = read('src/views/ReviewSessionView.tsx')
  const css = read('src/views/ReviewSessionView.css')
  assert(view.includes('review-session-reading'), '复盘正文必须拥有独立阅读区')
  assert(css.includes('width: min(1080px, 100%)'), '活动复盘工作面不得超过 1080px')
  assert(css.includes('.review-session-reading'), '阅读区必须拥有内容高度与长文滚动契约')
  assert(!css.includes('width: min(1180px, 100%)'), '不得恢复过宽的活动复盘工作面')
}

export function testSettingsOperationRowsDoNotUseDecorativePrimaryCards(): void {
  const data = read('src/components/DataIOContent.css')
  assert(
    data.includes('.dio-task-primary { background: transparent; }'),
    '设置操作行不得用整行品牌底色伪装成等权卡片',
  )
}
