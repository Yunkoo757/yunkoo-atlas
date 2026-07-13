import { build, createServer } from 'vite'
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'

  const entries = [
  'src/regression.test.ts',
  'src/lib/reviewAnalytics.test.ts',
  'src/lib/tradeTruth.test.ts',
  'src/lib/tradeCalc.test.ts',
  'src/lib/tradeClose.test.ts',
  'src/lib/tradeTransition.test.ts',
  'src/lib/tradeWorkflow.test.ts',
  'src/lib/importExportAssets.test.ts',
  'src/lib/tradeDuplicates.test.ts',
  'src/lib/lightboxView.test.ts',
  'src/shortcuts/bindingOverwrite.test.ts',
  'src/shortcuts/workspaceActions.test.ts',
  'src/icons/linear/linear-icons.test.tsx',
  'src/components/Menu.design.test.ts',
  'src/views/TradeTrashView.design.test.ts',
  'src/lib/appUpdate.test.ts',
  'src/lib/windowBounds.test.ts',
  'electron/library/images.test.ts',
  'electron/library/backup.test.ts',
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

const server = await createServer({
  configFile: path.resolve('vite.config.ts'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, open: false },
})
let browser
try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  if (!baseUrl) throw new Error('Vite test server did not expose a local URL')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(new URL('/src/editor/imageLoadFailure.browser.test.html', baseUrl).href)
  await page.waitForFunction(() => '__editorImageLoadFailureTest' in window, null, { timeout: 5000 })
  await page.evaluate(() => window.__editorImageLoadFailureTest)
  console.log('PASS src/editor/imageLoadFailure.browser.test.ts :: testEditorImageLoadFailureUsesNonDocumentDecorations')
} catch (err) {
  failed += 1
  console.error('FAIL src/editor/imageLoadFailure.browser.test.ts :: testEditorImageLoadFailureUsesNonDocumentDecorations')
  console.error(err)
} finally {
  await browser?.close()
  await server.close()
}

if (failed > 0) {
  process.exitCode = 1
}
