import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { startQaServer } from './qa-vite-server.mjs'
import { collectResolvedProbe } from './qa-theme-luminance.mjs'
import { THEME_LUMINANCE_THRESHOLDS } from './theme-luminance-contract.mjs'

const server = await startQaServer({ configFile: 'vite.config.ts' })

let browser
try {
  const baseUrl = server.baseUrl

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 960, height: 720 }, reducedMotion: 'reduce' })
  await page.goto(new URL('/settings/strategies', baseUrl).href)
  await page.getByRole('button', { name: '新建策略', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: '新建策略' })
  await dialog.waitFor()
  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('placeholder')), '如 Breakout、波段趋势')

  const close = dialog.getByRole('button', { name: '关闭', exact: true })
  const cancel = page.getByRole('button', { name: '取消', exact: true })
  await close.focus()
  await close.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '取消')

  await cancel.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭')

  await close.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  console.log('PASS: strategy form contains focus and closes with Escape')

  const samples = [
    { id: 'legacy-color', name: '历史预设', color: '#5E6AD2', label: '靛蓝' },
    { id: 'custom-color', name: '导入自定义色', color: '#142233', label: '自定义色' },
  ]
  for (const { id, name, color, label } of samples) {
    await page.evaluate(async (strategy) => {
      const { useStore } = await import('/src/store/useStore.ts')
      useStore.getState().addStrategy({ ...strategy, icon: 'target' })
    }, { id, name, color })
    await page.getByRole('link', { name, exact: true }).hover()
    await page.getByRole('button', { name: '编辑 ' + name, exact: true }).click()
    const editDialog = page.getByRole('dialog', { name: '编辑策略' })
    const palette = editDialog.getByRole('group', { name: '配色' })
    const initialChoice = palette.getByRole('button', { name: label, exact: true })
    assert.equal(await initialChoice.getAttribute('aria-pressed'), 'true')
    const rows = await palette.getByRole('button').evaluateAll(buttons =>
      new Set(buttons.map(button => button.getBoundingClientRect().top)).size)
    assert.equal(rows, 1, 'presets including the optional custom swatch fit the compact dialog')
    for (const choice of await palette.getByRole('button').all()) {
      await choice.click()
      const glyph = await collectResolvedProbe(page, '.sfm-preview .strategy-icon svg', {})
      assert.ok(glyph.contrast >= 4.5, `${await choice.getAttribute('aria-label')} glyph contrast: ${glyph.contrast}`)
    }
    await initialChoice.click()
    const text = await collectResolvedProbe(page, '.sfm-preview > span:last-child', {})
    assert.ok(text.contrast >= THEME_LUMINANCE_THRESHOLDS.supporting, `preview text contrast: ${text.contrast}`)
    await editDialog.getByRole('button', { name: '保存', exact: true }).click()
    const saved = await page.evaluate(async (id) => {
      const { useStore } = await import('/src/store/useStore.ts')
      return useStore.getState().strategies.find(strategy => strategy.id === id)?.color
    }, id)
    assert.equal(saved, color, 'reselecting an existing color preserves its original stored value')
  }
  console.log('PASS: strategy glyphs and preview text meet contrast targets and preserve legacy and custom colors')

  await page.getByRole('link', { name: '导入自定义色', exact: true }).hover()
  await page.getByRole('button', { name: '删除 导入自定义色', exact: true }).click()
  const confirm = page.locator('.ui-btn-danger-solid:enabled')
  await confirm.waitFor()
  await page.mouse.move(1, 1)
  for (const state of ['rest', 'hover']) {
    if (state === 'hover') await confirm.hover()
    await confirm.evaluate(async button => {
      await Promise.all(button.getAnimations().map(animation => animation.finished))
    })
    const resolved = await collectResolvedProbe(page, '.ui-btn-danger-solid:enabled', {})
    assert.ok(resolved.contrast >= 4.5, `destructive button ${state} contrast: ${resolved.contrast}`)
  }
  await page.getByRole('button', { name: '取消', exact: true }).click()
  console.log('PASS: destructive confirmation text meets contrast targets at rest and on hover')
} finally {
  await browser?.close()
  await server.close()
}
