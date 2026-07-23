import { createFullPersistedSnapshotFixture } from '../src/storage/fixtures/fullPersistedSnapshot'
import { LibraryStorage } from './library/storage'

function snapshot(label: string, noteBytes = 0) {
  const value = createFullPersistedSnapshotFixture()
  value.profile = {
    avatarId: value.profile?.avatarId ?? null,
    displayName: label,
    customAvatarDataUrl: value.profile?.customAvatarDataUrl ?? null,
  }
  if (noteBytes > 0) {
    value.trades[0] = {
      ...value.trades[0],
      note: `<p>${'x'.repeat(noteBytes)}</p>`,
    }
  }
  return value
}

function send(message: Record<string, unknown>): void {
  process.send?.({
    ...message,
    runtime: 'electron-main',
    electronVersion: process.versions.electron,
    processId: process.pid,
  })
}

export async function runElectronForcedKillMode(mode: string, libraryRoot: string): Promise<void> {
  const storage = new LibraryStorage(libraryRoot, {
    ensureDirectories: mode === 'seed',
    allowCreate: mode === 'seed',
    beforeAtomicReplace: mode === 'crash-save'
      ? () => {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30_000)
        }
      : undefined,
  })
  await storage.open()

  if (mode === 'seed') {
    storage.saveSnapshot(snapshot('confirmed-revision-1'))
    storage.release()
    send({ type: 'seeded', confirmed: 'confirmed-revision-1' })
    return
  }

  if (mode === 'crash-save') {
    const pending = snapshot('unconfirmed-revision-2', 128 * 1024 * 1024)
    send({ type: 'save-starting', pending: 'unconfirmed-revision-2' })
    await new Promise<void>((resolve) => setImmediate(resolve))
    storage.saveSnapshot(pending)
    storage.release()
    send({ type: 'save-completed' })
    return
  }

  if (mode === 'verify') {
    const loaded = storage.loadSnapshot()
    storage.release()
    send({
      type: 'verified',
      displayName: loaded?.profile?.displayName ?? null,
      noteLength: loaded?.trades[0]?.note.length ?? null,
    })
    return
  }

  storage.release()
  throw new Error(`unknown Electron forced-kill mode: ${mode}`)
}
