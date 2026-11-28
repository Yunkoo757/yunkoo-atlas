import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright'
import { receivesKeyboardFocus } from '../qa-keyboard-focus.mjs'
import { startQaServer } from '../qa-vite-server.mjs'

test('交易录入使用本地交易日，按钮和快捷键打开的弹窗均支持键盘退出', async () => {
  const server = await startQaServer({ configFile: 'vite.config.ts', restrictToRoot: true })
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 960, height: 640 }, timezoneId: 'Asia/Hong_Kong' })
    await page.clock.setFixedTime(new Date('2026-07-11T21:59:59Z'))
    await page.goto(new URL('/list', server.baseUrl).href)
    const opener = page.getByRole('button', { name: '新建交易', exact: true })
    const dialog = page.getByRole('dialog', { name: '新建交易', exact: true })
    const date = dialog.getByRole('button', { name: '交易日期', exact: true })
    await opener.click()
    await dialog.waitFor()
    assert.equal(await dialog.getAttribute('aria-modal'), 'true')
    assert.ok(await receivesKeyboardFocus(dialog.getByRole('combobox', { name: '交易品种' })))

    await dialog.getByRole('button', { name: '更多信息' }).click()
    assert.equal((await date.innerText()).trim(), '2026-07-11')
    const save = dialog.getByRole('button', { name: '保存记录', exact: true })
    const close = dialog.getByRole('button', { name: '关闭', exact: true })
    await save.focus()
    await page.keyboard.press('Tab')
    assert.ok(await receivesKeyboardFocus(close))
    await page.keyboard.press('Shift+Tab')
    assert.ok(await receivesKeyboardFocus(save))
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })

    // 香港时间 06:00，UTC 仍为 7 月 11 日。重新打开表单应采用新的本地交易日。
    await page.clock.setFixedTime(new Date('2026-07-11T22:00:00Z'))
    await page.keyboard.press('n')
    await dialog.waitFor()
    await dialog.getByRole('button', { name: '更多信息' }).click()
    assert.equal((await date.innerText()).trim(), '2026-07-12')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
  } finally {
    await browser?.close()
    await server.close()
  }
})
