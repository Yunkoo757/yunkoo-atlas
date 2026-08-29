import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(file: string): string {
  return readFileSync(path.resolve(file), 'utf8').replace(/\r\n?/g, '\n')
}

function compactDesktopBlock(css: string, file: string): string {
  const marker = '@media (max-width: 1099px)'
  const start = css.indexOf(marker)
  if (start < 0) throw new Error(`${file} 必须提供 960–1099px 紧凑桌面布局`)
  return css.slice(start)
}

export function testCompactDesktopLayoutsRemainReadable(): void {
  const weekly = compactDesktopBlock(read('src/views/WeeklyReviewView.css'), 'WeeklyReviewView.css')
  const settings = compactDesktopBlock(read('src/views/settings/SettingsLayout.css'), 'SettingsLayout.css')

  if (!weekly.includes('.wr-page-head-inner')) {
    throw new Error('周复盘页头必须提供紧凑桌面布局')
  }
  if (!settings.includes('width: 164px')) {
    throw new Error('设置导航在紧凑桌面宽度下必须收窄至 164px')
  }
}

export function testWeeklyTabsDoNotWrapOnCompactDesktop(): void {
  const css = read('src/views/WeeklyReviewView.css')
  if (!/\.wr-tab-switch button\s*\{[^}]*white-space:\s*nowrap/s.test(css)) {
    throw new Error('周复盘切换标签不得换行')
  }
}
