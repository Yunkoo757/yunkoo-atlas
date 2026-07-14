import fs from 'node:fs'
import path from 'node:path'
import { SCHEMA_VERSION, type LibraryManifest, type PersistedSnapshot } from '../../src/storage/types'
import { LibraryStorage } from './storage'

function assertCompatibleManifest(value: LibraryManifest): void {
  const manifest = value as unknown as Record<string, unknown>
  if (
    !Number.isInteger(manifest.schemaVersion) ||
    Number(manifest.schemaVersion) < 1 ||
    typeof manifest.libraryId !== 'string' ||
    manifest.libraryId.length === 0
  ) {
    throw new Error('交易库清单无效或缺少必要字段')
  }
  if (Number(manifest.schemaVersion) > SCHEMA_VERSION) {
    throw new Error(
      `该交易库来自更新版本（v${manifest.schemaVersion}），当前版本仅支持至 v${SCHEMA_VERSION}`,
    )
  }
}

function canonicalLibraryPath(libraryPath: string): string {
  const resolved = path.resolve(libraryPath)
  const canonical = (() => {
    try {
      return fs.realpathSync.native(resolved)
    } catch {
      return resolved
    }
  })()
  const normalized = path.normalize(canonical)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function isSameLibraryPath(storage: LibraryStorage, libraryPath: string): boolean {
  return canonicalLibraryPath(storage.getLibraryPath()) === canonicalLibraryPath(libraryPath)
}

/** 同一路径别名或相同清单身份都代表同一个逻辑交易库。 */
export function areSameLibrary(left: LibraryStorage, right: LibraryStorage): boolean {
  if (isSameLibraryPath(left, right.getLibraryPath())) {
    return true
  }

  const readLibraryId = (storage: LibraryStorage): string | null => {
    try {
      const id = storage.readManifest().libraryId
      return typeof id === 'string' && id.length > 0 ? id : null
    } catch {
      // 当前库清单损坏时仍允许用户切往其他有效库；真实路径相同已在上方拦截。
      return null
    }
  }
  const leftId = readLibraryId(left)
  const rightId = readLibraryId(right)
  return leftId !== null && rightId !== null && leftId === rightId
}

/**
 * 候选库只有在清单与完整快照均可读取后才能进入激活阶段。
 * 新建空库没有 snapshot，返回 null 属于有效状态。
 */
export async function openValidatedLibraryCandidate(
  candidate: LibraryStorage,
): Promise<PersistedSnapshot | null> {
  try {
    await candidate.open()
    assertCompatibleManifest(candidate.readManifest())
    return candidate.loadSnapshot()
  } catch (error) {
    candidate.release()
    throw error
  }
}
