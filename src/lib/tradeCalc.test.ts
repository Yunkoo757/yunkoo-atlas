import { calcRFromStop } from '@/lib/tradeCalc'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testRUsesInitialStopRiskInsteadOfExitDistance(): void {
  const r = calcRFromStop('long', 20, 100, 95, 2)
  assert(r === 2, '20 profit over 10 initial risk should equal 2R')
  assert(calcRFromStop('short', -10, 100, 105, 2) === -1, 'short loss should preserve sign')
  assert(calcRFromStop('long', 20, 100, null, 2) === null, 'missing stop must remain missing')
}
