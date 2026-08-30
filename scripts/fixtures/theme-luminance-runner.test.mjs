import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createThemeInventory,
  parseThemeLuminanceCliArgs,
} from '../qa-theme-luminance.mjs'

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
  assert.equal(inventory.states.length, 9)
})
