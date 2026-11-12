type ComposerDraftGuard = () => boolean

let activeGuard: ComposerDraftGuard | null = null

export class UnsavedTradeComposerDraftError extends Error {
  constructor() {
    super('表单尚未保存，请继续使用并保存或放弃修改。')
    this.name = 'UnsavedTradeComposerDraftError'
  }
}

/** Keep the lazy composer out of the App entry while checking its current in-memory draft. */
export function registerTradeComposerDraftGuard(guard: ComposerDraftGuard): () => void {
  activeGuard = guard
  return () => {
    if (activeGuard === guard) activeGuard = null
  }
}

export function assertTradeComposerDraftCanClose(): void {
  if (activeGuard?.()) {
    throw new UnsavedTradeComposerDraftError()
  }
}
