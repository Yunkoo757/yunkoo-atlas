import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

import {
  discoverUnitTestEntries,
} from './test-discovery.mjs'
import { runBrowserRegressionTests } from './run-browser-tests.mjs'
import { readGitProvenance } from './git-provenance.mjs'
import { writeExecutionReport } from './quality-execution.mjs'

const root = process.cwd()
const originalNodeEnv = process.env.NODE_ENV

function restoreNodeEnv() {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
}

const unitOnly = process.argv.includes('--unit-only')
const requestedEntries = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))
const provenance = requestedEntries.length === 0 ? await readGitProvenance(root) : null
const discoveredEntries = await discoverUnitTestEntries(root)
for (const entry of requestedEntries) {
  if (!discoveredEntries.includes(entry)) throw new Error(`requested unit test is not discoverable: ${entry}`)
}
const entries = requestedEntries.length > 0 ? requestedEntries : discoveredEntries

let failed = 0
const passedEntries = []
const passedTests = []
const outputParent = path.join(root, 'test-results')
await fs.mkdir(outputParent, { recursive: true })
for (const entry of entries) {
  let entryFailed = false
  const outDir = await fs.mkdtemp(path.join(outputParent, `regression-${entry.replace(/\W/g, '-')}-`))
  try {
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
    restoreNodeEnv()

    const moduleUrl = pathToFileURL(path.join(outDir, 'runner.mjs'))
    moduleUrl.searchParams.set('entry', entry)
    const mod = await import(moduleUrl.href)
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
        passedTests.push(`${entry}#${name}`)
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
    restoreNodeEnv()
    await fs.rm(outDir, { recursive: true, force: true })
  }
  if (!entryFailed) passedEntries.push(entry)
}

const browserResult = unitOnly
  ? { failed: 0, passedEntries: [], passedTests: [] }
  : await runBrowserRegressionTests(root, { configFile: path.resolve('vite.config.ts') })
failed += browserResult.failed

if (failed > 0) {
  process.exitCode = 1
} else if (provenance) {
  await writeExecutionReport(
    root,
    provenance,
    [...passedEntries, ...browserResult.passedEntries],
    [...passedTests, ...browserResult.passedTests],
  )
}

if (process.send && requestedEntries.length > 0) {
  process.send({ type: 'unit-regression-result', passedEntries, passedTests })
}
