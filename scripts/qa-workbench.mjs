import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const BASE = process.env.QA_BASE_URL ?? 'http://localhost:5181'
const BASELINE_OUT = join(process.cwd(), 'test-results', 'trader-atlas-baseline')
const CONTROLLED_PROBE_URL = process.env.QA_WORKBENCH_PROBE_URL
const PRESENTATION_REPORT_PATH = process.env.QA_WORKBENCH_REPORT_PATH
  ?? join(BASELINE_OUT, 'workbench-presentation.json')
const PRESENTATION_SCREENSHOT_OUT = join(dirname(PRESENTATION_REPORT_PATH), 'workbench-presentation')

function createDiagnostics() {
  return { consoleErrors: [], pageErrors: [], horizontalOverflow: [] }
}

function diagnosticsAreEmpty(diagnostics) {
  return diagnostics.consoleErrors.length === 0
    && diagnostics.pageErrors.length === 0
    && diagnostics.horizontalOverflow.length === 0
}

function hashNormalizedEditorHtml(html) {
  return createHash('sha256').update(html, 'utf8').digest('hex')
}

async function readNormalizedEditorHtml(targetPage) {
  const editorRoot = targetPage.locator('.editor .ProseMirror')
  await editorRoot.waitFor({ state: 'attached', timeout: 10_000 })
  return editorRoot.evaluate((element) => {
    const editor = element.editor
    if (!editor || typeof editor.getHTML !== 'function') {
      throw new Error('复盘编辑器未暴露 TipTap editor.getHTML()')
    }
    const html = editor.getHTML()
    if (typeof html !== 'string') throw new Error('TipTap editor.getHTML() 未返回 HTML 字符串')
    return html
  })
}

async function normalizedEditorHtmlHash(targetPage) {
  return hashNormalizedEditorHtml(await readNormalizedEditorHtml(targetPage))
}

function trackDiagnostics(targetPage, diagnostics, combinedErrors = undefined) {
  targetPage.on('pageerror', (error) => {
    diagnostics.pageErrors.push(error.message)
    combinedErrors?.push(`pageerror: ${error.message}`)
  })
  targetPage.on('console', (message) => {
    if (message.type() !== 'error') return
    diagnostics.consoleErrors.push(message.text())
    combinedErrors?.push(`console: ${message.text()}`)
  })
}

async function collectPresentationMetrics(targetPage, {
  navigate,
  setFocusPreference,
  reviewHtmlBaselineHash,
  screenshotOut = PRESENTATION_SCREENSHOT_OUT,
  diagnostics,
}) {
  mkdirSync(screenshotOut, { recursive: true })
  const steps = []

  async function captureStep(name) {
    const overflow = await targetPage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    if (overflow.scrollWidth > overflow.clientWidth) {
      diagnostics.horizontalOverflow.push({ step: name, ...overflow })
    }
    const screenshotPath = join(screenshotOut, `${name}.png`)
    await targetPage.screenshot({ path: screenshotPath, fullPage: false })
    steps.push({ name, screenshotPath })
  }

  async function measureFocus(focusPreference) {
    await navigate('settings')
    await setFocusPreference(focusPreference === 'on')
    await navigate('list')
    const main = targetPage.locator('#main-content')
    await main.waitFor({ state: 'visible', timeout: 10_000 })
    await main.focus()
    const metric = await main.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        focusPreference: document.documentElement.dataset.keyboardFocusRings ?? '',
        activeElement: document.activeElement?.id ?? '',
        focusOutlineWidth: style.outlineStyle === 'none'
          ? 0
          : Number.parseFloat(style.outlineWidth) || 0,
      }
    })
    await captureStep(`focus-${focusPreference}`)
    return metric
  }

  const focusOff = await measureFocus('off')
  const focusOn = await measureFocus('on')

  await navigate('review')
  await targetPage.locator('.dv-review-complete-meta').waitFor({ state: 'visible', timeout: 10_000 })
  const reviewHtmlReloadedHash = await normalizedEditorHtmlHash(targetPage)
  const reviewDom = await targetPage.evaluate(() => {
    const visualHeadings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
      .filter((element) => {
        const style = getComputedStyle(element)
        return element.textContent?.trim() === '复盘正文'
          && style.display !== 'none'
          && style.visibility !== 'hidden'
      })
    const context = document.querySelector('section[data-review-context]')
    const image = context?.nextElementSibling
    const following = image?.nextElementSibling
    if (!(context instanceof HTMLElement) || !(image instanceof HTMLImageElement)) {
      throw new Error('已复盘交易缺少连续的盘面摘要与首图')
    }
    const contextRect = context.getBoundingClientRect()
    const imageRect = image.getBoundingClientRect()
    const followingRect = following instanceof HTMLElement ? following.getBoundingClientRect() : null
    return {
      reviewVisualHeadingCount: visualHeadings.length,
      reviewContextImageGap: Math.round(imageRect.top - contextRect.bottom),
      reviewImageFollowingGap: followingRect ? Math.round(followingRect.top - imageRect.bottom) : null,
      order: [context.tagName, image.tagName, following?.tagName ?? ''],
    }
  })
  const review = {
    reviewVisualHeadingCount: reviewDom.reviewVisualHeadingCount,
    reviewContextImageGap: reviewDom.reviewContextImageGap,
    reviewImageFollowingGap: reviewDom.reviewImageFollowingGap,
    reviewHtmlBaselineHash,
    reviewHtmlReloadedHash,
    htmlRoundTripMatches: reviewHtmlBaselineHash === reviewHtmlReloadedHash,
    order: reviewDom.order,
  }
  await captureStep('review-document-flow')

  await navigate('list')
  const columns = targetPage.locator('.trade-list-columns').first()
  const firstHeader = targetPage.locator('.trade-list-group-header').first()
  await columns.waitFor({ state: 'visible', timeout: 10_000 })
  await firstHeader.waitFor({ state: 'visible', timeout: 10_000 })
  const tradeGroupTopGap = await targetPage.evaluate(() => {
    const columnRow = document.querySelector('.trade-list-columns')
    const groupHeader = document.querySelector('.trade-list-group-header')
    if (!(columnRow instanceof HTMLElement) || !(groupHeader instanceof HTMLElement)) {
      throw new Error('交易日志缺少列标题或首个月份条')
    }
    return Math.round(groupHeader.getBoundingClientRect().top - columnRow.getBoundingClientRect().bottom)
  })
  const toggle = firstHeader.locator('.trade-list-group-toggle')
  await toggle.click()
  await targetPage.waitForFunction(() => (
    document.querySelector('.trade-list-group-toggle')?.getAttribute('aria-expanded') === 'false'
  ))
  const collapsed = await toggle.getAttribute('aria-expanded') === 'false'
  await toggle.click()
  await targetPage.waitForFunction(() => (
    document.querySelector('.trade-list-group-toggle')?.getAttribute('aria-expanded') === 'true'
  ))
  const expanded = await toggle.getAttribute('aria-expanded') === 'true'

  const scrollHost = targetPage.locator('[data-trade-scroll], .list-scroll').first()
  await scrollHost.evaluate((element) => {
    element.scrollTop = element.scrollHeight
    element.dispatchEvent(new Event('scroll'))
  })
  await targetPage.waitForTimeout(100)
  const stickyHeader = targetPage.locator(
    '.trade-list-virtual-item.is-sticky .trade-list-group-header',
  ).first()
  await stickyHeader.waitFor({ state: 'visible', timeout: 10_000 })
  const stickyTradeGroupTopGap = await targetPage.evaluate(() => {
    const columnRow = document.querySelector('.trade-list-columns')
    const groupHeader = document.querySelector(
      '.trade-list-virtual-item.is-sticky .trade-list-group-header',
    )
    if (!(columnRow instanceof HTMLElement) || !(groupHeader instanceof HTMLElement)) {
      throw new Error('滚动后缺少吸顶月份条')
    }
    return Math.round(groupHeader.getBoundingClientRect().top - columnRow.getBoundingClientRect().bottom)
  })
  await captureStep('trade-list-sticky')
  await scrollHost.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await targetPage.waitForTimeout(50)
  const scrolledBackToTop = await scrollHost.evaluate((element) => element.scrollTop === 0)
  await captureStep('trade-list-top')

  return {
    metrics: {
      focusOff,
      focusOn,
      review,
      tradeList: {
        tradeGroupTopGap,
        stickyTradeGroupTopGap,
        collapsed,
        expanded,
        scrolledBackToTop,
      },
    },
    diagnostics,
    steps,
  }
}

async function runControlledProbe() {
  const diagnostics = createDiagnostics()
  const probeBrowser = await chromium.launch({ headless: true })
  const probePage = await probeBrowser.newPage({ viewport: { width: 1280, height: 800 } })
  trackDiagnostics(probePage, diagnostics)
  try {
    await probePage.goto(CONTROLLED_PROBE_URL, { waitUntil: 'domcontentloaded' })
    const reviewHtmlBaselineHash = await normalizedEditorHtmlHash(probePage)
    const report = await collectPresentationMetrics(probePage, {
      diagnostics,
      reviewHtmlBaselineHash,
      navigate: async (view) => {
        await probePage.evaluate((nextView) => window.__qaWorkbenchShowView(nextView), view)
      },
      setFocusPreference: async (enabled) => {
        const toggle = probePage.getByRole('switch', { name: '显示键盘焦点高光' })
        const expected = String(enabled)
        if (await toggle.getAttribute('aria-checked') !== expected) await toggle.click()
        await probePage.waitForFunction((value) => (
          document.documentElement.dataset.keyboardFocusRings === value
        ), enabled ? 'on' : 'off')
      },
    })
    mkdirSync(dirname(PRESENTATION_REPORT_PATH), { recursive: true })
    writeFileSync(PRESENTATION_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    if (!diagnosticsAreEmpty(diagnostics) || !report.metrics.review.htmlRoundTripMatches) {
      process.exitCode = 1
    }
  } finally {
    await probeBrowser.close()
  }
}

if (CONTROLLED_PROBE_URL) {
  await runControlledProbe()
} else {
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
})
let page = await context.newPage()
const results = []
const runtimeErrors = []
const diagnostics = createDiagnostics()
let presentationReport = null
let reviewHtmlBaselineHash = null

mkdirSync(BASELINE_OUT, { recursive: true })

function trackRuntimeErrors(targetPage) {
  trackDiagnostics(targetPage, diagnostics, runtimeErrors)
}

trackRuntimeErrors(page)

async function recyclePage(viewport = { width: 1280, height: 800 }) {
  await page.close()
  page = await context.newPage()
  trackRuntimeErrors(page)
  await page.setViewportSize(viewport)
}

function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function selectValue(trigger, value) {
  await trigger.click()
  await page.locator(`.ui-select-option[data-value="${value}"]`).click()
}

async function selectDate(trigger, value) {
  const [targetYear, targetMonth] = value.split('-').map(Number)
  const ariaLabel = await trigger.getAttribute('aria-label')
  if (!ariaLabel || !targetYear || !targetMonth) throw new Error(`Invalid date selection: ${value}`)
  await trigger.click()
  const calendar = page.getByRole('dialog', { name: `${ariaLabel}日历` })
  await calendar.waitFor({ state: 'visible' })
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const heading = await calendar.locator('.ui-date-head strong').innerText()
    const match = /^(\d+)年(\d+)月$/.exec(heading)
    if (!match) throw new Error(`Unexpected calendar heading: ${heading}`)
    const current = Number(match[1]) * 12 + Number(match[2])
    const target = targetYear * 12 + targetMonth
    if (current === target) {
      await calendar.getByRole('gridcell', { name: value, exact: true }).click()
      return
    }
    await calendar.getByRole('button', { name: current > target ? '上个月' : '下个月' }).click()
  }
  throw new Error(`Calendar did not reach ${value}`)
}

async function waitForApp(targetPage = page) {
  const loading = targetPage.locator('.app-loading')
  if (await loading.count()) {
    await loading.waitFor({ state: 'hidden', timeout: 30000 })
  }
  await targetPage.locator('.ui-main-frame').waitFor({ state: 'visible', timeout: 30000 })
}

async function openComposer(label, dialogName) {
  const accessibleName = new RegExp(`^${label}(?:（.*）)?$`)
  await page.getByRole('button', { name: accessibleName }).first().click()
  await page.getByRole('dialog', { name: dialogName, exact: true }).waitFor({
    state: 'visible',
    timeout: 10_000,
  })
}

async function readSystemActivity() {
  const toggle = page.getByRole('button', { name: /活动记录/ })
  await toggle.waitFor({ state: 'visible', timeout: 10000 })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }
  return page.locator('.dv-activity-panel .dv-feed').innerText()
}

try {
  await page.goto(`${BASE}/review-cases`, { waitUntil: 'domcontentloaded' })
  await waitForApp()

  await page.locator('.list-scroll')
    .getByRole('button', { name: '新建案例记录', exact: true })
    .click()
  await selectValue(page.getByRole('combobox', { name: '案例记录品种' }), 'ETHUSDT')
  await selectValue(page.getByRole('combobox', { name: '案例类型' }), 'mistake')
  await page.locator('.composer-btn-primary').click()
  await page.waitForURL(/\/trade\/CAS-/, { timeout: 10000 })

  const editor = page.locator('.editor .ProseMirror')
  await editor.waitFor({ state: 'visible', timeout: 10000 })
  const placeholder = await editor.locator('p').first().getAttribute('data-placeholder')
  const activityText = await readSystemActivity()
  record(
    '案例详情使用案例语义',
    placeholder?.includes('案例复盘') === true && activityText.includes('创建了这条案例记录'),
    `placeholder=${placeholder ?? 'none'}`,
  )
  await page.getByRole('button', { name: '状态 计划中', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '盈利', exact: true }).click()

  await page.setViewportSize({ width: 1080, height: 800 })
  const detail1080 = await page.evaluate(() => {
    const props = document.querySelector('.dv-props')?.getBoundingClientRect()
    const main = document.querySelector('.dv-main')?.getBoundingClientRect()
    return {
      propsWidth: Math.round(props?.width ?? 0),
      mainWidth: Math.round(main?.width ?? 0),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
  record(
    '1080px 详情主列与属性列不裁切',
    detail1080.propsWidth >= 300 && detail1080.mainWidth >= 480 && !detail1080.overflow,
    JSON.stringify(detail1080),
  )

  await page.setViewportSize({ width: 800, height: 760 })
  const propertiesToggle = page.getByRole('button', { name: '打开交易属性' })
  await propertiesToggle.click()
  const propertiesPanel = page.locator('.dv-props.is-properties-open')
  await propertiesPanel.waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const panel = document.querySelector('.dv-props.is-properties-open')
    if (!panel) return false
    const rect = panel.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= document.documentElement.clientWidth
  })
  const drawerRect = await propertiesPanel.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      viewport: document.documentElement.clientWidth,
    }
  })
  const drawerRole = await propertiesPanel.getAttribute('role')
  const drawerModal = await propertiesPanel.getAttribute('aria-modal')
  const drawerFocusables = propertiesPanel.locator(
    'button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
  )
  const firstDrawerControl = drawerFocusables.first()
  const lastDrawerControl = drawerFocusables.last()
  await lastDrawerControl.focus()
  await page.keyboard.press('Tab')
  const tabWrapsForward = await firstDrawerControl.evaluate(
    (element) => element === document.activeElement,
  )
  await firstDrawerControl.focus()
  await page.keyboard.press('Shift+Tab')
  const tabWrapsBackward = await lastDrawerControl.evaluate(
    (element) => element === document.activeElement,
  )
  await page.keyboard.press('Escape')
  await page.locator('.dv-props.is-properties-open').waitFor({ state: 'hidden' })
  await page.waitForFunction(() =>
    document.activeElement?.getAttribute('aria-label') === '打开交易属性',
  )
  const drawerFocusReturned = await propertiesToggle.evaluate(
    (element) => element === document.activeElement,
  )
  record(
    '窄屏交易属性抽屉可用',
    drawerRect.left >= 0 &&
      drawerRect.right <= drawerRect.viewport &&
      drawerRole === 'dialog' &&
      drawerModal === 'true' &&
      tabWrapsForward &&
      tabWrapsBackward &&
      drawerFocusReturned,
    JSON.stringify({
      ...drawerRect,
      modal: drawerRole === 'dialog' && drawerModal === 'true',
      focusTrapped: tabWrapsForward && tabWrapsBackward,
      focusReturned: drawerFocusReturned,
    }),
  )

  await page.setViewportSize({ width: 1280, height: 800 })

  await page.goto(`${BASE}/today-record`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
  await openComposer('新建交易', '新建交易')
  await selectValue(page.getByRole('combobox', { name: '交易品种' }), 'XAUUSD')
  await page.getByRole('button', { name: '做空' }).click()
  await selectDate(page.getByRole('button', { name: '交易日期' }), '2025-06-15')
  const composerDialog = page.getByRole('dialog', { name: '新建交易', exact: true })
  const strategySelect = composerDialog.getByRole('combobox', { name: '交易策略' })
  const selectedStrategyId = await strategySelect.getAttribute('data-value')
  const selectedStrategyName = await strategySelect.locator('.ui-select-value').innerText()
  await page.locator('.composer-btn-primary').click()
  await page.waitForURL(/\/trade\/TRD-/, { timeout: 10000 })
  const reviewedTradeRef = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '')
  const liveActivityText = await readSystemActivity()
  const liveProperties = await page.locator('.dv-props').innerText()
  await page.waitForFunction(async (tradeRef) => {
    return new Promise((resolve) => {
      const open = indexedDB.open('trader-atlas-v3')
      open.onerror = () => resolve(false)
      open.onsuccess = () => {
        const database = open.result
        const request = database.transaction('snapshot', 'readonly').objectStore('snapshot').get('main')
        request.onerror = () => { database.close(); resolve(false) }
        request.onsuccess = async () => {
          try {
            const snapshot = request.result instanceof Blob
              ? JSON.parse(await request.result.text())
              : request.result
            resolve(snapshot?.trades?.some((candidate) => candidate.ref === tradeRef) === true)
          } catch {
            resolve(false)
          } finally {
            database.close()
          }
        }
      }
    })
  }, reviewedTradeRef, { timeout: 10_000 })
  const createdTrade = await page.evaluate(async (tradeRef) => {
    return new Promise((resolve) => {
      const open = indexedDB.open('trader-atlas-v3')
      open.onerror = () => resolve(null)
      open.onsuccess = () => {
        const database = open.result
        const request = database.transaction('snapshot', 'readonly').objectStore('snapshot').get('main')
        request.onerror = () => { database.close(); resolve(null) }
        request.onsuccess = async () => {
          try {
            const snapshot = request.result instanceof Blob
              ? JSON.parse(await request.result.text())
              : request.result
            const trade = snapshot?.trades?.find((candidate) => candidate.ref === tradeRef)
            resolve(trade
              ? {
                  openedAt: trade.openedAt,
                  side: trade.side,
                  tradeKind: trade.tradeKind,
                  strategyId: trade.strategyId,
                }
              : null)
          } catch {
            resolve(null)
          } finally {
            database.close()
          }
        }
      }
    })
  }, reviewedTradeRef)
  record(
    '今日记录快速创建实盘交易',
    liveActivityText.includes('创建了这笔交易') &&
      !liveActivityText.includes('创建了这条案例记录') &&
      liveProperties.includes('实盘') &&
      liveProperties.includes('做空') &&
      createdTrade?.openedAt === '2025-06-15' &&
      createdTrade.side === 'short' &&
      createdTrade.tradeKind === 'live' &&
      createdTrade.strategyId === selectedStrategyId,
    JSON.stringify({ url: page.url(), selectedStrategyId, selectedStrategyName, createdTrade }),
  )

  const closeStatusTrigger = page.getByRole('button', { name: '状态 计划中', exact: true })
  await closeStatusTrigger.click()
  await page.getByRole('menuitemradio', { name: '盈利', exact: true }).click()
  const closeDialog = page.getByRole('dialog', { name: '完成平仓' })
  await closeDialog.waitFor({ state: 'visible', timeout: 10000 })
  const closeDialogDismiss = closeDialog.getByRole('button', { name: '关闭', exact: true })
  const closeDialogLastFocusable = closeDialog.locator('button:not(:disabled):visible, input:not(:disabled):visible').last()
  const initialFocusInside = await closeDialog.evaluate((element) =>
    element.contains(document.activeElement),
  )
  await closeDialogDismiss.focus()
  await page.keyboard.press('Shift+Tab')
  const wrapsBackward = await closeDialogLastFocusable.evaluate(
    (element) => element === document.activeElement,
  )
  await page.keyboard.press('Tab')
  const wrapsForward = await closeDialogDismiss.evaluate(
    (element) => element === document.activeElement,
  )
  await page.keyboard.press('Escape')
  await closeDialog.waitFor({ state: 'hidden', timeout: 10000 })
  await page.waitForTimeout(50)
  const focusReturned = await closeStatusTrigger.evaluate(
    (element) => element === document.activeElement,
  )
  const activeAfterClose = await page.evaluate(() => {
    const active = document.activeElement
    return active instanceof HTMLElement
      ? {
          tag: active.tagName,
          className: active.className,
          ariaLabel: active.getAttribute('aria-label'),
          text: active.textContent?.trim().slice(0, 80) ?? '',
        }
      : null
  })
  record(
    '平仓弹窗圈定焦点并在关闭后返还',
    initialFocusInside && wrapsBackward && wrapsForward && focusReturned,
    JSON.stringify({
      initialFocusInside,
      wrapsBackward,
      wrapsForward,
      focusReturned,
      activeAfterClose,
    }),
  )

  await closeStatusTrigger.click()
  await page.getByRole('menuitemradio', { name: '盈利', exact: true }).click()
  await closeDialog.waitFor({ state: 'visible', timeout: 10000 })
  await closeDialog.getByRole('textbox', { name: 'R 倍数', exact: true }).fill('2')
  await closeDialog.getByRole('button', { name: '保存并待复盘', exact: true }).click()
  await closeDialog.waitFor({ state: 'hidden', timeout: 10000 })
  const completeReviewButton = page.getByRole('button', { name: '完成复盘', exact: true })
  await completeReviewButton.waitFor({ state: 'visible' })
  await editor.evaluate((element) => {
    const tiptap = element.editor
    if (!tiptap) throw new Error('复盘编辑器实例不可用')
    tiptap.commands.setContent(
      '<section data-review-context="true"><p>4H 顺势，等待回调极端 POI。</p><p>15m 出现结构确认。</p></section>'
      + '<img src="/src/views/fixtures/browser-test-image.svg?qa-workbench-chart.png">'
      + '<p>复盘证据：确认入场依据，并记录下一次执行改进。</p>',
      { emitUpdate: true },
    )
  })
  await page.waitForFunction(() => {
    const context = document.querySelector('section[data-review-context]')
    return context?.nextElementSibling instanceof HTMLImageElement
  })
  await completeReviewButton.waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const button = document.querySelector('.dv-review-complete-action')
    return button instanceof HTMLButtonElement && !button.disabled
  })
  reviewHtmlBaselineHash = await normalizedEditorHtmlHash(page)
  await completeReviewButton.click()
  await page.locator('.dv-review-complete-meta').waitFor({ state: 'visible' })
  const reviewedStageText = await page.locator('.dv-review-complete-meta').innerText()
  const reviewedPropertiesText = await page.locator('.dv-props').innerText()
  record(
    'R 倍数平仓并补充证据后可完成复盘',
    reviewedStageText.includes('已复盘') &&
      /盈亏\s+—/.test(reviewedPropertiesText) &&
      /R 倍数\s+\+2\.0R/.test(reviewedPropertiesText),
    JSON.stringify({ reviewedTradeRef, reviewedStageText, reviewedPropertiesText }),
  )
  await page.evaluate(async () => {
    const { flushPersistNow } = await import('/src/storage/persist.ts')
    await flushPersistNow()
  })

  await page.goto(`${BASE}/sim`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
  await openComposer('新建交易', '新建交易')
  await selectValue(page.getByRole('combobox', { name: '交易品种' }), 'EURUSD')
  await page.locator('.composer-btn-primary').click()
  await page.waitForURL(/\/trade\/TRD-/, { timeout: 10000 })
  const paperProperties = await page.locator('.dv-props').innerText()
  record('模拟页快速创建模拟交易', paperProperties.includes('模拟'), page.url())

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
  // 仪表盘固定仅实盘；案例与模拟盘不得混入主统计。
  assert.equal(
    await page.getByRole('button', { name: '实盘 + 模拟盘' }).count(),
    0,
    '仪表盘不得再提供实盘+模拟盘切换',
  )
  const dashboardClosedCount = await page.locator('.db-card').filter({ hasText: '胜率' }).locator('.db-card-sub').innerText()
  record(
    '案例记录不计入仪表盘统计',
    dashboardClosedCount.endsWith('1/1 笔结果有效'),
    dashboardClosedCount,
  )

  await page.evaluate(async (sourceRef) => {
    const { useStore } = await import('/src/store/useStore.ts')
    const { flushPersistNow } = await import('/src/storage/persist.ts')
    const source = useStore.getState().trades.find((trade) => trade.ref === sourceRef)
    if (!source) throw new Error(`隔离资料缺少源交易：${sourceRef}`)
    const copies = Array.from({ length: 24 }, (_, index) => {
      const month = index < 12 ? '06' : '05'
      const day = String((index % 12) + 1).padStart(2, '0')
      const openedAt = `2025-${month}-${day}`
      return {
        ...source,
        id: crypto.randomUUID(),
        ref: `TRD-QA-${month}-${day}-${index}`,
        openedAt,
        closedAt: openedAt,
        createdAt: `${openedAt}T08:00:00.000Z`,
        updatedAt: `${openedAt}T09:00:00.000Z`,
      }
    })
    useStore.setState((state) => ({ trades: [...state.trades, ...copies] }))
    await flushPersistNow()
  }, reviewedTradeRef)

  presentationReport = await collectPresentationMetrics(page, {
    diagnostics,
    reviewHtmlBaselineHash,
    navigate: async (view) => {
      const route = view === 'settings'
        ? '/settings/display'
        : view === 'review'
          ? `/trade/${encodeURIComponent(reviewedTradeRef)}`
          : '/list'
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
      await waitForApp()
      if (view === 'settings') {
        await page.getByRole('switch', { name: /显示键盘焦点高光/ }).waitFor({ state: 'visible' })
      } else if (view === 'review') {
        await page.locator('section[data-review-context]').waitFor({ state: 'visible' })
      } else {
        await page.locator('.trade-list-columns').waitFor({ state: 'visible' })
      }
    },
    setFocusPreference: async (enabled) => {
      const toggle = page.getByRole('switch', { name: /显示键盘焦点高光/ })
      const expected = String(enabled)
      if (await toggle.getAttribute('aria-checked') !== expected) await toggle.click()
      await page.waitForFunction((value) => (
        document.documentElement.dataset.keyboardFocusRings === value
      ), enabled ? 'on' : 'off')
      await page.evaluate(async () => {
        const { flushPersistNow } = await import('/src/storage/persist.ts')
        await flushPersistNow()
      })
    },
  })
  record(
    '关闭焦点高光后主内容仍获得焦点且无轮廓',
    presentationReport.metrics.focusOff.focusPreference === 'off'
      && presentationReport.metrics.focusOff.activeElement === 'main-content'
      && presentationReport.metrics.focusOff.focusOutlineWidth === 0,
    JSON.stringify(presentationReport.metrics.focusOff),
  )
  record(
    '开启焦点高光后主内容焦点保持且恢复清晰轮廓',
    presentationReport.metrics.focusOn.focusPreference === 'on'
      && presentationReport.metrics.focusOn.activeElement === 'main-content'
      && presentationReport.metrics.focusOn.focusOutlineWidth >= 2,
    JSON.stringify(presentationReport.metrics.focusOn),
  )
  record(
    '已复盘图文保持连续文档流',
    presentationReport.metrics.review.reviewVisualHeadingCount === 0
      && presentationReport.metrics.review.reviewContextImageGap === 16
      && presentationReport.metrics.review.reviewImageFollowingGap === 16
      && presentationReport.metrics.review.order.join('>') === 'SECTION>IMG>P',
    JSON.stringify(presentationReport.metrics.review),
  )
  record(
    '复盘 HTML 经保存重载后与 TipTap 规范化基线严格一致',
    presentationReport.metrics.review.htmlRoundTripMatches,
    JSON.stringify({
      baseline: presentationReport.metrics.review.reviewHtmlBaselineHash,
      reloaded: presentationReport.metrics.review.reviewHtmlReloadedHash,
    }),
  )
  record(
    '月份条在首组与吸顶状态均保持 8px 且折叠展开稳定',
    presentationReport.metrics.tradeList.tradeGroupTopGap === 8
      && presentationReport.metrics.tradeList.stickyTradeGroupTopGap === 8
      && presentationReport.metrics.tradeList.collapsed
      && presentationReport.metrics.tradeList.expanded
      && presentationReport.metrics.tradeList.scrolledBackToTop,
    JSON.stringify(presentationReport.metrics.tradeList),
  )

  await page.goto(`${BASE}/review-cases/mistakes`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
  await page.locator('.trade-row').first().waitFor({ state: 'visible', timeout: 5000 })
  const desktopLayout = await page.evaluate(() => {
    const row = document.querySelector('.trade-row')
    const rect = row?.getBoundingClientRect()
    return {
      rowExists: Boolean(row),
      viewportWidth: document.documentElement.clientWidth,
      rowRight: rect?.right ?? 0,
    }
  })
  record(
    '1280px 交易列表不裁切',
    desktopLayout.rowExists && desktopLayout.rowRight <= desktopLayout.viewportWidth,
    `rowRight=${Math.round(desktopLayout.rowRight)}, viewport=${desktopLayout.viewportWidth}`,
  )

  const caseRowsBeforeCopy = await page.locator('.trade-row').count()
  await page.locator('.trade-row-check').first().check()
  await page.getByRole('button', { name: '复制案例', exact: true }).click()
  const copyDialog = page.getByRole('dialog', { name: '确认复制所选记录' })
  await copyDialog.waitFor({ state: 'visible', timeout: 5000 })
  const copyPreviewText = await copyDialog.innerText()
  record(
    '安全复制先预览目标语义与数据影响',
    (await page.locator('.trade-row').count()) === caseRowsBeforeCopy &&
      copyPreviewText.includes('目标：新的知识案例') &&
      copyPreviewText.includes('保留') &&
      copyPreviewText.includes('重置'),
    copyPreviewText.replace(/\s+/g, ' ').slice(0, 220),
  )
  await copyDialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '复制案例', exact: true }).click()
  await copyDialog.getByRole('button', { name: '复制 1 个案例', exact: true }).click()
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.trade-row').length === expected,
    caseRowsBeforeCopy + 1,
  )
  record(
    '确认后一次提交生成独立案例副本',
    (await page.locator('.trade-row').count()) === caseRowsBeforeCopy + 1,
    `rows=${await page.locator('.trade-row').count()}`,
  )

  const rowOpen = page.locator('.trade-row-open').first()
  await rowOpen.focus()
  await rowOpen.press('Enter')
  const keyboardOpened = await page.waitForURL(/\/trade\/CAS-/, { timeout: 2000 }).then(() => true).catch(() => false)
  record('键盘 Enter 可打开交易详情', keyboardOpened, page.url())
  await page.goto(`${BASE}/review-cases/mistakes`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
  await page.locator('.trade-row').first().waitFor({ state: 'visible', timeout: 5000 })

  await page.setViewportSize({ width: 900, height: 800 })
  const row = page.locator('.trade-row').first()
  await row.click()
  const compactDesktopOpened = await page.waitForURL(/\/trade\/CAS-/, { timeout: 2000 }).then(() => true).catch(() => false)
  record('紧凑桌面窗口点击案例可进入详情', compactDesktopOpened, page.url())
  const compactDesktopShell = await page.evaluate(() => {
    const frame = document.querySelector('.ui-app-frame')
    const sidebar = document.querySelector('.sidebar')
    const main = document.querySelector('.ui-main-frame')
    return {
      frameDirection: frame ? getComputedStyle(frame).flexDirection : '',
      sidebarWidth: Math.round(sidebar?.getBoundingClientRect().width ?? 0),
      mainVisible: Boolean(main && main.getBoundingClientRect().height > 0),
      hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }
  })
  record(
    '900px 桌面壳层保持侧栏与主内容且无横向溢出',
    compactDesktopShell.frameDirection === 'row' &&
      compactDesktopShell.sidebarWidth > 0 &&
      compactDesktopShell.mainVisible &&
      !compactDesktopShell.hasOverflow,
    JSON.stringify(compactDesktopShell),
  )

  const detailPath = new URL(page.url()).pathname
  const primaryRoutes = [
    { path: '/today-record', selector: '.today-workspace-scroll', title: '今日工作台' },
    { path: '/list', selector: '.list-scroll', title: '交易日志' },
    { path: '/review-cases', selector: '.list-scroll', title: '案例记录' },
    { path: '/dashboard', selector: '.db-scroll', title: '仪表盘' },
  ]

  await page.setViewportSize({ width: 1440, height: 900 })
  for (const route of primaryRoutes) {
    const link = page
      .locator('nav[aria-label="主要导航"] a')
      .filter({ has: page.locator('.sb-item-label', { hasText: route.title }) })
    await link.waitFor({ state: 'visible', timeout: 10000 })
    const targetPath = new URL(await link.getAttribute('href'), BASE).pathname
    await link.click()
    await page.waitForURL((url) => url.pathname === targetPath, { timeout: 10000 })
    await waitForApp()
    await page.locator(route.selector).waitFor({ state: 'visible', timeout: 10000 })
    await page.locator('.ui-main-frame').getByText(route.title, { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 })
    await page.waitForFunction(
      (path) => {
        const link = document.querySelector(`nav[aria-label="主要导航"] a[href="${path}"]`)
        return link?.classList.contains('is-active') && link.getAttribute('aria-current') === 'page'
      },
      targetPath,
      { timeout: 10000 },
    )
    if (new URL(page.url()).pathname !== targetPath) {
      throw new Error(`一级入口路由不匹配：期望 ${targetPath}，实际 ${page.url()}`)
    }
    const navState = await link.evaluate((element) => ({
      href: element.getAttribute('href'),
      className: element.className,
      current: element.getAttribute('aria-current'),
    }))
    if (!navState.className.includes('is-active') || navState.current !== 'page') {
      const sidebarState = await page.evaluate(() => ({
        primary: [...document.querySelectorAll('nav[aria-label="主要导航"] a')].map((element) => ({
          text: element.textContent?.trim(),
          href: element.getAttribute('href'),
          className: element.className,
          current: element.getAttribute('aria-current'),
        })),
        workspace: [...document.querySelectorAll('nav[aria-label="我的空间"] a')].map((element) => ({
          text: element.textContent?.trim(),
          href: element.getAttribute('href'),
          className: element.className,
          current: element.getAttribute('aria-current'),
        })),
      }))
      throw new Error(
        `一级入口未显示选中态：${targetPath}；url=${page.url()}；nav=${JSON.stringify(navState)}；sidebar=${JSON.stringify(sidebarState)}`,
      )
    }
  }
  record('四个一级导航入口均可访问', true)

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
  await page.locator('.db-scroll').waitFor({ state: 'visible', timeout: 15000 })
  const dashboardSurface = await page.evaluate(() => {
    const strip = document.querySelector('.db-cards')
    const metric = document.querySelector('.db-card')
    const panel = document.querySelector('.db-panel')
    return {
      stripGap: strip ? getComputedStyle(strip).gap : '',
      metricRadius: metric ? getComputedStyle(metric).borderRadius : '',
      panelRadius: panel ? getComputedStyle(panel).borderRadius : '',
      hasEmptyState: Boolean(document.querySelector('.empty')),
    }
  })
  record(
    '仪表盘使用连续指标带与扁平内容区',
    dashboardSurface.stripGap === '0px' &&
      dashboardSurface.metricRadius === '0px' &&
      (dashboardSurface.panelRadius === '0px' || dashboardSurface.hasEmptyState),
    JSON.stringify(dashboardSurface),
  )

  await page.goto(`${BASE}/settings/profile`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
  // 资料面板为 lazy 加载；须等到设置壳与预览都挂载后再测平面契约。
  await page.locator('.settings-nav').waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('.settings-panel').waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('.profile-preview').waitFor({ state: 'visible', timeout: 15000 })
  const settingsSurface = await page.evaluate(() => {
    const nav = document.querySelector('.settings-nav')
    const panel = document.querySelector('.settings-panel')
    const preview = document.querySelector('.profile-preview')
    return {
      navRadius: nav ? getComputedStyle(nav).borderRadius : '',
      panelRadius: panel ? getComputedStyle(panel).borderRadius : '',
      previewRadius: preview ? getComputedStyle(preview).borderRadius : '',
    }
  })
  record(
    '设置页导航与表单使用同一平面',
    settingsSurface.navRadius === '0px' &&
      settingsSurface.panelRadius === '0px' &&
      settingsSurface.previewRadius === '0px',
    JSON.stringify(settingsSurface),
  )

  await page.goto(`${BASE}/review-cases`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
  const reviewSurface = await page.evaluate(() => {
    const toolbar = document.querySelector('.ui-toolbar')
    const style = toolbar ? getComputedStyle(toolbar) : null
    return {
      toolbarRadius: style?.borderRadius ?? '',
      toolbarMarginLeft: style?.marginLeft ?? '',
    }
  })
  record(
    '案例记录工具栏回归连续页面表面',
    reviewSurface.toolbarRadius === '0px' && reviewSurface.toolbarMarginLeft === '0px',
    JSON.stringify(reviewSurface),
  )
  await openComposer('新建案例记录', '新建案例记录')
  const composerVisible = await page.locator('.composer-btn-primary').isVisible().catch(() => false)
  if (composerVisible) {
    await page.keyboard.press('Escape')
  }
  record('案例记录页可打开新建流程', true)

  await recyclePage()

  const settingsRoutes = [
    '/settings/profile',
    '/settings/shortcuts',
    '/settings/strategies',
    '/settings/tags',
    '/settings/symbols',
    '/settings/display',
    '/settings/data',
  ]
  for (const path of settingsRoutes) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await waitForApp()
    await page.locator('.settings-panel').waitFor({ state: 'visible' })
  }
  record('全部设置分类保持可访问', true)

  const secondaryRoutes = ['/dashboard', '/settings/profile', '/review-cases']
  const secondaryOverflow = []
  await recyclePage({ width: 900, height: 800 })
  for (const path of secondaryRoutes) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await waitForApp()
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    if (overflow) secondaryOverflow.push(path)
  }
  record(
    '次级页面 900px 视口无横向溢出',
    secondaryOverflow.length === 0,
    secondaryOverflow.join(', ') || 'none',
  )
  await recyclePage({ width: 1440, height: 900 })

  const reviewCaseRoutes = [
    { path: '/review-cases', search: '', tab: '全部' },
    { path: '/review-cases/focus', search: '', tab: '重点' },
    { path: '/review-cases/mistakes', search: '', tab: '错题' },
    { path: '/review-cases', search: '?caseType=missed', tab: '错过机会' },
    { path: '/review-cases/unreviewed', search: '', tab: '待复看' },
    { path: '/review-cases/reviewed', search: '', tab: '已掌握' },
  ]
  await page.goto(`${BASE}/review-cases`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
  await page.locator('.list-scroll').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByText('案例记录', { exact: true }).first().waitFor({ state: 'visible' })
  for (const route of reviewCaseRoutes) {
    const activeTab = page.getByRole('tab', { name: route.tab, exact: true })
    await activeTab.waitFor({ state: 'visible', timeout: 10000 })
    if ((await activeTab.getAttribute('aria-selected')) !== 'true') {
      await activeTab.click()
      await page.waitForURL((url) => url.pathname === route.path && url.search === route.search, { timeout: 10000 })
    }
    try {
      await page.waitForFunction((label) => (
        [...document.querySelectorAll('[role="tab"]')].some((tab) => (
          tab.textContent?.trim() === label && tab.getAttribute('aria-selected') === 'true'
        ))
      ), route.tab, { timeout: 10000 })
    } catch {
      const tabState = await page.getByRole('tab').evaluateAll((tabs) => tabs.map((tab) => ({
        label: tab.textContent?.trim(),
        selected: tab.getAttribute('aria-selected'),
      })))
      throw new Error(`案例视图未正确选中：${page.url()} ${JSON.stringify(tabState)}`)
    }
  }
  const caseTabLabels = await page.getByRole('tab').allTextContents()
  const caseTabsIsolated =
    ['全部', '重点', '错题', '错过机会', '待复看', '已掌握'].every((label) => caseTabLabels.includes(label)) &&
    !['本周', '本月', '亏损'].some((label) => caseTabLabels.includes(label))
  record('六个案例分类使用统一顶部视图且不混入交易入口', caseTabsIsolated, caseTabLabels.join(', '))

  await page.getByRole('button', { name: '筛选案例' }).click()
  await page.getByRole('dialog', { name: '案例筛选' }).waitFor({ state: 'visible' })
  const caseTypeSelectorCount = await page.getByRole('combobox', { name: '案例类型', exact: true }).count()
  const masterySelectorCount = await page.getByRole('combobox', { name: '掌握状态', exact: true }).count()
  const reviewCategorySelectorCount = await page.getByRole('combobox', { name: '复盘分类', exact: true }).count()
  record(
    '案例筛选器使用类型与掌握状态两条当前分类轴',
    caseTypeSelectorCount === 1 && masterySelectorCount === 1 && reviewCategorySelectorCount === 0,
  )
  await page.keyboard.press('Escape')

  await page.goto(`${BASE}/list`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
  const tradeTabLabels = await page.getByRole('tab').allTextContents()
  const tradeTabsIsolated =
    ['全部', '本周', '本月', '亏损'].every((label) => tradeTabLabels.includes(label)) &&
    !['重点', '错题', '错过机会', '待复看', '已掌握'].some((label) => tradeTabLabels.includes(label))
  record('交易日志顶部视图不混入案例分类', tradeTabsIsolated, tradeTabLabels.join(', '))

  await page.goto(`${BASE}/list?symbol=ETHUSDT&side=long`, { waitUntil: 'domcontentloaded' })
  await waitForApp()
  const filterTrigger = page.getByRole('button', { name: '筛选交易' })
  await filterTrigger.click()
  await page.getByRole('dialog', { name: '交易筛选' }).waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '交易筛选' }).waitFor({ state: 'hidden' })
  const filterTriggerHandle = await filterTrigger.elementHandle()
  if (!filterTriggerHandle) throw new Error('筛选器触发按钮不存在')
  await page.waitForFunction(
    (element) => element === document.activeElement,
    filterTriggerHandle,
  )
  const triggerFocused = await filterTrigger.evaluate(
    (element) => element === document.activeElement,
  )
  record('筛选器 Escape 关闭并返还焦点', triggerFocused)

  await page.getByRole('button', { name: '筛选交易' }).click()
  await page.getByRole('dialog', { name: '交易筛选' }).waitFor({ state: 'visible' })
  await page.locator('.ui-toolbar-title').click()
  await page.getByRole('dialog', { name: '交易筛选' }).waitFor({ state: 'hidden' })
  record('点击筛选器外部可关闭', true)

  await page.getByRole('button', { name: '筛选交易' }).click()
  await page.getByRole('dialog', { name: '交易筛选' }).waitFor({ state: 'visible' })
  await selectValue(page.getByRole('combobox', { name: '时间' }), 'this-month')
  await page.waitForURL(
    (url) =>
      url.pathname === '/period/this-month' &&
      url.searchParams.get('symbol') === 'ETHUSDT' &&
      url.searchParams.get('side') === 'long',
    { timeout: 10000 },
  )
  record('筛选器进入本月交易并保留组合条件', true, page.url())
  await page.getByRole('button', { name: '看板视图' }).click()
  await page.waitForURL(
    (url) =>
      url.pathname === '/period/this-month/board' &&
      url.searchParams.get('symbol') === 'ETHUSDT' &&
      url.searchParams.get('side') === 'long',
    { timeout: 10000 },
  )
  await page.getByRole('button', { name: '列表视图' }).click()
  await page.waitForURL(
    (url) =>
      url.pathname === '/period/this-month' &&
      url.searchParams.get('symbol') === 'ETHUSDT' &&
      url.searchParams.get('side') === 'long',
    { timeout: 10000 },
  )
  record('视图切换保留组合筛选条件', true)

  const baselineRoutes = [
    { name: 'list', path: '/list', selector: '.list-scroll', title: '交易日志' },
    { name: 'today-record', path: '/today-record', selector: '.today-workspace-scroll', title: '今日工作台' },
    { name: 'review-cases', path: '/review-cases', selector: '.list-scroll', title: '案例记录' },
    { name: 'trade-detail', path: detailPath, selector: '.dv-body' },
    { name: 'dashboard', path: '/dashboard', selector: '.db-scroll', title: '仪表盘' },
    { name: 'settings-profile', path: '/settings/profile', selector: '.settings-layout', title: '设置' },
  ]
  const baselineViewports = [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1920x1080', width: 1920, height: 1080 },
  ]

  await page.close()
  for (const viewport of baselineViewports) {
    for (const route of baselineRoutes) {
      const baselinePage = await context.newPage()
      trackRuntimeErrors(baselinePage)
      await baselinePage.setViewportSize({ width: viewport.width, height: viewport.height })
      await baselinePage.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' })
      await waitForApp(baselinePage)
      const actualPath = new URL(baselinePage.url()).pathname
      if (actualPath !== route.path) {
        throw new Error(`${route.name} 路由不匹配：期望 ${route.path}，实际 ${actualPath}`)
      }
      await baselinePage.locator(route.selector).waitFor({ state: 'visible', timeout: 10000 })
      if (route.title) {
        await baselinePage.getByText(route.title, { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 })
      }
      await baselinePage.screenshot({
        path: join(BASELINE_OUT, `${viewport.name}-${route.name}.png`),
        fullPage: false,
      })
      await baselinePage.close()
    }
  }
  record('核心页面基准截图已生成', true, `${baselineRoutes.length * baselineViewports.length} 张`)
  record(
    '基准流程无页面、控制台错误或横向溢出',
    diagnosticsAreEmpty(diagnostics),
    JSON.stringify(diagnostics),
  )
} catch (error) {
  record('工作台回归脚本完成', false, String(error))
} finally {
  await browser.close()
  if (presentationReport) {
    mkdirSync(dirname(PRESENTATION_REPORT_PATH), { recursive: true })
    writeFileSync(PRESENTATION_REPORT_PATH, `${JSON.stringify(presentationReport, null, 2)}\n`, 'utf8')
  }
}

const passed = results.filter((result) => result.pass).length
console.log(`\n工作台回归：${passed}/${results.length}`)
process.exitCode = passed === results.length ? 0 : 1
}
