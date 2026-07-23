import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { importsTarget, importsWithinTarget } from '../governance-imports.mjs'

test('场景注册表与 Spec v2 第 13 节逐项一致', () => {
  const spec = readFileSync(
    'docs/superpowers/specs/2026-07-22-data-reliability-remediation-v2-design.md',
    'utf8',
  )
  const section = spec.slice(spec.indexOf('## 13.'), spec.indexOf('## 14.'))
  const specIds = [...section.matchAll(/^\| ([A-Z][A-Z0-9*/-]+) \|/gm)].map((match) => match[1]).sort()
  const registry = JSON.parse(readFileSync('scripts/quality-scenarios.json', 'utf8'))
  const registeredIds = registry.map((scenario) => scenario.id).sort()

  assert.deepEqual(registeredIds, specIds)
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
