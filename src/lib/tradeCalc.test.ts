import { calcRFromPrices, calcRFromStop } from '@/lib/tradeCalc'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testRUsesInitialStopRiskInsteadOfExitDistance(): void {
  const r = calcRFromStop('long', 20, 100, 95, 2)
  assert(r === 2, '20 profit over 10 initial risk should equal 2R')
  assert(calcRFromStop('short', -10, 100, 105, 2) === -1, 'short loss should preserve sign')
  assert(calcRFromStop('long', 20, 100, null, 2) === null, 'missing stop must remain missing')
}

export function testPriceRDoesNotDependOnPositionUnits(): void {
  assert(calcRFromPrices('long', 1.1, 1.11, 1.095) === 2, 'long price R should use price risk')
  assert(calcRFromPrices('short', 100, 90, 105) === 2, 'short price R should preserve direction')
  assert(calcRFromPrices('long', 1.1, 1.11, null) === null, 'missing stop should keep price R missing')
}
