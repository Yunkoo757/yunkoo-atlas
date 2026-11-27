import type { WebContents } from 'electron'
import { onRendererDocumentEnd, type RendererDocumentEvents } from './rendererDocument'
import type { LibraryStorage } from './storage'

export interface WriterGrant {
  token: string
  generation: number
}

type Owner = RendererDocumentEvents & Pick<WebContents, 'id' | 'isDestroyed'>
type Request = { sender: Owner }
type Library = Pick<LibraryStorage, 'getLifecycleId' | 'clearAssetPurgePreviews'>

/** 每次开库或完成切换都重新签发。已经交给调用方的凭据始终只属于原实例。 */
export class LibraryWriterSessions {
  private current: { grant: WriterGrant; owner: Owner; lifecycle: string; release(): void } | undefined
  private generation = 0

  grant(request: Request, library: Library): WriterGrant {
    if (request.sender.isDestroyed()) throw new Error('当前资料库窗口已经关闭')
    const owner = this.current?.owner
    if (owner && owner.id !== request.sender.id && !owner.isDestroyed()) {
      throw new Error('交易库已由另一个窗口占用，请关闭重复窗口后重试')
    }
    const grant = { token: crypto.randomUUID(), generation: ++this.generation }
    this.current?.release()
    const release = () => {
      if (this.current?.grant !== grant) return
      detach()
      library.clearAssetPurgePreviews()
      this.current = undefined
    }
    const detach = onRendererDocumentEnd(request.sender, release)
    this.current = { grant, owner: request.sender, lifecycle: library.getLifecycleId(), release }
    return grant
  }

  assert(request: Request, token: unknown, library: Library): void {
    const writer = this.current
    if (!writer || writer.owner.id !== request.sender.id || token !== writer.grant.token || writer.lifecycle !== library.getLifecycleId()) {
      throw new Error('资料库写入会话已失效，已阻止旧窗口写入；请重新打开资料库')
    }
  }
}

export class WindowWriterSessions {
  private active: (WriterGrant & { revision: number }) | null = null

  get current() { return this.active }

  require() {
    if (!this.active) throw new Error('资料库写入会话尚未建立，请重新打开资料库')
    return this.active
  }

  accept(grant: WriterGrant, revision: number): void {
    if (this.active && grant.generation <= this.active.generation) {
      throw new Error('资料库会话已变化，请重新读取当前资料库')
    }
    this.active = { ...grant, revision }
  }
}
