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
async function selectValue(trigger, value) {
  await trigger.click()
  await page.locator(`.ui-select-option[data-value="${value}"]`).click()
}
async function createTrade(symbol) {
  await page.goto(`${BASE}/list`, { waitUntil: 'networkidle' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  await page.locator('body').press('c')
  await selectValue(page.getByRole('combobox', { name: '交易品种' }), symbol)
  await page.locator('.composer-btn-primary').click()
  await page.waitForURL(/\/trade\//)
  return page.url()
}

async function pasteAndReadImage() {
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
  return {
    href: page.url(),
    imgBefore,
    imgAfter,
    tradeId: await page.locator('.trade-media').getAttribute('data-trade-id'),
    assetId: await page.locator('.editor img').first().getAttribute('data-asset-id'),
    editorSrc: await page.locator('.editor img').first().getAttribute('src'),
    mediaSrc: await page.locator('.trade-media-stage img').first().getAttribute('src'),
  }
}

async function pasteGeneratedImage(width, height) {
  const editor = page.locator('.editor .ProseMirror')
  await editor.click()
  await page.evaluate(async ({ width, height }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context.fillStyle = '#f7f7f8'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#5e6ad2'
    context.fillRect(0, 0, width / 2, height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }, { width, height })
  await page.keyboard.press('Control+v')
  await page.locator('.trade-media-thumbs button').nth(1).waitFor()
  await page.waitForTimeout(1200)
}

await createTrade('BTCUSDT')
const firstTrade = await pasteAndReadImage()
await pasteGeneratedImage(1600, 400)
await createTrade('ETHUSDT')
const secondTrade = await pasteAndReadImage()
await page.goto(firstTrade.href, { waitUntil: 'networkidle' })
await page.locator('.editor .ProseMirror').waitFor()
const mediaStage = page.locator('.trade-media-stage')
const firstStageBox = await mediaStage.boundingBox()
await page.locator('.trade-media-thumbs button').nth(1).click()
await mediaStage.locator('img').waitFor()
const secondStageBox = await mediaStage.boundingBox()
await page.reload({ waitUntil: 'networkidle' })
await page.locator('.editor .ProseMirror').waitFor()
const reloadedStageBox = await page.locator('.trade-media-stage').boundingBox()
const stableMediaGeometry =
  Boolean(firstStageBox) &&
  Boolean(secondStageBox) &&
  Boolean(reloadedStageBox) &&
  Math.abs(firstStageBox.height - secondStageBox.height) < 1 &&
  Math.abs(firstStageBox.height - reloadedStageBox.height) < 1
const reopenedFirst = {
  tradeId: await page.locator('.trade-media').getAttribute('data-trade-id'),
  assetId: await page.locator('.editor img').first().getAttribute('data-asset-id'),
  editorSrc: await page.locator('.editor img').first().getAttribute('src'),
  mediaSrc: await page.locator('.trade-media-stage img').first().getAttribute('src'),
}
const twoTradeOwnership =
  Boolean(firstTrade.tradeId) &&
  Boolean(secondTrade.tradeId) &&
  firstTrade.tradeId !== secondTrade.tradeId &&
  Boolean(firstTrade.assetId) &&
  Boolean(secondTrade.assetId) &&
  firstTrade.assetId !== secondTrade.assetId &&
  secondTrade.mediaSrc === secondTrade.editorSrc &&
  reopenedFirst.tradeId === firstTrade.tradeId &&
  reopenedFirst.assetId === firstTrade.assetId &&
  reopenedFirst.mediaSrc === reopenedFirst.editorSrc &&
  reopenedFirst.assetId !== secondTrade.assetId &&
  reopenedFirst.mediaSrc !== secondTrade.mediaSrc

console.log(firstTrade.imgBefore > 0 ? '✓ 粘贴后编辑器出现图片' : '✗ 粘贴后无图片', `(count=${firstTrade.imgBefore})`)
console.log(firstTrade.imgAfter > 0 ? '✓ 刷新后图片仍在' : '✗ 刷新后图片丢失', `(count=${firstTrade.imgAfter})`)
console.log(
  twoTradeOwnership ? '✓ 两笔交易的主截图与各自资产保持隔离' : '✗ 两笔交易出现图片归属混淆',
  `(first=${firstTrade.tradeId ?? 'none'}, second=${secondTrade.tradeId ?? 'none'})`,
)
console.log(
  stableMediaGeometry ? '✓ 不同尺寸截图切换及刷新后主画布高度稳定' : '✗ 主画布随截图尺寸发生位移',
  `(first=${firstStageBox?.height ?? 'none'}, second=${secondStageBox?.height ?? 'none'}, reload=${reloadedStageBox?.height ?? 'none'})`,
)

const assetTests = await page.evaluate(async () => {
  const mod = await import('/src/storage/assets.test.ts')
  const results = []
  for (const name of [
    'testMissingAssetRendersDiagnosticPlaceholder',
    'testInvalidBlobImageIsNotPersistedAsBlobUrl',
  ]) {
    try {
      await mod[name]()
      results.push({ name, pass: true })
    } catch (error) {
      results.push({ name, pass: false, detail: String(error) })
    }
  }
  return results
})

for (const result of assetTests) {
  console.log(result.pass ? `✓ ${result.name}` : `✗ ${result.name} — ${result.detail}`)
}

await browser.close()
process.exit(
  firstTrade.imgBefore > 0 &&
    firstTrade.imgAfter > 0 &&
    twoTradeOwnership &&
    stableMediaGeometry &&
    assetTests.every((result) => result.pass)
    ? 0
    : 1,
)
