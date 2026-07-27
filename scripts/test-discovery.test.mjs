import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'

import {
  discoverBrowserTests,
  discoverUnitTestEntries,
  settleBrowserDiagnostics,
  unexpectedBrowserDiagnostics,
} from './test-discovery.mjs'

async function withFixture(run) {
  const fixtureParent = path.join(process.cwd(), 'test-results')
  await fs.mkdir(fixtureParent, { recursive: true })
  const root = await fs.mkdtemp(path.join(fixtureParent, '.tmp-test-discovery-'))
  try {
    await run(root)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function write(root, relativePath, content = '') {
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}

test('unit discovery includes new tests without a runner allowlist', async () => {
  await withFixture(async (root) => {
    await write(root, 'src/domain/newRule.test.ts')
    await write(root, 'src/domain/browserOnly.browser.test.ts')
    await write(root, 'electron/library/storage.test.ts')
    await write(root, 'src/storage/assets.test.ts')

    const entries = await discoverUnitTestEntries(root, {
      excluded: ['src/storage/assets.test.ts'],
    })

    assert.deepEqual(entries, [
      'electron/library/storage.test.ts',
      'src/domain/newRule.test.ts',
    ])
  })
})

test('browser discovery derives one promise key from each HTML contract', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'src/components/Sample.browser.test.html',
      '<script type="module" src="/src/components/Sample.browser.test.tsx"></script>',
    )
    await write(
      root,
      'src/components/Sample.browser.test.tsx',
      'window.__sampleBrowserTest = run()\n',
    )
    await write(
      root,
      'src/storage/Inline.browser.test.html',
      '<script type="module">window.__inlineBrowserTest = Promise.resolve()</script>',
    )

    assert.deepEqual(await discoverBrowserTests(root), [
      {
        url: '/src/components/Sample.browser.test.html',
        promiseKey: '__sampleBrowserTest',
        label: 'src/components/Sample.browser.test.html',
      },
      {
        url: '/src/storage/Inline.browser.test.html',
        promiseKey: '__inlineBrowserTest',
        label: 'src/storage/Inline.browser.test.html',
      },
    ])
  })
})

test('browser discovery rejects pages without one unambiguous promise key', async () => {
  await withFixture(async (root) => {
    await write(root, 'src/components/Missing.browser.test.html', '<main>missing contract</main>')

    await assert.rejects(
      () => discoverBrowserTests(root),
      /exactly one browser test promise key/,
    )
  })
})

test('browser discovery rejects duplicate stable test IDs across pages', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'src/components/First.browser.test.html',
      '<script type="module">window.__duplicateBrowserTest = Promise.resolve()</script>',
    )
    await write(
      root,
      'src/components/Second.browser.test.html',
      '<script type="module">window.__duplicateBrowserTest = Promise.resolve()</script>',
    )

    await assert.rejects(() => discoverBrowserTests(root), /duplicate browser test ID/)
  })
})

test('browser diagnostics fail unless the page explicitly allows their message', () => {
  assert.deepEqual(
    unexpectedBrowserDiagnostics(
      [
        'console: expected capacity error',
        'pageerror: unexpected crash',
      ],
      ['expected capacity error'],
    ),
    ['pageerror: unexpected crash'],
  )
  assert.deepEqual(
    unexpectedBrowserDiagnostics(
      ['console: unrelated prefix: expected capacity error'],
      ['expected capacity error'],
    ),
    ['console: unrelated prefix: expected capacity error'],
  )
})

test('browser diagnostic settle window catches an error emitted after the old 25ms window', async () => {
  const diagnostics = []
  const page = {
    waitForTimeout(milliseconds) {
      return new Promise((resolve) => setTimeout(resolve, milliseconds))
    },
  }
  setTimeout(() => diagnostics.push('pageerror: late fixture failure'), 26)
  await settleBrowserDiagnostics(page)
  assert.deepEqual(diagnostics, ['pageerror: late fixture failure'])
})

test('real browser runner exits nonzero when a page errors after its promise resolves', async () => {
  await withFixture(async (root) => {
    await write(root, 'src/Late.browser.test.html', `<!doctype html>
      <script>
        window.__lateBrowserTest = Promise.resolve()
        setTimeout(() => { throw new Error('late real pageerror fixture') }, 26)
      </script>`)
    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/run-browser-tests.mjs'), root],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 20_000 },
    )
    assert.equal(result.status, 1, `runner output:\n${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /late real pageerror fixture/)
  })
})

test('browser runner explicitly allows its isolated fixture root', async () => {
  const source = await fs.readFile(path.resolve('scripts/run-browser-tests.mjs'), 'utf8')
  assert.match(source, /fs:\s*\{\s*allow:\s*\[root\]\s*\}/)
})

test('browser runner retries only the transient Windows socket exhaustion error', async () => {
  const source = await fs.readFile(path.resolve('scripts/run-browser-tests.mjs'), 'utf8')
  assert.match(source, /net::ERR_NO_BUFFER_SPACE/)
  assert.match(source, /attempt < 2/)
})

test('sidebar QA retries once in a fresh process', async () => {
  const source = await fs.readFile(path.resolve('scripts/run-qa-sidebar.mjs'), 'utf8')
  assert.match(source, /attempt < 2/)
  assert.match(source, /spawnSync\(process\.execPath, \['scripts\/qa-sidebar-navigation\.mjs'\]/)
})

test('image QA retries once in a fresh process', async () => {
  const source = await fs.readFile(path.resolve('scripts/run-qa-image.mjs'), 'utf8')
  assert.match(source, /attempt < 2/)
  assert.match(source, /spawnSync\(process\.execPath, \['scripts\/qa-phase1-image\.mjs'\]/)
})

test('sidebar QA targets the live mobile drawer instead of its exit clone', async () => {
  const source = await fs.readFile(path.resolve('scripts/qa-sidebar-navigation.mjs'), 'utf8')
  assert.match(
    source,
    /const drawer = page\.locator\('\.mobile-navigation-overlay:not\(\.ui-exit-clone\)'\)\.getByRole\('dialog', \{ name: '更多' \}\)/,
  )
  assert.match(
    source,
    /await moreButton\.click\(\)\s+await expectVisible\(drawer\)\s+await expectAttribute\(moreButton, 'aria-expanded', 'true'\)[\s\S]*await moreButton\.evaluate/,
  )
  assert.match(source, /await page\.locator\('\.mobile-navigation > a\[aria-label="今日"\]'\)\.click\(\)\s+await expectCount\(drawer, 0\)\s+await expectCount\(page\.locator\('\.mobile-navigation-overlay'\), 0\)\s+await moreButton\.click\(\)/)
  assert.match(source, /await drawer\.getByRole\('button', \{ name: '搜索', exact: true \}\)\.click\(\)/)
})

test('sidebar QA verifies restored defaults in a fresh document', async () => {
  const source = await fs.readFile(path.resolve('scripts/qa-sidebar-navigation.mjs'), 'utf8')
  assert.match(source, /const restoredPage = await browser\.newPage\(\{ viewport: \{ width: 1440, height: 900 \} \}\)/)
  assert.match(source, /await restoredPage\.goto\(`\$\{BASE\}\/list`, \{ waitUntil: 'domcontentloaded' \}\)/)
})

test('sidebar QA verifies removed views in a fresh document', async () => {
  const source = await fs.readFile(path.resolve('scripts/qa-sidebar-navigation.mjs'), 'utf8')
  assert.match(source, /const removedViewPage = await browser\.newPage\(\{ viewport: \{ width: 1440, height: 900 \} \}\)/)
  assert.match(source, /await removedViewPage\.goto\(`\$\{BASE\}\/list`, \{ waitUntil: 'domcontentloaded' \}\)/)
})

test('image QA dispatches an image ClipboardEvent without the system clipboard', async () => {
  const source = await fs.readFile(path.resolve('scripts/qa-phase1-image.mjs'), 'utf8')
  assert.match(source, /\.ProseMirror\[contenteditable="true"\]/)
  assert.match(source, /const transfer = new DataTransfer\(\)/)
  assert.match(source, /new ClipboardEvent\('paste', \{[\s\S]*clipboardData: transfer/)
  assert.doesNotMatch(source, /navigator\.clipboard\.write/)
  assert.doesNotMatch(source, /navigator, 'locks'/)
})

test('workbench QA follows enabled modal controls and the current dashboard scope label', async () => {
  const source = await fs.readFile(path.resolve('scripts/qa-workbench.mjs'), 'utf8')
  assert.match(source, /const closeDialogLastFocusable = closeDialog\.locator\('button:not\(:disabled\):visible, input:not\(:disabled\):visible'\)\.last\(\)/)
  assert.match(source, /getByRole\('button', \{ name: '实盘 \+ 模拟盘' \}\)\.click\(\)/)
})
// Quality-Scenario: Q-DISCOVERY
// Quality-Scenario: Q-PAGEERROR
