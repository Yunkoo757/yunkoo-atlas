import type { LibraryImportAsset, LibraryImportOptions } from '../../src/storage/adapter'
import { isAssetPurgeCommitEnabled } from '../../src/config/assetPurge'
import { exportVerifiedPurgeArchive } from './assetPurgeRecovery'
import {
  ipcMain,
  dialog,
  BrowserWindow,
  app,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { safeConsoleError } from '../diagnosticSanitizer'
import { JournalImportPreviews } from './journalImportPreviews'
import { LibraryStorage } from './storage'
import { exportJournalZip, installPreparedLibraryAtPath } from './journalZip'
import { ensureLibraryDirs } from './paths'
import {
  getLibraryLocationState,
  getValidatedLibraryLocation,
  libraryLocationError,
  saveLibraryConfig,
  UnconfirmedLibraryConfigError,
} from './libraryLocation'
import {
  createBackup,
  createRotatedBackup,
  deleteBackupAtPath,
  getBackupStatsAtPath,
  listBackupsAtPath,
  verifyBackupAtPath,
} from './backup'
import { assertSafeAssetId } from '../../src/storage/assetId'
import { LibraryBusyError, LibraryOperationGate } from './sessionGate'
import { LibraryAutoBackup } from './autoBackup'
import { LibraryWriterSessions, type WriterGrant } from './writerSession'
import {
  isSameLibraryPath,
  openValidatedLibraryCandidate,
  reloadRendererAfterStorageRecovery,
  recoverLibraryStorageLifecycle,
} from './libraryActivation'
import { LibrarySwitchTargets } from './librarySwitchTargets'
import { LibrarySwitchRequests } from './librarySwitchRequests'
import { randomUUID } from 'node:crypto'
import { assertExitWithinDeadline, releaseThenFinalizeWithRollback } from '../quitCoordinator'
import { createVerifiedRestorePoint, restoreLibraryBackup } from './backupRestore'
import { beginOperation, type OperationLogHandle } from '../operationLogger'
import { assertValidPersistedSnapshot } from '../../src/storage/snapshotValidation'
import type {
  LibraryActivationResult,
  LibrarySwitchMode,
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
  matchesStagedJournalArchive,
  matchesPreparedImportSource,
  recoverPreparedImportCommitFailure,
} from './preparedImportSource'

let storage: LibraryStorage | null = null
let openingStorage: Promise<LibraryStorage> | null = null
let exitPreparedStorage: LibraryStorage | null = null
const operationGate = new LibraryOperationGate()
const writers = new LibraryWriterSessions()

const journalImportPreviews = new JournalImportPreviews()

const autoBackup = new LibraryAutoBackup(operationGate, () => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('backup:auto-failed')
  }
})

const switchTargets = new LibrarySwitchTargets(createRuntimeLibraryStorage)

const switchRequests = new LibrarySwitchRequests()
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
    openingStorage = openConfiguredStorage('startup').finally(() => {
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
    let restartAutoBackup = false
    await releaseThenFinalizeWithRollback(
      () => {
        restartAutoBackup = autoBackup.stop()
        if (storage === current) storage = null
        exitPreparedStorage = null
        current.release()
      },
      finalize,
      async () => {
        await current.open()
        storage = current
        if (restartAutoBackup) autoBackup.start(current)
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

// 诊断读取不能中断提交或抢在独占操作之前打开资料库。
function readLogRevision(lib: LibraryStorage): number | null {
  try { return lib.getSnapshotRevision() } catch { return null }
}

async function withLoggedExclusiveStorage<T>(
  kind: 'import' | 'archive',
  stage: string,
  failureStage: string,
  work: (lib: LibraryStorage, operation: OperationLogHandle) => Promise<T>,
): Promise<T> {
  let operation: OperationLogHandle | undefined
  try {
    return await operationGate.runExclusive(async () => {
      const lib = await ensureStorage()
      operation = beginOperation(kind, { stage, revisionBefore: readLogRevision(lib) })
      return work(lib, operation)
    })
  } catch (error) {
    // 获取锁或打开资料库失败时也保留一对事件，版本未知。
    const log = operation ?? beginOperation(kind, { stage })
    log.failure(error, { stage: failureStage })
    throw error
  }
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

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function closeStorageForRestore(current: LibraryStorage): void {
  autoBackup.stop()
  current.close()
  storage = null
}

async function openConfiguredStorage(mode: 'startup' | 'restore'): Promise<LibraryStorage> {
  const location = await getValidatedLibraryLocation()
  if (location.kind === 'unset') throw new Error('尚未配置交易库，请先选择或创建交易库目录')
  if (location.kind !== 'ready') throw libraryLocationError(location)
  const candidate = createRuntimeLibraryStorage(location.resolvedPath, { ensureDirectories: false, allowCreate: false })
  await openValidatedLibraryCandidate(candidate, location.verifiedLibraryId)
  try {
    ensureLibraryDirs(location.resolvedPath)
    if (mode === 'restore') autoBackup.start(candidate)
    storage = candidate
    return candidate
  } catch (error) {
    candidate.release()
    throw error
  }
}

async function reopenAfterRestoreFailure(): Promise<LibraryStorage> {
  try {
    return await openConfiguredStorage('restore')
  } catch (firstError) {
    safeConsoleError('backup-reopen-first-attempt-failed', firstError)
    return openConfiguredStorage('restore')
  }
}

function activateLibraryCandidate(
  prepared: Awaited<ReturnType<typeof switchTargets.open>>,
): LibraryActivationResult {
  const { candidate, libraryId, snapshot } = prepared
  const previous = storage
  let startBackup: () => void
  try {
    startBackup = autoBackup.prepare(candidate)
  } catch (error) {
    candidate.release()
    return { ok: false, error: `候选交易库不可用：${toErrorMessage(error)}` }
  }

  const libraryPath = candidate.getLibraryPath()
  try {
    saveLibraryConfig({ libraryPath, libraryId })
  } catch (error) {
    candidate.release()
    if (error instanceof UnconfirmedLibraryConfigError) {
      // 旧凭据只认原实例。下一次开库必须从当前配置重新验证位置与身份。
      autoBackup.stop()
      storage = null
      previous?.release()
      safeConsoleError('library-location-commit-unconfirmed', error.cause)
      return { ok: false, requiresReload: true, error: error.message }
    }
    return { ok: false, error: `无法保存交易库位置：${toErrorMessage(error)}` }
  }

  storage = candidate
  startBackup()
  try {
    previous?.release()
  } catch (error) {
    safeConsoleError('library-release-after-cutover-failed', error)
  }
  return { ok: true, path: libraryPath, snapshot }
}

async function switchActiveLibrary(
  libPath: string,
  mode: LibrarySwitchMode,
): Promise<LibraryActivationResult> {
  try {
    return activateLibraryCandidate(await switchTargets.open({ path: libPath, mode }, storage))
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) }
  }
}

async function prepareActiveLibrarySwitch(
  libPath: string,
  mode: LibrarySwitchMode,
  event: IpcMainInvokeEvent,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  if (storageRecoveryInProgress) return { ok: false, error: '已有交易库切换正在进行，请稍后再试' }
  try {
    const token = await switchRequests.prepare(event.sender, () => withStorage(async sourceStorage => ({
      sourceStorage,
      target: await switchTargets.prepare({ path: libPath, mode }, sourceStorage),
    })))
    return { ok: true, token }
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) }
  }
}

async function activatePreparedLibrarySwitch(
  token: string,
  writerToken: string,
  event: IpcMainInvokeEvent,
): Promise<
  | (Extract<LibraryActivationResult, { ok: true }> & { writerGrant: WriterGrant; revision: number })
  | Extract<LibraryActivationResult, { ok: false }>
> {
  try {
    return await switchRequests.activate(event.sender.id, token, prepared => operationGate.runExclusive(async () => {
      const current = await ensureStorage()
      if (current !== prepared.sourceStorage) {
        return { ok: false as const, error: '当前交易库已变化，请重新执行切换' }
      }
      writers.assert(event, writerToken, current)
      const fresh = await switchTargets.open(prepared.target, current)
      try {
        writers.assert(event, writerToken, current)
      } catch (error) {
        fresh.candidate.release()
        throw error
      }
      const result = activateLibraryCandidate(fresh)
      if (!result.ok) return result
      return { ...result, revision: fresh.revision, writerGrant: writers.grant(event, fresh.candidate) }
    }))
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) }
  }
}

async function recoverActiveStorageLifecycle(
  event: IpcMainInvokeEvent,
): Promise<StorageRecoveryResult> {
  if (
    storageRecoveryInProgress ||
    switchRequests.busy ||
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

      // 恢复失败时旧实例可能仍被锁定，只有成功激活的实例可重新备份。
      autoBackup.stop()
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
          autoBackup.start(candidate)
          storage = candidate
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
  ipcMain.handle('library:getStatus', () => operationGate.run(getLibraryLocationState))

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

  ipcMain.handle('library:activatePrepared', async (event, token: string, writerToken: string) => {
    return activatePreparedLibrarySwitch(token, writerToken, event)
  })

  ipcMain.handle('library:cancelPrepared', async (event, token: string) => {
    return switchRequests.cancel(event.sender.id, token)
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
    autoBackup.start(lib)
    return {
      ok: true,
      revision: lib.getSnapshotRevision(),
      writerGrant: writers.grant(event, lib),
    }
  }))

  ipcMain.handle('storage:getManifest', async () => withStorage((lib) => lib.readManifest()))

  ipcMain.handle('storage:loadSnapshot', async () => withStorage(lib => lib.loadSnapshotEnvelope()))

  ipcMain.handle('storage:getSnapshotRevision', async () => withStorage((lib) => lib.getSnapshotRevision()))

  ipcMain.handle('storage:saveSnapshot', async (event, payload) => withStorage((lib) => {
    writers.assert(event, payload?.writerToken, lib)
    lib.saveSnapshot(payload.snapshot, payload.expectedRevision)
    return { revision: lib.getSnapshotRevision() }
  }))

  ipcMain.handle('storage:recover', async (event) => recoverActiveStorageLifecycle(event))

  ipcMain.handle('stage:commitRollover', async (
    event,
    payload: { input: StageRolloverCommitInput; writerToken: string },
  ) => {
    return operationGate.runExclusive(async () => {
      const active = await ensureStorage()
      writers.assert(event, payload?.writerToken, active)
      const input = payload.input
      const revisionBefore = readLogRevision(active)
      const operation = beginOperation('stage-rollover', { stage: 'reload', revisionBefore })
      let result: StageRolloverCommitResult
      try {
        result = await commitDueStageRollover(input, {
          storage: active,
          createBackup: (lib) => createBackup(lib),
          verifyBackup: (lib, backupReference) => verifyBackupAtPath(
            lib.getLibraryPath(),
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

      if (result.ok) {
        const revision = active.getSnapshotRevision()
        operation.success({ stage: 'committed', code: 'stage-rollover-committed', revisionAfter: revision })
        return { ...result, revisionBefore, revision }
      }
      operation.failure(
        { code: `stage-rollover-${result.reason}` },
        { stage: result.reason, code: `stage-rollover-${result.reason}` },
      )
      return result
    })
  })

  ipcMain.handle('storage:saveAsset', async (event, payload: { data: ArrayBuffer; mime: string; writerToken: string }) => withStorage(async (lib) => {
    writers.assert(event, payload.writerToken, lib)
    const id = await lib.saveAssetAsync(
      bufferFromPayload(payload.data),
      payload.mime,
    )
    return id
  }))

  ipcMain.handle('storage:getAssetBytes', async (_e, id: string) => withStorage((lib) => lib.getAssetBytes(id)))

  ipcMain.handle('storage:getAssetStats', async (_e, ids: string[]) => withStorage((lib) => lib.getAssetStats(ids)))

  ipcMain.handle('storage:listAssetRecords', async () => withStorage((lib) => lib.listAssetRecords()))

  ipcMain.handle('storage:previewAssetPurge', (event, writerToken) => withStorage(lib => {
    writers.assert(event, writerToken, lib)
    return lib.previewAssetPurge()
  }))

  ipcMain.handle('storage:prepareAssetPurgeRecovery', async (event, payload) => operationGate.runExclusive(async () => {
    const preview = payload.preview
    const lib = await ensureStorage()
    writers.assert(event, payload.writerToken, lib)
    let operation: OperationLogHandle | undefined
    try {
      const recovery = await lib.prepareAssetPurgeRecovery(preview, async () => {
        const win = BrowserWindow.fromWebContents(event.sender)
        const date = new Date().toISOString().slice(0, 10)
        const options = {
          title: '导出永久清理恢复归档',
          defaultPath: path.join(app.getPath('documents'), `trader-atlas-before-cleanup-${date}.journal.zip`),
          filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
        }
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
        return result.canceled ? null : result.filePath ?? null
      }, destination => {
        operation = beginOperation('archive', {
          operationId: preview.operationId, actionId: preview.operationId,
          stage: 'export-recovery', revisionBefore: preview.revision,
        })
        return exportVerifiedPurgeArchive(lib, destination)
      })
      operation?.success({ stage: 'verified', revisionAfter: preview.revision })
      return recovery
    } catch (error) {
      operation?.failure(error, { stage: 'export-recovery' })
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
        if (!isAssetPurgeCommitEnabled(process.env.ATLAS_ENABLE_ASSET_PURGE_COMMIT)) {
          throw new Error('附件永久清理已在主进程边界关闭')
        }
        const lib = await ensureStorage()
        writers.assert(event, payload.writerToken, lib)
        return withStorageRecoveryNotification(() => lib.commitAssetPurge(payload.preview, payload.authorization), notifyStorageRecoveryRequired)
      })
      operation.success({ stage: 'committed', revisionAfter: result.revision })
      return result
    } catch (error) {
      operation.failure(error, { stage: 'commit' })
      throw error
    }
  })

  ipcMain.handle('storage:cancelAssetPurge', (event, payload) => {
    // 只撤销内存中的预览，连文件选择器持有独占写锁时也必须能退出。
    if (!storage) return false
    writers.assert(event, payload.writerToken, storage)
    storage.cancelAssetPurge(payload.operationId)
    return true
  })

  ipcMain.handle('storage:importAssets', async (event, payload: { assets: { id: string; mime: string; data: string }[]; writerToken: string }) => withStorage((lib) => {
    writers.assert(event, payload.writerToken, lib)
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
    assets: LibraryImportAsset[]
    options?: LibraryImportOptions
    expectedRevision: number
    writerToken: string
  }) => {
    return withStorageRecoveryNotification(
      () => withLoggedExclusiveStorage('import', 'validate', 'commit', async (lib, operation) => {
        writers.assert(event, payload.writerToken, lib)
        const assets = payload.assets.map((asset) => {
          assertSafeAssetId(asset.id)
          return {
            id: asset.id,
            mime: asset.mime,
            inlineImage: asset.inlineImage,
            buffer: Buffer.from(asset.data, 'base64'),
          }
        })
        await lib.commitImport(payload.snapshot, assets, {
          ...payload.options,
          expectedSnapshotRevision: payload.expectedRevision,
        })
        const revision = lib.getSnapshotRevision()
        operation.success({ stage: 'committed', revisionAfter: revision })
        return { ok: true, revision }
      }),
      notifyStorageRecoveryRequired,
    )
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
    return withLoggedExclusiveStorage('archive', 'export', 'export', async (lib, operation) => {
      await exportJournalZip(lib, result.filePath!)
      operation.success({ stage: 'committed' })
      return { ok: true as const, path: result.filePath }
    })
  })

  // ---- 备份 ----
  ipcMain.handle('backup:create', async (event, writerToken: string) => operationGate.tryRunExclusive(async () => {
    const lib = await ensureStorage()
    writers.assert(event, writerToken, lib)
    return createRotatedBackup(lib)
  }))

  ipcMain.handle('backup:list', async () => withStorage((lib) => {
    return listBackupsAtPath(lib.getLibraryPath())
  }))

  ipcMain.handle('backup:verify', async (_e, fileName: string) => operationGate.tryRunExclusive(async () => {
    const lib = await ensureStorage()
    return verifyBackupAtPath(lib.getLibraryPath(), fileName)
  }))

  ipcMain.handle('backup:restore', async (event, payload: { fileName: string; writerToken: string }) => {
    let writerGrant: WriterGrant | undefined
    const result = await restoreLibraryBackup(payload.fileName, {
      withExclusiveWriter: work => operationGate.runExclusive(async () => {
        const current = await ensureStorage()
        writers.assert(event, payload.writerToken, current)
        const receipt = await work(current)
        if (storage && storage !== current && (receipt.ok || !receipt.committed)) {
          writerGrant = writers.grant(event, storage)
        }
        return receipt
      }),
      close: closeStorageForRestore,
      reopen: reopenAfterRestoreFailure,
      notifyRecoveryRequired: notifyStorageRecoveryRequired,
    })
    return { ...result, writerGrant }
  })

  ipcMain.handle('backup:delete', async (event, payload: { fileName: string; writerToken: string }) => {
    return operationGate.tryRunExclusive(async () => {
      const lib = await ensureStorage()
      writers.assert(event, payload.writerToken, lib)
      return deleteBackupAtPath(lib.getLibraryPath(), payload.fileName)
    })
  })

  ipcMain.handle('backup:stats', async () => withStorage((lib) => {
    return getBackupStatsAtPath(lib.getLibraryPath())
  }))

  ipcMain.handle('journal:prepareImport', (event, requestId: string) =>
    journalImportPreviews.prepare(event.sender, requestId, async () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        title: '选择要检查的交易库归档',
        filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
        properties: ['openFile'],
      }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return result.canceled ? undefined : result.filePaths[0]
    }, withStorage),
  )
  ipcMain.handle('journal:cancelPreparedImport', (event, id: string) => journalImportPreviews.cancel(id, event.sender.id))

  ipcMain.handle('journal:commitPreparedImport', async (
    event,
    payload: { token: string; writerToken: string },
  ) => operationGate.tryRunExclusive(async () => {
    const activeStorage = await ensureStorage()
    writers.assert(event, payload?.writerToken, activeStorage)
    const token = payload?.token
    const entry = journalImportPreviews.resolve(token, event.sender.id)
    if (!entry) return { ok: false as const, committed: false, error: '恢复预览不存在或不属于当前窗口', code: 'TOKEN_EXPIRED' as const }
    if (entry.state === 'expired') return { ok: false as const, committed: false, error: '恢复预览已过期，请重新选择文件', code: 'TOKEN_EXPIRED' as const }
    if (entry.state !== 'prepared') return { ok: false as const, committed: entry.state === 'consumed', error: '恢复预览已经使用或取消', code: 'TOKEN_EXPIRED' as const }
    if (!matchesStagedJournalArchive(entry.stagedArchivePath, entry.stagedArchiveSha256)) {
      entry.state = 'expired'
      entry.dispose()
      return { ok: false as const, committed: false, error: '恢复暂存文件已损坏，请重新选择归档', code: 'SOURCE_CHANGED' as const }
    }
    if (!matchesPreparedImportSource(entry.source, activeStorage)) {
      entry.state = 'expired'
      entry.dispose()
      return { ok: false as const, committed: false, error: '当前资料库已切换或重新打开，请重新检查归档', code: 'SOURCE_CHANGED' as const }
    }
    entry.state = 'committing'
    const operation = beginOperation('import', {
      stage: 'prepared-commit',
      requestId: entry.prepareRequestId,
      revisionBefore: readLogRevision(activeStorage),
    })
    let replacementCommitted = false
    try {
      const safety = await createVerifiedRestorePoint(activeStorage)
      if (!safety.ok) {
        entry.retry()
        operation.failure(new Error(safety.error), { stage: 'commit' })
        return { ok: false as const, committed: false, error: safety.error }
      }
      const libraryPath = activeStorage.getLibraryPath()
      entry.state = 'consumed'
      closeStorageForRestore(activeStorage)
      await installPreparedLibraryAtPath(libraryPath, entry.stagedLibraryRoot)
      replacementCommitted = true
      const reopened = await openConfiguredStorage('restore')
      const envelope = reopened.loadSnapshotEnvelope()
      entry.dispose()
      operation.success({ stage: 'committed', revisionAfter: envelope.revision })
      return { ok: true as const, committed: true as const, ...envelope, writerGrant: writers.grant(event, reopened) }
    } catch (error) {
      operation.failure(error, { stage: 'commit' })
      if (entry.state === 'consumed') {
        let writerGrant: WriterGrant | undefined
        const failure = await recoverPreparedImportCommitFailure({
          error,
          replacementCommitted,
          currentStorage: () => storage,
          reopen: reopenAfterRestoreFailure,
          resumeRolledBackWriter: reopened => { writerGrant = writers.grant(event, reopened) },
          invalidatePreview: entry.dispose,
          reportFailure: cause => safeConsoleError('journal-prepared-import-commit-failed', cause),
        })
        return { ...failure, writerGrant }
      }
      entry.retry()
      return { ok: false as const, committed: false, error: toErrorMessage(error) }
    }
  }).catch(error => {
    if (error instanceof LibraryBusyError) return { ok: false as const, committed: false, error: error.message, code: 'LIBRARY_BUSY' as const }
    throw error
  }))

}
