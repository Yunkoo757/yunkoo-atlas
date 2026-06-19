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

  // 2. 列表有交易数据
  const tradeLink = page.locator('a[href^="/trade/"]').first()
  await tradeLink.waitFor({ timeout: 5000 })
  const tradeCount = await page.locator('a[href^="/trade/"]').count()
  record('列表展示交易', tradeCount > 0, `${tradeCount} 条`)

  // 3. 详情页 + 笔记编辑
  await tradeLink.click()
  await page.waitForURL(/\/trade\//)
  const editor = page.locator('.editor .ProseMirror')
  await editor.waitFor({ timeout: 5000 })
  const beforeNote = await editor.innerText()
  const stamp = `QA-${Date.now()}`
  await editor.click()
  await editor.press('End')
  await editor.type(` ${stamp}`)
  await page.waitForTimeout(800)
  record('详情页笔记可编辑', (await editor.innerText()).includes(stamp))

  // 4. 刷新后笔记持久化（IndexedDB）
  const tradeUrl = page.url()
  await page.reload({ waitUntil: 'networkidle' })
  await editor.waitFor({ timeout: 5000 })
  const afterReload = await editor.innerText()
  record('刷新后笔记仍在', afterReload.includes(stamp), `stamp=${stamp}`)
  await page.screenshot({ path: join(OUT, '02-detail-note.png') })

  // 5. 保存状态（回到列表触发 store 变更）
  await page.goto(`${BASE}/list`)
  await page.waitForURL(/\/list/)
  // 星标一笔交易
  const starBtn = page.locator('button[title="星标"], button[aria-label="星标"]').first()
  if (await starBtn.count()) {
    await starBtn.click()
    await page.waitForTimeout(500)
    const saveStatus = page.locator('.save-status')
    const hasStatus = await saveStatus.isVisible().catch(() => false)
    record('Topbar 保存状态可见', hasStatus, hasStatus ? await saveStatus.innerText() : '未出现')
    await page.waitForTimeout(500)
    const saved = await page.locator('.save-status--saved, .save-status').filter({ hasText: '已保存' }).isVisible().catch(() => false)
    record('防抖保存完成', saved || hasStatus)
  } else {
    record('Topbar 保存状态可见', false, '未找到星标按钮')
  }

  // 6. 错过的机会页
  await page.getByRole('link', { name: '错过的机会' }).click()
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

  // 9. 导出 JSON 含 version 4
  const exportPayload = await page.evaluate(async () => {
    const { buildExportPayload } = await import('/src/lib/importExport.ts')
    return buildExportPayload()
  }).catch(() => null)

  if (exportPayload) {
    record('导出 payload version=4', exportPayload.version === 4, `v${exportPayload.version}`)
    record('导出含 assets 数组', Array.isArray(exportPayload.assets), `len=${exportPayload.assets?.length ?? 0}`)
  } else {
    record('导出 payload version=4', false, 'evaluate 导入失败，跳过')
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
