import { _electron as electron, chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { createBacktestReviewSnapshot } from './fixtures/backtest-review-seed.mjs'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const runtime = join(tmpdir(), `atlas-backtest-review-${randomUUID()}`)
const library = join(runtime, 'library')
const userData = join(runtime, 'user-data')
await mkdir(runtime, { recursive: true })
const evidence = join(runtime, 'evidence')
await mkdir(evidence)
console.log(`ISOLATED_RUNTIME ${runtime}`)
// 图示由纯模拟折线生成，只用于验收附件加载与导出。
const browser = await chromium.launch({ headless: true })
const chartPage = await browser.newPage({ viewport: { width: 900, height: 500 } })
await chartPage.setContent(`<html><body style="margin:0;background:#151619;color:#d9dbe1;font:20px system-ui"><div style="padding:32px">隔离模拟图示 · 非真实行情</div><svg width="900" height="360" viewBox="0 0 900 360"><path d="M40 240 L110 180 L160 205 L240 120 L310 170 L400 70 L450 120 L520 50 L600 85 L690 25 L760 55 L850 10" fill="none" stroke="#8791e6" stroke-width="3"/><path d="M40 270 H850" stroke="#6b6c72" stroke-dasharray="8 8"/><text x="40" y="315" fill="#b8bbc5" font-size="18">截图加载、图片预览及导出验证专用</text></svg></body></html>`)
const chartBytes = await chartPage.screenshot({ type: 'png' })
await browser.close()
const assets = [{ id: 'backtest-demo-chart', mime: 'image/png', data: chartBytes.toString('base64') }]
const env = { ...process.env, TRADER_ATLAS_LIBRARY: library, VITE_DEV_SERVER_URL: '' }
delete env.ELECTRON_RUN_AS_NODE
const hidden = process.argv.includes('--hidden')
const application = await electron.launch({ executablePath: require('electron'), args: ['.', `--user-data-dir=${userData}`], cwd: root, env })
const page = await application.firstWindow()
if (hidden) await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); window.hide() })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
await page.waitForFunction(() => Boolean(window.journalBridge), null, { timeout: 30000 })
const created = await page.evaluate(path => window.journalBridge.createNewLibrary(path), library)
if (!created.ok) throw new Error(JSON.stringify(created))
const snapshot = createBacktestReviewSnapshot()
await page.evaluate(async ({ snapshot, assets }) => {
  await window.journalBridge.storageOpen()
  await window.journalBridge.loadSnapshot()
  await window.journalBridge.commitImport(snapshot, assets, { pruneUnreferenced: true })
}, { snapshot, assets })
await page.reload()
await page.waitForSelector('.sb-item')
const navigate = async path => { await page.evaluate(path => { location.hash = path }, path) }
const resize = async (width, height) => application.evaluate(({ BrowserWindow }, size) => {
  const window = BrowserWindow.getAllWindows()[0]
  window.setSize(size.width, size.height)
  window.center()
  if (size.hidden) window.hide(); else window.show()
}, { width, height, hidden })
await resize(1440, 960)
await navigate('/backtests/isolated-backtest-100')
await page.waitForSelector('.backtest-filter-bar')
await page.locator('.trade-row').first().waitFor({ timeout: 30000 }).catch(() => {})
if (!hidden) await page.screenshot({ path: join(evidence, 'project-1440.png') })
await page.getByRole('button', { name: '项目统计', exact: true }).click()
const stats = await page.locator('.backtest-stats').innerText()
if (!stats.includes('100 / 100') || !stats.includes('50 / 40 / 10') || !stats.includes('60 R') || !stats.includes('0.6 R')) throw new Error(`Unexpected stats: ${stats}`)
console.log(`STATS ${stats.replaceAll('\n', ' | ')}`)
await page.getByRole('button', { name: '关闭', exact: true }).click()
await page.locator('.sb-hbtn-create').click()
await page.getByRole('spinbutton', { name: '回测 R 结果' }).fill('1.5')
if (!hidden) await page.screenshot({ path: join(evidence, 'composer-1440.png') })
await page.getByRole('spinbutton', { name: '回测 R 结果' }).fill('')
await page.getByRole('button', { name: '取消', exact: true }).click()
await page.waitForSelector('.backtest-filter-bar')
console.log('CLIENT_READY', JSON.stringify({ runtime, library, userData, evidence, errors }))
await writeFile(join(runtime, 'session.json'), JSON.stringify({ runtime, library, userData, evidence, pid: application.process().pid, devtoolsEndpoint: await application.evaluate(({ app }) => app.commandLine.getSwitchValue('remote-debugging-port')), stats, errors }, null, 2), 'utf8')
// 保留可操作客户端，并通过 stdin 接受后续验收命令。
globalThis.atlasReview = { application, page, navigate, resize, evidence, runtime, errors }
process.stdin.setEncoding('utf8')
process.stdin.on('data', async code => {
  try { const result = await eval(`(async () => { ${code} })()`); console.log('ACTION_RESULT', JSON.stringify(result)) }
  catch (error) { console.error('ACTION_FAILED', error.stack) }
})
setInterval(() => {}, 30000)
