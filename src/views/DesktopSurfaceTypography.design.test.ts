import { readFileSync } from 'node:fs'
import path from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const SURFACES = [
  { file: 'src/views/WeeklyReviewView.css', selectors: ['.wr-history-title', '.wr-history-week', '.wr-history-stage', '.wr-page-head h1', '.wr-section-head h2', '.wr-progress-summary'] },
  { file: 'src/views/LiveArchiveView.css', selectors: ['.live-archive-stage-rail button', '.live-archive-tab-list button', '.live-archive-panel > header h2', '.live-archive-panel > header span'] },
  { file: 'src/views/ReviewSessionView.css', selectors: ['.review-session-settings-sources strong', '.review-session-settings-sources small', '.review-session-settings-count', '.review-session-intro h1'] },
  { file: 'src/views/settings/SettingsLayout.css', selectors: ['.settings-page-title', '.settings-section-title', '.settings-page-desc', '.settings-nav-item'] },
] as const

function blockFor(css: string, selector: string): string {
  const index = css.indexOf(selector)
  assert(index >= 0, `${selector} 缺少样式块`)
  const open = css.indexOf('{', index)
  const close = css.indexOf('}', open)
  return css.slice(index, close + 1)
}

export function testRelatedDesktopSurfacesUseFourTypeLevels(): void {
  for (const surface of SURFACES) {
    const css = readFileSync(path.resolve(surface.file), 'utf8').replace(/\r\n?/g, '\n')
    for (const selector of surface.selectors) {
      const block = blockFor(css, selector)
      assert(!/--fs-sm|--fs-mini|--fs-micro|--fs-xs/.test(block), `${surface.file} ${selector} 不得混用 --fs-*`)
      assert(!/font-size:\s*\d+px/.test(block), `${surface.file} ${selector} 不得使用裸字号`)
    }
  }
}

export function testRelatedDesktopNumbersStayTabular(): void {
  const weekly = readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8')
  const archive = readFileSync(path.resolve('src/views/LiveArchiveView.css'), 'utf8')
  assert(weekly.includes('var(--numeric-tabular)'), '周复盘数据数字必须保持等宽数字')
  assert(archive.includes('tabular-nums') || archive.includes('var(--numeric-tabular)'), '历史实盘数据数字必须保持等宽数字')
}
