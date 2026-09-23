import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createThemeInventory,
  parseThemeLuminanceCliArgs,
  collectResolvedProbe,
} from '../qa-theme-luminance.mjs'
import { chromium } from 'playwright'

test('resolved contrast composes ancestor opacity and the real row hover underlay', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<style>body{background:#000}.trade-row{position:relative}.trade-row::after{content:"";position:absolute;inset:0;background:#333;z-index:0}.trade-row span{position:relative;z-index:2;color:white}</style><div style="opacity:.5"><span id="faded" style="color:white">文字</span></div><div class="trade-row"><span id="row">文字</span></div>')
    const faded = await collectResolvedProbe(page, '#faded', {})
    const row = await collectResolvedProbe(page, '#row', {})
    assert.ok(faded.contrast > 5.2 && faded.contrast < 5.4, `opacity was not composed: ${faded.contrast}`)
    assert.equal(row.effectiveBackground, 'rgb(51, 51, 51)')
    assert.ok(row.contrast > 12.5 && row.contrast < 12.7)
  } finally { await browser.close() }
})

test('theme luminance CLI keeps inventory, resolved, and state modes unambiguous', () => {
  assert.deepEqual(parseThemeLuminanceCliArgs([]), {
    mode: 'resolved',
    runtime: 'renderer',
    outputRoot: null,
    scope: 'all',
  })
  assert.deepEqual(parseThemeLuminanceCliArgs(['--inventory-only', '--output-root', 'test-results/theme']), {
    mode: 'inventory',
    runtime: 'renderer',
    outputRoot: 'test-results/theme',
    scope: 'all',
  })
  assert.deepEqual(parseThemeLuminanceCliArgs(['--capture-states', '--runtime', 'electron']), {
    mode: 'states',
    runtime: 'electron',
    outputRoot: null,
    scope: 'all',
  })
  assert.deepEqual(parseThemeLuminanceCliArgs(['--scope', 'surface']), {
    mode: 'resolved',
    runtime: 'renderer',
    outputRoot: null,
    scope: 'surface',
  })
  assert.throws(
    () => parseThemeLuminanceCliArgs(['--inventory-only', '--capture-states']),
    /mode may only be specified once/i,
  )
  assert.throws(() => parseThemeLuminanceCliArgs(['--runtime', 'browser']), /requires renderer, electron, or packaged/i)
  assert.throws(() => parseThemeLuminanceCliArgs(['--inventory-only', '--scope', 'surface']), /only applies to resolved/i)
  assert.throws(() => parseThemeLuminanceCliArgs(['--unknown']), /unknown theme luminance argument/i)
})

test('theme inventory discovers source selectors and excludes canonical token color mixes', () => {
  const inventory = createThemeInventory(process.cwd())
  assert.equal(inventory.pageRoots.length, 7)
  assert.equal(inventory.pageRoots.every((entry) => entry.sourceMatches.length > 0), true)
  assert.equal(inventory.textRoles.length > 0, true)
  assert.equal(inventory.colorMixes.length > 0, true)
  assert.equal(inventory.colorMixes.some((entry) => entry.file === 'src/styles/tokens.css'), false)
  assert.equal(inventory.colorMixes.some((entry) => entry.classification === 'Unclassified'), false)
  assert.equal(inventory.colorMixes.some((entry) => entry.classification === 'Neutral Surface/Text/Border'), false)
  assert.equal(
    inventory.colorMixes
      .filter((entry) => /var\(--(?:pos|neg|warn|pending)(?:-[a-z0-9-]+)?\)/i.test(entry.expression))
      .every((entry) => entry.classification === 'Business Semantic'),
    true,
  )
  assert.equal(inventory.states.length, 12)
})
