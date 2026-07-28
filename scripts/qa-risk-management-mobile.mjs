import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const VIEWPORT = { width: 420, height: 844 }
const server = await createServer({
  configFile: 'vite.config.ts',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, open: false },
})

let browser

function watchDiagnostics(page) {
  const diagnostics = []
  page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`)
  })
  return diagnostics
}

async function assertViewport(page) {
  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    mobileMedia: window.matchMedia('(max-width: 560px)').matches,
    documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    bodyOverflow: document.body.scrollWidth > document.body.clientWidth,
  }))
  assert.deepEqual(
    { width: viewport.innerWidth, height: viewport.innerHeight },
    VIEWPORT,
    'QA 必须运行在真实 420×844 viewport',
  )
  assert.equal(viewport.mobileMedia, true, '420px 必须命中移动端 media query')
  assert.equal(viewport.documentOverflow, false, 'document 不得横向溢出')
  assert.equal(viewport.bodyOverflow, false, 'body 不得横向溢出')
}

async function openFixture(browser, baseUrl, pathname, visual) {
  const page = await browser.newPage({ viewport: VIEWPORT })
  const diagnostics = watchDiagnostics(page)
  await page.goto(new URL(`${pathname}?visual=${visual}`, baseUrl).href)
  return { page, diagnostics }
}

async function openLiveCycleFixture(browser, baseUrl) {
  const page = await browser.newPage({ viewport: VIEWPORT })
  const diagnostics = watchDiagnostics(page)
  await page.goto(new URL('/src/components/LiveCycleSettings.browser.test.html?visual=dialog', baseUrl).href)
  return { page, diagnostics }
}

try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  assert.ok(baseUrl, 'Vite test server did not expose a local URL')
  browser = await chromium.launch({ headless: true })

  const settingsFixture = await openFixture(
    browser,
    baseUrl,
    '/src/views/settings/RiskManagementSettings.browser.test.html',
    'cards',
  )
  try {
    await settingsFixture.page.locator('[data-risk-preparation]').waitFor()
    await assertViewport(settingsFixture.page)
    const layout = await settingsFixture.page.evaluate(() => {
      const preparation = document.querySelector('[data-risk-preparation]')
      const fields = document.querySelector('.risk-preparation-fields')
      const actions = document.querySelector('.risk-preparation-actions')
      if (!preparation || !fields || !actions) return null
      const preparationRect = preparation.getBoundingClientRect()
      const privacyInputs = [...preparation.querySelectorAll('input')]
      return {
        preparationOverflow: preparation.scrollWidth > preparation.clientWidth,
        fieldsColumns: getComputedStyle(fields).gridTemplateColumns.split(' ').length,
        actionsDirection: getComputedStyle(actions).flexDirection,
        preparationWithinViewport: preparationRect.left >= 0 && preparationRect.right <= window.innerWidth,
        privacyInputsOverflow: privacyInputs.some((input) => input.scrollWidth > input.clientWidth),
      }
    })
    assert.ok(layout, '风险管理设置页缺少准备卡移动布局节点')
    assert.equal(layout.preparationOverflow, false, '准备卡不得横向溢出')
    assert.equal(layout.fieldsColumns, 1, '准备字段在 420px 必须为单列')
    assert.equal(layout.actionsDirection, 'column', '准备动作在 420px 必须纵向排列')
    assert.equal(layout.preparationWithinViewport, true, '准备卡必须完整位于 viewport 内')
    const actionButtons = settingsFixture.page.locator('.risk-preparation-actions button')
    const actionCount = await actionButtons.count()
    assert.ok(actionCount > 0, '准备动作必须存在')
    for (let index = 0; index < actionCount; index += 1) {
      const action = actionButtons.nth(index)
      await action.scrollIntoViewIfNeeded()
      assert.equal(await action.isVisible(), true, '准备动作必须滚动后可见')
      assert.equal(await action.isEnabled(), true, '准备动作必须可用')
      const target = await action.evaluate((button) => {
        const rect = button.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        return {
          withinViewport: rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight + 1,
          hitsButton: hit === button || Boolean(hit && button.contains(hit)),
        }
      })
      assert.equal(target.withinViewport, true, '准备动作必须完整进入 viewport')
      assert.equal(target.hitsButton, true, '准备动作中心命中必须落在按钮自身或后代')
    }
    assert.equal(layout.privacyInputsOverflow, false, '隐私输入不得横向溢出')
    assert.deepEqual(settingsFixture.diagnostics, [], '准备卡移动 QA 不得产生浏览器错误')
  } finally {
    await settingsFixture.page.close()
  }

  const dialogFixture = await openFixture(browser, baseUrl, '/src/components/RiskManagement.browser.test.html', 'dialog')
  try {
    const dialog = dialogFixture.page.locator('[data-trade-open-risk-dialog]')
    await dialog.waitFor({ timeout: 15_000 })
    await dialogFixture.page.evaluate(() => Promise.all(
      document.getAnimations().map((animation) => animation.finished),
    ))
    await assertViewport(dialogFixture.page)
    const statusLayout = await dialogFixture.page.evaluate(() => {
      const status = document.querySelector('[data-risk-status]')
      const periods = document.querySelector('.risk-status-periods')
      const recovery = status?.querySelector('a[href="/settings/risk"]')
      if (!status || !periods) return null
      const statusRect = status.getBoundingClientRect()
      const recoveryRect = recovery?.getBoundingClientRect()
      return {
        periodColumns: getComputedStyle(periods).gridTemplateColumns.split(' ').length,
        statusOverflow: status.scrollWidth > status.clientWidth,
        statusWithinViewport: statusRect.left >= 0 && statusRect.right <= window.innerWidth,
        recoveryExists: Boolean(recovery),
        recoveryHeight: recoveryRect?.height ?? null,
      }
    })
    assert.ok(statusLayout, '今日工作台缺少风险状态移动布局节点')
    assert.equal(statusLayout.periodColumns, 1, '风险状态在 420px 必须为单列')
    assert.equal(statusLayout.statusOverflow, false, '风险状态不得横向溢出')
    assert.equal(statusLayout.statusWithinViewport, true, '风险状态必须完整位于 viewport 内')
    assert.equal(statusLayout.recoveryExists, true, '未知风险状态必须提供恢复链接')
    assert.ok(statusLayout.recoveryHeight >= 44, '风险恢复动作不得小于 44px')
    const layout = await dialogFixture.page.evaluate(() => {
      const form = document.querySelector('[data-trade-open-risk-dialog]')
      const periods = document.querySelector('.trade-open-risk-periods')
      const policy = document.querySelector('.trade-open-risk-policy')
      const shell = form?.closest('[role="dialog"]')
      const footer = shell?.querySelector('.modal-shell-footer')
      const mainAction = [...(footer?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === '确认继续开仓')
      if (!form || !periods || !policy || !shell || !footer || !mainAction) return null
      const shellRect = shell.getBoundingClientRect()
      const footerRect = footer.getBoundingClientRect()
      const actionRect = mainAction.getBoundingClientRect()
      return {
        periodsColumns: getComputedStyle(periods).gridTemplateColumns.split(' ').length,
        policyColumns: getComputedStyle(policy).gridTemplateColumns.split(' ').length,
        shellOverflow: shell.scrollWidth > shell.clientWidth,
        shellWithinViewport: shellRect.left >= 0 && shellRect.right <= window.innerWidth,
        shellTop: shellRect.top,
        shellBottomGap: Math.abs(window.innerHeight - shellRect.bottom),
        footerFullyVisible: footerRect.top >= 0 && footerRect.bottom <= window.innerHeight,
        actionFullyVisible: actionRect.top >= 0 && actionRect.bottom <= window.innerHeight,
        actionHeight: actionRect.height,
      }
    })
    assert.ok(layout, '真实风控 fixture 缺少 Gate 移动布局节点')
    assert.equal(layout.periodsColumns, 1, 'Gate 日周月预算在 420px 必须为单列')
    assert.equal(layout.policyColumns, 1, 'Gate 规则摘要在 420px 必须为单列')
    assert.equal(layout.shellOverflow, false, 'Gate 不得横向溢出')
    assert.equal(layout.shellWithinViewport, true, 'Gate 必须完整位于 viewport 内')
    assert.ok(layout.shellTop >= 0, 'Gate 底部抽屉顶部不得越出 viewport')
    assert.ok(layout.shellBottomGap <= 1, 'Gate 必须贴合 viewport 底部')
    assert.equal(layout.footerFullyVisible, true, 'Gate footer 必须完整可见')
    assert.equal(layout.actionFullyVisible, true, 'Gate 主动作必须完整可见')
    assert.ok(layout.actionHeight >= 44, 'Gate 主动作触控高度不得小于 44px')
    assert.deepEqual(dialogFixture.diagnostics, [], 'Gate 移动 QA 不得产生浏览器错误')
  } finally {
    await dialogFixture.page.close()
  }

  const liveCycleFixture = await openLiveCycleFixture(browser, baseUrl)
  try {
    const dialog = liveCycleFixture.page.locator('[data-live-cycle-dialog]')
    await dialog.waitFor({ timeout: 15_000 })
    await liveCycleFixture.page.evaluate(() => Promise.all(
      document.getAnimations().map((animation) => animation.finished),
    ))
    await assertViewport(liveCycleFixture.page)
    const layout = await liveCycleFixture.page.evaluate(() => {
      const content = document.querySelector('[data-live-cycle-dialog]')
      const counts = document.querySelector('.live-cycle-counts')
      const shell = content?.closest('[role="dialog"]')
      const footer = shell?.querySelector('.modal-shell-footer')
      const action = [...(footer?.querySelectorAll('button') ?? [])]
        .find((button) => button.textContent?.trim() === '确认建立新周期')
      const previewRow = document.querySelector('.live-cycle-preview-list > div')
      const longFields = previewRow ? [...previewRow.querySelectorAll('code, span, time')] : []
      if (!content || !counts || !shell || !footer || !action || !previewRow || longFields.length !== 3) return null
      const shellRect = shell.getBoundingClientRect()
      const footerRect = footer.getBoundingClientRect()
      const actionRect = action.getBoundingClientRect()
      return {
        countsColumns: getComputedStyle(counts).gridTemplateColumns.split(' ').length,
        shellOverflow: shell.scrollWidth > shell.clientWidth,
        shellWithinViewport: shellRect.left >= 0 && shellRect.right <= window.innerWidth,
        footerFullyVisible: footerRect.top >= 0 && footerRect.bottom <= window.innerHeight,
        actionFullyVisible: actionRect.top >= 0 && actionRect.bottom <= window.innerHeight,
        actionHeight: actionRect.height,
        previewRowOverflow: previewRow.scrollWidth > previewRow.clientWidth,
        longTextSafe: longFields.every((field) => {
          const style = getComputedStyle(field)
          const rect = field.getBoundingClientRect()
          const rowRect = previewRow.getBoundingClientRect()
          return style.overflow === 'hidden' && style.textOverflow === 'ellipsis' &&
            rect.left >= rowRect.left && rect.right <= rowRect.right
        }),
      }
    })
    assert.ok(layout, '实盘新周期 fixture 缺少预览弹窗节点')
    assert.equal(layout.countsColumns, 1, '新周期预览数量卡在 420px 必须为单列')
    assert.equal(layout.shellOverflow, false, '新周期预览不得横向溢出')
    assert.equal(layout.shellWithinViewport, true, '新周期预览必须完整位于 viewport 内')
    assert.equal(layout.footerFullyVisible, true, '新周期预览 footer 必须完整可见')
    assert.equal(layout.actionFullyVisible, true, '新周期预览主动作必须完整可见')
    assert.ok(layout.actionHeight >= 44, '新周期预览主动作触控高度不得小于 44px')
    assert.equal(layout.previewRowOverflow, false, '长 ref/symbol 不得撑开新周期预览行')
    assert.equal(layout.longTextSafe, true, '长 ref/symbol 必须在自身单元格内截断')
    assert.deepEqual(liveCycleFixture.diagnostics, [], '新周期预览移动 QA 不得产生浏览器错误')
  } finally {
    await liveCycleFixture.page.close()
  }

  console.log('PASS: risk management and live cycle mobile QA at 420×844')
} finally {
  await browser?.close()
  await server.close()
}
