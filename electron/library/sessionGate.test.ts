import { LibraryBusyError, LibraryOperationGate } from './sessionGate'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

export async function testExclusiveOperationWaitsForExistingWritesAndRejectsNewOnes(): Promise<void> {
  const gate = new LibraryOperationGate()
  const write = deferred()
  const order: string[] = []
  const activeWrite = gate.run(async () => {
    order.push('write-start')
    await write.promise
    order.push('write-end')
  })
  const exclusive = gate.runExclusive(async () => {
    order.push('exclusive')
  })

  let rejected = false
  try {
    await gate.run(async () => undefined)
  } catch (error) {
    rejected = error instanceof LibraryBusyError
  }
  assert(rejected, 'new autosaves must be rejected once a library transition begins')
  assert(!order.includes('exclusive'), 'exclusive work must wait for the active image or snapshot write')

  write.resolve()
  await Promise.all([activeWrite, exclusive])
  assert(order.join(',') === 'write-start,write-end,exclusive', 'the old-library write must finish before switching')
}

export async function testOnlyOneExclusiveLibraryTransitionCanRun(): Promise<void> {
  const gate = new LibraryOperationGate()
  const hold = deferred()
  const first = gate.runExclusive(() => hold.promise)
  let rejected = false
  try {
    await gate.runExclusive(async () => undefined)
  } catch (error) {
    rejected = error instanceof LibraryBusyError
  }
  hold.resolve()
  await first
  assert(rejected, 'a second switch, restore or import must fail instead of silently queueing')
}

export async function testCancelledExclusiveWaitReleasesGateWithoutRunningOperation(): Promise<void> {
  const gate = new LibraryOperationGate()
  const hold = deferred()
  const activeWrite = gate.run(() => hold.promise)
  const controller = new AbortController()
  let exclusiveRan = false
  const exclusive = gate.runExclusive(() => {
    exclusiveRan = true
  }, controller.signal)

  controller.abort()
  let cancelled = false
  try {
    await exclusive
  } catch (error) {
    cancelled = error instanceof Error && error.name === 'AbortError'
  }

  let nextWriteRan = false
  await gate.run(async () => {
    nextWriteRan = true
  })
  hold.resolve()
  await activeWrite

  assert(cancelled, 'an aborted exclusive wait must reject with AbortError')
  assert(!exclusiveRan, 'an aborted exclusive operation must never run')
  assert(nextWriteRan, 'aborting an exclusive wait must release the gate for future writes')
}
