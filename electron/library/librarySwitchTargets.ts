import fs from 'node:fs'
import type { LibrarySwitchMode } from '../../src/types/journalBridge'
import { isSameDirectory } from './paths'
import { openValidatedLibraryCandidate } from './libraryActivation'
import { LibraryIdentityMismatchError } from './libraryIdentity'
import { getLibraryPaths } from './paths'
import type { LibraryStorage } from './storage'

type Selection = { path: string; mode: LibrarySwitchMode }
export type PreparedLibraryTarget =
  | { mode: 'create'; path: string }
  | { mode: 'open'; path: string; libraryId: string }

type OpenStorage = (path: string, options: { ensureDirectories: boolean; allowCreate: boolean }) => LibraryStorage

function resolveTarget(selection: Selection, source: LibraryStorage | null): string {
  if (!selection.path.trim()) throw new Error('请选择有效的交易库目录')
  const { root, manifestFile } = getLibraryPaths(selection.path)
  if (selection.mode === 'create') {
    const stat = fs.lstatSync(root, { throwIfNoEntry: false })
    if (stat && !stat.isDirectory()) throw new Error('新交易库位置必须是普通目录')
    if (stat && fs.readdirSync(root).length) throw new Error('新交易库只能创建在空目录中，请选择空目录或新文件夹')
  } else if (selection.mode !== 'open' || !fs.existsSync(manifestFile)) {
    throw new Error('所选目录中没有找到交易库 (manifest.json)')
  }
  if (source && isSameDirectory(source.getLibraryPath(), root)) throw new Error('所选目录已经是当前交易库')
  return root
}

/** 准备时只保留所选位置和身份。激活时重新开库，读取该库当时的快照与版本。 */
export class LibrarySwitchTargets {
  constructor(private readonly createStorage: OpenStorage) {}

  async prepare(selection: Selection, source: LibraryStorage): Promise<PreparedLibraryTarget> {
    if (selection.mode === 'create') return { mode: 'create', path: resolveTarget(selection, source) }
    const opened = await this.open(selection, source)
    try {
      return { mode: 'open', path: opened.candidate.getLibraryPath(), libraryId: opened.libraryId }
    } finally {
      opened.candidate.release()
    }
  }

  async open(selection: Selection | PreparedLibraryTarget, source: LibraryStorage | null) {
    const root = resolveTarget(selection, source)
    const create = selection.mode === 'create'
    const candidate = this.createStorage(root, { ensureDirectories: create, allowCreate: create })
    const expected = 'libraryId' in selection ? selection.libraryId : undefined
    const verified = await openValidatedLibraryCandidate(candidate, expected).catch(error => {
      if (expected !== undefined && error instanceof LibraryIdentityMismatchError) {
        throw new Error('所选目录中的交易库已变化，请重新选择')
      }
      throw error
    })
    if (source?.getOpenedTarget().libraryId === verified.libraryId) {
      candidate.release()
      throw new Error('所选目录已经是当前交易库')
    }
    return verified
  }
}
