import assert from 'node:assert/strict'
import { fitContextItems } from './TradeRowContext'

export function testContextFitsAllBeforeReservingCounter(): void {
  assert.equal(fitContextItems([], 0, 4, []), 0)
  assert.equal(fitContextItems([30, 40, 50], 128, 4, [20, 20, 20]), 3)
  assert.equal(fitContextItems([30, 40, 50], 127, 4, [20, 20, 20]), 2)
  assert.equal(fitContextItems([300, 10], 100, 4, [20, 20]), 0)
}

export function testContextReservesActualHiddenCountWidth(): void {
  const widths = Array(11).fill(10)
  const counters = Array.from({length:11}, (_,i) => i < 9 ? 15 : 25)
  assert.equal(fitContextItems(widths, 38, 4, counters), 0)
  assert.equal(fitContextItems(widths, 39, 4, counters), 1)
  assert.equal(fitContextItems(widths, 43, 4, counters), 2)
}
