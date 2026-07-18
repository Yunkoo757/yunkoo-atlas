import { fmtMoney, fmtPrice, fmtR } from '@/lib/format'
import { calcR } from '@/lib/tradeCalc'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testTradingValuesKeepMeaningfulPrecision(): void {
  assert(fmtMoney(12.5) === '+$12.50', 'fractional cash must not be rounded to a whole dollar')
  assert(fmtPrice(1.095) === '1.095', 'forex prices must preserve meaningful decimals')
  assert(fmtPrice(0.00002345) === '0.00002345', 'small crypto prices must remain readable')
  assert(fmtR(1.25) === '+1.25R', 'R display must not hide a quarter-R difference')
  assert(calcR(1.25, 1) === 1.25, 'stored R must keep more precision than the old tenth-R rounding')
}

export function testPrivacyModeMasksOnlyRealMoneyValues(): void {
  assert(fmtMoney(1250.5, true) === '****', '直播模式必须隐藏真实盈亏金额')
  assert(fmtMoney(-88.38, true) === '****', '直播模式不得通过正负号泄露亏损金额')
  assert(fmtMoney(null, true) === '—', '没有填写的金额必须继续显示为空，而不是伪装成已隐藏数据')
  assert(fmtR(5.37) === '+5.37R', '直播模式只隐藏现金金额，不应改变 R 倍数')
}
