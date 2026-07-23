import fs from 'node:fs'
import path from 'node:path'
import { assertCompatibleManifest } from '../../src/storage/manifestCompatibility'
import type { LibraryManifest } from '../../src/storage/types'
import { LibraryStorage } from './storage'
import { getConfigPath, getDefaultLibraryPath, getLibraryPaths } from './paths'

export type LibraryLocationState =
  | { kind: 'unset' }
  | {
      kind: 'ready'
      configuredPath: string
      resolvedPath: string
      source: 'config' | 'environment' | 'default'
    }
  | { kind: 'unavailable'; configuredPath: string; reason: string }
  | { kind: 'invalid'; configuredPath: string; reason: string }
  | { kind: 'needs-recovery'; configuredPath: string; reason: string }

export type ValidatedLibraryLocation =
  | Exclude<LibraryLocationState, { kind: 'ready' }>
  | (Extract<LibraryLocationState, { kind: 'ready' }> & { verifiedLibraryId: string })

export interface LibraryLocationResolverDependencies {
  configPath: string
  environmentPath?: string
  defaultPath: string
  readTextFile(filePath: string): string
  inspectPath(filePath: string): 'missing' | 'file' | 'directory'
  assertReadableWritable(filePath: string): void
  validateExistingLibrary(filePath: string): Promise<{ libraryId: string }>
}

type SelectedLocation = {
  configuredPath: string
  resolvedPath: string
  source: 'config' | 'environment' | 'default'
  expectedLibraryId?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isUnavailableError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : ''
  return code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' || code === 'ENOENT'
}

function parseConfig(
  raw: string,
  configPath: string,
): SelectedLocation | Extract<LibraryLocationState, { kind: 'invalid' }> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    return { kind: 'invalid', configuredPath: configPath, reason: `资料库配置 JSON 已损坏：${errorMessage(error)}` }
  }
  if (typeof value !== 'object' || value === null) {
    return { kind: 'invalid', configuredPath: configPath, reason: '资料库配置格式无效' }
  }
  const record = value as Record<string, unknown>
  if (typeof record.libraryPath !== 'string' || record.libraryPath.trim() === '') {
    return { kind: 'invalid', configuredPath: configPath, reason: '资料库配置缺少有效的 libraryPath' }
  }
  if (record.libraryId !== undefined && (typeof record.libraryId !== 'string' || record.libraryId.trim() === '')) {
    return { kind: 'invalid', configuredPath: record.libraryPath, reason: '资料库配置中的 libraryId 无效' }
  }
  return {
    configuredPath: record.libraryPath,
    resolvedPath: path.resolve(record.libraryPath),
    source: 'config',
    expectedLibraryId: typeof record.libraryId === 'string' ? record.libraryId : undefined,
  }
}

export async function resolveLibraryLocation(
  dependencies: LibraryLocationResolverDependencies,
): Promise<ValidatedLibraryLocation> {
  let selected: SelectedLocation
  let configKind: 'missing' | 'file' | 'directory'
  try {
    configKind = dependencies.inspectPath(dependencies.configPath)
  } catch (error) {
    return {
      kind: 'unavailable',
      configuredPath: dependencies.configPath,
      reason: `无法读取资料库配置：${errorMessage(error)}`,
    }
  }

  if (configKind !== 'missing') {
    if (configKind !== 'file') {
      return { kind: 'invalid', configuredPath: dependencies.configPath, reason: '资料库配置不是普通文件' }
    }
    try {
      const parsed = parseConfig(dependencies.readTextFile(dependencies.configPath), dependencies.configPath)
      if ('kind' in parsed) return parsed
      selected = parsed
    } catch (error) {
      return {
        kind: isUnavailableError(error) ? 'unavailable' : 'invalid',
        configuredPath: dependencies.configPath,
        reason: `无法读取资料库配置：${errorMessage(error)}`,
      }
    }
  } else if (dependencies.environmentPath?.trim()) {
    selected = {
      configuredPath: dependencies.environmentPath,
      resolvedPath: path.resolve(dependencies.environmentPath),
      source: 'environment',
    }
  } else {
    selected = {
      configuredPath: dependencies.defaultPath,
      resolvedPath: path.resolve(dependencies.defaultPath),
      source: 'default',
    }
  }

  let targetKind: 'missing' | 'file' | 'directory'
  try {
    targetKind = dependencies.inspectPath(selected.resolvedPath)
  } catch (error) {
    return { kind: 'unavailable', configuredPath: selected.configuredPath, reason: errorMessage(error) }
  }
  if (targetKind === 'missing') {
    return selected.source === 'default'
      ? { kind: 'unset' }
      : { kind: 'unavailable', configuredPath: selected.configuredPath, reason: '配置的资料库目录不存在' }
  }
  if (targetKind !== 'directory') {
    return { kind: 'invalid', configuredPath: selected.configuredPath, reason: '配置的资料库路径不是目录' }
  }
  try {
    dependencies.assertReadableWritable(selected.resolvedPath)
  } catch (error) {
    return { kind: 'unavailable', configuredPath: selected.configuredPath, reason: `资料库目录不可读写：${errorMessage(error)}` }
  }

  let manifest: { libraryId: string }
  try {
    manifest = await dependencies.validateExistingLibrary(selected.resolvedPath)
  } catch (error) {
    return {
      kind: isUnavailableError(error) ? 'unavailable' : 'needs-recovery',
      configuredPath: selected.configuredPath,
      reason: errorMessage(error),
    }
  }
  if (selected.expectedLibraryId && selected.expectedLibraryId !== manifest.libraryId) {
    return {
      kind: 'invalid',
      configuredPath: selected.configuredPath,
      reason: '资料库身份与已保存配置不一致，请明确选择正确的资料库',
    }
  }
  return {
    kind: 'ready',
    configuredPath: selected.configuredPath,
    resolvedPath: selected.resolvedPath,
    source: selected.source,
    verifiedLibraryId: manifest.libraryId,
  }
}

function inspectPath(filePath: string): 'missing' | 'file' | 'directory' {
  try {
    const stat = fs.statSync(filePath)
    if (stat.isFile()) return 'file'
    if (stat.isDirectory()) return 'directory'
    return 'file'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw error
  }
}

async function validateExistingLibrary(libraryPath: string): Promise<{ libraryId: string }> {
  const paths = getLibraryPaths(libraryPath)
  if (!fs.existsSync(paths.manifestFile)) {
    throw new Error('资料库缺少 manifest.json')
  }
  if (!fs.existsSync(paths.dbFile)) {
    throw new Error('资料库缺少 journal.db，请从备份恢复')
  }
  const candidate = new LibraryStorage(libraryPath, {
    ensureDirectories: false,
    allowCreate: false,
  })
  try {
    await candidate.open()
    const manifest: LibraryManifest = candidate.readManifest()
    assertCompatibleManifest(manifest)
    candidate.loadSnapshot()
    if (typeof manifest.libraryId !== 'string' || manifest.libraryId.length === 0) {
      throw new Error('manifest.json 缺少有效的 libraryId')
    }
    return { libraryId: manifest.libraryId }
  } finally {
    candidate.release()
  }
}

export function getValidatedLibraryLocation(): Promise<ValidatedLibraryLocation> {
  return resolveLibraryLocation({
    configPath: getConfigPath(),
    environmentPath: process.env.LINEAR_JOURNAL_LIBRARY,
    defaultPath: getDefaultLibraryPath(),
    readTextFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
    inspectPath,
    assertReadableWritable: (filePath) => fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK),
    validateExistingLibrary,
  })
}

export async function getLibraryLocationState(): Promise<LibraryLocationState> {
  const location = await getValidatedLibraryLocation()
  if (location.kind !== 'ready') return location
  const { verifiedLibraryId: _verifiedLibraryId, ...publicState } = location
  return publicState
}

export function libraryLocationError(state: Exclude<LibraryLocationState, { kind: 'ready' | 'unset' }>): Error {
  return new Error(`${state.reason}（${state.configuredPath}）`)
}
