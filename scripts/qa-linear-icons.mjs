import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  if (!baseUrl) throw new Error('Vite did not expose a local URL')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  await page.goto(new URL('/assets/linear-icon-system/gallery.html', baseUrl).href)
  await page.waitForSelector('.icon-card')
  const count = await page.locator('.icon-card').count()
  if (count !== 301) throw new Error(`Expected 301 icon cards, received ${count}`)
  await page.locator('#icon-search').fill('face-heart-eyes')
  if ((await page.locator('.icon-card').count()) !== 1) {
    throw new Error('Search did not narrow to one icon')
  }
  await page.locator('#progress-control').fill('0.75')
  const runningAnimations = await page.evaluate(
    () => document.getAnimations().filter((animation) => animation.playState === 'running').length,
  )
  if (runningAnimations !== 0) throw new Error('Reduced motion still has running animations')
  console.log('PASS Linear icon gallery: 301 icons, search, progress, reduced motion')
} finally {
  await browser?.close()
  await server.close()
}
