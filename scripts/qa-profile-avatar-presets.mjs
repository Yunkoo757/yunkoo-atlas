import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { startQaServer } from './qa-vite-server.mjs'

const server = await startQaServer({ configFile: 'vite.config.ts' })

let browser
try {
  const baseUrl = server.baseUrl

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(new URL('/settings/profile', baseUrl).href)
  await page.getByRole('heading', { name: '头像风格', exact: true }).waitFor()

  const presetButtons = page.locator('.profile-avatar-item')
  assert.equal(await presetButtons.count(), 8)
  assert.equal(await page.locator('.profile-avatar-emoji').count(), 0)
  assert.equal(await page.locator('.profile-preview-avatar svg').count(), 1)

  const cobalt = page.getByRole('button', { name: '钴蓝', exact: true })
  await cobalt.click()
  assert.equal(await cobalt.getAttribute('aria-pressed'), 'true')

  await page.reload()
  await page.getByRole('heading', { name: '头像风格', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('button', { name: '钴蓝', exact: true }).getAttribute('aria-pressed'),
    'true',
  )

  console.log('PASS: profile uses eight persistent vector avatar presets')
} finally {
  await browser?.close()
  await server.close()
}
