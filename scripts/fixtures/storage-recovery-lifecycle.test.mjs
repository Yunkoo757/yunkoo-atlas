import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (filePath) => fs.readFileSync(filePath, 'utf8')

test('storage recovery Electron lifecycle gate is wired into release-quality execution', () => {
  const pkg = JSON.parse(read('package.json'))
  const runner = read('scripts/qa-storage-recovery-lifecycle.mjs')
  const qaRelease = read('scripts/qa-release.mjs')

  assert.equal(
    pkg.scripts['test:storage-recovery:electron'],
    'node scripts/qa-storage-recovery-lifecycle.mjs',
  )
  assert.match(runner, /oldLifecycleId/)
  assert.match(runner, /newLifecycleId/)
  assert.match(runner, /恢复 CTA 必须替换主进程 LibraryStorage lifecycle/)
  assert.match(runner, /durableSentinelAfterExit/)
  assert.match(runner, /collectElectronBundleIdentity/)
  assert.match(runner, /fs\.rmSync\(outputPath, \{ force: true \}\)/)
  assert.match(runner, /staleRendererWriteRejected/)
  assert.match(runner, /rendererReloadHeld/)
  assert.match(runner, /exclusiveAtMainFrameCommit === true/)
  assert.match(runner, /assertRepositoryProvenanceUnchanged/)
  assert.match(runner, /SIGKILL/)
  assert.ok(
    runner.indexOf('fs.rmSync(outputPath, { force: true })') <
      runner.indexOf('readRepositoryBuildExpectation(root)'),
    '旧 evidence 必须在 provenance/build 前置校验前删除，避免上传上一轮 pass',
  )
  assert.ok(
    qaRelease.indexOf("run('pnpm', ['build:app'])") <
      qaRelease.indexOf("run('pnpm', ['test:storage-recovery:electron'])"),
    'release QA 必须先构建 production Electron bundle，再运行真实恢复生命周期门禁',
  )
})

test('storage recovery evidence is fail-closed in platform and release workflows', () => {
  const platformWorkflow = read('.github/workflows/forced-kill-evidence.yml')
  const releaseWorkflow = read('.github/workflows/release.yml')
  const fullQaWorkflow = read('.github/workflows/full-qa.yml')
  const releaseCandidateWorkflow = read('.github/workflows/release-candidate.yml')

  assert.match(platformWorkflow, /pnpm test:storage-recovery:electron/)
  assert.match(platformWorkflow, /test-results\/storage-recovery\/storage-recovery-electron\.json/)
  for (const recoveryPath of [
    'electron/library/sessionGate.ts',
    'electron/library/storageRecovery.ts',
    'electron/library/storageRecovery.test.ts',
    'electron/library/libraryActivation.test.ts',
    'electron/buildIdentity.ts',
    'scripts/git-provenance.mjs',
    'src/main.tsx',
    'src/lib/storageRecovery.ts',
    'src/AppStorageRecovery.browser.test.html',
    'src/AppStorageRecovery.browser.test.tsx',
    'src/views/settings/DataSettingsPanel.tsx',
    'pnpm-lock.yaml',
  ]) {
    assert.match(
      platformWorkflow,
      new RegExp(`- ['\"]${recoveryPath.replaceAll('/', '\\/')}['\"]`),
      `${recoveryPath} 单独变化也必须触发双平台恢复 evidence`,
    )
  }
  assert.match(releaseWorkflow, /Verify storage recovery lifecycle on Windows[\s\S]*pnpm test:storage-recovery:electron/)
  assert.match(releaseWorkflow, /Verify storage recovery lifecycle on macOS[\s\S]*pnpm test:storage-recovery:electron/)
  assert.match(releaseWorkflow, /test-results\/storage-recovery\/storage-recovery-electron\.json/)
  assert.match(fullQaWorkflow, /test-results\/storage-recovery\/storage-recovery-electron\.json/)
  assert.match(releaseCandidateWorkflow, /test-results\/storage-recovery\/storage-recovery-electron\.json/)
  const recoveryEvidenceCheck = releaseCandidateWorkflow.indexOf('Verify storage recovery evidence exists')
  const candidateEvidenceUpload = releaseCandidateWorkflow.indexOf('Upload candidate evidence')
  assert.ok(
    recoveryEvidenceCheck >= 0 && recoveryEvidenceCheck < candidateEvidenceUpload,
    'release candidate 必须在合并上传前单独验证 storage recovery evidence 存在',
  )
  assert.match(
    releaseCandidateWorkflow.slice(recoveryEvidenceCheck, candidateEvidenceUpload),
    /Test-Path -LiteralPath ['"]test-results\/storage-recovery\/storage-recovery-electron\.json['"] -PathType Leaf/,
  )
})
