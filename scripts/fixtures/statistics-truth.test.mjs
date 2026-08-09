import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import {
  ACCEPTANCE_TESTS,
  BROWSER_TEST_IDS,
  createCanonicalStatisticsTruthEvidence,
  STATISTICS_TRUTH_UNIT_ENTRIES,
} from '../qa-statistics-truth.mjs'

test('statistics truth canonical gate covers the final truth surfaces', () => {
  assert.deepEqual(
    STATISTICS_TRUTH_UNIT_ENTRIES.filter((entry) => [
      'src/lib/tradeWorkflow.test.ts',
      'src/lib/strategies.test.ts',
      'src/data/weeklyReviews.test.ts',
    ].includes(entry)),
    [
      'src/lib/tradeWorkflow.test.ts',
      'src/lib/strategies.test.ts',
      'src/data/weeklyReviews.test.ts',
    ],
  )
  assert(BROWSER_TEST_IDS.includes('src/views/StatisticsTruthSurfaces.browser.test.html#__statisticsTruthSurfacesTest'))
  const canonicalIds = new Set(Object.values(ACCEPTANCE_TESTS).flat())
  assert(canonicalIds.has('src/lib/tradeWorkflow.test.ts#testTodayClosedMetricsRejectsUnreliableFutureAndConflictingFacts'))
  assert(canonicalIds.has('src/lib/strategies.test.ts#testStrategyStatsConsumeCallerEligibilityWithoutReclassifyingFacts'))
  assert(canonicalIds.has('src/data/weeklyReviews.test.ts#testWeeklyReviewEvidenceKeepsReliableConflictAndPendingResultsWithoutMetrics'))
  assert(canonicalIds.has('src/lib/weeklyReviewSnapshot.test.ts#testCompletionFreezesConflictAndPendingEvidenceWithoutPerformance'))
  assert(canonicalIds.has('src/views/StatisticsTruthSurfaces.browser.test.html#__statisticsTruthSurfacesTest'))
})

async function validEvidence() {
  const candidate = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(), encoding: 'utf8',
  }).stdout.trim()
  const fixtureSource = spawnSync(
    'git',
    ['show', `${candidate}:src/test/fixtures/performanceTruthFixture.ts`],
    { cwd: process.cwd(), encoding: null },
  ).stdout
  return createCanonicalStatisticsTruthEvidence({
    candidateSha: candidate,
    fixtureChecksumSha256: crypto.createHash('sha256').update(fixtureSource).digest('hex'),
  })
}

async function runContractCase(mutate) {
  const root = await fs.mkdtemp(path.join(process.cwd(), 'test-results', '.tmp-statistics-truth-contract-'))
  try {
    const evidence = await validEvidence()
    mutate?.(evidence)
    const evidencePath = path.join(root, 'evidence.json')
    await fs.writeFile(evidencePath, `${JSON.stringify(evidence)}\n`, 'utf8')
    return spawnSync(
      process.execPath,
      [path.resolve('scripts/qa-statistics-truth.mjs'), '--validate-evidence', evidencePath],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000 },
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('statistics truth validator accepts complete non-empty evidence', async () => {
  const result = await runContractCase()
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('statistics truth validator contract passes without runtime gate JSON', async () => {
  const runtimePath = path.resolve('test-results/statistics-truth/statistics-truth-gate.json')
  const backupPath = `${runtimePath}.contract-backup-${process.pid}`
  let hidden = false
  try {
    try {
      await fs.rename(runtimePath, backupPath)
      hidden = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    const result = await runContractCase()
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    if (hidden) await fs.rename(backupPath, runtimePath)
  }
})

const invalidCases = [
  ['forged command expected and actual IDs', (evidence) => {
    evidence.commands[0].expectedTestIds = ['forged#unit']
    evidence.commands[0].actualTestIds = ['forged#unit']
  }],
  ['forged acceptance expected and actual test IDs', (evidence) => {
    for (const item of evidence.acceptance.actual) {
      item.expectedTestIds = ['forged#acceptance']
      item.actualTestIds = ['forged#acceptance']
    }
  }],
  ['forged declared acceptance differences', (evidence) => {
    evidence.acceptance.missingIds = ['forged-missing']
    evidence.acceptance.unexpectedIds = ['forged-unexpected']
  }],
  ['forged fixture path', (evidence) => { evidence.fixture.path = 'src/test/fixtures/forged.ts' }],
  ['forged fixture sample count', (evidence) => { evidence.fixture.sampleCount = 55 }],
  ['forged fixture checksum', (evidence) => { evidence.fixture.checksumSha256 = 'c'.repeat(64) }],
  ['candidate does not exist', (evidence) => { evidence.candidateSha = 'f'.repeat(40) }],
  ['missing test', (evidence) => {
    evidence.commands[0].actualTestIds = []
    evidence.commands[0].missingTestIds = [...evidence.commands[0].expectedTestIds]
  }],
  ['empty sample', (evidence) => { evidence.fixture.sampleCount = 0 }],
  ['skipped test', (evidence) => { evidence.commands[0].skippedTestIds = ['unit#skipped'] }],
  ['TODO test', (evidence) => { evidence.commands[0].todoTestIds = ['unit#todo'] }],
  ['acceptance ID difference', (evidence) => { evidence.acceptance.actual.pop() }],
  ['golden ID difference', (evidence) => { evidence.golden.collections.pnlIds.actualIds = ['CNY'] }],
  ['future close date in KPI', (evidence) => { evidence.kpiTruth.actual.eligibleMetricIds.push('FUTURE') }],
  ['missing close date in KPI', (evidence) => { evidence.kpiTruth.actual.eligibleMetricIds.push('MISSING') }],
  ['non-USD cash in USD total', (evidence) => {
    evidence.kpiTruth.usdTradeFacts.push({ id: 'CNY', currency: 'CNY', pnl: 700 })
    evidence.kpiTruth.actual.pnlIds.push('CNY')
  }],
]

for (const [label, mutate] of invalidCases) {
  test(`statistics truth validator exits nonzero for ${label}`, async () => {
    const result = await runContractCase(mutate)
    assert.notEqual(result.status, 0, `validator falsely accepted ${label}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /STATISTICS_TRUTH_GATE_FAILED/)
  })
}
