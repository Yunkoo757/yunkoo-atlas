import { build, createServer } from 'vite'
import { chromium } from 'playwright'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'

const entries = [
  'src/regression.test.ts',
  'src/lib/analyticsScope.test.ts',
  'src/lib/rDistribution.test.ts',
  'src/lib/reviewAnalytics.test.ts',
  'src/lib/tradeTruth.test.ts',
  'src/lib/tradeCalc.test.ts',
  'src/lib/tradeClose.test.ts',
  'src/lib/tradeCloseStore.test.ts',
  'src/lib/tradeResult.test.ts',
  'src/lib/tradeComposerSave.test.ts',
  'src/lib/csvImport.test.ts',
  'src/lib/format.test.ts',
  'src/lib/tradeTransition.test.ts',
  'src/lib/tradeWorkflow.test.ts',
  'src/lib/importExportAssets.test.ts',
  'src/lib/importConcurrency.test.ts',
  'src/lib/notionImportCommit.test.ts',
  'src/lib/notionImportLimits.test.ts',
  'src/lib/librarySwitchRace.test.ts',
  'src/lib/tradeDuplicates.test.ts',
  'src/lib/lightboxView.test.ts',
  'src/shortcuts/bindingOverwrite.test.ts',
  'src/shortcuts/listActions.test.ts',
  'src/shortcuts/workspaceActions.test.ts',
  'src/icons/linear/linear-icons.test.tsx',
  'src/components/Menu.design.test.ts',
  'src/views/TradeTrashView.design.test.ts',
  'src/views/WorkbenchEmptyState.design.test.ts',
  'src/views/WorkbenchPerformance.design.test.ts',
  'src/views/DashboardAnalytics.test.ts',
  'src/views/detailNoteLoad.test.ts',
  'src/lib/appUpdate.test.ts',
  'src/lib/windowBounds.test.ts',
  'src/lib/persistenceSafety.test.ts',
  'src/lib/productFlowPolish.test.ts',
  'src/lib/workbenchEmptyState.test.ts',
  'src/storage/snapshotValidation.test.ts',
  'src/storage/persist.test.ts',
  'src/storage/noteDrafts.test.ts',
  'src/storage/pendingOperations.test.ts',
  'src/storage/assetId.test.ts',
  'electron/library/images.test.ts',
  'electron/library/atomicFile.test.ts',
  'electron/library/sessionGate.test.ts',
  'electron/library/libraryActivation.test.ts',
  'electron/library/importCommit.test.ts',
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
  const browserTests = [
    {
      url: '/src/components/ImportModalRace.browser.test.html',
      promiseKey: '__importModalRaceTest',
      label: 'src/components/ImportModalRace.browser.test.tsx :: latest file and duplicate scan generation wins',
    },
    {
      url: '/src/components/NotionImportModal.browser.test.html',
      promiseKey: '__notionImportPersistenceTest',
      label: 'src/components/NotionImportModal.browser.test.tsx :: persistence rollback feedback',
    },
    {
      url: '/src/components/CsvImportModal.browser.test.html',
      promiseKey: '__csvImportPersistenceTest',
      label: 'src/components/CsvImportModal.browser.test.tsx :: persistence failure feedback',
    },
    {
      url: '/src/components/TradeCloseDialog.browser.test.html',
      promiseKey: '__tradeCloseDualMetricsTest',
      label: 'src/components/TradeCloseDialog.browser.test.tsx :: cash and R remain visible and persist together',
    },
    {
      url: '/src/components/RouteState.browser.test.html',
      promiseKey: '__routeStateTest',
      label: 'src/components/RouteState.browser.test.tsx :: route recovery and delayed loading',
    },
    {
      url: '/src/editor/imageLoadFailure.browser.test.html',
      promiseKey: '__editorImageLoadFailureTest',
      label: 'src/editor/imageLoadFailure.browser.test.ts :: testEditorImageLoadFailureUsesNonDocumentDecorations',
    },
    {
      url: '/src/editor/EditorImagePersistence.browser.test.html',
      promiseKey: '__editorImagePersistenceTest',
      label: 'src/editor/EditorImagePersistence.browser.test.tsx :: slow image persistence survives editor unmount',
    },
    {
      url: '/src/storage/assets.browser.test.html',
      promiseKey: '__storageAssetsTest',
      label: 'src/storage/assets.test.ts :: browser asset failure handling',
    },
    {
      url: '/src/storage/noteDrafts.browser.test.html',
      promiseKey: '__noteDraftOrderingTest',
      label: 'src/storage/noteDrafts.browser.test.ts :: latest draft wins slow image normalization',
    },
    {
      url: '/src/storage/cutover.browser.test.html',
      promiseKey: '__storageCutoverTest',
      label: 'src/storage/cutover.browser.test.ts :: cutover blocks shortcuts and portals',
    },
  ]
  const page = await browser.newPage()
  for (const browserTest of browserTests) {
    try {
      await page.goto(new URL(browserTest.url, baseUrl).href)
      await page.waitForFunction((key) => key in window, browserTest.promiseKey, { timeout: 5000 })
      await page.evaluate((key) => window[key], browserTest.promiseKey)
      console.log(`PASS ${browserTest.label}`)
    } catch (err) {
      failed += 1
      console.error(`FAIL ${browserTest.label}`)
      console.error(err)
    }
  }
} catch (err) {
  failed += 1
  console.error('FAIL browser regression harness')
  console.error(err)
} finally {
  await browser?.close()
  await server.close()
}

if (failed > 0) {
  process.exitCode = 1
}
