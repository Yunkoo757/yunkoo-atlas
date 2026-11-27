import fs from 'node:fs'
import path from 'node:path'
import type { EventEmitter } from 'node:events'
import type { SnapshotEnvelope } from '../../src/storage/adapter'
import type { PersistedSnapshot } from '../../src/storage/types'
import { LibraryStorage } from './storage'

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

/**
 * 候选库只有在清单与完整快照均可读取后才能进入激活阶段。
 * 新建空库没有 snapshot，返回 null 属于有效状态。
 */
export async function openValidatedLibraryCandidate(
  candidate: LibraryStorage,
  expectedLibraryId?: string,
): Promise<SnapshotEnvelope & { libraryId: string }> {
  try {
    await candidate.open(expectedLibraryId)
    const { libraryId } = candidate.readManifest(expectedLibraryId)
    return { ...candidate.loadSnapshotEnvelope(), libraryId }
  } catch (error) {
    candidate.release()
    throw error
  }
}

export type StorageRecoveryRenderer = Pick<EventEmitter, 'on' | 'once' | 'removeListener'> & {
  isDestroyed(): boolean
  reload(): void
}

/**
 * 恢复期间必须等到主框架新文档完成提交，旧 renderer 才不再能发出尾部写 IPC。
 * did-start-navigation 与子框架事件都不是可释放 exclusive gate 的屏障。
 */
export function reloadRendererAfterStorageRecovery(
  sender: StorageRecoveryRenderer,
  timeoutMs = 5_000,
  observers: {
    onMainFrameNavigationStarted?: () => void
    onMainFrameNavigationCommitted?: () => void
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (sender.isDestroyed()) {
      reject(new Error('资料库已重新打开，但当前界面已经关闭'))
      return
    }

    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const cleanup = () => {
      if (timeout !== null) clearTimeout(timeout)
      sender.removeListener('did-start-navigation', onDidStartNavigation)
      sender.removeListener('did-navigate', onDidNavigate)
      sender.removeListener('did-fail-load', onDidFailLoad)
      sender.removeListener('destroyed', onDestroyed)
      sender.removeListener('render-process-gone', onRenderProcessGone)
      sender.removeListener('will-prevent-unload', onWillPreventUnload)
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }
    const observe = (callback: (() => void) | undefined) => {
      try {
        callback?.()
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const onDidStartNavigation = (
      _event: unknown,
      _url: string,
      _isInPlace: boolean,
      isMainFrame: boolean,
    ) => {
      if (isMainFrame) observe(observers.onMainFrameNavigationStarted)
    }
    const onDidNavigate = () => {
      observe(observers.onMainFrameNavigationCommitted)
      if (!settled) finish()
    }
    const onDidFailLoad = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame) return
      finish(new Error(`资料库已重新打开，但界面刷新失败（${errorCode}: ${errorDescription}）`))
    }
    const onDestroyed = () => finish(new Error('资料库已重新打开，但当前界面已经关闭'))
    const onRenderProcessGone = () => finish(new Error('资料库已重新打开，但界面进程在刷新时退出'))
    const onWillPreventUnload = () => finish(new Error('资料库已重新打开，但当前界面阻止了刷新'))

    sender.on('did-start-navigation', onDidStartNavigation)
    sender.once('did-navigate', onDidNavigate)
    sender.on('did-fail-load', onDidFailLoad)
    sender.once('destroyed', onDestroyed)
    sender.once('render-process-gone', onRenderProcessGone)
    sender.once('will-prevent-unload', onWillPreventUnload)
    timeout = setTimeout(
      () => finish(new Error('资料库已重新打开，但主界面未在时限内完成刷新')),
      timeoutMs,
    )

    try {
      sender.reload()
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/**
 * 从当前资料库的耐久文件重新建立主进程 storage 生命周期。
 * 旧实例可能携带 indeterminate recovery lock，因此候选必须是不同对象，
 * 并且只有 fresh disk load 与 identity 校验通过后才能激活和刷新 renderer。
 */
export async function recoverLibraryStorageLifecycle(input: {
  current: LibraryStorage | null
  libraryPath?: string
  expectedLibraryId?: string
  createCandidate: (libraryPath: string) => LibraryStorage
  activateCandidate: (candidate: LibraryStorage) => void
  reloadRenderer: () => void | Promise<void>
}): Promise<{ snapshot: PersistedSnapshot | null; storage: LibraryStorage }> {
  const expectedLibraryId = input.expectedLibraryId ?? input.current?.readManifest().libraryId
  if (!expectedLibraryId) throw new Error('资料库恢复缺少可验证的身份')
  const libraryPath = input.current?.getLibraryPath() ?? input.libraryPath
  if (!libraryPath) throw new Error('资料库恢复缺少可重新打开的路径')
  const candidate = input.createCandidate(libraryPath)
  if (input.current && candidate === input.current) {
    throw new Error('资料库恢复必须创建新的主进程 storage 实例')
  }

  const { snapshot } = await openValidatedLibraryCandidate(candidate, expectedLibraryId)
  let activated = false
  try {
    input.activateCandidate(candidate)
    activated = true
    input.current?.release()
    await input.reloadRenderer()
    return { snapshot, storage: candidate }
  } catch (error) {
    if (!activated) candidate.release()
    throw error
  }
}
