import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

const ACCEPTANCE_IDS = [
  'T-SCOPE-001', 'T-SCOPE-002', 'T-SCOPE-003', 'T-SCOPE-004',
  'T-DATE-001', 'T-DATE-002', 'T-DATE-003', 'T-DATE-004',
  'T-IMPORT-001', 'T-IMPORT-002',
  'T-REVIEW-001', 'T-REVIEW-002',
  'T-ROUTE-001', 'T-ROUTE-002',
  'T-CURRENCY-001', 'T-DRILL-001',
]

function validEvidence() {
  const testId = 'src/lib/performanceSelection.test.ts#testPerformanceSelectionFreezesEveryGoldenTruthCollection'
  return {
    schemaVersion: 1,
    candidateSha: 'a'.repeat(40),
    fixture: {
      path: 'src/test/fixtures/performanceTruthFixture.ts',
      checksumSha256: 'b'.repeat(64),
      sampleCount: 56,
    },
    commands: [{
      command: 'node scripts/run-regression-tests.mjs --unit-only src/lib/performanceSelection.test.ts',
      exitCode: 0,
      expectedTestIds: [testId],
      actualTestIds: [testId],
      missingTestIds: [],
      skippedTestIds: [],
      todoTestIds: [],
      outputSummary: 'PASS performance truth contract',
    }],
    acceptance: {
      expectedIds: [...ACCEPTANCE_IDS],
      actual: ACCEPTANCE_IDS.map((id) => ({
        id,
        status: 'pass',
        expectedTestIds: [testId],
        actualTestIds: [testId],
        missingTestIds: [],
        evidencePaths: ['golden.collections.eligibleMetricIds'],
      })),
      missingIds: [],
      unexpectedIds: [],
    },
    golden: {
      collections: {
        eligibleMetricIds: {
          expectedIds: ['USD'],
          actualIds: ['USD'],
          missingIds: [],
          unexpectedIds: [],
        },
        pnlIds: {
          expectedIds: ['USD'],
          actualIds: ['USD'],
          missingIds: [],
          unexpectedIds: [],
        },
      },
      drilldownTarget: {
        expected: '?kind=all&range=all',
        actual: '?kind=all&range=all',
      },
    },
    kpiTruth: {
      futureCloseDayIds: ['FUTURE'],
      missingCloseDayIds: ['MISSING'],
      invalidCloseDayIds: ['INVALID'],
      usdTradeFacts: [{ id: 'USD', currency: 'USD', pnl: 100 }],
      expected: {
        eligibleMetricIds: ['USD'],
        pnlIds: ['USD'],
        pnlCount: 1,
        totalPnl: 100,
        curveTradeIds: ['USD'],
      },
      actual: {
        eligibleMetricIds: ['USD'],
        pnlIds: ['USD'],
        pnlCount: 1,
        totalPnl: 100,
        curveTradeIds: ['USD'],
      },
      contamination: {
        futureInKpiIds: [],
        missingInKpiIds: [],
        invalidInKpiIds: [],
        nonUsdInUsdTotalIds: [],
        unknownCurrencyInUsdTotalIds: [],
      },
    },
    failureReasons: [],
  }
}

async function runContractCase(mutate) {
  const root = await fs.mkdtemp(path.join(process.cwd(), 'test-results', '.tmp-statistics-truth-contract-'))
  try {
    const evidence = validEvidence()
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

const invalidCases = [
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
