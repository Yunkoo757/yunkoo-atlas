export interface LifecycleOwnership {
  presence: boolean
  hotkey: boolean
}

const AggregateErrorBase = (globalThis as unknown as {
  AggregateError: new (errors: Iterable<unknown>, message?: string) => Error & { errors: unknown[] }
}).AggregateError

export class ResourceInitializationError<T> extends AggregateErrorBase {
  readonly ownershipRetained: boolean

  constructor(errors: unknown[], readonly resource: T | null) {
    super(errors, '资源初始化失败')
    this.name = 'ResourceInitializationError'
    this.ownershipRetained = resource !== null
  }
}

export function initializeOwnedResource<T>(dependencies: {
  create(): T
  initialize(resource: T): void
  dispose(resource: T): void
}): T {
  const candidate = dependencies.create()
  try {
    dependencies.initialize(candidate)
    return candidate
  } catch (initializationError) {
    try {
      dependencies.dispose(candidate)
    } catch (cleanupError) {
      throw new ResourceInitializationError([initializationError, cleanupError], candidate)
    }
    throw new ResourceInitializationError([initializationError], null)
  }
}

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
      const presenceRetained = recoveryError instanceof ResourceInitializationError &&
        recoveryError.ownershipRetained
      throw new LifecycleDisposalError(
        [hotkeyError, recoveryError],
        { presence: presenceRetained, hotkey: true },
      )
    }
    throw new LifecycleDisposalError([hotkeyError], { presence: true, hotkey: true })
  }
  return { presence: false, hotkey: false }
}
