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
import { LibraryStorage } from './storage'
import { exportJournalZip, importJournalZipToPath } from './journalZip'
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
import { LibraryOperationGate } from './sessionGate'
import {
  areSameLibrary,
  assertCompatibleManifest,
  isSameLibraryPath,
  openValidatedLibraryCandidate,
} from './libraryActivation'
import { randomUUID } from 'node:crypto'
import { assertExitWithinDeadline, releaseThenFinalizeWithRollback } from '../quitCoordinator'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'

let storage: LibraryStorage | null = null
let openingStorage: Promise<LibraryStorage> | null = null
let autoBackupStarted = false
const assetPurgeAuthorizations = new Map<string, { token: string; signature: string; createdAt: number }>()
let exitPreparedStorage: LibraryStorage | null = null
const operationGate = new LibraryOperationGate()

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
      const candidate = new LibraryStorage(location.resolvedPath, {
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
  finalize: () => void,
): Promise<void> {
  await operationGate.runExclusive(async () => {
    assertExitWithinDeadline(signal, deadlineAt)
    const current = exitPreparedStorage
    if (!current) {
      finalize()
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
          startAutoBackup(current)
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
  return operationGate.run(async () => operation(await ensureStorage()))
}

function bufferFromPayload(data: ArrayBuffer | Uint8Array | number[]): Buffer {
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (data instanceof Uint8Array) return Buffer.from(data)
  return Buffer.from(data)
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function reopenStorageWithAutoBackup(): Promise<LibraryStorage> {
  const location = await getValidatedLibraryLocation()
  if (location.kind === 'unset') throw new Error('尚未配置交易库')
  if (location.kind !== 'ready') throw libraryLocationError(location)
  const reopened = new LibraryStorage(location.resolvedPath, {
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
    startAutoBackup(reopened)
  } catch (error) {
    reopened.release()
    throw error
  }
  storage = reopened
  autoBackupStarted = true
  return reopened
}

function resolveLibrarySwitchPath(libPath: string, mode: LibrarySwitchMode): string {
  if (!libPath.trim()) throw new Error('请选择有效的交易库目录')
  const resolvedPath = path.resolve(libPath)
  const manifestFile = path.join(resolvedPath, 'manifest.json')
  const dbFile = path.join(resolvedPath, 'journal.db')

  if (mode === 'create' && (fs.existsSync(manifestFile) || fs.existsSync(dbFile))) {
    throw new Error('所选目录已经包含交易库，请改用“打开现有库”')
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

  const candidate = new LibraryStorage(resolvedPath, {
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
      startAutoBackup(previous)
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
    startAutoBackup(candidate)
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
  if (preparingLibrarySwitch || activatingLibrarySwitch || preparedLibrarySwitch) {
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
      return activateLibraryCandidate(fresh)
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

export function registerLibraryIpc(): void {
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

  ipcMain.handle('storage:open', async () => withStorage(async (lib) => {
    // 首次打开时启动自动备份（幂等防护）
    if (!autoBackupStarted) {
      startAutoBackup(lib)
      autoBackupStarted = true
    }
    return true
  }))

  ipcMain.handle('storage:getManifest', async () => withStorage((lib) => lib.readManifest()))

  ipcMain.handle('storage:loadSnapshot', async () => withStorage((lib) => lib.loadSnapshot()))

  ipcMain.handle('storage:saveSnapshot', async (_e, snapshot) => withStorage((lib) => {
    lib.saveSnapshot(snapshot)
    return true
  }))

  ipcMain.handle('storage:saveAsset', async (_e, payload: { data: ArrayBuffer; mime: string }) => withStorage(async (lib) => {
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

  ipcMain.handle('storage:prepareAssetPurgeRecovery', async (_e, preview) => operationGate.runExclusive(async () => {
    const win = BrowserWindow.getFocusedWindow()
    const date = new Date().toISOString().slice(0, 10)
    const options = {
      title: '导出永久清理恢复归档',
      defaultPath: path.join(app.getPath('documents'), `linear-journal-before-cleanup-${date}.journal.zip`),
      filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
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
      createdAt: Date.now(),
    })
    return { authorization: token, path: result.filePath }
  }))

  ipcMain.handle('storage:commitAssetPurge', async (_e, payload) => operationGate.runExclusive(async () => {
    if (process.env.ATLAS_ENABLE_ASSET_PURGE_COMMIT !== 'true') {
      throw new Error('当前发布阶段仅开放附件清理 dry-run，永久删除已在主进程边界关闭')
    }
    const prepared = assetPurgeAuthorizations.get(payload.preview.operationId)
    assetPurgeAuthorizations.delete(payload.preview.operationId)
    if (
      !prepared ||
      !payload.authorization ||
      prepared.token !== payload.authorization ||
      prepared.signature !== JSON.stringify(payload.preview) ||
      Date.now() - prepared.createdAt > 15 * 60_000
    ) {
      throw new Error('附件清理缺少与本次预览绑定的恢复归档授权')
    }
    const lib = await ensureStorage()
    return lib.commitAssetPurge(payload.preview)
  }))

  ipcMain.handle('storage:cancelAssetPurge', async (_e, operationId: string) => withStorage((lib) => {
    assetPurgeAuthorizations.delete(operationId)
    lib.cancelAssetPurge(operationId)
    return true
  }))

  ipcMain.handle('storage:importAssets', async (_e, assets: { id: string; mime: string; data: string }[]) => withStorage((lib) => {
    for (const a of assets) {
      assertSafeAssetId(a.id)
      const bin = Buffer.from(a.data, 'base64')
      lib.importAsset(a.id, a.mime, bin)
    }
    return true
  }))

  ipcMain.handle('storage:commitImport', async (_e, payload: {
    snapshot: Parameters<LibraryStorage['saveSnapshot']>[0]
    assets: { id: string; mime: string; data: string }[]
    options?: { pruneUnreferenced?: boolean }
  }) => operationGate.runExclusive(async () => {
    const lib = await ensureStorage()
    const assets = payload.assets.map((asset) => {
      assertSafeAssetId(asset.id)
      return {
        id: asset.id,
        mime: asset.mime,
        buffer: Buffer.from(asset.data, 'base64'),
      }
    })
    await lib.commitImport(payload.snapshot, assets, payload.options)
    return true
  }))

  ipcMain.handle('journal:exportZip', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const date = new Date().toISOString().slice(0, 10)
    const options = {
      title: '导出交易库',
      defaultPath: path.join(app.getPath('documents'), `linear-journal-${date}.journal.zip`),
      filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { ok: false as const }
    await withStorage((lib) => exportJournalZip(lib, result.filePath!))
    return { ok: true as const, path: result.filePath }
  })

  // ---- 备份 ----
  ipcMain.handle('backup:create', async () => withStorage((lib) => {
    const result = createBackup(lib)
    if (result) {
      rotateBackups(ensureLibraryDirs(lib.getLibraryPath()).backups)
    }
    return result
  }))

  ipcMain.handle('backup:list', async () => withStorage((lib) => {
    return listBackupsAtPath(lib.getLibraryPath())
  }))

  ipcMain.handle('backup:verify', async (_e, fileName: string) => withStorage((lib) => {
    return verifyBackupAtPath(lib.getLibraryPath(), fileName)
  }))

  ipcMain.handle('backup:restore', async (_e, fileName: string) => {
    try {
      return await operationGate.runExclusive(async () => {
        const current = await ensureStorage()
        const libraryPath = current.getLibraryPath()
        const verification = await verifyBackupAtPath(libraryPath, fileName)
        if (verification.status !== 'verified') return false
        // 在覆盖资料库前创建一个包含原图的完整恢复点。
        if (!createBackup(current)) return false
        stopAutoBackup()
        autoBackupStarted = false
        current.close()
        storage = null

        const ok = restoreBackupAtPath(libraryPath, fileName)
        // 无论恢复是否成功，都重新打开资料库并重建自动备份计时器。
        const reopened = await reopenStorageWithAutoBackup()
        rotateBackups(ensureLibraryDirs(libraryPath).backups)
        if (!ok) return false
        const restoredSnapshot = reopened.loadSnapshot()
        if (restoredSnapshot) return restoredSnapshot
        if (!verification.emptyLibrary) return false
        const emptySnapshot = createEmptyPersistedSnapshot()
        reopened.saveSnapshot(emptySnapshot)
        return emptySnapshot
      })
    } catch (error) {
      safeConsoleError('backup-restore-failed', error)
      return false
    }
  })

  ipcMain.handle('backup:delete', async (_e, fileName: string) => {
    return withStorage((lib) => deleteBackupAtPath(lib.getLibraryPath(), fileName))
  })

  ipcMain.handle('backup:stats', async () => withStorage((lib) => {
    return getBackupStatsAtPath(lib.getLibraryPath())
  }))

  // 启动自动备份（15 分钟 + 退出前）
  ipcMain.handle('backup:startAuto', async () => withStorage((lib) => {
    startAutoBackup(lib)
    return true
  }))

  ipcMain.handle('journal:importZip', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: OpenDialogOptions = {
      title: '导入交易库',
      filters: [{ name: 'Journal Archive', extensions: ['journal.zip', 'zip'] }],
      properties: ['openFile'],
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false as const, canceled: true as const }
    }

    const selectedArchive = result.filePaths[0]
    const confirmationOptions = {
      type: 'warning' as const,
      title: '替换当前交易库？',
      message: '导入归档会覆盖当前交易库',
      detail: `将使用“${path.basename(selectedArchive)}”替换当前交易、策略、设置与附件。此操作完成后无法直接撤销，请先确认已保留需要的备份。`,
      buttons: ['取消', '替换交易库'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }
    const confirmation = win
      ? await dialog.showMessageBox(win, confirmationOptions)
      : await dialog.showMessageBox(confirmationOptions)
    if (confirmation.response !== 1) {
      return { ok: false as const, canceled: true as const }
    }

    try {
      return await operationGate.runExclusive(async () => {
        const current = await ensureStorage()
        const libraryPath = current.getLibraryPath()
        stopAutoBackup()
        current.close()
        storage = null

        try {
          await importJournalZipToPath(libraryPath, selectedArchive)
        } catch (err) {
          safeConsoleError('journal-import-failed', err)
          const message = toErrorMessage(err)
          try {
            await reopenStorageWithAutoBackup()
          } catch (reopenErr) {
            safeConsoleError('journal-reopen-after-import-failed', reopenErr)
            return {
              ok: false as const,
              error: `${message}; failed to reopen current library: ${toErrorMessage(reopenErr)}`,
            }
          }
          return { ok: false as const, error: message }
        }

        const reopened = await reopenStorageWithAutoBackup()
        return { ok: true as const, snapshot: reopened.loadSnapshot() }
      })
    } catch (err) {
      return { ok: false as const, error: toErrorMessage(err) }
    }
  })
}

export function resetStorageForTests(): void {
  clearPreparedLibrarySwitch()
  preparingLibrarySwitch = false
  activatingLibrarySwitch = false
  if (storage) storage.close()
  storage = null
  openingStorage = null
}
