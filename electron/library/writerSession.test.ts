import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { LibraryWriterSessions, WindowWriterSessions } from './writerSession'

function windowOwner(id: number, isDestroyed = () => false) {
  return Object.assign(new EventEmitter(), { id, isDestroyed })
}

function fixtureLibrary(name: string) {
  return { getLifecycleId: () => name, clearAssetPurgePreviews() {} }
}

export function testWriterGrantCannotFollowAReplacedLibrary(): void {
  const writers = new LibraryWriterSessions()
  const request = { sender: windowOwner(1) }
  const original = fixtureLibrary('original')
  const replacement = fixtureLibrary('replacement')
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
  const library = fixtureLibrary('same')
  let closed = false
  const first = { sender: windowOwner(1, () => closed) }
  const second = { sender: windowOwner(2) }
  const original = writers.grant(first, library)
  assert.throws(() => writers.assert(second, original.token, library))
  assert.throws(() => writers.grant(second, library))
  writers.assert(first, original.token, library)
  closed = true
  const next = writers.grant(second, library)
  writers.assert(second, next.token, library)
  assert.throws(() => writers.assert(first, original.token, library))
}

export function testOnlyDocumentEndOrGrantReplacementReleasesTheActivePreviews(): void {
  const events = ['did-navigate', 'render-process-gone', 'destroyed']
  for (const event of events) {
    const writers = new LibraryWriterSessions()
    const sender = windowOwner(1)
    let releases = 0
    const library = { getLifecycleId: () => 'same', clearAssetPurgePreviews: () => { releases++ } }
    writers.grant({ sender }, library)
    const active = writers.grant({ sender }, library)
    assert.equal(releases, 1)
    sender.emit('did-navigate-in-page')
    sender.emit('did-frame-navigate')
    writers.assert({ sender }, active.token, library)
    for (const name of events) assert.equal(sender.listenerCount(name), 1)
    sender.emit(event)
    assert.throws(() => writers.assert({ sender }, active.token, library))
    assert.equal(releases, 2)
    for (const name of events) assert.equal(sender.listenerCount(name), 0)
  }
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
