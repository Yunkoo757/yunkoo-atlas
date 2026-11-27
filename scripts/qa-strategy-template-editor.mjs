import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { startQaServer } from './qa-vite-server.mjs'

const server = await startQaServer({ configFile: 'vite.config.ts' })

let browser
try {
  const baseUrl = server.baseUrl

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(new URL('/settings/strategies', baseUrl).href)
  await page.getByRole('button', { name: '新建策略', exact: true }).click()

  const editor = page.locator('.sfm-editor .ProseMirror')
  await editor.waitFor()
  assert.equal(await page.locator('.sfm-editor ul[data-type="taskList"] li').count(), 4)
  assert.equal((await editor.textContent())?.includes('<p><strong>'), false)

  await page.getByRole('textbox', { name: '名称', exact: true }).fill('模板编辑回归')
  await editor.click()
  await editor.press('Control+End')
  await editor.type(' 补充检查')
  await page.getByRole('button', { name: '创建', exact: true }).click()

  await page.getByRole('button', { name: '编辑 模板编辑回归', exact: true }).click()
  assert.equal((await page.locator('.sfm-editor .ProseMirror').textContent())?.includes('补充检查'), true)
  console.log('PASS: strategy template renders and persists as rich text')
} finally {
  await browser?.close()
  await server.close()
}
