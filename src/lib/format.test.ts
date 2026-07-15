import { fmtMoney, fmtPrice, fmtR } from '@/lib/format'
import { calcR } from '@/lib/tradeCalc'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testTradingValuesKeepMeaningfulPrecision(): void {
  assert(fmtMoney(12.5) === '+$12.50', 'fractional cash must not be rounded to a whole dollar')
  assert(fmtPrice(1.095) === '1.095', 'forex prices must preserve meaningful decimals')
  assert(fmtPrice(0.00002345) === '0.00002345', 'small crypto prices must remain readable')
  assert(fmtPrice(null) === '—', 'optional execution prices must render as missing instead of crashing')
  assert(fmtR(1.25) === '+1.25R', 'R display must not hide a quarter-R difference')
  assert(calcR(1.25, 1) === 1.25, 'stored R must keep more precision than the old tenth-R rounding')
}
