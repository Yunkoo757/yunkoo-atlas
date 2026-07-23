import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-test-discovery-'))
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
// Quality-Scenario: Q-DISCOVERY
// Quality-Scenario: Q-PAGEERROR
