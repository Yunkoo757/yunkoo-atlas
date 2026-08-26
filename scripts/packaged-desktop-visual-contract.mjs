import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  DESKTOP_VISUAL_SCENARIOS,
  DESKTOP_VISUAL_VIEWPORTS,
} from './desktop-visual-scenarios.mjs'
import { validateBundleBuildIdentityEvidence } from './bundle-build-identity.mjs'

export function isWindowRestorationVisible(bounds, workArea, platform) {
  if (!bounds || !workArea) return false
  // Windows 的 BrowserWindow bounds 包含不可见 resize frame；高 DPI 下可比
  // workArea 多出数个逻辑像素，但标题栏和客户区仍完整可操作。
  const tolerance = platform === 'win32' ? 8 : 1
  return bounds.x >= workArea.x - tolerance &&
    bounds.y >= workArea.y - tolerance &&
    bounds.x + bounds.width <= workArea.x + workArea.width + tolerance &&
    bounds.y + bounds.height <= workArea.y + workArea.height + tolerance
}

const REQUIRED_PLATFORM_CHECKS = Object.freeze({
  win32: Object.freeze([
    'native-platform',
    'native-scale',
    'native-file-picker',
    'save-error-recovery',
    'windows-close-explanation',
    'windows-close-to-tray',
    'window-restore-visible',
    'typography-inter-loaded',
    'typography-latin-inter',
    'typography-cjk-sans',
    'typography-role-metrics',
    'month-group-geometry',
  ]),
  darwin: Object.freeze([
    'native-platform',
    'native-scale',
    'native-file-picker',
    'save-error-recovery',
    'mac-command-labels',
    'mac-close-keeps-app',
    'mac-no-windows-copy',
    'window-restore-visible',
    'mac-quit-command',
    'typography-inter-loaded',
    'typography-latin-inter',
    'typography-cjk-sans',
    'typography-role-metrics',
    'month-group-geometry',
  ]),
})

const WINDOWS_PACKAGED_SCALE_FACTORS = Object.freeze([1, 1.25, 1.5])

function canonicalPath(value) {
  const resolved = resolve(value)
  const canonical = (() => {
    try {
      return realpathSync.native(resolved)
    } catch {
      return resolved
    }
  })()
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

function isSameOrDescendant(target, root) {
  const delta = relative(canonicalPath(root), canonicalPath(target))
  return delta === '' || (delta !== '..' && !delta.startsWith(`..${sep}`) && !isAbsolute(delta))
}

export function assertSafePackagedVisualOutputPath({ root, outputPath }) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('Repository root is required')
  if (typeof outputPath !== 'string' || !outputPath.trim()) {
    throw new Error('Packaged visual output path is required')
  }
  const evidenceRoot = resolve(root, 'test-results', 'desktop-visual-packaged')
  const target = resolve(outputPath)
  if (canonicalPath(target) === canonicalPath(evidenceRoot) || !isSameOrDescendant(target, evidenceRoot)) {
    throw new Error(`Unsafe packaged visual output path: ${target}`)
  }
  return target
}

export function normalizePackagedScaleFactor(value, platform) {
  if (platform === 'darwin') {
    if (value == null || value === '') return null
    if (Number(value) !== 2) {
      throw new Error(`Unsupported macOS packaged scale factor: ${value}`)
    }
    return 2
  }
  if (platform !== 'win32') {
    if (value == null || value === '') return null
    throw new Error(`Unsupported packaged scale factor platform: ${platform}`)
  }
  const parsed = value == null || value === '' ? 1 : Number(value)
  if (!WINDOWS_PACKAGED_SCALE_FACTORS.includes(parsed)) {
    throw new Error(`Unsupported Windows packaged scale factor: ${value}`)
  }
  return parsed
}

export function buildRequiredPlatformChecks(platform) {
  const checks = REQUIRED_PLATFORM_CHECKS[platform]
  if (!checks) throw new Error(`Unsupported packaged visual platform: ${platform}`)
  return [...checks]
}

export function isInterVariableGlyphFont(font, declaredFontFamily) {
  if (!font || typeof declaredFontFamily !== 'string') return false
  const declaresInterVariable = /(^|,)\s*["']?Inter Variable["']?\s*(,|$)/i.test(declaredFontFamily)
  const approvedPostScriptNames = new Set(['Inter', 'Inter-Regular'])
  return declaresInterVariable && font.isCustomFont === true && font.familyName === 'Inter' &&
    approvedPostScriptNames.has(font.postScriptName)
}

function declaredFontFamilyIncludes(declaredFontFamily, expectedFamily) {
  if (typeof declaredFontFamily !== 'string') return false
  return declaredFontFamily.split(',')
    .map((family) => family.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .includes(expectedFamily.toLowerCase())
}

export function isPlatformCjkGlyphFont(font, platform, declaredFontFamily) {
  if (font?.isCustomFont !== false) return false
  const familyName = font?.familyName?.toLowerCase()
  if (platform === 'win32') {
    const expectedFamily = familyName === 'microsoft yahei ui'
      ? 'Microsoft YaHei UI'
      : familyName === 'microsoft yahei'
        ? 'Microsoft YaHei'
        : null
    return expectedFamily != null && declaredFontFamilyIncludes(declaredFontFamily, expectedFamily)
  }
  if (platform === 'darwin') {
    const approvedPairs = new Map([
      ['PingFang SC|PingFangSC-Regular', 'PingFang SC'],
      ['蘋方-簡|PingFangSC-Regular', 'PingFang SC'],
      ['Hiragino Sans GB|HiraginoSansGB-W3', 'Hiragino Sans GB'],
    ])
    const expectedFamily = approvedPairs.get(`${font?.familyName}|${font?.postScriptName}`)
    return expectedFamily != null && declaredFontFamilyIncludes(declaredFontFamily, expectedFamily)
  }
  return false
}

function exactPixels(value, expected) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && Math.abs(parsed - expected) < 0.01
}

function fontIdentity(font) {
  return [font?.familyName, font?.postScriptName, font?.isCustomFont].join('|').toLowerCase()
}

function isUniqueFontList(fonts) {
  if (!Array.isArray(fonts) || fonts.length === 0) return false
  return new Set(fonts.map(fontIdentity)).size === fonts.length
}

function validateTypographyGlyphFonts({ platform, computed, glyphFonts }) {
  const isInter = (id, font) => isInterVariableGlyphFont(font, computed?.probes?.[id]?.fontFamily)
  const isCjk = (id, font) => isPlatformCjkGlyphFont(
    font,
    platform,
    computed?.probes?.[id]?.fontFamily,
  )
  const only = (id, predicate) => isUniqueFontList(glyphFonts?.[id]) && glyphFonts[id].every(predicate)
  const mixed = glyphFonts?.mixed
  const mixedKinds = Array.isArray(mixed)
    ? mixed.map((font) => isInter('mixed', font) ? 'inter' : isCjk('mixed', font) ? 'cjk' : 'unknown')
    : []
  const mixedValid = isUniqueFontList(mixed) && !mixedKinds.includes('unknown') &&
    new Set(mixedKinds).size === 2
  return {
    latinInter: only('latin', (font) => isInter('latin', font)) &&
      only('numeric', (font) => isInter('numeric', font)) && mixedValid,
    cjkSans: only('cjk', (font) => isCjk('cjk', font)) && mixedValid,
  }
}

export function buildTypographyCheckResult({ platform, computed, glyphFonts }) {
  const probesRendered = ['latin', 'cjk', 'mixed', 'numeric']
    .every((id) => computed?.probeRendering?.[id]?.rendered === true)
  const glyphs = validateTypographyGlyphFonts({ platform, computed, glyphFonts })
  const checks = [
    {
      id: 'typography-inter-loaded',
      pass: computed?.interLoaded === true,
      detail: `document.fonts.check=${computed?.interLoaded}`,
    },
    {
      id: 'typography-latin-inter',
      pass: probesRendered && glyphs.latinInter,
      detail: JSON.stringify({
        latin: glyphFonts?.latin,
        mixed: glyphFonts?.mixed,
        numeric: glyphFonts?.numeric,
      }),
    },
    {
      id: 'typography-cjk-sans',
      pass: probesRendered && glyphs.cjkSans,
      detail: JSON.stringify({ platform, cjk: glyphFonts?.cjk, mixed: glyphFonts?.mixed }),
    },
    {
      id: 'typography-role-metrics',
      pass: exactPixels(computed?.row?.fontSize, 13) && exactPixels(computed?.row?.lineHeight, 20) &&
        computed?.row?.fontWeight === '400' &&
        exactPixels(computed?.metadata?.fontSize, 12) &&
        exactPixels(computed?.metadata?.lineHeight, 16) &&
        computed?.metadata?.fontWeight === '500' &&
        exactPixels(computed?.group?.fontSize, 13) && exactPixels(computed?.group?.lineHeight, 20) &&
        computed?.group?.fontWeight === '600',
      detail: JSON.stringify({ row: computed?.row, metadata: computed?.metadata, group: computed?.group }),
    },
    {
      id: 'month-group-geometry',
      pass: Math.abs(computed?.monthGroupHeight - 36) < 0.01 &&
        exactPixels(computed?.monthTopGap, 4) && exactPixels(computed?.monthBottomGap, 4) &&
        Math.abs(computed?.monthVirtualHeight - 44) < 0.01,
      detail: JSON.stringify({
        height: computed?.monthGroupHeight,
        topGap: computed?.monthTopGap,
        bottomGap: computed?.monthBottomGap,
        virtualHeight: computed?.monthVirtualHeight,
      }),
    },
  ]
  return { checks, failureCount: checks.filter(({ pass }) => pass !== true).length }
}

export function hasExactDesktopVisualCaptureMatrix(captures, { packaged = false } = {}) {
  if (!Array.isArray(captures)) return false
  const expected = new Set(DESKTOP_VISUAL_VIEWPORTS.flatMap((viewport) =>
    DESKTOP_VISUAL_SCENARIOS.map((scenario) =>
      `${viewport.width}x${viewport.height}/${scenario.id}`)))
  if (captures.length !== expected.size) return false
  const actual = []
  for (const capture of captures) {
    const viewport = packaged ? capture?.requestedViewport : capture?.viewport
    const scenario = packaged
      ? capture?.scenario
      : typeof capture?.scenario === 'string' ? capture.scenario : capture?.scenario?.id
    const key = `${viewport?.width}x${viewport?.height}/${scenario}`
    if (!expected.has(key)) return false
    actual.push(key)
  }
  return new Set(actual).size === expected.size
}

export function resolvePackagedExecutableCandidates({
  platform,
  arch,
  explicitPath,
}) {
  const supported = (platform === 'win32' && arch === 'x64') ||
    (platform === 'darwin' && (arch === 'arm64' || arch === 'x64'))
  if (!supported) throw new Error(`Unsupported packaged executable target: ${platform}/${arch}`)
  if (!explicitPath) {
    throw new Error('An explicit packaged executable path is required; unpacked build fallbacks are forbidden')
  }
  return [resolve(explicitPath)]
}

export function resolvePackagedArtifactCandidates({ platform, arch, explicitPath }) {
  const supported = (platform === 'win32' && arch === 'x64') ||
    (platform === 'darwin' && (arch === 'arm64' || arch === 'x64'))
  if (!supported) throw new Error(`Unsupported packaged artifact target: ${platform}/${arch}`)
  if (!explicitPath) {
    throw new Error('An explicit packaged artifact path is required; inferred release artifacts are forbidden')
  }
  return [resolve(explicitPath)]
}

export function assertSafePackagedEvidencePaths({
  temporaryRoot,
  userDataPath,
  libraryPath,
  applicationDataRoots,
}) {
  const paths = [
    ['userDataPath', userDataPath],
    ['libraryPath', libraryPath],
  ]
  for (const [label, value] of [['temporaryRoot', temporaryRoot], ...paths]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  }
  for (const [label, value] of paths) {
    if ((applicationDataRoots ?? []).some((root) => isSameOrDescendant(value, root))) {
      throw new Error(`${label} resolves inside real application data`)
    }
    if (canonicalPath(value) === canonicalPath(temporaryRoot) || !isSameOrDescendant(value, temporaryRoot)) {
      throw new Error(`${label} must be a unique child of temporaryRoot`)
    }
  }
  if (canonicalPath(userDataPath) === canonicalPath(libraryPath)) {
    throw new Error('userDataPath and libraryPath must be unique children')
  }
}

const PACKAGED_IDENTITY_FIELDS = new Set(['bundles', 'repository', 'ci'])

function deepFreezeIdentityTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const field of Reflect.ownKeys(value)) deepFreezeIdentityTree(value[field])
  return Object.freeze(value)
}

export function buildPackagedVisualReport(identityEvidence, otherFields) {
  if (!otherFields || typeof otherFields !== 'object' || Array.isArray(otherFields)) {
    throw new Error('Packaged visual report fields are required')
  }
  for (const field of Reflect.ownKeys(otherFields)) {
    if (typeof field === 'symbol') {
      throw new Error('Packaged visual report fields must not contain symbol keys')
    }
    if (typeof field === 'string' && PACKAGED_IDENTITY_FIELDS.has(field)) {
      throw new Error(`Packaged visual report contains reserved identity field: ${field}`)
    }
  }
  validateBundleBuildIdentityEvidence(identityEvidence, ['renderer', 'main'])
  const immutableIdentity = deepFreezeIdentityTree(structuredClone({
    bundles: identityEvidence.bundles,
    repository: identityEvidence.repository,
    ci: identityEvidence.ci,
  }))
  return Object.freeze({ ...otherFields, ...immutableIdentity })
}

function validatePayloadHash(value, label) {
  if (!value || typeof value !== 'object' || typeof value.path !== 'string' || !value.path.trim()) {
    throw new Error(`Packaged visual ${label} payload path is required`)
  }
  if (!Number.isSafeInteger(value.bytes) || value.bytes <= 0) {
    throw new Error(`Packaged visual ${label} payload must contain non-empty bytes`)
  }
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sha256)) {
    throw new Error(`Packaged visual ${label} payload requires a valid SHA-256`)
  }
}

function validatePackagedCleanup(cleanup) {
  if (!cleanup || typeof cleanup !== 'object') {
    throw new Error('Packaged visual cleanup evidence is required')
  }
  if (!Number.isSafeInteger(cleanup.launcherProcessId) || cleanup.launcherProcessId <= 0 ||
      !Number.isSafeInteger(cleanup.mainProcessId) || cleanup.mainProcessId <= 0 ||
      cleanup.launcherExitObserved !== true ||
      cleanup.mainProcessExitObserved !== true ||
      cleanup.temporaryProfileDeleted !== true) {
    throw new Error('Packaged visual cleanup must observe launcher and main exit plus temporary profile deletion')
  }
}

export function validatePackagedVisualReport(report) {
  if (!report || typeof report !== 'object') throw new Error('Packaged visual report is required')
  if (report.schemaVersion !== 1) throw new Error('Unsupported packaged visual report schema')
  if (report.runtime !== 'packaged-electron') throw new Error('Report runtime must be packaged-electron')
  const requiredChecks = buildRequiredPlatformChecks(report.platform)
  validateBundleBuildIdentityEvidence(report, ['renderer', 'main'])
  for (const key of ['artifact', 'executable', 'appAsar']) {
    validatePayloadHash(report.payload?.[key], key)
  }
  validatePackagedCleanup(report.cleanup)
  if (!hasExactDesktopVisualCaptureMatrix(report.captures, { packaged: true })) {
    throw new Error('Packaged visual evidence requires the exact unique 5 by 7 capture matrix')
  }
  if (report.typography?.failureCount !== 0) {
    throw new Error('Packaged visual evidence requires complete passing typography evidence')
  }
  if (report.platform === 'win32') {
    const requested = report.scale?.requested
    const actual = report.scale?.devicePixelRatio
    if (!WINDOWS_PACKAGED_SCALE_FACTORS.includes(requested) ||
        !Number.isFinite(actual) || Math.abs(actual - requested) >= 0.01) {
      throw new Error('Windows packaged visual evidence requires a supported verified scale factor')
    }
  } else if (report.platform === 'darwin') {
    const retinaScaleValues = [
      report.scale?.requested,
      report.scale?.devicePixelRatio,
      report.scale?.displayScaleFactor,
    ]
    if (!retinaScaleValues.every((value) =>
      Number.isFinite(value) && Math.abs(value - 2) < 0.01)) {
      throw new Error('macOS packaged visual evidence requires a verified Retina scale factor')
    }
  }
  for (const capture of report.captures) {
    if (!Array.isArray(capture.errors) || capture.errors.length > 0) {
      throw new Error(`Capture ${capture.id ?? 'unknown'} contains runtime errors`)
    }
    if (capture.horizontalOverflowPx !== 0) {
      throw new Error(`Capture ${capture.id ?? 'unknown'} contains horizontal overflow`)
    }
  }
  if (!Array.isArray(report.checks)) throw new Error('Packaged visual platform checks are required')
  for (const id of requiredChecks) {
    const match = report.checks.find((entry) => entry?.id === id)
    if (match?.pass !== true) throw new Error(`Missing or failed packaged platform check: ${id}`)
  }
  return report
}
