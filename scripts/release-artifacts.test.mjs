import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildLocalReleaseManifest,
  expectedReleaseAssetNames,
  planRelease,
} from './release-artifacts.mjs'

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-release-plan-'))
  try { return run(root) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

function writeAssets(directory, version, patch = {}) {
  fs.mkdirSync(directory, { recursive: true })
  for (const name of expectedReleaseAssetNames(version)) {
    if (patch[name] === null) continue
    fs.writeFileSync(path.join(directory, name), patch[name] ?? `bytes:${name}`)
  }
}

test('local manifest rejects missing, empty, and extra artifacts', () => fixture((root) => {
  const dir = path.join(root, 'local')
  writeAssets(dir, '1.2.3')
  assert.equal(buildLocalReleaseManifest(dir, '1.2.3').assets.length, 7)
  fs.writeFileSync(path.join(dir, 'extra.bin'), 'extra')
  assert.throws(() => buildLocalReleaseManifest(dir, '1.2.3'), /inventory mismatch/)
  fs.rmSync(path.join(dir, 'extra.bin'))
  fs.writeFileSync(path.join(dir, 'latest.yml'), '')
  assert.throws(() => buildLocalReleaseManifest(dir, '1.2.3'), /empty/)
  fs.rmSync(path.join(dir, 'latest.yml'))
  assert.throws(() => buildLocalReleaseManifest(dir, '1.2.3'), /inventory mismatch/)
}))

test('release plan covers create, draft resume, public noop, and failure branches', () => fixture((root) => {
  const local = path.join(root, 'local')
  const remote = path.join(root, 'remote')
  writeAssets(local, '1.2.3')
  const manifest = buildLocalReleaseManifest(local, '1.2.3')
  assert.equal(planRelease(manifest, { exists: false }, remote, false).action, 'create-draft')

  writeAssets(remote, '1.2.3')
  const assets = manifest.assets.map(({ name }) => ({ name }))
  assert.equal(planRelease(manifest, { exists: true, isDraft: true, isPrerelease: false, assets }, remote, false).action, 'resume-draft')
  assert.equal(planRelease(manifest, { exists: true, isDraft: false, isPrerelease: false, assets }, remote, false).action, 'noop')
  assert.throws(
    () => planRelease(manifest, { exists: true, isDraft: false, isPrerelease: true, assets }, remote, false),
    /channel differs/,
  )
  fs.writeFileSync(path.join(remote, assets[0].name), 'different')
  assert.throws(
    () => planRelease(manifest, { exists: true, isDraft: true, isPrerelease: false, assets }, remote, false),
    /differs/,
  )
  fs.copyFileSync(path.join(local, assets[0].name), path.join(remote, assets[0].name))
  fs.rmSync(path.join(remote, assets[1].name))
  const publicMissing = assets.filter((_, index) => index !== 1)
  assert.throws(
    () => planRelease(manifest, { exists: true, isDraft: false, isPrerelease: false, assets: publicMissing }, remote, false),
    /missing required asset/,
  )
}))
// Quality-Scenario: R-MISSING-ASSET
// Quality-Scenario: R-RERUN-HASH
