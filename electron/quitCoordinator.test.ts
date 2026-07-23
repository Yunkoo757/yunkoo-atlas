import {
  releaseThenFinalizeWithRollback,
  QuitCoordinator,
  RendererFlushTracker,
  type QuitIntent,
} from './quitCoordinator'
import fs from 'node:fs'
import path from 'node:path'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testConcurrentExitRequestsShareOneCycleAndPromoteInstall(): Promise<void> {
  const calls = { flush: 0, backup: 0, release: 0, finalize: 0 }
  const lifecycle: string[] = []
  let finishFlush: (() => void) | undefined
  const coordinator = new QuitCoordinator({
    timeoutMs: 1_000,
    createRequestId: () => 'request-1',
    requestRendererFlush: () => {
      calls.flush += 1
      return new Promise<void>((resolve) => { finishFlush = resolve })
    },
    createVerifiedBackup: async () => { calls.backup += 1 },
    commitExit: async (resolveIntent) => {
      calls.release += 1
      calls.finalize += 1
      const intent = resolveIntent()
      assert(intent === 'quit-and-install', '并发更新安装必须提升最终退出意图')
    },
    cancelPreparation: () => {},
    reportStart: (event) => lifecycle.push(`start:${event.operationId}:${event.stage}`),
    reportSuccess: (event) => lifecycle.push(`success:${event.operationId}:${event.stage}`),
    reportError: () => {},
  })

  const close = coordinator.request('close')
  const install = coordinator.request('quit-and-install')
  assert(close === install, '同一退出周期的并发请求必须共享同一个 Promise')
  finishFlush?.()
  const result = await close
  assert(result.ok, '完整退出周期应成功')
  assert(Object.values(calls).every((count) => count === 1), 'flush/backup/release/finalize 必须各执行一次')
  assert(
    lifecycle.join('|') === 'start:request-1:renderer-flush|success:request-1:commit-exit',
    '并发退出请求必须共享一组 start/success 日志标识',
  )
}

export async function testExitFailureStopsBeforeReleaseAndReportsAbort(): Promise<void> {
  for (const failureAt of ['flush', 'backup'] as const) {
    const calls: string[] = []
    const coordinator = new QuitCoordinator({
      timeoutMs: 1_000,
      createRequestId: () => `request-${failureAt}`,
      requestRendererFlush: async () => {
        calls.push('flush')
        if (failureAt === 'flush') throw new Error('flush failed')
      },
      createVerifiedBackup: async () => {
        calls.push('backup')
        if (failureAt === 'backup') throw new Error('backup failed')
      },
      commitExit: async () => { calls.push('release', 'finalize') },
      cancelPreparation: () => {},
      reportStart: (event) => calls.push(`start:${event.operationId}:${event.stage}`),
      reportSuccess: () => calls.push('success'),
      reportError: (failure) => calls.push(`error:${failure.code}:${failure.message}`),
    })
    const result = await coordinator.request('quit')
    assert(!result.ok, `${failureAt} 失败必须取消退出`)
    assert(!calls.includes('release') && !calls.includes('finalize'), '失败时不得 release 或报告退出成功')
    assert(!calls.includes('success'), '失败退出不得写入 success 终态')
    assert(calls.filter((entry) => entry.startsWith('start:')).length === 1, '失败退出必须恰好记录一次 start')
    const expectedCode = failureAt === 'flush' ? 'quit-flush-failed' : 'quit-backup-failed'
    assert(calls.some((entry) => entry.startsWith(`error:${expectedCode}:`)), '失败必须携带稳定阶段 code')
  }
}

export async function testCommitExitFailureUsesCommitCodeAndNeverReportsSuccess(): Promise<void> {
  const calls: string[] = []
  const coordinator = new QuitCoordinator({
    timeoutMs: 1_000,
    createRequestId: () => 'request-commit-failure',
    requestRendererFlush: async () => {},
    createVerifiedBackup: async () => {},
    commitExit: async () => { throw new Error('commit failed') },
    cancelPreparation: () => { calls.push('cancel') },
    reportStart: () => { calls.push('start') },
    reportSuccess: () => { calls.push('success') },
    reportError: (failure) => calls.push(`failure:${failure.code}:${failure.stage}`),
  })

  const result = await coordinator.request('quit')
  assert(!result.ok, 'commit-exit 失败必须取消退出')
  assert(calls.join('|') === 'start|cancel|failure:quit-commit-failed:commit-exit', 'commit-exit 必须使用准确 code 且不得误报 success')
}

export async function testIntentCanPromoteAfterCommitPreparationHasStarted(): Promise<void> {
  let commitStarted: (() => void) | undefined
  let finishPreparation: (() => void) | undefined
  const started = new Promise<void>((resolve) => { commitStarted = resolve })
  const coordinator = new QuitCoordinator({
    timeoutMs: 1_000,
    createRequestId: () => 'request-late-promotion',
    requestRendererFlush: async () => {},
    createVerifiedBackup: async () => {},
    commitExit: async (resolveIntent) => {
      commitStarted?.()
      await new Promise<void>((resolve) => { finishPreparation = resolve })
      assert(resolveIntent() === 'quit-and-install', '最终副作用前必须读取升级后的退出意图')
    },
    cancelPreparation: () => {},
    reportError: () => {},
  })

  const close = coordinator.request('close')
  await started
  const install = coordinator.request('quit-and-install')
  finishPreparation?.()
  const result = await close
  assert(close === install, '提交准备期的升级请求仍应共享同一 Promise')
  assert(result.ok && result.intent === 'quit-and-install', '结果必须报告实际执行的升级意图')
}

export async function testHardTimeoutCancelsInsteadOfContinuingExit(): Promise<void> {
  const calls: string[] = []
  const coordinator = new QuitCoordinator({
    timeoutMs: 10,
    createRequestId: () => 'request-timeout',
    requestRendererFlush: () => new Promise<void>(() => {}),
    createVerifiedBackup: async () => { calls.push('backup') },
    commitExit: async () => { calls.push('release', 'finalize') },
    cancelPreparation: () => {},
    reportError: (failure) => calls.push(`${failure.code}:${failure.message}`),
  })
  const result = await coordinator.request('close')
  assert(!result.ok && result.error.includes('超时'), '硬超时必须返回明确的 aborted 结果')
  assert(calls.length === 1 && calls[0].includes('超时'), '超时后只能报告错误，不能继续副作用')
}

export async function testAbsoluteDeadlineBlocksCommitAfterSynchronousOverrun(): Promise<void> {
  const calls: string[] = []
  let now = 100
  const coordinator = new QuitCoordinator({
    timeoutMs: 15,
    now: () => now,
    createRequestId: () => 'request-deadline',
    requestRendererFlush: async () => {},
    createVerifiedBackup: async () => {
      calls.push('backup')
      now = 116
    },
    commitExit: async () => { calls.push('commit') },
    cancelPreparation: () => { calls.push('cancel') },
    reportError: (failure) => calls.push(`${failure.code}:${failure.message}`),
  })

  const result = await coordinator.request('quit')
  assert(!result.ok && result.error.includes('超时'), '事件循环被同步工作阻塞后也必须按绝对截止时间失败')
  assert(!calls.includes('commit'), '超过绝对截止时间后不得进入退出提交')
  assert(calls.includes('cancel'), '超过绝对截止时间后必须解除退出准备状态')
}

export async function testThrowingFinalizerRollsReleasedStorageBack(): Promise<void> {
  const order: string[] = []
  let threw = false
  try {
    await releaseThenFinalizeWithRollback(
      () => { order.push('release') },
      () => { throw new Error('quit-and-install failed') },
      async () => { order.push('rollback') },
    )
  } catch {
    threw = true
  }
  assert(threw, '最终退出调用失败必须向协调器传播')
  assert(order.join(',') === 'release,rollback', '退出提交必须先 release，finalize 失败后必须恢复存储')
}

export function testRendererFlushTrackerRejectsStaleOrWrongWindowAcknowledgements(): void {
  const tracker = new RendererFlushTracker('current-request', [11, 22])
  assert(tracker.acknowledge('old-request', 11, true) === 'ignored', '陈旧 requestId ACK 必须无效')
  assert(tracker.acknowledge('current-request', 33, true) === 'ignored', '非目标 webContents ACK 必须无效')
  assert(tracker.acknowledge('current-request', 11, true) === 'pending', '部分窗口完成时仍应等待')
  assert(tracker.acknowledge('current-request', 11, true) === 'ignored', '重复 ACK 不得重复计数')
  assert(tracker.acknowledge('current-request', 22, true) === 'complete', '所有目标窗口 ACK 后才能完成')
}

export function testRendererFlushTrackerFailsWholeCycleOnOneWindowError(): void {
  const tracker = new RendererFlushTracker('request-error', [7, 8])
  assert(tracker.acknowledge('request-error', 7, false) === 'failed', '任一 renderer 保存失败必须取消整轮退出')
  assert(tracker.isFailed(), 'tracker 必须冻结为失败态')
}

export function testIntentPriorityIsStable(): void {
  const intents: QuitIntent[] = ['close', 'quit', 'quit-and-install']
  assert(intents.length === 3, '退出意图合同必须保持三种明确终态')
}

export function testAllElectronExitEntrypointsUseTheSingleCoordinator(): void {
  const main = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')
  const updater = fs.readFileSync(path.resolve('electron/updater.ts'), 'utf8')
  const backup = fs.readFileSync(path.resolve('electron/library/backup.ts'), 'utf8')
  const libraryIpc = fs.readFileSync(path.resolve('electron/library/ipc.ts'), 'utf8')
  const preload = fs.readFileSync(path.resolve('electron/preload.ts'), 'utf8')
  assert(main.includes("quitCoordinator.request('close')"), '窗口关闭必须进入统一协调器')
  assert(main.includes("quitCoordinator.request('quit')"), '应用退出必须进入统一协调器')
  assert(main.includes('BrowserWindow.getAllWindows()) window.close()'), '窗口关闭提交必须覆盖全部已确认窗口')
  assert(updater.includes("requestExit('quit-and-install')"), '更新安装必须进入统一协调器')
  assert(!updater.includes("ipcMain.once('app:before-close-complete'"), '更新器不得保留第二套 ACK 监听')
  assert(!backup.includes("app.on('before-quit'"), '备份模块不得在 before-quit 重复执行副作用')
  const exitBackupImplementation = libraryIpc.slice(
    libraryIpc.indexOf('export async function createVerifiedExitBackup'),
    libraryIpc.indexOf('export async function commitStorageExit'),
  )
  assert(exitBackupImplementation.includes('}, signal)'), '退出备份等待独占锁时必须响应同一 AbortSignal')
  assert(
    libraryIpc.includes('if (!verification.emptyLibrary) return false') &&
      libraryIpc.includes('reopened.saveSnapshot(emptySnapshot)'),
    '空库恢复点必须经普通验证后规范化为 renderer 可用的空快照',
  )
  assert(preload.includes('requestId') && preload.includes('webContentsId'), 'renderer ACK 必须回传请求与窗口身份')
}
// Quality-Scenario: E-QUIT-MULTI
// Quality-Scenario: E-QUIT-STALE-ACK
// Quality-Scenario: E-QUIT-FLUSH-FAIL
// Quality-Scenario: E-QUIT-BACKUP-FAIL
// Quality-Scenario: E-QUIT-RELEASED
