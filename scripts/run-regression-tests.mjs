import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

import {
  discoverUnitTestEntries,
} from './test-discovery.mjs'
import { runBrowserRegressionTests } from './run-browser-tests.mjs'
import { executionReportPath, writeExecutionReport } from './quality-execution.mjs'

const root = process.cwd()
const discoveredEntries = await discoverUnitTestEntries(root, {
  // 该文件依赖真实 DOM，通过 assets.browser.test.html 执行。
  excluded: ['src/storage/assets.test.ts'],
})
const unitOnly = process.argv.includes('--unit-only')
const requestedEntries = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
for (const entry of requestedEntries) {
  if (!discoveredEntries.includes(entry)) throw new Error(`requested unit test is not discoverable: ${entry}`)
}
const entries = requestedEntries.length > 0 ? requestedEntries : discoveredEntries

let failed = 0
const passedEntries = []
for (const entry of entries) {
  let entryFailed = false
  const outDir = path.resolve(`.tmp-${path.basename(entry).replace(/\W/g, '-')}`)
  try {
    await fs.rm(outDir, { recursive: true, force: true })
    await build({
      configFile: path.resolve('vite.config.ts'),
      logLevel: 'error',
      build: {
        ssr: path.resolve(entry),
        outDir,
        emptyOutDir: true,
        rolldownOptions: {
          output: {
            entryFileNames: 'runner.mjs',
          },
        },
      },
    })

    const mod = await import(pathToFileURL(path.join(outDir, 'runner.mjs')).href)
    const tests = Object.entries(mod).filter(
      ([name, value]) => name.startsWith('test') && typeof value === 'function',
    )
    if (tests.length === 0) {
      throw new Error('no exported tests found')
    }

    for (const [name, test] of tests) {
      try {
        await test()
        console.log(`PASS ${entry} :: ${name}`)
      } catch (error) {
        failed += 1
        entryFailed = true
        console.error(`FAIL ${entry} :: ${name}`)
        console.error(error)
      }
    }
  } catch (error) {
    failed += 1
    entryFailed = true
    console.error(`FAIL ${entry} :: test module could not run`)
    console.error(error)
  } finally {
    await fs.rm(outDir, { recursive: true, force: true })
  }
  if (!entryFailed) passedEntries.push(entry)
}

const browserResult = unitOnly
  ? { failed: 0, passedEntries: [] }
  : await runBrowserRegressionTests(root, { configFile: path.resolve('vite.config.ts') })
failed += browserResult.failed

if (failed > 0) {
  process.exitCode = 1
} else if (requestedEntries.length === 0) {
  let previousFiles = []
  try {
    const previous = JSON.parse(await fs.readFile(executionReportPath(root), 'utf8'))
    previousFiles = Object.keys(previous.executedFiles ?? {})
  } catch {}
  await writeExecutionReport(root, [...previousFiles, ...passedEntries, ...browserResult.passedEntries])
}
