import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, cpus } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { createAnalyticsSnapshot, ANALYTICS_FIXTURE_SEED } from './fixtures/analytics-trades.mjs'

// Compile the actual production modules, including their transitive dependencies.
// No copied analytics implementation, real library, renderer, or disk persistence is measured.
const root = process.cwd()
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index < 0 ? undefined : args[index + 1]
}

async function removeTemporary(temporary, prefix) {
  assert(path.dirname(temporary) === path.resolve(tmpdir()) && path.basename(temporary).startsWith(prefix))
  await rm(temporary, { recursive: true, force: true })
}

async function compileProduction() {
  const temporary = await mkdtemp(path.join(tmpdir(), 'atlas-dashboard-production-'))
  const nodeEnv = process.env.NODE_ENV
  try {
    const entry = path.join(temporary, 'entry.ts')
    await writeFile(entry, "export { buildDashboardStats } from '@/lib/dashboardStats'\nexport { summarizeTradeResults, resolveTradeTruth } from '@/lib/tradeTruth'\n", 'utf8')
    const bundle = await build({
      root,
      configFile: false,
      logLevel: 'error',
      resolve: { alias: { '@': path.join(root, 'src') } },
      build: {
        ssr: entry,
        write: false,
        minify: false,
        rolldownOptions: { output: { entryFileNames: 'production.mjs' } },
      },
    })
    const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap((item) => item.output)
    const chunk = output.find((item) => item.type === 'chunk' && item.isEntry)
    assert(chunk && output.filter((item) => item.type === 'chunk').length === 1, 'expected one self-contained production bundle')
    return chunk.code
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = nodeEnv
    await removeTemporary(temporary, 'atlas-dashboard-production-')
  }
}

function percentile(values, ratio) {
  return values[Math.ceil(values.length * ratio) - 1]
}

function timing(raw) {
  const sorted = [...raw].sort((left, right) => left - right)
  const round = (value) => Math.round(value * 1_000) / 1_000
  return { medianMs: round(percentile(sorted, 0.5)), p95Ms: round(percentile(sorted, 0.95)), rawMs: raw.map(round) }
}

function measurePair(current, baseline, warmups, runs) {
  for (let index = 0; index < warmups; index += 1) {
    current()
    baseline?.()
  }
  const currentTimes = []
  const baselineTimes = []
  const measure = (operation, samples) => {
    const start = performance.now()
    operation()
    samples.push(performance.now() - start)
  }
  for (let index = 0; index < runs; index += 1) {
    // Alternate order so gradual CPU/GC drift does not always favor one version.
    if (baseline && index % 2 === 0) measure(baseline, baselineTimes)
    measure(current, currentTimes)
    if (baseline && index % 2 === 1) measure(baseline, baselineTimes)
  }
  return { current: timing(currentTimes), ...(baseline ? { baseline: timing(baselineTimes) } : {}) }
}

function verifyEdgeCases(current, baseline) {
  const snapshot = createAnalyticsSnapshot({ count: 1_000, seed: ANALYTICS_FIXTURE_SEED, noteProfile: 'short' })
  const statuses = ['planned', 'open', 'missed', 'win', 'loss', 'breakeven']
  const sources = [undefined, 'pnl', 'r', 'price', 'imported', 'invalid']
  const values = [null, -3, -0, 2, Number.NaN, Number.POSITIVE_INFINITY]
  let truthCases = 0
  for (const status of statuses) {
    for (const resultSource of sources) {
      for (const pnl of values) {
        for (const rMultiple of values) {
          const trade = { ...snapshot.trades[0], status, resultSource, pnl, rMultiple }
          assert.deepStrictEqual(current.resolveTradeTruth(trade), baseline.resolveTradeTruth(trade))
          truthCases += 1
        }
      }
    }
  }
  const trades = snapshot.trades.map((trade, index) => ({
    ...trade,
    id: `duplicate-${index % 777}`,
    status: statuses[index % statuses.length],
    pnl: values[index % values.length],
    rMultiple: values[Math.floor(index / 3) % values.length],
    resultSource: sources[Math.floor(index / 11) % sources.length],
    closedAt: index % 3 ? trade.closedAt : null,
    closedTradingDayKey: [undefined, '2026-02-30', '2026-09-24', 'invalid'][index % 4],
  }))
  const ids = trades.map((trade) => trade.id).reverse()
  assert.deepStrictEqual(current.summarizeTradeResults(trades), baseline.summarizeTradeResults(trades))
  for (const selected of [undefined, [], ids, ['missing', ...ids.slice(0, 500)]]) {
    for (const usdIds of [[], ids, ids.slice(0, 400)]) {
      const input = [trades, snapshot.strategies, selected, 6, usdIds]
      assert.deepStrictEqual(current.buildDashboardStats(...input), baseline.buildDashboardStats(...input))
    }
  }
  return { truthCases, mixedDashboardCases: 12 }
}

const code = await compileProduction()
const capturePath = option('--capture-baseline')
if (capturePath) {
  await writeFile(path.resolve(capturePath), code, 'utf8')
  process.stdout.write(`${JSON.stringify({ captured: path.resolve(capturePath), sha256: sha256(code) })}\n`)
} else {
  const temporary = await mkdtemp(path.join(tmpdir(), 'atlas-dashboard-measure-'))
  try {
    const currentPath = path.join(temporary, 'current.mjs')
    await writeFile(currentPath, code, 'utf8')
    const current = await import(pathToFileURL(currentPath).href)
    const baselinePath = option('--baseline')
    const baseline = baselinePath ? await import(pathToFileURL(path.resolve(baselinePath)).href) : null
    const edgeCaseEquivalence = baseline ? verifyEdgeCases(current, baseline) : null
    const smoke = args.includes('--smoke')
    const warmups = smoke ? 2 : 10
    const runs = smoke ? 3 : 50
    const fixtures = []
    for (const count of [1_000, 10_000, 50_000]) {
      const snapshot = createAnalyticsSnapshot({ count, seed: ANALYTICS_FIXTURE_SEED, noteProfile: 'short' })
      const trades = snapshot.trades.filter((trade) => !trade.deletedAt && ['win', 'loss', 'breakeven'].includes(trade.status))
      const ids = trades.map((trade) => trade.id)
      const input = [trades, snapshot.strategies, ids, 6, ids]
      const stats = current.buildDashboardStats(...input)
      if (baseline) {
        assert.deepStrictEqual(stats, baseline.buildDashboardStats(...input), `dashboard result differs at ${count}`)
        assert.deepStrictEqual(current.summarizeTradeResults(snapshot.trades), baseline.summarizeTradeResults(snapshot.trades))
      }
      fixtures.push({
        generatedCount: count,
        closedCount: trades.length,
        seed: ANALYTICS_FIXTURE_SEED,
        inputSha256: sha256(JSON.stringify(input)),
        resultSha256: sha256(JSON.stringify(stats)),
        dashboard: measurePair(() => current.buildDashboardStats(...input), baseline && (() => baseline.buildDashboardStats(...input)), warmups, runs),
        summary: measurePair(() => current.summarizeTradeResults(snapshot.trades), baseline && (() => baseline.summarizeTradeResults(snapshot.trades)), warmups, runs),
      })
    }
    const report = {
      generatedAt: new Date().toISOString(),
      machine: { platform: process.platform, arch: process.arch, node: process.version, cpu: cpus()[0]?.model, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      boundary: 'Actual src/lib/dashboardStats.ts and src/lib/tradeTruth.ts compiled by Vite SSR; synchronous computation only; explicit eligible metric/USD IDs; excludes selection, renderer, IPC, real data and persistence',
      productionBundleSha256: sha256(code),
      baselineBundleSha256: baselinePath ? sha256(await readFile(path.resolve(baselinePath))) : null,
      warmups, runs, fixtureSource: 'scripts/fixtures/analytics-trades.mjs',
      equivalenceChecked: Boolean(baseline),
      edgeCaseEquivalence,
      fixtures,
    }
    const json = `${JSON.stringify(report, null, 2)}\n`
    const outputPath = option('--output')
    if (outputPath) await writeFile(path.resolve(outputPath), json, 'utf8')
    process.stdout.write(json)
  } finally {
    await removeTemporary(temporary, 'atlas-dashboard-measure-')
  }
}
