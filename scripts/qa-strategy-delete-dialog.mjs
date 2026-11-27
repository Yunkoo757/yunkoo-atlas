import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'
import { startQaServer } from './qa-vite-server.mjs'

const defaultProfile = JSON.parse(
  readFileSync(new URL('../src/config/default-profile.json', import.meta.url), 'utf8'),
)
const defaultStrategyName = defaultProfile.strategies[0]?.name
assert.ok(defaultStrategyName, 'Default profile must define a strategy')

const server = await startQaServer({ configFile: 'vite.config.ts' })

let browser
try {
  const baseUrl = server.baseUrl

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(new URL('/settings/strategies', baseUrl).href)

  await page.getByRole('button', { name: `删除 ${defaultStrategyName}`, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()

  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '取消')
  assert.equal(await page.getByRole('tooltip').count(), 0)

  await page.getByRole('button', { name: '取消', exact: true }).press('Escape')
  await dialog.waitFor({ state: 'detached' })
  console.log('PASS: strategy delete dialog owns focus and closes with Escape')
} finally {
  await browser?.close()
  await server.close()
}
