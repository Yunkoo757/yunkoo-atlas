import { flushPersistNow } from '@/storage/persist'
import { waitForPendingStorageOperations } from '@/storage/pendingOperations'

let interactionLockDepth = 0
let releaseGlobalInteractionLock: (() => void) | null = null

/** 整库替换期间冻结界面，避免用户输入落在旧库与新库的交界处。 */
export function lockStorageCutoverInteraction(): () => void {
  interactionLockDepth += 1
  if (interactionLockDepth === 1 && typeof document !== 'undefined' && typeof window !== 'undefined') {
    const root = document.getElementById('root')
    const bodyChildren = [...document.body.children] as HTMLElement[]
    const previousInert = bodyChildren.map((element) => element.hasAttribute('inert'))
    const previousBusy = root?.getAttribute('aria-busy') ?? null
    bodyChildren.forEach((element) => element.setAttribute('inert', ''))
    root?.setAttribute('aria-busy', 'true')

    const blockInteraction = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const blockedEvents = ['keydown', 'pointerdown', 'mousedown', 'touchstart', 'paste', 'drop', 'submit']
    blockedEvents.forEach((name) => window.addEventListener(name, blockInteraction, true))
    releaseGlobalInteractionLock = () => {
      blockedEvents.forEach((name) => window.removeEventListener(name, blockInteraction, true))
      bodyChildren.forEach((element, index) => {
        if (!previousInert[index]) element.removeAttribute('inert')
      })
      if (previousBusy === null) root?.removeAttribute('aria-busy')
      else root?.setAttribute('aria-busy', previousBusy)
    }
  }

  let released = false
  return () => {
    if (released) return
    released = true
    interactionLockDepth = Math.max(0, interactionLockDepth - 1)
    if (interactionLockDepth === 0) {
      releaseGlobalInteractionLock?.()
      releaseGlobalInteractionLock = null
    }
  }
}

export function isStorageCutoverInteractionLocked(): boolean {
  return interactionLockDepth > 0
}

/** 等待粘贴图片等尾随回写，再把稳定的旧库快照真正写盘。 */
export async function flushStorageBeforeCutover(): Promise<void> {
  await waitForPendingStorageOperations()
  await flushPersistNow()
}
