import { randomUUID } from 'node:crypto'
import { onRendererDocumentEnd, type RendererDocumentEvents } from './rendererDocument'
import type { PreparedLibraryTarget } from './librarySwitchTargets'
import type { LibraryStorage } from './storage'

type Owner = RendererDocumentEvents & { id: number; isDestroyed(): boolean }
interface PreparedSwitch {
  sourceStorage: LibraryStorage
  target: PreparedLibraryTarget
}

interface Request {
  token: string
  ownerId: number
  ready?: { selection: PreparedSwitch; expiresAt: number }
  detach(): void
}

const expired = () => new Error('候选交易库已失效，请重新选择')

/** 同时只接受一次切换。从开始检查到交给写入会话，准备请求始终属于原窗口文档。 */
export class LibrarySwitchRequests {
  private active?: Request

  constructor(private readonly ttlMs = 2 * 60 * 1000) {}

  private get live() {
    const active = this.active
    if (active?.ready && active.ready.expiresAt <= Date.now()) this.release(active)
    return this.active
  }

  get busy() { return this.live !== undefined }

  private release(request: Request) {
    if (this.active !== request) return
    request.detach()
    this.active = undefined
  }

  async prepare(owner: Owner, inspect: () => Promise<PreparedSwitch>): Promise<string> {
    if (this.busy) throw new Error('已有交易库切换正在进行，请稍后再试')
    if (owner.isDestroyed()) throw expired()
    let timer: ReturnType<typeof setTimeout> | undefined
    const request: Request = {
      token: randomUUID(),
      ownerId: owner.id,
      detach() {
        clearTimeout(timer)
        detachDocument()
      },
    }
    const detachDocument = onRendererDocumentEnd(owner, () => this.release(request))
    this.active = request
    try {
      const selection = await inspect()
      if (this.active !== request) throw expired()
      request.ready = { selection, expiresAt: Date.now() + this.ttlMs }
      timer = setTimeout(() => this.release(request), this.ttlMs)
      timer.unref()
      return request.token
    } catch (error) {
      this.release(request)
      throw error
    }
  }

  private ownedRequest(ownerId: number, token: string) {
    const request = this.live
    return request?.ownerId === ownerId && request.token === token ? request : undefined
  }

  cancel(ownerId: number, token: string): boolean {
    const request = this.ownedRequest(ownerId, token)
    if (!request?.ready) return false
    this.release(request)
    return true
  }

  async activate<T>(ownerId: number, token: string, commit: (prepared: PreparedSwitch) => Promise<T>): Promise<T> {
    const request = this.ownedRequest(ownerId, token)
    if (!request?.ready) throw expired()
    const { selection } = request.ready
    request.ready = undefined
    request.detach()
    // 消费后由写入会话核对文档；独占操作完成前仍保留占位。
    try {
      return await commit(selection)
    } finally {
      this.active = undefined
    }
  }
}
