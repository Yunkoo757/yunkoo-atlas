import { createRotatedBackup, rotateBackups } from './backup'
import { ensureLibraryDirs } from './paths'
import { LibraryBusyError, type LibraryOperationGate } from './sessionGate'
import type { LibraryStorage } from './storage'

const BACKUP_INTERVAL_MS = 15 * 60 * 1000

export class LibraryAutoBackup {
  private active: { storage: LibraryStorage; timer: ReturnType<typeof setInterval> } | undefined

  constructor(private readonly gate: LibraryOperationGate, private readonly onFailure: () => void) {}

  /** 校验候选目录。调用返回的函数才接管定时器并轮换备份。 */
  prepare(storage: LibraryStorage): () => void {
    const { backups } = ensureLibraryDirs(storage.getLibraryPath())
    return () => {
      if (this.active?.storage === storage) return
      const timer = setInterval(() => {
        if (this.active?.timer === timer) void this.tick(storage)
      }, BACKUP_INTERVAL_MS)
      this.stop()
      this.active = { storage, timer }
      rotateBackups(backups)
    }
  }

  start(storage: LibraryStorage): void {
    if (this.active?.storage !== storage) this.prepare(storage)()
  }

  stop(): boolean {
    if (!this.active) return false
    clearInterval(this.active.timer)
    this.active = undefined
    return true
  }

  private async tick(storage: LibraryStorage): Promise<void> {
    try {
      const backup = await this.gate.tryRunExclusive(() => createRotatedBackup(storage))
      if (backup) return
    } catch (error) {
      if (error instanceof LibraryBusyError) return
    }
    if (this.active?.storage === storage) this.onFailure()
  }
}
