import { build } from 'vite'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'

const outDir = path.resolve('.tmp-regression-tests')
const entry = path.resolve('src/regression.test.ts')

await fs.rm(outDir, { recursive: true, force: true })

await build({
  configFile: path.resolve('vite.config.ts'),
  logLevel: 'error',
  build: {
    ssr: entry,
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

let failed = 0
for (const [name, test] of tests) {
  try {
    await test()
    console.log(`PASS ${name}`)
  } catch (err) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(err)
  }
}

await fs.rm(outDir, { recursive: true, force: true })

if (failed > 0) {
  process.exitCode = 1
}
