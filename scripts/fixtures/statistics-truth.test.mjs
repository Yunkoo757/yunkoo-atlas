import assert from 'node:assert/strict'
import crypto from 'node:crypto'
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

async function validEvidence() {
  const evidence = JSON.parse(await fs.readFile(
    path.resolve('test-results/statistics-truth/statistics-truth-gate.json'),
    'utf8',
  ))
  const candidate = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(), encoding: 'utf8',
  }).stdout.trim()
  const fixtureSource = spawnSync(
    'git',
    ['show', `${candidate}:src/test/fixtures/performanceTruthFixture.ts`],
    { cwd: process.cwd(), encoding: null },
  ).stdout
  evidence.candidateSha = candidate
  evidence.fixture.path = 'src/test/fixtures/performanceTruthFixture.ts'
  evidence.fixture.sampleCount = 56
  evidence.fixture.checksumSha256 = crypto.createHash('sha256').update(fixtureSource).digest('hex')
  evidence.failureReasons = []
  return evidence
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
