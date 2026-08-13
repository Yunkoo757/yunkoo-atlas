import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { arch, homedir, platform, release, tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

import { _electron as electron } from 'playwright'

import {
  assertSafePackagedEvidencePaths,
  assertSafePackagedVisualOutputPath,
  normalizePackagedScaleFactor,
  resolvePackagedArtifactCandidates,
  resolvePackagedExecutableCandidates,
  validatePackagedVisualReport,
} from './packaged-desktop-visual-contract.mjs'
import {
  DESKTOP_VISUAL_SCENARIOS,
  DESKTOP_VISUAL_VIEWPORTS,
} from './desktop-visual-scenarios.mjs'
import { createDesktopVisualSnapshot } from './fixtures/desktop-visual-seed.mjs'

const SCHEMA_VERSION = 1
const root = process.cwd()
const hostPlatform = platform()
const hostArch = arch()
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const requestedScaleFactor = normalizePackagedScaleFactor(
  process.env.ATLAS_PACKAGED_SCALE_FACTOR,
  hostPlatform,
)
const candidates = resolvePackagedExecutableCandidates({
  root,
  platform: hostPlatform,
  arch: hostArch,
  explicitPath: process.env.ATLAS_PACKAGED_EXECUTABLE,
})
const executablePath = candidates.find((candidate) => existsSync(candidate))
if (!executablePath) {
  throw new Error(`Packaged executable is missing. Checked: ${candidates.join(', ')}`)
}

const scaleId = requestedScaleFactor == null ? '' : `-scale-${Math.round(requestedScaleFactor * 100)}`
const runtimeId = `${hostPlatform}-${hostArch}${scaleId}`
const outputRoot = assertSafePackagedVisualOutputPath({
  root,
  outputPath: resolve(
  process.env.ATLAS_PACKAGED_VISUAL_OUTPUT ?? join('test-results', 'desktop-visual-packaged', runtimeId),
  ),
})
rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(outputRoot, { recursive: true })

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
}

function realApplicationDataRoots() {
  const names = new Set([packageJson.build?.productName, packageJson.name].filter(Boolean))
  const parents = [
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    join(homedir(), 'Library', 'Application Support'),
  ].filter(Boolean)
  return [...new Set(parents.flatMap((parent) => [...names].map((name) => resolve(parent, name))))]
}

function bindDiagnostics(page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    if (message.text().includes('React Router Future Flag')) return
    errors.push(`console: ${message.text()}`)
  })
  return errors
}

async function waitForVisualSettlement(page, selector) {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => document.documentElement.dataset.uiSettled === '1', null, {
    timeout: 30_000,
  })
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)))
  })
  await page.waitForFunction(
    () => !document.querySelector('.save-status.is-dirty, .save-status.is-saving'),
    null,
    { timeout: 30_000 },
  )
}

function withinWorkArea(bounds, workArea, tolerance = 1) {
  return bounds.x >= workArea.x - tolerance &&
    bounds.y >= workArea.y - tolerance &&
    bounds.x + bounds.width <= workArea.x + workArea.width + tolerance &&
    bounds.y + bounds.height <= workArea.y + workArea.height + tolerance
}

async function waitForProcessExit(child, timeoutMs = 10_000) {
  if (child.exitCode != null) return true
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolveExit(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolveExit(true)
    }
    child.once('exit', onExit)
  })
}

function locateArtifact() {
  const artifactCandidates = resolvePackagedArtifactCandidates({
    root,
    platform: hostPlatform,
    arch: hostArch,
    version: packageJson.version,
    explicitPath: process.env.ATLAS_PACKAGED_ARTIFACT,
  })
  const candidate = artifactCandidates.find((path) => existsSync(path))
  if (!candidate) throw new Error(`Packaged artifact is missing. Checked: ${artifactCandidates.join(', ')}`)
  return candidate
}

const temporaryRoot = mkdtempSync(join(tmpdir(), `trader-atlas-packaged-visual-${runtimeId}-`))
const userDataPath = join(temporaryRoot, 'user-data')
const libraryPath = join(temporaryRoot, 'library')
mkdirSync(userDataPath, { recursive: true })
mkdirSync(libraryPath, { recursive: true })
assertSafePackagedEvidencePaths({
  temporaryRoot,
  userDataPath,
  libraryPath,
  applicationDataRoots: realApplicationDataRoots(),
})

// 先写入明显越界的大窗口状态，首次启动必须把它完整恢复到当前工作区。
writeFileSync(join(userDataPath, 'window-state.json'), JSON.stringify({
  x: 99_999,
  y: 99_999,
  width: 1_920,
  height: 1_080,
  isMaximized: false,
}, null, 2), 'utf8')

let application
let page
let applicationExitedByQuitCommand = false
let scaleEvidence = null
const captures = []
const checks = []
const source = {
  commit: git(['rev-parse', 'HEAD']),
  dirty: git(['status', '--porcelain=v1']).length > 0,
}

function record(id, pass, detail) {
  checks.push({ id, pass, detail })
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'} ${id}: ${detail}\n`)
}

try {
  application = await electron.launch({
    executablePath,
    args: [
      `--user-data-dir=${userDataPath}`,
      ...(requestedScaleFactor == null ? [] : [`--force-device-scale-factor=${requestedScaleFactor}`]),
    ],
    cwd: root,
    env: {
      ...process.env,
      TRADER_ATLAS_LIBRARY: libraryPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeout: 30_000,
  })
  page = await application.firstWindow({ timeout: 30_000 })
  await page.waitForLoadState('domcontentloaded')
  let diagnostics = bindDiagnostics(page)

  const runtime = await application.evaluate(({ app, BrowserWindow, Menu, screen }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const bounds = window?.getBounds() ?? null
    const display = bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay()
    const serializeMenu = (items) => items.flatMap((item) => [
      {
        label: item.label,
        role: item.role,
        accelerator: item.accelerator,
        defaultAccelerator: item.getDefaultRoleAccelerator?.(),
      },
      ...(item.submenu ? serializeMenu(item.submenu.items) : []),
    ])
    return {
      appPath: app.getAppPath(),
      userDataPath: app.getPath('userData'),
      bounds,
      workArea: display.workArea,
      displayScaleFactor: display.scaleFactor,
      applicationMenu: Menu.getApplicationMenu()
        ? serializeMenu(Menu.getApplicationMenu().items)
        : null,
    }
  })
  process.stdout.write(`${JSON.stringify({
    pathIsolation: {
      temporaryRoot,
      requestedUserDataPath: userDataPath,
      actualUserDataPath: runtime.userDataPath,
      libraryPath,
    },
  })}\n`)
  assertSafePackagedEvidencePaths({
    temporaryRoot,
    userDataPath: runtime.userDataPath,
    libraryPath,
    applicationDataRoots: realApplicationDataRoots(),
  })
  record('native-platform', await page.evaluate(() => window.journalBridge?.platform) === hostPlatform, hostPlatform)
  record(
    'window-restore-visible',
    Boolean(runtime.bounds && withinWorkArea(runtime.bounds, runtime.workArea)),
    JSON.stringify({ bounds: runtime.bounds, workArea: runtime.workArea }),
  )

  const created = await page.evaluate((path) => window.journalBridge?.createNewLibrary(path), libraryPath)
  if (!created?.ok) throw new Error(`Unable to create isolated packaged library: ${created?.error ?? 'unknown'}`)
  const imported = await page.evaluate(
    (snapshot) => window.journalBridge?.commitImport(snapshot, [], { pruneUnreferenced: true }),
    createDesktopVisualSnapshot(),
  )
  if (!imported) throw new Error('Unable to import packaged desktop visual fixture')
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
  diagnostics = bindDiagnostics(page)

  const dpr = await page.evaluate(() => window.devicePixelRatio)
  scaleEvidence = {
    requested: requestedScaleFactor,
    devicePixelRatio: dpr,
    displayScaleFactor: runtime.displayScaleFactor,
  }
  record(
    'native-scale',
    requestedScaleFactor == null
      ? dpr >= 1 && runtime.displayScaleFactor >= 1 && Math.abs(dpr - runtime.displayScaleFactor) < 0.01
      : Math.abs(dpr - requestedScaleFactor) < 0.01,
    `requested=${requestedScaleFactor ?? 'native'}; devicePixelRatio=${dpr}; displayScaleFactor=${runtime.displayScaleFactor}`,
  )

  for (const viewport of DESKTOP_VISUAL_VIEWPORTS) {
    await application.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('Packaged visual window is unavailable')
      if (window.isMaximized()) window.unmaximize()
      window.setSize(size.width, size.height)
    }, viewport)
    for (const scenario of DESKTOP_VISUAL_SCENARIOS) {
      diagnostics.length = 0
      await page.evaluate((path) => { window.location.hash = `#${path}` }, scenario.path)
      await waitForVisualSettlement(page, scenario.ready)
      const metrics = await page.evaluate(() => ({
        actualViewport: {
          width: window.innerWidth,
          height: window.innerHeight,
        },
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        horizontalOverflowPx: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      }))
      const directory = join(outputRoot, `${viewport.width}x${viewport.height}`)
      mkdirSync(directory, { recursive: true })
      const screenshotPath = join(directory, `${scenario.id}.png`)
      await page.screenshot({ path: screenshotPath, animations: 'disabled' })
      captures.push({
        id: `${viewport.width}x${viewport.height}/${scenario.id}`,
        requestedViewport: viewport,
        viewport: metrics.actualViewport,
        scenario: scenario.id,
        screenshot: relative(root, screenshotPath).replaceAll('\\', '/'),
        errors: [...diagnostics],
        horizontalOverflowPx: metrics.horizontalOverflowPx,
      })
    }
  }

  await page.evaluate(() => { window.location.hash = '#/settings/data' })
  await waitForVisualSettlement(page, '.settings-layout')
  await application.evaluate(({ dialog }) => {
    globalThis.__atlasPackagedVisualOpenDialogCalls = 0
    dialog.showOpenDialog = async () => {
      globalThis.__atlasPackagedVisualOpenDialogCalls += 1
      return { canceled: true, filePaths: [] }
    }
  })
  await page.getByRole('button', { name: /打开其他资料库/ }).click()
  const openDialogCalls = await application.evaluate(
    () => globalThis.__atlasPackagedVisualOpenDialogCalls ?? 0,
  )
  record('native-file-picker', openDialogCalls === 1, `showOpenDialog calls=${openDialogCalls}`)

  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('app:close-save-error', 'QA 模拟：磁盘暂不可写')
  })
  await page.getByText('保存未完成，已取消退出').waitFor({ state: 'visible', timeout: 10_000 })
  const recoveryActions = await page.getByRole('button', { name: /继续使用|重试退出/ }).count()
  record('save-error-recovery', recoveryActions === 2, `recovery actions=${recoveryActions}`)
  await page.getByRole('button', { name: '继续使用' }).click()

  if (hostPlatform === 'win32') {
    await page.evaluate(() => window.journalBridge?.setWindowsClosePreference('ask'))
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    const closePrompt = page.getByRole('dialog', { name: '关闭 Trader Atlas' })
    await closePrompt.waitFor({ state: 'visible', timeout: 10_000 })
    record('windows-close-explanation', await closePrompt.isVisible(), 'first-close choice is visible')
    await closePrompt.getByRole('button', { name: '隐藏到托盘' }).click()
    await page.waitForTimeout(250)
    const hidden = await application.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() === false,
    )
    record('windows-close-to-tray', hidden, 'window hidden after explicit tray choice')
  } else {
    await page.keyboard.press('Meta+k')
    const commandDialog = page.getByRole('dialog', { name: '搜索与命令' })
    await commandDialog.waitFor({ state: 'visible', timeout: 10_000 })
    await page.keyboard.press('Escape')
    await page.evaluate(() => { window.location.hash = '#/settings/shortcuts' })
    await waitForVisualSettlement(page, '.shortcuts-table')
    const commandShortcutLabel = await page.locator('.shortcuts-row')
      .filter({ hasText: '命令面板（Ctrl+K）' })
      .locator('.shortcuts-capture')
      .getAttribute('aria-label')
    const quitMenuItem = runtime.applicationMenu?.find((item) =>
      item.role === 'appMenu' || item.role === 'quit' || /Quit/i.test(item.label),
    )
    const quitAccelerator = quitMenuItem?.accelerator ?? quitMenuItem?.defaultAccelerator ?? ''
    const menuHasCommandQuit = Boolean(
      quitMenuItem && /(?:CommandOrControl|Command|Cmd)\+Q/i.test(quitAccelerator),
    )
    const menuUsesProductName = quitMenuItem?.label.includes(packageJson.productName) === true
    record(
      'mac-command-labels',
      commandShortcutLabel?.includes('⌘K') === true && menuHasCommandQuit && menuUsesProductName,
      JSON.stringify({ commandShortcutLabel, quitMenuItem, menuHasCommandQuit, menuUsesProductName }),
    )

    const closePage = page.waitForEvent('close', { timeout: 15_000 })
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    await page.waitForTimeout(120).catch(() => {})
    const windowsCopyVisible = page.isClosed()
      ? false
      : await page.getByRole('dialog', { name: '关闭 Trader Atlas' }).isVisible().catch(() => false)
    record('mac-no-windows-copy', !windowsCopyVisible, 'Windows close explanation is absent')
    await closePage
    const macCloseState = await application.evaluate(({ app, BrowserWindow }) => ({
      ready: app.isReady(),
      windowCount: BrowserWindow.getAllWindows().length,
      hasDock: Boolean(app.dock),
    }))
    record(
      'mac-close-keeps-app',
      macCloseState.ready && macCloseState.windowCount === 0 && macCloseState.hasDock,
      JSON.stringify(macCloseState),
    )

    const reopened = application.waitForEvent('window', { timeout: 15_000 })
    await application.evaluate(({ app }) => { app.emit('activate') })
    page = await reopened
    await page.waitForLoadState('domcontentloaded')
    const child = application.process()
    // 主进程的安全退出合同最长 15 秒；留出终态事件传播余量后再判失败。
    const exited = waitForProcessExit(child, 20_000)
    const nativeQuitInvoked = await application.evaluate(({ app }) => {
      // Electron 官方将 app.quit() 与用户 Cmd+Q 定义为同一退出生命周期；
      // role 菜单项会忽略 click 属性，不能用 MenuItem.click() 模拟原生角色行为。
      setImmediate(() => app.quit())
      return true
    })
    applicationExitedByQuitCommand = nativeQuitInvoked && await exited
    record(
      'mac-quit-command',
      applicationExitedByQuitCommand,
      `native Quit menu command invoked=${nativeQuitInvoked}; application exited=${applicationExitedByQuitCommand}`,
    )
  }
} finally {
  if (!applicationExitedByQuitCommand) await application?.close().catch(() => {})
  rmSync(temporaryRoot, { recursive: true, force: true })
}

const artifactPath = locateArtifact()
const report = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  runtime: 'packaged-electron',
  platform: hostPlatform,
  architecture: hostArch,
  source,
  machine: {
    platform: hostPlatform,
    release: release(),
    arch: hostArch,
    node: process.version,
  },
  scale: scaleEvidence,
  artifact: {
    path: relative(root, artifactPath).replaceAll('\\', '/'),
    bytes: readFileSync(artifactPath).byteLength,
    sha256: sha256(artifactPath),
    executablePath: relative(root, executablePath).replaceAll('\\', '/'),
    executableSha256: sha256(executablePath),
  },
  isolation: {
    temporaryRoot,
    userDataPath,
    libraryPath,
    realLibraryAccessed: false,
    cleaned: !existsSync(temporaryRoot),
  },
  viewports: DESKTOP_VISUAL_VIEWPORTS,
  scenarios: DESKTOP_VISUAL_SCENARIOS,
  captures,
  checks,
}

const reportPath = join(outputRoot, 'report.json')
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
validatePackagedVisualReport(report)
process.stdout.write(`packaged desktop visual QA: PASS (${reportPath})\n`)
