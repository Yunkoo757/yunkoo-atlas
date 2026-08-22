import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { importsTarget, importsWithinTarget } from '../governance-imports.mjs'
import {
  findForbiddenLegacyRuntimeMatches,
  isExecutableProductionSource,
  LEGACY_RUNTIME_COMPATIBILITY_ALLOWLIST,
} from '../legacy-runtime-governance.mjs'

test('场景注册表冻结完整且无重复的发布质量合同', () => {
  const expectedIds = [
    'H0-A-16',
    'H0-A-MISSING-*',
    'H0-A-TYPE-*',
    'H0-B-16',
    'H0-B-ABORT',
    'H0-C-16',
    'H0-C-ASSET-N',
    'H0-D-16',
    'H0-D-WEB-REJECT',
    'W-REV-INIT',
    'W-SAVE-STALE',
    'W-IMPORT-STALE',
    'W-RESTORE-STALE',
    'W-GC-STALE',
    'W-TX-ABORT-*',
    'W-NO-LOCKS',
    'W-LOCK-LOSS',
    'W-RECOVERY-EXPORT',
    'E-PATH-ABSENT',
    'E-PATH-MISSING',
    'E-PATH-BADJSON',
    'E-PATH-PERM',
    'E-QUIT-MULTI',
    'E-QUIT-STALE-ACK',
    'E-QUIT-FLUSH-FAIL',
    'E-QUIT-BACKUP-FAIL',
    'E-QUIT-RELEASED',
    'E-FORCED-KILL',
    'T-UNDO-UNRELATED',
    'T-UNDO-CONFLICT',
    'T-UNDO-OLD-TOAST',
    'T-REDO-CONFLICT',
    'T-KIND-MATRIX',
    'T-KIND-BYPASS',
    'T-CASE-COPY',
    'I-JSON-SIZE',
    'I-JSON-BASE64',
    'I-JSON-WRITER',
    'I-NOTION-SLOT',
    'I-COMPOSER-N',
    'I-COMPOSER-CAS',
    'LS-V11-MIGRATION',
    'LS-OWNERSHIP-STABLE',
    'LS-ROLLOVER-ATOMIC',
    'LS-SNAPSHOT-TRANSACTION',
    'LS-HISTORY-SCOPE',
    'LS-REVIEW-DEFAULT',
    'A-INVENTORY-SHARED',
    'A-INVENTORY-MISSING',
    'A-WEB-DELETE-N',
    'A-WEB-RECOVERY',
    'A-ELEC-DBFAIL',
    'A-ELEC-POSTDB-CRASH',
    'A-ELEC-PATH',
    'A-DRYRUN-RACE',
    'B-BOUNDARY',
    'B-CALENDAR',
    'B-LONG-LIVED',
    'Q-DISCOVERY',
    'Q-PAGEERROR',
    'P-10K/20K',
    'R-WIN-FAIL',
    'R-MAC-FAIL',
    'R-FINAL-PAYLOAD',
    'R-MISSING-ASSET',
    'R-RERUN-HASH',
    'R-TRAIN-DRILLS',
  ].sort()
  const registry = JSON.parse(readFileSync('scripts/quality-scenarios.json', 'utf8'))
  const registeredIds = registry.map((scenario) => scenario.id).sort()

  assert.deepEqual(registeredIds, expectedIds)
  assert.equal(new Set(registeredIds).size, registeredIds.length)
  assert.ok(registry.every((scenario) => Array.isArray(scenario.evidence) && scenario.evidence.length > 0))
})

test('依赖边界识别 alias、相对路径、re-export 与 dynamic import', () => {
  assert.equal(importsTarget("import x from '@/lib/importExport'", 'src/store/useStore.ts', 'src/lib/importExport'), true)
  assert.equal(importsTarget("import x from '../lib/importExport'", 'src/store/useStore.ts', 'src/lib/importExport'), true)
  assert.equal(importsTarget("import { getStorage } from '@/storage'", 'src/storage/persist.ts', 'src/storage/index'), true)
  assert.equal(importsTarget("import { getStorage } from './index'", 'src/storage/persist.ts', 'src/storage/index'), true)
  assert.equal(importsTarget("export { x } from '../storage/provider'", 'src/lib/importMerge.ts', 'src/storage/provider'), true)
  assert.equal(importsTarget("const x = import('../components/X')", 'src/lib/importMerge.ts', 'src/components/X'), true)
  assert.equal(importsTarget("import x from '../lib/safe'", 'src/store/useStore.ts', 'src/lib/importExport'), false)
  assert.equal(importsWithinTarget("import { getStorage } from '@/storage'", 'src/lib/importMerge.ts', 'src/storage/index'), true)
  assert.equal(importsWithinTarget("import x from '@/store/useStore'", 'src/lib/importMerge.ts', 'src/store'), true)
})

test('治理门冻结最小依赖边界、UTF-8 fatal decode 与无 BOM 规则', () => {
  const checker = readFileSync('scripts/check-governance.mjs', 'utf8')
  const execution = readFileSync('scripts/quality-execution.mjs', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

  for (const contract of [
    'src/lib/importMerge.ts',
    'src/storage/snapshotCodec.ts',
    'src/storage/persistenceController.ts',
    'src/shortcuts/bindingRules.ts',
    'src/types/journal-bridge.d.ts',
  ]) {
    assert.match(checker, new RegExp(contract.replaceAll('/', '\\/').replaceAll('.', '\\.')))
  }
  assert.match(checker, /new TextDecoder\('utf-8', \{ fatal: true \}\)/)
  assert.match(checker, /0xef.*0xbb.*0xbf/s)
  assert.match(checker, /discoverUnitTestEntries/)
  assert.match(checker, /discoverBrowserTests/)
  assert.match(checker, /execution\.sourceIdentity !== provenance\.sourceIdentity/)
  assert.match(checker, /executedContractScenarioIds/)
  assert.match(checker, /declaredReleaseGateScenarioIds/)
  assert.doesNotMatch(checker, /pendingReleaseGateScenarioIds/)
  assert.match(execution, /sourceIdentity: provenance\.sourceIdentity/)
  assert.equal(pkg.scripts['check:governance'], 'node scripts/check-governance.mjs')
  assert.match(pkg.scripts.test, /check-governance\.mjs/)
})

test('旧阶段字段只允许存在于逐文件逐字段的 v11 解码边界', () => {
  const files = [
    { path: 'src/lib/stageMigration.ts', source: 'raw.livePerformanceCycles; raw.liveStatsStartTradingDayKey' },
    { path: 'src/storage/snapshotCodec.ts', source: 'raw.livePerformanceCycles' },
    { path: 'src/store/useStore.ts', source: 'state.livePerformanceCycles' },
    { path: 'electron/library/storage.ts', source: 'snapshot.liveStatsStartTradingDayKey' },
    { path: 'scripts/runtime.mjs', source: 'const copy = "重置实盘统计"' },
  ]
  assert.deepEqual(findForbiddenLegacyRuntimeMatches(files), [
    { path: 'src/store/useStore.ts', line: 1, token: 'livePerformanceCycles' },
    { path: 'electron/library/storage.ts', line: 1, token: 'liveStatsStartTradingDayKey' },
    { path: 'scripts/runtime.mjs', line: 1, token: '重置实盘统计' },
  ])
  assert.deepEqual(
    [...LEGACY_RUNTIME_COMPATIBILITY_ALLOWLIST.keys()],
    ['src/lib/stageMigration.ts', 'src/storage/snapshotCodec.ts'],
    'allowlist 必须保持为两个精确迁移边界，不能放宽到目录或运行时消费者',
  )
})

test('全部可执行生产源码不再消费旧阶段真值或展示旧重置文案', () => {
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => path.replaceAll('\\', '/'))
    .filter(existsSync)
    .filter(isExecutableProductionSource)
  const files = paths.map((path) => ({ path, source: readFileSync(path, 'utf8') }))
  assert.deepEqual(findForbiddenLegacyRuntimeMatches(files), [])
})
