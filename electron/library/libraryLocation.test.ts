import {
  resolveLibraryLocation,
  type LibraryLocationResolverDependencies,
} from './libraryLocation'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LibraryStorage } from './storage'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

type Entry = 'file' | 'directory' | 'denied'

function dependencies(options: {
  config?: string
  environmentPath?: string
  defaultPath?: string
  entries?: Record<string, Entry>
  validation?: Record<string, { libraryId: string } | Error>
  probes?: string[]
} = {}): LibraryLocationResolverDependencies {
  const configPath = 'C:\\user\\library-config.json'
  const entries = new Map(Object.entries(options.entries ?? {}))
  if (options.config !== undefined) entries.set(configPath, 'file')
  return {
    configPath,
    environmentPath: options.environmentPath,
    defaultPath: options.defaultPath ?? 'C:\\Documents\\Yunkoo Atlas',
    readTextFile(filePath) {
      if (filePath !== configPath || options.config === undefined) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }
      return options.config
    },
    inspectPath(filePath) {
      options.probes?.push(filePath)
      const entry = entries.get(filePath)
      if (!entry) return 'missing'
      if (entry === 'denied') throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return entry
    },
    assertReadableWritable(filePath) {
      if (entries.get(filePath) === 'denied') {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      }
    },
    async validateExistingLibrary(filePath) {
      const result = options.validation?.[filePath]
      if (result instanceof Error) throw result
      if (!result) throw new Error('manifest or database is incomplete')
      return result
    },
  }
}

export async function testMissingConfigurationAndDefaultIsUnset(): Promise<void> {
  const state = await resolveLibraryLocation(dependencies())
  assert(state.kind === 'unset', '首次运行且默认库不存在时必须返回 unset')
}

export async function testCorruptConfigurationFailsClosedWithoutDefaultProbe(): Promise<void> {
  const probes: string[] = []
  const state = await resolveLibraryLocation(dependencies({ config: '{broken', probes }))
  assert(state.kind === 'invalid', '损坏配置必须返回 invalid')
  assert(!probes.includes('C:\\Documents\\Yunkoo Atlas'), '损坏配置后不得探测或回退默认库')
}

export async function testMissingConfiguredLibraryDoesNotFallBack(): Promise<void> {
  const configuredPath = 'D:\\missing-library'
  const probes: string[] = []
  const state = await resolveLibraryLocation(dependencies({
    config: JSON.stringify({ libraryPath: configuredPath }),
    probes,
  }))
  assert(state.kind === 'unavailable', '配置目标丢失必须返回 unavailable')
  assert(state.kind !== 'unset' && state.configuredPath === configuredPath, '错误状态必须保留原配置路径')
  assert(!probes.includes('C:\\Documents\\Yunkoo Atlas'), '配置目标丢失后不得回退默认库')
}

export async function testEnvironmentPathFailsClosed(): Promise<void> {
  const environmentPath = 'E:\\portable-library'
  const state = await resolveLibraryLocation(dependencies({ environmentPath }))
  assert(state.kind === 'unavailable', '显式环境路径不可用时必须 fail-closed')
  assert(state.kind !== 'unset' && state.configuredPath === environmentPath, '必须向恢复界面报告环境路径')
}

export async function testNonDirectoryAndPermissionFailureAreDistinguished(): Promise<void> {
  const filePath = 'D:\\library-file'
  const deniedPath = 'D:\\denied-library'
  const invalid = await resolveLibraryLocation(dependencies({
    config: JSON.stringify({ libraryPath: filePath }),
    entries: { [filePath]: 'file' },
  }))
  const unavailable = await resolveLibraryLocation(dependencies({
    config: JSON.stringify({ libraryPath: deniedPath }),
    entries: { [deniedPath]: 'denied' },
  }))
  assert(invalid.kind === 'invalid', '目标不是目录时必须返回 invalid')
  assert(unavailable.kind === 'unavailable', '权限拒绝时必须返回 unavailable')
}

export async function testValidationFailureNeedsRecovery(): Promise<void> {
  const libraryPath = 'D:\\damaged-library'
  const state = await resolveLibraryLocation(dependencies({
    config: JSON.stringify({ libraryPath }),
    entries: { [libraryPath]: 'directory' },
    validation: { [libraryPath]: new Error('journal.db is damaged') },
  }))
  assert(state.kind === 'needs-recovery', '库内容校验失败必须进入 needs-recovery')
}

export async function testValidationTargetDisappearanceIsUnavailable(): Promise<void> {
  const libraryPath = 'D:\\vanished-library'
  const missing = Object.assign(new Error('vanished during validation'), { code: 'ENOENT' })
  const state = await resolveLibraryLocation(dependencies({
    config: JSON.stringify({ libraryPath }),
    entries: { [libraryPath]: 'directory' },
    validation: { [libraryPath]: missing },
  }))
  assert(state.kind === 'unavailable', '验证期间路径消失必须返回 unavailable')
}

export async function testConfiguredLibraryIdentityMismatchIsInvalid(): Promise<void> {
  const libraryPath = 'D:\\other-library'
  const state = await resolveLibraryLocation(dependencies({
    config: JSON.stringify({ libraryPath, libraryId: 'expected-library' }),
    entries: { [libraryPath]: 'directory' },
    validation: { [libraryPath]: { libraryId: 'actual-library' } },
  }))
  assert(state.kind === 'invalid', '配置身份与 manifest 不符时必须返回 invalid')
}

export async function testValidLegacyAndDefaultLibrariesAreReady(): Promise<void> {
  const configuredPath = 'D:\\legacy-library'
  const configured = await resolveLibraryLocation(dependencies({
    config: JSON.stringify({ libraryPath: configuredPath }),
    entries: { [configuredPath]: 'directory' },
    validation: { [configuredPath]: { libraryId: 'legacy-id' } },
  }))
  assert(configured.kind === 'ready' && configured.source === 'config', '旧版无 libraryId 配置仍应兼容')
  assert(
    configured.kind === 'ready' && configured.verifiedLibraryId === 'legacy-id',
    '内部验证结果必须携带 libraryId 供正式打开时二次比对',
  )

  const defaultPath = 'C:\\Documents\\Yunkoo Atlas'
  const fallback = await resolveLibraryLocation(dependencies({
    entries: { [defaultPath]: 'directory' },
    validation: { [defaultPath]: { libraryId: 'default-id' } },
  }))
  assert(fallback.kind === 'ready' && fallback.source === 'default', '只有无配置和环境变量时才可使用已有默认库')
}

export function testReadOnlyCandidateConstructionDoesNotCreateDirectories(): void {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-location-readonly-'))
  const candidatePath = path.join(parent, 'missing-candidate')
  const candidate = new LibraryStorage(candidatePath, { ensureDirectories: false })
  try {
    assert(!fs.existsSync(candidatePath), '只读候选检查不得创建目标目录或空库')
  } finally {
    candidate.release()
    fs.rmSync(parent, { recursive: true, force: true })
  }
}

export async function testReadOnlyCandidateOpenDoesNotCreateAnEmptyDatabase(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-location-no-create-'))
  const candidate = new LibraryStorage(root, {
    ensureDirectories: false,
    allowCreate: false,
  })
  let rejected = false
  try {
    await candidate.open()
  } catch {
    rejected = true
  } finally {
    candidate.release()
  }
  try {
    assert(rejected, '只读打开必须拒绝不存在的 journal.db')
    assert(!fs.existsSync(path.join(root, 'journal.db')), '只读打开失败后不得创建空数据库')
    assert(!fs.existsSync(path.join(root, 'manifest.json')), '只读打开失败后不得创建 manifest')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testReadOnlyOpenRejectsExistingDatabaseWithoutRequiredSchema(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-location-empty-db-'))
  const dbFile = path.join(root, 'journal.db')
  fs.writeFileSync(dbFile, Buffer.alloc(0))
  const candidate = new LibraryStorage(root, {
    ensureDirectories: false,
    allowCreate: false,
  })
  let rejected = false
  try {
    await candidate.open()
  } catch {
    rejected = true
  } finally {
    candidate.release()
  }
  try {
    assert(rejected, '缺少必需表的已有数据库必须进入恢复流程')
    assert(fs.statSync(dbFile).size === 0, '拒绝损坏数据库时不得在磁盘上修补 schema')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testReadOnlyOpenNeverRecreatesMissingManifest(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-location-no-manifest-'))
  const writer = new LibraryStorage(root)
  await writer.open()
  writer.release()
  const manifestFile = path.join(root, 'manifest.json')
  fs.rmSync(manifestFile)
  const candidate = new LibraryStorage(root, {
    ensureDirectories: false,
    allowCreate: false,
  })
  let rejected = false
  try {
    await candidate.open()
  } catch {
    rejected = true
  } finally {
    candidate.release()
  }
  try {
    assert(rejected, '只读打开必须拒绝缺失 manifest 的资料库')
    assert(!fs.existsSync(manifestFile), '只读打开不得重新生成 manifest 或 libraryId')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export function testBackupIpcMustUseValidatedStoragePath(): void {
  const source = fs.readFileSync(path.resolve('electron/library/ipc.ts'), 'utf8')
  for (const channel of ['backup:list', 'backup:verify', 'backup:delete', 'backup:stats']) {
    const start = source.indexOf(`ipcMain.handle('${channel}'`)
    const end = source.indexOf("ipcMain.handle('", start + 20)
    const body = source.slice(start, end)
    assert(start >= 0, `${channel} IPC 必须存在`)
    assert(body.includes('withStorage('), `${channel} 必须先通过已验证的活动库状态`)
  }
}
// Quality-Scenario: E-PATH-ABSENT
// Quality-Scenario: E-PATH-MISSING
// Quality-Scenario: E-PATH-BADJSON
// Quality-Scenario: E-PATH-PERM
