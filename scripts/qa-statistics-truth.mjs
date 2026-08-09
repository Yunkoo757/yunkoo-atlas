import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

import { runBrowserRegressionTests } from './run-browser-tests.mjs'

export const STATISTICS_TRUTH_ACCEPTANCE_IDS = [
  'T-SCOPE-001', 'T-SCOPE-002', 'T-SCOPE-003', 'T-SCOPE-004',
  'T-DATE-001', 'T-DATE-002', 'T-DATE-003', 'T-DATE-004',
  'T-IMPORT-001', 'T-IMPORT-002',
  'T-REVIEW-001', 'T-REVIEW-002',
  'T-ROUTE-001', 'T-ROUTE-002',
  'T-CURRENCY-001', 'T-DRILL-001',
]

export const STATISTICS_TRUTH_FIXTURE_PATH = 'src/test/fixtures/performanceTruthFixture.ts'
export const STATISTICS_TRUTH_FIXTURE_SAMPLE_COUNT = 56

const UNIT_ENTRIES = [
  'src/lib/performanceSelection.test.ts',
  'src/lib/analysisScope.test.ts',
  'src/lib/dashboardStats.test.ts',
  'src/lib/notionDateAudit.test.ts',
  'src/lib/notionImportTradeFacts.test.ts',
  'src/lib/notionImportCommit.test.ts',
  'src/lib/importDataHealth.test.ts',
  'src/lib/weeklyReviewSnapshot.test.ts',
  'src/lib/periods.test.ts',
  'src/lib/workspaceFacetConsistency.test.ts',
  'src/lib/cashCurrency.test.ts',
  'src/storage/snapshotCodec.test.ts',
  'src/storage/snapshotValidation.test.ts',
  'src/store/useStoreCurrencyAssumption.test.ts',
]

export const BROWSER_TEST_IDS = [
  'src/views/DashboardScope.browser.test.html#__dashboardAnalysisScopeTest',
  'src/components/NotionImportModal.browser.test.html#__notionImportPersistenceTest',
  'src/views/ImportDataHealthView.browser.test.html#__importDataHealthViewTest@1280x900',
  'src/views/WeeklyReviewView.browser.test.html#__weeklyReviewFlowTest@1280x900',
  'src/views/settings/ProfileSettingsCurrency.browser.test.html#__profileSettingsCurrencyTest',
]

const UNIT_TEST = (file, name) => `${file}#${name}`

export const ACCEPTANCE_TESTS = {
  'T-SCOPE-001': [UNIT_TEST('src/lib/performanceSelection.test.ts', 'testPerformanceSelectionFreezesEveryGoldenTruthCollection')],
  'T-SCOPE-002': [UNIT_TEST('src/lib/analysisScope.test.ts', 'testAnalysisScopeMatchesDashboardResultSet')],
  'T-SCOPE-003': [UNIT_TEST('src/lib/workspaceFacetConsistency.test.ts', 'testWorkbenchAnalysisMatchesSelectorAcrossKindsRangesAndArchive')],
  'T-SCOPE-004': [BROWSER_TEST_IDS[0]],
  'T-DATE-001': [
    UNIT_TEST('src/lib/analysisScope.test.ts', 'testPaperTerminalWithoutCloseFactNeverEntersPerformanceRanges'),
    UNIT_TEST('src/lib/notionImportTradeFacts.test.ts', 'testNotionTerminalTradeWithoutSourceCloseDateStaysPending'),
  ],
  'T-DATE-002': [UNIT_TEST('src/lib/analysisScope.test.ts', 'testAllRangeStopsAtTheNextBusinessDayExclusiveBoundary')],
  'T-DATE-003': [UNIT_TEST('src/lib/performanceSelection.test.ts', 'testPerformanceSelectionFreezesTheSixAmCloseDayBoundary')],
  'T-DATE-004': [UNIT_TEST('src/lib/dashboardStats.test.ts', 'testDashboardStatsUseOnlyEligibleMetricIdsForEveryAggregation')],
  'T-IMPORT-001': [
    UNIT_TEST('src/lib/notionImportTradeFacts.test.ts', 'testNotionImportParsesCurrencyOnlyFromSourceMoneyFacts'),
    BROWSER_TEST_IDS[1],
  ],
  'T-IMPORT-002': [
    UNIT_TEST('src/lib/importDataHealth.test.ts', 'testCleanupPersistsBeforePublishingAndUndoPatchRestoresExactFields'),
    BROWSER_TEST_IDS[2],
  ],
  'T-REVIEW-001': [
    UNIT_TEST('src/lib/weeklyReviewSnapshot.test.ts', 'testCompletedReviewWithoutMetricsSnapshotUsesLiveRecomputedSource'),
    UNIT_TEST('src/lib/weeklyReviewSnapshot.test.ts', 'testCompletedReviewWithoutEvidenceSnapshotUsesLiveRecomputedSource'),
    UNIT_TEST('src/lib/weeklyReviewSnapshot.test.ts', 'testCompletedReviewWithoutRiskSnapshotUsesLiveRecomputedSource'),
  ],
  'T-REVIEW-002': [BROWSER_TEST_IDS[3]],
  'T-ROUTE-001': [UNIT_TEST('src/lib/periods.test.ts', 'testYtdPeriodBoundsStartAtTheBusinessYearAndNeverIncludeFutureDays')],
  'T-ROUTE-002': [
    UNIT_TEST('src/lib/workspaceFacetConsistency.test.ts', 'testCalendarPeriodsAndDashboardPerformanceKeepDifferentDateFields'),
    BROWSER_TEST_IDS[0],
  ],
  'T-CURRENCY-001': [
    UNIT_TEST('src/lib/cashCurrency.test.ts', 'testUsdEligibilityAndTotalsShareOneCurrencyFactRule'),
    BROWSER_TEST_IDS[4],
  ],
  'T-DRILL-001': [
    UNIT_TEST('src/lib/performanceSelection.test.ts', 'testPerformanceSelectionDrilldownReproducesArchiveScope'),
    BROWSER_TEST_IDS[0],
  ],
}

export const UNIT_REQUIRED_TEST_IDS = [...new Set(
  Object.values(ACCEPTANCE_TESTS).flat().filter((id) => !id.includes('.browser.test.html#')),
)]
const UNIT_COMMAND = `node scripts/run-regression-tests.mjs --unit-only ${UNIT_ENTRIES.join(' ')}`
const BROWSER_COMMAND = `browser-runner ${BROWSER_TEST_IDS.join(' ')}`
const COMMAND_TEST_CONTRACTS = new Map([
  [UNIT_COMMAND, UNIT_REQUIRED_TEST_IDS],
  [BROWSER_COMMAND, BROWSER_TEST_IDS],
])

function difference(expected, actual) {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  return {
    missingIds: expected.filter((id) => !actualSet.has(id)),
    unexpectedIds: actual.filter((id) => !expectedSet.has(id)),
  }
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function pushDifferenceErrors(errors, label, expected, actual) {
  const diff = difference(expected, actual)
  if (!sameArray(expected, actual)) {
    errors.push(`${label} ID 差集：missing=${diff.missingIds.join(',') || '[]'} unexpected=${diff.unexpectedIds.join(',') || '[]'}`)
  }
  return diff
}

export function validateStatisticsTruthEvidence(evidence) {
  const errors = []
  if (evidence?.schemaVersion !== 1) errors.push('schemaVersion 必须为 1')
  if (!/^[0-9a-f]{40}$/i.test(evidence?.candidateSha ?? '')) errors.push('candidateSha 必须是完整 Git SHA')
  if (evidence?.fixture?.path !== STATISTICS_TRUTH_FIXTURE_PATH) errors.push('fixture path 与规范路径不一致')
  if (!/^[0-9a-f]{64}$/i.test(evidence?.fixture?.checksumSha256 ?? '')) errors.push('fixture checksum 必须为 SHA-256')
  if (evidence?.fixture?.sampleCount !== STATISTICS_TRUTH_FIXTURE_SAMPLE_COUNT) {
    errors.push(`golden fixture 样本数必须为 ${STATISTICS_TRUTH_FIXTURE_SAMPLE_COUNT}`)
  }

  if (!Array.isArray(evidence?.commands) || evidence.commands.length === 0) {
    errors.push('命令证据不得为空')
  } else {
    const commandNames = evidence.commands.map((command) => command.command)
    pushDifferenceErrors(errors, 'command contract', [...COMMAND_TEST_CONTRACTS.keys()], commandNames)
    for (const command of evidence.commands) {
      const canonicalExpectedIds = COMMAND_TEST_CONTRACTS.get(command.command)
      if (!canonicalExpectedIds) {
        errors.push(`未知命令证据：${command.command}`)
        continue
      }
      pushDifferenceErrors(errors, `命令 ${command.command} expected`, canonicalExpectedIds, command.expectedTestIds ?? [])
      if (command.exitCode !== 0) errors.push(`命令失败：${command.command}`)
      if (!Array.isArray(command.expectedTestIds) || command.expectedTestIds.length === 0) errors.push(`命令测试样本为空：${command.command}`)
      const actualTestIds = Array.isArray(command.actualTestIds) ? command.actualTestIds : []
      const diff = difference(command.expectedTestIds ?? [], actualTestIds)
      if (actualTestIds.length === 0 || diff.missingIds.length > 0) errors.push(`命令缺少测试：${command.command} -> ${diff.missingIds.join(',') || '空跑'}`)
      if ((command.missingTestIds?.length ?? 0) > 0) errors.push(`命令报告 missing：${command.missingTestIds.join(',')}`)
      if ((command.skippedTestIds?.length ?? 0) > 0 || /\bskip(?:ped)?\b/i.test(command.outputSummary ?? '')) errors.push(`命令包含 skip：${command.command}`)
      if ((command.todoTestIds?.length ?? 0) > 0 || /\btodo\b/i.test(command.outputSummary ?? '')) errors.push(`命令包含 TODO：${command.command}`)
      if (!sameArray(diff.missingIds, command.missingTestIds ?? [])) {
        errors.push(`命令 ${command.command} 声明的 missing 与实际不一致`)
      }
    }
  }

  const acceptanceExpected = evidence?.acceptance?.expectedIds ?? []
  const acceptanceItems = evidence?.acceptance?.actual ?? []
  const acceptanceActual = acceptanceItems.map((item) => item.id)
  pushDifferenceErrors(errors, 'acceptance', STATISTICS_TRUTH_ACCEPTANCE_IDS, acceptanceExpected)
  const acceptanceDiff = pushDifferenceErrors(errors, 'acceptance actual', STATISTICS_TRUTH_ACCEPTANCE_IDS, acceptanceActual)
  if (!sameArray(acceptanceDiff.missingIds, evidence?.acceptance?.missingIds ?? []) ||
      !sameArray(acceptanceDiff.unexpectedIds, evidence?.acceptance?.unexpectedIds ?? [])) {
    errors.push('acceptance 声明的 missing/unexpected 与实际不一致')
  }
  const passedCommandTestIds = new Set(
    (evidence?.commands ?? [])
      .filter((command) => command.exitCode === 0 && COMMAND_TEST_CONTRACTS.has(command.command))
      .flatMap((command) => command.actualTestIds ?? []),
  )
  for (const item of acceptanceItems) {
    const canonicalExpectedIds = ACCEPTANCE_TESTS[item.id]
    if (!canonicalExpectedIds) {
      errors.push(`未知 acceptance：${item.id}`)
      continue
    }
    pushDifferenceErrors(errors, `${item.id} expected`, canonicalExpectedIds, item.expectedTestIds ?? [])
    const canonicalActualIds = canonicalExpectedIds.filter((testId) => passedCommandTestIds.has(testId))
    pushDifferenceErrors(errors, `${item.id} actual`, canonicalActualIds, item.actualTestIds ?? [])
    const diff = difference(canonicalExpectedIds, canonicalActualIds)
    const expectedStatus = diff.missingIds.length === 0 ? 'pass' : 'fail'
    if (item.status !== expectedStatus) errors.push(`${item.id} 状态与实际命令证据不一致`)
    if (!sameArray(diff.missingIds, item.missingTestIds ?? [])) errors.push(`${item.id} 声明的 missing 与实际不一致`)
    if (diff.missingIds.length > 0) errors.push(`${item.id} 缺少测试：${diff.missingIds.join(',')}`)
    if (!Array.isArray(item.evidencePaths) || item.evidencePaths.length === 0) errors.push(`${item.id} 没有 JSON 证据路径`)
  }

  const collections = evidence?.golden?.collections ?? {}
  if (Object.keys(collections).length === 0) errors.push('golden ID 集合不得为空')
  for (const [name, collection] of Object.entries(collections)) {
    const diff = pushDifferenceErrors(errors, `golden.${name}`, collection.expectedIds ?? [], collection.actualIds ?? [])
    if (!sameArray(diff.missingIds, collection.missingIds ?? []) || !sameArray(diff.unexpectedIds, collection.unexpectedIds ?? [])) {
      errors.push(`golden.${name} 声明的差集与实际不一致`)
    }
  }
  if (evidence?.golden?.drilldownTarget?.expected !== evidence?.golden?.drilldownTarget?.actual) errors.push('下钻目标与选择器合同不一致')

  const kpi = evidence?.kpiTruth
  if (!kpi) {
    errors.push('缺少 KPI 真值')
  } else {
    pushDifferenceErrors(errors, 'KPI eligibleMetricIds', kpi.expected?.eligibleMetricIds ?? [], kpi.actual?.eligibleMetricIds ?? [])
    pushDifferenceErrors(errors, 'KPI pnlIds', kpi.expected?.pnlIds ?? [], kpi.actual?.pnlIds ?? [])
    pushDifferenceErrors(errors, 'KPI curveTradeIds', kpi.expected?.curveTradeIds ?? [], kpi.actual?.curveTradeIds ?? [])
    if (kpi.expected?.pnlCount !== kpi.actual?.pnlCount) errors.push(`KPI pnlCount 不一致：${kpi.actual?.pnlCount}`)
    if (kpi.expected?.totalPnl !== kpi.actual?.totalPnl) errors.push(`KPI totalPnl 不一致：${kpi.actual?.totalPnl}`)

    const eligible = new Set(kpi.actual?.eligibleMetricIds ?? [])
    const futureInKpiIds = (kpi.futureCloseDayIds ?? []).filter((id) => eligible.has(id))
    const missingInKpiIds = (kpi.missingCloseDayIds ?? []).filter((id) => eligible.has(id))
    const invalidInKpiIds = (kpi.invalidCloseDayIds ?? []).filter((id) => eligible.has(id))
    if (futureInKpiIds.length > 0) errors.push(`未来日期进入 KPI：${futureInKpiIds.join(',')}`)
    if (missingInKpiIds.length > 0) errors.push(`缺失日期进入 KPI：${missingInKpiIds.join(',')}`)
    if (invalidInKpiIds.length > 0) errors.push(`非法日期进入 KPI：${invalidInKpiIds.join(',')}`)

    const factById = new Map((kpi.usdTradeFacts ?? []).map((fact) => [fact.id, fact]))
    const pnlIds = kpi.actual?.pnlIds ?? []
    const nonUsdInUsdTotalIds = pnlIds.filter((id) => {
      const currency = factById.get(id)?.currency
      return currency !== undefined && currency !== null && currency !== 'USD'
    })
    const unknownCurrencyInUsdTotalIds = pnlIds.filter((id) => {
      const fact = factById.get(id)
      return !fact || fact.currency === undefined || fact.currency === null
    })
    if (nonUsdInUsdTotalIds.length > 0) errors.push(`非 USD 进入 USD 总计：${nonUsdInUsdTotalIds.join(',')}`)
    if (unknownCurrencyInUsdTotalIds.length > 0) errors.push(`未知币种进入 USD 总计：${unknownCurrencyInUsdTotalIds.join(',')}`)

    const derivedContamination = { futureInKpiIds, missingInKpiIds, invalidInKpiIds, nonUsdInUsdTotalIds, unknownCurrencyInUsdTotalIds }
    for (const [name, ids] of Object.entries(derivedContamination)) {
      if (!sameArray(ids, kpi.contamination?.[name] ?? [])) errors.push(`KPI contamination.${name} 声明与实际不一致`)
    }
  }
  if ((evidence?.failureReasons?.length ?? 0) > 0) errors.push(...evidence.failureReasons.map((reason) => `运行失败：${reason}`))
  return errors
}

async function validateCandidateFixture(root, evidence) {
  const errors = []
  if (!/^[0-9a-f]{40}$/i.test(evidence?.candidateSha ?? '')) return errors
  const result = await runCapture(
    'git',
    ['show', `${evidence.candidateSha}:${STATISTICS_TRUTH_FIXTURE_PATH}`],
    root,
  )
  if (result.exitCode !== 0) {
    errors.push('candidate 不存在或候选提交缺少规范 fixture')
    return errors
  }
  const candidateChecksum = crypto.createHash('sha256').update(result.stdout).digest('hex')
  if (candidateChecksum !== evidence.fixture?.checksumSha256) {
    errors.push('fixture checksum 与 candidate git show 内容不一致')
  }
  return errors
}

async function runStreaming(command, args, cwd) {
  const started = Date.now()
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stdout += text
      process.stdout.write(text)
    })
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stderr += text
      process.stderr.write(text)
    })
    child.on('error', (error) => resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}`, durationMs: Date.now() - started }))
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr, durationMs: Date.now() - started }))
  })
}

async function runCapture(command, args, cwd) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    child.stdout.on('data', (chunk) => { stdout = Buffer.concat([stdout, chunk]) })
    child.stderr.on('data', (chunk) => { stderr = Buffer.concat([stderr, chunk]) })
    child.on('error', (error) => resolve({ exitCode: 1, stdout, stderr: Buffer.from(error.message) }))
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }))
  })
}

async function gitSha(root) {
  const result = await runStreaming('git', ['rev-parse', 'HEAD'], root)
  if (result.exitCode !== 0) throw new Error('无法读取 candidate git SHA')
  return result.stdout.trim()
}

async function buildGoldenEvidence(root) {
  const probeRoot = path.join(root, 'test-results', 'statistics-truth')
  const entryPath = path.join(probeRoot, '.probe-entry.ts')
  const outDir = path.join(probeRoot, '.probe-dist')
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.writeFile(entryPath, `
    import { buildDashboardStats } from '@/lib/dashboardStats'
    import { buildPerformanceSelection } from '@/lib/performanceSelection'
    import { createBusinessDateAnchor } from '@/lib/periods'
    import { performanceTruthFixture as fixture } from '@/test/fixtures/performanceTruthFixture'

    const selection = buildPerformanceSelection(fixture.trades, {
      scope: { kind: 'all', range: 'all' },
      liveScope: fixture.currentLiveScope,
      anchor: createBusinessDateAnchor(fixture.now, fixture.tradingDayStartHour),
      legacyCashCurrencyAssumption: null,
    })
    const stats = buildDashboardStats(
      [...fixture.trades],
      [],
      selection.eligibleMetricIds,
      fixture.tradingDayStartHour,
      selection.pnlIds,
    )
    const collectionNames = [
      'futureCloseDayIds', 'missingCloseDayIds', 'invalidCloseDayIds',
      'completeResultIds', 'conflictResultIds', 'missingResultIds',
      'eligibleMetricIds', 'pnlIds', 'rIds', 'unknownCurrencyIds',
    ]
    export const goldenEvidence = {
      sampleCount: fixture.trades.length,
      collections: Object.fromEntries(collectionNames.map((name) => [name, {
        expectedIds: [...fixture.expected[name]],
        actualIds: [...selection[name]],
      }])),
      drilldownTarget: { expected: '?kind=all&range=all', actual: selection.drilldownTarget },
      kpiTruth: {
        futureCloseDayIds: [...selection.futureCloseDayIds],
        missingCloseDayIds: [...selection.missingCloseDayIds],
        invalidCloseDayIds: [...selection.invalidCloseDayIds],
        usdTradeFacts: fixture.trades
          .filter((trade) => typeof trade.pnl === 'number' && Number.isFinite(trade.pnl))
          .map((trade) => ({
            id: trade.id,
            currency: Object.prototype.hasOwnProperty.call(trade, 'cashCurrency') ? trade.cashCurrency : null,
            pnl: trade.pnl,
          })),
        expected: {
          eligibleMetricIds: [...fixture.expected.eligibleMetricIds],
          pnlIds: [...fixture.expected.pnlIds],
          pnlCount: 1,
          totalPnl: 100,
          curveTradeIds: ['FX-USD'],
        },
        actual: {
          eligibleMetricIds: [...selection.eligibleMetricIds],
          pnlIds: [...selection.pnlIds],
          pnlCount: stats.pnlCount,
          totalPnl: stats.totalPnl,
          curveTradeIds: stats.curve.map((point) => point.tradeId),
        },
      },
    }
  `, 'utf8')
  try {
    await build({
      configFile: path.join(root, 'vite.config.ts'),
      logLevel: 'error',
      build: {
        ssr: entryPath,
        outDir,
        emptyOutDir: true,
        rolldownOptions: { output: { entryFileNames: 'probe.mjs' } },
      },
    })
    const moduleUrl = pathToFileURL(path.join(outDir, 'probe.mjs'))
    moduleUrl.searchParams.set('run', String(Date.now()))
    return (await import(moduleUrl.href)).goldenEvidence
  } finally {
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.rm(entryPath, { force: true })
  }
}

function summarizeOutput(output) {
  const lines = output.split(/\r?\n/).filter(Boolean)
  return lines.slice(-20).join('\n')
}

function commandEvidence(command, result, expectedTestIds, actualTestIds) {
  const diff = difference(expectedTestIds, actualTestIds)
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  return {
    command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    expectedTestIds,
    actualTestIds,
    missingTestIds: diff.missingIds,
    skippedTestIds: output.split(/\r?\n/).filter((line) => /\bskip(?:ped)?\b/i.test(line)),
    todoTestIds: output.split(/\r?\n/).filter((line) => /\btodo\b/i.test(line)),
    outputSummary: summarizeOutput(output),
  }
}

function makeAcceptance(passedTestIds) {
  return STATISTICS_TRUTH_ACCEPTANCE_IDS.map((id) => {
    const expectedTestIds = ACCEPTANCE_TESTS[id]
    const actualTestIds = expectedTestIds.filter((testId) => passedTestIds.has(testId))
    const missingTestIds = difference(expectedTestIds, actualTestIds).missingIds
    return {
      id,
      status: missingTestIds.length === 0 ? 'pass' : 'fail',
      expectedTestIds,
      actualTestIds,
      missingTestIds,
      evidencePaths: [
        id === 'T-CURRENCY-001' ? 'kpiTruth' : 'golden.collections',
        id === 'T-DRILL-001' ? 'golden.drilldownTarget' : 'commands',
      ],
    }
  })
}

function renderReport(evidence, jsonPath) {
  const rows = evidence.acceptance.actual.map((item) =>
    `| ${item.id} | ${item.status === 'pass' ? 'PASS' : 'FAIL'} | \`${item.evidencePaths.join('`, `')}\` | ${item.actualTestIds.map((id) => `\`${id}\``).join('<br>')} |`,
  )
  return `# Statistics Truth Gate Result\n\n` +
    `- Candidate SHA: \`${evidence.candidateSha}\`\n` +
    `- Evidence JSON: \`${jsonPath}\`\n` +
    `- Fixture: \`${evidence.fixture.path}\`\n` +
    `- Fixture SHA-256: \`${evidence.fixture.checksumSha256}\`\n` +
    `- Samples: ${evidence.fixture.sampleCount}\n` +
    `- Result: ${evidence.failureReasons.length === 0 ? 'PASS' : 'FAIL'}\n\n` +
    `| Acceptance ID | Result | JSON evidence | Executed test IDs |\n|---|---|---|---|\n${rows.join('\n')}\n\n` +
    `## KPI truth\n\n` +
    `- USD IDs: expected \`${JSON.stringify(evidence.kpiTruth.expected.pnlIds)}\`, actual \`${JSON.stringify(evidence.kpiTruth.actual.pnlIds)}\`.\n` +
    `- USD total: expected ${evidence.kpiTruth.expected.totalPnl}, actual ${evidence.kpiTruth.actual.totalPnl}.\n` +
    `- Future/missing/invalid close-day contamination: \`${JSON.stringify(evidence.kpiTruth.contamination)}\`.\n\n` +
    `## Command evidence\n\n${evidence.commands.map((item) => `- \`${item.command}\`: exit ${item.exitCode}, ${item.actualTestIds.length}/${item.expectedTestIds.length} expected tests.`).join('\n')}\n\n` +
    `## Failure reasons\n\n${evidence.failureReasons.length === 0 ? '- None.' : evidence.failureReasons.map((reason) => `- ${reason}`).join('\n')}\n`
}

async function runGate(root) {
  const resultDir = path.join(root, 'test-results', 'statistics-truth')
  const fixturePath = path.join(root, 'src', 'test', 'fixtures', 'performanceTruthFixture.ts')
  const jsonRelativePath = 'test-results/statistics-truth/statistics-truth-gate.json'
  const reportRelativePath = 'docs/superpowers/reports/2026-08-09-statistics-truth-gate-result.md'
  await fs.mkdir(resultDir, { recursive: true })

  const candidateSha = await gitSha(root)
  const fixtureSource = await fs.readFile(fixturePath)
  const golden = await buildGoldenEvidence(root)
  for (const collection of Object.values(golden.collections)) Object.assign(collection, difference(collection.expectedIds, collection.actualIds))

  const unitArgs = ['scripts/run-regression-tests.mjs', '--unit-only', ...UNIT_ENTRIES]
  const unitCommand = `node ${unitArgs.join(' ')}`
  const unitResult = await runStreaming(process.execPath, unitArgs, root)
  const unitOutput = `${unitResult.stdout}\n${unitResult.stderr}`
  const unitActualIds = [...unitOutput.matchAll(/^PASS (.+) :: (.+)$/gm)].map((match) => `${match[1]}#${match[2]}`)
  const unitEvidence = commandEvidence(unitCommand, unitResult, UNIT_REQUIRED_TEST_IDS, unitActualIds)

  const browserStarted = Date.now()
  const browserResult = await runBrowserRegressionTests(root, {
    configFile: path.join(root, 'vite.config.ts'),
    requestedTestIds: BROWSER_TEST_IDS,
    testTimeoutMs: 20_000,
    onEvent(event) {
      if (event.type === 'start') process.stdout.write(`GATE START ${event.testId}\n`)
      if (event.type === 'pass') process.stdout.write(`GATE PASS ${event.testId}\n`)
      if (event.type === 'fail') process.stderr.write(`GATE FAIL ${event.testId}: ${event.reason}\n`)
    },
  })
  const browserCommand = BROWSER_COMMAND
  const browserEvidence = commandEvidence(
    browserCommand,
    {
      exitCode: browserResult.failed === 0 ? 0 : 1,
      durationMs: Date.now() - browserStarted,
      stdout: browserResult.passedTests.map((id) => `PASS ${id}`).join('\n'),
      stderr: browserResult.failedTests.map((id) => `FAIL ${id}`).join('\n'),
    },
    BROWSER_TEST_IDS,
    browserResult.passedTests,
  )

  const passedTestIds = new Set([...unitActualIds, ...browserResult.passedTests])
  const acceptanceActual = makeAcceptance(passedTestIds)
  const acceptanceDiff = difference(STATISTICS_TRUTH_ACCEPTANCE_IDS, acceptanceActual.map((item) => item.id))
  const eligible = new Set(golden.kpiTruth.actual.eligibleMetricIds)
  const factById = new Map(golden.kpiTruth.usdTradeFacts.map((fact) => [fact.id, fact]))
  const contamination = {
    futureInKpiIds: golden.kpiTruth.futureCloseDayIds.filter((id) => eligible.has(id)),
    missingInKpiIds: golden.kpiTruth.missingCloseDayIds.filter((id) => eligible.has(id)),
    invalidInKpiIds: golden.kpiTruth.invalidCloseDayIds.filter((id) => eligible.has(id)),
    nonUsdInUsdTotalIds: golden.kpiTruth.actual.pnlIds.filter((id) => {
      const currency = factById.get(id)?.currency
      return currency !== undefined && currency !== null && currency !== 'USD'
    }),
    unknownCurrencyInUsdTotalIds: golden.kpiTruth.actual.pnlIds.filter((id) => {
      const fact = factById.get(id)
      return !fact || fact.currency === undefined || fact.currency === null
    }),
  }
  golden.kpiTruth.contamination = contamination

  const evidence = {
    schemaVersion: 1,
    candidateSha,
    fixture: {
      path: STATISTICS_TRUTH_FIXTURE_PATH,
      checksumSha256: crypto.createHash('sha256').update(fixtureSource).digest('hex'),
      sampleCount: golden.sampleCount,
    },
    commands: [unitEvidence, browserEvidence],
    acceptance: {
      expectedIds: STATISTICS_TRUTH_ACCEPTANCE_IDS,
      actual: acceptanceActual,
      missingIds: acceptanceDiff.missingIds,
      unexpectedIds: acceptanceDiff.unexpectedIds,
    },
    golden: { collections: golden.collections, drilldownTarget: golden.drilldownTarget },
    kpiTruth: golden.kpiTruth,
    failureReasons: [],
  }
  const errors = [
    ...validateStatisticsTruthEvidence(evidence),
    ...await validateCandidateFixture(root, evidence),
  ]
  evidence.failureReasons = errors
  await fs.writeFile(path.join(root, jsonRelativePath), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  await fs.mkdir(path.dirname(path.join(root, reportRelativePath)), { recursive: true })
  await fs.writeFile(path.join(root, reportRelativePath), renderReport(evidence, jsonRelativePath), 'utf8')
  if (errors.length > 0) {
    console.error('STATISTICS_TRUTH_GATE_FAILED')
    for (const error of errors) console.error(`- ${error}`)
    return 1
  }
  console.log(`STATISTICS_TRUTH_GATE_PASS ${candidateSha}`)
  console.log(`EVIDENCE ${jsonRelativePath}`)
  return 0
}

async function main() {
  const validateIndex = process.argv.indexOf('--validate-evidence')
  if (validateIndex >= 0) {
    const evidencePath = process.argv[validateIndex + 1]
    if (!evidencePath) throw new Error('--validate-evidence requires a JSON path')
    const evidence = JSON.parse(await fs.readFile(evidencePath, 'utf8'))
    const errors = [
      ...validateStatisticsTruthEvidence(evidence),
      ...await validateCandidateFixture(process.cwd(), evidence),
    ]
    if (errors.length > 0) {
      console.error('STATISTICS_TRUTH_GATE_FAILED')
      for (const error of errors) console.error(`- ${error}`)
      return 1
    }
    console.log('STATISTICS_TRUTH_GATE_PASS')
    return 0
  }
  return await runGate(process.cwd())
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error('STATISTICS_TRUTH_GATE_FAILED')
    console.error(error)
    process.exitCode = 1
  }
}
