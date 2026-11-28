import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { WEB_JOURNAL_EXPORT_VERSION } from '../../src/lib/webJournalArchiveContract'
import { createEmptyPersistedSnapshot } from '../../src/storage/emptySnapshot'
import { SCHEMA_VERSION } from '../../src/storage/types'
import { JournalImportPreviews } from './journalImportPreviews'
import { LibraryStorage } from './storage'

export async function testCancelledArchivePickerCannotPublishALateSelection(): Promise<void> {
  const previews = new JournalImportPreviews()
  const owner = Object.assign(new EventEmitter(), { id: 7 })
  const source = new LibraryStorage(path.join(os.tmpdir(), 'atlas-unused-picker-source'), { ensureDirectories: false, allowCreate: false })
  let pickerOpened!: () => void
  const opened = new Promise<void>(resolve => { pickerOpened = resolve })
  let select!: (file: string) => void
  let reads = 0
  const pending = previews.prepare(owner, 'picker', () => new Promise(resolve => {
    select = resolve
    pickerOpened()
  }), async () => { reads++; return source })
  await opened
  assert.deepEqual(await previews.prepare(owner, 'picker', async () => { throw Error('重复打开选择器') }, async () => {
    throw Error('重复打开资料库')
  }), { ok: false, error: '检查请求已存在' })
  assert.deepEqual(previews.cancel('picker', owner.id), { ok: true, state: 'cancelled' })
  select('already-cancelled')
  assert.deepEqual(await pending, { ok: false, canceled: true })
  assert.equal(owner.listenerCount('destroyed'), 0)
  assert.equal(reads, 1, '取消后的迟到选择不得再次开库或读取归档')
  assert.deepEqual(previews.cancel('picker', owner.id), { ok: false, state: 'missing' })
}

export async function testArchiveSelectionKeepsItsOriginalInstanceUntilThePreviewIsPublished(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-archive-selection-'))
  const source = new LibraryStorage(path.join(root, 'source'))
  const reopened = new LibraryStorage(source.getLibraryPath(), { allowCreate: false })
  const owner = Object.assign(new EventEmitter(), { id: 7 })
  const previews = new JournalImportPreviews()
  try {
    await source.open()
    await reopened.open()
    const zip = new JSZip()
    zip.file('data.json', JSON.stringify({
      ...createEmptyPersistedSnapshot(), version: WEB_JOURNAL_EXPORT_VERSION, schemaVersion: SCHEMA_VERSION,
    }))
    const archive = path.join(root, 'sample.journal.zip')
    fs.writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer' }))
    for (const replacedAtRead of [2, 3]) {
      let reads = 0
      const result = await previews.prepare(owner, 'change', async () => archive,
        async () => ++reads >= replacedAtRead ? reopened : source)
      assert.ok(!result.ok && result.error?.includes('资料库已切换或重新打开'))
      assert.equal(previews.cancel('change', owner.id).state, 'missing')
      assert.equal(owner.listenerCount('destroyed'), 0)
    }
    const allowed = await previews.prepare(owner, 'stable', async () => {
      source.saveSnapshot({ ...createEmptyPersistedSnapshot(), tagPresets: ['正常保存'] })
      return archive
    }, async () => source)
    assert.ok(allowed.ok)
    assert.equal(previews.resolve(allowed.preview.token, owner.id)?.source, source)
  } finally {
    previews.clear()
    reopened.release()
    source.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}

export async function testArchivePreviewsReleaseStagingAndWindowListenersAfterUse(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-preview-lifecycle-'))
  const storage = new LibraryStorage(path.join(root, 'isolated-library'))
  const owner = Object.assign(new EventEmitter(), { id: 7 })
  const previews = new JournalImportPreviews()
  try {
    await storage.open()
    const zip = new JSZip()
    zip.file('data.json', JSON.stringify({
      ...createEmptyPersistedSnapshot(), version: WEB_JOURNAL_EXPORT_VERSION, schemaVersion: SCHEMA_VERSION,
    }))
    const archive = path.join(root, 'sample.journal.zip')
    fs.writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer' }))
    for (const action of ['cancel', 'did-navigate', 'finish-commit', 'retry-after-owner-close']) {
      const result = await previews.prepare(owner, 'request', async () => archive, async () => storage)
      assert.ok(result.ok)
      const entry = previews.resolve(result.preview.token, owner.id)
      assert.ok(entry)
      assert.equal(owner.listenerCount('destroyed'), 1)
      assert.equal(fs.existsSync(entry.stagedArchivePath), true)
      if (action === 'cancel') {
        assert.deepEqual(previews.cancel(result.preview.token, owner.id), { ok: true, state: 'cancelled' })
      } else if (action === 'did-navigate') {
        owner.emit(action)
      } else {
        entry.state = 'committing'
        assert.deepEqual(previews.cancel(result.preview.token, owner.id), { ok: false, state: 'committing' })
        owner.emit('destroyed')
        assert.equal(fs.existsSync(entry.stagedArchivePath), true)
        if (action === 'retry-after-owner-close') entry.retry()
        else entry.dispose()
      }
      assert.equal(previews.resolve(result.preview.token, owner.id), null)
      assert.equal(fs.existsSync(path.dirname(entry.stagedArchivePath)), false)
      for (const event of ['did-navigate', 'render-process-gone', 'destroyed']) assert.equal(owner.listenerCount(event), 0)
    }

    let signalOpened!: () => void
    const opened = new Promise<void>(resolve => { signalOpened = resolve })
    let releaseStorage!: (store: LibraryStorage) => void
    const pausedStorage = new Promise<LibraryStorage>(resolve => { releaseStorage = resolve })
    const preparing = previews.prepare(owner, 'awaiting-storage', async () => archive, async () => {
      signalOpened()
      return pausedStorage
    })
    await opened
    owner.emit('render-process-gone')
    releaseStorage(storage)
    assert.deepEqual(await preparing, { ok: false, canceled: true })
    assert.equal(owner.listenerCount('destroyed'), 0)

    const shortLived = new JournalImportPreviews(1)
    const expiring = await shortLived.prepare(owner, 'ttl', async () => archive, async () => storage)
    assert.ok(expiring.ok)
    await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(owner.listenerCount('destroyed'), 0, '未经再次访问的过期预览也必须释放')
    assert.equal(shortLived.resolve(expiring.preview.token, owner.id), null)
  } finally {
    previews.clear()
    storage.release()
    fs.rmSync(root, { recursive: true, force: true })
  }
}
