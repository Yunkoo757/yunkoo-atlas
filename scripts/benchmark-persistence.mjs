import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { build, createServer } from 'vite'
import { readGitProvenance } from './git-provenance.mjs'

import {
  ANALYTICS_FIXTURE_SEED,
  checksumFixture,
  createAnalyticsSnapshot,
} from './fixtures/analytics-trades.mjs'

const root = process.cwd()
const mode = process.argv.includes('--release') ? 'release' : 'smoke'
const sampleConfig = mode === 'release'
  ? { warmups: 5, samples: 30 }
  : { warmups: 1, samples: 3 }
const limits = {
  web10kSaveP95Ms: 500,
  web20kSaveP95Ms: 1_000,
  webDirtyConfirmedP95Ms: 2_000,
  webStaleConflictP95Ms: 250,
  webMainThreadBlockMs: 50,
  electron10kSaveP95Ms: 1_500,
  electron20kSaveP95Ms: 2_500,
  quitCoordinatorP95Ms: 3_000,
}

function p95(samples) {
  if (samples.length === 0) throw new Error('性能样本不能为空')
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
}

function addAttachmentDomains(snapshot) {
  const sharedId = 'fixture-asset-shared-three-domains'
  const timestamp = '2026-07-22T00:00:00.000Z'
  snapshot.trades[0] = {
    ...snapshot.trades[0],
    note: `${snapshot.trades[0].note}<img src="journal-asset://${sharedId}">`,
  }
  snapshot.weeklyReviews = [{
    id: 'weekly-review:2026-07-20',
    weekStart: '2026-07-20',
    weekEnd: '2026-07-26',
    status: 'draft',
    executionScore: null,
    riskScore: null,
    emotionScore: null,
    strengthTags: [],
    mistakeTags: [],
    highlightTradeIds: [],
    mistakeTradeIds: [],
    followUpTradeIds: [],
    contentHtml: `<img src="journal-asset://fixture-asset-weekly"><img src="journal-asset://${sharedId}">`,
    commitmentText: '',
    commitmentCriteria: '',
    previousCommitmentResult: null,
    metricsSnapshot: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  }]
  snapshot.quickNotes = [{
    id: 'fixture-quick-note',
    title: '性能附件哨兵',
    contentHtml: `<img src="journal-asset://fixture-asset-quick"><img src="journal-asset://${sharedId}">`,
    pinned: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }]
  snapshot.reviewTemplates = []
  return snapshot
}

function collectAssets(snapshot) {
  const ids = new Set()
  const collect = (html) => {
    const matcher = /journal-asset:\/\/([^"'\s>]+)/g
    let match
    while ((match = matcher.exec(html)) !== null) ids.add(match[1])
  }
  for (const trade of snapshot.trades) collect(trade.note)
  for (const review of snapshot.weeklyReviews ?? []) collect(review.contentHtml)
  for (const note of snapshot.quickNotes ?? []) collect(note.contentHtml)
  return [...ids].sort().map((id) => ({
    id,
    mime: 'image/png',
    data: Buffer.from(`persistence-fixture:${id}`).toString('base64'),
  }))
}

function createDataset(count) {
  const snapshot = addAttachmentDomains(createAnalyticsSnapshot({
    count,
    seed: ANALYTICS_FIXTURE_SEED,
    noteProfile: '2kb',
  }))
  const json = JSON.stringify(snapshot)
  return {
    label: count === 10_000 ? '10k' : '20k',
    snapshot,
    assets: collectAssets(snapshot),
    expectedHash: checksumFixture(snapshot),
    bytes: Buffer.byteLength(json, 'utf8'),
  }
}

async function runWebBenchmarks(datasets) {
  const server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, open: false },
  })
  let browser
  try {
    await server.listen()
    const baseUrl = server.resolvedUrls?.local[0]
    if (!baseUrl) throw new Error('Vite 性能服务器未返回本地地址')
    browser = await chromium.launch({
      headless: true,
      args: ['--enable-precise-memory-info'],
    })
    const results = []
    for (const dataset of datasets) {
      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        await page.goto(new URL('/scripts/persistence-benchmark.html', baseUrl).href)
        await page.waitForFunction(() => typeof window.runWebPersistenceBenchmark === 'function')
        results.push(await page.evaluate(async (input) => {
          if (!window.runWebPersistenceBenchmark) throw new Error('Web 性能入口未加载')
          return window.runWebPersistenceBenchmark(input)
        }, {
          label: dataset.label,
          snapshot: dataset.snapshot,
          assets: dataset.assets,
          expectedHash: dataset.expectedHash,
          ...sampleConfig,
        }))
      } finally {
        await context.close()
      }
    }
    return { results, chromiumVersion: browser.version() }
  } finally {
    await browser?.close()
    await server.close()
  }
}

async function loadElectronBenchmarkModule() {
  const outDir = path.join(root, '.tmp-persistence-benchmark')
  await fs.rm(outDir, { recursive: true, force: true })
  await build({
    configFile: path.join(root, 'vite.config.ts'),
    logLevel: 'error',
    build: {
      ssr: path.join(root, 'electron/library/persistenceBenchmark.ts'),
      outDir,
      emptyOutDir: true,
      rolldownOptions: { output: { entryFileNames: 'runner.mjs' } },
    },
  })
  return {
    module: await import(`${pathToFileURL(path.join(outDir, 'runner.mjs')).href}?t=${Date.now()}`),
    cleanup: () => fs.rm(outDir, { recursive: true, force: true }),
  }
}

function checkGate(name, actual, limit, failures) {
  if (!Number.isFinite(actual) || actual > limit) {
    failures.push(`${name}: ${actual.toFixed(2)}ms > ${limit}ms`)
  }
}

const datasets = [createDataset(10_000), createDataset(20_000)]
const webRun = await runWebBenchmarks(datasets)
const web = webRun.results
const electronBundle = await loadElectronBenchmarkModule()
let electron
try {
  electron = []
  for (const dataset of datasets) {
    electron.push(await electronBundle.module.runElectronPersistenceBenchmark({
      label: dataset.label,
      snapshot: dataset.snapshot,
      assets: dataset.assets,
      expectedHash: dataset.expectedHash,
      ...sampleConfig,
      measureQuit: dataset.label === '10k',
    }))
  }
} finally {
  await electronBundle.cleanup()
}

const failures = []
const web10k = web.find((item) => item.label === '10k')
const web20k = web.find((item) => item.label === '20k')
const electron10k = electron.find((item) => item.label === '10k')
const electron20k = electron.find((item) => item.label === '20k')
checkGate('Web 10K CAS save p95', p95(web10k.saveSamplesMs), limits.web10kSaveP95Ms, failures)
checkGate('Web 20K CAS save p95', p95(web20k.saveSamplesMs), limits.web20kSaveP95Ms, failures)
checkGate('Web dirty→confirmed 10K p95', p95(web10k.dirtyConfirmedSamplesMs), limits.webDirtyConfirmedP95Ms, failures)
checkGate('Web dirty→confirmed 20K p95', p95(web20k.dirtyConfirmedSamplesMs), limits.webDirtyConfirmedP95Ms, failures)
checkGate('Web stale conflict 10K p95', p95(web10k.staleConflictSamplesMs), limits.webStaleConflictP95Ms, failures)
checkGate('Web stale conflict 20K p95', p95(web20k.staleConflictSamplesMs), limits.webStaleConflictP95Ms, failures)
checkGate('Web UI main-thread block 10K', Math.max(0, ...web10k.longTaskSamplesMs), limits.webMainThreadBlockMs, failures)
checkGate('Electron 10K save p95', p95(electron10k.saveSamplesMs), limits.electron10kSaveP95Ms, failures)
checkGate('Electron 20K save p95', p95(electron20k.saveSamplesMs), limits.electron20kSaveP95Ms, failures)
if (web10k.maxPendingSnapshotCount > 1 || web20k.maxPendingSnapshotCount > 1) {
  failures.push(`persistence pending 未合并：10K=${web10k.maxPendingSnapshotCount}, 20K=${web20k.maxPendingSnapshotCount}`)
}
if (electron10k.quitSamplesMs?.length) {
  checkGate('QuitCoordinator 10K p95', p95(electron10k.quitSamplesMs), limits.quitCoordinatorP95Ms, failures)
}

const provenance = await readGitProvenance(root)
const report = {
  scenarioId: 'P-10K/20K',
  version: 1,
  mode,
  generatedAt: new Date().toISOString(),
  gitCommit: provenance.gitCommit,
  gitTree: provenance.gitTree,
  workingTreeDirty: provenance.workingTreeDirty,
  sourceFingerprint: provenance.sourceFingerprint,
  sourceIdentity: provenance.sourceIdentity,
  generator: {
    seed: ANALYTICS_FIXTURE_SEED,
    datasets: datasets.map(({ label, expectedHash, bytes, snapshot, assets }) => ({
      label,
      tradeCount: snapshot.trades.length,
      bytes,
      sha256: expectedHash,
      assetCount: assets.length,
    })),
  },
  environment: {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
    chromium: webRun.chromiumVersion,
    electron: JSON.parse(await fs.readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version,
    sqlJs: JSON.parse(await fs.readFile(path.join(root, 'node_modules/sql.js/package.json'), 'utf8')).version,
  },
  sampleConfig,
  limits,
  web,
  electron,
  summaries: {
    web10kSaveP95Ms: p95(web10k.saveSamplesMs),
    web20kSaveP95Ms: p95(web20k.saveSamplesMs),
    electron10kSaveP95Ms: p95(electron10k.saveSamplesMs),
    electron20kSaveP95Ms: p95(electron20k.saveSamplesMs),
    web10kDirtyConfirmedP95Ms: p95(web10k.dirtyConfirmedSamplesMs),
    web20kDirtyConfirmedP95Ms: p95(web20k.dirtyConfirmedSamplesMs),
    web10kStaleConflictP95Ms: p95(web10k.staleConflictSamplesMs),
    web20kStaleConflictP95Ms: p95(web20k.staleConflictSamplesMs),
    web10kMaxLongTaskMs: Math.max(0, ...web10k.longTaskSamplesMs),
    web20kMaxLongTaskMs: Math.max(0, ...web20k.longTaskSamplesMs),
    quitCoordinatorP95Ms: electron10k.quitSamplesMs?.length ? p95(electron10k.quitSamplesMs) : null,
  },
  status: failures.length === 0 ? 'pass' : 'fail',
  failures,
}
const reportDir = path.join(root, 'test-results', 'persistence-benchmark')
await fs.mkdir(reportDir, { recursive: true })
const reportPath = path.join(reportDir, `persistence-${mode}.json`)
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ reportPath, status: report.status, summaries: report.summaries }, null, 2))
if (failures.length > 0) throw new Error(`真实持久化 SLO 未达标：\n${failures.join('\n')}`)
