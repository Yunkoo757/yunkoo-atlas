import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function expectedReleaseAssetNames(version) {
  return [
    `Trader-Atlas-${version}-win-x64.exe`,
    `Trader-Atlas-${version}-win-x64.exe.blockmap`,
    'latest.yml',
    `Trader-Atlas-${version}-mac-arm64.dmg`,
    `Trader-Atlas-${version}-mac-arm64.zip`,
    `Trader-Atlas-${version}-mac-x64.dmg`,
    `Trader-Atlas-${version}-mac-x64.zip`,
  ]
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function buildLocalReleaseManifest(directory, version) {
  const expected = expectedReleaseAssetNames(version).sort()
  const actual = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Release artifact inventory mismatch: expected ${expected.join(', ')}, got ${actual.join(', ')}`)
  }
  return {
    version,
    assets: expected.map((name) => {
      const file = path.join(directory, name)
      const size = fs.statSync(file).size
      if (size <= 0) throw new Error(`Release asset is empty: ${name}`)
      return { name, size, sha256: sha256(file) }
    }),
  }
}

export function planRelease(localManifest, remoteState, remoteDirectory, expectedPrerelease) {
  if (!remoteState?.exists) {
    return { action: 'create-draft', upload: localManifest.assets.map((asset) => asset.name) }
  }
  if (Boolean(remoteState.isPrerelease) !== expectedPrerelease) {
    throw new Error('Existing release channel differs from package version')
  }
  const expectedNames = new Set(localManifest.assets.map((asset) => asset.name))
  const remoteNames = (remoteState.assets ?? []).map((asset) => asset.name)
  for (const name of remoteNames) {
    if (!expectedNames.has(name)) throw new Error(`Unexpected existing release asset: ${name}`)
  }
  const missing = []
  for (const asset of localManifest.assets) {
    const remotePath = path.join(remoteDirectory, asset.name)
    if (!remoteNames.includes(asset.name) || !fs.existsSync(remotePath)) {
      missing.push(asset.name)
      continue
    }
    if (sha256(remotePath) !== asset.sha256) {
      throw new Error(`Existing release asset differs: ${asset.name}`)
    }
  }
  if (!remoteState.isDraft && missing.length > 0) {
    throw new Error(`Public release is missing required asset: ${missing[0]}`)
  }
  if (!remoteState.isDraft) return { action: 'noop', upload: [] }
  return { action: 'resume-draft', upload: missing }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'manifest') {
    const [directory, version, output] = args
    fs.writeFileSync(output, `${JSON.stringify(buildLocalReleaseManifest(directory, version), null, 2)}\n`, 'utf8')
  } else if (command === 'plan') {
    const [manifestFile, stateFile, remoteDirectory, prerelease] = args
    process.stdout.write(`${JSON.stringify(planRelease(
      readJson(manifestFile),
      readJson(stateFile),
      remoteDirectory,
      prerelease === 'true',
    ))}\n`)
  } else {
    throw new Error('Usage: release-artifacts.mjs manifest|plan ...')
  }
}
