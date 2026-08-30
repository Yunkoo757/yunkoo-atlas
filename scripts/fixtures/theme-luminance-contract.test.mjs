import assert from 'node:assert/strict'
import test from 'node:test'

import {
  THEME_LUMINANCE_PAGES,
  THEME_LUMINANCE_SCHEMA_VERSION,
  THEME_LUMINANCE_THRESHOLDS,
  THEME_COLOR_MIX_ALLOWLIST,
  THEME_STATE_CONTRACTS,
  THEME_SURFACE_PROBES,
  THEME_TEXT_PROBES,
  pageById,
  surfaceProbesForPage,
  textProbesForPage,
} from '../theme-luminance-contract.mjs'

test('theme luminance contract has unique stable ids and desktop routes', () => {
  assert.equal(THEME_LUMINANCE_SCHEMA_VERSION, 1)
  for (const entries of [THEME_LUMINANCE_PAGES, THEME_SURFACE_PROBES, THEME_TEXT_PROBES, THEME_STATE_CONTRACTS]) {
    assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length)
  }
  assert.equal(THEME_LUMINANCE_PAGES.every((page) => page.path.startsWith('/')), true)
  assert.equal(THEME_LUMINANCE_PAGES.some((page) => page.path === '/review-cases/board'), true)
})

test('theme luminance surface probes bind page roots and board cards to semantic surfaces', () => {
  assert.equal(THEME_LUMINANCE_PAGES.every((page) => page.rootSurface === 'pane'), true)
  for (const probe of THEME_SURFACE_PROBES) {
    assert.ok(pageById(probe.page), `unknown page for ${probe.id}`)
    assert.ok(probe.selector)
    assert.ok(probe.targetSurface)
  }
  assert.equal(surfaceProbesForPage('trades-board').some(({ targetSurface }) => targetSurface === 'elevated'), true)
})

test('theme luminance text probes resolve to declared pages and semantic thresholds', () => {
  const roles = new Set(Object.keys(THEME_LUMINANCE_THRESHOLDS))
  for (const probe of THEME_TEXT_PROBES) {
    assert.ok(pageById(probe.page), `unknown page for ${probe.id}`)
    assert.equal(roles.has(probe.targetRole), true, `unknown target role for ${probe.id}`)
    assert.ok(probe.selector)
  }
  assert.ok(textProbesForPage('trades-list').length >= 10)
})

test('theme luminance state contract records deterministic recovery', () => {
  for (const state of THEME_STATE_CONTRACTS) {
    assert.ok(state.path)
    assert.ok(state.ready)
    assert.ok(state.target)
    assert.ok(state.restore)
  }
})

test('optical color-mix allowlist is explicit and reviewable', () => {
  assert.equal(new Set(THEME_COLOR_MIX_ALLOWLIST.map((entry) => entry.key)).size, THEME_COLOR_MIX_ALLOWLIST.length)
  for (const entry of THEME_COLOR_MIX_ALLOWLIST) {
    assert.match(entry.key, /^src\/.+\.css:\d+$/)
    assert.ok(entry.reason)
    assert.equal(entry.owner, 'Design System')
    assert.ok(entry.expiresWhen)
  }
})
