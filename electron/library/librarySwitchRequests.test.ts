import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { LibrarySwitchRequests } from './librarySwitchRequests'
import { LibraryStorage } from './storage'

class WindowDocument extends EventEmitter {
  constructor(readonly id: number) { super() }
  isDestroyed() { return false }
}

const selection = {
  sourceStorage: new LibraryStorage(path.join(tmpdir(), 'atlas-isolated-unopened'), { ensureDirectories: false, allowCreate: false }),
  target: { mode: 'create', path: 'unused-target' } as const,
}

function pending() {
  let finish!: () => void
  const promise = new Promise<void>(resolve => { finish = resolve })
  return { promise, finish }
}

export async function testAbandonedInspectionCannotPublishOrClearNewDocumentSelection() {
  for (const event of ['did-navigate', 'render-process-gone', 'destroyed']) {
    const requests = new LibrarySwitchRequests()
    const owner = new WindowDocument(1)
    const hold = pending()
    const previous = requests.prepare(owner, async () => { await hold.promise; return selection })
    await assert.rejects(requests.prepare(owner, async () => selection), /正在进行/)
    owner.emit(event)
    assert.equal(requests.busy, false)
    assert.deepEqual(owner.eventNames(), [])
    const next = await requests.prepare(owner, async () => selection)
    hold.finish()
    await assert.rejects(previous, /已失效/)
    assert.equal(requests.cancel(owner.id, next), true)
    assert.deepEqual(owner.eventNames(), [])
  }
}

export async function testSwitchConsumptionBelongsToOwnerAndHoldsSlotUntilCommitFinishes() {
  const requests = new LibrarySwitchRequests()
  const owner = new WindowDocument(1)
  const token = await requests.prepare(owner, async () => selection)
  owner.emit('did-start-navigation', {}, 'file:///subframe', false, false)
  owner.emit('did-navigate-in-page')
  assert.equal(requests.cancel(2, token), false)
  await assert.rejects(requests.activate(2, token, async () => {}), /已失效/)
  const hold = pending()
  const result = requests.activate(owner.id, token, async checked => {
    assert.equal(checked, selection)
    await hold.promise
    return 7
  })
  await assert.rejects(requests.activate(owner.id, token, async () => {}), /已失效/)
  assert.equal(requests.cancel(owner.id, token), false)
  owner.emit('did-navigate')
  assert.deepEqual(owner.eventNames(), [])
  assert.equal(requests.busy, true)
  await assert.rejects(requests.prepare(owner, async () => selection), /正在进行/)
  hold.finish()
  assert.equal(await result, 7)
  assert.equal(requests.busy, false)
}

export async function testFailedCancelledAndExpiredSwitchesReleaseListenersAndPermitRetry() {
  const owner = new WindowDocument(1)
  const requests = new LibrarySwitchRequests()
  await assert.rejects(requests.prepare(owner, async () => { throw Error('read failed') }), /read failed/)
  const first = await requests.prepare(owner, async () => selection)
  assert.equal(requests.cancel(owner.id, first), true)
  assert.equal(requests.cancel(owner.id, first), false)
  const retry = await requests.prepare(owner, async () => selection)
  await assert.rejects(requests.activate(owner.id, retry, async () => { throw Error('commit failed') }), /commit failed/)
  assert.equal(requests.busy, false)
  assert.deepEqual(owner.eventNames(), [])

  const immediate = new LibrarySwitchRequests(0)
  const expired = await immediate.prepare(owner, async () => selection)
  await assert.rejects(immediate.activate(owner.id, expired, async () => {}), /已失效/)
  assert.deepEqual(owner.eventNames(), [])
  await immediate.prepare(owner, async () => selection)
  await delay(5)
  assert.deepEqual(owner.eventNames(), [])
  assert.equal(immediate.busy, false)
}
