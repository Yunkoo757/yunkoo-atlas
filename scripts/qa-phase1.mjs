/**
 * Phase 1 浏览器 QA（一次性脚本）
 * 运行: node scripts/qa-phase1.mjs
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:5181'
const OUT = join(process.cwd(), 'qa-screenshots')

const results = []

function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  const icon = pass ? '✓' : '✗'
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ''}`)
}

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
const page = await context.newPage()

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('React Router Future Flag')) {
    errors.push(`console: ${msg.text()}`)
  }
})

async function selectValue(trigger, value) {
  await trigger.click()
  await page.locator(`.ui-select-option[data-value="${value}"]`).click()
}

try {
  // 1. 启动加载
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const loading = await page.getByText('加载本地库').isVisible().catch(() => false)
  if (loading) {
    await page.getByText('加载本地库').waitFor({ state: 'hidden', timeout: 10000 })
  }
  await page.waitForURL(/\/list/)
  record('应用启动并进入列表', true)
  await page.screenshot({ path: join(OUT, '01-list.png') })

  // 2. 干净浏览器没有种子数据，先通过真实 UI 创建测试交易
  let tradeCount = await page.locator('.trade-row').count()
  if (tradeCount === 0) {
    await page.locator('body').press('n')
    await selectValue(page.getByRole('combobox', { name: '交易品种' }), 'BTCUSDT')
    await page.locator('.composer-btn-primary').click()
    await page.waitForURL(/\/trade\//, { timeout: 10000 })
    tradeCount = 1
  } else {
    await page.locator('.trade-row-open').first().click()
    await page.waitForURL(/\/trade\//, { timeout: 10000 })
  }
  record('列表展示交易', tradeCount > 0, `${tradeCount} 条`)

  // 3. 详情页 + 笔记编辑
  await page.waitForURL(/\/trade\//)
  const editor = page.locator('.editor .ProseMirror')
  await editor.waitFor({ timeout: 5000 })
  const stamp = `QA-${Date.now()}`
  await editor.click()
  await editor.press('End')
  await editor.type(` ${stamp}`)
  await page.waitForTimeout(800)
  record('详情页笔记可编辑', (await editor.innerText()).includes(stamp))

  // 4. 笔记写入后保存状态可见并完成
  const saveStatus = page.locator('.save-status')
  await page.getByText('已保存', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  const hasStatus = await saveStatus.isVisible().catch(() => false)
  record('Topbar 保存状态可见', hasStatus, hasStatus ? await saveStatus.innerText() : '未出现')
  const saved = hasStatus && (await saveStatus.innerText()).includes('已保存')
  record('防抖保存完成', saved)

  // 5. 刷新后笔记持久化（IndexedDB）
  await page.reload({ waitUntil: 'networkidle' })
  await editor.waitFor({ timeout: 5000 })
  const afterReload = await editor.innerText()
  record('刷新后笔记仍在', afterReload.includes(stamp), `stamp=${stamp}`)
  await page.screenshot({ path: join(OUT, '02-detail-note.png') })

  // 6. 错过的机会页
  await page.goto(`${BASE}/missed`, { waitUntil: 'networkidle' })
  await page.waitForURL(/\/missed/)
  const missedTitle = await page.getByText('错过的机会').first().isVisible()
  record('错过的机会页可访问', missedTitle)
  await page.screenshot({ path: join(OUT, '03-missed.png') })

  // 7. 仪表盘
  await page.getByRole('link', { name: '仪表盘' }).click()
  await page.waitForURL(/\/dashboard/)
  record('仪表盘可访问', await page.getByText('仪表盘').first().isVisible())
  await page.screenshot({ path: join(OUT, '04-dashboard.png') })

  // 8. 数据导入/导出设置页
  await page.goto(`${BASE}/settings/data`)
  await page.waitForURL(/\/settings\/data/)
  const dataPage = page.locator('.data-settings')
  await dataPage.waitFor({ timeout: 5000 })
  const hasExportBtn = await page.locator('.dio-btn-primary').first().isVisible()
  record('数据设置页可访问', await dataPage.isVisible())
  record('导出按钮可见', hasExportBtn)
  await page.screenshot({ path: join(OUT, '05-data-io.png') })

  // 9. 导出 JSON 含当前版本
  const exportPayload = await page.evaluate(async () => {
    const { buildExportPayload, EXPORT_VERSION } = await import('/src/lib/importExport.ts')
    return { payload: await buildExportPayload(), expectedVersion: EXPORT_VERSION }
  }).catch(() => null)

  if (exportPayload) {
    record(
      `导出 payload version=${exportPayload.expectedVersion}`,
      exportPayload.payload.version === exportPayload.expectedVersion,
      `v${exportPayload.payload.version}`,
    )
    record(
      '导出含 assets 数组',
      Array.isArray(exportPayload.payload.assets),
      `len=${exportPayload.payload.assets?.length ?? 0}`,
    )
  } else {
    record('导出 payload 版本', false, 'evaluate 导入失败，跳过')
  }

  // 10. IndexedDB 存在
  const idbOk = await page.evaluate(async () => {
    const dbs = await indexedDB.databases?.()
    if (dbs) return dbs.some((d) => d.name === 'linear-journal-v3')
    return new Promise((resolve) => {
      const req = indexedDB.open('linear-journal-v3')
      req.onsuccess = () => { req.result.close(); resolve(true) }
      req.onerror = () => resolve(false)
    })
  })
  record('IndexedDB linear-journal-v3 存在', idbOk)

  // 11. 控制台无致命错误
  record('无页面级 JS 错误', errors.length === 0, errors.join('; ') || '干净')
} catch (e) {
  record('QA 脚本异常', false, String(e))
  await page.screenshot({ path: join(OUT, 'error.png') }).catch(() => {})
} finally {
  await browser.close()
}

const passed = results.filter((r) => r.pass).length
const total = results.length
const score = Math.round((passed / total) * 10 * 10) / 10

console.log('\n--- QA 汇总 ---')
console.log(`通过 ${passed}/${total}，健康分 ${score}/10`)
if (errors.length) console.log('控制台错误:', errors)

writeFileSync(
  join(OUT, 'report.json'),
  JSON.stringify({ score, passed, total, results, errors, base: BASE }, null, 2),
)

process.exit(passed === total ? 0 : 1)
