import test from 'node:test'
import assert from 'node:assert/strict'
import { observeLiquidEther } from '../../atlas-website/fluid-loader.js'

function browserFixture({complete = true, reduced = false, fine = true, hidden = false, anchor = false, load} = {}) {
  const original = new Map(), frames = new Map(), idles = new Map(), media = new Map()
  let id = 0, intersection, paint, stopped = false
  const document = Object.assign(new EventTarget(), {hidden, readyState: complete ? 'complete' : 'loading'})
  const window = new EventTarget()
  if (anchor) { window.location = {hash: '#download'}; document.getElementById = () => ({id: 'download'}) }
  const counters = {loads: 0, mounts: 0, disposals: 0, options: 0, warnings: 0}
  const host = {children: [], bounds: {top: 0, bottom: 700, width: 1440}, replaceChildren(...children) { this.children = children }, getBoundingClientRect() { return this.bounds }}
  function install(key, value) { original.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, {configurable: true, writable: true, value}) }
  class PaintObserver { static supportedEntryTypes = ['paint']; constructor(callback) { paint = callback } observe() {} disconnect() {} }
  class IntersectionObserver { constructor(callback) { intersection = callback } observe() {} disconnect() {} }
  window.PerformanceObserver = PaintObserver
  for (const [key, value] of Object.entries({window, document, innerHeight: 1000, PerformanceObserver: PaintObserver, IntersectionObserver,
    matchMedia: query => { if (!media.has(query)) media.set(query, Object.assign(new EventTarget(), {matches: query.includes('reduced-motion') ? reduced : fine})); return media.get(query) },
    requestAnimationFrame: callback => { frames.set(++id, callback); return id }, cancelAnimationFrame: key => frames.delete(key),
    requestIdleCallback: callback => { idles.set(++id, callback); return id }, cancelIdleCallback: key => idles.delete(key),
  })) install(key, value)
  window.requestIdleCallback = globalThis.requestIdleCallback
  window.cancelIdleCallback = globalThis.cancelIdleCallback
  const warn = console.warn
  console.warn = () => { counters.warnings++ }
  const module = {mountLiquidEther: () => { counters.mounts++; host.replaceChildren('canvas'); return () => { counters.disposals++ } }}
  const stop = observeLiquidEther(host, () => { counters.options++; return {} }, () => { counters.loads++; return load ? load(module) : Promise.resolve(module) })
  const flush = queue => { const pending = [...queue.values()]; queue.clear(); for (const callback of pending) callback(0) }
  return {counters, host, frames, idles, module,
    visible(value) { intersection([{isIntersecting: value, intersectionRatio: value ? 1 : 0}]) },
    paint() { paint({getEntries: () => [{name: 'first-contentful-paint'}]}) },
    loaded() { document.readyState = 'complete'; window.dispatchEvent(new Event('load')) },
    hidden(value) { document.hidden = value; document.dispatchEvent(new Event('visibilitychange')) },
    media(query, value) { const item = media.get(query); item.matches = value; item.dispatchEvent(new Event('change')) },
    page(name) { window.dispatchEvent(new Event(name)) },
    flushFrame() { flush(frames) },
    async flushIdle() { flush(idles); await Promise.resolve(); await Promise.resolve() },
    stop() { if (!stopped) { stopped = true; stop() } },
    cleanup() { this.stop(); console.warn = warn; for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) } },
  }
}

test('fluid waits for real content paint, completed document, visible hero, and idle time', async () => {
  const fixture = browserFixture({complete: false})
  try {
    fixture.visible(true)
    assert.equal(fixture.frames.size, 0)
    fixture.paint()
    assert.equal(fixture.frames.size, 0, 'Content paint alone cannot race the initial anchor navigation')
    fixture.loaded()
    fixture.flushFrame()
    assert.equal(fixture.counters.loads, 0, 'The content frame must finish before the heavy import')
    await fixture.flushIdle()
    assert.equal(fixture.counters.mounts, 1)
    assert.equal(fixture.counters.options, 1)
  } finally { fixture.cleanup() }
})

test('reduced motion, coarse pointer, hidden document, and offscreen hero never import fluid', async () => {
  for (const options of [{reduced: true}, {fine: false}, {hidden: true}, {offscreen: true}]) {
    const fixture = browserFixture(options)
    try {
      if (options.offscreen) fixture.host.bounds = {top: -900, bottom: -200, width: 1440}
      fixture.visible(true); fixture.paint(); fixture.flushFrame(); await fixture.flushIdle()
      assert.equal(fixture.counters.loads, 0)
      assert.equal(fixture.counters.mounts, 0)
    } finally { fixture.cleanup() }
  }
})

test('an import resolved after hero or motion ownership changes cannot mount stale WebGL', async () => {
  for (const change of ['offscreen', 'reduced', 'disposed']) {
    let resolve
    const waiting = new Promise(done => { resolve = done })
    const fixture = browserFixture({load: () => waiting})
    try {
      fixture.visible(true); fixture.paint(); fixture.flushFrame(); await fixture.flushIdle()
      assert.equal(fixture.counters.loads, 1)
      if (change === 'offscreen') fixture.visible(false)
      if (change === 'reduced') fixture.media('(prefers-reduced-motion: reduce)', true)
      if (change === 'disposed') fixture.stop()
      resolve(fixture.module); await Promise.resolve(); await Promise.resolve()
      assert.equal(fixture.counters.mounts, 0, change)
      assert.deepEqual(fixture.host.children, [])
    } finally { fixture.cleanup() }
  }
})

test('pagehide releases the effect and a BFCache pageshow can mount again', async () => {
  const fixture = browserFixture()
  try {
    fixture.visible(true); fixture.paint(); fixture.flushFrame(); await fixture.flushIdle()
    fixture.page('pagehide')
    assert.equal(fixture.counters.disposals, 1)
    assert.deepEqual(fixture.host.children, [])
    fixture.page('pageshow'); fixture.flushFrame(); await fixture.flushIdle()
    assert.equal(fixture.counters.mounts, 2)
    fixture.stop()
    assert.equal(fixture.counters.disposals, 2)
  } finally { fixture.cleanup() }
})

test('an unavailable decorative module falls back once without retrying indefinitely', async () => {
  const fixture = browserFixture({load: () => Promise.reject(new Error('unavailable test module'))})
  try {
    fixture.visible(true); fixture.paint(); fixture.flushFrame(); await fixture.flushIdle()
    fixture.visible(true); fixture.flushFrame(); await fixture.flushIdle()
    assert.equal(fixture.counters.loads, 1)
    assert.equal(fixture.counters.warnings, 1)
    assert.equal(fixture.counters.mounts, 0)
  } finally { fixture.cleanup() }
})


test('a deep link below the hero waits until the hero is visited again', async () => {
  const fixture = browserFixture({anchor: true})
  try {
    fixture.visible(true); fixture.paint(); fixture.flushFrame(); await fixture.flushIdle()
    assert.equal(fixture.counters.loads, 0, 'Initial anchor scrolling must not initialize the hero it is leaving')
    fixture.visible(false); fixture.visible(true); fixture.flushFrame(); await fixture.flushIdle()
    assert.equal(fixture.counters.mounts, 1, 'Returning to the hero must retain its decorative effect')
  } finally { fixture.cleanup() }
})
