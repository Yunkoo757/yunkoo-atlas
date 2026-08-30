import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { arch, platform, release, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { _electron as electron, chromium } from 'playwright'
import { createServer } from 'vite'

import {
  THEME_COLOR_MIX_ALLOWLIST,
  THEME_LUMINANCE_PAGES,
  THEME_LUMINANCE_SCHEMA_VERSION,
  THEME_LUMINANCE_THRESHOLDS,
  THEME_STATE_CONTRACTS,
  THEME_TEXT_PROBES,
  pageById,
  surfaceProbesForPage,
  textProbesForPage,
} from './theme-luminance-contract.mjs'
import { createDesktopVisualSeedEnvelope } from './fixtures/desktop-visual-seed.mjs'
import {
  assertSafeElectronIsolationPaths,
  seedBrowserDatabase,
  waitForVisualSettlement,
} from './qa-desktop-visual.mjs'
import {
  closeElectronApplicationBounded,
  removeTemporaryDirectoryBounded,
} from './bundle-build-identity.mjs'

const require = createRequire(import.meta.url)

const TEXT_ROLE_TOKENS = Object.freeze({
  strong: '--text-content-strong',
  supporting: '--text-content-supporting',
  body: '--text-secondary',
  metadata: '--text-content-metadata',
  context: '--text-content-context',
  faint: '--text-content-faint',
  disabled: '--text-disabled',
})

const SURFACE_ROLE_TOKENS = Object.freeze({
  app: '--surface-app',
  pane: '--surface-pane',
  elevated: '--surface-elevated',
  inset: '--surface-inset',
  floating: '--surface-floating',
  group: '--surface-group',
})

function listFiles(directory, matcher) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = resolve(directory, entry.name)
    if (entry.isDirectory()) return listFiles(target, matcher)
    return matcher(target) ? [target] : []
  })
}

function sourceBuild(root) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  const status = git(['status', '--porcelain=v1']).trimEnd()
  return {
    commit: git(['rev-parse', 'HEAD']).trim(),
    dirty: status.length > 0,
    status: status ? status.split(/\r?\n/) : [],
  }
}

function isSameOrDescendant(target, root) {
  const delta = relative(resolve(root), resolve(target))
  return delta === '' || (delta !== '..' && !delta.startsWith(`..${sep}`))
}

export function parseThemeLuminanceCliArgs(args) {
  let mode = 'resolved'
  let runtime = 'renderer'
  let outputRoot = null
  let scope = 'all'
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--inventory-only' || argument === '--capture-states') {
      if (mode !== 'resolved') throw new Error('Theme luminance mode may only be specified once')
      mode = argument === '--inventory-only' ? 'inventory' : 'states'
      continue
    }
    if (argument === '--runtime') {
      const value = args[index + 1]
      if (!['renderer', 'electron', 'packaged'].includes(value)) {
        throw new Error('--runtime requires renderer, electron, or packaged')
      }
      runtime = value
      index += 1
      continue
    }
    if (argument === '--output-root') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--output-root requires a path')
      outputRoot = value
      index += 1
      continue
    }
    if (argument === '--scope') {
      const value = args[index + 1]
      if (!['all', 'surface', 'text'].includes(value)) {
        throw new Error('--scope requires all, surface, or text')
      }
      scope = value
      index += 1
      continue
    }
    throw new Error(`Unknown theme luminance argument: ${argument}`)
  }
  if (mode !== 'states' && runtime !== 'renderer') {
    throw new Error('--runtime only applies to --capture-states')
  }
  if (mode !== 'resolved' && scope !== 'all') {
    throw new Error('--scope only applies to resolved evidence')
  }
  return { mode, runtime, outputRoot, scope }
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length
}

function normalizePath(root, file) {
  return relative(root, file).replaceAll('\\', '/')
}

function classifyColorMix({ source, property, file, line }) {
  const key = `${file}:${line}`
  if (THEME_COLOR_MIX_ALLOWLIST.some((entry) => entry.key === key)) return 'Optical Calibration Allowlist'
  if (/(?:profit|loss|danger|warning|success|accent|side-|status|conviction|risk)|var\(--(?:pos|neg|warn|pending|danger)(?:-[a-z0-9-]+)?\)/i.test(source)) {
    return 'Business Semantic'
  }
  if (property.startsWith('--') || /color|background|border|outline|shadow|fill|stroke|filter/i.test(property)) {
    return 'Neutral Surface/Text/Border'
  }
  return 'Unclassified'
}

export function createThemeInventory(root = process.cwd()) {
  const srcRoot = resolve(root, 'src')
  const cssFiles = listFiles(srcRoot, (file) => file.endsWith('.css'))
  const pageRootFiles = cssFiles.filter((file) => {
    const normalized = normalizePath(root, file)
    return normalized.startsWith('src/views/') || normalized === 'src/components/ui/AppFrame.css'
  })
  const textRoles = []
  const colorMixes = []
  const pageRoots = []

  for (const file of cssFiles) {
    const normalized = normalizePath(root, file)
    const source = readFileSync(file, 'utf8')
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g
    let rule
    while ((rule = rulePattern.exec(source)) !== null) {
      const selector = rule[1].trim().replace(/\s+/g, ' ')
      const body = rule[2]
      for (const match of body.matchAll(/(?:^|;)\s*(color|fill|stroke)\s*:\s*([^;]+)/gim)) {
        const value = match[2].trim()
        const token = value.match(/var\((--text-[a-z0-9_-]+)/i)?.[1] ?? null
        if (!token) continue
        textRoles.push({
          file: normalized,
          line: lineNumberAt(source, rule.index + rule[0].indexOf(match[0])),
          selector,
          property: match[1].toLowerCase(),
          value,
          token,
        })
      }
    }
    if (normalized === 'src/styles/tokens.css') continue
    for (const match of source.matchAll(/color-mix\([^;{}]+\)/gi)) {
      const before = source.slice(Math.max(0, match.index - 120), match.index)
      const property = before.match(/([a-z-]+)\s*:\s*[^;{}]*$/i)?.[1] ?? 'unknown'
      const line = lineNumberAt(source, match.index)
      colorMixes.push({
        file: normalized,
        line,
        property,
        expression: match[0],
        classification: classifyColorMix({ source: match[0], property, file: normalized, line }),
      })
    }
  }

  for (const page of THEME_LUMINANCE_PAGES) {
    const matches = []
    for (const file of pageRootFiles) {
      const source = readFileSync(file, 'utf8')
      const index = source.indexOf(page.root)
      if (index < 0) continue
      matches.push({ file: normalizePath(root, file), line: lineNumberAt(source, index) })
    }
    pageRoots.push({ ...page, sourceMatches: matches })
  }

  return {
    pageRoots,
    textRoles,
    colorMixes,
    states: THEME_STATE_CONTRACTS,
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeInventory(outputRoot, inventory, metadata) {
  mkdirSync(outputRoot, { recursive: true })
  const outputs = {
    pageRoots: resolve(outputRoot, 'page-roots.json'),
    textRoles: resolve(outputRoot, 'text-roles.json'),
    colorMixes: resolve(outputRoot, 'color-mixes.json'),
    states: resolve(outputRoot, 'states.json'),
  }
  writeJson(outputs.pageRoots, { ...metadata, entries: inventory.pageRoots })
  writeJson(outputs.textRoles, { ...metadata, entries: inventory.textRoles })
  writeJson(outputs.colorMixes, { ...metadata, entries: inventory.colorMixes })
  writeJson(outputs.states, { ...metadata, entries: inventory.states })
  return outputs
}

async function createRendererHarness(root) {
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, open: false, fs: { allow: [root] } },
  })
  await server.listen()
  const baseUrl = server.resolvedUrls?.local?.[0]
  if (!baseUrl) throw new Error('Theme luminance Vite server did not expose a local URL')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.goto(new URL('/favicon.svg', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await seedBrowserDatabase(page, createDesktopVisualSeedEnvelope())
  let started = false
  return {
    page,
    navigate: async (path, ready) => {
      if (!started) {
        await page.goto(new URL(path, baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        started = true
      } else {
        await page.evaluate((nextPath) => {
          history.pushState({}, '', nextPath)
          dispatchEvent(new PopStateEvent('popstate'))
        }, path)
      }
      await waitForVisualSettlement(page, ready)
    },
    close: async () => {
      await context.close().catch(() => {})
      await browser.close().catch(() => {})
      await server.close().catch(() => {})
    },
  }
}

async function createDesktopHarness(root, runtime) {
  if (!['electron', 'packaged'].includes(runtime)) throw new Error(`Unsupported desktop harness: ${runtime}`)
  if (runtime === 'electron') {
    for (const required of ['dist/index.html', 'dist-electron/main.js']) {
      if (!existsSync(resolve(root, required))) {
        throw new Error(`${required} is missing; run pnpm build:app before Electron state evidence`)
      }
    }
  }
  const executablePath = runtime === 'electron'
    ? require('electron')
    : process.env.ATLAS_PACKAGED_EXECUTABLE
  const artifactPath = runtime === 'packaged' ? process.env.ATLAS_PACKAGED_ARTIFACT : null
  if (runtime === 'packaged') {
    if (!artifactPath || !existsSync(resolve(artifactPath))) {
      throw new Error('ATLAS_PACKAGED_ARTIFACT must identify an existing exact packaged artifact')
    }
    if (!executablePath || !existsSync(resolve(executablePath))) {
      throw new Error('ATLAS_PACKAGED_EXECUTABLE must identify an existing exact packaged executable')
    }
  }
  const temporaryRoot = mkdtempSync(join(tmpdir(), `trader-atlas-theme-${runtime}-`))
  const userDataPath = join(temporaryRoot, 'user-data')
  const libraryPath = join(temporaryRoot, 'library')
  assertSafeElectronIsolationPaths({
    userDataPath,
    libraryPath,
    temporaryRoot,
    realApplicationDataRoots: [],
  })
  let application
  let mainProcessId = null
  try {
    application = await electron.launch({
      executablePath,
      args: [
        ...(runtime === 'electron' ? ['.'] : []),
        `--user-data-dir=${userDataPath}`,
      ],
      cwd: root,
      env: {
        ...process.env,
        TRADER_ATLAS_LIBRARY: libraryPath,
        ...(runtime === 'electron' ? { VITE_DEV_SERVER_URL: '' } : {}),
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      timeout: 30_000,
    })
    mainProcessId = await application.evaluate(() => process.pid)
    const page = await application.firstWindow({ timeout: 30_000 })
    await page.waitForLoadState('domcontentloaded')
    const actualUserDataPath = await application.evaluate(({ app }) => app.getPath('userData'))
    assertSafeElectronIsolationPaths({
      userDataPath: actualUserDataPath,
      libraryPath,
      temporaryRoot,
      realApplicationDataRoots: [],
    })
    mkdirSync(libraryPath, { recursive: true })
    const created = await page.evaluate((nextLibraryPath) => window.journalBridge?.createNewLibrary(nextLibraryPath), libraryPath)
    if (!created?.ok) throw new Error(`Unable to create isolated ${runtime} theme library: ${created?.error ?? 'unknown'}`)
    const seed = createDesktopVisualSeedEnvelope()
    const imported = await page.evaluate(
      (snapshot) => window.journalBridge?.commitImport(snapshot, [], { pruneUnreferenced: true }),
      seed.snapshot,
    )
    if (!imported) throw new Error(`Unable to import isolated ${runtime} theme fixture`)
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
    await application.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]
      if (!window) throw new Error('Theme state evidence window is unavailable')
      if (window.isMaximized()) window.unmaximize()
      window.setSize(size.width, size.height)
    }, { width: 1920, height: 1080 })
    const evidence = {
      artifactPath: artifactPath ? resolve(artifactPath) : null,
      executablePath: resolve(executablePath),
      requestedUserDataPath: userDataPath,
      actualUserDataPath,
      libraryPath,
      bridgePlatform: await page.evaluate(() => window.journalBridge?.platform ?? null),
      bundleIdentity: {
        renderer: await page.evaluate(() => window.__ATLAS_BUILD_IDENTITY__ ?? null),
        main: await application.evaluate(() => globalThis.__ATLAS_BUILD_IDENTITY__ ?? null),
      },
    }
    return {
      page,
      evidence,
      navigate: async (path, ready) => {
        await page.evaluate((nextPath) => { window.location.hash = `#${nextPath}` }, path)
        await waitForVisualSettlement(page, ready)
      },
      close: async () => {
        await closeElectronApplicationBounded(application, { mainProcessId }).catch(() => {})
        await removeTemporaryDirectoryBounded(temporaryRoot)
      },
    }
  } catch (error) {
    await closeElectronApplicationBounded(application, { mainProcessId }).catch(() => {})
    await removeTemporaryDirectoryBounded(temporaryRoot).catch(() => {})
    throw error
  }
}

async function createStateHarness(root, runtime) {
  return runtime === 'renderer' ? createRendererHarness(root) : createDesktopHarness(root, runtime)
}

async function collectResolvedProbe(page, selector, tokenMap) {
  const result = await page.evaluate(({ selector: targetSelector, tokenMap: roles }) => {
    const colorCanvas = document.createElement('canvas')
    colorCanvas.width = 1
    colorCanvas.height = 1
    const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true })
    const parseColor = (value) => {
      const match = value.match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i)
      if (match) {
        return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] == null ? 1 : Number(match[4]) }
      }
      if (!colorContext) return null
      colorContext.clearRect(0, 0, 1, 1)
      colorContext.fillStyle = '#010203'
      colorContext.fillStyle = value
      colorContext.fillRect(0, 0, 1, 1)
      const [r, g, b, alpha] = colorContext.getImageData(0, 0, 1, 1).data
      return { r, g, b, a: alpha / 255 }
    }
    const over = (front, back) => {
      const alpha = front.a + back.a * (1 - front.a)
      if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
      return {
        r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
        g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
        b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha,
        a: alpha,
      }
    }
    const channel = (value) => {
      const normalized = value / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    }
    const luminance = (color) => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
    const contrast = (left, right) => {
      const a = luminance(left)
      const b = luminance(right)
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    }
    const effectiveBackground = (element) => {
      const layers = []
      let current = element
      while (current instanceof Element) {
        const parsed = parseColor(getComputedStyle(current).backgroundColor)
        if (parsed && parsed.a > 0) layers.push(parsed)
        current = current.parentElement
      }
      let result = { r: 255, g: 255, b: 255, a: 1 }
      for (let index = layers.length - 1; index >= 0; index -= 1) result = over(layers[index], result)
      return result
    }
    const element = document.querySelector(targetSelector)
    if (!(element instanceof HTMLElement)) return { found: false }
    const style = getComputedStyle(element)
    const background = effectiveBackground(element)
    const declaredForeground = parseColor(style.color)
    const foreground = declaredForeground ? over(declaredForeground, background) : null
    const tokenColors = Object.fromEntries(Object.entries(roles).map(([role, token]) => {
      const probe = document.createElement('span')
      probe.style.color = `var(${token})`
      probe.style.position = 'fixed'
      probe.style.left = '-10000px'
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return [role, color]
    }))
    return {
      found: true,
      color: style.color,
      backgroundColor: style.backgroundColor,
      effectiveBackground: `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`,
      contrast: foreground ? contrast(foreground, background) : null,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      opacity: style.opacity,
      tokenColors,
    }
  }, { selector, tokenMap })
  if (!result.found) return result

  let platformFonts = []
  let platformFontStatus = 'supported'
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('DOM.enable')
    await session.send('CSS.enable')
    const { root } = await session.send('DOM.getDocument')
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (nodeId) ({ fonts: platformFonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId }))
  } catch (error) {
    platformFontStatus = 'unsupported'
    platformFonts = [{ error: error instanceof Error ? error.message : String(error) }]
  } finally {
    await session.detach().catch(() => {})
  }
  const resolvedRole = Object.entries(result.tokenColors)
    .find(([, color]) => color === result.color)?.[0] ?? null
  const resolvedBackgroundRole = Object.entries(result.tokenColors)
    .find(([, color]) => color === result.backgroundColor)?.[0] ?? null
  return { ...result, resolvedRole, resolvedBackgroundRole, platformFontStatus, platformFonts }
}

async function collectResolvedEvidence(root, build) {
  const harness = await createRendererHarness(root)
  const pages = []
  const checks = []
  try {
    for (const pageContract of THEME_LUMINANCE_PAGES) {
      await harness.navigate(pageContract.path, pageContract.ready)
      const rootStyle = await collectResolvedProbe(harness.page, pageContract.root, SURFACE_ROLE_TOKENS)
      const rootPass = rootStyle.found && rootStyle.resolvedBackgroundRole === pageContract.rootSurface
      checks.push({
        id: `${pageContract.id}-root-surface`,
        category: 'surface',
        pass: rootPass,
        detail: rootStyle.found
          ? `surface=${rootStyle.resolvedBackgroundRole ?? rootStyle.backgroundColor}`
          : 'selector missing',
      })
      const surfaces = []
      for (const probe of surfaceProbesForPage(pageContract.id)) {
        const resolved = await collectResolvedProbe(harness.page, probe.selector, SURFACE_ROLE_TOKENS)
        const pass = resolved.found && resolved.resolvedBackgroundRole === probe.targetSurface
        surfaces.push({ ...probe, pass, resolved })
        checks.push({
          id: probe.id,
          category: 'surface',
          pass,
          detail: resolved.found
            ? `surface=${resolved.resolvedBackgroundRole ?? resolved.backgroundColor}`
            : 'selector missing',
        })
      }
      const probes = []
      for (const probe of textProbesForPage(pageContract.id)) {
        const resolved = await collectResolvedProbe(harness.page, probe.selector, TEXT_ROLE_TOKENS)
        const threshold = THEME_LUMINANCE_THRESHOLDS[probe.targetRole] ?? null
        const pass = resolved.found && (threshold == null || resolved.contrast >= threshold)
        probes.push({ ...probe, threshold, pass, resolved })
        checks.push({ id: probe.id, category: 'text', pass, detail: resolved.found ? `contrast=${resolved.contrast?.toFixed(2) ?? 'n/a'}` : 'selector missing' })
      }
      pages.push({ ...pageContract, rootStyle, surfaces, probes })
    }
  } finally {
    await harness.close()
  }
  return {
    schemaVersion: THEME_LUMINANCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    build,
    runtime: 'renderer',
    machine: { platform: platform(), release: release(), arch: arch(), node: process.version },
    checks,
    failureCount: checks.filter((check) => !check.pass).length,
    pages,
  }
}

function styleSnapshot(page, selector, pseudo = null) {
  return page.evaluate(({ targetSelector, pseudoElement }) => {
    const element = document.querySelector(targetSelector)
    if (!(element instanceof HTMLElement)) return null
    const style = getComputedStyle(element, pseudoElement)
    return {
      selector: targetSelector,
      pseudo: pseudoElement,
      color: style.color,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
      opacity: style.opacity,
      className: element.className,
    }
  }, { targetSelector: selector, pseudoElement: pseudo })
}

function resolvedTokenColor(page, token, property) {
  return page.evaluate(({ tokenName, cssProperty }) => {
    const probe = document.createElement('span')
    probe.style.position = 'fixed'
    probe.style.left = '-10000px'
    probe.style[cssProperty] = `var(${tokenName})`
    document.body.append(probe)
    const value = getComputedStyle(probe)[cssProperty]
    probe.remove()
    return value
  }, { tokenName: token, cssProperty: property })
}

async function stateSemanticFailures(page, state, evidence) {
  const failures = []
  const tokenChecks = [
    ['beforeBackgroundToken', evidence.before, 'backgroundColor'],
    ['afterBackgroundToken', evidence.after, 'backgroundColor'],
    ['afterColorToken', evidence.after, 'color'],
    ['afterBorderToken', evidence.after, 'borderColor'],
    ['referenceBeforeBackgroundToken', evidence.referenceBefore, 'backgroundColor'],
  ]
  for (const [field, snapshot, property] of tokenChecks) {
    const token = state[field]
    if (!token) continue
    const expected = await resolvedTokenColor(page, token, property)
    const actual = snapshot?.[property] ?? null
    if (actual !== expected) failures.push(`${field}: expected ${token}=${expected}, received ${actual}`)
  }
  for (const [field, property] of [
    ['afterBackground', 'backgroundColor'],
    ['afterBoxShadow', 'boxShadow'],
    ['afterOpacity', 'opacity'],
  ]) {
    if (state[field] === undefined) continue
    const actual = evidence.after?.[property] ?? null
    if (actual !== state[field]) failures.push(`${field}: expected ${state[field]}, received ${actual}`)
  }
  if (state.afterBoxShadowNotNone && (!evidence.after || evidence.after.boxShadow === 'none')) {
    failures.push('afterBoxShadowNotNone: expected a visible focus shadow')
  }
  return failures
}

async function captureStates(root, outputRoot, build, runtime) {
  const harness = await createStateHarness(root, runtime)
  const entries = []
  try {
    for (const state of THEME_STATE_CONTRACTS) {
      await harness.navigate(state.path, state.ready)
      const screenshot = resolve(outputRoot, `${state.id}.png`)
      const entry = { ...state, screenshot: relative(root, screenshot).replaceAll('\\', '/'), pass: false }
      if (state.kind === 'inject-disabled') {
        await harness.page.evaluate(() => {
          const source = document.querySelector('.risk-indicator-options [role="radio"]')
          if (!(source instanceof HTMLButtonElement)) throw new Error('risk control fixture source is missing')
          const fixture = source.cloneNode(true)
          fixture.disabled = true
          fixture.removeAttribute('aria-checked')
          fixture.classList.remove('is-selected')
          fixture.dataset.themeQaDisabled = 'true'
          fixture.textContent = '禁用样本'
          source.parentElement?.append(fixture)
        })
      } else if (state.kind === 'inject-toast') {
        await harness.page.evaluate(() => {
          const host = document.createElement('div')
          host.className = 'toast-host'
          host.dataset.themeQaFixture = 'toast'
          const panel = document.createElement('div')
          panel.className = 'toast-panel is-success'
          panel.dataset.themeQaToast = 'true'
          panel.setAttribute('role', 'status')
          panel.innerHTML = '<span class="toast-icon" aria-hidden="true">●</span><span class="toast-message">主题状态证据已生成</span>'
          host.append(panel)
          document.body.append(host)
        })
      }
      const target = harness.page.locator(state.target).first()
      if (state.trigger) await harness.page.locator(state.trigger).click()
      await target.waitFor({ state: 'visible', timeout: 10_000 })
      const before = await styleSnapshot(harness.page, state.target, state.pseudo)
      const referenceBefore = state.reference ? await styleSnapshot(harness.page, state.reference) : null
      let interactionSucceeded = true
      if (state.kind === 'keyboard-focus') {
        await harness.page.locator('body').click({ position: { x: 2, y: 2 } })
        interactionSucceeded = false
        for (let attempt = 0; attempt < 100; attempt += 1) {
          await harness.page.keyboard.press('Tab')
          const focused = await target.evaluate((element) => element === document.activeElement)
          if (focused) {
            interactionSucceeded = true
            break
          }
        }
      } else if (state.kind === 'popover' || state.kind.startsWith('inject-')) {
        // Triggering the menu is the state transition.
      } else {
        await target.hover()
      }
      await harness.page.waitForTimeout(250)
      const after = await styleSnapshot(harness.page, state.target, state.pseudo)
      const referenceAfter = state.reference ? await styleSnapshot(harness.page, state.reference) : null
      const semanticFailures = await stateSemanticFailures(harness.page, state, {
        before,
        after,
        referenceBefore,
        referenceAfter,
      })
      await harness.page.screenshot({ path: screenshot, animations: 'disabled' })
      if (state.restore === 'escape') await harness.page.keyboard.press('Escape')
      else if (state.restore === 'blur') await harness.page.locator('body').click({ position: { x: 2, y: 2 } })
      else if (state.restore === 'remove-fixture') {
        await harness.page.evaluate(() => {
          document.querySelector('[data-theme-qa-disabled]')?.remove()
          document.querySelector('[data-theme-qa-fixture="toast"]')?.remove()
        })
      }
      else await harness.page.mouse.move(1, 1)
      const changeRequired = ['hover', 'paired-hover', 'menu-hover', 'keyboard-focus'].includes(state.kind)
      const stateChanged = JSON.stringify(before) !== JSON.stringify(after)
      const pass = interactionSucceeded && after !== null && (!changeRequired || stateChanged) &&
        (!state.reference || referenceAfter !== null) && semanticFailures.length === 0
      entries.push({
        ...entry,
        pass,
        ...(pass ? {} : { reason: semanticFailures.length > 0 ? semanticFailures.join('; ') : changeRequired && !stateChanged ? 'resolved style did not change' : 'target/reference missing' }),
        semanticFailures,
        stateChanged,
        interactionSucceeded,
        before,
        after,
        referenceBefore,
        referenceAfter,
      })
    }
  } finally {
    await harness.close()
  }
  const runtimeChecks = runtime === 'renderer'
    ? []
    : ['renderer', 'main'].map((bundle) => {
        const identity = harness.evidence?.bundleIdentity?.[bundle]
        const pass = identity?.commit === build.commit && identity?.dirty === build.dirty
        return {
          id: `${runtime}-${bundle}-identity`,
          pass,
          detail: identity ?? null,
        }
      })
  return {
    schemaVersion: THEME_LUMINANCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    build,
    runtime,
    runtimeEvidence: harness.evidence ?? null,
    checks: runtimeChecks,
    failureCount: entries.filter((entry) => !entry.pass).length + runtimeChecks.filter((check) => !check.pass).length,
    entries,
  }
}

export async function runThemeLuminance({
  root = process.cwd(),
  mode = 'resolved',
  runtime = 'renderer',
  outputRoot = null,
  scope = 'all',
} = {}) {
  const resolvedRoot = resolve(root)
  const build = sourceBuild(resolvedRoot)
  const defaultOutput = resolve(resolvedRoot, 'test-results', 'theme-luminance', build.commit, 'attempt-1')
  const resolvedOutput = resolve(resolvedRoot, outputRoot ?? defaultOutput)
  const allowedResultsRoot = resolve(resolvedRoot, 'test-results')
  if (!isSameOrDescendant(resolvedOutput, allowedResultsRoot) || resolvedOutput === allowedResultsRoot) {
    throw new Error(`Unsafe theme luminance output path: ${resolvedOutput}`)
  }
  const metadata = {
    schemaVersion: THEME_LUMINANCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    build,
  }
  if (mode === 'inventory') {
    const inventory = createThemeInventory(resolvedRoot)
    const outputs = writeInventory(resolvedOutput, inventory, metadata)
    const report = {
      ...metadata,
      mode,
      outputs: Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, relative(resolvedRoot, value).replaceAll('\\', '/')])),
      counts: {
        pageRoots: inventory.pageRoots.length,
        textRoles: inventory.textRoles.length,
        colorMixes: inventory.colorMixes.length,
        states: inventory.states.length,
      },
      unclassifiedColorMixes: inventory.colorMixes.filter((entry) => entry.classification === 'Unclassified').length,
      unresolvedNeutralColorMixes: inventory.colorMixes.filter((entry) => entry.classification === 'Neutral Surface/Text/Border').length,
    }
    report.failureCount = report.unclassifiedColorMixes + report.unresolvedNeutralColorMixes
    writeJson(resolve(resolvedOutput, 'inventory-report.json'), report)
    return report
  }
  if (mode === 'states') {
    mkdirSync(resolvedOutput, { recursive: true })
    const report = await captureStates(resolvedRoot, resolvedOutput, build, runtime)
    writeJson(resolve(resolvedOutput, 'states-report.json'), report)
    return report
  }
  const inventoryPaths = ['page-roots.json', 'text-roles.json', 'color-mixes.json', 'states.json']
  for (const file of inventoryPaths) {
    const target = resolve(resolvedOutput, file)
    if (!statSync(target, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Frozen theme inventory is missing: ${target}; run --inventory-only first`)
    }
  }
  const report = await collectResolvedEvidence(resolvedRoot, build)
  report.scope = scope
  report.failureCount = report.checks.filter((check) =>
    (scope === 'all' || check.category === scope) && !check.pass).length
  writeJson(resolve(resolvedOutput, 'report.json'), report)
  return report
}

async function main() {
  const args = parseThemeLuminanceCliArgs(process.argv.slice(2))
  const report = await runThemeLuminance(args)
  process.stdout.write(`${JSON.stringify({
    mode: args.mode,
    runtime: args.runtime,
    build: report.build,
    counts: report.counts ?? null,
    failureCount: report.failureCount ?? report.unclassifiedColorMixes ?? 0,
  }, null, 2)}\n`)
  if ((report.failureCount ?? report.unclassifiedColorMixes ?? 0) > 0) process.exitCode = 1
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entryPath === import.meta.url) await main()
