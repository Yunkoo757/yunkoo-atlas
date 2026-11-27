export function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

export function createBrowserWait(timeoutMs: number) {
  return async function waitFor(condition: () => unknown, message: string): Promise<void> {
    const deadline = performance.now() + timeoutMs
    while (performance.now() < deadline) {
      if (condition()) return
      await nextFrame()
    }
    throw new Error(message)
  }
}

export const waitFor = createBrowserWait(5_000)
