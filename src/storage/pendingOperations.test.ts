import {
  pendingStorageOperationCountForTests,
  trackPendingStorageOperation,
  waitForPendingStorageOperations,
} from '@/storage/pendingOperations'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

export async function testCutoverWaitsForPendingEditorStorageWork(): Promise<void> {
  const pending = deferred()
  trackPendingStorageOperation(pending.promise)
  let drained = false
  const waiting = waitForPendingStorageOperations().then(() => { drained = true })

  await Promise.resolve()
  assert(!drained, '资料库替换不得越过仍在保存的编辑器图片')
  assert(pendingStorageOperationCountForTests() === 1, '进行中的任务必须保持可见')

  pending.resolve()
  await waiting
  assert(drained, '图片保存完成后应允许资料库替换继续')
  assert(pendingStorageOperationCountForTests() === 0, '完成的任务必须从跟踪集合移除')
}
