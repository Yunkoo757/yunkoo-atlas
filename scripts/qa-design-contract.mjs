import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')
const tokens = read('src/styles/tokens.css')
const app = read('src/App.tsx')
const tradesPageStart = app.indexOf('function TradesPage(')
const tradesPageEnd = app.indexOf('\nfunction StrategyPage()', tradesPageStart)
const tradesPage =
  tradesPageStart >= 0 && tradesPageEnd > tradesPageStart
    ? app.slice(tradesPageStart, tradesPageEnd)
    : null

const checks = [
  ['sidebar width', tokens.includes('--sidebar-width: 244px')],
  ['control height', tokens.includes('--control-height: 28px')],
  ['trade row height', tokens.includes('--trade-row-height: 44px')],
  [
    'default trade route uses canonical list',
    tradesPage !== null && tradesPage.includes('<ListView'),
  ],
]

const failed = checks.filter(([, ok]) => !ok)

for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`)
}

if (failed.length > 0) {
  process.exitCode = 1
} else {
  console.log('PASS: Linear design contract')
}
