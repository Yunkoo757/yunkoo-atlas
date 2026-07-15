import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateDashboardQa } from '../qa-dashboard-10k.mjs'

test('10k QA 只用功能完整性决定基线通过，性能预算先记录不伪装达标', () => {
  const result = evaluateDashboardQa({
    expectedChecksum: 'fixture-checksum',
    loadedChecksum: 'fixture-checksum',
    expectedClosedCount: 7_000,
    renderedClosedCount: 7_000,
    cardCount: 4,
    panelCount: 4,
    hasDataHealth: true,
    qualityTabCount: 5,
    conflictRowCount: 1,
    detailReturnPreserved: true,
    consoleErrors: [],
    pageErrors: [],
    dashboardEntryP95Ms: 220,
    rangeSwitchP95Ms: 190,
    coldHydrateMs: 1_600,
    warmHydrateP95Ms: 650,
    snapshotSaveP95Ms: 1_300,
  })

  assert.equal(result.functionalPassed, true)
  assert.equal(result.performance.enforced, false)
  assert.equal(result.performance.withinAllAbsoluteBudgets, false)
  assert.ok(result.checks.every((check) => check.passed))
})

test('校验和或页面错误会让 10k 功能基线失败', () => {
  const result = evaluateDashboardQa({
    expectedChecksum: 'expected',
    loadedChecksum: 'other',
    expectedClosedCount: 1,
    renderedClosedCount: 0,
    cardCount: 0,
    panelCount: 0,
    hasDataHealth: false,
    qualityTabCount: 0,
    conflictRowCount: 0,
    detailReturnPreserved: false,
    consoleErrors: ['boom'],
    pageErrors: [],
    dashboardEntryP95Ms: 1,
    rangeSwitchP95Ms: 1,
    coldHydrateMs: 1,
    warmHydrateP95Ms: 1,
    snapshotSaveP95Ms: 1,
  })

  assert.equal(result.functionalPassed, false)
  assert.ok(result.checks.some((check) => !check.passed))
})
