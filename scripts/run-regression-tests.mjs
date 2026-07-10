import { build } from 'vite'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'

const entries = [
  'src/regression.test.ts',
  'src/lib/reviewAnalytics.test.ts',
  'src/lib/importExportAssets.test.ts',
]

let failed = 0
for (const entry of entries) {
  const outDir = path.resolve(`.tmp-${path.basename(entry).replace(/\W/g, '-')}`)
  await fs.rm(outDir, { recursive: true, force: true })

  await build({
    configFile: path.resolve('vite.config.ts'),
    logLevel: 'error',
    build: {
      ssr: path.resolve(entry),
      outDir,
      emptyOutDir: true,
      rollupOptions: {
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
    failed += 1
    console.error(`FAIL ${entry} :: no exported tests found`)
  }

  for (const [name, test] of tests) {
    try {
      await test()
      console.log(`PASS ${entry} :: ${name}`)
    } catch (err) {
      failed += 1
      console.error(`FAIL ${entry} :: ${name}`)
      console.error(err)
    }
  }

  await fs.rm(outDir, { recursive: true, force: true })
}

if (failed > 0) {
  process.exitCode = 1
}
