import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import {
  discoverBrowserTests,
  discoverUnitTestEntries,
  settleBrowserDiagnostics,
  unexpectedBrowserDiagnostics,
} from './test-discovery.mjs'
import {
  isTransientBrowserSocketExhaustion,
  runBrowserRegressionTests,
} from './run-browser-tests.mjs'

test('desktop-only package scripts do not publish the retired mobile risk QA', async () => {
  const pkg = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'))

  assert.equal(pkg.scripts['qa:risk-management-mobile'], undefined)
})

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

test('unit discovery includes the performance truth contract beside its fixture', async () => {
  await withFixture(async (root) => {
    await write(root, 'src/lib/performanceSelection.test.ts')
    await write(root, 'src/test/fixtures/performanceTruthFixture.ts')

    assert.deepEqual(await discoverUnitTestEntries(root), [
      'src/lib/performanceSelection.test.ts',
    ])
  })
})

test('browser discovery derives one promise key from each HTML contract', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'src/components/Sample.browser.test.html',
      `<meta name="atlas-browser-hover" content='[data-test-target="sample"]'>
      <script type="module" src="/src/components/Sample.browser.test.tsx"></script>`,
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
        hoverSelector: '[data-test-target="sample"]',
      },
      {
        url: '/src/storage/Inline.browser.test.html',
        promiseKey: '__inlineBrowserTest',
        label: 'src/storage/Inline.browser.test.html',
      },
    ])
  })
})

test('browser discovery expands declarative viewport metadata into real browser entries', async () => {
  await withFixture(async (root) => {
    await write(
      root,
      'src/components/Responsive.browser.test.html',
      `<meta name="atlas-browser-viewports" content="1440x900, 375x812">
      <script>window.__responsiveBrowserTest = Promise.resolve()</script>`,
    )

    assert.deepEqual(await discoverBrowserTests(root), [
      {
        url: '/src/components/Responsive.browser.test.html',
        promiseKey: '__responsiveBrowserTest',
        label: 'src/components/Responsive.browser.test.html',
      },
      {
        url: '/src/components/Responsive.browser.test.html',
        promiseKey: '__responsiveBrowserTest',
        label: 'src/components/Responsive.browser.test.html (1440×900)',
        viewport: { width: 1440, height: 900 },
      },
      {
        url: '/src/components/Responsive.browser.test.html',
        promiseKey: '__responsiveBrowserTest',
        label: 'src/components/Responsive.browser.test.html (375×812)',
        viewport: { width: 375, height: 812 },
      },
    ])
  })
})

test('browser runner performs declarative HTML hover setup before awaiting the test promise', async () => {
  await withFixture(async (root) => {
    await write(root, 'src/Hover.browser.test.html', `<!doctype html>
      <meta name="atlas-browser-hover" content="#hover-target">
      <button id="hover-target">Hover target</button>
      <script>
        window.__hoverBrowserTest = (async () => {
          await window.__atlasBrowserWaitForActions()
          if (document.querySelector('#hover-target').matches(':hover')) return
          throw new Error('runner did not perform declared hover')
        })()
      </script>`)

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/run-browser-tests.mjs'), root],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 20_000 },
    )
    assert.equal(result.status, 0, `runner output:\n${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /PASS src\/Hover\.browser\.test\.html/)
  })
})

test('browser runner applies every declared viewport before resolving the page contract', async () => {
  await withFixture(async (root) => {
    await write(root, 'src/Viewport.browser.test.html', `<!doctype html>
      <meta name="atlas-browser-viewports" content="1440x900, 375x812">
      <script>
        window.__viewportBrowserTest = (async () => {
          await window.__atlasBrowserWaitForActions()
          const size = window.innerWidth + 'x' + window.innerHeight
          if (size === '1280x720' || size === '1440x900' || size === '375x812') return
          throw new Error('runner did not apply declared viewport: ' + size)
        })()
      </script>`)

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts/run-browser-tests.mjs'), root],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 20_000 },
    )
    assert.equal(result.status, 0, `runner output:\n${result.stdout}\n${result.stderr}`)
    assert.match(`${result.stdout}\n${result.stderr}`, /PASS src\/Viewport\.browser\.test\.html$/m)
    assert.match(`${result.stdout}\n${result.stderr}`, /Viewport\.browser\.test\.html \(1440×900\)/)
    assert.match(`${result.stdout}\n${result.stderr}`, /Viewport\.browser\.test\.html \(375×812\)/)
  })
})

test('browser runner reports real files while viewport variants keep unique test IDs', async () => {
  await withFixture(async (root) => {
    await write(root, 'src/ViewportIdentity.browser.test.html', `<!doctype html>
      <meta name="atlas-browser-viewports" content="1440x900, 375x812">
      <script>
        window.__viewportIdentityBrowserTest = (async () => {
          await window.__atlasBrowserWaitForActions()
        })()
      </script>`)

    const result = await runBrowserRegressionTests(root)

    assert.equal(result.failed, 0)
    assert.deepEqual(result.passedEntries, [
      'src/ViewportIdentity.browser.test.html',
    ])
    assert.deepEqual(result.passedTests, [
      'src/ViewportIdentity.browser.test.html#__viewportIdentityBrowserTest',
      'src/ViewportIdentity.browser.test.html#__viewportIdentityBrowserTest@1440x900',
      'src/ViewportIdentity.browser.test.html#__viewportIdentityBrowserTest@375x812',
    ])
  })
})

test('browser runner executes only requested stable test IDs and returns structured progress', async () => {
  await withFixture(async (root) => {
    await write(root, 'src/First.browser.test.html', `<!doctype html>
      <script>window.__firstBrowserTest = Promise.resolve()</script>`)
    await write(root, 'src/Second.browser.test.html', `<!doctype html>
      <script>window.__secondBrowserTest = Promise.resolve()</script>`)
    const events = []

    const result = await runBrowserRegressionTests(root, {
      requestedTestIds: ['src/First.browser.test.html#__firstBrowserTest'],
      testTimeoutMs: 2_000,
      onEvent: (event) => events.push(event),
    })

    assert.equal(result.failed, 0)
    assert.deepEqual(result.passedEntries, ['src/First.browser.test.html'])
    assert.deepEqual(result.passedTests, ['src/First.browser.test.html#__firstBrowserTest'])
    assert.deepEqual(result.missingRequestedTestIds, [])
    assert(events.some((event) => event.type === 'start' && event.testId === 'src/First.browser.test.html#__firstBrowserTest'))
    assert(events.some((event) => event.type === 'pass' && event.testId === 'src/First.browser.test.html#__firstBrowserTest'))
  })
})

test('browser runner fails fast for an empty or unknown requested sample', async () => {
  await withFixture(async (root) => {
    await write(root, 'src/Only.browser.test.html', `<!doctype html>
      <script>window.__onlyBrowserTest = Promise.resolve()</script>`)

    const empty = await runBrowserRegressionTests(root, { requestedTestIds: [] })
    assert.equal(empty.failed, 1)
    assert.deepEqual(empty.missingRequestedTestIds, [])

    const unknown = await runBrowserRegressionTests(root, {
      requestedTestIds: ['src/Missing.browser.test.html#__missingBrowserTest'],
    })
    assert.equal(unknown.failed, 1)
    assert.deepEqual(unknown.missingRequestedTestIds, [
      'src/Missing.browser.test.html#__missingBrowserTest',
    ])
  })
})

test('browser runner times out a stalled requested fixture instead of hanging the suite', async () => {
  await withFixture(async (root) => {
    await write(root, 'src/Stalled.browser.test.html', `<!doctype html>
      <script>window.__stalledBrowserTest = new Promise(() => {})</script>`)

    const result = await runBrowserRegressionTests(root, {
      requestedTestIds: ['src/Stalled.browser.test.html#__stalledBrowserTest'],
      testTimeoutMs: 50,
    })

    assert.equal(result.failed, 1)
    assert.deepEqual(result.failedTests, ['src/Stalled.browser.test.html#__stalledBrowserTest'])
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
  assert.equal(
    isTransientBrowserSocketExhaustion(
      new Error('page.goto: net::ERR_NO_BUFFER_SPACE'),
      [],
    ),
    true,
  )
  assert.equal(
    isTransientBrowserSocketExhaustion(new Error('ordinary navigation failure'), []),
    false,
  )
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

test('core QA satisfies the quick composer content contract before saving', async () => {
  const source = await fs.readFile(path.resolve('scripts/qa-phase1.mjs'), 'utf8')
  const fillIndex = source.indexOf("getByLabel('一句话').fill(")
  const saveIndex = source.indexOf("locator('.composer-btn-primary').click()")
  const openIndex = source.indexOf("locator('.trade-row-open').first().click()")
  assert.ok(fillIndex >= 0, '核心 QA 必须填写快速记录的一句话必填项')
  assert.ok(saveIndex > fillIndex, '核心 QA 必须在填写一句话后再保存交易')
  assert.ok(openIndex > saveIndex, '快速记录留在列表后，核心 QA 必须主动打开新记录')
  assert.match(source, /url\.pathname === '\/list' && url\.searchParams\.get\('view'\) === 'missed'/)
  assert.match(source, /record\('交易日志错过机会筛选可访问'/)
  assert.match(source, /getByRole\('link', \{ name: '统计分析' \}\)/)
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

test('image QA supplies deterministic image clipboard items without the system clipboard', async () => {
  const source = await fs.readFile(path.resolve('scripts/qa-phase1-image.mjs'), 'utf8')
  const fillIndex = source.indexOf("getByLabel('一句话').fill(")
  const saveIndex = source.indexOf("locator('.composer-btn-primary').click()")
  const openIndex = source.indexOf("locator('.trade-row-open').first().click()")
  assert.ok(fillIndex >= 0 && saveIndex > fillIndex, '图片 QA 必须满足快速记录内容合同后再保存')
  assert.ok(openIndex > saveIndex, '图片 QA 必须从列表主动打开保存后的记录')
  assert.match(source, /\.ProseMirror\[contenteditable="true"\]/)
  assert.match(source, /new ClipboardEvent\('paste', \{ bubbles: true, cancelable: true \}\)/)
  assert.match(source, /Object\.defineProperty\(event, 'clipboardData'/)
  assert.match(source, /items: \[\{ type: 'image\/png', getAsFile: \(\) => file \}\]/)
  assert.match(source, /files: \[file\]/)
  assert.match(source, /types: \['Files'\]/)
  assert.match(source, /getData: \(\) => ''/)
  assert.match(source, /new MutationObserver/)
  assert.match(source, /expectedImageCount/)
  assert.match(source, /observedNotSaved/)
  assert.match(source, /dataset\.qaImageSaveCycle/)
  assert.match(source, /\.save-status\.is-saved/)
  assert.doesNotMatch(
    source,
    /locator\('\.save-status\.is-dirty, \.save-status\.is-saving'\)\.waitFor/,
    '图片已插入后不能再要求观察可能已经结束、且产品会有意隐藏的瞬态 dirty/saving DOM',
  )
  assert.doesNotMatch(source, /new DataTransfer\(/)
  assert.doesNotMatch(source, /navigator\.clipboard\.write/)
  assert.doesNotMatch(source, /navigator, 'locks'/)
})

test('workbench QA follows enabled modal controls and the live-only dashboard contract', async () => {
  const source = await fs.readFile(path.resolve('scripts/qa-workbench.mjs'), 'utf8')
  assert.equal(source.match(/getByLabel\('一句话'\)\.fill\(/g)?.length, 2)
  assert.equal(source.match(/locator\('\.composer-modal'\)\.waitFor\(\{ state: 'hidden'/g)?.length, 3)
  assert.ok((source.match(/locator\('\.trade-row-open'\)\.first\(\)\.click\(\)/g)?.length ?? 0) >= 2)
  assert.match(source, /const closeDialogLastFocusable = closeDialog\.locator\('button:not\(:disabled\):visible, input:not\(:disabled\):visible'\)\.last\(\)/)
  assert.match(source, /getByRole\('button', \{ name: '实盘 \+ 模拟盘' \}\)\.count\(\)/)
  assert.doesNotMatch(source, /getByRole\('button', \{ name: '实盘 \+ 模拟盘' \}\)\.click\(\)/)
})

test('workbench QA probe records focus, review flow, and sticky trade-group metrics from the page', async () => {
  await withFixture(async (root) => {
    const fixturePath = path.join(root, 'workbench-probe.html')
    const reportPath = path.join(root, 'workbench-probe-report.json')
    await write(root, 'workbench-probe.html', `<!doctype html>
      <meta charset="utf-8">
      <style>
        html[data-keyboard-focus-rings="off"] #main-content:focus { outline: none; }
        html[data-keyboard-focus-rings="on"] #main-content:focus { outline: 2px solid rgb(124, 58, 237); }
        [data-qa-view][hidden] { display: none; }
        #main-content { width: 720px; min-height: 320px; }
        [data-review-context] { height: 40px; margin: 0 0 16px; }
        [data-review-image] { display: block; width: 160px; height: 90px; margin: 0 0 16px; }
        [data-trade-scroll] { width: 640px; height: 180px; overflow: auto; }
        .trade-list-columns { height: 32px; position: sticky; top: 0; background: white; }
        .trade-list-virtual-item.is-sticky { position: sticky; top: 32px; padding-top: 8px; }
        .trade-list-virtual-item.is-sticky .trade-list-group-header { margin-top: 0; }
        .trade-list-group-header { height: 36px; margin-top: 8px; background: #eee; }
        .trade-row { height: 64px; }
      </style>
      <main id="main-content" tabindex="-1">
        <section data-qa-view="settings">
          <button type="button" role="switch" aria-label="显示键盘焦点高光" aria-checked="false">显示键盘焦点高光</button>
        </section>
        <section data-qa-view="list" hidden>
          <div data-trade-scroll>
            <div class="trade-list-columns" role="row"><span role="columnheader">交易</span></div>
            <div class="trade-list-virtual-item is-header">
              <div class="trade-list-group-header">
                <button class="trade-list-group-toggle" type="button" aria-expanded="true">折叠 2026 年 8 月（2）</button>
              </div>
            </div>
            <div data-trade-rows><div class="trade-row"></div><div class="trade-row"></div></div>
            <div class="trade-list-virtual-item is-header">
              <div class="trade-list-group-header"><strong>2026 年 7 月</strong></div>
            </div>
            <div class="trade-row"></div><div class="trade-row"></div><div class="trade-row"></div>
          </div>
        </section>
        <section data-qa-view="review" hidden aria-label="已复盘交易详情">
          <div class="dv-review-complete-meta" aria-label="复盘已完成">已复盘</div>
          <div class="editor">
            <div class="ProseMirror">
              <section data-review-context="true"><p>4H 顺势，等待回调。</p></section>
              <img data-review-image alt="盘面截图" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90'/%3E">
              <p>等待下一次确认。</p>
            </div>
          </div>
        </section>
      </main>
      <script>
        const fault = new URLSearchParams(location.search).get('fault')
        const show = (name) => {
          document.querySelectorAll('[data-qa-view]').forEach((view) => { view.hidden = view.dataset.qaView !== name })
        }
        window.__qaWorkbenchShowView = show
        const editorRoot = document.querySelector('.editor .ProseMirror')
        const normalizedReviewHtml = editorRoot.innerHTML
        let editorHtmlReads = 0
        editorRoot.editor = {
          getHTML() {
            editorHtmlReads += 1
            return fault === 'html-mutation' && editorHtmlReads > 1
              ? normalizedReviewHtml.replace('等待下一次确认。', '已被受控变异。')
              : normalizedReviewHtml
          },
        }
        const focusSwitch = document.querySelector('[role="switch"]')
        const applyFocusPreference = (enabled) => {
          focusSwitch.setAttribute('aria-checked', String(enabled))
          document.documentElement.dataset.keyboardFocusRings = enabled ? 'on' : 'off'
        }
        focusSwitch.addEventListener('click', () => applyFocusPreference(focusSwitch.getAttribute('aria-checked') !== 'true'))
        applyFocusPreference(false)
        document.querySelector('.trade-list-group-toggle').addEventListener('click', (event) => {
          const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true'
          event.currentTarget.setAttribute('aria-expanded', String(!expanded))
          document.querySelector('[data-trade-rows]').hidden = expanded
        })
        document.querySelector('[data-trade-scroll]').addEventListener('scroll', (event) => {
          const headers = document.querySelectorAll('.trade-list-virtual-item.is-header')
          headers.forEach((header) => header.classList.remove('is-sticky'))
          if (event.currentTarget.scrollTop > 0) headers[1].classList.add('is-sticky')
        })
        if (fault === 'console') console.error('controlled workbench console failure')
        if (fault === 'page') setTimeout(() => { throw new Error('controlled workbench page failure') })
        if (fault === 'overflow') {
          const overflow = document.createElement('div')
          overflow.style.width = '2000px'
          overflow.textContent = 'controlled horizontal overflow'
          document.body.append(overflow)
        }
      </script>`)

    const result = spawnSync(process.execPath, [path.resolve('scripts/qa-workbench.mjs')], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        QA_WORKBENCH_PROBE_URL: pathToFileURL(fixturePath).href,
        QA_WORKBENCH_REPORT_PATH: reportPath,
      },
    })
    assert.equal(result.status, 0, `probe output:\n${result.stdout}\n${result.stderr}`)

    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'))
    assert.deepEqual(report.metrics.focusOff, {
      focusPreference: 'off',
      activeElement: 'main-content',
      focusOutlineWidth: 0,
    })
    assert.equal(report.metrics.focusOn.focusPreference, 'on')
    assert.equal(report.metrics.focusOn.activeElement, 'main-content')
    assert(report.metrics.focusOn.focusOutlineWidth >= 2)
    assert.equal(report.metrics.review.reviewVisualHeadingCount, 0)
    assert.equal(report.metrics.review.reviewContextImageGap, 16)
    assert.equal(report.metrics.review.reviewImageFollowingGap, 16)
    assert.deepEqual(report.metrics.review.order, ['SECTION', 'IMG', 'P'])
    assert.match(report.metrics.review.reviewHtmlBaselineHash, /^[a-f0-9]{64}$/)
    assert.match(report.metrics.review.reviewHtmlReloadedHash, /^[a-f0-9]{64}$/)
    assert.equal(
      report.metrics.review.reviewHtmlReloadedHash,
      report.metrics.review.reviewHtmlBaselineHash,
    )
    assert.equal(report.metrics.review.htmlRoundTripMatches, true)
    assert.equal(report.metrics.tradeList.tradeGroupTopGap, 8)
    assert.equal(report.metrics.tradeList.stickyTradeGroupTopGap, 8)
    assert.equal(report.metrics.tradeList.collapsed, true)
    assert.equal(report.metrics.tradeList.expanded, true)
    assert.equal(report.metrics.tradeList.scrolledBackToTop, true)
    assert.deepEqual(report.diagnostics, {
      consoleErrors: [],
      pageErrors: [],
      horizontalOverflow: [],
    })
    assert(report.steps.length > 0, 'workbench probe 必须至少产出一个真实截图步骤')
    for (const step of report.steps) {
      assert.equal(typeof step.screenshotPath, 'string')
      assert.equal((await fs.stat(step.screenshotPath)).isFile(), true)
    }

    for (const fault of ['console', 'page', 'overflow', 'html-mutation']) {
      const faultReportPath = path.join(root, `workbench-probe-${fault}-report.json`)
      const faultUrl = new URL(pathToFileURL(fixturePath))
      faultUrl.searchParams.set('fault', fault)
      const faultResult = spawnSync(process.execPath, [path.resolve('scripts/qa-workbench.mjs')], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          QA_WORKBENCH_PROBE_URL: faultUrl.href,
          QA_WORKBENCH_REPORT_PATH: faultReportPath,
        },
      })
      assert.equal(
        faultResult.status,
        1,
        `${fault} diagnostic must fail closed:\n${faultResult.stdout}\n${faultResult.stderr}`,
      )
      const faultReport = JSON.parse(await fs.readFile(faultReportPath, 'utf8'))
      if (fault === 'html-mutation') {
        assert.equal(faultReport.metrics.review.htmlRoundTripMatches, false)
      } else {
        const diagnosticKey = fault === 'console'
          ? 'consoleErrors'
          : fault === 'page'
            ? 'pageErrors'
            : 'horizontalOverflow'
        assert(faultReport.diagnostics[diagnosticKey].length > 0)
      }
    }
  })
})
// Quality-Scenario: Q-DISCOVERY
// Quality-Scenario: Q-PAGEERROR
