export class LibraryBusyError extends Error {
  readonly code = 'LIBRARY_BUSY'

  constructor() {
    super('交易库正在切换、导入或恢复，请稍后再试')
    this.name = 'LibraryBusyError'
  }
}

function abortError(): Error {
  const error = new Error('操作已取消')
  error.name = 'AbortError'
  return error
}

/**
 * 普通存储操作可并行；切库、恢复和整库导入必须独占。
 * 独占开始后拒绝新的普通操作，避免旧快照排队后写入新库。
 */
export class LibraryOperationGate {
  private active = 0
  private exclusive = false
  private drainWaiters: Array<() => void> = []

  async run<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.exclusive) throw new LibraryBusyError()
    this.active += 1
    try {
      return await operation()
    } finally {
      this.active -= 1
      if (this.active === 0) {
        const waiters = this.drainWaiters
        this.drainWaiters = []
        waiters.forEach((resolve) => resolve())
      }
    }
  }

  async runExclusive<T>(operation: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.exclusive) throw new LibraryBusyError()
    if (signal?.aborted) throw abortError()
    this.exclusive = true
    try {
      if (this.active > 0) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(abortError())
          signal?.addEventListener('abort', onAbort, { once: true })
          this.drainWaiters.push(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
          })
        })
      }
      if (signal?.aborted) throw abortError()
      return await operation()
    } finally {
      this.exclusive = false
    }
  }

  isExclusive(): boolean {
    return this.exclusive
  }
}
