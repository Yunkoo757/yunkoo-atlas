import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateDashboardQa } from '../qa-dashboard-10k.mjs'

test('10k QA 将功能完整性与性能预算共同作为发布门槛', () => {
  const result = evaluateDashboardQa({
    expectedChecksum: 'fixture-checksum',
    loadedChecksum: 'fixture-checksum',
    expectedClosedCount: 7_000,
    renderedClosedCount: 7_000,
    cardCount: 4,
    panelCount: 3,
    hasDataHealth: true,
    consoleErrors: [],
    pageErrors: [],
    dashboardEntryP95Ms: 220,
    rangeSwitchP95Ms: 190,
    coldHydrateMs: 1_600,
    warmHydrateP95Ms: 650,
    snapshotSaveP95Ms: 1_300,
  })

  assert.equal(result.functionalPassed, true)
  assert.equal(result.releasePassed, false)
  assert.equal(result.performance.enforced, true)
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
    consoleErrors: ['boom'],
    pageErrors: [],
    dashboardEntryP95Ms: 1,
    rangeSwitchP95Ms: 1,
    coldHydrateMs: 1,
    warmHydrateP95Ms: 1,
    snapshotSaveP95Ms: 1,
  })

  assert.equal(result.functionalPassed, false)
  assert.equal(result.releasePassed, false)
  assert.ok(result.checks.some((check) => !check.passed))
})

test('本地与托管 Windows 的 10k 热恢复预算分别冻结', () => {
  const observation = {
    expectedChecksum: 'fixture-checksum',
    loadedChecksum: 'fixture-checksum',
    expectedClosedCount: 7_000,
    renderedClosedCount: 7_000,
    cardCount: 4,
    panelCount: 3,
    hasDataHealth: true,
    consoleErrors: [],
    pageErrors: [],
    dashboardEntryP95Ms: 1,
    rangeSwitchP95Ms: 1,
    coldHydrateMs: 1,
    warmHydrateP95Ms: 750,
    snapshotSaveP95Ms: 1,
  }

  const atBudget = evaluateDashboardQa(observation)
  const overBudget = evaluateDashboardQa({
    ...observation,
    warmHydrateP95Ms: 750.001,
  })
  const hostedAtBudget = evaluateDashboardQa(
    { ...observation, warmHydrateP95Ms: 1_200 },
    { budgetProfile: 'hosted-windows' },
  )
  const hostedOverBudget = evaluateDashboardQa(
    { ...observation, warmHydrateP95Ms: 1_200.001 },
    { budgetProfile: 'hosted-windows' },
  )

  assert.equal(atBudget.performance.budgets.warmHydrateP95Ms.budgetMs, 750)
  assert.equal(atBudget.releasePassed, true)
  assert.equal(overBudget.releasePassed, false)
  assert.equal(hostedAtBudget.performance.budgetProfile, 'hosted-windows')
  assert.equal(hostedAtBudget.performance.budgets.warmHydrateP95Ms.budgetMs, 1_200)
  assert.equal(hostedAtBudget.releasePassed, true)
  assert.equal(hostedOverBudget.releasePassed, false)
})
