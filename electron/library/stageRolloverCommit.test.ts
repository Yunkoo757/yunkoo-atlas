import fs from 'node:fs'
import path from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function stageCommitHandlerSource(): string {
  const source = fs.readFileSync(path.resolve('electron/library/ipc.ts'), 'utf8')
  const start = source.indexOf("ipcMain.handle('stage:commitRollover'")
  const end = source.indexOf("ipcMain.handle('", start + 24)
  assert(start >= 0, 'stage:commitRollover IPC handler must exist')
  return source.slice(start, end < 0 ? source.length : end)
}

export function testStageRolloverIpcUsesOneExclusiveVerifiedCommitBoundary(): void {
  const handler = stageCommitHandlerSource()
  const exclusive = handler.indexOf('operationGate.runExclusive')
  const reload = handler.indexOf('loadSnapshot')
  const stale = handler.indexOf("reason: 'stale'")
  const backup = handler.indexOf('createBackup')
  const verify = handler.indexOf('verifyBackupAtPath')
  const validate = handler.indexOf('assertValidPersistedSnapshot')
  const save = handler.indexOf('saveSnapshot')
  assert(exclusive >= 0, 'rollover commit must enter the existing exclusive operation gate')
  assert(
    exclusive < reload && reload < stale && stale < backup && backup < verify && verify < validate && validate < save,
    'rollover commit must reload, stale-check, back up, verify, validate, then save in that order',
  )
}

export function testStageRolloverIpcMapsEveryDurabilityFailureWithoutRawPaths(): void {
  const handler = stageCommitHandlerSource()
  for (const reason of ['stale', 'backup-failed', 'validation-failed', 'write-failed']) {
    assert(handler.includes(`reason: '${reason}'`), `rollover IPC must map ${reason}`)
  }
  assert(!handler.includes('getLibraryPath() }'), 'rollover result must not return a library path')
  assert(!handler.includes('backupPath,'), 'rollover result must not return a backup path')
  assert(handler.includes("beginOperation('stage-rollover'"), 'rollover must emit a dedicated sanitized operation log')
}

export function testPreloadExposesOnlyTypedStageCommitInvoke(): void {
  const preload = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
  const bridge = fs.readFileSync(path.resolve('src/types/journalBridge.ts'), 'utf8')
  assert(
    preload.includes("commitStageRollover: (input) => ipcRenderer.invoke('stage:commitRollover', input)"),
    'preload must expose the single typed stage commit invoke',
  )
  assert(bridge.includes('commitStageRollover(input: StageRolloverCommitInput)'), 'JournalBridge must declare the typed invoke')
  assert(!preload.includes('stage:createBackup'), 'renderer must not receive a stage backup primitive')
  assert(!preload.includes('stage:verifyBackup'), 'renderer must not receive a stage verification primitive')
}
