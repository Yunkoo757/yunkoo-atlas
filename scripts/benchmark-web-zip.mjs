import path from 'node:path'
import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { readGitProvenance } from './git-provenance.mjs'

const root = process.cwd()
const release = process.argv.includes('--release')
const MiB = 1024 * 1024
const assetSizes = release
  ? [32, 32, 32, 32, 32, 32, 32, 31].map((size) => size * MiB)
  : [4, 4].map((size) => size * MiB)
const limitBytes = 512 * MiB
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
let browser
let context
let pageCrashed = false
try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  if (!baseUrl) throw new Error('Web ZIP benchmark Vite URL unavailable')
  browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] })
  context = await browser.newContext()
  let page = await context.newPage()
  page.on('crash', () => { pageCrashed = true })
  await page.goto(new URL('/scripts/web-zip-benchmark.html', baseUrl).href)
  await page.waitForFunction(() => typeof window.prepareWebZipBenchmark === 'function')
  await page.evaluate((sizes) => window.prepareWebZipBenchmark?.({ assetSizes: sizes }), assetSizes)
  await page.close()
  page = await context.newPage()
  page.on('crash', () => { pageCrashed = true })
  await page.goto(new URL('/scripts/web-zip-benchmark.html', baseUrl).href)
  await page.waitForFunction(() => typeof window.runWebZipBenchmark === 'function')
  const result = await page.evaluate(() => window.runWebZipBenchmark?.())
  if (!result) throw new Error('Web ZIP benchmark did not return a result')
  const failures = []
  if (pageCrashed) failures.push('Chromium page crashed')
  if (result.peakJsHeapBytes >= limitBytes) failures.push(`peak JS heap ${result.peakJsHeapBytes} >= ${limitBytes}`)
  const provenance = await readGitProvenance(root)
  const report = {
    version: 1,
    mode: release ? 'release' : 'smoke',
    generatedAt: new Date().toISOString(),
    gitCommit: provenance.gitCommit,
    gitTree: provenance.gitTree,
    workingTreeDirty: provenance.workingTreeDirty,
    sourceFingerprint: provenance.sourceFingerprint,
    sourceIdentity: provenance.sourceIdentity,
    declaredExpandedBytes: assetSizes.reduce((sum, size) => sum + size, 0),
    limitBytes,
    pageCrashed,
    ...result,
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
  }
  const directory = path.join(root, 'test-results', 'persistence-benchmark')
  await fs.mkdir(directory, { recursive: true })
  const reportPath = path.join(directory, `web-zip-${report.mode}.json`)
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ reportPath, status: report.status, peakJsHeapBytes: report.peakJsHeapBytes }, null, 2))
  if (failures.length > 0) throw new Error(`Web ZIP heap SLO failed: ${failures.join('; ')}`)
} finally {
  await context?.close()
  await browser?.close()
  await server.close()
}
