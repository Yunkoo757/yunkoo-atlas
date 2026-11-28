import type { PersistencePause } from '@/storage/persistenceController'
import { notifyStorageRecoveryRequired } from '@/lib/storageRecovery'
import { useSaveStatus } from '@/store/saveStatus'
import { disablePersistWrites, flushPersistNow, storageDocumentSignal } from '@/storage/persist'
import { waitForPendingStorageOperations } from '@/storage/pendingOperations'

let interactionLockDepth = 0
let releaseGlobalInteractionLock: (() => void) | null = null

/** 整库替换期间冻结界面，避免用户输入落在旧库与新库的交界处。 */
export function lockStorageCutoverInteraction(signal?: AbortSignal): () => void {
  signal?.throwIfAborted()
  interactionLockDepth += 1
  if (interactionLockDepth === 1 && typeof document !== 'undefined' && typeof window !== 'undefined') {
    const root = document.getElementById('root')
    const body = document.body
    const previouslyInert = body.inert
    const previousBusy = root?.getAttribute('aria-busy') ?? null
    body.inert = true
    root?.setAttribute('aria-busy', 'true')

    const blockInteraction = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const blockedEvents = ['keydown', 'pointerdown', 'mousedown', 'touchstart', 'paste', 'drop', 'submit']
    blockedEvents.forEach((name) => window.addEventListener(name, blockInteraction, true))
    releaseGlobalInteractionLock = () => {
      blockedEvents.forEach((name) => window.removeEventListener(name, blockInteraction, true))
      body.inert = previouslyInert
      if (previousBusy === null) root?.removeAttribute('aria-busy')
      else root?.setAttribute('aria-busy', previousBusy)
    }
  }

  let released = false
  const unlock = () => {
    if (released) return
    released = true
    signal?.removeEventListener('abort', unlock)
    interactionLockDepth = Math.max(0, interactionLockDepth - 1)
    if (interactionLockDepth === 0) {
      releaseGlobalInteractionLock?.()
      releaseGlobalInteractionLock = null
    }
  }
  signal?.addEventListener('abort', unlock, { once: true })
  return unlock
}

export function isStorageCutoverInteractionLocked(): boolean {
  return interactionLockDepth > 0
}

/** 等待粘贴图片等尾随回写，再把稳定的旧库快照真正写盘。 */
export async function flushStorageBeforeCutover(): Promise<void> {
  storageDocumentSignal.throwIfAborted()
  await waitForPendingStorageOperations()
  storageDocumentSignal.throwIfAborted()
  await flushPersistNow()
  storageDocumentSignal.throwIfAborted()
}

/** 磁盘状态不再可信时停止写盘并归还调用方持有的一层暂停。 */
export function haltPersistAfterCutover(pause: PersistencePause, message: string, recovery: 'reload' | 'reopen'): void {
  // 先禁止后续写入。状态订阅者即使抛错，仍要归还暂停并进入恢复界面。
  disablePersistWrites()
  try {
    pause.discardAndResume()
  } finally {
    try {
      useSaveStatus.getState().setError(message)
    } finally {
      if (recovery === 'reopen') notifyStorageRecoveryRequired(message)
      else {
        try { window.location?.reload() } catch { /* 当前宿主可能无法重新加载 */ }
      }
    }
  }
}
