import { existsSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const manifestPath = 'dist/.vite/manifest.json'

if (!existsSync(manifestPath)) {
  throw new Error('缺少生产构建 manifest，请先运行 pnpm build')
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

function staticChunkKeys(roots) {
  const visited = new Set()
  const pending = [...roots]
  while (pending.length > 0) {
    const key = pending.pop()
    if (!key || visited.has(key)) continue
    const chunk = manifest[key]
    if (!chunk) throw new Error(`构建 manifest 缺少入口：${key}`)
    visited.add(key)
    pending.push(...(chunk.imports ?? []))
  }
  return visited
}

function gzipJavaScriptBytes(roots) {
  const files = new Set(
    [...staticChunkKeys(roots)]
      .map((key) => manifest[key].file)
      .filter((file) => file.endsWith('.js')),
  )
  return [...files].reduce(
    (total, file) => total + gzipSync(readFileSync(`dist/${file}`), { level: 9 }).byteLength,
    0,
  )
}

const weeklyEntry = 'src/views/WeeklyReviewView.tsx'
const scoreChartEntry = 'src/views/WeeklyReviewScoreChart.tsx'
const weeklyChunk = manifest[weeklyEntry]
if (!weeklyChunk?.dynamicImports?.includes(scoreChartEntry)) {
  throw new Error('年度趋势图表必须保持按需加载，不能回到周复盘首屏')
}

const budgets = [
  { name: '交易日志首屏 JS', roots: ['index.html'], limit: 250_000 },
  { name: '本周复盘首屏 JS', roots: ['index.html', weeklyEntry], limit: 400_000 },
  { name: '年度趋势完整 JS', roots: ['index.html', weeklyEntry, scoreChartEntry], limit: 500_000 },
]

let failed = false
for (const budget of budgets) {
  const bytes = gzipJavaScriptBytes(budget.roots)
  const percent = Math.round((bytes / budget.limit) * 100)
  const result = bytes <= budget.limit ? 'PASS' : 'FAIL'
  console.log(`${result} ${budget.name}: ${(bytes / 1024).toFixed(1)} KB / ${(budget.limit / 1024).toFixed(1)} KB (${percent}%)`)
  failed ||= bytes > budget.limit
}

if (failed) process.exitCode = 1
