import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { decodeRepositoryText, isRepositoryText } from '../repository-text.mjs'
import { importsTarget, importsWithinTarget, journalBridgeDeclarationOwners } from '../governance-imports.mjs'
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

test('桌面桥接契约和 Window 成员各有一个声明来源，转发或注释不构成声明', () => {
  const canonical = 'src/types/journalBridge.ts'
  const duplicate = 'src/other/ambient.d.ts'
  const observed = journalBridgeDeclarationOwners([
    { path: canonical, source: 'export interface JournalBridge {}\ndeclare global { interface Window { journalBridge?: JournalBridge } }' },
    { path: 'electron/preload.ts', source: "import type { JournalBridge } from '../src/types/journalBridge'" },
    { path: 'src/reference.ts', source: "/* interface JournalBridge {} */ export type { JournalBridge } from './types/journalBridge'" },
    { path: duplicate, source: "declare global { interface Window { 'journalBridge'?: Copy } }\ntype JournalBridge = Copy" },
  ])
  assert.deepEqual(observed, { contract: [canonical, duplicate], window: [canonical, duplicate] })
})

test('全仓文本判定保留未知文本与二进制边界，并严格解码所有已知文本', () => {
  const utf16 = Buffer.from('echo Atlas', 'utf16le')
  for (const file of ['capture.ps1', 'tools/start.CJS', 'LICENSE', 'config.jsonc', '.githooks/pre-commit']) {
    assert.ok(isRepositoryText(file, utf16), file)
    assert.throws(() => decodeRepositoryText(utf16), /NUL/)
  }
  const valid = Buffer.from('交易资料\r\n🗂')
  assert.ok(isRepositoryText('instructions', valid))
  assert.equal(decodeRepositoryText(valid), '交易资料\r\n🗂')
  assert.equal(isRepositoryText('diagram.png', Buffer.from([0x89, 0, 13])), false)
  assert.ok(isRepositoryText('unknown', Buffer.from([0xff, 0xfe, 0, 0])))
  assert.throws(() => decodeRepositoryText(Buffer.from([0xef, 0xbb, 0xbf, 65])), /UTF-8 BOM/)
  assert.throws(() => decodeRepositoryText(Buffer.from([0xc3, 0x28])), /不是有效 UTF-8/)
})

test('治理门冻结最小依赖边界与执行报告来源', () => {
  const checker = readFileSync('scripts/check-governance.mjs', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

  for (const contract of [
    'src/lib/importMerge.ts',
    'src/storage/snapshotCodec.ts',
    'src/storage/persistenceController.ts',
    'src/shortcuts/bindingRules.ts',
    'src/types/journalBridge.ts',
  ]) {
    assert.match(checker, new RegExp(contract.replaceAll('/', '\\/').replaceAll('.', '\\.')))
  }
  assert.match(checker, /discoverUnitTestEntries/)
  assert.match(checker, /discoverBrowserTests/)
  assert.match(checker, /execution\.sourceIdentity !== provenance\.sourceIdentity/)
  assert.match(checker, /executedContractScenarioIds/)
  assert.match(checker, /declaredReleaseGateScenarioIds/)
  assert.doesNotMatch(checker, /pendingReleaseGateScenarioIds/)
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
