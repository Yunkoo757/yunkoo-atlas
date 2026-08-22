import { resolve } from 'node:path'

import { validateBundleBuildIdentityEvidence } from './bundle-build-identity.mjs'

export const FINAL_PACKAGED_SMOKE_SCENARIOS = Object.freeze([
  'identity',
  'v11-migration',
  'due-stage-rollover',
  'library-switch',
  'forced-kill-recovery',
  'asset-roundtrip',
  'invalid-library-fail-closed',
])

function readRequiredOption(argv, name) {
  const index = argv.indexOf(name)
  const value = index >= 0 ? argv[index + 1] : null
  if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) {
    throw new Error(`Final packaged artifact smoke requires ${name}`)
  }
  if (argv.indexOf(name, index + 1) >= 0) throw new Error(`Final packaged artifact smoke received duplicate ${name}`)
  return value
}

export function parseFinalPackagedArtifactArgs(argv, hostPlatform = process.platform) {
  const knownOptions = new Set(['--artifact', '--arch', '--output'])
  for (let index = 0; index < argv.length; index += 2) {
    if (!knownOptions.has(argv[index]) || index + 1 >= argv.length) {
      throw new Error(`Unknown or incomplete final artifact smoke argument: ${String(argv[index])}`)
    }
  }
  if (argv.length !== knownOptions.size * 2) {
    throw new Error('Final packaged artifact smoke accepts exactly --artifact, --arch, and --output')
  }
  const artifactPath = resolve(readRequiredOption(argv, '--artifact'))
  const architecture = readRequiredOption(argv, '--arch')
  const outputPath = resolve(readRequiredOption(argv, '--output'))
  if (hostPlatform === 'win32') {
    if (architecture !== 'x64') throw new Error(`Unsupported Windows final artifact architecture: ${architecture}`)
    if (!artifactPath.toLowerCase().endsWith('.exe')) throw new Error('Windows final artifact must be an NSIS .exe')
  } else if (hostPlatform === 'darwin') {
    if (!['x64', 'arm64'].includes(architecture)) {
      throw new Error(`Unsupported macOS final artifact architecture: ${architecture}`)
    }
    if (!/\.(?:dmg|zip)$/i.test(artifactPath)) throw new Error('macOS final artifact must be a DMG or ZIP')
  } else {
    throw new Error(`Unsupported final artifact platform: ${hostPlatform}`)
  }
  if (artifactPath === outputPath) throw new Error('Final artifact report must not overwrite the artifact')
  return { artifactPath, architecture, outputPath, platform: hostPlatform }
}

function validatePayloadHash(value, label) {
  if (!value || typeof value.path !== 'string' || !value.path ||
      !Number.isSafeInteger(value.bytes) || value.bytes <= 0 ||
      typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sha256)) {
    throw new Error(`Final artifact ${label} hash evidence is invalid`)
  }
}

export function validateFinalPackagedArtifactReport(report) {
  if (!report || typeof report !== 'object') throw new Error('Final artifact smoke report is required')
  if (report.schemaVersion !== 1 || report.runtime !== 'final-packaged-artifact') {
    throw new Error('Final artifact smoke report schema or runtime is invalid')
  }
  if ((report.platform === 'win32' && (report.architecture !== 'x64' || report.artifactFormat !== 'nsis')) ||
      (report.platform === 'darwin' &&
        (!['x64', 'arm64'].includes(report.architecture) || !['dmg', 'zip'].includes(report.artifactFormat))) ||
      !['win32', 'darwin'].includes(report.platform)) {
    throw new Error('Final artifact platform architecture or format evidence is invalid')
  }
  validateBundleBuildIdentityEvidence(report, ['renderer', 'main'])
  for (const key of ['artifact', 'executable', 'appAsar']) validatePayloadHash(report.payload?.[key], key)
  const expected = new Set(FINAL_PACKAGED_SMOKE_SCENARIOS)
  if (!Array.isArray(report.scenarios) || report.scenarios.length !== expected.size ||
      report.scenarios.some((entry) => !expected.delete(entry?.id) || entry.pass !== true) || expected.size > 0) {
    throw new Error('Final artifact smoke scenarios are incomplete or failed')
  }
  const cleanup = report.cleanup
  if (!cleanup || cleanup.allProcessesExited !== true || cleanup.temporaryRootDeleted !== true ||
      cleanup.materializedPayloadRemoved !== true ||
      !Array.isArray(cleanup.processIds) || cleanup.processIds.length === 0 ||
      cleanup.processIds.some((processId) => !Number.isSafeInteger(processId) || processId <= 0)) {
    throw new Error('Final artifact smoke cleanup evidence is incomplete')
  }
  if (report.platform === 'win32' && cleanup.installerUninstalled !== true) {
    throw new Error('Final artifact Windows installer cleanup is incomplete')
  }
  if (report.platform === 'darwin' && report.artifactFormat === 'dmg' && cleanup.volumeDetached !== true) {
    throw new Error('Final artifact macOS DMG cleanup is incomplete')
  }
  return report
}
