import assert from 'node:assert/strict'
import { LibraryBusyError, LibraryOperationGate } from './sessionGate'

export async function testTryRunExclusiveNeverQueuesBehindAnActiveOperation(): Promise<void> {
  const gate = new LibraryOperationGate()
  let release!: () => void
  const active = gate.run(() => new Promise<void>((resolve) => { release = resolve }))
  await Promise.resolve()
  await assert.rejects(() => gate.tryRunExclusive(() => 'unexpected'), LibraryBusyError)
  release()
  await active
  assert.equal(await gate.tryRunExclusive(() => 'ok'), 'ok')
}
