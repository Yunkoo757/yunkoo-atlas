import {
  ipcMain,
  dialog,
  BrowserWindow,
  app,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type WebContents,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { safeConsoleError } from '../diagnosticSanitizer'
import { writeFileAtomicallySync } from './atomicFile'
import { LibraryStorage } from './storage'
import { exportJournalZip, importJournalZipToPath, installPreparedLibraryAtPath } from './journalZip'
import { saveLibraryConfig, ensureLibraryDirs } from './paths'
import {
  getLibraryLocationState,
  getValidatedLibraryLocation,
  libraryLocationError,
} from './libraryLocation'
import {
  createBackup,
  deleteBackupAtPath,
  getBackupStatsAtPath,
  listBackupsAtPath,
  restoreBackupAtPath,
  rotateBackups,
  startAutoBackup,
  stopAutoBackup,
  verifyBackupAtPath,
} from './backup'
import { assertSafeAssetId } from '../../src/storage/assetId'
import { LibraryBusyError, LibraryOperationGate } from './sessionGate'
import {
  areSameLibrary,
  assertCompatibleManifest,
  isSameLibraryPath,
  openValidatedLibraryCandidate,
  reloadRendererAfterStorageRecovery,
  recoverLibraryStorageLifecycle,
} from './libraryActivation'
import { createHash, randomUUID } from 'node:crypto'
import { assertExitWithinDeadline, releaseThenFinalizeWithRollback } from '../quitCoordinator'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import { beginOperation } from '../operationLogger'
import { assertValidPersistedSnapshot } from '../../src/storage/snapshotValidation'
import type {
  PreparedJournalImportPreview,
  StageRolloverCommitInput,
  StageRolloverCommitResult,
  StorageRecoveryResult,
} from '../../src/types/journalBridge'
import { commitDueStageRollover } from './stageRolloverCommit'
import {
  classifyStorageRecoveryRequired,
  withStorageRecoveryNotification,
} from './storageRecovery'
import {
  capturePreparedImportSource,
  matchesStagedJournalArchive,
  matchesPreparedImportSource,
  stagePreparedJournalArchive,
  type PreparedImportSource,
} from './preparedImportSource'

let storage: LibraryStorage | null = null
let openingStorage: Promise<LibraryStorage> | null = null
let autoBackupStarted = false
const assetPurgeAuthorizations = new Map<string, {
  token: string
  signature: string
  archivePath: string
  archiveSha256: string
  createdAt: number
}>()
let exitPreparedStorage: LibraryStorage | null = null
const operationGate = new LibraryOperationGate()
let writerSession: { token: string; ownerWebContentsId: number; lifecycleId: string } | null = null

function issueWriterSession(event: IpcMainInvokeEvent, library: LibraryStorage): string {
  if (writerSession && writerSession.ownerWebContentsId !== event.sender.id) {
    throw new Error('交易库已由另一个窗口占用，请关闭重复窗口后重试')
  }
  writerSession = {
    token: randomUUID(),
    ownerWebContentsId: event.sender.id,
    lifecycleId: library.getLifecycleId(),
  }
  return writerSession.token
}

function assertWriterSession(event: IpcMainInvokeEvent, token: unknown, library: LibraryStorage): void {
  if (
    !writerSession ||
    typeof token !== 'string' ||
    token !== writerSession.token ||
    event.sender.id !== writerSession.ownerWebContentsId ||
    library.getLifecycleId() !== writerSession.lifecycleId
  ) {
    throw new Error('资料库写入会话已失效，已阻止旧窗口写入；请重新打开资料库')
  }
}

function adoptWriterSessionLifecycle(ownerWebContentsId: number, library: LibraryStorage): void {
  if (writerSession?.ownerWebContentsId === ownerWebContentsId) {
    writerSession.lifecycleId = library.getLifecycleId()
  }
}

type PreparedImportState = 'preparing' | 'prepared' | 'committing' | 'consumed' | 'cancelled' | 'expired'
interface PreparedJournalImport {
  token: string
  prepareRequestId: string
  ownerWebContentsId: number
  archiveFileName: string
  archiveModifiedAt: number
  stagedArchivePath: string
  stagedArchiveSha256: string
  stagedLibraryRoot: string
  source: PreparedImportSource<LibraryStorage>
  stagingRoot: string
  expiresAt: number
  state: PreparedImportState
  preview?: PreparedJournalImportPreview
}
const PREPARED_IMPORT_TTL_MS = 15 * 60 * 1000
const preparedJournalImports = new Map<string, PreparedJournalImport>()
const preparedImportRequests = new Map<string, PreparedJournalImport>()

function cleanupPreparedImport(entry: PreparedJournalImport): void {
  if (entry.state === 'committing') return
  try { fs.rmSync(entry.stagingRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch { /* 下次启动由临时目录维护清理 */ }
  preparedJournalImports.delete(entry.token)
  preparedImportRequests.delete(entry.prepareRequestId)
}

function resolvePreparedImport(token: string, ownerWebContentsId: number): PreparedJournalImport | null {
  const entry = preparedJournalImports.get(token)
  if (!entry || entry.ownerWebContentsId !== ownerWebContentsId) return null
  if (entry.state === 'prepared' && Date.now() > entry.expiresAt) {
    entry.state = 'expired'
    cleanupPreparedImport(entry)
  }
  return entry
}

function startLibraryAutoBackup(target: LibraryStorage): void {
  startAutoBackup(target, undefined, undefined, () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send('backup:auto-failed')
    }
  }, async (activeStorage) => {
    try {
      return await operationGate.tryRunExclusive(async () => {
        const result = createBackup(activeStorage)
        if (!result) return 'failed' as const
        rotateBackups(ensureLibraryDirs(activeStorage.getLibraryPath()).backups)
        return 'created' as const
      })
    } catch (error) {
      if (error instanceof LibraryBusyError) return 'skipped' as const
      return 'failed' as const
    }
  })
}

type LibrarySwitchMode = 'create' | 'open'

interface PreparedLibrarySwitch {
  token: string
  sourceStorage: LibraryStorage
  resolvedPath: string
  mode: LibrarySwitchMode
  ownerWebContentsId: number
  expiresAt: number
  disposeLease?: () => void
}

const PREPARED_LIBRARY_TTL_MS = 2 * 60 * 1000
let preparedLibrarySwitch: PreparedLibrarySwitch | null = null
let preparingLibrarySwitch = false
let activatingLibrarySwitch = false
let storageRecoveryInProgress = false

type LibraryStorageOptions = NonNullable<ConstructorParameters<typeof LibraryStorage>[1]>

interface StorageRecoveryQaController {
  armIndeterminateSnapshotWrite(): void
  holdNextRecoveryBeforeRendererReload(): void
  releaseRecoveryRendererReload(): void
  getState(): {
    lifecycleId: string | null
    recoveryRequired: boolean
    recoveryInProgress: boolean
    faultArmed: boolean
    rendererReloadHeld: boolean
    mainFrameNavigationStarted: boolean
    mainFrameNavigationCommitted: boolean
    exclusiveAtNavigationStart: boolean | null
    exclusiveAtMainFrameCommit: boolean | null
  }
}

declare global {
  // 仅用于非 packaged 的真实 Electron 生命周期故障注入；不经过 preload 暴露给 renderer。
  var __TRADER_ATLAS_STORAGE_RECOVERY_QA__: StorageRecoveryQaController | undefined
}

const storageRecoveryQaEnabled =
  process.env.TRADER_ATLAS_STORAGE_RECOVERY_QA === '1' && !app.isPackaged
let storageRecoveryQaFaultArmed = false
let storageRecoveryQaHoldRequested = false
let storageRecoveryQaReloadHeld = false
let releaseStorageRecoveryQaReload: (() => void) | null = null
let storageRecoveryQaMainFrameNavigationStarted = false
let storageRecoveryQaMainFrameNavigationCommitted = false
let storageRecoveryQaExclusiveAtNavigationStart: boolean | null = null
let storageRecoveryQaExclusiveAtMainFrameCommit: boolean | null = null

async function waitForStorageRecoveryQaReloadRelease(): Promise<void> {
  if (!storageRecoveryQaEnabled || !storageRecoveryQaHoldRequested) return
  storageRecoveryQaReloadHeld = true
  try {
    await new Promise<void>((resolve) => { releaseStorageRecoveryQaReload = resolve })
  } finally {
    storageRecoveryQaHoldRequested = false
    storageRecoveryQaReloadHeld = false
    releaseStorageRecoveryQaReload = null
  }
}

function createRuntimeLibraryStorage(
  libraryPath: string,
  options: LibraryStorageOptions = {},
): LibraryStorage {
  const afterSnapshotAtomicReplace = options.afterSnapshotAtomicReplace
  return new LibraryStorage(libraryPath, {
    ...options,
    afterSnapshotAtomicReplace: (targetPath) => {
      afterSnapshotAtomicReplace?.(targetPath)
      if (!storageRecoveryQaEnabled || !storageRecoveryQaFaultArmed) return
      storageRecoveryQaFaultArmed = false
      // 制造“既非 previous 也非 candidate”的有效 SQLite 尾随字节状态，迫使旧实例 fail closed。
      fs.appendFileSync(targetPath, Buffer.from([0xff]))
      throw new Error('injected indeterminate snapshot write for Electron lifecycle QA')
    },
  })
}

function registerStorageRecoveryQaController(): void {
  if (!storageRecoveryQaEnabled) return
  Object.defineProperty(globalThis, '__TRADER_ATLAS_STORAGE_RECOVERY_QA__', {
    configurable: true,
    enumerable: false,
    value: {
      armIndeterminateSnapshotWrite: () => {
        if (!storage) throw new Error('无法在没有活动 storage 时注入恢复故障')
        if (storage.isRecoveryRequired()) throw new Error('当前 storage 已经处于恢复锁定状态')
        storageRecoveryQaFaultArmed = true
      },
      holdNextRecoveryBeforeRendererReload: () => {
        if (storageRecoveryInProgress) throw new Error('恢复已开始，无法再安装 reload hold')
        storageRecoveryQaHoldRequested = true
      },
      releaseRecoveryRendererReload: () => {
        if (!releaseStorageRecoveryQaReload) throw new Error('恢复 reload 当前未被 QA hold')
        releaseStorageRecoveryQaReload()
      },
      getState: () => ({
        lifecycleId: storage?.getLifecycleId() ?? null,
        recoveryRequired: storage?.isRecoveryRequired() ?? false,
        recoveryInProgress: storageRecoveryInProgress,
        faultArmed: storageRecoveryQaFaultArmed,
        rendererReloadHeld: storageRecoveryQaReloadHeld,
        mainFrameNavigationStarted: storageRecoveryQaMainFrameNavigationStarted,
        mainFrameNavigationCommitted: storageRecoveryQaMainFrameNavigationCommitted,
        exclusiveAtNavigationStart: storageRecoveryQaExclusiveAtNavigationStart,
        exclusiveAtMainFrameCommit: storageRecoveryQaExclusiveAtMainFrameCommit,
      }),
    } satisfies StorageRecoveryQaController,
  })
}

async function ensureStorage(): Promise<LibraryStorage> {
  if (exitPreparedStorage) throw new Error('应用正在安全退出，交易库已停止接受新操作')
  if (storage) return storage
  if (!openingStorage) {
    openingStorage = (async () => {
      const location = await getValidatedLibraryLocation()
      if (location.kind === 'unset') {
        throw new Error('尚未配置交易库，请先选择或创建交易库目录')
      }
      if (location.kind !== 'ready') throw libraryLocationError(location)
      const candidate = createRuntimeLibraryStorage(location.resolvedPath, {
        ensureDirectories: false,
        allowCreate: false,
      })
      try {
        await candidate.open()
        const manifest = candidate.readManifest()
        assertCompatibleManifest(manifest)
        if (manifest.libraryId !== location.verifiedLibraryId) {
          throw new Error('资料库身份在打开期间发生变化，已阻止进入工作区')
        }
        candidate.loadSnapshot()
        ensureLibraryDirs(location.resolvedPath)
        storage = candidate
        return candidate
      } catch (error) {
        candidate.release()
        throw error
      }
    })().finally(() => {
      openingStorage = null
    })
  }
  return openingStorage
}

export async function createVerifiedExitBackup(signal?: AbortSignal): Promise<void> {
  await operationGate.runExclusive(async () => {
    if (signal?.aborted) throw new Error('退出协调等待超时，已取消退出')
    const current = storage ?? (openingStorage ? await openingStorage : null)
    if (!current) return
    exitPreparedStorage = current
    try {
      const allowEmptySnapshot = current.loadSnapshot() === null
      const backupPath = createBackup(current, { emptyLibrary: allowEmptySnapshot })
      if (!backupPath) throw new Error('无法创建退出前恢复点')
      const verification = await verifyBackupAtPath(
        current.getLibraryPath(),
        path.basename(backupPath),
      )
      if (verification.status !== 'verified') {
        throw new Error(verification.error ?? '退出前恢复点验证失败')
      }
    } catch (error) {
      exitPreparedStorage = null
      throw error
    }
  }, signal)
}

export async function commitStorageExit(
  signal: AbortSignal,
  deadlineAt: number,
  finalize: () => Promise<void> | void,
): Promise<void> {
  await operationGate.runExclusive(async () => {
    assertExitWithinDeadline(signal, deadlineAt)
    const current = exitPreparedStorage
    if (!current) {
      await finalize()
      return
    }
    const restartAutoBackup = autoBackupStarted
    await releaseThenFinalizeWithRollback(
      () => {
        stopAutoBackup()
        autoBackupStarted = false
        if (storage === current) storage = null
        exitPreparedStorage = null
        current.release()
      },
      finalize,
      async () => {
        await current.open()
        storage = current
        if (restartAutoBackup) {
          startLibraryAutoBackup(current)
          autoBackupStarted = true
        }
      },
    )
  }, signal)
}

export function cancelStorageExitPreparation(): void {
  exitPreparedStorage = null
}

function withStorage<T>(operation: (lib: LibraryStorage) => T | Promise<T>): Promise<T> {
  return withStorageRecoveryNotification(
    () => operationGate.run(async () => operation(await ensureStorage())),
    notifyStorageRecoveryRequired,
  )
}

function notifyStorageRecoveryRequired(
  state: NonNullable<ReturnType<typeof classifyStorageRecoveryRequired>>,
): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('storage:recovery-required', state)
  }
}

function bufferFromPayload(data: ArrayBuffer | Uint8Array | number[]): Buffer {
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (data instanceof Uint8Array) return Buffer.from(data)
  return Buffer.from(data)
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function reopenStorageWithAutoBackup(): Promise<LibraryStorage> {
  const location = await getValidatedLibraryLocation()
  if (location.kind === 'unset') throw new Error('尚未配置交易库')
  if (location.kind !== 'ready') throw libraryLocationError(location)
  const reopened = createRuntimeLibraryStorage(location.resolvedPath, {
    ensureDirectories: false,
    allowCreate: false,
  })
  try {
    await reopened.open()
    const manifest = reopened.readManifest()
    assertCompatibleManifest(manifest)
    if (manifest.libraryId !== location.verifiedLibraryId) {
      throw new Error('资料库身份在重新打开期间发生变化，已阻止继续写入')
    }
    reopened.loadSnapshot()
    ensureLibraryDirs(location.resolvedPath)
    startLibraryAutoBackup(reopened)
  } catch (error) {
    reopened.release()
    throw error
  }
  storage = reopened
  autoBackupStarted = true
  return reopened
}

async function reopenAfterRestoreFailure(): Promise<LibraryStorage> {
  try {
    return await reopenStorageWithAutoBackup()
  } catch (firstError) {
    safeConsoleError('backup-reopen-first-attempt-failed', firstError)
    return reopenStorageWithAutoBackup()
  }
}

function resolveLibrarySwitchPath(libPath: string, mode: LibrarySwitchMode): string {
  if (!libPath.trim()) throw new Error('请选择有效的交易库目录')
  const resolvedPath = path.resolve(libPath)
  const manifestFile = path.join(resolvedPath, 'manifest.json')
  const dbFile = path.join(resolvedPath, 'journal.db')

  if (mode === 'create' && fs.existsSync(resolvedPath)) {
    const stat = fs.lstatSync(resolvedPath)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('新交易库位置必须是普通目录')
    if (fs.readdirSync(resolvedPath).length > 0) {
      throw new Error('新交易库只能创建在空目录中，请选择空目录或新文件夹')
    }
  }
  if (mode === 'open' && !fs.existsSync(manifestFile)) {
    throw new Error('所选目录中没有找到交易库 (manifest.json)')
  }
  return resolvedPath
}

async function openLibrarySwitchCandidate(
  libPath: string,
  mode: LibrarySwitchMode,
): Promise<{
  candidate: LibraryStorage
  resolvedPath: string
  snapshot: ReturnType<LibraryStorage['loadSnapshot']>
}> {
  const resolvedPath = resolveLibrarySwitchPath(libPath, mode)

  const candidate = createRuntimeLibraryStorage(resolvedPath, {
    ensureDirectories: mode === 'create',
    allowCreate: mode === 'create',
  })
  try {
    const snapshot = await openValidatedLibraryCandidate(candidate)
    return { candidate, resolvedPath, snapshot }
  } catch (err) {
    candidate.release()
    throw err
  }
}

function activateLibraryCandidate(
  prepared: Awaited<ReturnType<typeof openLibrarySwitchCandidate>>,
): { ok: true; snapshot: ReturnType<LibraryStorage['loadSnapshot']> } | { ok: false; error: string } {
  const { candidate, resolvedPath, snapshot } = prepared

  if (storage && areSameLibrary(storage, candidate)) {
    candidate.release()
    return { ok: false, error: '所选目录已经是当前交易库' }
  }

  const previous = storage
  const restorePreviousBackup = (): string | null => {
    stopAutoBackup()
    autoBackupStarted = false
    if (!previous) return null
    try {
      startLibraryAutoBackup(previous)
      autoBackupStarted = true
      return null
    } catch (error) {
      return toErrorMessage(error)
    }
  }

  try {
    // 打开已有库时，只有完整校验通过后才补齐运行期目录。
    ensureLibraryDirs(resolvedPath)
    // 先确认候选库的备份目录可用；此时旧库仍保持打开，可完整回滚。
    startLibraryAutoBackup(candidate)
    autoBackupStarted = true
  } catch (error) {
    const rollbackError = restorePreviousBackup()
    candidate.release()
    return {
      ok: false,
      error: rollbackError
        ? `候选交易库不可用：${toErrorMessage(error)}；自动备份恢复失败：${rollbackError}`
        : `候选交易库不可用：${toErrorMessage(error)}`,
    }
  }

  try {
    saveLibraryConfig({
      libraryPath: resolvedPath,
      libraryId: candidate.readManifest().libraryId,
    })
  } catch (error) {
    const rollbackError = restorePreviousBackup()
    candidate.release()
    return {
      ok: false,
      error: rollbackError
        ? `无法保存交易库位置：${toErrorMessage(error)}；自动备份恢复失败：${rollbackError}`
        : `无法保存交易库位置：${toErrorMessage(error)}`,
    }
  }

  storage = candidate
  autoBackupStarted = true
  try {
    previous?.release()
  } catch (error) {
    safeConsoleError('library-release-after-cutover-failed', error)
  }
  return { ok: true, snapshot }
}

async function switchActiveLibrary(
  libPath: string,
  mode: LibrarySwitchMode,
): Promise<
  | { ok: true; snapshot: ReturnType<LibraryStorage['loadSnapshot']> }
  | { ok: false; error: string }
> {
  try {
    return activateLibraryCandidate(await openLibrarySwitchCandidate(libPath, mode))
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) }
  }
}

function clearPreparedLibrarySwitch(token?: string): PreparedLibrarySwitch | null {
  const prepared = preparedLibrarySwitch
  if (!prepared || (token && prepared.token !== token)) return null
  preparedLibrarySwitch = null
  prepared.disposeLease?.()
  return prepared
}

function attachPreparedLibraryLease(
  prepared: PreparedLibrarySwitch,
  sender: WebContents,
): void {
  const expire = () => { clearPreparedLibrarySwitch(prepared.token) }
  const timer = setTimeout(expire, PREPARED_LIBRARY_TTL_MS)
  sender.once('destroyed', expire)
  sender.once('render-process-gone', expire)
  sender.once('did-start-navigation', expire)
  prepared.disposeLease = () => {
    clearTimeout(timer)
    sender.removeListener('destroyed', expire)
    sender.removeListener('render-process-gone', expire)
    sender.removeListener('did-start-navigation', expire)
  }
}

async function prepareActiveLibrarySwitch(
  libPath: string,
  mode: LibrarySwitchMode,
  event: IpcMainInvokeEvent,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (storageRecoveryInProgress || preparingLibrarySwitch || activatingLibrarySwitch || preparedLibrarySwitch) {
    return { ok: false, error: '已有交易库切换正在进行，请稍后再试' }
  }
  preparingLibrarySwitch = true
  try {
    // 准备期间不占用 exclusive gate，旧库仍可正常保存。
    const sourceStorage = await operationGate.run(() => ensureStorage())
    const resolvedPath = resolveLibrarySwitchPath(libPath, mode)
    if (isSameLibraryPath(sourceStorage, resolvedPath)) {
      return { ok: false, error: '所选目录已经是当前交易库' }
    }

    // “打开”先做一次完整校验，但不长期缓存 DB；激活时重新打开，读取磁盘最新版本。
    if (mode === 'open') {
      const validated = await openLibrarySwitchCandidate(resolvedPath, mode)
      if (areSameLibrary(sourceStorage, validated.candidate)) {
        validated.candidate.release()
        return { ok: false, error: '所选目录已经是当前交易库' }
      }
      validated.candidate.release()
    }

    const token = randomUUID()
    const prepared: PreparedLibrarySwitch = {
      token,
      sourceStorage,
      resolvedPath,
      mode,
      ownerWebContentsId: event.sender.id,
      expiresAt: Date.now() + PREPARED_LIBRARY_TTL_MS,
    }
    preparedLibrarySwitch = prepared
    attachPreparedLibraryLease(prepared, event.sender)
    return { ok: true, token }
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) }
  } finally {
    preparingLibrarySwitch = false
  }
}

async function activatePreparedLibrarySwitch(
  token: string,
  event: IpcMainInvokeEvent,
): Promise<
  | { ok: true; snapshot: ReturnType<LibraryStorage['loadSnapshot']> }
  | { ok: false; error: string }
> {
  const prepared = preparedLibrarySwitch
  if (
    !prepared ||
    prepared.token !== token ||
    prepared.ownerWebContentsId !== event.sender.id ||
    prepared.expiresAt <= Date.now() ||
    activatingLibrarySwitch
  ) {
    if (prepared?.expiresAt && prepared.expiresAt <= Date.now()) {
      clearPreparedLibrarySwitch(prepared.token)
    }
    return { ok: false, error: '候选交易库已失效，请重新选择' }
  }
  clearPreparedLibrarySwitch(token)
  activatingLibrarySwitch = true
  try {
    return await operationGate.runExclusive(async () => {
      const current = await ensureStorage()
      if (current !== prepared.sourceStorage) {
        return { ok: false as const, error: '当前交易库已变化，请重新执行切换' }
      }
      const fresh = await openLibrarySwitchCandidate(prepared.resolvedPath, prepared.mode)
      if (areSameLibrary(current, fresh.candidate)) {
        fresh.candidate.release()
        return { ok: false as const, error: '所选目录已经是当前交易库' }
      }
      const result = activateLibraryCandidate(fresh)
      if (result.ok && storage) adoptWriterSessionLifecycle(event.sender.id, storage)
      return result
    })
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) }
  } finally {
    activatingLibrarySwitch = false
  }
}

function cancelPreparedLibrarySwitch(token: string, event: IpcMainInvokeEvent): boolean {
  if (
    !preparedLibrarySwitch ||
    preparedLibrarySwitch.token !== token ||
    preparedLibrarySwitch.ownerWebContentsId !== event.sender.id
  ) return false
  return clearPreparedLibrarySwitch(token) !== null
}

async function recoverActiveStorageLifecycle(
  event: IpcMainInvokeEvent,
): Promise<StorageRecoveryResult> {
  if (
    storageRecoveryInProgress ||
    preparingLibrarySwitch ||
    activatingLibrarySwitch ||
    preparedLibrarySwitch !== null ||
    exitPreparedStorage !== null
  ) {
    return { ok: false, code: 'busy', message: '交易库正在切换、恢复或退出，请稍后重试' }
  }

  storageRecoveryInProgress = true
  storageRecoveryQaMainFrameNavigationStarted = false
  storageRecoveryQaMainFrameNavigationCommitted = false
  storageRecoveryQaExclusiveAtNavigationStart = null
  storageRecoveryQaExclusiveAtMainFrameCommit = null
  let storageActivated = false
  try {
    return await operationGate.runExclusive(async () => {
      const current = storage ?? (openingStorage ? await openingStorage : null)

      // 自动备份不经过 operation gate；必须在任何异步定位/校验前停止旧 timer，
      // 避免它在 fresh open 期间继续访问已锁定的 sql.js 实例。
      stopAutoBackup()
      autoBackupStarted = false
      const location = await getValidatedLibraryLocation()
      if (location.kind === 'unset') throw new Error('尚未配置交易库')
      if (location.kind !== 'ready') throw libraryLocationError(location)
      if (current && !isSameLibraryPath(current, location.resolvedPath)) {
        throw new Error('活动资料库路径在恢复期间发生变化，已阻止替换 storage')
      }

      const recovered = await recoverLibraryStorageLifecycle({
        current,
        libraryPath: location.resolvedPath,
        expectedLibraryId: location.verifiedLibraryId,
        createCandidate: (libraryPath) => createRuntimeLibraryStorage(libraryPath, {
          ensureDirectories: false,
          allowCreate: false,
        }),
        activateCandidate: (candidate) => {
          startLibraryAutoBackup(candidate)
          storage = candidate
          assetPurgeAuthorizations.clear()
          autoBackupStarted = true
          storageActivated = true
        },
        reloadRenderer: async () => {
          await waitForStorageRecoveryQaReloadRelease()
          await reloadRendererAfterStorageRecovery(event.sender, 5_000, {
            onMainFrameNavigationStarted: storageRecoveryQaEnabled
              ? () => {
                  storageRecoveryQaMainFrameNavigationStarted = true
                  storageRecoveryQaExclusiveAtNavigationStart = operationGate.isExclusive()
                }
              : undefined,
            onMainFrameNavigationCommitted: storageRecoveryQaEnabled
              ? () => {
                  storageRecoveryQaMainFrameNavigationCommitted = true
                  storageRecoveryQaExclusiveAtMainFrameCommit = operationGate.isExclusive()
                }
              : undefined,
          })
        },
      })
      return { ok: true as const, snapshot: recovered.snapshot }
    })
  } catch (error) {
    return {
      ok: false,
      code: error instanceof LibraryBusyError
        ? 'busy'
        : storageActivated
          ? 'renderer-reload-failed'
          : 'reopen-failed',
      message: toErrorMessage(error),
    }
  } finally {
    storageRecoveryInProgress = false
  }
}

export function registerLibraryIpc(): void {
  registerStorageRecoveryQaController()
  // ---- 库路径引导 ----
  ipcMain.handle('library:getStatus', async () => {
    return getLibraryLocationState()
  })

  ipcMain.handle('library:pickFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = {
      title: '选择交易库目录',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('library:prepareSwitch', async (event, payload: {
    libPath: string
    mode: LibrarySwitchMode
  }) => prepareActiveLibrarySwitch(payload.libPath, payload.mode, event))

  ipcMain.handle('library:activatePrepared', async (event, token: string) => {
    return activatePreparedLibrarySwitch(token, event)
  })

  ipcMain.handle('library:cancelPrepared', async (event, token: string) => {
    return cancelPreparedLibrarySwitch(token, event)
  })

  ipcMain.handle('library:createNew', async (_e, libPath: string) => {
    try {
      return await operationGate.runExclusive(() => switchActiveLibrary(libPath, 'create'))
    } catch (error) {
      return { ok: false as const, error: toErrorMessage(error) }
    }
  })

  ipcMain.handle('library:openExisting', async (_e, libPath: string) => {
    try {
      return await operationGate.runExclusive(() => switchActiveLibrary(libPath, 'open'))
    } catch (error) {
      return { ok: false as const, error: toErrorMessage(error) }
    }
  })

  // ---- 常规 storage IPC ----
  ipcMain.handle('library:getPath', async () => withStorage((lib) => lib.getLibraryPath()))

  ipcMain.handle('storage:open', async (event) => withStorage(async (lib) => {
    // 首次打开时启动自动备份（幂等防护）
    if (!autoBackupStarted) {
      startLibraryAutoBackup(lib)
      autoBackupStarted = true
    }
    return {
      ok: true,
      writerToken: issueWriterSession(event, lib),
      snapshotRevision: lib.getSnapshotRevision(),
    }
  }))

  ipcMain.handle('storage:getManifest', async () => withStorage((lib) => lib.readManifest()))

  ipcMain.handle('storage:loadSnapshot', async () => withStorage((lib) => ({
    snapshot: lib.loadSnapshot(),
    revision: lib.getSnapshotRevision(),
  })))

  ipcMain.handle('storage:getSnapshotRevision', async () => withStorage((lib) => lib.getSnapshotRevision()))

  ipcMain.handle('storage:saveSnapshot', async (event, payload) => withStorage((lib) => {
    assertWriterSession(event, payload?.writerToken, lib)
    lib.saveSnapshot(payload.snapshot, payload.expectedRevision)
    return { revision: lib.getSnapshotRevision() }
  }))

  ipcMain.handle('storage:recover', async (event) => recoverActiveStorageLifecycle(event))

  ipcMain.handle('stage:commitRollover', async (
    event,
    payload: { input: StageRolloverCommitInput; writerToken: string },
  ): Promise<StageRolloverCommitResult> => {
    const active = await ensureStorage()
    assertWriterSession(event, payload?.writerToken, active)
    const input = payload.input
    const operation = beginOperation('stage-rollover', { stage: 'reload', revisionBefore: 0 })
    let result: StageRolloverCommitResult
    try {
      result = await commitDueStageRollover(input, {
        runExclusive: (commit) => operationGate.runExclusive(commit),
        loadStorage: () => ensureStorage(),
        createBackup: (lib) => createBackup(lib as LibraryStorage),
        verifyBackup: (lib, backupReference) => verifyBackupAtPath(
          (lib as LibraryStorage).getLibraryPath(),
          path.basename(backupReference),
        ),
        validateSnapshot: (snapshot) => {
          assertValidPersistedSnapshot(snapshot, 'Stage rollover snapshot')
        },
        now: () => new Date(),
        createStageId: () => randomUUID(),
        reportError: (event, error) => safeConsoleError(event, error),
      })
    } catch (error) {
      safeConsoleError('stage-rollover-exclusive-commit-failed', error)
      result = { ok: false, reason: 'write-failed', message: '阶段切换提交失败' }
    }

    if (result.ok) operation.success({ stage: 'committed', code: 'stage-rollover-committed' })
    else operation.failure(
      { code: `stage-rollover-${result.reason}` },
      { stage: result.reason, code: `stage-rollover-${result.reason}` },
    )
    return result
  })

  ipcMain.handle('storage:saveAsset', async (event, payload: { data: ArrayBuffer; mime: string; writerToken: string }) => withStorage(async (lib) => {
    assertWriterSession(event, payload.writerToken, lib)
    const id = await lib.saveAssetAsync(
      bufferFromPayload(payload.data),
      payload.mime,
    )
    return id
  }))

  ipcMain.handle('storage:getAssetBytes', async (_e, id: string) => withStorage((lib) => lib.getAssetBytes(id)))

  ipcMain.handle('storage:getAssetStats', async (_e, ids: string[]) => withStorage((lib) => lib.getAssetStats(ids)))

  ipcMain.handle('storage:listAssetRecords', async () => withStorage((lib) => lib.listAssetRecords()))

  ipcMain.handle('storage:previewAssetPurge', async () => withStorage((lib) => lib.previewAssetPurge()))

  ipcMain.handle('storage:prepareAssetPurgeRecovery', async (event, payload) => operationGate.runExclusive(async () => {
    const preview = payload.preview
    assertWriterSession(event, payload.writerToken, await ensureStorage())
    const win = BrowserWindow.getFocusedWindow()
    const date = new Date().toISOString().slice(0, 10)
    const options = {
      title: '导出永久清理恢复归档',
      defaultPath: path.join(app.getPath('documents'), `trader-atlas-before-cleanup-${date}.journal.zip`),
      filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const operation = beginOperation('archive', {
      operationId: preview.operationId,
      actionId: preview.operationId,
      stage: 'export-recovery',
      revisionBefore: preview.revision,
    })
    try {
      const lib = await ensureStorage()
      await exportJournalZip(lib, result.filePath!)
      const verificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-purge-recovery-'))
      try {
        await importJournalZipToPath(verificationRoot, result.filePath!)
      } finally {
        fs.rmSync(verificationRoot, { recursive: true, force: true })
      }
      const token = randomUUID()
      assetPurgeAuthorizations.set(preview.operationId, {
        token,
        signature: JSON.stringify(preview),
        archivePath: path.resolve(result.filePath!),
        archiveSha256: sha256File(result.filePath!),
        createdAt: Date.now(),
      })
      operation.success({ stage: 'verified', revisionAfter: preview.revision })
      return { authorization: token, path: result.filePath }
    } catch (error) {
      operation.failure(error, { stage: 'export-recovery' })
      throw error
    }
  }))

  ipcMain.handle('storage:commitAssetPurge', async (event, payload) => {
    const operation = beginOperation('gc', {
      operationId: payload.preview.operationId,
      actionId: payload.preview.operationId,
      stage: 'authorize',
      revisionBefore: payload.preview.revision,
    })
    try {
      const result = await operationGate.runExclusive(async () => {
        if (process.env.ATLAS_ENABLE_ASSET_PURGE_COMMIT === 'false') {
          throw new Error('附件永久清理已在主进程边界关闭')
        }
        const prepared = assetPurgeAuthorizations.get(payload.preview.operationId)
        assetPurgeAuthorizations.delete(payload.preview.operationId)
        if (
          !payload.authorization ||
          !prepared ||
          prepared.token !== payload.authorization ||
          prepared.signature !== JSON.stringify(payload.preview) ||
          Date.now() - prepared.createdAt > 15 * 60_000
        ) {
          throw new Error('附件清理缺少与本次预览绑定的恢复归档授权')
        }
        const lib = await ensureStorage()
        assertWriterSession(event, payload.writerToken, lib)
        let recoveryArchiveStat: fs.Stats
        try {
          recoveryArchiveStat = fs.lstatSync(prepared.archivePath)
        } catch {
          throw new Error('附件清理恢复归档已移动或删除，请重新导出')
        }
        if (
          !recoveryArchiveStat.isFile() ||
          recoveryArchiveStat.isSymbolicLink() ||
          sha256File(prepared.archivePath) !== prepared.archiveSha256
        ) {
          throw new Error('附件清理恢复归档在导出后发生变化，请重新导出')
        }
        const safetyBackup = createBackup(lib)
        if (!safetyBackup) throw new Error('无法创建附件清理前安全恢复点')
        const safetyVerification = await verifyBackupAtPath(
          lib.getLibraryPath(),
          path.basename(safetyBackup),
        )
        if (safetyVerification.status !== 'verified') {
          throw new Error(safetyVerification.error ?? '附件清理前安全恢复点验证失败')
        }
        return lib.commitAssetPurge(payload.preview)
      })
      operation.success({ stage: 'committed', revisionAfter: result.revision })
      return result
    } catch (error) {
      operation.failure(error, { stage: 'commit' })
      throw error
    }
  })

  ipcMain.handle('storage:cancelAssetPurge', async (event, payload) => withStorage((lib) => {
    assertWriterSession(event, payload.writerToken, lib)
    const operationId = payload.operationId as string
    assetPurgeAuthorizations.delete(operationId)
    lib.cancelAssetPurge(operationId)
    return true
  }))

  ipcMain.handle('storage:importAssets', async (event, payload: { assets: { id: string; mime: string; data: string }[]; writerToken: string }) => withStorage((lib) => {
    assertWriterSession(event, payload.writerToken, lib)
    const assets = payload.assets
    for (const a of assets) {
      assertSafeAssetId(a.id)
      const bin = Buffer.from(a.data, 'base64')
      lib.importAsset(a.id, a.mime, bin)
    }
    return true
  }))

  ipcMain.handle('storage:commitImport', async (event, payload: {
    snapshot: Parameters<LibraryStorage['saveSnapshot']>[0]
    assets: { id: string; mime: string; data: string }[]
    options?: { pruneUnreferenced?: boolean }
    expectedRevision: number
    writerToken: string
  }) => {
    const operation = beginOperation('import', { stage: 'validate', revisionBefore: 0 })
    try {
      const committed = await withStorageRecoveryNotification(
        () => operationGate.runExclusive(async () => {
          const lib = await ensureStorage()
          assertWriterSession(event, payload.writerToken, lib)
          const assets = payload.assets.map((asset) => {
            assertSafeAssetId(asset.id)
            return {
              id: asset.id,
              mime: asset.mime,
              buffer: Buffer.from(asset.data, 'base64'),
            }
          })
          await lib.commitImport(payload.snapshot, assets, {
            ...payload.options,
            expectedSnapshotRevision: payload.expectedRevision,
          })
          return { ok: true, revision: lib.getSnapshotRevision() }
        }),
        notifyStorageRecoveryRequired,
      )
      operation.success({ stage: 'committed', revisionAfter: 0 })
      return committed
    } catch (error) {
      operation.failure(error, { stage: 'commit' })
      throw error
    }
  })

  ipcMain.handle('journal:exportZip', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const date = new Date().toISOString().slice(0, 10)
    const options = {
      title: '导出交易库',
      defaultPath: path.join(app.getPath('documents'), `trader-atlas-${date}.journal.zip`),
      filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false as const }
    const operation = beginOperation('archive', { stage: 'export', revisionBefore: 0 })
    try {
      await operationGate.runExclusive(async () => {
        await exportJournalZip(await ensureStorage(), result.filePath!)
      })
      operation.success({ stage: 'committed', revisionAfter: 0 })
      return { ok: true as const, path: result.filePath }
    } catch (error) {
      operation.failure(error, { stage: 'export' })
      throw error
    }
  })

  // ---- 备份 ----
  ipcMain.handle('backup:create', async (event, writerToken: string) => operationGate.tryRunExclusive(async () => {
    const lib = await ensureStorage()
    assertWriterSession(event, writerToken, lib)
    const result = createBackup(lib)
    if (result) rotateBackups(ensureLibraryDirs(lib.getLibraryPath()).backups)
    return result
  }))

  ipcMain.handle('backup:list', async () => withStorage((lib) => {
    return listBackupsAtPath(lib.getLibraryPath())
  }))

  ipcMain.handle('backup:verify', async (_e, fileName: string) => operationGate.tryRunExclusive(async () => {
    const lib = await ensureStorage()
    return verifyBackupAtPath(lib.getLibraryPath(), fileName)
  }))

  ipcMain.handle('backup:restore', async (event, payload: { fileName: string; writerToken: string }) => {
    const { fileName } = payload
    let replacementCommitted = false
    try {
      return await withStorageRecoveryNotification(
        () => operationGate.runExclusive(async () => {
          const current = await ensureStorage()
          assertWriterSession(event, payload.writerToken, current)
          const libraryPath = current.getLibraryPath()
          const verification = await verifyBackupAtPath(libraryPath, fileName)
          if (verification.status !== 'verified') {
            return { ok: false as const, committed: false, error: verification.error }
          }
          // 在覆盖资料库前创建一个包含原图的完整恢复点。
          const safetyBackup = createBackup(current)
          if (!safetyBackup) {
            return { ok: false as const, committed: false, error: '无法创建恢复前安全备份' }
          }
          const safetyVerification = await verifyBackupAtPath(libraryPath, path.basename(safetyBackup))
          if (safetyVerification.status !== 'verified') {
            return { ok: false as const, committed: false, error: safetyVerification.error ?? '恢复前安全备份验证失败' }
          }
          stopAutoBackup()
          autoBackupStarted = false
          current.close()
          storage = null

          const ok = restoreBackupAtPath(libraryPath, fileName)
          replacementCommitted = ok
          // 无论恢复是否成功，都重新打开资料库并重建自动备份计时器。
          const reopened = await reopenAfterRestoreFailure()
          adoptWriterSessionLifecycle(event.sender.id, reopened)
          rotateBackups(ensureLibraryDirs(libraryPath).backups)
          if (!ok) return { ok: false as const, committed: false, error: '恢复操作未提交' }
          const restoredSnapshot = reopened.loadSnapshot()
          if (restoredSnapshot) return { ok: true as const, committed: true as const, snapshot: restoredSnapshot }
          if (!verification.emptyLibrary) {
            return { ok: false as const, committed: true, error: '恢复后的快照无法读取' }
          }
          const emptySnapshot = createEmptyPersistedSnapshot()
          reopened.saveSnapshot(emptySnapshot)
          return { ok: true as const, committed: true as const, snapshot: emptySnapshot }
        }),
        notifyStorageRecoveryRequired,
      )
    } catch (error) {
      safeConsoleError('backup-restore-failed', error)
      const cutoverMayHaveStarted = replacementCommitted || storage === null
      try {
        if (!storage) await reopenAfterRestoreFailure()
      } catch (reopenError) {
        safeConsoleError('backup-reopen-after-restore-failed', reopenError)
      }
      return {
        ok: false as const,
        committed: cutoverMayHaveStarted,
        error: toErrorMessage(error),
      }
    }
  })

  ipcMain.handle('backup:delete', async (event, payload: { fileName: string; writerToken: string }) => {
    return operationGate.tryRunExclusive(async () => {
      const lib = await ensureStorage()
      assertWriterSession(event, payload.writerToken, lib)
      return deleteBackupAtPath(lib.getLibraryPath(), payload.fileName)
    })
  })

  ipcMain.handle('backup:stats', async () => withStorage((lib) => {
    return getBackupStatsAtPath(lib.getLibraryPath())
  }))

  // 启动自动备份（15 分钟 + 退出前）
  ipcMain.handle('backup:startAuto', async () => withStorage((lib) => {
    startLibraryAutoBackup(lib)
    return true
  }))

  ipcMain.handle('journal:prepareImport', async (event, prepareRequestId: string) => {
    if (!prepareRequestId?.trim()) return { ok: false as const, error: '检查请求无效' }
    if (preparedImportRequests.has(prepareRequestId)) return { ok: false as const, error: '检查请求已存在' }
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: '选择要检查的交易库归档',
      filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
      properties: ['openFile'],
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return { ok: false as const, canceled: true as const }

    const archivePath = path.resolve(result.filePaths[0])
    const archiveStat = fs.lstatSync(archivePath)
    if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) return { ok: false as const, error: '归档文件必须是普通文件' }
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trader-atlas-journal-import-'))
    let staged: ReturnType<typeof stagePreparedJournalArchive>
    let sourceStorage: LibraryStorage
    try {
      staged = stagePreparedJournalArchive(archivePath, stagingRoot)
      sourceStorage = await ensureStorage()
    } catch (error) {
      fs.rmSync(stagingRoot, { recursive: true, force: true })
      return { ok: false as const, error: toErrorMessage(error) }
    }
    const entry: PreparedJournalImport = {
      token: randomUUID(),
      prepareRequestId,
      ownerWebContentsId: event.sender.id,
      archiveFileName: path.basename(archivePath),
      archiveModifiedAt: archiveStat.mtimeMs,
      ...staged,
      source: capturePreparedImportSource(sourceStorage),
      stagingRoot,
      expiresAt: Date.now() + PREPARED_IMPORT_TTL_MS,
      state: 'preparing',
    }
    preparedJournalImports.set(entry.token, entry)
    preparedImportRequests.set(prepareRequestId, entry)
    event.sender.once('destroyed', () => {
      if (entry.state === 'preparing') {
        // 解压仍可能持有 staging 中的文件句柄；只标记取消，由 prepare 的 finally 清理。
        entry.state = 'cancelled'
      } else if (entry.state === 'prepared') {
        entry.state = 'cancelled'
        cleanupPreparedImport(entry)
      }
    })
    try {
      await importJournalZipToPath(entry.stagedLibraryRoot, entry.stagedArchivePath)
      const stagedManifestPath = path.join(entry.stagedLibraryRoot, 'manifest.json')
      const stagedManifest = JSON.parse(fs.readFileSync(stagedManifestPath, 'utf8')) as Record<string, unknown>
      writeFileAtomicallySync(
        stagedManifestPath,
        JSON.stringify({ ...stagedManifest, libraryId: sourceStorage.readManifest().libraryId }, null, 2),
        'utf8',
      )
      if (entry.state === 'cancelled') return { ok: false as const, canceled: true as const }
      const stagedLibrary = new LibraryStorage(entry.stagedLibraryRoot, { ensureDirectories: false, allowCreate: false })
      let snapshot: ReturnType<LibraryStorage['loadSnapshot']>
      let assets: ReturnType<LibraryStorage['listAssetRecords']>
      try {
        await stagedLibrary.open()
        snapshot = stagedLibrary.loadSnapshot()
        if (!snapshot) throw new Error('归档没有可读取的数据快照')
        assets = stagedLibrary.listAssetRecords()
      } finally {
        stagedLibrary.release()
      }
      entry.preview = {
        token: entry.token,
        fileName: entry.archiveFileName,
        modifiedAt: archiveStat.mtimeMs,
        tradeCount: snapshot.trades.length,
        strategyCount: snapshot.strategies.length,
        attachmentCount: assets.filter((asset) => asset.state === 'healthy').length,
        attachmentBytes: assets.reduce((total, asset) => total + (asset.actualBytes ?? 0), 0),
        verification: 'verified',
        expiresAt: entry.expiresAt,
      }
      entry.state = 'prepared'
      return { ok: true as const, preview: entry.preview }
    } catch (error) {
      entry.state = 'cancelled'
      cleanupPreparedImport(entry)
      return { ok: false as const, error: toErrorMessage(error) }
    } finally {
      preparedImportRequests.delete(prepareRequestId)
      if (entry.state === 'cancelled') cleanupPreparedImport(entry)
    }
  })

  ipcMain.handle('journal:cancelPreparedImport', async (event, tokenOrRequestId: string) => {
    const entry = preparedJournalImports.get(tokenOrRequestId) ?? preparedImportRequests.get(tokenOrRequestId)
    if (!entry || entry.ownerWebContentsId !== event.sender.id) return { ok: false, state: 'missing' as const }
    if (entry.state === 'committing') return { ok: false, state: 'committing' as const }
    if (entry.state === 'cancelled' || entry.state === 'consumed' || entry.state === 'expired') {
      return { ok: true, state: 'terminal' as const }
    }
    const wasPreparing = entry.state === 'preparing'
    entry.state = 'cancelled'
    if (!wasPreparing) cleanupPreparedImport(entry)
    return { ok: true, state: 'cancelled' as const }
  })

  ipcMain.handle('journal:commitPreparedImport', async (
    event,
    payload: { token: string; writerToken: string },
  ) => {
    const activeStorage = await ensureStorage()
    assertWriterSession(event, payload?.writerToken, activeStorage)
    const token = payload?.token
    const entry = resolvePreparedImport(token, event.sender.id)
    if (!entry) return { ok: false as const, committed: false, error: '恢复预览不存在或不属于当前窗口', code: 'TOKEN_EXPIRED' as const }
    if (entry.state === 'expired') return { ok: false as const, committed: false, error: '恢复预览已过期，请重新选择文件', code: 'TOKEN_EXPIRED' as const }
    if (entry.state !== 'prepared') return { ok: false as const, committed: entry.state === 'consumed', error: '恢复预览已经使用或取消' }
    if (!matchesStagedJournalArchive(entry.stagedArchivePath, entry.stagedArchiveSha256)) {
      entry.state = 'expired'
      cleanupPreparedImport(entry)
      return { ok: false as const, committed: false, error: '恢复暂存文件已损坏，请重新选择归档', code: 'SOURCE_CHANGED' as const }
    }
    if (!matchesPreparedImportSource(entry.source, storage)) {
      entry.state = 'expired'
      cleanupPreparedImport(entry)
      return { ok: false as const, committed: false, error: '当前资料库已切换或重新打开，请重新检查归档', code: 'SOURCE_CHANGED' as const }
    }
    entry.state = 'committing'
    const operation = beginOperation('import', {
      stage: 'prepared-commit',
      requestId: entry.prepareRequestId,
      revisionBefore: 0,
    })
    let replacementCommitted = false
    try {
      const outcome = await operationGate.tryRunExclusive(async () => {
        const current = await ensureStorage()
        if (!matchesPreparedImportSource(entry.source, current)) {
          entry.state = 'expired'
          cleanupPreparedImport(entry)
          return { ok: false as const, committed: false, error: '当前资料库已切换或重新打开，请重新检查归档', code: 'SOURCE_CHANGED' as const }
        }
        const libraryPath = current.getLibraryPath()
        const safetyBackup = createBackup(current)
        if (!safetyBackup) {
          entry.state = 'prepared'
          return { ok: false as const, committed: false, error: '无法创建恢复前安全备份' }
        }
        const safetyVerification = await verifyBackupAtPath(libraryPath, safetyBackup)
        if (safetyVerification.status !== 'verified') {
          entry.state = 'prepared'
          return { ok: false as const, committed: false, error: safetyVerification.error ?? '恢复前安全备份验证失败' }
        }
        stopAutoBackup()
        autoBackupStarted = false
        entry.state = 'consumed'
        current.close()
        storage = null
        try {
          await installPreparedLibraryAtPath(libraryPath, entry.stagedLibraryRoot)
          replacementCommitted = true
          const reopened = await reopenStorageWithAutoBackup()
          adoptWriterSessionLifecycle(event.sender.id, reopened)
          const snapshot = reopened.loadSnapshot()
          cleanupPreparedImport(entry)
          return { ok: true as const, committed: true as const, snapshot }
        } catch (error) {
          if (!storage) await reopenAfterRestoreFailure()
          cleanupPreparedImport(entry)
          return { ok: false as const, committed: replacementCommitted || storage === null, error: toErrorMessage(error) }
        }
      })
      if (outcome.ok) operation.success({ stage: 'committed', revisionAfter: 0 })
      else operation.failure(new Error(outcome.error ?? '恢复未提交'), { stage: 'commit' })
      return outcome
    } catch (error) {
      operation.failure(error, { stage: 'commit' })
      if (error instanceof LibraryBusyError) {
        entry.state = 'prepared'
        return { ok: false as const, committed: false, error: error.message, code: 'LIBRARY_BUSY' as const }
      }
      entry.state = replacementCommitted ? 'consumed' : 'prepared'
      return { ok: false as const, committed: replacementCommitted, error: toErrorMessage(error) }
    }
  })

}

export function resetStorageForTests(): void {
  for (const entry of preparedJournalImports.values()) {
    if (entry.state !== 'committing') cleanupPreparedImport(entry)
  }
  preparedJournalImports.clear()
  preparedImportRequests.clear()
  clearPreparedLibrarySwitch()
  preparingLibrarySwitch = false
  activatingLibrarySwitch = false
  if (storage) storage.close()
  storage = null
  openingStorage = null
  writerSession = null
}
