import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({
  configFile: 'vite.config.ts',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, open: false },
})

let browser
try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  assert.ok(baseUrl, 'Vite test server did not expose a local URL')

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
