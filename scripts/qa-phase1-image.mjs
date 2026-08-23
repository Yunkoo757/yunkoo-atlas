/** 图片附件 QA — 剪贴板粘贴 */
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:5181'
const EDITABLE_EDITOR = '.editor .ProseMirror[contenteditable="true"]'
const pngB64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
})
const page = await context.newPage()
async function selectValue(trigger, value) {
  await trigger.click()
  await page.locator(`.ui-select-option[data-value="${value}"]`).click()
}
async function createTrade(symbol) {
  await page.goto(`${BASE}/list`, { waitUntil: 'networkidle' })
  await page.locator('.app-loading').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  await page.locator('body').press('n')
  await selectValue(page.getByRole('combobox', { name: '交易品种' }), symbol)
  await page.getByLabel('一句话').fill(`图片 QA：${symbol} 附件持久化`)
  await page.locator('.composer-btn-primary').click()
  await page.locator('.composer-modal').waitFor({ state: 'hidden', timeout: 10000 })
  await page.locator('.trade-row-open').first().click()
  await page.waitForURL(/\/trade\//)
  return page.url()
}

async function armDurableSaveProbe(expectedImageCount) {
  await page.evaluate((expectedCount) => {
    const root = document.documentElement
    delete root.dataset.qaImageSaveCycle
    globalThis.__ATLAS_QA_IMAGE_SAVE_OBSERVER__?.disconnect()
    let observedNotSaved = false
    const observer = new MutationObserver(() => {
      if (document.querySelector('.save-status-recovery')) {
        root.dataset.qaImageSaveCycle = 'error'
        observer.disconnect()
        return
      }
      if (document.querySelectorAll('.editor img[data-asset-id]').length < expectedCount) return
      if (!document.querySelector('.save-status.is-saved')) {
        observedNotSaved = true
        return
      }
      if (!observedNotSaved) return
      root.dataset.qaImageSaveCycle = 'saved'
      observer.disconnect()
    })
    globalThis.__ATLAS_QA_IMAGE_SAVE_OBSERVER__ = observer
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    })
  }, expectedImageCount)
}

async function waitForDurableSave() {
  await page.waitForFunction(
    () => ['saved', 'error'].includes(document.documentElement.dataset.qaImageSaveCycle ?? ''),
    undefined,
    { timeout: 15_000 },
  )
  const outcome = await page.evaluate(() => document.documentElement.dataset.qaImageSaveCycle)
  if (outcome !== 'saved') throw new Error('图片写入触发了保存失败状态')
}

async function pasteAndReadImage() {
  const editor = page.locator(EDITABLE_EDITOR)
  await editor.waitFor()
  await editor.click()
  const expectedImageCount = await page.locator('.editor img').count() + 1
  await armDurableSaveProbe(expectedImageCount)
  const handled = await editor.evaluate((target, b64) => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const file = new File([bytes], 'chart.png', { type: 'image/png' })
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ type: 'image/png', getAsFile: () => file }],
        files: [file],
        types: ['Files'],
        getData: () => '',
      },
    })
    return target.dispatchEvent(event)
  }, pngB64)
  if (handled) throw new Error('图片粘贴事件未被编辑器接管')
  await page.locator('.editor img').first().waitFor()
  const imgBefore = await page.locator('.editor img').count()
  const assetIdBefore = await page.locator('.editor img').first().getAttribute('data-asset-id')
  const srcBefore = await page.locator('.editor img').first().getAttribute('src')
  await waitForDurableSave()
  await page.reload({ waitUntil: 'networkidle' })
  await editor.waitFor()
  const imgAfter = await page.locator('.editor img').count()
  const assetIdAfter = await page.locator('.editor img').first().getAttribute('data-asset-id')
  const srcAfter = await page.locator('.editor img').first().getAttribute('src')
  return {
    href: page.url(),
    imgBefore,
    imgAfter,
    tradeId: new URL(page.url()).pathname.split('/').pop(),
    assetId: assetIdAfter,
    editorSrc: srcAfter,
    stableAfterReload:
      assetIdBefore === assetIdAfter && Boolean(srcBefore) && Boolean(srcAfter),
  }
}

async function pasteGeneratedImage(width, height) {
  const editor = page.locator(EDITABLE_EDITOR)
  await editor.waitFor()
  await editor.click()
  const expectedImageCount = await page.locator('.editor img').count() + 1
  await armDurableSaveProbe(expectedImageCount)
  const handled = await editor.evaluate(async (target, { width, height }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context.fillStyle = '#f7f7f8'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#5e6ad2'
    context.fillRect(0, 0, width / 2, height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    const file = new File([blob], 'chart.png', { type: 'image/png' })
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ type: 'image/png', getAsFile: () => file }],
        files: [file],
        types: ['Files'],
        getData: () => '',
      },
    })
    return target.dispatchEvent(event)
  }, { width, height })
  if (handled) throw new Error('生成图片粘贴事件未被编辑器接管')
  await page.locator('.editor img').nth(1).waitFor()
  await waitForDurableSave()
}

await createTrade('BTCUSDT')
const firstTrade = await pasteAndReadImage()
await pasteGeneratedImage(1600, 400)
const firstTradeSecondAsset = await page.locator('.editor img').nth(1).getAttribute('data-asset-id')
await page.locator('.editor img').nth(1).dblclick()
const lightbox = page.getByRole('dialog', { name: '图片预览' })
await lightbox.waitFor({ state: 'visible' })
const lightboxCounter = await page.locator('.img-lightbox-counter').innerText()
await page.keyboard.press('Escape')
await lightbox.waitFor({ state: 'hidden' })
const lightboxWorks = lightboxCounter.trim() === '2 / 2'
await createTrade('ETHUSDT')
const secondTrade = await pasteAndReadImage()
await page.goto(firstTrade.href, { waitUntil: 'networkidle' })
await page.locator(EDITABLE_EDITOR).waitFor()
const reopenedFirst = {
  tradeId: new URL(page.url()).pathname.split('/').pop(),
  assetId: await page.locator('.editor img').first().getAttribute('data-asset-id'),
  editorSrc: await page.locator('.editor img').first().getAttribute('src'),
  imageCount: await page.locator('.editor img').count(),
}
const twoTradeOwnership =
  Boolean(firstTrade.tradeId) &&
  Boolean(secondTrade.tradeId) &&
  firstTrade.tradeId !== secondTrade.tradeId &&
  Boolean(firstTrade.assetId) &&
  Boolean(secondTrade.assetId) &&
  firstTrade.assetId !== secondTrade.assetId &&
  Boolean(firstTradeSecondAsset) &&
  firstTradeSecondAsset !== firstTrade.assetId &&
  firstTradeSecondAsset !== secondTrade.assetId &&
  reopenedFirst.tradeId === firstTrade.tradeId &&
  reopenedFirst.assetId === firstTrade.assetId &&
  reopenedFirst.imageCount === 2 &&
  firstTrade.stableAfterReload &&
  secondTrade.stableAfterReload &&
  reopenedFirst.assetId !== secondTrade.assetId

console.log(firstTrade.imgBefore > 0 ? '✓ 粘贴后编辑器出现图片' : '✗ 粘贴后无图片', `(count=${firstTrade.imgBefore})`)
console.log(firstTrade.imgAfter > 0 ? '✓ 刷新后图片仍在' : '✗ 刷新后图片丢失', `(count=${firstTrade.imgAfter})`)
console.log(
  twoTradeOwnership ? '✓ 两笔交易的主截图与各自资产保持隔离' : '✗ 两笔交易出现图片归属混淆',
  `(first=${firstTrade.tradeId ?? 'none'}, second=${secondTrade.tradeId ?? 'none'})`,
)
console.log(
  lightboxWorks ? '✓ 双击内联截图可打开对应图片预览' : '✗ 图片预览未打开正确索引',
  `(counter=${lightboxCounter})`,
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
    lightboxWorks &&
    assetTests.every((result) => result.pass)
    ? 0
    : 1,
)
