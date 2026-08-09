import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fmtDate, fmtMoney, fmtPrice, fmtR } from '@/lib/format'
import { calcR } from '@/lib/tradeCalc'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testTradingValuesKeepMeaningfulPrecision(): void {
  assert(fmtMoney(12.5, 'USD') === '+$12.50', 'fractional cash must not be rounded to a whole dollar')
  assert(fmtMoney(12.5, 'CNY') === '+CN¥12.50', '单笔非 USD 现金必须展示自身币种')
  assert(fmtMoney(12.5, null) === '+12.50', 'unknown 现金只展示数值，不附加币种未知标签')
  assert(fmtMoney(12.5, 'US') === '+12.50', '非法币种不得抛出 RangeError，必须安全降级为纯数值')
  assert(fmtPrice(1.095) === '1.095', 'forex prices must preserve meaningful decimals')
  assert(fmtPrice(0.00002345) === '0.00002345', 'small crypto prices must remain readable')
  assert(fmtR(1.25) === '+1.25R', 'R display must not hide a quarter-R difference')
  assert(calcR(1.25, 1) === 1.25, 'stored R must keep more precision than the old tenth-R rounding')
}

export function testPrivacyModeMasksOnlyRealMoneyValues(): void {
  assert(fmtMoney(1250.5, 'USD', true) === '****', '直播模式必须隐藏真实盈亏金额')
  assert(fmtMoney(-88.38, 'CNY', true) === '****', '直播模式不得通过正负号泄露亏损金额')
  assert(fmtMoney(null, null, true) === '—', '没有填写的金额必须继续显示为空，而不是伪装成已隐藏数据')
  assert(fmtR(5.37) === '+5.37R', '直播模式只隐藏现金金额，不应改变 R 倍数')
}

export function testDateOnlyValuesDoNotShiftAcrossTimezones(): void {
  if (process.env.ATLAS_FORMAT_TIMEZONE_CHILD === '1') {
    assert(fmtDate('2026-07-27') === '7月27日', '日期型字符串不得因负时区显示为前一天')
    assert(fmtDate('2026-01-01') === '1月1日', '日期型字符串不得跨年偏移')
    return
  }
  const result = spawnSync(
    process.execPath,
    [path.resolve('scripts/run-regression-tests.mjs'), '--unit-only', 'src/lib/format.test.ts'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, TZ: 'America/New_York', ATLAS_FORMAT_TIMEZONE_CHILD: '1' },
    },
  )
  assert(result.status === 0, `负时区隔离子进程失败：\n${result.stdout}\n${result.stderr}`)
}

export function testRoundedZeroMoneyHasNoProfitSign(): void {
  assert(fmtMoney(0.1 + 0.2 - 0.3, 'USD') === '$0.00', '舍入为零的金额不得显示正号')
  assert(fmtMoney(0.004, 'USD') === '$0.00', '不足半分的正值不得显示为盈利')
  assert(fmtMoney(-0.004, 'USD') === '$0.00', '不足半分的负值不得显示为亏损负零')
}
