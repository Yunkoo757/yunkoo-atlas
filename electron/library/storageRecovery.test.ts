import { SnapshotSaveError } from './storage'
import { withStorageRecoveryNotification } from './storageRecovery'
import fs from 'node:fs'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testIndeterminateWriteNotifiesBeforeTheCallerHandlesFailure(): Promise<void> {
  const failure = new SnapshotSaveError('indeterminate', new Error('fault'), 'import-asset')
  const events: string[] = []
  const observedStates: Array<{ code: string; message: string }> = []
  let caught: unknown
  try {
    await withStorageRecoveryNotification(
      async () => {
        events.push('operation')
        throw failure
      },
      (state) => {
        events.push('notification')
        observedStates.push(state)
      },
    )
  } catch (error) {
    events.push('caller-catch')
    caught = error
  }
  assert(caught === failure, '统一 wrapper 必须原样重新抛出 typed storage failure')
  assert(events.join(',') === 'operation,notification,caller-catch', '恢复通知必须先于 handler 的 catch/回包')
  assert(observedStates[0]?.code === 'storage-write-indeterminate', '通知必须使用稳定 typed code')
  assert(observedStates[0]?.message === failure.message, '通知必须携带用户可见 recovery message')
}

export async function testSafeRetryAndUnrelatedFailuresDoNotEmitRecoveryNotification(): Promise<void> {
  for (const failure of [
    new SnapshotSaveError('previous-unchanged', new Error('before rename'), 'save-asset'),
    new Error('unrelated operation error'),
  ]) {
    let notificationCount = 0
    let caught: unknown
    try {
      await withStorageRecoveryNotification(
        () => { throw failure },
        () => { notificationCount += 1 },
      )
    } catch (error) {
      caught = error
    }
    assert(caught === failure, '非 indeterminate 错误也必须原样向调用方传播')
    assert(notificationCount === 0, '只有 indeterminate storage write 才能进入恢复页')
  }
}

export async function testCommitImportIpcUsesTheSharedStorageRecoveryNotificationBoundary(): Promise<void> {
  const source = fs.readFileSync('electron/library/ipc.ts', 'utf8')
  const start = source.indexOf("ipcMain.handle('storage:commitImport'")
  const end = source.indexOf("ipcMain.handle('", start + 20)
  const handler = source.slice(start, end)

  assert(start >= 0, 'fixture 必须找到 storage:commitImport handler')
  assert(
    handler.includes('withStorageRecoveryNotification') &&
      handler.includes('notifyStorageRecoveryRequired'),
    '整批导入进入 indeterminate recovery lock 时必须先广播恢复 CTA，再向 renderer 抛错',
  )
}
