export interface LifecycleOwnership {
  presence: boolean
  hotkey: boolean
}

const AggregateErrorBase = (globalThis as unknown as {
  AggregateError: new (errors: Iterable<unknown>, message?: string) => Error & { errors: unknown[] }
}).AggregateError

export class LifecycleDisposalError extends AggregateErrorBase {
  constructor(errors: unknown[], readonly ownership: LifecycleOwnership) {
    super(errors, '生命周期服务释放失败')
    this.name = 'LifecycleDisposalError'
  }
}

export async function disposeOwnedLifecycle(dependencies: {
  disposePresence(): void
  disposeHotkey(): Promise<void>
  recoverPresence(): void
}): Promise<LifecycleOwnership> {
  try {
    dependencies.disposePresence()
  } catch (error) {
    throw new LifecycleDisposalError([error], { presence: true, hotkey: true })
  }
  try {
    await dependencies.disposeHotkey()
  } catch (hotkeyError) {
    try {
      dependencies.recoverPresence()
    } catch (recoveryError) {
      throw new LifecycleDisposalError(
        [hotkeyError, recoveryError],
        { presence: false, hotkey: true },
      )
    }
    throw new LifecycleDisposalError([hotkeyError], { presence: true, hotkey: true })
  }
  return { presence: false, hotkey: false }
}
