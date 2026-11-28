import { readFileSync } from 'node:fs'
import path from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testYearTrendUsesAnnualSemanticsAndCompactEmptyState(): void {
  const source = readFileSync(path.resolve('src/views/WeeklyReviewView.tsx'), 'utf8')

  assert(source.includes('<h1>年度趋势</h1>'), '年度页必须使用年度语义主标题')
  assert(source.includes('className="wr-year-empty"'), '无已完成复盘时必须收敛为单一空状态')
  assert(source.includes('if (completed.length === 0)'), '年度空状态必须阻止空 KPI 与空热力图继续渲染')
}

export function testYearRhythmKeepsTheAnnualGridLayout(): void {
  const css = readFileSync(path.resolve('src/views/WeeklyReviewView.css'), 'utf8')

  assert(css.includes('repeat(var(--week-count), minmax(8px, 1fr))'), '全年节奏应沿单行周序列展开')
}
