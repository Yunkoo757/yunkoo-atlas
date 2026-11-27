import assert from 'node:assert/strict'
import { LibraryWriterSessions, WindowWriterSessions } from './writerSession'

export function testWriterGrantCannotFollowAReplacedLibrary(): void {
  const writers = new LibraryWriterSessions()
  const request = { sender: { id: 1, isDestroyed: () => false } }
  const original = { getLifecycleId: () => 'original' }
  const replacement = { getLifecycleId: () => 'replacement' }
  const first = writers.grant(request, original)
  writers.assert(request, first.token, original)
  assert.throws(() => writers.assert(request, first.token, replacement))
  const next = writers.grant(request, replacement)
  assert.notEqual(first.token, next.token)
  assert.throws(() => writers.assert(request, first.token, replacement))
  assert.throws(() => writers.assert(request, first.token, original))
  writers.assert(request, next.token, replacement)
}

export function testOnlyTheLiveOwnerCanGrantOrWrite(): void {
  const writers = new LibraryWriterSessions()
  const library = { getLifecycleId: () => 'same' }
  let closed = false
  const first = { sender: { id: 1, isDestroyed: () => closed } }
  const second = { sender: { id: 2, isDestroyed: () => false } }
  const original = writers.grant(first, library)
  assert.throws(() => writers.assert(second, original.token, library))
  assert.throws(() => writers.grant(second, library))
  writers.assert(first, original.token, library)
  closed = true
  const next = writers.grant(second, library)
  writers.assert(second, next.token, library)
  assert.throws(() => writers.assert(first, original.token, library))
}

export function testLateReceiptsCannotReplaceTheCurrentWindowWriterOrItsRevision(): void {
  const writers = new WindowWriterSessions()
  assert.throws(() => writers.require())
  const first = { token: 'first', generation: 1 }
  const second = { token: 'second', generation: 2 }
  writers.accept(first, 6)
  const pending = writers.require()
  writers.accept(second, 6)
  pending.revision = 7
  assert.throws(() => writers.accept(first, 10))
  assert.deepEqual(writers.require(), { ...second, revision: 6 })
}
