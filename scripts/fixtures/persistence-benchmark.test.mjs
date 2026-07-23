import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('真实持久化门同时覆盖生产 IndexedDB、LibraryStorage 与 durable reload', () => {
  const runner = readFileSync('scripts/benchmark-persistence.mjs', 'utf8')
  const browser = readFileSync('src/benchmarks/persistenceBenchmark.browser.ts', 'utf8')
  const electron = readFileSync('electron/library/persistenceBenchmark.ts', 'utf8')
  const webZip = readFileSync('scripts/benchmark-web-zip.mjs', 'utf8')
  const store = readFileSync('src/store/useStore.ts', 'utf8').replace(/\r\n/g, '\n')

  assert.match(browser, /new IndexedDbStorageAdapter/)
  assert.match(browser, /adapter\.saveSnapshot/)
  assert.match(browser, /loadSnapshotEnvelope/)
  assert.match(browser, /StorageRevisionConflictError/)
  const adapter = readFileSync('src/storage/indexedDbAdapter.ts', 'utf8').replace(/\r\n/g, '\n')
  assert.match(adapter, /preflightRevision = await this\.getSnapshotRevision\(\)/)
  assert.match(adapter, /return await this\.runLibraryMutation\(input\)/)
  const prepareMutation = adapter.match(
    /async function prepareIndexedDbMutation\([\s\S]*?\n}\n\nexport \{ StorageRevisionConflictError/,
  )?.[0] ?? ''
  assert.match(prepareMutation, /\{\s*await yieldMainThread\(\)/)
  assert.match(prepareMutation, /assertValidPersistedSnapshotCooperatively/)
  assert.match(prepareMutation, /collectAssetIdsFromSnapshotCooperatively/)
  assert.match(prepareMutation, /serializeSnapshotToBlobCooperatively/)
  assert.match(adapter, /index % SNAPSHOT_VALIDATION_BATCH_SIZE === 0[\s\S]*?await yieldMainThread\(\)/)
  assert.match(adapter, /scheduler\?\.yield[\s\S]*?setTimeout/)
  assert.match(adapter, /storedSnapshot instanceof Blob[\s\S]*?storedSnapshot\.text\(\)/)
  const saveSnapshot = adapter.match(
    /async saveSnapshot\(snapshot: PersistedSnapshot\): Promise<void> \{[\s\S]*?\n  }/,
  )?.[0] ?? ''
  assert.doesNotMatch(saveSnapshot, /assertValidPersistedSnapshot/)
  assert.match(saveSnapshot, /await collectAssetIdsFromSnapshotCooperatively/)
  assert.match(saveSnapshot, /this\.preparedAssets\.size > 0/)
  assert.match(browser, /useStore\.getState\(\)\.updateTradeData/)
  const updateTradeData = store.match(/updateTradeData: \(id, patch\) =>[\s\S]*?\n      transitionTradeKind:/)?.[0] ?? ''
  assert.match(updateTradeData, /trades\.findIndex/)
  assert.doesNotMatch(updateTradeData, /trades\.map/)
  assert.match(browser, /mutation < 25/)
  assert.match(browser, /25 次连续编辑必须合并为一次 durable revision/)
  assert.match(browser, /const durations = await observeLongTasks[\s\S]*?updateTradeData/)
  assert.match(browser, /SaveStatusIndicator/)
  assert.match(browser, /textContent\?\.includes\('已保存'\)/)
  assert.match(browser, /dirtyConfirmedSamplesMs/)
  assert.match(browser, /staleConflictSamplesMs/)
  assert.match(browser, /longTaskSamplesMs/)
  assert.match(browser, /longTaskObserverSupported/)
  assert.match(browser, /longTaskCalibrationObserved/)
  assert.match(browser, /await waitForTransactionTurn\(\)[\s\S]*await operation\(\)/)
  assert.match(browser, /performance\.now\(\) \+ 80/)
  assert.match(browser, /getPersistenceDiagnostics\(\)\.maxPendingSnapshotCount/)
  assert.match(browser, /resetPersistenceDiagnostics\(\)/)
  assert.match(browser, /disablePersistWrites\(\)[\s\S]*?uiAdapter\.close\(\)[\s\S]*?staleConflictSamplesMs/)
  assert.doesNotMatch(browser, /loaded\.revision - uiRevision \+ 1/)
  assert.match(browser, /loaded\.revision !== expectedRevision/)
  assert.match(browser, /verifyAssets\(adapter, input\.assets\)/)
  assert.match(browser, /input\.expectedHash/)
  assert.match(electron, /new LibraryStorage/)
  assert.match(electron, /storage\.saveSnapshot/)
  assert.match(electron, /allowCreate: false/)
  assert.match(electron, /storage\.getAssetBytes/)
  assert.match(electron, /createBackupAtPath/)
  assert.match(electron, /verifyBackupAtPath/)
  assert.match(electron, /releaseThenFinalizeWithRollback/)
  assert.match(electron, /storage\.release\(\)/)
  assert.doesNotMatch(runner, /JSON\.parse\(JSON\.stringify/)
  assert.match(webZip, /runWebZipBenchmark/)
  assert.match(webZip, /512 \* MiB/)
  assert.match(webZip, /page\.on\('crash'/)
})

test('release 性能门冻结 10K/20K、5+30 采样、硬 SLO 与证据字段', () => {
  const runner = readFileSync('scripts/benchmark-persistence.mjs', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

  assert.match(runner, /warmups: 5, samples: 30/)
  assert.match(runner, /warmups: 5, samples: 3/)
  assert.match(runner, /createDataset\(10_000\)/)
  assert.match(runner, /createDataset\(20_000\)/)
  assert.match(runner, /web10kSaveP95Ms: 500/)
  assert.match(runner, /web20kSaveP95Ms: 1_000/)
  assert.match(runner, /webMainThreadBlockMs: 50/)
  assert.match(runner, /Web UI main-thread block 10K/)
  assert.match(runner, /Web UI main-thread block 20K/)
  assert.match(runner, /Long Task observer 未通过 10K\/20K 自校准/)
  assert.match(runner, /electron10kSaveP95Ms: 1_500/)
  assert.match(runner, /electron20kSaveP95Ms: 2_500/)
  assert.match(runner, /quitCoordinatorP95Ms: 3_000/)
  for (const field of [
    'gitCommit',
    'gitTree',
    'sourceFingerprint',
    'sourceIdentity',
    'workingTreeDirty',
    'seed',
    'bytes',
    'sha256',
    'cpu',
    'totalMemoryBytes',
    'saveSamplesMs',
    'dirtyConfirmedSamplesMs',
    'staleConflictSamplesMs',
    'longTaskSamplesMs',
    'longTaskObserverSupported',
    'longTaskCalibrationObserved',
    'chromium',
    'electron',
    'sqlJs',
  ]) {
    assert.match(runner, new RegExp(field))
  }
  assert.equal(pkg.scripts['benchmark:persistence'], 'node scripts/benchmark-persistence.mjs')
  assert.equal(pkg.scripts['benchmark:persistence:release'], 'node scripts/run-persistence-release-gate.mjs')
  const releaseGate = readFileSync('scripts/run-persistence-release-gate.mjs', 'utf8')
  assert.match(releaseGate, /runAttempt\(2\)/)
  assert.match(releaseGate, /second\.gitCommit !== first\.gitCommit/)
  assert.match(releaseGate, /second\.sourceIdentity !== first\.sourceIdentity/)
  assert.match(releaseGate, /sourceIdentity: first\.sourceIdentity/)
  assert.match(releaseGate, /persistence-approved-baseline\.json/)
  assert.match(releaseGate, /verifyApprovedPersistenceBaseline\(baseline, root\)/)
  assert.match(releaseGate, /attemptDirectory/)
  assert.match(releaseGate, /createHash\('sha256'\)\.update\(persistenceJson\)/)
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  assert.match(ci, /pnpm benchmark:persistence/)
  assert.match(ci, /persistence-smoke\.json/)
  assert.match(runner, /maxPendingSnapshotCount > 1/)
})
// Quality-Scenario: P-10K/20K
