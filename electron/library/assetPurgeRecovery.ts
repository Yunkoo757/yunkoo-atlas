import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sha256File } from './fileChecksum'
import { exportJournalZip, prepareJournalArchive } from './journalZip'
import type { LibraryStorage } from './storage'

export async function exportVerifiedPurgeArchive(storage: LibraryStorage, destination: string) {
  const archivePath = path.resolve(destination)
  await exportJournalZip(storage, archivePath)
  const checksum = sha256File(archivePath)
  const verificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-purge-recovery-'))
  try {
    await prepareJournalArchive(verificationRoot, archivePath)
  } finally {
    fs.rmSync(verificationRoot, { recursive: true, force: true })
  }

  function verify() {
    let stat: fs.Stats
    try { stat = fs.lstatSync(archivePath) }
    catch { throw new Error('附件清理恢复归档已移动或删除，请重新导出') }
    if (!stat.isFile() || stat.isSymbolicLink() || sha256File(archivePath) !== checksum) {
      throw new Error('附件清理恢复归档在导出后发生变化，请重新导出')
    }
  }
  verify()
  return { path: destination, verify }
}
