const pendingOperations = new Set<Promise<unknown>>()
const MAX_DRAIN_PASSES = 8

/** 跟踪会在完成后回写编辑器 / store 的存储任务（例如粘贴原图）。 */
export function trackPendingStorageOperation<T>(operation: Promise<T>): Promise<T> {
  pendingOperations.add(operation)
  void operation.finally(() => pendingOperations.delete(operation)).catch(() => {})
  return operation
}

/** 资料库替换前等待所有已启动任务及其尾随任务结束。 */
export async function waitForPendingStorageOperations(): Promise<void> {
  for (let pass = 0; pass < MAX_DRAIN_PASSES; pass++) {
    const current = [...pendingOperations]
    if (current.length === 0) return
    const results = await Promise.allSettled(current)
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (rejected) throw rejected.reason
  }
  if (pendingOperations.size > 0) {
    throw new Error('仍有图片正在保存，请稍后重试')
  }
}

export function pendingStorageOperationCountForTests(): number {
  return pendingOperations.size
}
