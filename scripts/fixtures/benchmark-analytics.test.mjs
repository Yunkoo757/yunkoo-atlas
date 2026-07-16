import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

import {
  buildCurrentDashboardStats,
  selectCurrentDashboardTrades,
  summarizeTimings,
} from '../benchmark-analytics.mjs'
import {
  ANALYTICS_FIXTURE_SEED,
  ANALYTICS_FIXTURE_STRATEGIES,
  createAnalyticsTrades,
} from './analytics-trades.mjs'

test('计时摘要使用固定 median 与 nearest-rank p95 口径', () => {
  assert.deepEqual(summarizeTimings([4, 1, 3, 2]), {
    count: 4,
    minMs: 1,
    medianMs: 2.5,
    p95Ms: 4,
    maxMs: 4,
    rawMs: [4, 1, 3, 2],
  })
})

test('Dashboard 等价基准只统计当前 scope，且 R 分桶互斥覆盖全部有限值', () => {
  const trades = createAnalyticsTrades({ count: 1_000, seed: ANALYTICS_FIXTURE_SEED })
  const selected = selectCurrentDashboardTrades(trades, {
    kind: 'all',
    range: 'all',
    now: new Date('2026-07-15T00:00:00.000Z'),
  })
  const stats = buildCurrentDashboardStats(selected, ANALYTICS_FIXTURE_STRATEGIES)

  assert.ok(selected.every((trade) => !trade.deletedAt))
  assert.ok(selected.every((trade) => trade.tradeKind !== 'case'))
  assert.ok(selected.every((trade) => ['win', 'loss', 'breakeven'].includes(trade.status)))
  assert.equal(stats.closedCount, selected.length)
  assert.ok(stats.conflictCount > 0)
  assert.equal(stats.rDistributionCountDelta, 0)
  assert.equal(stats.rDist.reduce((sum, bucket) => sum + bucket.n, 0), stats.rCount)
  assert.equal(stats.rDist[0]?.label, '<-3')
  assert.equal(stats.rDist.at(-1)?.label, '≥10')
})

test('Dashboard 等价基准将大样本权益曲线限制在 600 点以内', () => {
  const trades = createAnalyticsTrades({ count: 10_000, seed: ANALYTICS_FIXTURE_SEED })
  const selected = selectCurrentDashboardTrades(trades, {
    kind: 'all',
    range: 'all',
    now: new Date('2026-07-15T00:00:00.000Z'),
  })
  const stats = buildCurrentDashboardStats(selected, ANALYTICS_FIXTURE_STRATEGIES)

  assert.ok(stats.pnlCount > 600)
  assert.ok(stats.curve.length <= 600)
})

test('benchmark CLI 输出固定结构与四组可追溯 fixture', () => {
  const stdout = execFileSync(
    process.execPath,
    ['scripts/benchmark-analytics.mjs', '--smoke', '--stdout-only'],
    { cwd: process.cwd(), encoding: 'utf8' },
  )
  const report = JSON.parse(stdout)

  assert.equal(report.schemaVersion, 1)
  assert.equal(report.measurementPolicy.mode, 'smoke')
  assert.equal(report.fixtures.length, 4)
  assert.ok(report.fixtures.every((fixture) => fixture.checksum.length === 64))
  assert.equal(report.measurements.dashboardBuild10k.rawMs.length, 2)
  assert.equal(report.measurements.hydrate10k2kb.rawMs.length, 2)
  assert.equal(report.measurements.save10k2kb.rawMs.length, 2)
  assert.equal(
    report.boundaries.dashboardBuild.source,
    'src/lib/dashboardStats.ts::buildDashboardStats',
  )
  assert.equal(report.observedResult.dashboardBuild10k.rDistributionCountDelta, 0)
  assert.ok(report.observedResult.dashboardBuild10k.curvePointCount <= 600)
  assert.deepEqual(report.knownBaselineDefects, [])
})
