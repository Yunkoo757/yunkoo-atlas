import assert from 'node:assert/strict'
import { useStore } from '@/store/useStore'
import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { clearNoteDraft, discardAllNoteDrafts, flushNoteDraftToStore, getNoteDraft, setNoteDraft } from '@/storage/noteDrafts'

async function withNote(run: (id: string) => Promise<void>) {
  const original = useStore.getState().trades
  const note = { ...createFullPersistedSnapshotFixture().trades[0]!, id: 'isolated-note-lifecycle', note: '<p>durable</p>' }
  discardAllNoteDrafts()
  useStore.setState({ trades: [note] })
  try { await run(note.id) } finally { discardAllNoteDrafts(); useStore.setState({ trades: original }) }
}

export async function testNormalizationNeverPublishesAnAlreadySupersededDraft() {
  await withNote(async id => {
    const published: string[] = []
    const unsubscribe = useStore.subscribe(state => { published.push(state.trades[0]!.note) })
    try {
      setNoteDraft(id, '<p>A</p>')
      const flushing = flushNoteDraftToStore(id)
      setNoteDraft(id, '<p>B</p>')
      assert(await flushing)
      assert.deepEqual(published, ['<p>B</p>'], '已失效的 A 不得进入 Store 或自动保存队列')
    } finally { unsubscribe() }
  })
}

export async function testClearingADraftInvalidatesItsInflightNormalization() {
  await withNote(async id => {
    setNoteDraft(id, '<p>discarded</p>')
    const old = flushNoteDraftToStore(id)
    clearNoteDraft(id)
    assert(await old)
    assert.equal(useStore.getState().trades[0]!.note, '<p>durable</p>')
  })
}

export async function testNewLibraryDraftDoesNotJoinTheDiscardedLibraryFlush() {
  await withNote(async id => {
    setNoteDraft(id, '<p>old-library</p>')
    const old = flushNoteDraftToStore(id)
    discardAllNoteDrafts()
    setNoteDraft(id, '<p>new-library</p>')
    const current = flushNoteDraftToStore(id)
    assert.notEqual(current, old, '新生命周期必须持有自己的冲洗任务')
    assert(await current)
    await old
    assert.equal(getNoteDraft(id), undefined)
    assert.equal(useStore.getState().trades[0]!.note, '<p>new-library</p>')
  })
}
