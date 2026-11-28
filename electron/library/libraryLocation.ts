import type { LibraryLocationState } from '../../src/types/journalBridge'
import fs from 'node:fs'
import path from 'node:path'
import { LibraryIdentityMismatchError, type LibraryTarget } from './libraryIdentity'
import { LibraryStorage } from './storage'
import { openValidatedLibraryCandidate } from './libraryActivation'
import electronRuntime from 'electron'
import { fsyncDirectorySync, writeFileAtomicallySync } from './atomicFile'
import { isSameDirectory } from './paths'
import { OperationalError } from '../../src/lib/operationalError'

const CONFIG_FILE = 'library-config.json'
const electronApp =
  typeof electronRuntime === 'object' && electronRuntime !== null && 'app' in electronRuntime
    ? (electronRuntime as { app?: { getPath(name: 'userData' | 'documents'): string } }).app
    : undefined

function requireAppPath(name: 'userData' | 'documents'): string {
  if (!electronApp) throw new Error('Electron app paths are unavailable')
  return electronApp.getPath(name)
}

function getConfigPath(): string {
  return path.join(requireAppPath('userData'), CONFIG_FILE)
}

export class UnconfirmedLibraryConfigError extends Error {
  constructor(readonly cause: unknown) {
    super('资料库位置写入结果未确认，请重新打开资料库核对')
  }
}

export function saveLibraryConfig(cfg: LibraryTarget): void {
  const configFile = getConfigPath()
  const bytes = Buffer.from(JSON.stringify(cfg, null, 2), 'utf8')
  let replaced = false
  try {
    writeFileAtomicallySync(configFile, bytes, undefined, undefined, () => { replaced = true })
  } catch (error) {
    if (!replaced) throw error
    // rename 已完成。独立确认目录同步及已发布内容，避免把新位置误报为旧位置。
    try {
      fsyncDirectorySync(path.dirname(configFile))
      if (fs.readFileSync(configFile).equals(bytes)) return
    } catch (verificationError) {
      throw new UnconfirmedLibraryConfigError(verificationError)
    }
    throw new UnconfirmedLibraryConfigError(error)
  }
}

type LibraryLocation<T> =
  | Exclude<LibraryLocationState, { kind: 'ready' }>
  | (Extract<LibraryLocationState, { kind: 'ready' }> & { opened: T })

interface LocationFiles {
  configPath: string
  environmentPath?: string
  defaultPath: string
  readTextFile(filePath: string): string
  inspectPath(filePath: string): 'missing' | 'file' | 'directory'
  assertReadableWritable(filePath: string): void
}

export interface LibraryLocationResolverDependencies<T> extends LocationFiles {
  openLibrary(filePath: string, expectedLibraryId?: string): Promise<T>
}

type SelectedLocation = {
  configuredPath: string
  resolvedPath: string
  source: 'config' | 'environment' | 'default'
  expectedLibraryId?: string
}

function userFacingReason(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return /[\u3400-\u9fff]/.test(message) ? message : fallback
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
  } catch {
    return { kind: 'invalid', configuredPath: configPath, reason: '资料库配置 JSON 已损坏，请重新选择资料库' }
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

function selectLibraryLocation(
  dependencies: LocationFiles,
  expected?: LibraryTarget,
): SelectedLocation | Extract<LibraryLocationState, { kind: 'invalid' | 'unavailable' }> {
  let selected: SelectedLocation
  let configKind: 'missing' | 'file' | 'directory'
  try {
    configKind = dependencies.inspectPath(dependencies.configPath)
  } catch {
    return {
      kind: 'unavailable',
      configuredPath: dependencies.configPath,
      reason: '无法读取资料库配置，请检查文件权限',
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
        reason: userFacingReason(error, '无法读取资料库配置，请检查文件权限'),
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

  if (!expected) return selected
  if (!isSameDirectory(selected.resolvedPath, expected.libraryPath) ||
      (selected.expectedLibraryId !== undefined && selected.expectedLibraryId !== expected.libraryId)) {
    return { kind: 'invalid', configuredPath: selected.configuredPath, reason: '资料库位置或身份已变化，请重新打开后再恢复' }
  }
  return { ...selected, expectedLibraryId: expected.libraryId }
}

export async function resolveLibraryLocation<T>(
  dependencies: LibraryLocationResolverDependencies<T>,
  expected?: LibraryTarget,
): Promise<LibraryLocation<T>> {
  const selected = selectLibraryLocation(dependencies, expected)
  if ('kind' in selected) return selected
  let targetKind: 'missing' | 'file' | 'directory'
  try {
    targetKind = dependencies.inspectPath(selected.resolvedPath)
  } catch (error) {
    return {
      kind: 'unavailable',
      configuredPath: selected.configuredPath,
      reason: userFacingReason(error, '无法访问资料库目录，请检查位置与权限'),
    }
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
    return {
      kind: 'unavailable',
      configuredPath: selected.configuredPath,
      reason: userFacingReason(error, '资料库目录不可读写，请检查磁盘与文件夹权限'),
    }
  }

  let opened: T
  try {
    opened = await dependencies.openLibrary(selected.resolvedPath, selected.expectedLibraryId)
  } catch (error) {
    if (error instanceof LibraryIdentityMismatchError) {
      return { kind: 'invalid', configuredPath: selected.configuredPath, reason: error.message }
    }
    return {
      kind: isUnavailableError(error) ? 'unavailable' : 'needs-recovery',
      configuredPath: selected.configuredPath,
      reason: userFacingReason(error, '资料库内容无法读取，请从备份恢复或选择其他资料库'),
    }
  }
  return {
    kind: 'ready',
    configuredPath: selected.configuredPath,
    resolvedPath: selected.resolvedPath,
    source: selected.source,
    opened,
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

type LocationPaths = Pick<LocationFiles, 'configPath' | 'environmentPath' | 'defaultPath'>

function locationFiles(paths: LocationPaths = {
  configPath: getConfigPath(),
  environmentPath: process.env.TRADER_ATLAS_LIBRARY,
  defaultPath: path.join(requireAppPath('documents'), 'Trader Atlas'),
}): LocationFiles {
  return {
    ...paths,
    readTextFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
    inspectPath,
    assertReadableWritable: (filePath) => fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK),
  }
}

export function assertConfiguredLibraryTarget(target: LibraryTarget): void {
  const selected = selectLibraryLocation(locationFiles(), target)
  if ('kind' in selected) throw libraryLocationError(selected)
}

export function openConfiguredLibrary(
  createStorage: (filePath: string, options: { ensureDirectories: false; allowCreate: false }) => LibraryStorage,
  expected?: LibraryTarget,
  paths?: LocationPaths,
) {
  return resolveLibraryLocation({
    ...locationFiles(paths),
    openLibrary: (filePath, expectedId) => openValidatedLibraryCandidate(
      createStorage(filePath, { ensureDirectories: false, allowCreate: false }), expectedId,
    ),
  }, expected)
}

export async function getLibraryLocationState(expected?: LibraryTarget): Promise<LibraryLocationState> {
  const location = await openConfiguredLibrary((filePath, options) => new LibraryStorage(filePath, options), expected)
  if (location.kind !== 'ready') return location
  const { opened, ...state } = location
  opened.candidate.release()
  return state
}

export function libraryLocationError(state: Exclude<LibraryLocationState, { kind: 'ready' | 'unset' }>): Error {
  return new OperationalError(
    state.kind === 'unavailable'
      ? 'library-location-unavailable'
      : 'library-location-invalid',
    `${state.reason}（${state.configuredPath}）`,
  )
}
