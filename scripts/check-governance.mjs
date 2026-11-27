import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { discoverBrowserTests, discoverQualityNodeTests, discoverUnitTestEntries } from './test-discovery.mjs'
import { executionReportPath, hashFile } from './quality-execution.mjs'
import { readGitProvenance } from './git-provenance.mjs'
import { runtimeDependencyGraph, websiteDependencyGraph, findEagerCycles, firstForbiddenPath, importsTarget, importsWithinTarget } from './governance-imports.mjs'
import {
  findForbiddenLegacyRuntimeMatches,
  isExecutableProductionSource,
} from './legacy-runtime-governance.mjs'

const root = process.cwd()
const failures = []
let scenarios = []
let files = []
let pureModules = []
const verifiedScenarioIds = new Set()
const requireExecution = process.argv.includes('--require-execution')
const normalized = (value) => value.replaceAll('\\', '/')
const provenance = await readGitProvenance(root)

async function main() {
  scenarios = JSON.parse(await fs.readFile(path.join(root, 'scripts/quality-scenarios.json'), 'utf8'))
  const unitEntries = new Set((await discoverUnitTestEntries(root)).map(normalized))
  const browserEntries = new Set((await discoverBrowserTests(root)).map((entry) => normalized(entry.label)))
  const nodeEntries = new Set(await discoverQualityNodeTests(root))
  let execution = null
  if (requireExecution) {
    try {
      execution = JSON.parse(await fs.readFile(executionReportPath(root), 'utf8'))
      if (execution.status !== 'pass') failures.push('质量执行报告不是 PASS')
      if (execution.gitCommit !== provenance.gitCommit) failures.push('质量执行报告 git commit 与当前源码不一致')
      if (execution.gitTree !== provenance.gitTree) failures.push('质量执行报告 git tree 与当前源码不一致')
      if (execution.sourceIdentity !== provenance.sourceIdentity) failures.push('质量执行报告源码身份与当前源码不一致')
    } catch (error) {
      failures.push(`质量执行报告不可用：${error.message}`)
    }
  }

  const scenarioIds = new Set()
  for (const scenario of scenarios) {
    const isQualityExecutionScenario = scenario.mode !== 'manual'
    let scenarioVerified = isQualityExecutionScenario && execution?.status === 'pass'
    if (!scenario || typeof scenario.id !== 'string' || !/^[A-Z0-9][A-Z0-9*/-]+$/.test(scenario.id)) {
      failures.push(`非法场景 ID：${JSON.stringify(scenario?.id)}`)
      continue
    }
    if (scenarioIds.has(scenario.id)) failures.push(`重复场景 ID：${scenario.id}`)
    scenarioIds.add(scenario.id)
    if (!Array.isArray(scenario.evidence) || scenario.evidence.length === 0) {
      failures.push(`场景缺少证据：${scenario.id}`)
      continue
    }
    if (isQualityExecutionScenario && (typeof scenario.testId !== 'string' || !scenario.testId.includes('#'))) {
      failures.push(`自动场景缺少具体测试 ID：${scenario.id}`)
      scenarioVerified = false
    } else if (isQualityExecutionScenario) {
      const testFile = normalized(scenario.testId.slice(0, scenario.testId.indexOf('#')))
      if (!scenario.evidence.map(normalized).includes(testFile)) {
        failures.push(`场景测试 ID 不属于其证据文件：${scenario.id} → ${scenario.testId}`)
        scenarioVerified = false
      }
    }
    for (const evidence of scenario.evidence) {
      const absolute = path.join(root, evidence)
      let source
      try {
        source = await fs.readFile(absolute, 'utf8')
      } catch {
        failures.push(`场景证据不存在：${scenario.id} → ${evidence}`)
        scenarioVerified = false
        continue
      }
      if (scenario.mode === 'manual') continue
      const relative = normalized(evidence)
      const isBrowser = relative.endsWith('.browser.test.html') && browserEntries.has(relative)
      const isUnit = unitEntries.has(relative)
      const isNode = nodeEntries.has(relative)
      if (!isBrowser && !isUnit && !isNode) {
        failures.push(`自动场景证据不在测试发现链：${scenario.id} → ${evidence}`)
        scenarioVerified = false
      }
      if (!source.includes(`Quality-Scenario: ${scenario.id}`)) {
        failures.push(`场景证据缺少精确标记：${scenario.id} → ${evidence}`)
        scenarioVerified = false
      }
      if (requireExecution && execution && isQualityExecutionScenario) {
        const actualHash = await hashFile(root, relative)
        if (execution.executedFiles?.[relative] !== actualHash) {
          failures.push(`场景证据未以当前内容执行并通过：${scenario.id} → ${evidence}`)
          scenarioVerified = false
        }
      }
    }
    if (requireExecution && execution && isQualityExecutionScenario && typeof scenario.testId === 'string') {
      const testFile = normalized(scenario.testId.slice(0, scenario.testId.indexOf('#')))
      const actualHash = await hashFile(root, testFile)
      if (execution.executedTests?.[scenario.testId] !== actualHash) {
        failures.push(`场景的具体测试未以当前内容执行并通过：${scenario.id} → ${scenario.testId}`)
        scenarioVerified = false
      }
    }
    if (scenarioVerified) verifiedScenarioIds.add(scenario.id)
  }

  pureModules = [
    'src/lib/importMerge.ts', 'src/storage/snapshotCodec.ts', 'src/storage/persistenceController.ts',
    'src/shortcuts/bindingRules.ts', 'src/lib/tradeUndo.ts', 'src/lib/tradeKind.ts',
    'src/lib/periods.ts', 'src/lib/analysisScope.ts',
    'src/lib/riskFingerprint.ts', 'src/lib/base64.ts', 'src/lib/crc32.ts', 'src/lib/operationLog.ts',
    'src/storage/snapshotRichText.ts', 'src/lib/webJournalArchiveContract.ts',
    'src/lib/webJournalArchiveWriter.ts', 'src/lib/tradeUpsert.ts', 'src/storage/libraryDatabase.ts',
  ]
  const forbiddenPureTargets = ['src/store', 'src/components', 'src/storage/provider', 'src/storage/index', 'src/storage/bootstrap', 'electron']
  for (const file of pureModules) {
    const source = await fs.readFile(path.join(root, file), 'utf8')
    for (const target of forbiddenPureTargets) {
      if (importsWithinTarget(source, file, target)) failures.push(`纯模块发生反向依赖：${file} → ${target}`)
    }
  }

  const architectureContracts = [
    ['src/store/useStore.ts', 'src/lib/importExport', 'Store 不得反向依赖 importExport workflow'],
    ['src/storage/persist.ts', 'src/storage/index', 'persist 不得导入 storage barrel'],
    ['src/storage/provider.ts', 'src/storage/bootstrap', 'provider 不得反向依赖 bootstrap'],
    ['src/storage/provider.ts', 'src/storage/persist', 'provider 不得反向依赖 persist'],
    ['src/store/shortcutStore.ts', 'src/shortcuts/engine', 'shortcutStore 不得反向依赖有状态 engine'],
  ]
  for (const [file, target, message] of architectureContracts) {
    const source = await fs.readFile(path.join(root, file), 'utf8')
    if (importsTarget(source, file, target)) failures.push(`${message}：${file}`)
  }
  const preload = await fs.readFile(path.join(root, 'electron/preload.ts'), 'utf8')
  const declaration = await fs.readFile(path.join(root, 'src/types/journal-bridge.d.ts'), 'utf8')
  if (!importsTarget(preload, 'electron/preload.ts', 'src/types/journalBridge')) failures.push('Electron preload 未使用统一 JournalBridge 类型源')
  if (!importsTarget(declaration, 'src/types/journal-bridge.d.ts', 'src/types/journalBridge')) failures.push('renderer declaration 未使用统一 JournalBridge 类型源')

  files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean).map(normalized)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const knownTextExtensions = new Set(['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.css', '.html', '.yml', '.yaml', '.svg', '.toml', '.txt', '.nsh'])
  const knownTextNames = new Set(['.gitignore', '.gitattributes', '.npmrc', 'license'])
  const textFiles = []
  for (const file of files) {
    let bytes
    try {
      bytes = await fs.readFile(path.join(root, file))
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
    const knownText = knownTextExtensions.has(path.extname(file).toLowerCase()) || knownTextNames.has(path.basename(file).toLowerCase())
    const hasUtf16Bom = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
    if (hasUtf16Bom || (knownText && bytes.subarray(0, 8192).includes(0))) {
      textFiles.push(file)
      failures.push(`文件不是有效 UTF-8：${file}`)
      continue
    }
    if (bytes.subarray(0, 8192).includes(0)) continue
    textFiles.push(file)
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      failures.push(`UTF-8 BOM 禁止：${file}`)
      continue
    }
    try { decoder.decode(bytes) } catch { failures.push(`文件不是有效 UTF-8：${file}`) }
  }
  files = textFiles

  const executableSources = []
  for (const file of files.filter(isExecutableProductionSource)) {
    executableSources.push({ path: file, source: await fs.readFile(path.join(root, file), 'utf8') })
  }
  const desktopModules = executableSources.map(file => file.path)
    .filter(file => /^(src|electron)\/.*\.[jt]sx?$/.test(file) && !file.endsWith('.d.ts'))
  const editor = 'tools/atlas-data-editor/app.ts'
  const trainer = ['execution-trainer/main.cjs', 'execution-trainer/preload.cjs', 'execution-trainer/renderer.js']
  const graph = {
    ...runtimeDependencyGraph(files, root, [...desktopModules, editor, ...trainer]),
    ...websiteDependencyGraph(root, files),
  }
  for (const cycle of findEagerCycles(graph)) failures.push(`运行时循环依赖：${cycle.join(' → ')}`)
  for (const entry of [editor, ...trainer]) {
    const violation = firstForbiddenPath(graph, entry, forbiddenPureTargets)
    if (violation) failures.push(`独立工具依赖 Atlas 会话或主进程：${violation.join(' → ')}`)
  }
  for (const file of ['electron/library/storage.ts', 'electron/library/backup.ts', 'electron/library/paths.ts']) {
    const violation = firstForbiddenPath(graph, file, ['electron/library/libraryLocation', 'electron/library/ipc'])
    if (violation) failures.push(`底层资料库操作必须由调用方指定目标：${violation.join(' → ')}`)
  }
  for (const file of pureModules) {
    const violation = firstForbiddenPath(graph, file, forbiddenPureTargets)
    if (violation) failures.push(`纯模块经依赖链访问运行环境：${violation.join(' → ')}`)
  }
  const graphDirectory = path.join(root, 'test-results')
  await fs.mkdir(graphDirectory, { recursive: true })
  const desktopGraph = Object.fromEntries(desktopModules.map(file => [file, graph[file]]))
  await fs.writeFile(path.join(graphDirectory, 'desktop-dependencies.json'), JSON.stringify(desktopGraph, null, 2) + '\n')
  await fs.writeFile(path.join(graphDirectory, 'runtime-dependencies.json'), JSON.stringify(graph, null, 2) + '\n')

  for (const match of findForbiddenLegacyRuntimeMatches(executableSources)) {
    failures.push(`legacy runtime truth 禁止：${match.path}:${match.line} → ${match.token}`)
  }
}

try {
  await main()
} catch (error) {
  failures.push(`治理门内部错误：${error?.stack ?? error}`)
}

const executedContractScenarioIds = requireExecution ? [...verifiedScenarioIds] : []
const report = {
  version: 4,
  generatedAt: new Date().toISOString(),
  gitCommit: provenance.gitCommit,
  gitTree: provenance.gitTree,
  workingTreeDirty: provenance.workingTreeDirty,
  sourceFingerprint: provenance.sourceFingerprint,
  sourceIdentity: provenance.sourceIdentity,
  executionRequired: requireExecution,
  scenarioCount: scenarios.length,
  automaticScenarioCount: scenarios.filter((scenario) => scenario.mode !== 'manual').length,
  executedContractScenarioIds,
  manualScenarioIds: scenarios.filter((scenario) => scenario.mode === 'manual').map((scenario) => scenario.id),
  declaredReleaseGateScenarioIds: scenarios.filter((scenario) => scenario.mode === 'release-gate').map((scenario) => scenario.id),
  pureModules,
  utf8FileCount: files.length,
  status: failures.length === 0 ? 'pass' : 'fail',
  failures,
}
const reportDirectory = path.join(root, 'test-results')
await fs.mkdir(reportDirectory, { recursive: true })
await fs.writeFile(path.join(reportDirectory, 'quality-contract.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
if (failures.length > 0) {
  console.error(`治理门失败：\n${failures.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`GOV PASS：${report.scenarioCount} 个场景，${report.utf8FileCount} 个 UTF-8 文本文件`)
}
