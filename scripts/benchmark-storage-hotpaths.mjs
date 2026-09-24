import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import { createAnalyticsSnapshot } from './fixtures/analytics-trades.mjs'

// 全部数据均为内存夹具，不打开资料库。临时构建只位于当前仓库专用目录。
const root = fileURLToPath(new URL('..', import.meta.url))
const outputIndex = process.argv.indexOf('--output')
const output = path.resolve(root, outputIndex >= 0
  ? process.argv[outputIndex + 1]
  : 'test-results/performance-storage/current.json')
const warmups = 1
const samples = 3
const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]
const sourceFiles = [
  'src/store/useStore.ts',
  'src/storage/persist.ts',
  'src/storage/persistedSnapshotCoordinator.ts',
  'src/storage/snapshotValidation.ts',
  'src/storage/fixtures/fullPersistedSnapshot.ts',
  'scripts/fixtures/analytics-trades.mjs',
]
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
  file,
  createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex'),
])))
const temporary = await fs.mkdtemp(path.join(root, '.tmp-storage-hotpaths-'))
const results = {
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, architecture: process.arch, cpu: os.cpus()[0]?.model },
  methodology: { warmups, samples, statistic: 'median', durableWrites: false, validationFixture: 'one weekly review referencing every synthetic trade' },
  sourceHashes,
  batch: [],
  validation: [],
  scheduledNonPersistentChanges: 0,
}

try {
  const entry = path.join(temporary, 'entry.ts')
  await fs.writeFile(entry, [
    "export { applyTradeUpsertsToSlice, useStore } from '@/store/useStore'",
    "export { pickPersisted } from '@/storage/persist'",
    "export { createPersistedSnapshotCoordinator } from '@/storage/persistedSnapshotCoordinator'",
    "export { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'",
    "export { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'",
  ].join('\n'), 'utf8')
  await build({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    logLevel: 'error',
    build: {
      ssr: entry,
      outDir: path.join(temporary, 'dist'),
      emptyOutDir: true,
      rolldownOptions: { output: { entryFileNames: 'runner.mjs' } },
    },
  })
  const mod = await import(pathToFileURL(path.join(temporary, 'dist', 'runner.mjs')).href)
  for (const count of [10_000, 20_000]) {
    const fixture = createAnalyticsSnapshot({ count })
    const slice = { ...fixture, tagPresets: [], mistakeTagPresets: [], symbolCatalog: [] }
    for (const mode of ['insert', 'update']) {
      const initial = mode === 'insert' ? { ...slice, trades: [] } : slice
      const timings = []
      for (let index = 0; index < warmups + samples; index++) {
        const start = performance.now()
        const result = mod.applyTradeUpsertsToSlice(initial, fixture.trades, 0, fixture.currentLiveStageId)
        const elapsed = performance.now() - start
        assert.equal(result.trades.length, count)
        if (index >= warmups) timings.push(elapsed)
      }
      results.batch.push({ count, mode, samplesMs: timings, medianMs: median(timings) })
    }

    const full = mod.createFullPersistedSnapshotFixture()
    full.trades = Array.from({ length: count }, (_, index) => ({ ...full.trades[0], id: `perf-trade-${index}` }))
    full.riskOverrideEvents = []
    full.weeklyReviews[0].highlightTradeIds = full.trades.map(trade => trade.id)
    full.weeklyReviews[0].mistakeTradeIds = []
    full.weeklyReviews[0].followUpTradeIds = []
    full.weeklyReviews[0].riskSnapshot = undefined
    full.weeklyReviews[0].evidenceSnapshot = undefined
    const timings = []
    for (let index = 0; index < warmups + samples; index++) {
      const start = performance.now()
      mod.assertValidPersistedSnapshot(full)
      if (index >= warmups) timings.push(performance.now() - start)
    }
    results.validation.push({ count, samplesMs: timings, medianMs: median(timings) })
  }

  let state = mod.useStore.getState()
  const capture = () => mod.pickPersisted(state, {})
  const coordinator = mod.createPersistedSnapshotCoordinator(capture(), {
    capture,
    schedule() { results.scheduledNonPersistentChanges++ },
  })
  for (let index = 0; index < 100; index++) {
    state = { ...state }
    coordinator.observe(capture(), { source: 'store' })
  }
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(results, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(results, null, 2))
  console.log(`Report: ${output}`)
} finally {
  const resolved = path.resolve(temporary)
  const relative = path.relative(root, resolved)
  if (!relative.startsWith('.tmp-storage-hotpaths-') || relative.includes(path.sep) || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove unexpected benchmark directory: ${resolved}`)
  }
  await fs.rm(resolved, { recursive: true, force: true })
}
