/** 图片附件 QA — 剪贴板粘贴 */
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:5181'
const pngB64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
})
const page = await context.newPage()
await page.goto(`${BASE}/list`, { waitUntil: 'networkidle' })
await page.locator('a[href^="/trade/"]').first().click()
await page.waitForURL(/\/trade\//)

const editor = page.locator('.editor .ProseMirror')
await editor.waitFor()
await editor.click()

await page.evaluate(async (b64) => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'image/png' })
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}, pngB64)

await page.keyboard.press('Control+v')
await page.waitForTimeout(1200)

const imgBefore = await page.locator('.editor img').count()
await page.reload({ waitUntil: 'networkidle' })
await editor.waitFor()
const imgAfter = await page.locator('.editor img').count()

console.log(imgBefore > 0 ? '✓ 粘贴后编辑器出现图片' : '✗ 粘贴后无图片', `(count=${imgBefore})`)
console.log(imgAfter > 0 ? '✓ 刷新后图片仍在' : '✗ 刷新后图片丢失', `(count=${imgAfter})`)

await browser.close()
process.exit(imgBefore > 0 && imgAfter > 0 ? 0 : 1)
