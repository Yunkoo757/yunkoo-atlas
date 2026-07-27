export async function disposeOwnedLifecycle(dependencies: {
  disposePresence(): void
  disposeHotkey(): Promise<void>
  recoverPresence(): void
}): Promise<void> {
  dependencies.disposePresence()
  try {
    await dependencies.disposeHotkey()
  } catch (error) {
    dependencies.recoverPresence()
    throw error
  }
}
