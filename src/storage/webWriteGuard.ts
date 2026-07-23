import { StorageRevisionConflictError } from '@/storage/adapter'

export interface WebLockLike {
  name: string
}

export interface WebLockManagerLike {
  request(
    name: string,
    options: { mode: 'exclusive'; ifAvailable?: boolean },
    callback: (lock: WebLockLike | null) => Promise<void> | void,
  ): Promise<unknown>
}

interface BroadcastChannelLike {
  postMessage(message: unknown): void
  close(): void
  onmessage: ((event: MessageEvent<unknown>) => void) | null
}

export type WebWriteGuardState =
  | { phase: 'inactive'; lockSupported: false }
  | { phase: 'editable'; lockSupported: boolean; libraryId: string; remoteRevision?: number }
  | { phase: 'readonly'; lockSupported: true; libraryId: string; reason: 'owned-elsewhere' | 'lock-lost'; remoteRevision?: number }
  | { phase: 'requesting'; lockSupported: true; libraryId: string; remoteRevision?: number }
  | {
      phase: 'conflict'
      lockSupported: boolean
      libraryId: string
      expectedRevision: number
      actualRevision: number
    }

interface OwnershipCapabilities {
  lockManager?: WebLockManagerLike | null
  broadcastFactory?: ((name: string) => BroadcastChannelLike) | null
}

export class WebStorageWriteFrozenError extends Error {
  readonly code = 'web-storage-write-frozen'

  constructor(readonly phase: WebWriteGuardState['phase']) {
    super(`Web storage writes are frozen: ${phase}`)
    this.name = 'WebStorageWriteFrozenError'
  }
}

let state: WebWriteGuardState = { phase: 'inactive', lockSupported: false }
let lockManager: WebLockManagerLike | null = null
let channel: BroadcastChannelLike | null = null
let releaseHeldLock: (() => void) | null = null
let hasHeldWriterLock = false
let ownershipRequest: Promise<void> | null = null
let pagehideInstalled = false
const listeners = new Set<() => void>()
const tabId = crypto.randomUUID()

function setState(next: WebWriteGuardState): void {
  if (state.phase === 'conflict' && next.phase !== 'inactive') return
  state = next
  for (const listener of listeners) listener()
}

function defaultLockManager(): WebLockManagerLike | null {
  if (typeof navigator === 'undefined' || !navigator.locks) return null
  return navigator.locks as unknown as WebLockManagerLike
}

function defaultBroadcastFactory(name: string): BroadcastChannelLike {
  return new BroadcastChannel(name)
}

function postOwnership(status: 'editable' | 'released'): void {
  if (state.phase === 'inactive') return
  channel?.postMessage({ type: 'ownership', libraryId: state.libraryId, tabId, status })
}

function holdGrantedLock(libraryId: string): Promise<void> {
  hasHeldWriterLock = true
  setState({ phase: 'editable', lockSupported: true, libraryId })
  postOwnership('editable')
  return new Promise((resolve) => {
    releaseHeldLock = () => {
      releaseHeldLock = null
      hasHeldWriterLock = false
      postOwnership('released')
      resolve()
    }
  })
}

function configureBroadcast(
  libraryId: string,
  factory: ((name: string) => BroadcastChannelLike) | null,
): void {
  channel?.close()
  channel = factory?.(`linear-journal:${libraryId}:events`) ?? null
  if (!channel) return
  channel.onmessage = (event) => {
    const message = event.data
    if (!message || typeof message !== 'object') return
    const record = message as Record<string, unknown>
    if (record.libraryId !== libraryId || record.tabId === tabId) return
    if (record.type === 'revision' && typeof record.revision === 'number') {
      if (state.phase === 'editable' || state.phase === 'readonly' || state.phase === 'requesting') {
        setState({ ...state, remoteRevision: record.revision })
      }
    }
  }
}

export async function initializeWebWriterOwnership(
  libraryId: string,
  capabilities: OwnershipCapabilities = {},
): Promise<void> {
  releaseHeldLock?.()
  hasHeldWriterLock = false
  const configuredManager = capabilities.lockManager === undefined
    ? defaultLockManager()
    : capabilities.lockManager
  const configuredBroadcast = capabilities.broadcastFactory === undefined
    ? (typeof BroadcastChannel === 'undefined' ? null : defaultBroadcastFactory)
    : capabilities.broadcastFactory
  lockManager = configuredManager
  configureBroadcast(libraryId, configuredBroadcast)
  if (typeof window !== 'undefined' && !pagehideInstalled) {
    pagehideInstalled = true
    window.addEventListener('pagehide', releaseWebWriterOwnership)
  }

  if (!lockManager) {
    setState({ phase: 'editable', lockSupported: false, libraryId })
    return
  }

  await new Promise<void>((resolve) => {
    void lockManager!.request(
      `linear-journal:${libraryId}:writer`,
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock) {
          setState({ phase: 'readonly', lockSupported: true, libraryId, reason: 'owned-elsewhere' })
          resolve()
          return
        }
        resolve()
        await holdGrantedLock(libraryId)
      },
    ).catch(() => {
      setState({ phase: 'readonly', lockSupported: true, libraryId, reason: 'lock-lost' })
      resolve()
    })
  })
}

export function requestWebWriterOwnership(): Promise<void> {
  if (!lockManager || state.phase === 'inactive' || state.phase === 'conflict') return Promise.resolve()
  if (state.phase === 'editable') return Promise.resolve()
  if (ownershipRequest) return ownershipRequest
  const libraryId = state.libraryId
  setState({ phase: 'requesting', lockSupported: true, libraryId, remoteRevision: state.remoteRevision })
  ownershipRequest = new Promise<void>((resolve, reject) => {
    void lockManager!.request(
      `linear-journal:${libraryId}:writer`,
      { mode: 'exclusive' },
      async (lock) => {
        if (!lock) throw new Error('Web Lock request completed without a lock')
        resolve()
        await holdGrantedLock(libraryId)
      },
    ).catch((error) => {
      setState({ phase: 'readonly', lockSupported: true, libraryId, reason: 'lock-lost' })
      reject(error)
    }).finally(() => {
      ownershipRequest = null
    })
  })
  return ownershipRequest
}

export function releaseWebWriterOwnership(): void {
  const previous = state
  releaseHeldLock?.()
  hasHeldWriterLock = false
  if (previous.phase === 'editable' && previous.lockSupported) {
    setState({
      phase: 'readonly',
      lockSupported: true,
      libraryId: previous.libraryId,
      reason: 'lock-lost',
      remoteRevision: previous.remoteRevision,
    })
  }
}

export function reportWebRevisionConflict(error: StorageRevisionConflictError): void
export function reportWebRevisionConflict(expectedRevision: number, actualRevision: number): void
export function reportWebRevisionConflict(
  errorOrExpected: StorageRevisionConflictError | number,
  actualRevision?: number,
): void {
  if (state.phase === 'inactive') return
  const expected = typeof errorOrExpected === 'number'
    ? errorOrExpected
    : errorOrExpected.expectedRevision
  const actual = typeof errorOrExpected === 'number'
    ? actualRevision ?? expected
    : errorOrExpected.actualRevision
  state = {
    phase: 'conflict',
    lockSupported: state.lockSupported,
    libraryId: state.libraryId,
    expectedRevision: expected,
    actualRevision: actual,
  }
  for (const listener of listeners) listener()
}

export function clearWebWriteConflictAfterReload(revision: number): void {
  if (state.phase !== 'conflict') return
  state = state.lockSupported
    ? hasHeldWriterLock
      ? { phase: 'editable', lockSupported: true, libraryId: state.libraryId, remoteRevision: revision }
      : {
          phase: 'readonly',
          lockSupported: true,
          libraryId: state.libraryId,
          reason: 'lock-lost',
          remoteRevision: revision,
        }
    : { phase: 'editable', lockSupported: false, libraryId: state.libraryId, remoteRevision: revision }
  for (const listener of listeners) listener()
}

export function assertWebWriteAllowed(): void {
  if (state.phase === 'inactive' || state.phase === 'editable') return
  throw new WebStorageWriteFrozenError(state.phase)
}

export function notifyWebRevisionCommitted(revision: number): void {
  if (state.phase === 'inactive') return
  channel?.postMessage({ type: 'revision', libraryId: state.libraryId, tabId, revision })
}

export function getWebWriteGuardState(): WebWriteGuardState {
  return state
}

export function subscribeWebWriteGuard(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function resetWebWriteGuardForTests(): void {
  releaseHeldLock?.()
  channel?.close()
  channel = null
  lockManager = null
  hasHeldWriterLock = false
  ownershipRequest = null
  state = { phase: 'inactive', lockSupported: false }
  for (const listener of listeners) listener()
}
