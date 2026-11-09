export interface CloseBarrierDependencies {
  lockInteraction(): () => void
  suspend(): void
  resume(): void
  drain(): Promise<void>
  flush(): Promise<void>
}

/** 从开始退出到主进程终结/取消，持续持有交互与自动保存的同一份租约。 */
export class RendererCloseBarrier {
  private generation = 0
  private attempt: { generation: number; unlock: () => void } | null = null

  constructor(private readonly dependencies: CloseBarrierDependencies) {}

  begin(): number {
    if (this.attempt) return this.attempt.generation
    const unlock = this.dependencies.lockInteraction()
    try { this.dependencies.suspend() } catch (error) { unlock(); throw error }
    this.attempt = { generation: ++this.generation, unlock }
    return this.attempt.generation
  }

  isHolding(): boolean { return this.attempt !== null }

  async flush(generation: number): Promise<void> {
    const current = () => this.attempt?.generation === generation
    const assertCurrent = () => { if (!current()) throw new Error('本轮退出保存已取消') }
    try {
      assertCurrent()
      await this.dependencies.drain()
      assertCurrent()
      await this.dependencies.flush()
      assertCurrent()
    } catch (error) {
      if (current()) this.cancel()
      throw error
    }
  }

  cancel(): void {
    const attempt = this.attempt
    if (!attempt) return
    this.attempt = null
    try { this.dependencies.resume() } finally { attempt.unlock() }
  }
}
