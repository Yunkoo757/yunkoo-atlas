import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { arch, cpus, hostname, platform, release, tmpdir, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'

import {
  ANALYTICS_FIXTURE_SEED,
  checksumFixture,
  createAnalyticsSnapshot,
  inspectAnalyticsFixture,
} from './fixtures/analytics-trades.mjs'

const CLOSED_STATUSES = new Set(['win', 'loss', 'breakeven'])
const ACCOUNT_KINDS = new Set(['live', 'paper'])

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function outcomeForMetric(value) {
  const metric = finite(value)
  if (metric === null) return null
  return metric > 0 ? 'win' : metric < 0 ? 'loss' : 'breakeven'
}

function resolveSource(trade) {
  if (['pnl', 'r', 'price', 'imported'].includes(trade.resultSource)) return trade.resultSource
  const hasPnl = finite(trade.pnl) !== null
  const hasR = finite(trade.rMultiple) !== null
  if (hasPnl && hasR) return 'imported'
  if (hasPnl) return 'pnl'
  if (hasR) return 'r'
  return undefined
}

function resolveOutcome(trade) {
  if (!CLOSED_STATUSES.has(trade.status)) return 'unknown'
  const pnlOutcome = outcomeForMetric(trade.pnl)
  const rOutcome = outcomeForMetric(trade.rMultiple)
  const source = resolveSource(trade)
  const metrics = (
    source === 'pnl'
      ? [pnlOutcome]
      : source === 'r' || source === 'price'
        ? [rOutcome]
        : source === 'imported' && pnlOutcome !== null && rOutcome !== null
          ? [pnlOutcome, rOutcome]
          : []
  ).filter(Boolean)
  const metricConflict = new Set(metrics).size > 1
  const resolved = metricConflict ? null : metrics[0] ?? null
  if (metricConflict || (resolved && resolved !== trade.status)) return 'conflict'
  return resolved ?? 'unknown'
}

function summarizeTradeResults(trades) {
  const closed = trades.filter((trade) => CLOSED_STATUSES.has(trade.status))
  const outcomes = closed.map(resolveOutcome)
  const verified = closed.filter((_, index) => ['win', 'loss', 'breakeven'].includes(outcomes[index]))
  const pnlValues = verified.map((trade) => finite(trade.pnl)).filter((value) => value !== null)
  const rValues = verified.map((trade) => finite(trade.rMultiple)).filter((value) => value !== null)
  const evaluated = outcomes.filter((outcome) => ['win', 'loss', 'breakeven'].includes(outcome))
  const winCount = evaluated.filter((outcome) => outcome === 'win').length
  return {
    closedCount: closed.length,
    evaluatedCount: evaluated.length,
    winCount,
    lossCount: evaluated.filter((outcome) => outcome === 'loss').length,
    breakevenCount: evaluated.filter((outcome) => outcome === 'breakeven').length,
    conflictCount: outcomes.filter((outcome) => outcome === 'conflict').length,
    winRate: evaluated.length ? (winCount / evaluated.length) * 100 : null,
    pnlCount: pnlValues.length,
    rCount: rValues.length,
    totalPnl: pnlValues.reduce((sum, value) => sum + value, 0),
    averageR: rValues.length
      ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length
      : null,
  }
}

export function selectCurrentDashboardTrades(
  trades,
  { kind = 'live', range = 'all', now = new Date() } = {},
) {
  let selected = trades.filter(
    (trade) =>
      !trade.deletedAt &&
      CLOSED_STATUSES.has(trade.status) &&
      (kind === 'all' ? ACCOUNT_KINDS.has(trade.tradeKind) : trade.tradeKind === kind),
  )
  if (range === 'all') return selected

  let cutoff
  if (range === 'this-month') {
    cutoff = new Date(now.getFullYear(), now.getMonth(), 1)
  } else if (range === 'ytd') {
    cutoff = new Date(now.getFullYear(), 0, 1)
  } else {
    cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - (range === '30d' ? 30 : 90))
  }
  selected = selected.filter((trade) => new Date(trade.closedAt ?? trade.openedAt) >= cutoff)
  return selected
}

/**
 * 冻结 Task 0 时 Dashboard.tsx 私有 buildStats 的等价计算边界。
 * 这里有意保留当前策略分组的数组扩展与 <-3R 漏桶，便于后续量化改进而非美化基线。
 */
export function buildCurrentDashboardStats(closed, strategyDefs) {
  const summary = summarizeTradeResults(closed)
  const verified = closed.filter((trade) => ['win', 'loss', 'breakeven'].includes(resolveOutcome(trade)))
  const pnlTrades = verified.filter((trade) => finite(trade.pnl) !== null)
  const rTrades = verified.filter((trade) => finite(trade.rMultiple) !== null)
  const sorted = [...pnlTrades].sort(
    (a, b) => +new Date(a.closedAt ?? a.openedAt) - +new Date(b.closedAt ?? b.openedAt),
  )
  let cumulative = 0
  const curve = sorted.map((trade) => {
    cumulative += trade.pnl
    return {
      date: (trade.closedAt ?? trade.openedAt).slice(5, 10),
      equity: cumulative,
      label: trade.symbol,
      tradeId: trade.id,
      ref: trade.ref,
      pnl: trade.pnl,
    }
  })

  const byStrategy = new Map()
  closed.forEach((trade) => {
    byStrategy.set(trade.strategyId, [...(byStrategy.get(trade.strategyId) ?? []), trade])
  })
  const strategyById = new Map(strategyDefs.map((strategy) => [strategy.id, strategy]))
  const strategies = [...byStrategy.entries()]
    .map(([id, strategyTrades]) => {
      const result = summarizeTradeResults(strategyTrades)
      return {
        id,
        pnl: result.totalPnl,
        n: result.evaluatedCount,
        closedCount: result.closedCount,
        wins: result.winCount,
        name: strategyById.get(id)?.name ?? id,
        winRate: result.winRate,
      }
    })
    .sort((a, b) => b.pnl - a.pnl)
  const maxAbs = Math.max(1, ...strategies.map((strategy) => Math.abs(strategy.pnl)))

  const rBuckets = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 5, 10]
  const rDist = rBuckets.map((lo, index) => {
    const hi = rBuckets[index + 1]
    return {
      label: hi ? `${lo}~${hi}` : `>${lo}`,
      n: hi
        ? rTrades.filter((trade) => trade.rMultiple >= lo && trade.rMultiple < hi).length
        : rTrades.filter((trade) => trade.rMultiple >= lo).length,
      lo,
    }
  })
  const bucketedRCount = rDist.reduce((sum, bucket) => sum + bucket.n, 0)

  return {
    ...summary,
    curve,
    strategies,
    maxAbs,
    rDist,
    rDistributionCountDelta: summary.rCount - bucketedRCount,
  }
}

function roundMs(value) {
  return Math.round(value * 1_000) / 1_000
}

export function summarizeTimings(rawMs) {
  if (!Array.isArray(rawMs) || rawMs.length === 0) {
    throw new TypeError('rawMs must contain at least one timing')
  }
  const sorted = [...rawMs].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]
  return {
    count: rawMs.length,
    minMs: roundMs(sorted[0]),
    medianMs: roundMs(median),
    p95Ms: roundMs(p95),
    maxMs: roundMs(sorted.at(-1)),
    rawMs: rawMs.map(roundMs),
  }
}

export function measureSync(operation, { warmups = 5, runs = 30 } = {}) {
  let lastValue
  const coldStartedAt = performance.now()
  lastValue = operation()
  const coldMs = roundMs(performance.now() - coldStartedAt)
  for (let index = 0; index < warmups; index += 1) lastValue = operation()
  const rawMs = []
  for (let index = 0; index < runs; index += 1) {
    const startedAt = performance.now()
    lastValue = operation()
    rawMs.push(performance.now() - startedAt)
  }
  return { coldMs, ...summarizeTimings(rawMs), lastValue }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function readPackage() {
  return JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

function productionBuildMetadata() {
  const indexPath = resolve('dist/index.html')
  if (!existsSync(indexPath)) return { present: false, indexPath }
  const source = readFileSync(indexPath)
  const stats = statSync(indexPath)
  return {
    present: true,
    indexPath,
    indexBytes: stats.size,
    indexSha256: sha256(source),
    modifiedAt: stats.mtime.toISOString(),
  }
}

function timingOnly(measurement) {
  const { lastValue: _lastValue, ...timing } = measurement
  return timing
}

function fixtureRecord(config) {
  const snapshot = createAnalyticsSnapshot(config)
  const json = JSON.stringify(snapshot)
  return {
    config,
    snapshot,
    json,
    metadata: {
      count: config.count,
      noteProfile: config.noteProfile,
      seed: config.seed,
      bytes: Buffer.byteLength(json, 'utf8'),
      checksum: checksumFixture(snapshot.trades),
      snapshotChecksum: checksumFixture(snapshot),
      coverage: inspectAnalyticsFixture(snapshot.trades),
    },
  }
}

export function runAnalyticsBenchmark({ smoke = false } = {}) {
  const warmups = smoke ? 1 : 5
  const runs = smoke ? 2 : 30
  const now = new Date('2026-07-15T00:00:00.000Z')
  const memoryBefore = process.memoryUsage()
  const fixtureConfigs = [
    { count: 1_000, seed: ANALYTICS_FIXTURE_SEED, noteProfile: 'short' },
    { count: 1_000, seed: ANALYTICS_FIXTURE_SEED, noteProfile: '2kb' },
    { count: 10_000, seed: ANALYTICS_FIXTURE_SEED, noteProfile: 'short' },
    { count: 10_000, seed: ANALYTICS_FIXTURE_SEED, noteProfile: '2kb' },
  ]
  const fixtures = fixtureConfigs.map(fixtureRecord)
  const fixture = (count, noteProfile) =>
    fixtures.find(
      (candidate) =>
        candidate.config.count === count && candidate.config.noteProfile === noteProfile,
    )
  const short1k = fixture(1_000, 'short')
  const dense1k = fixture(1_000, '2kb')
  const short10k = fixture(10_000, 'short')
  const dense10k = fixture(10_000, '2kb')
  if (!short1k || !dense1k || !short10k || !dense10k) {
    throw new Error('analytics fixture matrix is incomplete')
  }
  const strategies = short10k.snapshot.strategies
  const buildScope = (candidate, kind = 'live', range = 'all') =>
    buildCurrentDashboardStats(
      selectCurrentDashboardTrades(candidate.snapshot.trades, { kind, range, now }),
      strategies,
    )
  const options = { warmups, runs }

  const build1k = measureSync(() => buildScope(short1k), options)
  const build10k = measureSync(() => buildScope(short10k), options)
  const entry10k = measureSync(() => buildScope(short10k, 'live', 'all'), options)
  const rangeSwitch10k = measureSync(() => buildScope(short10k, 'live', '90d'), options)
  const hydrate1k = measureSync(() => JSON.parse(dense1k.json), options)
  const hydrate10k = measureSync(() => JSON.parse(dense10k.json), options)
  const save1k = measureSync(() => JSON.stringify(dense1k.snapshot), options)
  const save10k = measureSync(() => JSON.stringify(dense10k.snapshot), options)
  const memoryAfter = process.memoryUsage()
  const sourcePath = resolve('src/views/Dashboard.tsx')
  const source = readFileSync(sourcePath)
  const packageJson = readPackage()

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    application: {
      name: packageJson.name,
      version: packageJson.version,
      gitCommit: gitCommit(),
      productionBuild: productionBuildMetadata(),
    },
    machine: {
      hostname: hostname(),
      platform: platform(),
      release: release(),
      arch: arch(),
      cpuModel: cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      node: process.version,
    },
    viewport: { width: 1_440, height: 900, deviceScaleFactor: 1 },
    measurementPolicy: {
      mode: smoke ? 'smoke' : 'baseline',
      warmups,
      runs,
      clock: 'node:perf_hooks.performance.now',
      fixtureNow: now.toISOString(),
      percentile: 'nearest-rank',
    },
    boundaries: {
      dashboardBuild: {
        source: 'src/views/Dashboard.tsx::buildStats',
        sourceSha256: sha256(source),
        implementation: 'private-function-equivalent-kernel',
        includes: ['result summary', 'equity curve', 'strategy groups', 'R distribution'],
      },
      dashboardEntry: 'deleted filter + live/all scope filter + current buildStats equivalent',
      rangeSwitch: '90d filter using current closedAt ?? openedAt rule + current buildStats equivalent',
      hydrate: 'JSON.parse of an isolated complete snapshot; no IndexedDB or real library',
      save: 'JSON.stringify of an isolated complete snapshot; no disk or real library',
    },
    fixtures: fixtures.map((candidate) => candidate.metadata),
    measurements: {
      dashboardBuild1k: timingOnly(build1k),
      dashboardBuild10k: timingOnly(build10k),
      dashboardEntry10k: timingOnly(entry10k),
      rangeSwitch10k: timingOnly(rangeSwitch10k),
      hydrate1k2kb: timingOnly(hydrate1k),
      hydrate10k2kb: timingOnly(hydrate10k),
      save1k2kb: timingOnly(save1k),
      save10k2kb: timingOnly(save10k),
    },
    observedResult: {
      dashboardBuild1k: {
        closedCount: build1k.lastValue.closedCount,
        evaluatedCount: build1k.lastValue.evaluatedCount,
        conflictCount: build1k.lastValue.conflictCount,
        rDistributionCountDelta: build1k.lastValue.rDistributionCountDelta,
      },
      dashboardBuild10k: {
        closedCount: build10k.lastValue.closedCount,
        evaluatedCount: build10k.lastValue.evaluatedCount,
        conflictCount: build10k.lastValue.conflictCount,
        rDistributionCountDelta: build10k.lastValue.rDistributionCountDelta,
      },
    },
    memory: {
      heapUsedBeforeBytes: memoryBefore.heapUsed,
      heapUsedAfterBytes: memoryAfter.heapUsed,
      heapUsedDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
      rssBeforeBytes: memoryBefore.rss,
      rssAfterBytes: memoryAfter.rss,
      rssDeltaBytes: memoryAfter.rss - memoryBefore.rss,
    },
    previewBBudgets: {
      dashboardBuild10kWarmP95Ms: 40,
      scopeSwitchToInteractiveP95Ms: 180,
      coldHydrateP95Ms: 1_500,
      warmHydrateP95Ms: 600,
      fullSnapshotSaveP95Ms: 1_200,
      maxRegressionFromBaselineRatio: 0.1,
      note: 'Task 0 records the baseline; browser interaction budgets are enforced by qa-dashboard-10k.',
    },
    knownBaselineDefects: [
      'R distribution omits values below -3R.',
      'The zero upper bound is treated as falsy, causing overlapping R buckets.',
      'Strategy grouping copies arrays inside the loop and is intentionally preserved for baseline comparison.',
    ],
  }
}

function writeReport(report) {
  const outputDir = join(tmpdir(), 'yunkoo-atlas', 'analytics-baseline')
  mkdirSync(outputDir, { recursive: true })
  const outputPath = join(
    outputDir,
    `analytics-${report.application.version}-${report.machine.platform}-${report.machine.arch}.json`,
  )
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return outputPath
}

async function main() {
  const smoke = process.argv.includes('--smoke')
  const stdoutOnly = process.argv.includes('--stdout-only')
  const report = runAnalyticsBenchmark({ smoke })
  if (!stdoutOnly) {
    const outputPath = writeReport(report)
    process.stderr.write(`analytics benchmark report: ${outputPath}\n`)
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entryPath === import.meta.url) {
  await main()
}
