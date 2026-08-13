import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const REQUIRED_PLATFORM_CHECKS = Object.freeze({
  win32: Object.freeze([
    'native-platform',
    'native-scale',
    'native-file-picker',
    'save-error-recovery',
    'windows-close-explanation',
    'windows-close-to-tray',
    'window-restore-visible',
  ]),
  darwin: Object.freeze([
    'native-platform',
    'retina-scale',
    'native-file-picker',
    'save-error-recovery',
    'mac-command-labels',
    'mac-close-keeps-app',
    'mac-no-windows-copy',
    'window-restore-visible',
    'mac-cmd-q',
  ]),
})

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

export function buildRequiredPlatformChecks(platform) {
  const checks = REQUIRED_PLATFORM_CHECKS[platform]
  if (!checks) throw new Error(`Unsupported packaged visual platform: ${platform}`)
  return [...checks]
}

export function resolvePackagedExecutableCandidates({
  root,
  platform,
  arch,
  explicitPath,
}) {
  if (explicitPath) return [resolve(explicitPath)]
  if (platform === 'win32' && arch === 'x64') {
    return [join(resolve(root), 'release', 'win-unpacked', 'Trader Atlas.exe')]
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return [
      join(resolve(root), 'release', 'mac-arm64', 'Trader Atlas.app', 'Contents', 'MacOS', 'Trader Atlas'),
      join(resolve(root), 'release', 'mac', 'Trader Atlas.app', 'Contents', 'MacOS', 'Trader Atlas'),
    ]
  }
  if (platform === 'darwin' && arch === 'x64') {
    return [
      join(resolve(root), 'release', 'mac', 'Trader Atlas.app', 'Contents', 'MacOS', 'Trader Atlas'),
      join(resolve(root), 'release', 'mac-x64', 'Trader Atlas.app', 'Contents', 'MacOS', 'Trader Atlas'),
    ]
  }
  throw new Error(`Unsupported packaged executable target: ${platform}/${arch}`)
}

export function resolvePackagedArtifactCandidates({ root, platform, arch, version, explicitPath }) {
  if (explicitPath) return [resolve(explicitPath)]
  if (typeof version !== 'string' || !version.trim()) throw new Error('Package version is required')
  if (platform === 'win32' && arch === 'x64') {
    return [join(resolve(root), 'release', `Trader-Atlas-${version}-win-x64.exe`)]
  }
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return [join(resolve(root), 'release', `Trader-Atlas-${version}-mac-${arch}.zip`)]
  }
  throw new Error(`Unsupported packaged artifact target: ${platform}/${arch}`)
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

export function validatePackagedVisualReport(report) {
  if (!report || typeof report !== 'object') throw new Error('Packaged visual report is required')
  if (report.schemaVersion !== 1) throw new Error('Unsupported packaged visual report schema')
  if (report.runtime !== 'packaged-electron') throw new Error('Report runtime must be packaged-electron')
  const requiredChecks = buildRequiredPlatformChecks(report.platform)
  if (!report.source || !/^[0-9a-f]{40}$/i.test(report.source.commit ?? '') || report.source.dirty !== false) {
    throw new Error('Packaged visual evidence requires a clean source commit')
  }
  if (!Array.isArray(report.captures) || report.captures.length !== 35) {
    throw new Error('Packaged visual evidence requires exactly 35 core captures')
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
    if (!match?.pass) throw new Error(`Missing or failed packaged platform check: ${id}`)
  }
  return report
}
