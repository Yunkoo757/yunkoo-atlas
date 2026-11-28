import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fsyncDirectorySync, fsyncFileSync, writeFileAtomicallySync } from './atomicFile'
import type { BackupMeta } from './backupMetadata'
import { sha256File } from './fileChecksum'
import { beginLibraryReplacement } from './libraryReplacement'
import { removeDirectManagedDirectory } from './managedPaths'
import { ensureLibraryDirs, type getLibraryPaths } from './paths'

export function installBackupCandidate(
  libraryPath: string,
  candidate: { paths: ReturnType<typeof getLibraryPaths>; entries: BackupMeta['attachmentEntries'] },
  cleanDatabaseBytes: (bytes: Buffer) => Buffer,
): void {
  const paths = ensureLibraryDirs(libraryPath)
  const { dbFile, manifestFile, attachments } = paths
  const restoredDatabaseBytes = cleanDatabaseBytes(fs.readFileSync(candidate.paths.dbFile))
  const installedDatabaseSha256 = createHash('sha256').update(restoredDatabaseBytes).digest('hex')
  const sourceManifestBytes = fs.existsSync(candidate.paths.manifestFile) ? fs.readFileSync(candidate.paths.manifestFile) : null
  if (candidate.entries) {
    for (const { fileName } of candidate.entries) fsyncFileSync(path.join(candidate.paths.attachments, fileName))
    fsyncDirectorySync(candidate.paths.attachments)
  }

  const transaction = beginLibraryReplacement(paths, 'backup', installedDatabaseSha256)

  try {
    if (candidate.entries) {
      removeDirectManagedDirectory(libraryPath, attachments, 'attachments')
      fs.renameSync(candidate.paths.attachments, attachments)
    }

    writeFileAtomicallySync(dbFile, restoredDatabaseBytes)
    if (sha256File(dbFile) !== installedDatabaseSha256) throw new Error('恢复候选数据库回读校验失败')
    if (sourceManifestBytes) {
      writeFileAtomicallySync(manifestFile, sourceManifestBytes)
    }
    for (const { fileName, vaultName } of candidate.entries ?? []) {
      if (/^[a-f0-9]{64}$/i.test(vaultName) && sha256File(path.join(attachments, fileName)) !== vaultName.toLowerCase()) {
        throw new Error(`Restored attachment checksum is invalid: ${fileName}`)
      }
    }
    fsyncDirectorySync(attachments)
    transaction.commit()
  } catch (error) {
    transaction.rollback()
    throw error
  }
}
